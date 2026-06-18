import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useBuilder } from '../hooks/useBuilder'
import { useFixedComposerKeyboard } from '../hooks/useFixedComposerKeyboard'
import PlayableCreation from '../components/builder/PlayableCreation'

const SUGGESTIONS = [
  'A block-stacking game for the group',
  'Quiz: which pizza topping are you?',
  'A spin-the-wheel to pick who buys coffee',
  'A countdown to our next meetup',
]

const STAGES = ["Steve's on it", 'Making it', 'Adding the fun bits', 'Almost there']

function BuildingIndicator() {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setSecs((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  const label = secs < 4 ? STAGES[0] : secs < 12 ? STAGES[1] : secs < 25 ? STAGES[2] : STAGES[3]
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: 'rgba(0,0,0,0.72)' }}>
      <div style={{ width: 34, height: 34, borderRadius: '50%', border: '3px solid rgba(0,206,200,0.25)', borderTopColor: '#00CEC8', animation: 'cp-spin 0.8s linear infinite' }} />
      <div style={{ fontSize: 14, color: '#e9e9e9' }}>{label} <span style={{ color: '#00CEC8' }}>{secs}s</span></div>
    </div>
  )
}

export default function BuilderPage() {
  const { community_id } = useParams()
  const navigate = useNavigate()
  const cid = String(community_id || '')
  const { creation, messages, loading, error, limit, rev, build, publish } = useBuilder(cid)
  const [input, setInput] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishedPostId, setPublishedPostId] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight })
  }
  const { keyboardLift, safeBottomPx } = useFixedComposerKeyboard({ onLayoutNudge: scrollToBottom })

  useEffect(scrollToBottom, [messages, loading])

  const send = () => {
    const v = input.trim()
    if (!v || loading) return
    setInput('')
    setPublishedPostId(null)
    build(v)
  }

  const onPublish = async () => {
    if (!creation || publishing) return
    setPublishing(true)
    const postId = await publish()
    setPublishing(false)
    if (postId) setPublishedPostId(postId)
  }

  const goBack = () => {
    if (cid) navigate(`/community_feed_react/${cid}`)
    else navigate(-1)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60, background: '#000', color: '#f1f1f1',
      display: 'flex', flexDirection: 'column',
      paddingTop: 'var(--sat-px, 0px)',
      paddingBottom: `${keyboardLift > 0 ? keyboardLift : safeBottomPx}px`,
    }}>
      <style>{`@keyframes cp-spin { to { transform: rotate(360deg) } }`}</style>

      <div style={{ flex: '0 0 auto', height: 52, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <button onClick={goBack} aria-label="Back" style={{ background: 'none', border: 'none', color: '#cfcfcf', fontSize: 22, lineHeight: 1, padding: 4, cursor: 'pointer' }}>‹</button>
        <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#00CEC8', color: '#00302e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 500 }}>S</div>
        <div style={{ fontSize: 15 }}>Make with Steve</div>
        {creation && (
          <button onClick={onPublish} disabled={publishing}
            style={{ marginLeft: 'auto', background: publishedPostId ? 'transparent' : '#00CEC8', color: publishedPostId ? '#00CEC8' : '#00302e', border: publishedPostId ? '1px solid rgba(0,206,200,0.5)' : 'none', borderRadius: 10, padding: '8px 14px', fontWeight: 500, fontSize: 13, cursor: 'pointer' }}>
            {publishedPostId ? 'Shared' : publishing ? 'Sharing…' : 'Share'}
          </button>
        )}
      </div>

      <div style={{ flex: '0 0 auto', height: '44%', position: 'relative', background: '#0b0b0b', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        {creation ? (
          <iframe key={`${creation.id}-${rev}`} title="Preview" sandbox="allow-scripts" srcDoc={creation.html}
            style={{ width: '100%', height: '100%', border: 0, display: 'block' }} />
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', color: '#8a8a8a', fontSize: 14 }}>
            Tell Steve what to make — it pops up right here.
          </div>
        )}
        {creation && !loading && (
          <button onClick={() => setPlaying(true)} aria-label="Play full screen"
            style={{ position: 'absolute', bottom: 10, right: 10, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.18)', color: '#fff', borderRadius: 999, padding: '7px 13px', fontSize: 13, cursor: 'pointer' }}>
            <i className="ti ti-player-play" aria-hidden="true" /> Play
          </button>
        )}
        {loading && <BuildingIndicator />}
      </div>

      <div ref={scrollRef} style={{ flex: '1 1 auto', overflowY: 'auto', padding: 14 }}>
        {messages.length === 0 && !creation && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => { setInput(''); build(s) }} disabled={loading}
                style={{ fontSize: 13, color: '#cfcfcf', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 999, padding: '8px 12px', background: 'transparent', cursor: 'pointer' }}>{s}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', margin: '8px 0' }}>
            <div style={{ maxWidth: '82%', padding: '9px 12px', borderRadius: 14, fontSize: 14, lineHeight: 1.45, background: m.role === 'user' ? 'rgba(0,206,200,0.16)' : '#161616', color: m.role === 'user' ? '#bdeeeb' : '#e9e9e9' }}>{m.text}</div>
          </div>
        ))}
      </div>

      {(error || limit) && (
        <div style={{ flex: '0 0 auto', padding: '8px 14px', fontSize: 13, color: limit ? '#ffcf8a' : '#ff9a9a', background: 'rgba(255,255,255,0.03)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {limit ? limit.message : error}
        </div>
      )}

      <div style={{ flex: '0 0 auto', display: 'flex', gap: 8, padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.08)', background: '#000' }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send() }}
          placeholder={creation ? 'What should we tweak?' : 'What should we make?'}
          style={{ flex: 1, background: '#141414', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 999, padding: '11px 14px', color: '#f1f1f1', fontSize: 16, outline: 'none' }} />
        <button onClick={send} disabled={loading || !input.trim()} aria-label="Send"
          style={{ background: loading || !input.trim() ? '#0a4a47' : '#00CEC8', color: '#00302e', border: 'none', borderRadius: 999, width: 44, height: 44, fontSize: 18, fontWeight: 500, cursor: 'pointer', flex: '0 0 auto' }}>↑</button>
      </div>

      {playing && creation && (
        <PlayableCreation html={creation.html} title={creation.title} onClose={() => setPlaying(false)} />
      )}
    </div>
  )
}
