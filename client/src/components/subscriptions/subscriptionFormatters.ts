import i18n from '../../i18n'
import type { ActiveCommunitySubscription } from './subscriptionTypes'

export function formatEur(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return i18n.t('subscriptions.price_tbd')
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return i18n.t('subscriptions.price_tbd')
  return `€${n.toFixed(2).replace(/\.00$/, '')}`
}

export function priceIsKnown(value: number | string | null | undefined): boolean {
  if (value === null || value === undefined || value === '') return false
  const n = typeof value === 'number' ? value : Number(value)
  return !Number.isNaN(n)
}

export function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

export function tierLabel(tier?: string | null) {
  const value = String(tier || '').toLowerCase()
  if (value === 'paid_l1') return i18n.t('subscriptions.tier_paid_l1')
  if (value === 'paid_l2') return i18n.t('subscriptions.tier_paid_l2')
  if (value === 'paid_l3') return i18n.t('subscriptions.tier_paid_l3')
  if (value === 'free') return i18n.t('subscriptions.tier_free')
  return tier || i18n.t('subscriptions.tier_active_fallback')
}

export function paidTierRank(tier?: string | null): number {
  const value = String(tier || '').toLowerCase()
  if (value === 'paid_l1') return 1
  if (value === 'paid_l2') return 2
  if (value === 'paid_l3') return 3
  if (value === 'enterprise') return 4
  return 0
}

export function communityStripeHealthy(c: ActiveCommunitySubscription): boolean {
  if (c.tier_subscription_active === true) return true
  return c.tier_subscription_live === true
}

export function renewalCopy(value?: string | null) {
  return value
    ? i18n.t('subscriptions.renewal_next', { date: formatDate(value) })
    : i18n.t('subscriptions.renewal_unavailable')
}

export function benefitsCopy(value?: string | null) {
  return value
    ? i18n.t('subscriptions.benefits_until', { date: formatDate(value) })
    : i18n.t('subscriptions.cancellation_pending')
}

export function communitySubtitleCommunity(c: ActiveCommunitySubscription): string {
  return c.cancel_at_period_end
    ? benefitsCopy(c.benefits_end_at || c.current_period_end)
    : renewalCopy(c.current_period_end)
}

export function hubPriceSubtitle(price: number | string | null | undefined): string {
  return `${formatEur(price)}${i18n.t('subscriptions.per_month')}`
}
