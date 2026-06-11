import { useEffect, useState } from 'react'

/**
 * KB-driven affordance thresholds for the post-summary glyph. The KB is
 * the source of truth (never hardcode caps client-side); fetched once per
 * session and shared module-wide. `null` while loading or on failure —
 * callers treat that as "affordance hidden", so a config outage degrades
 * to the ⋯ menu path instead of an always-on glyph.
 */
export type SteveSummaryConfig = {
  enabled: boolean
  minReplies: number
  minThreadChars: number
}

let cached: SteveSummaryConfig | null = null
let inflight: Promise<SteveSummaryConfig | null> | null = null

function fetchConfig(): Promise<SteveSummaryConfig | null> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) {
    inflight = fetch('/api/post_summary/config', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(r => r.json())
      .then(data => {
        if (!data?.success) return null
        cached = {
          enabled: Boolean(data.enabled),
          minReplies: Number(data.min_replies) || 0,
          minThreadChars: Number(data.min_thread_chars) || 0,
        }
        return cached
      })
      .catch(() => null)
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export function useSteveSummaryConfig(): SteveSummaryConfig | null {
  const [config, setConfig] = useState<SteveSummaryConfig | null>(cached)
  useEffect(() => {
    if (config) return
    let mounted = true
    void fetchConfig().then(c => {
      if (mounted && c) setConfig(c)
    })
    return () => {
      mounted = false
    }
  }, [config])
  return config
}

/** Does this post earn the inline glyph? (Sub-threshold posts keep the ⋯ entry.) */
export function postQualifiesForSummary(
  config: SteveSummaryConfig | null,
  post: { content?: string | null; replies?: Array<{ content?: string | null }> | null },
): boolean {
  if (!config || !config.enabled) return false
  const replyCount = post.replies?.length || 0
  if (replyCount >= config.minReplies) return true
  const totalChars =
    (post.content?.length || 0) +
    (post.replies || []).reduce((sum, r) => sum + (r.content?.length || 0), 0)
  return totalChars >= config.minThreadChars
}
