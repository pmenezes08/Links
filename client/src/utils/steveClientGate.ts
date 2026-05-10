/**
 * Client-side preflight before DM/group/feed sends that would invoke Steve.
 * Mirrors server rules: Free tier (`!can_use_steve`) cannot open Steve DM or
 * mention @Steve; enforcement follows `enforcement_enabled` from `/api/me/entitlements`.
 */

import type { EntitlementsError } from './entitlementsError'
import type { EntitlementsSnapshot } from '../hooks/useEntitlements'

const STEVE_MENTION_RE = /@steve\b/i

export function mentionsSteve(text: string): boolean {
  return STEVE_MENTION_RE.test((text || '').trim())
}

export function isSteveDmPeer(peerUsername: string | undefined): boolean {
  return (peerUsername || '').trim().toLowerCase() === 'steve'
}

/**
 * Minimal `premium_required` payload for LimitReachedModal (body copy omitted client-side).
 * CTA aligns with backend defaults in `backend/services/entitlements_errors.py`.
 */
export function buildClientPremiumRequiredError(): EntitlementsError {
  const emptyUsage = {
    monthly_steve_used: null as number | null,
    monthly_steve_cap: null as number | null,
    daily_used: null as number | null,
    daily_cap: null as number | null,
    whisper_minutes_used: null as number | null,
    whisper_minutes_cap: null as number | null,
    resets_at_monthly: null as string | null,
    resets_at_daily: null as string | null,
  }
  return {
    success: false,
    error: 'entitlements_error',
    reason: 'premium_required',
    message: '',
    cta: {
      type: 'upgrade',
      label: 'Upgrade to Premium',
      url: '/subscription_plans?mode=choose',
    },
    usage: emptyUsage,
    tier: 'free',
  }
}

export interface ShouldBlockSteveIntentArgs {
  enforcement_enabled: boolean
  loading: boolean
  entitlements: EntitlementsSnapshot | null
  isSteveDm: boolean
  text: string
}

/**
 * Returns true if the send should be blocked (show premium modal, do not POST).
 */
export function shouldClientBlockSteveIntent(args: ShouldBlockSteveIntentArgs): boolean {
  if (!args.enforcement_enabled) return false
  const intent = args.isSteveDm || mentionsSteve(args.text)
  if (!intent) return false
  if (args.loading) return true
  if (!args.entitlements) return true
  return args.entitlements.can_use_steve !== true
}
