import { useCallback, useState } from 'react'

export type Creation = { id: number; title: string; html: string; status: string }
export type BuilderMessage = { role: 'user' | 'steve'; text: string }
export type BuilderLimit = { cap: number | null; message: string }

type ApiResult = { success?: boolean; error?: string; creation?: Creation; cap?: number | null; message?: string; post_id?: number }

/**
 * Drives the Steve Builder loop for one community: first build (create),
 * follow-up iterations, and publish. Front-end-only artifacts; the HTML is
 * rendered by the caller in a sandboxed iframe.
 */
export function useBuilder(communityId: string) {
  const [creation, setCreation] = useState<Creation | null>(null)
  const [messages, setMessages] = useState<BuilderMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState<BuilderLimit | null>(null)
  // Bumped on every successful build/iterate so the preview iframe can be
  // keyed off it — iOS WKWebView does not reliably reload on srcDoc change,
  // so we remount the iframe each turn.
  const [rev, setRev] = useState(0)
  // User-facing quality tier — "fast" (Grok) or "best" (GPT-5.x). Users only
  // ever see "Fast" / "Best quality", never the model name.
  const [tier, setTier] = useState<'fast' | 'best'>('fast')

  const build = useCallback(async (prompt: string) => {
    const text = (prompt || '').trim()
    if (!text || loading) return
    setError(null)
    setLimit(null)
    setLoading(true)
    setMessages((m) => [...m, { role: 'user', text }])
    try {
      const url = creation ? `/api/builder/${creation.id}/iterate` : '/api/builder/create'
      const body = creation
        ? { message: text, tier }
        : { community_id: Number(communityId), prompt: text, tier }
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => null)) as ApiResult | null
      if (res.status === 402) {
        setLimit({ cap: data?.cap ?? null, message: data?.message || 'You have reached your build limit.' })
        return
      }
      if (!res.ok || !data?.success || !data.creation) {
        setError(data?.error || 'Build failed. Try rephrasing.')
        return
      }
      setCreation(data.creation)
      setRev((r) => r + 1)
      setMessages((m) => [
        ...m,
        { role: 'steve', text: creation ? 'Done — take a look.' : 'Here you go! Want to change anything?' },
      ])
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [communityId, creation, loading, tier])

  const publish = useCallback(async (caption?: string): Promise<number | null> => {
    if (!creation) return null
    try {
      const res = await fetch(`/api/builder/${creation.id}/publish`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
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

  return { creation, messages, loading, error, limit, rev, tier, setTier, build, publish }
}
