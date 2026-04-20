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

export interface EntitlementsError {
  success: false
  error: 'entitlements_error'
  reason: EntitlementsReason
  message: string
  cta: EntitlementsCta
  usage: EntitlementsUsageSnapshot
  tier?: string
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
