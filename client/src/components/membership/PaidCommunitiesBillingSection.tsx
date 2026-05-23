import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  currentStoreProvider,
  openExternalBillingUrl,
  providerBadge,
  providerLabel,
} from '../../utils/mobileStoreBilling'

export interface PaidCommunityBillingRow {
  id: number
  name: string
  tier?: string | null
  billing_provider?: string | null
  stripe_mode?: string | null
  current_period_end?: string | null
  has_stripe_customer?: boolean
  tier_subscription_active?: boolean
  needs_attention?: boolean
  renewal_date_status?: string | null
}

function isPaidCommunity(row: PaidCommunityBillingRow): boolean {
  const tier = String(row.tier || '').toLowerCase()
  if (tier && tier !== 'free') return true
  return !!row.tier_subscription_active
}

function communityTierLabel(tier: string | null | undefined, t: (key: string) => string): string {
  const value = String(tier || '').toLowerCase()
  if (value === 'paid_l1') return t('subscriptions.tier_paid_l1')
  if (value === 'paid_l2') return t('subscriptions.tier_paid_l2')
  if (value === 'paid_l3') return t('subscriptions.tier_paid_l3')
  if (value === 'enterprise') return t('subscriptions.enterprise')
  if (value === 'free') return t('subscriptions.tier_free')
  return tier || t('subscriptions.tier_active_fallback')
}

function storeSubscriptionsUrl(provider: string): string {
  if (provider === 'apple') return 'https://apps.apple.com/account/subscriptions'
  return 'https://play.google.com/store/account/subscriptions'
}

export default function PaidCommunitiesBillingSection() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<PaidCommunityBillingRow[]>([])
  const [stripeMode, setStripeMode] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [portalBusyId, setPortalBusyId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setErr(null)
      try {
        const res = await fetch('/api/me/subscriptions', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const body = await res.json()
        if (!res.ok || !body?.success) {
          throw new Error(body?.error || 'Failed to load subscriptions')
        }
        const paid = (body.communities || []).filter((c: PaidCommunityBillingRow) =>
          isPaidCommunity(c),
        ) as PaidCommunityBillingRow[]
        if (!cancelled) {
          setRows(paid)
          setStripeMode(body.stripe_mode || null)
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e))
          setRows([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const manageCommunity = async (row: PaidCommunityBillingRow) => {
    const provider = String(row.billing_provider || 'stripe').toLowerCase()
    if (provider === 'apple' || provider === 'google') {
      openExternalBillingUrl(storeSubscriptionsUrl(provider))
      return
    }
    setPortalBusyId(row.id)
    try {
      if (provider === 'stripe' && !row.has_stripe_customer) {
        setErr(t('billing.paid_communities_no_customer'))
        return
      }
      const rowMode = String(row.stripe_mode || stripeMode || '').toLowerCase()
      if (provider === 'stripe' && rowMode && stripeMode && rowMode !== stripeMode) {
        setErr(t('billing.paid_communities_mode_mismatch', {
          mode: rowMode,
          current: stripeMode,
        }))
        return
      }
      const res = await fetch(`/api/me/billing/portal?community_id=${row.id}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ return_path: `/community/${row.id}/edit` }),
      })
      const body = await res.json()
      if (res.ok && body?.success && body?.url) {
        window.location.assign(body.url)
        return
      }
      if (body?.reason === 'stripe_mode_mismatch') {
        setErr(t('billing.paid_communities_mode_mismatch', {
          mode: body.stripe_mode || row.stripe_mode || 'test',
          current: body.current_stripe_mode || stripeMode || 'live',
        }))
        return
      }
      if (body?.reason === 'no_customer') {
        setErr(t('billing.paid_communities_no_customer'))
        return
      }
      setErr(body?.error || t('billing.paid_communities_portal_failed'))
    } catch {
      setErr(t('billing.paid_communities_portal_failed'))
    } finally {
      setPortalBusyId(null)
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-white/50">{t('billing.paid_communities_loading')}</p>
    )
  }
  if (err) {
    return (
      <p className="text-sm text-red-300/90">{err}</p>
    )
  }
  if (rows.length === 0) {
    return (
      <p className="text-sm text-white/50">{t('billing.paid_communities_empty')}</p>
    )
  }

  const nativeProvider = currentStoreProvider()
  const subtitleKey = nativeProvider === 'apple'
    ? 'billing.paid_communities_subtitle_ios'
    : 'billing.paid_communities_subtitle'

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10">
        <h4 className="text-sm font-semibold text-white">{t('billing.paid_communities_title')}</h4>
        <p className="mt-1 text-xs text-white/55">{t(subtitleKey)}</p>
      </div>
      <ul className="divide-y divide-white/5">
        {rows.map((row) => {
          const provider = String(row.billing_provider || 'stripe').toLowerCase()
          const busy = portalBusyId === row.id
          const renewal = row.current_period_end ? new Date(row.current_period_end) : null
          const rowMode = String(row.stripe_mode || stripeMode || '').toLowerCase()
          const modeMismatch = provider === 'stripe' && !!rowMode && !!stripeMode && rowMode !== stripeMode
          const manageDisabled = busy
          return (
            <li
              key={row.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="font-medium text-white truncate">{row.name}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 px-2 py-0.5 text-[11px] font-medium text-cpoint-turquoise">
                    {communityTierLabel(row.tier, t)}
                  </span>
                  <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-white/60">
                    {providerBadge(provider)}
                  </span>
                  {row.needs_attention && (
                    <span className="rounded-full border border-yellow-400/30 bg-yellow-400/10 px-2 py-0.5 text-[11px] font-medium text-yellow-200">
                      {t('billing.needs_attention')}
                    </span>
                  )}
                </div>
                {renewal && (
                  <div className="mt-1 text-xs text-white/45">
                    {t('billing.renews')}: {renewal.toLocaleDateString()}
                  </div>
                )}
                {modeMismatch && (
                  <div className="mt-1 text-xs text-yellow-200/90">
                    {t('billing.paid_communities_mode_badge', { mode: rowMode, current: stripeMode })}
                  </div>
                )}
              </div>
              <button
                type="button"
                disabled={manageDisabled}
                onClick={() => manageCommunity(row)}
                className="shrink-0 rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-white hover:bg-white/5 disabled:opacity-50 transition"
              >
                {busy
                  ? t('billing.paid_communities_opening')
                  : provider === 'apple' || provider === 'google'
                    ? t('billing.paid_communities_manage_store', {
                        provider: providerLabel(provider),
                      })
                    : t('billing.paid_communities_manage_web')}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
