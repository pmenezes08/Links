import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { prepareCreationHtml } from '../../utils/creationHtml'

/**
 * Full-screen play surface for a front-end creation. Renders the artifact in a
 * sandboxed iframe (opaque origin — no app-session access) and scales it to fit
 * the frame: the injected fit-reporter posts the content size out, and we apply
 * a transform so fixed-pixel artifacts can't overflow or clip. Host controls are
 * intentionally minimal so the generated creation feels self-contained.
 */

type Props = {
  html: string
  title?: string
  onClose: () => void
  creationId?: number
  communityId?: number | string | null
  onRuntimeError?: (msg: string) => void
  onShare?: () => void
  shared?: boolean
  startMatchId?: number | null
}

export default function PlayableCreation({ html, title, onClose, creationId, communityId, onRuntimeError, startMatchId }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [fit, setFit] = useState(1)
  const [bgColor, setBgColor] = useState('#000')
  const [cpNotice, setCpNotice] = useState<string | null>(null)
  const noticeTimer = useRef<number | undefined>(undefined)
  const showNotice = (msg: string) => {
    setCpNotice(msg)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setCpNotice(null), 6000)
  }
  const srcDoc = useMemo(
    () => prepareCreationHtml(html, { dataBridge: creationId != null, errorReporter: true, startMatchId }),
    [html, creationId, startMatchId],
  )
  const contextPayload = useMemo(() => {
    const n = Number(communityId || 0)
    return n > 0 ? { community_id: n } : {}
  }, [communityId])
  const contextQuery = useMemo(() => {
    const n = Number(communityId || 0)
    return n > 0 ? `community_id=${encodeURIComponent(String(n))}` : ''
  }, [communityId])
  const withContext = useCallback((url: string) => (
    contextQuery ? `${url}${url.includes('?') ? '&' : '?'}${contextQuery}` : url
  ), [contextQuery])

  const fitRef = useRef(1)
  useEffect(() => { setFit(1); fitRef.current = 1; setBgColor('#000') }, [html])

  // Count one play when the surface opens (best-effort).
  useEffect(() => {
    if (creationId == null) return
    fetch(withContext(`/api/builder/${creationId}/play`), { method: 'POST', credentials: 'include' }).catch(() => { /* noop */ })
  }, [creationId, withContext])

  // Persist the final score when the artifact signals a run ended. The game owns
  // its OWN end screen + leaderboard (built from the CPoint API), so the host shows
  // no result UI of its own — just a small confirmation toast that the score saved.
  const handleGameOver = useCallback(async (score: unknown, key: unknown) => {
    if (creationId == null) return
    const k = (typeof key === 'string' && key) ? key : 'highscore'
    const numScore = typeof score === 'number' && isFinite(score) ? score : null
    if (numScore == null) return
    try {
      const r = await fetch(`/api/builder/${creationId}/data/score`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: numScore, key: k, ...contextPayload }),
      })
      if (r.ok) showNotice('✓ Score saved')
    } catch { /* best-effort */ }
  }, [creationId, contextPayload])

  // Broker CPoint SDK calls + handle runtime errors and the gameOver signal from
  // the sandboxed artifact. Only messages from THIS artifact's window are
  // honoured (the opaque-origin iframe sends origin "null", so source identity
  // is the real guard).
  useEffect(() => {
    if (creationId == null) return
    const base = `/api/builder/${creationId}/data`
    const reply = (src: MessageEventSource | null, rid: string, ok: boolean, result?: unknown, error?: string) => {
      try { (src as Window | null)?.postMessage({ __cpdata_res: true, rid, ok, result, error }, '*') } catch { /* noop */ }
    }
    const onMsg = async (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return // only our artifact
      const d = e.data as { __cpdata?: boolean; __cperr?: boolean; __cpend?: boolean; rid?: string; op?: string; payload?: Record<string, unknown>; message?: string; score?: unknown; key?: unknown } | null
      if (!d || typeof d !== 'object') return
      if (d.__cperr) { if (onRuntimeError && typeof d.message === 'string') onRuntimeError(d.message); return }
      if (d.__cpend) { handleGameOver(d.score, d.key); return }
      if (!d.__cpdata || !d.rid || !d.op) return
      const rid = d.rid
      const p = (d.payload || {}) as Record<string, unknown>
      try {
        let res: Response
        if (d.op === 'submitScore') {
          res = await fetch(`${base}/score`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: p.value, key: p.key, name: p.name, ...contextPayload }) })
        } else if (d.op === 'rate') {
          res = await fetch(`${base}/rate`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: p.value, name: p.name, ...contextPayload }) })
        } else if (d.op === 'getLeaderboard') {
          const q = new URLSearchParams({ key: String(p.key || 'highscore'), limit: String(p.limit || 10) })
          res = await fetch(withContext(`${base}/leaderboard?${q.toString()}`), { credentials: 'include' })
        } else if (d.op === 'getResults') {
          res = await fetch(withContext(`${base}/results`), { credentials: 'include' })
        } else if (d.op === 'save') {
          res = await fetch(`${base}/save`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: p.key, value: p.value, ...contextPayload }) })
        } else if (d.op === 'load') {
          res = await fetch(withContext(`${base}/load?key=${encodeURIComponent(String(p.key || 'save'))}`), { credentials: 'include' })
        } else if (d.op === 'images') {
          const q = new URLSearchParams({ q: String(p.q || ''), limit: String(p.limit || 8) })
          res = await fetch(withContext(`${base}/images?${q.toString()}`), { credentials: 'include' })
        } else if (d.op === 'feed') {
          const q = new URLSearchParams({ connector: String(p.connector || ''), params: JSON.stringify(p.params || {}) })
          if (p.refresh) q.set('refresh', '1')
          res = await fetch(withContext(`${base}/feed?${q.toString()}`), { credentials: 'include' })
        } else if (d.op === 'shared.get') {
          const q = new URLSearchParams({ key: String(p.key || 'main') })
          res = await fetch(withContext(`${base}/shared?${q.toString()}`), { credentials: 'include' })
        } else if (d.op === 'shared.update') {
          res = await fetch(`${base}/shared`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: p.key, value: p.value, version: p.version, ...contextPayload }) })
        } else if (d.op === 'collection.list') {
          const name = encodeURIComponent(String(p.name || 'items'))
          const q = new URLSearchParams({ limit: String(p.limit || 100) })
          res = await fetch(withContext(`${base}/collection/${name}?${q.toString()}`), { credentials: 'include' })
        } else if (d.op === 'collection.create') {
          const name = encodeURIComponent(String(p.name || 'items'))
          res = await fetch(`${base}/collection/${name}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: p.value, ...contextPayload }) })
        } else if (d.op === 'collection.update') {
          const name = encodeURIComponent(String(p.name || 'items'))
          const id = encodeURIComponent(String(p.id || ''))
          res = await fetch(`${base}/collection/${name}/${id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: p.value, version: p.version, ...contextPayload }) })
        } else if (d.op === 'collection.delete') {
          const name = encodeURIComponent(String(p.name || 'items'))
          const id = encodeURIComponent(String(p.id || ''))
          res = await fetch(`${base}/collection/${name}/${id}`, { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(contextPayload) })
        } else if (d.op === 'forms.submit') {
          const name = encodeURIComponent(String(p.name || 'default'))
          res = await fetch(`${base}/forms/${name}/submit`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: p.value, ...contextPayload }) })
        } else if (typeof d.op === 'string' && d.op.indexOf('match.') === 0) {
          // Two-player match ops -> /api/builder/<id>/match/* (game owns the UI).
          const sub = d.op.slice(6)
          const mbase = `/api/builder/${creationId}/match`
          const jpost = (url: string, body: Record<string, unknown>) => fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...contextPayload }) })
          if (sub === 'opponents') res = await fetch(withContext(`${mbase}/opponents`), { credentials: 'include' })
          else if (sub === 'list') res = await fetch(withContext(`${mbase}/list`), { credentials: 'include' })
          else if (sub === 'create') res = await jpost(`${mbase}/create`, { opponent: p.opponent })
          else if (sub === 'get') res = await fetch(withContext(`${mbase}/${Number(p.id)}`), { credentials: 'include' })
          else if (sub === 'poll') res = await fetch(withContext(`${mbase}/${Number(p.id)}/poll?since=${encodeURIComponent(String(p.since || 0))}`), { credentials: 'include' })
          else if (sub === 'move') res = await jpost(`${mbase}/${Number(p.id)}/move`, { move: p.move, state: p.state, version: p.version, result: p.result })
          else if (sub === 'accept' || sub === 'decline' || sub === 'cancel' || sub === 'resign') res = await jpost(`${mbase}/${Number(p.id)}/${sub}`, {})
          else { reply(e.source, rid, false, undefined, 'unknown_op'); return }
        } else {
          reply(e.source, rid, false, undefined, 'unknown_op'); return
        }
        const data = await res.json().catch(() => null) as { success?: boolean; error?: string } | null
        if (res.ok && data && data.success !== false) {
          // Confirm the write landed so it's obvious persistence is working.
          if (d.op === 'submitScore') showNotice('✓ Score saved')
          else if (d.op === 'save') showNotice('✓ Saved')
          reply(e.source, rid, true, data)
        } else {
          const err = (data && data.error) || `request_failed (HTTP ${res.status})`
          console.warn(`[CPoint] ${d.op} failed: ${err}`)
          // Match ops (turns/conflicts) are handled in the game's own UI — no host toast.
          if (typeof d.op === 'string' && d.op.indexOf('match.') !== 0) showNotice(`Couldn't ${d.op}: ${err}`)
          reply(e.source, rid, false, undefined, err)
        }
      } catch (netErr) {
        const msg = (netErr as { message?: string })?.message || 'network error'
        console.warn(`[CPoint] ${d.op} failed: ${msg}`)
        if (typeof d.op === 'string' && d.op.indexOf('match.') !== 0) showNotice(`Couldn't ${d.op}: ${msg}`)
        reply(e.source, rid, false, undefined, 'network_error')
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [creationId, contextPayload, handleGameOver, onRuntimeError, withContext])

  // The artifact posts its measured content size; scale down to fit the WIDTH
  // only (tall content scrolls — never scale a long page to fit its height).
  // The latch is monotonic-decrease with a dead-band: we only ever shrink, and
  // only on a meaningful change. This is what breaks the scale<->reflow
  // feedback loop that made responsive sites flash: scaling down widens the
  // iframe's inner viewport, content reflows, the size is re-reported — and
  // without the latch we'd scale back up, re-narrow, reflow, forever.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __cpfit?: boolean; __cpbg?: boolean; color?: string; w?: number; vw?: number } | null
      if (!d || typeof d !== 'object') return
      if (d.__cpbg && typeof d.color === 'string') { setBgColor(d.color); return }
      if (!d.__cpfit) return
      const sx = d.vw && d.w ? d.vw / d.w : 1
      const target = sx < 0.999 ? Math.max(0.4, sx) : 1
      if (target < fitRef.current - 0.02) { // only ever shrink, only if meaningful
        fitRef.current = target
        setFit(target)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const scaled = fit < 1
  const iframeStyle: React.CSSProperties = scaled
    ? { position: 'absolute', top: 0, left: 0, width: `${100 / fit}%`, height: `${100 / fit}%`, transform: `scale(${fit})`, transformOrigin: 'top left', border: 0, display: 'block' }
    : { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, display: 'block' }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 80, background: bgColor,
      display: 'flex', flexDirection: 'column',
      paddingTop: 'var(--sat-px, 0px)',
      // Shrink the surface above the on-screen keyboard. The app runs with
      // KeyboardResize.None, so the WebView stays full-height and we instead
      // consume the globally-published --keyboard-offset (App.tsx). This lets a
      // generated app's focused text input stay visible instead of being hidden
      // behind the keyboard. Falls back to the safe-area inset when closed.
      paddingBottom: 'max(var(--sab-px, 0px), var(--keyboard-offset, 0px))',
      transition: 'padding-bottom 0.2s ease',
    }}>
      <div style={{ flex: '1 1 auto', position: 'relative', overflow: 'hidden', minHeight: 0, background: bgColor }}>
        <iframe ref={iframeRef} title={title || 'Creation'} sandbox="allow-scripts" srcDoc={srcDoc} style={iframeStyle} />
      </div>

      <button onClick={onClose} aria-label="Close"
        style={{ position: 'absolute', top: 'calc(var(--sat-px, 0px) + 12px)', left: 12, zIndex: 3, width: 46, height: 46, borderRadius: '50%', background: 'rgba(0,0,0,0.78)', border: '1px solid rgba(255,255,255,0.34)', color: '#fff', fontSize: 23, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.45)' }}>
        <i className="ti ti-x" aria-hidden="true" />
      </button>

      {cpNotice && (
        <div onClick={() => setCpNotice(null)}
          style={{ position: 'absolute', top: 'calc(var(--sat-px, 0px) + 14px)', left: '50%', transform: 'translateX(-50%)', zIndex: 5, maxWidth: '86%', padding: '9px 14px', borderRadius: 12, background: cpNotice.startsWith('✓') ? 'rgba(0,206,200,0.92)' : 'rgba(40,40,40,0.94)', color: cpNotice.startsWith('✓') ? '#00302e' : '#fff', fontSize: 13, fontWeight: 500, textAlign: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.14)' }}>
          {cpNotice}
        </div>
      )}

    </div>
  )
}
