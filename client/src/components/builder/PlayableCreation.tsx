import { useEffect, useMemo, useRef, useState } from 'react'
import { prepareCreationHtml } from '../../utils/creationHtml'

/**
 * Full-screen play surface for a front-end creation. Renders the artifact in a
 * sandboxed iframe (opaque origin — no app-session access) and scales it to fit
 * the frame: the injected fit-reporter posts the content size out, and we apply
 * a transform so fixed-pixel artifacts can't overflow or clip. An optional
 * on-screen D-pad drives keyboard games via the injected control bridge.
 */

type Props = { html: string; title?: string; onClose: () => void; creationId?: number }

const ARROWS: Array<{ key: string; icon: string; gridArea: string; label: string }> = [
  { key: 'ArrowUp', icon: 'ti-chevron-up', gridArea: '1 / 2 / 2 / 3', label: 'Up' },
  { key: 'ArrowLeft', icon: 'ti-chevron-left', gridArea: '2 / 1 / 3 / 2', label: 'Left' },
  { key: 'ArrowDown', icon: 'ti-chevron-down', gridArea: '2 / 2 / 3 / 3', label: 'Down' },
  { key: 'ArrowRight', icon: 'ti-chevron-right', gridArea: '2 / 3 / 3 / 4', label: 'Right' },
]

export default function PlayableCreation({ html, title, onClose, creationId }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [showPad, setShowPad] = useState(false)
  const [fit, setFit] = useState(1)
  const srcDoc = useMemo(
    () => prepareCreationHtml(html, { controlBridge: true, dataBridge: creationId != null }),
    [html, creationId],
  )

  useEffect(() => { setFit(1) }, [html])

  // Count one play when the surface opens (best-effort).
  useEffect(() => {
    if (creationId == null) return
    fetch(`/api/builder/${creationId}/play`, { method: 'POST', credentials: 'include' }).catch(() => { /* noop */ })
  }, [creationId])

  // Broker CPoint SDK calls from the sandboxed artifact: the artifact posts an
  // RPC, the host (session-authed) performs the real fetch and posts the result
  // back. Only messages from THIS artifact's window are honoured.
  useEffect(() => {
    if (creationId == null) return
    const base = `/api/builder/${creationId}/data`
    const reply = (src: MessageEventSource | null, rid: string, ok: boolean, result?: unknown, error?: string) => {
      try { (src as Window | null)?.postMessage({ __cpdata_res: true, rid, ok, result, error }, '*') } catch { /* noop */ }
    }
    const onMsg = async (e: MessageEvent) => {
      const d = e.data as { __cpdata?: boolean; rid?: string; op?: string; payload?: Record<string, unknown> } | null
      if (!d || typeof d !== 'object' || !d.__cpdata || !d.rid || !d.op) return
      if (e.source !== iframeRef.current?.contentWindow) return // only our artifact
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
        } else {
          reply(e.source, rid, false, undefined, 'unknown_op'); return
        }
        const data = await res.json().catch(() => null) as { success?: boolean; error?: string } | null
        if (res.ok && data && data.success !== false) reply(e.source, rid, true, data)
        else reply(e.source, rid, false, undefined, (data && data.error) || 'request_failed')
      } catch {
        reply(e.source, rid, false, undefined, 'network_error')
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [creationId])

  // The artifact posts its measured content size; scale down (never up) to fit.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __cpfit?: boolean; w?: number; h?: number; vw?: number; vh?: number } | null
      if (!d || typeof d !== 'object' || !d.__cpfit) return
      const sx = d.vw && d.w ? d.vw / d.w : 1
      const sy = d.vh && d.h ? d.vh / d.h : 1
      const s = Math.min(1, sx, sy)
      setFit(s < 0.999 ? Math.max(0.4, s) : 1)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const sendKey = (key: string, down: boolean) => {
    try { iframeRef.current?.contentWindow?.postMessage({ __cpctl: true, key, down }, '*') } catch { /* noop */ }
  }
  const hold = (key: string) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); sendKey(key, true) },
    onPointerUp: (e: React.PointerEvent) => { e.preventDefault(); sendKey(key, false) },
    onPointerLeave: () => sendKey(key, false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  })

  const padBtn: React.CSSProperties = {
    width: 52, height: 52, borderRadius: 12, background: 'rgba(20,20,20,0.82)',
    border: '1px solid rgba(255,255,255,0.16)', color: '#f1f1f1', fontSize: 22,
    display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none', userSelect: 'none',
  }

  const scaled = fit < 1
  const iframeStyle: React.CSSProperties = scaled
    ? { position: 'absolute', top: 0, left: 0, width: `${100 / fit}%`, height: `${100 / fit}%`, transform: `scale(${fit})`, transformOrigin: 'top left', border: 0, display: 'block' }
    : { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, display: 'block' }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 80, background: '#000',
      display: 'flex', flexDirection: 'column',
      paddingTop: 'var(--sat-px, 0px)', paddingBottom: 'var(--sab-px, 0px)',
    }}>
      <div style={{ flex: '1 1 auto', position: 'relative', overflow: 'hidden', minHeight: 0 }}>
        <iframe ref={iframeRef} title={title || 'Creation'} sandbox="allow-scripts" srcDoc={srcDoc} style={iframeStyle} />
      </div>

      <button onClick={onClose} aria-label="Close"
        style={{ position: 'absolute', top: 'calc(var(--sat-px, 0px) + 10px)', left: 10, zIndex: 3, width: 38, height: 38, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.18)', color: '#fff', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <i className="ti ti-x" aria-hidden="true" />
      </button>

      <button onClick={() => setShowPad((v) => !v)} aria-label={showPad ? 'Hide controls' : 'Show controls'}
        style={{ position: 'absolute', top: 'calc(var(--sat-px, 0px) + 10px)', right: 10, zIndex: 3, width: 38, height: 38, borderRadius: '50%', background: showPad ? '#00CEC8' : 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.18)', color: showPad ? '#00302e' : '#fff', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <i className="ti ti-device-gamepad-2" aria-hidden="true" />
      </button>

      {showPad && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(var(--sab-px, 0px) + 14px)', zIndex: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', padding: '0 18px', pointerEvents: 'none' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 52px)', gridTemplateRows: 'repeat(2, 52px)', gap: 6, pointerEvents: 'auto' }}>
            {ARROWS.map((a) => (
              <button key={a.key} aria-label={a.label} style={{ ...padBtn, gridArea: a.gridArea }} {...hold(a.key)}>
                <i className={`ti ${a.icon}`} aria-hidden="true" />
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, pointerEvents: 'auto' }}>
            <button aria-label="Rotate / up" style={{ ...padBtn, width: 60, height: 60, borderRadius: '50%' }} {...hold('ArrowUp')}>
              <i className="ti ti-rotate-clockwise" aria-hidden="true" />
            </button>
            <button aria-label="Action" style={{ ...padBtn, width: 60, height: 60, borderRadius: '50%', background: 'rgba(0,206,200,0.22)', borderColor: 'rgba(0,206,200,0.5)' }} {...hold(' ')}>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#bdeeeb' }}>GO</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
