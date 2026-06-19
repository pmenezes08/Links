import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useBuilder, type Creation } from '../hooks/useBuilder'
import { useFixedComposerKeyboard } from '../hooks/useFixedComposerKeyboard'
import PlayableCreation from '../components/builder/PlayableCreation'

const SUGGESTIONS = [
  'A block-stacking game for the group',
  'Quiz: which pizza topping are you?',
  'A spin-the-wheel to pick who buys coffee',
  'A countdown to our next meetup',
]

const STAGES = ["Steve's on it", 'Making it', 'Adding the fun bits', 'Almost there']

function BuildingRow() {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setSecs((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  const label = secs < 4 ? STAGES[0] : secs < 12 ? STAGES[1] : secs < 25 ? STAGES[2] : STAGES[3]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0' }}>
      <Avatar />
      <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(0,206,200,0.25)', borderTopColor: '#00CEC8', animation: 'cp-spin 0.8s linear infinite' }} />
      <span style={{ fontSize: 13, color: '#8a8a8a' }}>{label} · {secs}s</span>
    </div>
  )
}

function Avatar() {
  return (
    <span style={{ flex: '0 0 auto', width: 22, height: 22, borderRadius: '50%', background: '#00CEC8', color: '#00302e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 500 }}>S</span>
  )
}

export default function BuilderPage() {
  const { community_id } = useParams()
  const navigate = useNavigate()
  const cid = String(community_id || '')
  const { creation, messages, loading, error, limit, tier, setTier, build, publish } = useBuilder(cid)
  const [input, setInput] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishedPostId, setPublishedPostId] = useState<number | null>(null)
  const [playingCreation, setPlayingCreation] = useState<Creation | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight })
  }
  const { keyboardLift, safeBottomPx } = useFixedComposerKeyboard({ onLayoutNudge: scrollToBottom })
  useEffect(scrollToBottom, [messages, loading])

  // The played creation reports runtime errors; offer a one-tap fix.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __cperr?: boolean; message?: string } | null
      if (d && typeof d === 'object' && d.__cperr && typeof d.message === 'string') setRuntimeError(d.message)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const send = () => {
    const v = input.trim()
    if (!v || loading) return
    setInput('')
    setPublishedPostId(null)
    setRuntimeError(null)
    build(v)
  }

  const fixErrors = () => {
    if (!runtimeError || loading) return
    const msg = runtimeError
    setRuntimeError(null)
    build(`Fix this runtime error so the creation works correctly: ${msg}`)
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

  const showEmpty = messages.length === 0 && !creation && !loading

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60, background: '#000', color: '#f1f1f1',
      display: 'flex', flexDirection: 'column',
      paddingTop: 'var(--sat-px, 0px)',
      paddingBottom: `${keyboardLift > 0 ? keyboardLift : safeBottomPx}px`,
    }}>
      <style>{`@keyframes cp-spin { to { transform: rotate(360deg) } }`}</style>

      <div style={{ flex: '0 0 auto', height: 44, display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 0 6px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <button onClick={goBack} aria-label="Back" style={{ background: 'none', border: 'none', color: '#cfcfcf', fontSize: 24, lineHeight: 1, padding: '4px 8px', cursor: 'pointer' }}>‹</button>
        <Avatar />
        <div style={{ fontSize: 15 }}>Steve</div>
      </div>

      <div ref={scrollRef} style={{ flex: '1 1 auto', overflowY: 'auto', padding: '16px 16px 8px' }}>
        {showEmpty && (
          <div style={{ minHeight: '60%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
            <span style={{ width: 40, height: 40, borderRadius: '50%', background: '#00CEC8', color: '#00302e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 500 }}>S</span>
            <div style={{ fontSize: 20, color: '#f1f1f1' }}>What should we make?</div>
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => build(s)} disabled={loading}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: '12px 14px', background: 'transparent', color: '#cfcfcf', fontSize: 14, cursor: 'pointer' }}>
                  <span>{s}</span><span style={{ color: '#5f5f5f' }}>›</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          m.role === 'user' ? (
            <div key={i} style={{ display: 'flex', justifyContent: 'flex-end', margin: '14px 0' }}>
              <div style={{ maxWidth: '82%', padding: '10px 14px', borderRadius: 18, fontSize: 15, lineHeight: 1.45, background: 'rgba(255,255,255,0.06)', color: '#f1f1f1' }}>{m.text}</div>
            </div>
          ) : (
            <div key={i} style={{ display: 'flex', gap: 10, margin: '14px 0' }}>
              <Avatar />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, lineHeight: 1.5, color: '#e9e9e9' }}>{m.text}</div>
                {m.creation && (
                  <CreationCard creation={m.creation} isLatest={!!creation && m.creation.id === creation.id}
                    onOpen={() => setPlayingCreation(m.creation!)}
                    publishing={publishing} publishedPostId={publishedPostId} onShare={onPublish} />
                )}
              </div>
            </div>
          )
        ))}

        {loading && <BuildingRow />}
        {error && !loading && <div style={{ display: 'flex', gap: 10, margin: '14px 0' }}><Avatar /><div style={{ fontSize: 15, color: '#ff9a9a' }}>{error}</div></div>}
        {limit && !loading && <div style={{ display: 'flex', gap: 10, margin: '14px 0' }}><Avatar /><div style={{ fontSize: 15, color: '#ffcf8a' }}>{limit.message}</div></div>}
        {runtimeError && !loading && (
          <div style={{ display: 'flex', gap: 10, margin: '14px 0' }}>
            <Avatar />
            <div style={{ fontSize: 15, color: '#e9e9e9' }}>
              That build hit an error.{' '}
              <button onClick={fixErrors} style={{ background: 'none', border: 'none', color: '#00CEC8', fontSize: 15, padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>Have Steve fix it</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.06)', background: '#000' }}>
        <button onClick={() => setTier(tier === 'fast' ? 'best' : 'fast')} disabled={loading} aria-label="Quality"
          style={{ flex: '0 0 auto', border: 'none', borderRadius: 999, padding: '8px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: tier === 'best' ? '#00CEC8' : '#cfcfcf' }}>
          {tier === 'best' ? 'Best' : 'Fast'}
        </button>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send() }}
          placeholder={creation ? 'What should we tweak?' : 'Message Steve…'}
          style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 22, padding: '12px 16px', color: '#f1f1f1', fontSize: 16, outline: 'none' }} />
        <button onClick={send} disabled={loading || !input.trim()} aria-label="Send"
          style={{ flex: '0 0 auto', background: loading || !input.trim() ? 'rgba(255,255,255,0.08)' : '#00CEC8', color: loading || !input.trim() ? '#6e6e6e' : '#00302e', border: 'none', borderRadius: '50%', width: 40, height: 40, fontSize: 18, fontWeight: 500, cursor: 'pointer' }}>↑</button>
      </div>

      {playingCreation && (
        <PlayableCreation html={playingCreation.html} title={playingCreation.title} onClose={() => setPlayingCreation(null)} />
      )}
    </div>
  )
}

function CreationCard({ creation, isLatest, onOpen, publishing, publishedPostId, onShare }: {
  creation: Creation
  isLatest: boolean
  onOpen: () => void
  publishing: boolean
  publishedPostId: number | null
  onShare: () => void
}) {
  return (
    <button onClick={onOpen}
      style={{ position: 'relative', display: 'block', width: '100%', maxWidth: 320, height: 132, marginTop: 10, borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: '#0b0b0b', overflow: 'hidden', cursor: 'pointer', opacity: isLatest ? 1 : 0.85 }}>
      <span style={{ position: 'absolute', left: 12, top: 12, display: 'flex', gap: 5 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: '#00CEC8' }} />
        <span style={{ width: 10, height: 10, borderRadius: 3, background: '#EF9F27' }} />
        <span style={{ width: 10, height: 10, borderRadius: 3, background: '#7F77DD' }} />
      </span>
      <span style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <span style={{ width: 44, height: 44, borderRadius: '50%', background: '#00CEC8', color: '#00302e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
          <i className="ti ti-player-play" aria-hidden="true" />
        </span>
        <span style={{ fontSize: 14, color: '#e9e9e9', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{creation.title}</span>
      </span>
      <span style={{ position: 'absolute', left: 12, bottom: 10, fontSize: 11, color: '#6e6e6e' }}>Tap to play</span>
      {isLatest && (
        <span role="button" tabIndex={0}
          onClick={(e) => { e.stopPropagation(); if (!publishedPostId) onShare() }}
          style={{ position: 'absolute', right: 12, bottom: 8, fontSize: 13, fontWeight: 500, color: '#00CEC8', padding: '4px 6px' }}>
          {publishedPostId ? 'Shared ✓' : publishing ? 'Sharing…' : 'Share'}
        </span>
      )}
    </button>
  )
}
