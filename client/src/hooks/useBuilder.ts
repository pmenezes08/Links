import { useCallback, useEffect, useRef, useState } from 'react'

function persisted<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    if (v && (allowed as readonly string[]).includes(v)) return v as T
  } catch { /* ignore */ }
  return fallback
}

export type Creation = { id: number; title: string; html: string; status: string }
export type BuilderTier = 'fast' | 'balanced' | 'best'
export type BuilderMode = 'simple' | 'technical'
export type BuilderAgentMode = 'ask' | 'agent'
export type BuilderMessage = { role: 'user' | 'steve'; text: string; creation?: Creation }
export type BuilderLimit = { cap: number | null; message: string }

type ApiResult = { success?: boolean; error?: string; creation?: Creation; cap?: number | null; message?: string; post_id?: number }
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
        body: JSON.stringify({ message: text, history, mode, agent_mode: agentMode, tier, creation_id: creation?.id, community_id: Number(communityId) }),
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
  }, [loading, building, messages, mode, agentMode, tier, creation, communityId])

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
      const body = creation ? { message: text, tier } : { community_id: Number(communityId), prompt: text, tier }
      const res = await fetch(url, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctrl.signal,
      })
      const data = (await res.json().catch(() => null)) as ApiResult | null
      if (res.status === 402) {
        setLimit({ cap: data?.cap ?? null, message: data?.message || "You've used all your makes this month." })
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
  }, [loading, building, creation, tier, communityId])

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
    setLoading(false); setBuilding(false)
  }, [])

  const publish = useCallback(async (caption?: string): Promise<number | null> => {
    if (!creation) return null
    try {
      const res = await fetch(`/api/builder/${creation.id}/publish`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: caption || creation.title }),
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
  }, [creation])

  const loadCreation = useCallback(async (id: number): Promise<boolean> => {
    setError(null); setLimit(null); setProposal(null)
    try {
      const res = await fetch(`/api/builder/${id}`, { credentials: 'include' })
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
  }, [])

  return {
    creation, messages, loading, building, busy, error, limit, rev,
    tier, setTier, mode, setMode, agentMode, setAgentMode, proposal,
    chat, build, confirmBuild, retry, stop, publish, loadCreation,
  }
}
