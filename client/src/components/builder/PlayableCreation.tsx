import { useMemo, useRef, useState } from 'react'

/**
 * Full-screen play surface for a front-end creation. Renders the artifact in a
 * sandboxed iframe (opaque origin — no app-session access) and injects a tiny
 * bridge so the host's on-screen touch controls can drive keyboard-controlled
 * games: the host posts {__cpctl, key, down} and the bridge dispatches a
 * synthetic KeyboardEvent inside the iframe. Mobile has no arrow keys, so this
 * is how a built game becomes playable on a phone.
 */

const CONTROL_BRIDGE = `<script>(function(){
  function fire(type,key){
    try{
      var e=new KeyboardEvent(type,{key:key,code:key,bubbles:true,cancelable:true});
      var t=document.activeElement||document.body||document.documentElement;
      t.dispatchEvent(e);document.dispatchEvent(e);window.dispatchEvent(e);
    }catch(_){}
  }
  window.addEventListener('message',function(ev){
    var d=ev&&ev.data||{};
    if(d&&d.__cpctl&&d.key){fire(d.down?'keydown':'keyup',d.key);}
  });
})();<\/script>`

function withBridge(html: string): string {
  if (!html) return html
  if (html.includes('</body>')) return html.replace('</body>', CONTROL_BRIDGE + '</body>')
  return html + CONTROL_BRIDGE
}

type Props = { html: string; title?: string; onClose: () => void }

const ARROWS: Array<{ key: string; icon: string; gridArea: string; label: string }> = [
  { key: 'ArrowUp', icon: 'ti-chevron-up', gridArea: '1 / 2 / 2 / 3', label: 'Up' },
  { key: 'ArrowLeft', icon: 'ti-chevron-left', gridArea: '2 / 1 / 3 / 2', label: 'Left' },
  { key: 'ArrowDown', icon: 'ti-chevron-down', gridArea: '2 / 2 / 3 / 3', label: 'Down' },
  { key: 'ArrowRight', icon: 'ti-chevron-right', gridArea: '2 / 3 / 3 / 4', label: 'Right' },
]

export default function PlayableCreation({ html, title, onClose }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [started, setStarted] = useState(false)
  const [showPad, setShowPad] = useState(true)
  const srcDoc = useMemo(() => withBridge(html), [html])

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

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 80, background: '#000',
      paddingTop: 'var(--sat-px, 0px)', paddingBottom: 'var(--sab-px, 0px)',
    }}>
      <iframe ref={iframeRef} title={title || 'Creation'} sandbox="allow-scripts" srcDoc={srcDoc}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />

      <button onClick={onClose} aria-label="Close"
        style={{ position: 'absolute', top: 'calc(var(--sat-px, 0px) + 10px)', left: 10, zIndex: 3, width: 38, height: 38, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.18)', color: '#fff', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <i className="ti ti-x" aria-hidden="true" />
      </button>

      <button onClick={() => setShowPad((v) => !v)} aria-label={showPad ? 'Hide controls' : 'Show controls'}
        style={{ position: 'absolute', top: 'calc(var(--sat-px, 0px) + 10px)', right: 10, zIndex: 3, width: 38, height: 38, borderRadius: '50%', background: showPad ? '#00CEC8' : 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.18)', color: showPad ? '#00302e' : '#fff', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <i className="ti ti-device-gamepad-2" aria-hidden="true" />
      </button>

      {!started && (
        <button onClick={() => setStarted(true)}
          style={{ position: 'absolute', inset: 0, zIndex: 2, background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <span style={{ width: 60, height: 60, borderRadius: '50%', background: '#00CEC8', color: '#00302e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>
            <i className="ti ti-player-play" aria-hidden="true" />
          </span>
          <span style={{ fontSize: 15 }}>Tap to start</span>
          {title ? <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>{title}</span> : null}
        </button>
      )}

      {started && showPad && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(var(--sab-px, 0px) + 14px)', zIndex: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', padding: '0 18px', pointerEvents: 'none' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 52px)', gridTemplateRows: 'repeat(2, 52px)', gap: 6, pointerEvents: 'auto' }}>
            {ARROWS.map((a) => (
              <button key={a.key} aria-label={a.label} style={{ ...padBtn, gridArea: a.gridArea }} {...hold(a.key)}>
                <i className={`ti ${a.icon}`} aria-hidden="true" />
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, pointerEvents: 'auto' }}>
            <button aria-label="Rotate / action" style={{ ...padBtn, width: 60, height: 60, borderRadius: '50%' }} {...hold('ArrowUp')}>
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
