import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { useBuilder, type Creation, type BuilderTier, type BuilderMode, type BuilderAgentMode } from '../hooks/useBuilder'
import { useFixedComposerKeyboard } from '../hooks/useFixedComposerKeyboard'
import { ChatComposerPortal, ChatComposerCard } from '../chat/ChatComposer'
import PlayableCreation from '../components/builder/PlayableCreation'
import BuildResultCard from '../components/builder/BuildResultCard'
import BuildProgressRow from '../components/builder/BuildProgressRow'
import BuilderEmptyState from '../components/builder/BuilderEmptyState'
import BuilderSheet from '../components/builder/BuilderSheet'
import SteveRichText from '../components/builder/SteveRichText'
import SteveAvatar from '../components/steve/SteveAvatar'

/**
 * Build with Steve — a first-class C-Point chat surface.
 *
 * Reuses the chat kernel's PRESENTATIONAL layer only (chat-thread-bg, sent
 * bubbles, ChatComposerPortal/Card, tokens); it is a 1:1 human↔AI console, not
 * a synced DM thread, so the inverted-list/poll kernel does not apply.
 *
 * Sharing/publishing lives on My Builds (/builds) — the in-chat card is
 * play-only, and Steve nudges to My Builds at the play-close peak.
 */

const SUGGESTIONS = [
  'An app to track World Cup scores',
  'A retro Snake game',
  'Chess I can challenge members to',
  'A "which ___ are you?" quiz',
]

// Quality tiers shown as "how hard Steve tries" — never a model name.
const TIERS: { key: BuilderTier; name: string; sub: string; level: number }[] = [
  { key: 'fast', name: 'Quick', sub: 'Fast drafts — great for trying an idea.', level: 1 },
  { key: 'balanced', name: 'Polished', sub: "Steve's everyday best.", level: 2 },
  { key: 'best', name: 'Showpiece', sub: 'Steve goes all out. Slower, most polished.', level: 3 },
]

// Ask vs Agent (Cursor-style): does Steve only discuss, or can he build?
const MODES: { key: BuilderAgentMode; name: string; sub: string; icon: string }[] = [
  { key: 'agent', name: 'Agent', sub: 'Steve builds what you agree on.', icon: 'fa-solid fa-bolt' },
  { key: 'ask', name: 'Ask', sub: "Just chat — Steve won't build anything.", icon: 'fa-regular fa-comment' },
]

// Conversation register (a saved Setting, not a per-build choice).
const STYLES: { key: BuilderMode; name: string; sub: string; icon: string }[] = [
  { key: 'simple', name: 'Simple', sub: 'Plain language, no technical talk.', icon: 'fa-regular fa-message' },
  { key: 'technical', name: 'Technical', sub: 'Steve can get into the how and the trade-offs.', icon: 'fa-solid fa-code' },
]

function Meter({ level }: { level: number }) {
  return (
    <span className="inline-flex h-4 items-end gap-0.5" aria-hidden="true">
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={`w-1 rounded-[1px] ${n <= level ? 'bg-cpoint-turquoise' : 'bg-white/15'}`}
          style={{ height: 4 + n * 4 }}
        />
      ))}
    </span>
  )
}

function SheetRow({
  selected,
  onClick,
  lead,
  name,
  sub,
}: {
  selected: boolean
  onClick: () => void
  lead: React.ReactNode
  name: string
  sub: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex min-h-[44px] w-full items-center gap-3.5 rounded-xl px-2 py-3 text-left transition ${selected ? 'bg-white/5' : 'hover:bg-white/[0.03]'}`}
    >
      <span className="flex w-6 justify-center">{lead}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] text-c-text-primary">{name}</span>
        <span className="mt-px block text-xs text-c-text-secondary">{sub}</span>
      </span>
      {selected && <i className="fa-solid fa-check text-cpoint-turquoise" aria-hidden="true" />}
    </button>
  )
}

export default function BuilderPage() {
  const { community_id } = useParams()
  const navigate = useNavigate()
  const cid = String(community_id || '')
  const {
    creation, messages, loading, building, busy, activeJob, error, limit,
    tier, setTier, mode, setMode, agentMode, setAgentMode, proposal,
    chat, build, confirmBuild, retry, stop, cancelBuild, loadCreation, watchJob,
  } = useBuilder(cid)
  const [input, setInput] = useState('')
  const [playingCreation, setPlayingCreation] = useState<Creation | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Steve's share nudge fires once per build, at the play-close peak.
  const [shareNudgeId, setShareNudgeId] = useState<number | null>(null)
  const nudgedIdsRef = useRef<Set<number>>(new Set())
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const composerRef = useRef<HTMLDivElement | null>(null)
  const [composerH, setComposerH] = useState(88)
  const isWeb = Capacitor.getPlatform() === 'web'

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
  useEffect(scrollToBottom, [messages, loading, building, proposal, shareNudgeId])

  // The composer is portaled + fixed, so the scroller pads for its live height.
  useEffect(() => {
    const el = composerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setComposerH(el.offsetHeight))
    ro.observe(el)
    setComposerH(el.offsetHeight)
    return () => ro.disconnect()
  }, [])

  const send = () => {
    const v = input.trim()
    if (!v || busy) return
    setInput('')
    setRuntimeError(null)
    setShareNudgeId(null)
    chat(v)
  }

  const fixErrors = () => {
    if (!runtimeError || busy) return
    const msg = runtimeError
    setRuntimeError(null)
    build(`The creation has a problem when it runs: "${msg}". Fix it so it works correctly, and make sure the page never renders blank — keep everything else that already works.`)
  }

  const goBack = () => {
    if (cid) navigate(`/community_feed_react/${cid}`)
    else navigate(-1)
  }

  const closePlayer = () => {
    const played = playingCreation
    setPlayingCreation(null)
    // Play-close is the peak moment: nudge to My Builds (the one share path),
    // once per build.
    if (played && creation && played.id === creation.id && !nudgedIdsRef.current.has(played.id)) {
      nudgedIdsRef.current.add(played.id)
      setShareNudgeId(played.id)
    }
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

  const steveRow = (key: string, children: React.ReactNode) => (
    <div key={key} className="my-3.5 flex gap-2.5">
      <SteveAvatar size={22} className="flex-none" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )

  return (
    <div
      className="relative flex flex-col chat-thread-bg text-c-text-primary"
      style={{ height: '100dvh', paddingTop: 'var(--sat-px, 0px)' }}
    >
      <style>{'@keyframes cp-spin { to { transform: rotate(360deg) } } @keyframes cp-typing { 0%,60%,100% { opacity: 0.25; transform: translateY(0) } 30% { opacity: 1; transform: translateY(-3px) } }'}</style>

      <div className="flex h-12 flex-none items-center gap-2.5 border-b border-c-border px-1.5">
        <button
          onClick={goBack}
          aria-label="Back"
          className="flex h-11 w-10 items-center justify-center text-c-text-secondary transition hover:text-c-text-primary"
        >
          <i className="fa-solid fa-chevron-left" aria-hidden="true" />
        </button>
        <SteveAvatar size={26} className="flex-none" />
        <div className="text-[15px] font-semibold text-c-text-primary">
          Steve <span className="font-normal text-c-text-tertiary">· Builder</span>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => navigate('/builds')}
          className="flex min-h-[44px] items-center gap-1.5 px-2 text-sm text-c-text-secondary transition hover:text-c-text-primary"
        >
          <i className="fa-solid fa-layer-group text-xs" aria-hidden="true" /> My builds
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          className="flex h-11 w-10 items-center justify-center text-c-text-secondary transition hover:text-c-text-primary"
        >
          <i className="fa-solid fa-gear" aria-hidden="true" />
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 pt-3"
        style={{ paddingBottom: composerH + keyboardLift + 12 }}
      >
        <div className="mx-auto w-full max-w-3xl">
          {showEmpty && <BuilderEmptyState suggestions={SUGGESTIONS} onPick={chat} disabled={busy} />}

          {messages.map((m, i) => (
            m.role === 'user' ? (
              <div key={i} className="my-3.5 flex justify-end">
                <div className="liquid-glass-bubble liquid-glass-bubble--sent max-w-[82%] rounded-2xl rounded-br-md px-3.5 py-2 text-[14px] leading-relaxed text-c-text-primary md:max-w-[65%]">
                  {m.text}
                </div>
              </div>
            ) : (
              steveRow(String(i), (
                <>
                  <SteveRichText text={m.text} />
                  {m.creation && (
                    <BuildResultCard
                      creation={m.creation}
                      isLatest={!!creation && m.creation.id === creation.id}
                      onPlay={() => setPlayingCreation(m.creation!)}
                      onViewInMyBuilds={() => navigate(`/builds?highlight=${m.creation!.id}`)}
                    />
                  )}
                </>
              ))
            )
          ))}

          {loading && steveRow('typing', (
            <span className="inline-flex gap-1 pt-1.5">
              {[0, 1, 2].map((n) => (
                <span
                  key={n}
                  className="h-1.5 w-1.5 rounded-full bg-c-text-tertiary"
                  style={{ animation: `cp-typing 1.2s ${n * 0.15}s infinite ease-in-out` }}
                />
              ))}
            </span>
          ))}

          {building && <BuildProgressRow job={activeJob} onCancel={() => { void cancelBuild() }} />}

          {proposal && !busy && (
            <div className="my-3.5 flex gap-2.5">
              <span className="w-[22px] flex-none" />
              <button
                onClick={confirmBuild}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-cpoint-turquoise px-5 py-2.5 text-sm font-semibold text-black transition hover:brightness-110"
              >
                <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" /> Build it
              </button>
            </div>
          )}

          {error && !busy && steveRow('error', (
            <div className="text-[14px] leading-relaxed text-c-text-primary">
              {error}{' '}
              <button onClick={retry} className="font-semibold text-cpoint-turquoise">Try again</button>
            </div>
          ))}

          {limit && !busy && steveRow('limit', (
            <div className="text-[14px] leading-relaxed text-amber-300">{limit.message}</div>
          ))}

          {runtimeError && !busy && steveRow('runtime', (
            <div className="text-[14px] leading-relaxed text-c-text-primary">
              I spotted a glitch in that one.{' '}
              <button
                onClick={fixErrors}
                className="inline-flex min-h-[36px] items-center rounded-full bg-cpoint-turquoise/15 px-3 text-sm font-semibold text-cpoint-turquoise"
              >
                Fix it
              </button>
            </div>
          ))}

          {shareNudgeId != null && !busy && steveRow('nudge', (
            <>
              <SteveRichText text={'Want your community playing this? It’s saved in **My Builds** — that’s where you share it to a community or publish it to the web.'} />
              <button
                onClick={() => navigate(`/builds?share=${shareNudgeId}`)}
                className="mt-2 inline-flex min-h-[36px] items-center gap-2 rounded-full bg-cpoint-turquoise/15 px-3.5 text-sm font-semibold text-cpoint-turquoise"
              >
                Share from My Builds
                <i className="fa-solid fa-chevron-right text-[10px]" aria-hidden="true" />
              </button>
            </>
          ))}
        </div>
      </div>

      <ChatComposerPortal composerRef={composerRef} displayKeyboardLift={keyboardLift} isWeb={isWeb}>
        <ChatComposerCard isWeb={isWeb}>
          <div className="flex items-end gap-2">
            <button
              onClick={() => setOptionsOpen(true)}
              aria-label="Mode and quality"
              className={`liquid-glass-chip flex h-10 flex-none items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${agentMode === 'ask' ? 'text-c-text-secondary' : 'text-cpoint-turquoise'}`}
            >
              <i className={`${agentMode === 'ask' ? 'fa-regular fa-comment' : 'fa-solid fa-bolt'} text-sm`} aria-hidden="true" />
              {agentMode === 'ask' ? 'Ask' : 'Agent'}
              <i className="fa-solid fa-chevron-up text-[9px] opacity-70" aria-hidden="true" />
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              rows={1}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder={agentMode === 'ask' ? 'Ask Steve anything…' : (creation ? 'What should we change?' : 'Message Steve…')}
              className="max-h-[140px] min-h-[40px] min-w-0 flex-1 resize-none rounded-[20px] border border-c-border bg-white/5 px-4 py-2.5 text-[16px] leading-snug text-c-text-primary caret-cpoint-turquoise outline-none placeholder:text-c-text-tertiary"
            />
            {busy ? (
              <button
                onClick={stop}
                aria-label="Stop"
                className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-white/10 text-c-text-primary"
              >
                <span className="h-3 w-3 rounded-[3px] bg-current" />
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!input.trim()}
                aria-label="Send"
                className={`flex h-10 w-10 flex-none items-center justify-center rounded-full transition ${input.trim() ? 'bg-cpoint-turquoise text-black' : 'bg-white/10 text-c-text-tertiary'}`}
              >
                <i className="fa-solid fa-arrow-up" aria-hidden="true" />
              </button>
            )}
          </div>
        </ChatComposerCard>
        {keyboardLift <= 0 && <div style={{ height: `${Math.max(safeBottomPx, 0)}px` }} />}
      </ChatComposerPortal>

      {optionsOpen && (
        <BuilderSheet onClose={() => setOptionsOpen(false)} ariaLabel="Mode and quality">
          <div className="px-1.5 pb-1.5 text-xs text-c-text-tertiary">Mode</div>
          {MODES.map((mo) => (
            <SheetRow
              key={mo.key}
              selected={mo.key === agentMode}
              onClick={() => { setAgentMode(mo.key); setOptionsOpen(false) }}
              lead={<i className={`${mo.icon} text-lg ${mo.key === 'ask' ? 'text-c-text-secondary' : 'text-cpoint-turquoise'}`} aria-hidden="true" />}
              name={mo.name}
              sub={mo.sub}
            />
          ))}
          <div className="px-1.5 pb-1.5 pt-3.5 text-xs text-c-text-tertiary">Quality</div>
          {TIERS.map((t) => (
            <SheetRow
              key={t.key}
              selected={t.key === tier}
              onClick={() => { setTier(t.key); setOptionsOpen(false) }}
              lead={<Meter level={t.level} />}
              name={t.name}
              sub={t.sub}
            />
          ))}
        </BuilderSheet>
      )}

      {settingsOpen && (
        <BuilderSheet onClose={() => setSettingsOpen(false)} ariaLabel="Builder settings">
          <div className="px-1.5 pb-0.5 text-[15px] font-semibold text-c-text-primary">Settings</div>
          <div className="px-1.5 pb-1.5 pt-2.5 text-xs text-c-text-tertiary">How Steve talks to you</div>
          {STYLES.map((st) => (
            <SheetRow
              key={st.key}
              selected={st.key === mode}
              onClick={() => setMode(st.key)}
              lead={<i className={`${st.icon} text-lg text-cpoint-turquoise`} aria-hidden="true" />}
              name={st.name}
              sub={st.sub}
            />
          ))}
        </BuilderSheet>
      )}

      {playingCreation && (
        <PlayableCreation
          html={playingCreation.html}
          title={playingCreation.title}
          onClose={closePlayer}
          creationId={playingCreation.id}
          communityId={cid || playingCreation.community_id}
          onRuntimeError={(m) => setRuntimeError(m)}
        />
      )}
    </div>
  )
}
