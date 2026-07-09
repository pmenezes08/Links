/**
 * Helpers for the shared entitlements_error JSON shape emitted by the backend.
 *
 * Every Steve / Whisper / content-gen endpoint that denies a call returns:
 *
 *     {
 *       success: false,
 *       error: "entitlements_error",
 *       reason: "premium_required" | "daily_cap" | "monthly_steve_cap" | ...,
 *       message: string,
 *       cta: { type: "upgrade" | "wait" | "manage" | "open_url", label, url },
 *       usage: { ... },
 *       tier: "free" | "trial" | "premium" | "special"
 *       premium_offer?: { steve_uses_per_month, whisper_minutes_per_month }
 *     }
 *
 * The frontend uses a single handler that switches on `reason` to pick
 * between the inline bubble (DM / group chat) and the full modal (button
 * surfaces like post summary / voice summary / feed).
 */

export type EntitlementsReason =
  | 'premium_required'
  | 'daily_cap'
  | 'monthly_steve_cap'
  | 'monthly_whisper_cap'
  | 'community_pool_exhausted'
  | 'rpm_exceeded'
  | 'hpm_exceeded'
  | 'special_technical_cap'
  | 'community_suspended'
  | 'grace_expired'
  | 'upload_size_limit'
  | 'upload_daily_limit'

export type EntitlementsCtaType = 'upgrade' | 'wait' | 'manage' | 'open_url'

export interface EntitlementsCta {
  type: EntitlementsCtaType | null
  label: string | null
  url: string | null
}

export interface EntitlementsUsageSnapshot {
  monthly_steve_used?: number | null
  monthly_steve_cap?: number | null
  daily_used?: number | null
  daily_cap?: number | null
  whisper_minutes_used?: number | null
  whisper_minutes_cap?: number | null
  resets_at_monthly?: string | null
  resets_at_daily?: string | null
}

export interface PremiumOfferCaps {
  steve_uses_per_month: number
  whisper_minutes_per_month: number
}

export interface EntitlementsError {
  success: false
  error: 'entitlements_error'
  reason: EntitlementsReason
  message: string
  cta: EntitlementsCta
  usage: EntitlementsUsageSnapshot
  tier?: string
  /** Set when reason === premium_required — aligns headline numbers with KB Premium caps */
  premium_offer?: PremiumOfferCaps
}

export function isEntitlementsError(obj: unknown): obj is EntitlementsError {
  if (!obj || typeof obj !== 'object') return false
  const x = obj as Record<string, unknown>
  return x.error === 'entitlements_error' && typeof x.reason === 'string'
}

/** Normalize a fetch response into an EntitlementsError if it is one. */
export async function parseEntitlementsError(
  res: Response,
): Promise<EntitlementsError | null> {
  try {
    const body = await res.clone().json()
    return isEntitlementsError(body) ? body : null
  } catch {
    return null
  }
}

/** Coerce a loosely-typed community id (route param, API field) to a positive number or null. */
export function normalizeCommunityId(id: number | string | null | undefined): number | null {
  if (id === null || id === undefined || id === '') return null
  const n = Number(id)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Rewrite a bare `/subscription_plans` CTA so it deep-links into the plans UI
 * for the community the user was acting in (same URL shape the owner-setup
 * wizard uses: `?open=community_plans&community_id=N`, consumed by
 * SubscriptionPlans). `community_pool_exhausted` is a Steve-package problem,
 * not a tier problem, so it opens the add-ons picker instead.
 *
 * Leaves the URL untouched when no community is known, when the CTA points
 * elsewhere, or when the backend already specified `open`/`community_id`.
 */
export function subscriptionPlansCtaUrl(
  url: string,
  reason: EntitlementsReason,
  communityId?: number | string | null,
): string {
  const id = normalizeCommunityId(communityId)
  if (!id) return url
  const [path, query = ''] = url.split('?')
  if (path !== '/subscription_plans') return url
  const params = new URLSearchParams(query)
  if (params.has('community_id') || params.has('open')) return url
  params.set('open', reason === 'community_pool_exhausted' ? 'community_addons' : 'community_plans')
  params.set('community_id', String(id))
  return `${path}?${params.toString()}`
}

export function surfacePreferredComponent(reason: EntitlementsReason): 'bubble' | 'modal' | 'toast' {
  switch (reason) {
    case 'rpm_exceeded':
    case 'hpm_exceeded':
      return 'toast'
    case 'community_suspended':
      return 'modal'
    default:
      return 'modal'
  }
}
