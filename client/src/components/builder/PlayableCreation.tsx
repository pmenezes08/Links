import { useEffect, useMemo, useRef, useState } from 'react'
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
  onRuntimeError?: (msg: string) => void
  onShare?: () => void
  shared?: boolean
}

type Entry = { name: string; value: number; rank: number }
type ResultState = { score: number | null; key: string }

export default function PlayableCreation({ html, title, onClose, creationId, onRuntimeError, onShare, shared }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [fit, setFit] = useState(1)
  const [playKey, setPlayKey] = useState(0)
  const [result, setResult] = useState<ResultState | null>(null)
  const [board, setBoard] = useState<{ entries: Entry[]; mine: Entry | null } | null>(null)
  const [myRating, setMyRating] = useState<number | null>(null)
  const srcDoc = useMemo(
    () => prepareCreationHtml(html, { dataBridge: creationId != null, errorReporter: true }),
    [html, creationId],
  )

  const fitRef = useRef(1)
  useEffect(() => { setFit(1); fitRef.current = 1 }, [html])

  // Count one play when the surface opens (best-effort).
  useEffect(() => {
    if (creationId == null) return
    fetch(`/api/builder/${creationId}/play`, { method: 'POST', credentials: 'include' }).catch(() => { /* noop */ })
  }, [creationId])

  // Show the native result screen when the artifact signals the run ended.
  const handleGameOver = async (score: unknown, key: unknown) => {
    const k = (typeof key === 'string' && key) ? key : 'highscore'
    const numScore = typeof score === 'number' && isFinite(score) ? score : null
    if (creationId != null) {
      try {
        if (numScore != null) {
          await fetch(`/api/builder/${creationId}/data/score`, {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: numScore, key: k }),
          })
        }
        const [lb, rs] = await Promise.all([
          fetch(`/api/builder/${creationId}/data/leaderboard?key=${encodeURIComponent(k)}&limit=5`, { credentials: 'include' }).then((r) => r.json()).catch(() => null),
          fetch(`/api/builder/${creationId}/data/results`, { credentials: 'include' }).then((r) => r.json()).catch(() => null),
        ])
        setBoard(lb && lb.success ? { entries: lb.entries || [], mine: lb.mine || null } : { entries: [], mine: null })
        setMyRating(rs && rs.success ? (typeof rs.mine === 'number' ? rs.mine : null) : null)
      } catch { /* show the overlay anyway */ }
    }
    setResult({ score: numScore, key: k })
  }

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
          res = await fetch(`${base}/score`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: p.value, key: p.key, name: p.name }) })
        } else if (d.op === 'rate') {
          res = await fetch(`${base}/rate`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: p.value, name: p.name }) })
        } else if (d.op === 'getLeaderboard') {
          const q = new URLSearchParams({ key: String(p.key || 'highscore'), limit: String(p.limit || 10) })
          res = await fetch(`${base}/leaderboard?${q.toString()}`, { credentials: 'include' })
        } else if (d.op === 'getResults') {
          res = await fetch(`${base}/results`, { credentials: 'include' })
        } else if (d.op === 'save') {
          res = await fetch(`${base}/save`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: p.key, value: p.value }) })
        } else if (d.op === 'load') {
          res = await fetch(`${base}/load?key=${encodeURIComponent(String(p.key || 'save'))}`, { credentials: 'include' })
        } else if (d.op === 'images') {
          const q = new URLSearchParams({ q: String(p.q || ''), limit: String(p.limit || 8) })
          res = await fetch(`${base}/images?${q.toString()}`, { credentials: 'include' })
        } else if (d.op === 'feed') {
          const q = new URLSearchParams({ connector: String(p.connector || ''), params: JSON.stringify(p.params || {}) })
          res = await fetch(`${base}/feed?${q.toString()}`, { credentials: 'include' })
        } else {
          reply(e.source, rid, false, undefined, 'unknown_op'); return
        }
        const data = await res.json().catch(() => null) as { success?: boolean; error?: string } | null
        if (res.ok && data && data.success !== false) reply(e.source, rid, true, data)
        else {
          const err = (data && data.error) || 'request_failed'
          // Persistence failures used to vanish silently; surface them so QA can
          // tell apart auth_required / save_too_large / rate_limited / not_found.
          if (d.op === 'save' || d.op === 'load') console.warn(`[CPoint] ${d.op} failed: ${err}`)
          reply(e.source, rid, false, undefined, err)
        }
      } catch {
        if (d.op === 'save' || d.op === 'load') console.warn(`[CPoint] ${d.op} failed: network_error`)
        reply(e.source, rid, false, undefined, 'network_error')
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [creationId])

  // The artifact posts its measured content size; scale down to fit the WIDTH
  // only (tall content scrolls — never scale a long page to fit its height).
  // The latch is monotonic-decrease with a dead-band: we only ever shrink, and
  // only on a meaningful change. This is what breaks the scale<->reflow
  // feedback loop that made responsive sites flash: scaling down widens the
  // iframe's inner viewport, content reflows, the size is re-reported — and
  // without the latch we'd scale back up, re-narrow, reflow, forever.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __cpfit?: boolean; w?: number; vw?: number } | null
      if (!d || typeof d !== 'object' || !d.__cpfit) return
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
      position: 'fixed', inset: 0, zIndex: 80, background: '#000',
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
      <style>{`@keyframes cp-sheet-up { from { transform: translateY(100%) } to { transform: translateY(0) } }`}</style>
      <div style={{ flex: '1 1 auto', position: 'relative', overflow: 'hidden', minHeight: 0 }}>
        <iframe key={playKey} ref={iframeRef} title={title || 'Creation'} sandbox="allow-scripts" srcDoc={srcDoc} style={iframeStyle} />
      </div>

      <button onClick={onClose} aria-label="Close"
        style={{ position: 'absolute', top: 'calc(var(--sat-px, 0px) + 12px)', left: 12, zIndex: 3, width: 46, height: 46, borderRadius: '50%', background: 'rgba(0,0,0,0.78)', border: '1px solid rgba(255,255,255,0.34)', color: '#fff', fontSize: 23, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.45)' }}>
        <i className="ti ti-x" aria-hidden="true" />
      </button>

      {result && (
        <ResultOverlay
          result={result}
          board={board}
          myRating={myRating}
          shared={shared}
          onRate={async (v) => {
            setMyRating(v)
            if (creationId != null) {
              try { await fetch(`/api/builder/${creationId}/data/rate`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: v }) }) } catch { /* noop */ }
            }
          }}
          onPlayAgain={() => { setResult(null); setBoard(null); setPlayKey((k) => k + 1) }}
          onShare={onShare}
          onClose={onClose}
        />
      )}
    </div>
  )
}

function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const dur = 900
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur)
      const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
      setN(Math.round(to * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to])
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{n.toLocaleString()}</span>
}

function ResultOverlay({ result, board, myRating, shared, onRate, onPlayAgain, onShare, onClose }: {
  result: ResultState
  board: { entries: Entry[]; mine: Entry | null } | null
  myRating: number | null
  shared?: boolean
  onRate: (v: number) => void
  onPlayAgain: () => void
  onShare?: () => void
  onClose: () => void
}) {
  const entries = board?.entries || []
  const hasScore = result.score != null
  const isBest = hasScore && board?.mine != null && Number(board.mine.value) <= Number(result.score)
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 6, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', background: '#0b0b0b', borderRadius: '20px 20px 0 0', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '10px 18px', paddingBottom: 'calc(var(--sab-px, 0px) + 16px)', animation: 'cp-sheet-up 0.25s cubic-bezier(0.32,0.72,0,1)' }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)', margin: '4px auto 14px' }} />

        {hasScore ? (
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: '#8a8a8a' }}>{isBest ? 'New best!' : 'Your score'}</div>
            <div style={{ fontSize: 44, fontWeight: 600, color: isBest ? '#EF9F27' : '#00CEC8', textShadow: isBest ? '0 0 18px rgba(239,159,39,0.45)' : 'none', lineHeight: 1.1 }}>
              <CountUp to={Number(result.score)} />
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', fontSize: 22, color: '#f1f1f1', margin: '4px 0 14px' }}>Nice one!</div>
        )}

        {hasScore && entries.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: '#7a7a7a', marginBottom: 6 }}>Top scores</div>
            {entries.slice(0, 5).map((en) => {
              const mine = board?.mine != null && en.rank === board.mine.rank && Number(en.value) === Number(board.mine.value)
              return (
                <div key={en.rank} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 8, background: mine ? 'rgba(0,206,200,0.08)' : 'transparent' }}>
                  <span style={{ width: 20, color: en.rank === 1 ? '#EF9F27' : '#8a8a8a', fontSize: 13, fontWeight: 600 }}>{en.rank}</span>
                  <span style={{ flex: 1, minWidth: 0, color: '#e9e9e9', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{en.name}</span>
                  <span style={{ color: '#f1f1f1', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{Number(en.value).toLocaleString()}</span>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#7a7a7a', marginBottom: 6 }}>Rate it for the maker</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
            {[1, 2, 3, 4, 5].map((s) => (
              <button key={s} onClick={() => onRate(s)} aria-label={`Rate ${s}`}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 26, color: (myRating || 0) >= s ? '#00CEC8' : 'rgba(255,255,255,0.18)', padding: 2 }}>
                <i className="ti ti-star-filled" aria-hidden />
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onPlayAgain} style={{ flex: 1, background: '#00CEC8', color: '#00302e', border: 'none', borderRadius: 22, padding: '13px 0', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Play again</button>
          {onShare ? (
            <button onClick={onShare} disabled={shared} style={{ flex: 1, background: 'transparent', color: '#00CEC8', border: '1px solid rgba(0,206,200,0.5)', borderRadius: 22, padding: '13px 0', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>{shared ? 'Shared ✓' : 'Share'}</button>
          ) : (
            <button onClick={onClose} style={{ flex: 1, background: 'transparent', color: '#cfcfcf', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 22, padding: '13px 0', fontSize: 15, fontWeight: 500, cursor: 'pointer' }}>Done</button>
          )}
        </div>
      </div>
    </div>
  )
}
