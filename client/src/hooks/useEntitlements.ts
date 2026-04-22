import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Snapshot of the signed-in user's entitlements + current usage.
 *
 * Returned by `GET /api/me/entitlements`. The shape mirrors the backend
 * `resolve_entitlements()` dict plus a `usage` block computed by
 * `/api/me/entitlements`.
 */
export interface EntitlementsSnapshot {
  username: string | null
  tier: 'free' | 'trial' | 'premium' | 'special' | 'anonymous' | 'unknown'
  subscription?: string
  is_special?: boolean
  /**
   * Set to `enterprise:<slug>` when the user's Premium tier comes from an
   * Enterprise community seat rather than a personal subscription.
   * Used by the Manage Membership modal + IAP nag banner to explain where
   * their benefits are coming from.
   */
  inherited_from?: string | null
  enterprise_seat?: {
    community_id: number
    community_name?: string
    community_slug?: string
    started_at?: string | null
    ended_at?: string | null
    active: boolean
  } | null
  can_use_steve: boolean
  can_create_communities?: boolean

  // Caps (null = unlimited).
  steve_uses_per_month: number | null
  whisper_minutes_per_month: number | null
  ai_daily_limit: number | null
  communities_max: number | null
  members_per_owned_community: number | null

  // Technical caps.
  max_output_tokens_dm?: number
  max_output_tokens_feed?: number
  max_output_tokens_group?: number
  max_tool_invocations_per_turn?: number
  max_context_messages?: number
  max_images_per_turn?: number
  rpm_per_user?: number
  hpm_per_user?: number
  monthly_spend_ceiling_eur?: number

  internal_weights?: Record<string, number>
}

export interface EntitlementsUsage {
  monthly_steve_used: number
  monthly_steve_cap: number | null
  monthly_steve_pct: number | null
  daily_used: number
  daily_cap: number | null
  daily_pct: number | null
  whisper_minutes_used: number
  whisper_minutes_cap: number | null
  whisper_minutes_pct: number | null
  near_soft_cap: boolean
  near_hard_cap: boolean
  resets_at_monthly: string | null
  resets_at_daily: string | null
}

export interface EntitlementsState {
  entitlements: EntitlementsSnapshot | null
  usage: EntitlementsUsage | null
  enforcement_enabled: boolean
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const ENDPOINT = '/api/me/entitlements'

/**
 * Minimum interval between focus-triggered refreshes. Users flick between
 * tabs constantly; we don't want to hit /api/me/entitlements every time
 * the window gains focus. 20s is long enough to be cheap and short enough
 * that the counter feels live when you come back from using Steve in
 * another tab / another device.
 */
const FOCUS_REFRESH_THROTTLE_MS = 20_000

/**
 * Custom event name that any Steve-calling surface can dispatch to force
 * an immediate entitlements re-fetch. The hook listens globally so a
 * DM/feed/group reply flow doesn't need to plumb `refresh()` down through
 * props. Callers:
 *
 *     window.dispatchEvent(new Event('cpoint:entitlements-refresh'))
 *
 * Fired after a successful Steve reply so the Manage Membership modal
 * and the usage page show the incremented counter without a full reload.
 */
export const ENTITLEMENTS_REFRESH_EVENT = 'cpoint:entitlements-refresh'

/**
 * Client hook that fetches + caches the signed-in user's entitlements.
 *
 * Fetch triggers:
 *   1. On mount (unless `skip` is true).
 *   2. On window focus, throttled to at most once every
 *      `FOCUS_REFRESH_THROTTLE_MS` ms.
 *   3. When any code dispatches `ENTITLEMENTS_REFRESH_EVENT` on `window`
 *      (intended to be fired after a successful Steve call so the counter
 *      updates without reloading the page).
 *   4. Explicit `refresh()` call from the consumer.
 *
 * Anonymous / logged-out responses return `entitlements.can_use_steve === false`
 * so the UI can still decide whether to show the Steve button.
 */
export function useEntitlements(opts: { skip?: boolean } = {}): EntitlementsState {
  const { skip } = opts
  const [entitlements, setEntitlements] = useState<EntitlementsSnapshot | null>(null)
  const [usage, setUsage] = useState<EntitlementsUsage | null>(null)
  const [enforcementEnabled, setEnforcementEnabled] = useState(false)
  const [loading, setLoading] = useState(!skip)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef<Promise<void> | null>(null)
  const lastRefreshAt = useRef<number>(0)

  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current
    const job = (async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(ENDPOINT, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        if (!res.ok) {
          if (res.status === 401) {
            setEntitlements(null)
            setUsage(null)
            return
          }
          throw new Error(`HTTP ${res.status}`)
        }
        const body = await res.json()
        if (body && body.success) {
          setEntitlements(body.entitlements || null)
          setUsage(body.usage || null)
          setEnforcementEnabled(!!body.enforcement_enabled)
        } else {
          throw new Error(body?.error || 'Failed to load entitlements')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
        lastRefreshAt.current = Date.now()
        inflight.current = null
      }
    })()
    inflight.current = job
    return job
  }, [])

  useEffect(() => {
    if (skip) return
    void refresh()
  }, [skip, refresh])

  useEffect(() => {
    if (skip) return

    const onFocus = () => {
      const since = Date.now() - lastRefreshAt.current
      if (since >= FOCUS_REFRESH_THROTTLE_MS) {
        void refresh()
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onFocus()
    }
    const onManualRefresh = () => {
      void refresh()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener(ENTITLEMENTS_REFRESH_EVENT, onManualRefresh)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener(ENTITLEMENTS_REFRESH_EVENT, onManualRefresh)
    }
  }, [skip, refresh])

  return { entitlements, usage, enforcement_enabled: enforcementEnabled, loading, error, refresh }
}
