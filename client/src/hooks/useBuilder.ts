import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

function persisted<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    if (v && (allowed as readonly string[]).includes(v)) return v as T
  } catch { /* ignore */ }
  return fallback
}

export type Creation = {
  id: number
  title: string
  html: string
  status: string
  community_id?: number | null
  kind?: string | null
  public_slug?: string | null
  public_status?: string | null
  public_url?: string | null
  public_published_at?: string | null
  public_kind?: string | null
  gallery_status?: string | null
  gallery_requested_at?: string | null
  gallery_reviewed_at?: string | null
  gallery_rejection_reason?: string | null
}
export type BuilderTier = 'fast' | 'balanced' | 'best'
export type BuilderMode = 'simple' | 'technical'
export type BuilderAgentMode = 'ask' | 'agent'
export type BuilderMessage = { role: 'user' | 'steve'; text: string; creation?: Creation }
export type BuilderLimit = { cap: number | null; message: string }
export type BuilderJob = {
  id: number
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  kind?: 'create' | 'iterate'
  community_id?: number
  creation_id?: number | null
  result_creation_id?: number | null
  error?: string | null
  /** Honest worker checkpoints, 0-100. */
  progress?: number
  /** Stage key ('research' | 'coding' | 'testing' | …) mapped to copy client-side. */
  progress_stage?: string | null
}

type PublicPublishResult = {
  public_slug?: string | null
  public_status?: string | null
  public_url?: string | null
  public_published_at?: string | null
  public_kind?: string | null
}
type ApiResult = {
  success?: boolean
  error?: string
  creation?: Creation
  cap?: number | null
  message?: string
  post_id?: number
  queued?: boolean
  job?: BuilderJob
} & PublicPublishResult
type ChatResult = { success?: boolean; error?: string; reply?: string; ready?: boolean; brief?: string }

/**
 * Drives the Steve Builder as a CONVERSATION: the user talks with Steve, who
 * reasons, ideates, is honest about limits, and proposes a concrete plan —
 * then builds only on the user's confirmation. Builds/chats are abortable so
 * the user can stop and add input. Front-end-only artifacts; the HTML is
 * rendered by the caller in a sandboxed iframe.
 */
export function useBuilder(communityId: string) {
  const [creation, setCreation] = useState<Creation | null>(null)
  const [messages, setMessages] = useState<BuilderMessage[]>([])
  const [loading, setLoading] = useState(false)   // a chat turn is in flight
  const [building, setBuilding] = useState(false)  // an artifact is being generated
  const [activeJob, setActiveJob] = useState<BuilderJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState<BuilderLimit | null>(null)
  const [rev, setRev] = useState(0)
  // Persisted preferences (settings that should stick across sessions).
  // Quality tier — users see Quick / Polished / Showpiece, never the model.
  const [tier, setTier] = useState<BuilderTier>(() => persisted('cp_builder_tier', ['fast', 'balanced', 'best'], 'balanced'))
  // How Steve talks: 'simple' (non-technical, no jargon) or 'technical'.
  const [mode, setMode] = useState<BuilderMode>(() => persisted('cp_builder_mode', ['simple', 'technical'], 'simple'))
  // Ask (Steve discusses only) vs Agent (Steve can build), Cursor-style.
  const [agentMode, setAgentMode] = useState<BuilderAgentMode>(() => persisted('cp_builder_agent', ['ask', 'agent'], 'agent'))
  useEffect(() => { try { localStorage.setItem('cp_builder_tier', tier) } catch { /* ignore */ } }, [tier])
  useEffect(() => { try { localStorage.setItem('cp_builder_mode', mode) } catch { /* ignore */ } }, [mode])
  useEffect(() => { try { localStorage.setItem('cp_builder_agent', agentMode) } catch { /* ignore */ } }, [agentMode])
  // Set when Steve has proposed a plan and is asking to start building.
  const [proposal, setProposal] = useState<{ brief: string } | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const lastBriefRef = useRef<string>('')
  const activeJobKey = `cp_builder_active_job:${communityId}`
  const communityPayload = useMemo(() => (communityId ? { community_id: Number(communityId) } : {}), [communityId])
  const busy = loading || building

  // Talk with Steve (reason / ideate / discuss / propose). The default action.
  const chat = useCallback(async (message: string) => {
    const text = (message || '').trim()
    if (!text || loading || building) return
    setError(null); setLimit(null); setProposal(null)
    setMessages((m) => [...m, { role: 'user', text }])
    setLoading(true)
    const ctrl = new AbortController(); abortRef.current = ctrl
    try {
      const history = messages.map((m) => ({ role: m.role, text: m.text }))
      const res = await fetch('/api/builder/chat', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history, mode, agent_mode: agentMode, tier, creation_id: creation?.id, ...communityPayload }),
        signal: ctrl.signal,
      })
      const data = (await res.json().catch(() => null)) as ChatResult | null
      if (!res.ok || !data?.success || !data.reply) {
        setError(data?.error || 'Steve had trouble there — try again.')
        return
      }
      setMessages((m) => [...m, { role: 'steve', text: data.reply! }])
      if (data.ready && data.brief) setProposal({ brief: data.brief })
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') setError('Network error. Please try again.')
    } finally {
      setLoading(false); abortRef.current = null
    }
  }, [loading, building, messages, mode, agentMode, tier, creation, communityPayload])

  const clearActiveJob = useCallback(() => {
    setActiveJob(null)
    try { localStorage.removeItem(activeJobKey) } catch { /* ignore */ }
  }, [activeJobKey])

  const pollJob = useCallback(async (jobId: number): Promise<BuilderJob | null> => {
    try {
      const res = await fetch(`/api/builder/jobs/${jobId}`, { credentials: 'include' })
      const data = (await res.json().catch(() => null)) as (ApiResult & { job?: BuilderJob }) | null
      if (!res.ok || !data?.success || !data.job) return null
      setActiveJob(data.job)
      if (data.job.status === 'succeeded' && data.creation) {
        setCreation(data.creation)
        setRev((r) => r + 1)
        setMessages((m) => [...m, {
          role: 'steve',
          text: data.job?.kind === 'iterate' ? 'Done — I updated it. Test it now.' : 'Done — I finished your build. Test it now.',
          creation: data.creation,
        }])
        setBuilding(false)
        clearActiveJob()
      } else if (data.job.status === 'failed') {
        setError('Steve could not finish this one. Try again when you are ready.')
        setBuilding(false)
        clearActiveJob()
      }
      return data.job
    } catch {
      return null
    }
  }, [clearActiveJob])

  // Poll while a job is in flight. Depend on the job's id + status PRIMITIVES,
  // never the whole activeJob object: pollJob calls setActiveJob(data.job) on
  // every tick with a fresh object, so depending on the object identity would
  // re-run this effect on every poll — cancelling the 3s interval and firing an
  // immediate re-poll each time, i.e. a hot loop that hammers the server and
  // never settles. Keying on (id, status) means the effect only re-subscribes
  // when the job actually transitions, and the 3s interval is respected.
  const activeJobId = activeJob?.id ?? 0
  const activeJobStatus = activeJob?.status
  useEffect(() => {
    if (!activeJobId || activeJobStatus === 'succeeded' || activeJobStatus === 'failed') return
    setBuilding(true)
    const id = window.setInterval(() => { pollJob(activeJobId).catch(() => { /* keep waiting */ }) }, 3000)
    pollJob(activeJobId).catch(() => { /* keep waiting */ })
    return () => window.clearInterval(id)
  }, [activeJobId, activeJobStatus, pollJob])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(activeJobKey)
      const jobId = raw ? Number(raw) : 0
      if (jobId > 0) {
        setActiveJob({ id: jobId, status: 'queued' })
        setMessages((m) => m.length ? m : [{
          role: 'steve',
          text: "I'm still building this. You can leave the app — I'll notify you when it's ready.",
        }])
      }
    } catch { /* ignore */ }
  }, [activeJobKey])

  // Persist the conversation per creation (debounced) so the user can return to
  // it. Runs whenever the thread changes and a creation exists; lean payload
  // (role/text/creation_id only — never the artifact HTML).
  useEffect(() => {
    if (!creation || messages.length === 0) return
    const id = window.setTimeout(() => {
      const payload = messages.map((m) => ({ role: m.role, text: m.text, creation_id: m.creation?.id }))
      fetch(`/api/builder/${creation.id}/history`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: payload }),
      }).catch(() => { /* best-effort */ })
    }, 700)
    return () => window.clearTimeout(id)
  }, [messages, creation])

  // Generate (or revise) the artifact from a confirmed brief.
  const build = useCallback(async (brief: string) => {
    const text = (brief || '').trim()
    if (!text || loading || building) return
    setError(null); setLimit(null); setProposal(null)
    lastBriefRef.current = text
    setBuilding(true)
    const ctrl = new AbortController(); abortRef.current = ctrl
    const isIteration = !!creation
    try {
      const url = creation ? `/api/builder/${creation.id}/iterate` : '/api/builder/create'
      const body = creation ? { message: text, tier } : { ...communityPayload, prompt: text, tier }
      const res = await fetch(url, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctrl.signal,
      })
      const data = (await res.json().catch(() => null)) as ApiResult | null
      if (res.status === 402) {
        setLimit({ cap: data?.cap ?? null, message: data?.message || "You've used all your makes this month." })
        return
      }
      if (res.status === 409) {
        setError(data?.message || "Steve is already building something for you.")
        return
      }
      if (data?.queued && data.job?.id) {
        setActiveJob(data.job)
        try { localStorage.setItem(activeJobKey, String(data.job.id)) } catch { /* ignore */ }
        setMessages((m) => [...m, {
          role: 'steve',
          text: data.message || "I'm building it now. You can leave this screen — I'll notify you when it's ready.",
        }])
        return
      }
      if (!res.ok || !data?.success || !data.creation) {
        setError(data?.error || 'Hmm, that one got away from me.')
        return
      }
      setCreation(data.creation)
      setRev((r) => r + 1)
      setMessages((m) => [...m, { role: 'steve', text: isIteration ? 'Updated it —' : "Here's what I made —", creation: data.creation }])
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') setError('Network error. Please try again.')
    } finally {
      setBuilding(false); abortRef.current = null
    }
  }, [loading, building, creation, tier, communityPayload, activeJobKey])

  // User confirmed Steve's proposal — build it.
  const confirmBuild = useCallback(() => {
    if (proposal && !loading && !building) build(proposal.brief)
  }, [proposal, loading, building, build])

  // Re-run the last build (after a generation failure).
  const retry = useCallback(() => {
    if (lastBriefRef.current && !loading && !building) build(lastBriefRef.current)
  }, [loading, building, build])

  // Stop whatever's in flight so the user can rectify or add input.
  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    if (activeJob) {
      setMessages((m) => [...m, {
        role: 'steve',
        text: "I'm still building on the server. You can leave this screen — I'll notify you when it's ready.",
      }])
      return
    }
    setLoading(false); setBuilding(false)
  }, [activeJob])

  const publish = useCallback(async (caption?: string, targetCommunityId?: number): Promise<number | null> => {
    if (!creation) return null
    try {
      const res = await fetch(`/api/builder/${creation.id}/publish`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption: caption || creation.title,
          ...(targetCommunityId ? { community_id: targetCommunityId } : communityPayload),
        }),
      })
      const data = (await res.json().catch(() => null)) as ApiResult | null
      if (!res.ok || !data?.success || typeof data.post_id !== 'number') {
        setError(data?.error || 'Publish failed.')
        return null
      }
      return data.post_id
    } catch {
      setError('Network error. Please try again.')
      return null
    }
  }, [creation, communityPayload])

  const publishWeb = useCallback(async (): Promise<string | null> => {
    if (!creation) return null
    try {
      const res = await fetch(`/api/builder/${creation.id}/publish-web`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      const data = (await res.json().catch(() => null)) as ApiResult | null
      if (!res.ok || !data?.success || !data.public_url) {
        setError(data?.error === 'public_publish_not_supported_for_games'
          ? 'Public domains are for websites and apps. Games stay inside C-Point for saves, scores and multiplayer.'
          : data?.error || 'Could not publish this build to the web.')
        return null
      }
      setCreation((current) => current && current.id === creation.id
        ? {
          ...current,
          public_slug: data.public_slug ?? current.public_slug,
          public_status: data.public_status ?? 'published',
          public_url: data.public_url ?? current.public_url,
          public_published_at: data.public_published_at ?? current.public_published_at,
          public_kind: data.public_kind ?? current.public_kind,
        }
        : current)
      setRev((r) => r + 1)
      return data.public_url
    } catch {
      setError('Network error. Please try again.')
      return null
    }
  }, [creation])

  const unpublishWeb = useCallback(async (): Promise<boolean> => {
    if (!creation) return false
    try {
      const res = await fetch(`/api/builder/${creation.id}/publish-web`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      const data = (await res.json().catch(() => null)) as ApiResult | null
      if (!res.ok || !data?.success) {
        setError(data?.error || 'Could not unpublish this build.')
        return false
      }
      setCreation((current) => current && current.id === creation.id
        ? { ...current, public_status: 'unpublished' }
        : current)
      setRev((r) => r + 1)
      return true
    } catch {
      setError('Network error. Please try again.')
      return false
    }
  }, [creation])

  const loadCreation = useCallback(async (id: number): Promise<boolean> => {
    setError(null); setLimit(null); setProposal(null)
    try {
      const q = communityId ? `?community_id=${encodeURIComponent(communityId)}` : ''
      const res = await fetch(`/api/builder/${id}${q}`, { credentials: 'include' })
      const data = (await res.json().catch(() => null)) as (ApiResult & { chat_history?: { role: string; text: string; creation_id?: number }[] | null }) | null
      if (res.ok && data?.success && data.creation) {
        const c = data.creation
        setCreation(c)
        setRev((r) => r + 1)
        const hist = data.chat_history
        if (Array.isArray(hist) && hist.length > 0) {
          // Restore the saved conversation; re-attach the build card to the
          // messages that referenced this creation.
          setMessages(hist.map((m) => ({
            role: m.role === 'user' ? 'user' : 'steve',
            text: m.text || '',
            creation: m.creation_id === c.id ? c : undefined,
          })))
        } else {
          setMessages([{ role: 'steve', text: 'Picking up where we left off — what would you like to change?', creation: c }])
        }
        return true
      }
    } catch { /* fall through */ }
    setError('Could not open that build.')
    return false
  }, [communityId])

  const watchJob = useCallback((jobId: number) => {
    if (!jobId) return
    setError(null); setLimit(null); setProposal(null)
    setActiveJob({ id: jobId, status: 'queued' })
    setBuilding(true)
    try { localStorage.setItem(activeJobKey, String(jobId)) } catch { /* ignore */ }
  }, [activeJobKey])

  return {
    creation, messages, loading, building, busy, activeJob, error, limit, rev,
    tier, setTier, mode, setMode, agentMode, setAgentMode, proposal,
    chat, build, confirmBuild, retry, stop, publish, publishWeb, unpublishWeb, loadCreation, watchJob,
  }
}
