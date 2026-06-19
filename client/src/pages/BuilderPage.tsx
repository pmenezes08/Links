import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useBuilder, type Creation, type BuilderTier } from '../hooks/useBuilder'
import { useFixedComposerKeyboard } from '../hooks/useFixedComposerKeyboard'
import PlayableCreation from '../components/builder/PlayableCreation'
import CreationPreview from '../components/builder/CreationPreview'

const SUGGESTIONS = [
  'A block-stacking game for the group',
  'Quiz: which pizza topping are you?',
  'A spin-the-wheel to pick who buys coffee',
  'A countdown to our next meetup',
]

const STAGES = ["Steve's on it", 'Making it', 'Adding the fun bits', 'Almost there']

type BuildSummary = { id: number; title: string; status: string; plays: number; updated_at: string | null }

// Quality tiers shown as "how hard Steve tries" — never a model name.
const TIERS: { key: BuilderTier; name: string; sub: string; accent: string; level: number }[] = [
  { key: 'fast', name: 'Quick', sub: 'Fast drafts — great for trying an idea.', accent: '#7F77DD', level: 1 },
  { key: 'balanced', name: 'Polished', sub: "Steve's everyday best.", accent: '#00CEC8', level: 2 },
  { key: 'best', name: 'Showpiece', sub: 'Steve goes all out. Slower, most polished.', accent: '#EF9F27', level: 3 },
]

function Meter({ level, accent }: { level: number; accent: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 16 }} aria-hidden>
      {[1, 2, 3].map((n) => (
        <span key={n} style={{ width: 4, height: 4 + n * 4, borderRadius: 1, background: n <= level ? accent : 'rgba(255,255,255,0.15)' }} />
      ))}
    </span>
  )
}

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
  const { creation, messages, loading, error, limit, tier, setTier, build, publish, loadCreation } = useBuilder(cid)
  const [input, setInput] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishedPostId, setPublishedPostId] = useState<number | null>(null)
  const [playingCreation, setPlayingCreation] = useState<Creation | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [tierSheetOpen, setTierSheetOpen] = useState(false)
  const [myBuildsOpen, setMyBuildsOpen] = useState(false)
  const [myBuilds, setMyBuilds] = useState<BuildSummary[] | null>(null)
  const [lastPrompt, setLastPrompt] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const currentTier = TIERS.find((t) => t.key === tier) || TIERS[1]

  // Auto-grow the composer upward as the user types (same pattern as the DM
  // composer) so a long prompt is fully visible.
  const adjustTextareaHeight = () => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'
  }
  useLayoutEffect(() => { adjustTextareaHeight() }, [input])

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight })
  }
  const { keyboardLift, safeBottomPx } = useFixedComposerKeyboard({ onLayoutNudge: scrollToBottom })
  useEffect(scrollToBottom, [messages, loading])

  // Runtime errors now arrive (scoped to the played artifact) via
  // PlayableCreation's onRuntimeError — no global listener, so non-interactive
  // posters can't trigger a false "fix it".

  const send = () => {
    const v = input.trim()
    if (!v || loading) return
    setInput('')
    setLastPrompt(v)
    setPublishedPostId(null)
    setRuntimeError(null)
    build(v)
  }

  const retry = () => {
    if (!lastPrompt || loading) return
    build(lastPrompt) // build() clears error/limit itself
  }

  const fixErrors = () => {
    if (!runtimeError || loading) return
    const msg = runtimeError
    setRuntimeError(null)
    build(`The creation has a problem when it runs: "${msg}". Fix it so it works correctly, and make sure the page never renders blank — keep everything else that already works.`)
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

  const openMyBuilds = async () => {
    setMyBuildsOpen(true)
    setMyBuilds(null)
    try {
      const res = await fetch('/api/builder/mine', { credentials: 'include' })
      const data = await res.json().catch(() => null)
      setMyBuilds(res.ok && data?.success ? (data.creations || []) : [])
    } catch {
      setMyBuilds([])
    }
  }

  const openBuild = async (id: number) => {
    setMyBuildsOpen(false)
    await loadCreation(id)
  }

  const showEmpty = messages.length === 0 && !creation && !loading

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60, background: '#000', color: '#f1f1f1',
      display: 'flex', flexDirection: 'column',
      paddingTop: 'var(--sat-px, 0px)',
      paddingBottom: `${keyboardLift > 0 ? keyboardLift : safeBottomPx}px`,
    }}>
      <style>{`@keyframes cp-spin { to { transform: rotate(360deg) } } @keyframes cp-sheet-up { from { transform: translateY(100%) } to { transform: translateY(0) } }`}</style>

      <div style={{ flex: '0 0 auto', height: 44, display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 0 6px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <button onClick={goBack} aria-label="Back" style={{ background: 'none', border: 'none', color: '#cfcfcf', fontSize: 24, lineHeight: 1, padding: '4px 8px', cursor: 'pointer' }}>‹</button>
        <Avatar />
        <div style={{ fontSize: 15 }}>Steve</div>
        <div style={{ flex: 1 }} />
        <button onClick={openMyBuilds} aria-label="My builds"
          style={{ background: 'none', border: 'none', color: '#cfcfcf', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, padding: '6px 8px', cursor: 'pointer' }}>
          <i className="ti ti-stack-2" aria-hidden /> My builds
        </button>
      </div>

      <div ref={scrollRef} style={{ flex: '1 1 auto', overflowY: 'auto', padding: '16px 16px 8px' }}>
        {showEmpty && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: '14vh' }}>
            <div style={{ fontSize: 15, color: '#9a9a9a' }}>What should we make?</div>
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => build(s)} disabled={loading}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '9px 12px', background: 'transparent', color: '#bdbdbd', fontSize: 13, cursor: 'pointer' }}>
                  <span>{s}</span><span style={{ color: '#555' }}>›</span>
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
        {error && !loading && (
          <div style={{ display: 'flex', gap: 10, margin: '14px 0' }}>
            <Avatar />
            <div style={{ fontSize: 15, lineHeight: 1.5, color: '#e9e9e9' }}>
              Hmm, that one got away from me.{lastPrompt ? ' ' : ''}
              {lastPrompt && (
                <button onClick={retry} style={{ background: 'none', border: 'none', color: '#00CEC8', fontSize: 15, fontWeight: 500, padding: 0, cursor: 'pointer' }}>Try again</button>
              )}
            </div>
          </div>
        )}
        {limit && !loading && <div style={{ display: 'flex', gap: 10, margin: '14px 0' }}><Avatar /><div style={{ fontSize: 15, color: '#ffcf8a' }}>{limit.message}</div></div>}
        {runtimeError && !loading && (
          <div style={{ display: 'flex', gap: 10, margin: '14px 0' }}>
            <Avatar />
            <div style={{ fontSize: 15, lineHeight: 1.5, color: '#e9e9e9' }}>
              I spotted a glitch in that one.{' '}
              <button onClick={fixErrors} style={{ background: 'rgba(0,206,200,0.14)', border: 'none', color: '#00CEC8', fontSize: 14, fontWeight: 500, padding: '4px 10px', borderRadius: 999, cursor: 'pointer' }}>Fix it</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'flex-end', gap: 8, padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.06)', background: '#000' }}>
        <button onClick={() => setTierSheetOpen(true)} disabled={loading} aria-label="Quality"
          style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', borderRadius: 999, padding: '8px 12px', height: 40, fontSize: 12, fontWeight: 500, cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: currentTier.accent }}>
          {currentTier.name}<span style={{ fontSize: 9, opacity: 0.7 }}>▲</span>
        </button>
        <textarea ref={textareaRef} value={input} rows={1}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder={creation ? 'What should we tweak?' : 'Message Steve…'}
          style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 20, padding: '10px 16px', color: '#f1f1f1', fontSize: 16, lineHeight: 1.35, outline: 'none', resize: 'none', maxHeight: 140, overflowY: 'auto', fontFamily: 'inherit' }} />
        <button onClick={send} disabled={loading || !input.trim()} aria-label="Send"
          style={{ flex: '0 0 auto', background: loading || !input.trim() ? 'rgba(255,255,255,0.08)' : '#00CEC8', color: loading || !input.trim() ? '#6e6e6e' : '#00302e', border: 'none', borderRadius: '50%', width: 40, height: 40, fontSize: 18, fontWeight: 500, cursor: 'pointer' }}>↑</button>
      </div>

      {tierSheetOpen && (
        <div onClick={() => setTierSheetOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', background: '#0b0b0b', borderRadius: '20px 20px 0 0', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '8px 14px', paddingBottom: `calc(var(--sab-px, 0px) + ${Math.max(safeBottomPx, 14)}px)`, animation: 'cp-sheet-up 0.25s cubic-bezier(0.32,0.72,0,1)' }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)', margin: '6px auto 12px' }} />
            <div style={{ fontSize: 12, color: '#7a7a7a', padding: '0 6px 6px' }}>How hard should Steve try?</div>
            {TIERS.map((t) => {
              const selected = t.key === tier
              return (
                <button key={t.key} onClick={() => { setTier(t.key); setTierSheetOpen(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', border: 'none', background: selected ? 'rgba(255,255,255,0.05)' : 'transparent', borderRadius: 12, padding: '12px 8px', cursor: 'pointer' }}>
                  <Meter level={t.level} accent={t.accent} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, color: '#f1f1f1' }}>{t.name}</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#8a8a8a', marginTop: 1 }}>{t.sub}</span>
                  </span>
                  {selected && <i className="ti ti-check" style={{ color: t.accent, fontSize: 18 }} aria-hidden />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {myBuildsOpen && (
        <div onClick={() => setMyBuildsOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxHeight: '70%', display: 'flex', flexDirection: 'column', background: '#0b0b0b', borderRadius: '20px 20px 0 0', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '8px 14px', paddingBottom: `calc(var(--sab-px, 0px) + ${Math.max(safeBottomPx, 14)}px)`, animation: 'cp-sheet-up 0.25s cubic-bezier(0.32,0.72,0,1)' }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)', margin: '6px auto 12px' }} />
            <div style={{ fontSize: 12, color: '#7a7a7a', padding: '0 6px 6px' }}>My builds</div>
            <div style={{ overflowY: 'auto', minHeight: 0 }}>
              {myBuilds === null && <div style={{ color: '#8a8a8a', fontSize: 13, padding: '16px 6px' }}>Loading…</div>}
              {myBuilds && myBuilds.length === 0 && <div style={{ color: '#8a8a8a', fontSize: 13, padding: '16px 6px' }}>Nothing here yet — make something and it'll be saved automatically.</div>}
              {myBuilds && myBuilds.map((b) => (
                <button key={b.id} onClick={() => openBuild(b.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: 'none', background: b.id === creation?.id ? 'rgba(0,206,200,0.08)' : 'transparent', borderRadius: 12, padding: '11px 8px', cursor: 'pointer' }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, color: '#f1f1f1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title || 'Untitled'}</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#8a8a8a', marginTop: 1 }}>
                      {b.status === 'published' ? 'Shared' : 'Draft'}{b.plays ? ` · ${b.plays} play${b.plays === 1 ? '' : 's'}` : ''}
                    </span>
                  </span>
                  <i className="ti ti-chevron-right" style={{ color: '#5f5f5f', fontSize: 16 }} aria-hidden />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {playingCreation && (
        <PlayableCreation
          html={playingCreation.html} title={playingCreation.title}
          onClose={() => setPlayingCreation(null)} creationId={playingCreation.id}
          onRuntimeError={(m) => setRuntimeError(m)}
          onShare={playingCreation.id === creation?.id ? onPublish : undefined}
          shared={!!publishedPostId}
        />
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
      style={{ position: 'relative', display: 'block', width: '100%', maxWidth: 320, height: 168, marginTop: 10, borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: '#0b0b0b', overflow: 'hidden', cursor: 'pointer', opacity: isLatest ? 1 : 0.85 }}>
      <CreationPreview html={creation.html} />
      {/* dim so the title/affordances stay legible over the live preview */}
      <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.0) 35%, rgba(0,0,0,0.55) 100%)' }} />
      <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(0,206,200,0.92)', color: '#00302e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 4px 18px rgba(0,0,0,0.45)' }}>
          <i className="ti ti-player-play" aria-hidden="true" />
        </span>
      </span>
      <span style={{ position: 'absolute', left: 12, right: 12, bottom: 10, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{creation.title}</span>
        {isLatest && (
          <span role="button" tabIndex={0}
            onClick={(e) => { e.stopPropagation(); if (!publishedPostId) onShare() }}
            style={{ flex: '0 0 auto', fontSize: 13, fontWeight: 500, color: '#00CEC8', textShadow: '0 1px 4px rgba(0,0,0,0.6)', padding: '2px 2px' }}>
            {publishedPostId ? 'Shared ✓' : publishing ? 'Sharing…' : 'Share'}
          </span>
        )}
      </span>
    </button>
  )
}
