import i18n from '../../i18n'
import { tierLabel } from './subscriptionFormatters'
import { PENDING_CHECKOUT_KEY, type ActiveSubscriptionsPayload } from './subscriptionTypes'

export function resetSubscriptionPageScroll() {
  const reset = () => {
    const region = document.querySelector<HTMLElement>('[data-scroll-region="true"]')
    if (region) region.scrollTop = 0
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  requestAnimationFrame(reset)
}

export function storePendingCheckout(body: Record<string, string | number>) {
  try {
    sessionStorage.setItem(
      PENDING_CHECKOUT_KEY,
      JSON.stringify({
        plan_id: body.plan_id,
        community_id: body.community_id,
        tier_code: body.tier_code,
        created_at: Date.now(),
      }),
    )
  } catch {
    // sessionStorage can be unavailable in private contexts.
  }
}

export function maybeConfirmPendingCheckout(active: ActiveSubscriptionsPayload) {
  try {
    const raw = sessionStorage.getItem(PENDING_CHECKOUT_KEY)
    if (!raw) return null
    const pending = JSON.parse(raw) as {
      plan_id?: string
      community_id?: number
      tier_code?: string
      created_at?: number
    }
    if (pending.created_at && Date.now() - pending.created_at > 1000 * 60 * 30) {
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY)
      return null
    }
    if (pending.plan_id === 'premium' && (active.personal?.subscription_active ?? active.personal?.active)) {
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY)
      return i18n.t('subscriptions.status_premium_active')
    }
    const communityId = Number(pending.community_id || 0)
    const match = active.communities?.find(
      c =>
        c.id === communityId
        && (!pending.tier_code || String(c.tier || '').toLowerCase() === String(pending.tier_code).toLowerCase()),
    )
    if (match) {
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY)
      return i18n.t('subscriptions.status_community_active', {
        name: match.name,
        tier: tierLabel(match.tier),
      })
    }
    if (pending.plan_id === 'steve_package') {
      const steveMatch = active.communities?.find(
        c => c.id === communityId && c.steve_package_subscription_active,
      )
      if (steveMatch) {
        sessionStorage.removeItem(PENDING_CHECKOUT_KEY)
        return i18n.t('subscriptions.status_steve_active', { name: steveMatch.name })
      }
    }
  } catch {
    try {
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY)
    } catch {}
  }
  return null
}
