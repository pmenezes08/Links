import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useBuilder, type Creation, type BuilderTier, type BuilderMode, type BuilderAgentMode } from '../hooks/useBuilder'
import { useFixedComposerKeyboard } from '../hooks/useFixedComposerKeyboard'
import PlayableCreation from '../components/builder/PlayableCreation'
import CreationPreview from '../components/builder/CreationPreview'

const SUGGESTIONS = [
  'An app to track World Cup scores',
  'A retro Snake game',
  'An app to share city recommendations',
  'A "which ___ are you?" quiz',
]

const STAGES = ["Steve's on it", 'Making it', 'Adding the fun bits', 'Almost there']

type BuildSummary = {
  id: number
  title: string
  kind?: string | null
  status: string
  plays: number
  updated_at: string | null
  public_status?: string | null
  public_url?: string | null
  public_kind?: string | null
}

// Quality tiers shown as "how hard Steve tries" — never a model name.
const TIERS: { key: BuilderTier; name: string; sub: string; accent: string; level: number }[] = [
  { key: 'fast', name: 'Quick', sub: 'Fast drafts — great for trying an idea.', accent: '#7F77DD', level: 1 },
  { key: 'balanced', name: 'Polished', sub: "Steve's everyday best.", accent: '#00CEC8', level: 2 },
  { key: 'best', name: 'Showpiece', sub: 'Steve goes all out. Slower, most polished.', accent: '#EF9F27', level: 3 },
]

// Ask vs Agent (Cursor-style): does Steve only discuss, or can he build?
const MODES: { key: BuilderAgentMode; name: string; sub: string; icon: string; accent: string }[] = [
  { key: 'agent', name: 'Agent', sub: 'Steve builds what you agree on.', icon: 'ti-bolt', accent: '#00CEC8' },
  { key: 'ask', name: 'Ask', sub: "Just chat — Steve won't build anything.", icon: 'ti-message-circle', accent: '#7F77DD' },
]

// Conversation register (a saved Setting, not a per-build choice).
const STYLES: { key: BuilderMode; name: string; sub: string; icon: string }[] = [
  { key: 'simple', name: 'Simple', sub: 'Plain language, no technical talk.', icon: 'ti-message-2' },
  { key: 'technical', name: 'Technical', sub: 'Steve can get into the how and the trade-offs.', icon: 'ti-code' },
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

function TypingRow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0' }}>
      <Avatar />
      <span style={{ display: 'inline-flex', gap: 4 }}>
        {[0, 1, 2].map((n) => (
          <span key={n} style={{ width: 6, height: 6, borderRadius: '50%', background: '#8a8a8a', animation: `cp-typing 1.2s ${n * 0.15}s infinite ease-in-out` }} />
        ))}
      </span>
    </div>
  )
}

function publicEligible(kind?: string | null, publicKind?: string | null): boolean {
  const k = String(publicKind || kind || 'web').toLowerCase()
  return ['web', 'website', 'site', 'landing', 'app', 'tool', 'application', 'quiz', 'dashboard', 'tracker'].includes(k)
}

// Minimal, injection-safe markdown for Steve's replies: builds React nodes
// (never sets innerHTML), supporting **bold**, *italic*, `code`, bullet and
// numbered lists, and paragraph breaks.
function renderInline(text: string, kp: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*|_([^_]+)_)/g
  let last = 0, m: RegExpExecArray | null, i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[2] !== undefined) out.push(<strong key={`${kp}-${i}`}>{m[2]}</strong>)
    else if (m[3] !== undefined) out.push(<code key={`${kp}-${i}`} style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 4, padding: '1px 5px', fontSize: 13 }}>{m[3]}</code>)
    else out.push(<em key={`${kp}-${i}`}>{m[4] ?? m[5]}</em>)
    last = m.index + m[0].length; i++
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function SteveText({ text }: { text: string }) {
  const lines = (text || '').split('\n')
  const blocks: React.ReactNode[] = []
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const L = list, k = `l${blocks.length}`
    const lis = L.items.map((it, j) => <li key={j} style={{ margin: '2px 0' }}>{renderInline(it, `${k}-${j}`)}</li>)
    blocks.push(L.type === 'ul'
      ? <ul key={k} style={{ margin: '4px 0', paddingLeft: 18 }}>{lis}</ul>
      : <ol key={k} style={{ margin: '4px 0', paddingLeft: 20 }}>{lis}</ol>)
    list = null
  }
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\s+$/, '')
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    const num = line.match(/^\s*\d+\.\s+(.*)$/)
    if (bullet) {
      if (!list || list.type !== 'ul') { flush(); list = { type: 'ul', items: [] } }
      list.items.push(bullet[1])
    } else if (num) {
      if (!list || list.type !== 'ol') { flush(); list = { type: 'ol', items: [] } }
      list.items.push(num[1])
    } else {
      flush()
      if (line.trim() === '') blocks.push(<div key={`b${idx}`} style={{ height: 6 }} />)
      else blocks.push(<div key={`b${idx}`}>{renderInline(line, `p${idx}`)}</div>)
    }
  })
  flush()
  return <div style={{ fontSize: 15, lineHeight: 1.5, color: '#e9e9e9' }}>{blocks}</div>
}

export default function BuilderPage() {
  const { community_id } = useParams()
  const navigate = useNavigate()
  const cid = String(community_id || '')
  const {
    creation, messages, loading, building, busy, activeJob, error, limit,
    tier, setTier, mode, setMode, agentMode, setAgentMode, proposal,
    chat, build, confirmBuild, retry, stop, publish, publishWeb, unpublishWeb, loadCreation, watchJob,
  } = useBuilder(cid)
  const [input, setInput] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [webPublishing, setWebPublishing] = useState(false)
  const [galleryWorking, setGalleryWorking] = useState(false)
  const [webCopied, setWebCopied] = useState(false)
  const [publishedPostId, setPublishedPostId] = useState<number | null>(null)
  const [playingCreation, setPlayingCreation] = useState<Creation | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [myBuildsOpen, setMyBuildsOpen] = useState(false)
  const [myBuilds, setMyBuilds] = useState<BuildSummary[] | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

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
  useEffect(scrollToBottom, [messages, loading, building, proposal])

  // Runtime errors arrive scoped to the played artifact via PlayableCreation's
  // onRuntimeError — no global listener, so non-interactive posters can't fire
  // a false "fix it". The default composer action is now CHAT (talk to Steve);
  // building happens only when the user confirms Steve's proposal.

  const send = () => {
    const v = input.trim()
    if (!v || busy) return
    setInput('')
    setPublishedPostId(null)
    setRuntimeError(null)
    chat(v)
  }

  const fixErrors = () => {
    if (!runtimeError || busy) return
    const msg = runtimeError
    setRuntimeError(null)
    build(`The creation has a problem when it runs: "${msg}". Fix it so it works correctly, and make sure the page never renders blank — keep everything else that already works.`)
  }

  const onPublish = async () => {
    if (!creation || publishing) return
    let targetCommunityId: number | undefined
    if (!cid) {
      const raw = window.prompt('Enter the community ID where you want to share this creation. You must be a member of that community.')
      const parsed = Number(raw || 0)
      if (!Number.isFinite(parsed) || parsed <= 0) return
      targetCommunityId = parsed
    }
    setPublishing(true)
    const postId = await publish(undefined, targetCommunityId)
    setPublishing(false)
    if (postId) setPublishedPostId(postId)
  }

  const copyPublicUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setWebCopied(true)
      window.setTimeout(() => setWebCopied(false), 1800)
    } catch {
      window.prompt('Copy this public link', url)
    }
  }

  const onPublishWeb = async () => {
    if (!creation || webPublishing) return
    setWebPublishing(true)
    const url = await publishWeb()
    setWebPublishing(false)
    if (url) await copyPublicUrl(url)
  }

  const onUnpublishWeb = async () => {
    if (!creation || webPublishing) return
    const ok = window.confirm('Unpublish this public web link? The build will still stay inside C-Point.')
    if (!ok) return
    setWebPublishing(true)
    await unpublishWeb()
    setWebPublishing(false)
  }

  const onGallery = async (action: 'request' | 'unlist') => {
    if (!creation || galleryWorking) return
    if (action === 'request') {
      const ok = window.confirm('Allow this creation to appear in Explore Creations inside C-Point. Your name, profile, and community will not be shown.')
      if (!ok) return
    }
    setGalleryWorking(true)
    try {
      const res = await fetch(`/api/builder/${creation.id}/gallery`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        window.alert('Could not update Explore listing. Please try again.')
        return
      }
      await loadCreation(creation.id)
    } catch {
      window.alert('Could not update Explore listing. Please check your connection and try again.')
    } finally {
      setGalleryWorking(false)
    }
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

  // Push/in-app notifications deep-link here after Steve finishes a build.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search || '')
    const creationId = Number(params.get('creation_id') || 0)
    const jobId = Number(params.get('job_id') || 0)
    if (creationId > 0) {
      loadCreation(creationId)
    } else if (jobId > 0) {
      watchJob(jobId)
    }
  }, [loadCreation, watchJob])

  const showEmpty = messages.length === 0 && !creation && !busy

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60, background: '#000', color: '#f1f1f1',
      display: 'flex', flexDirection: 'column',
      paddingTop: 'var(--sat-px, 0px)',
      paddingBottom: `${keyboardLift > 0 ? keyboardLift : safeBottomPx}px`,
    }}>
      <style>{`@keyframes cp-spin { to { transform: rotate(360deg) } } @keyframes cp-sheet-up { from { transform: translateY(100%) } to { transform: translateY(0) } } @keyframes cp-typing { 0%,60%,100% { opacity: 0.25; transform: translateY(0) } 30% { opacity: 1; transform: translateY(-3px) } } .cp-builder-composer::placeholder { color: rgba(241,241,241,0.58); opacity: 1; }`}</style>

      <div style={{ flex: '0 0 auto', height: 44, display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 0 6px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <button onClick={goBack} aria-label="Back" style={{ background: 'none', border: 'none', color: '#cfcfcf', fontSize: 24, lineHeight: 1, padding: '4px 8px', cursor: 'pointer' }}>‹</button>
        <Avatar />
        <div style={{ fontSize: 15 }}>Steve</div>
        <div style={{ flex: 1 }} />
        <button onClick={openMyBuilds} aria-label="My builds"
          style={{ background: 'none', border: 'none', color: '#cfcfcf', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, padding: '6px 8px', cursor: 'pointer' }}>
          <i className="ti ti-stack-2" aria-hidden /> My builds
        </button>
        <button onClick={() => setSettingsOpen(true)} aria-label="Settings"
          style={{ background: 'none', border: 'none', color: '#cfcfcf', fontSize: 18, padding: '6px 8px', cursor: 'pointer' }}>
          <i className="ti ti-settings" aria-hidden />
        </button>
      </div>

      <div ref={scrollRef} style={{ flex: '1 1 auto', overflowY: 'auto', padding: '16px 16px 8px' }}>
        {showEmpty && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
            <div>
              <div style={{ fontSize: 19, fontWeight: 600, color: '#f1f1f1' }}>Build with Steve</div>
              <div style={{ fontSize: 14, lineHeight: 1.45, color: '#9a9a9a', marginTop: 4 }}>
                Websites, apps, games — interactive, with leaderboards and scores — built to share with your community.
              </div>
            </div>
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => chat(s)} disabled={busy}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '8px 12px', background: 'transparent', color: '#bdbdbd', fontSize: 13, cursor: 'pointer' }}>
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
                <SteveText text={m.text} />
                {m.creation && (
                  <CreationCard creation={m.creation} isLatest={!!creation && m.creation.id === creation.id}
                    onOpen={() => setPlayingCreation(m.creation!)}
                    publishing={publishing} publishedPostId={publishedPostId} onShare={onPublish}
                    webPublishing={webPublishing} webCopied={webCopied}
                    onPublishWeb={onPublishWeb} onCopyPublicUrl={copyPublicUrl}
                    onUnpublishWeb={onUnpublishWeb}
                    galleryWorking={galleryWorking}
                    onGallery={onGallery} />
                )}
              </div>
            </div>
          )
        ))}

        {loading && <TypingRow />}
        {building && (
          <>
            <BuildingRow />
            <div style={{ display: 'flex', gap: 10, margin: '2px 0 14px' }}>
              <span style={{ width: 22, flex: '0 0 auto' }} />
              <div style={{ fontSize: 13, lineHeight: 1.45, color: '#8a8a8a' }}>
                Steve is building on the server. You can leave this screen, lock your phone, or use other apps — you'll get a notification when it's ready to test.
                {activeJob?.id ? <span style={{ display: 'block', marginTop: 3 }}>Build #{activeJob.id} · {activeJob.status}</span> : null}
              </div>
            </div>
          </>
        )}

        {proposal && !busy && (
          <div style={{ display: 'flex', gap: 10, margin: '8px 0 14px' }}>
            <span style={{ width: 22, flex: '0 0 auto' }} />
            <button onClick={confirmBuild}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#00CEC8', color: '#00302e', border: 'none', borderRadius: 999, padding: '10px 18px', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
              <i className="ti ti-sparkles" aria-hidden /> Build it
            </button>
          </div>
        )}

        {error && !busy && (
          <div style={{ display: 'flex', gap: 10, margin: '14px 0' }}>
            <Avatar />
            <div style={{ fontSize: 15, lineHeight: 1.5, color: '#e9e9e9' }}>
              {error}{' '}
              <button onClick={retry} style={{ background: 'none', border: 'none', color: '#00CEC8', fontSize: 15, fontWeight: 500, padding: 0, cursor: 'pointer' }}>Try again</button>
            </div>
          </div>
        )}
        {limit && !busy && <div style={{ display: 'flex', gap: 10, margin: '14px 0' }}><Avatar /><div style={{ fontSize: 15, color: '#ffcf8a' }}>{limit.message}</div></div>}
        {runtimeError && !busy && (
          <div style={{ display: 'flex', gap: 10, margin: '14px 0' }}>
            <Avatar />
            <div style={{ fontSize: 15, lineHeight: 1.5, color: '#e9e9e9' }}>
              I spotted a glitch in that one.{' '}
              <button onClick={fixErrors} style={{ background: 'rgba(0,206,200,0.14)', border: 'none', color: '#00CEC8', fontSize: 14, fontWeight: 500, padding: '4px 10px', borderRadius: 999, cursor: 'pointer' }}>Fix it</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'flex-end', gap: 8, padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.08)', background: '#050505', boxShadow: '0 -10px 24px rgba(0,0,0,0.45)' }}>
        <button onClick={() => setOptionsOpen(true)} aria-label="Mode and quality"
          style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', borderRadius: 999, padding: '8px 12px', height: 40, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: agentMode === 'ask' ? '#7F77DD' : '#00CEC8' }}>
          <i className={`ti ${agentMode === 'ask' ? 'ti-message-circle' : 'ti-bolt'}`} style={{ fontSize: 14 }} aria-hidden />
          {agentMode === 'ask' ? 'Ask' : 'Agent'}<span style={{ fontSize: 9, opacity: 0.7 }}>▲</span>
        </button>
        <textarea ref={textareaRef} value={input} rows={1}
          className="cp-builder-composer"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder={agentMode === 'ask' ? 'Ask Steve anything…' : (creation ? 'What should we change?' : 'Message Steve…')}
          style={{ flex: 1, minWidth: 0, minHeight: 40, background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 20, padding: '10px 16px', color: '#f1f1f1', caretColor: '#00CEC8', fontSize: 16, lineHeight: 1.35, outline: 'none', resize: 'none', maxHeight: 140, overflowY: 'auto', fontFamily: 'inherit', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' }} />
        {busy ? (
          <button onClick={stop} aria-label="Stop"
            style={{ flex: '0 0 auto', background: 'rgba(255,255,255,0.10)', color: '#f1f1f1', border: 'none', borderRadius: '50%', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: '#f1f1f1' }} />
          </button>
        ) : (
          <button onClick={send} disabled={!input.trim()} aria-label="Send"
            style={{ flex: '0 0 auto', background: !input.trim() ? 'rgba(255,255,255,0.08)' : '#00CEC8', color: !input.trim() ? '#6e6e6e' : '#00302e', border: 'none', borderRadius: '50%', width: 40, height: 40, fontSize: 18, fontWeight: 500, cursor: 'pointer' }}>↑</button>
        )}
      </div>

      {optionsOpen && (
        <div onClick={() => setOptionsOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', background: '#0b0b0b', borderRadius: '20px 20px 0 0', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '8px 14px', paddingBottom: `calc(var(--sab-px, 0px) + ${Math.max(safeBottomPx, 14)}px)`, animation: 'cp-sheet-up 0.25s cubic-bezier(0.32,0.72,0,1)' }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)', margin: '6px auto 12px' }} />

            <div style={{ fontSize: 12, color: '#7a7a7a', padding: '0 6px 6px' }}>Mode</div>
            {MODES.map((mo) => {
              const selected = mo.key === agentMode
              return (
                <button key={mo.key} onClick={() => { setAgentMode(mo.key); setOptionsOpen(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', border: 'none', background: selected ? 'rgba(255,255,255,0.05)' : 'transparent', borderRadius: 12, padding: '12px 8px', cursor: 'pointer' }}>
                  <i className={`ti ${mo.icon}`} style={{ fontSize: 18, color: mo.accent, width: 22, textAlign: 'center' }} aria-hidden />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, color: '#f1f1f1' }}>{mo.name}</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#8a8a8a', marginTop: 1 }}>{mo.sub}</span>
                  </span>
                  {selected && <i className="ti ti-check" style={{ color: mo.accent, fontSize: 18 }} aria-hidden />}
                </button>
              )
            })}

            <div style={{ fontSize: 12, color: '#7a7a7a', padding: '14px 6px 6px' }}>Quality</div>
            {TIERS.map((t) => {
              const selected = t.key === tier
              return (
                <button key={t.key} onClick={() => { setTier(t.key); setOptionsOpen(false) }}
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

      {settingsOpen && (
        <div onClick={() => setSettingsOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', background: '#0b0b0b', borderRadius: '20px 20px 0 0', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '8px 14px', paddingBottom: `calc(var(--sab-px, 0px) + ${Math.max(safeBottomPx, 14)}px)`, animation: 'cp-sheet-up 0.25s cubic-bezier(0.32,0.72,0,1)' }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)', margin: '6px auto 12px' }} />
            <div style={{ fontSize: 15, color: '#f1f1f1', fontWeight: 500, padding: '0 6px 2px' }}>Settings</div>
            <div style={{ fontSize: 12, color: '#7a7a7a', padding: '10px 6px 6px' }}>How Steve talks to you</div>
            {STYLES.map((st) => {
              const selected = st.key === mode
              return (
                <button key={st.key} onClick={() => setMode(st.key)}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', border: 'none', background: selected ? 'rgba(255,255,255,0.05)' : 'transparent', borderRadius: 12, padding: '12px 8px', cursor: 'pointer' }}>
                  <i className={`ti ${st.icon}`} style={{ fontSize: 18, color: '#00CEC8', width: 22, textAlign: 'center' }} aria-hidden />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, color: '#f1f1f1' }}>{st.name}</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#8a8a8a', marginTop: 1 }}>{st.sub}</span>
                  </span>
                  {selected && <i className="ti ti-check" style={{ color: '#00CEC8', fontSize: 18 }} aria-hidden />}
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
          communityId={cid || playingCreation.community_id}
          onRuntimeError={(m) => setRuntimeError(m)}
          onShare={playingCreation.id === creation?.id ? onPublish : undefined}
          shared={!!publishedPostId}
        />
      )}
    </div>
  )
}

function CreationCard({
  creation,
  isLatest,
  onOpen,
  publishing,
  publishedPostId,
  onShare,
  webPublishing,
  webCopied,
  onPublishWeb,
  onCopyPublicUrl,
  onUnpublishWeb,
  galleryWorking,
  onGallery,
}: {
  creation: Creation
  isLatest: boolean
  onOpen: () => void
  publishing: boolean
  publishedPostId: number | null
  onShare: () => void
  webPublishing: boolean
  webCopied: boolean
  onPublishWeb: () => void
  onCopyPublicUrl: (url: string) => Promise<void>
  onUnpublishWeb: () => void
  galleryWorking: boolean
  onGallery: (action: 'request' | 'unlist') => void
}) {
  const isPublic = creation.public_status === 'published' && !!creation.public_url
  const eligible = publicEligible(creation.kind, creation.public_kind)
  return (
    <button onClick={onOpen}
      style={{ position: 'relative', display: 'block', width: '100%', maxWidth: 340, height: 196, marginTop: 10, borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: '#0b0b0b', overflow: 'hidden', cursor: 'pointer', opacity: isLatest ? 1 : 0.85 }}>
      <CreationPreview html={creation.html} />
      {/* dim so the title/affordances stay legible over the live preview */}
      <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.0) 35%, rgba(0,0,0,0.55) 100%)' }} />
      <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(0,206,200,0.92)', color: '#00302e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 4px 18px rgba(0,0,0,0.45)' }}>
          <i className="ti ti-player-play" aria-hidden="true" />
        </span>
      </span>
      <span style={{ position: 'absolute', left: 12, right: 12, bottom: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{creation.title}</span>
        {isLatest && (
          <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span role="button" tabIndex={0}
              onClick={(e) => { e.stopPropagation(); if (!publishedPostId) onShare() }}
              style={{ flex: '0 0 auto', fontSize: 12, fontWeight: 700, color: '#00CEC8', textShadow: '0 1px 4px rgba(0,0,0,0.6)', padding: '4px 7px', borderRadius: 999, background: 'rgba(0,0,0,0.42)' }}>
              {publishedPostId ? 'Shared ✓' : publishing ? 'Sharing…' : 'Share to community'}
            </span>
            {eligible ? (
              isPublic ? (
                <>
                  <span role="button" tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); void onCopyPublicUrl(creation.public_url!) }}
                    style={{ flex: '0 0 auto', fontSize: 12, fontWeight: 700, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.6)', padding: '4px 7px', borderRadius: 999, background: 'rgba(0,206,200,0.22)' }}>
                    {webCopied ? 'Copied ✓' : 'Copy public link'}
                  </span>
                  <span role="button" tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); onUnpublishWeb() }}
                    style={{ flex: '0 0 auto', fontSize: 12, fontWeight: 600, color: '#ffcf8a', textShadow: '0 1px 4px rgba(0,0,0,0.6)', padding: '4px 7px', borderRadius: 999, background: 'rgba(0,0,0,0.42)' }}>
                    {webPublishing ? 'Working…' : 'Unpublish'}
                  </span>
                </>
              ) : (
                <span role="button" tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onPublishWeb() }}
                  style={{ flex: '0 0 auto', fontSize: 12, fontWeight: 700, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.6)', padding: '4px 7px', borderRadius: 999, background: 'rgba(0,206,200,0.22)' }}>
                  {webPublishing ? 'Publishing…' : 'Publish web'}
                </span>
              )
            ) : (
              <span style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 600, color: '#b9b9b9', textShadow: '0 1px 4px rgba(0,0,0,0.6)', padding: '4px 7px', borderRadius: 999, background: 'rgba(0,0,0,0.42)' }}>
                Games stay in C-Point
              </span>
            )}
            {creation.gallery_status === 'pending' || creation.gallery_status === 'approved' ? (
              <span role="button" tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onGallery('unlist') }}
                style={{ flex: '0 0 auto', fontSize: 12, fontWeight: 600, color: '#d8d8d8', textShadow: '0 1px 4px rgba(0,0,0,0.6)', padding: '4px 7px', borderRadius: 999, background: 'rgba(0,0,0,0.42)' }}>
                {galleryWorking ? 'Working…' : 'Remove from Explore'}
              </span>
            ) : (
              <span role="button" tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onGallery('request') }}
                style={{ flex: '0 0 auto', fontSize: 12, fontWeight: 700, color: '#00CEC8', textShadow: '0 1px 4px rgba(0,0,0,0.6)', padding: '4px 7px', borderRadius: 999, background: 'rgba(0,0,0,0.42)' }}>
                {galleryWorking ? 'Working…' : 'List in Explore'}
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  )
}
