/**
 * ManageMembershipModal — the one-stop shop for a user to see and manage
 * their plan, AI usage, and billing without leaving Account Settings.
 *
 * Sub-pages:
 *   - Plan          : tier + included caps + upgrade / downgrade CTAs
 *   - AI Usage      : monthly Steve + Whisper usage bars (delegates to the
 *                     existing MembershipAIUsage screen inline)
 *   - Billing       : Stripe subscription summary + "Manage payment method"
 *   - Payment       : alias for Billing, kept separate so we can slot a
 *                     custom payment-method UI in later without renaming
 *
 * The modal never calls Stripe directly — it hits `/api/me/billing` for
 * state and `/api/me/billing/portal` when the user clicks "Manage payment
 * method", then redirects to the returned Stripe-hosted URL.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Capacitor } from '@capacitor/core'
import { useEntitlements } from '../../hooks/useEntitlements'
import {
  currentStoreProvider,
  openExternalBillingUrl,
  providerBadge,
  providerLabel,
} from '../../utils/mobileStoreBilling'
import PaidCommunitiesBillingSection from './PaidCommunitiesBillingSection'

export type MembershipTab = 'plan' | 'ai' | 'billing' | 'payment'

/**
 * Format a rolling-window reset timestamp. Keep consistent with the
 * same-named helper in `pages/MembershipAIUsage.tsx` so both surfaces
 * render the 24h Steve reset identically.
 */
function formatRollingReset(ts: string): string {
  const d = new Date(ts)
  const hoursUntil = (d.getTime() - Date.now()) / 3_600_000
  if (hoursUntil <= 0) return 'shortly'
  if (hoursUntil < 48) {
    return `at ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
  }
  return `on ${d.toLocaleDateString()}`
}

interface Props {
  open: boolean
  onClose: () => void
  initialTab?: MembershipTab
}

interface BillingResponse {
  success: boolean
  plan: {
    tier: string
    subscription: string
    is_special: boolean
    inherited_from?: string | null
    subscription_provider?: string | null
    since?: string | null
  }
  stripe: {
    configured: boolean
    portal_available: boolean
    subscription: {
      customer_id?: string
      subscription_id?: string
      status?: string
      cancel_at_period_end?: boolean
      current_period_end?: number | null
      trial_end?: number | null
      price_amount_cents?: number | null
      price_interval?: string | null
      price_currency?: string | null
      source?: string | null
      stripe_mode?: string | null
    } | null
    mode?: string | null
  }
  caps: {
    steve_uses_per_month: number | null
    whisper_minutes_per_month: number | null
    communities_max: number | null
    monthly_spend_ceiling_eur: number | null
  }
}

interface AiUsageResponse {
  success: boolean
  month_start?: string
  month_end?: string
  total_calls?: number
  total_whisper_minutes?: number
  by_surface?: Record<string, number>
}

interface PaymentHistoryResponse {
  success: boolean
  payments?: PaymentHistoryRow[]
}

interface PaymentHistoryRow {
  stripe_invoice_id?: string | null
  amount_paid_cents: number
  currency?: string | null
  paid_at?: string | null
  period_start?: string | null
  period_end?: string | null
  scope: 'personal' | 'community'
  label?: string | null
  community_name?: string | null
  hosted_invoice_url?: string | null
}

const TABS: { id: MembershipTab; labelKey: string; icon: string }[] = [
  { id: 'plan', labelKey: 'billing.tabs.plan', icon: 'fa-id-card' },
  { id: 'ai', labelKey: 'billing.tabs.ai', icon: 'fa-robot' },
  { id: 'billing', labelKey: 'billing.tabs.billing', icon: 'fa-receipt' },
  { id: 'payment', labelKey: 'billing.tabs.payment', icon: 'fa-credit-card' },
]

export default function ManageMembershipModal({ open, onClose, initialTab = 'plan' }: Props) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<MembershipTab>(initialTab)

  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 bg-c-bg-app/70 z-50"
        style={{ top: 'var(--app-header-offset, 0px)' }}
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('billing.modal_title')}
        className="fixed inset-x-0 bottom-0 z-50 flex items-start justify-center overflow-hidden p-3 sm:p-4"
        style={{ top: 'var(--app-header-offset, 0px)' }}
      >
        <div
          onClick={e => e.stopPropagation()}
          className="flex max-h-full min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-c-border bg-c-bg-elevated shadow-2xl"
        >
          <header className="flex items-center justify-between px-5 py-4 border-b border-c-border">
            <div>
              <div className="text-xs text-c-text-tertiary">{t('billing.account')}</div>
              <h2 className="text-lg font-semibold">{t('billing.modal_title')}</h2>
            </div>
            <button
              onClick={onClose}
              className="text-c-text-tertiary hover:text-c-text-primary transition"
              aria-label={t('common.close')}
            >
              <i className="fa-solid fa-xmark text-lg" />
            </button>
          </header>

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <nav className="hidden w-44 shrink-0 overflow-y-auto border-r border-c-border p-2 sm:block">
              {TABS.map(tabItem => (
                <button
                  key={tabItem.id}
                  onClick={() => setTab(tabItem.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition ${
                    tab === tabItem.id
                      ? 'bg-cpoint-turquoise/15 text-cpoint-turquoise'
                      : 'text-c-text-secondary hover:bg-c-hover-bg hover:text-c-text-primary'
                  }`}
                >
                  <i className={`fa-solid ${tabItem.icon} w-4 text-center`} />
                  {t(tabItem.labelKey)}
                </button>
              ))}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="sm:hidden flex gap-1 p-2 border-b border-c-border overflow-x-auto">
                {TABS.map(tabItem => (
                  <button
                    key={tabItem.id}
                    onClick={() => setTab(tabItem.id)}
                    className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap transition ${
                      tab === tabItem.id
                        ? 'bg-cpoint-turquoise/15 text-cpoint-turquoise'
                        : 'bg-c-hover-bg text-c-text-secondary'
                    }`}
                  >
                    {t(tabItem.labelKey)}
                  </button>
                ))}
              </div>
              <div className="p-5">
                {tab === 'plan' && <PlanTab />}
                {tab === 'ai' && <AiUsageTab />}
                {tab === 'billing' && <BillingTab />}
                {tab === 'payment' && <PaymentHistoryTab />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// --- Plan ----------------------------------------------------------------

function PlanTab() {
  const { t } = useTranslation()
  const { entitlements, loading } = useEntitlements()
  const [billingProvider, setBillingProvider] = useState('stripe')
  useEffect(() => {
    let cancelled = false
    fetch('/api/me/billing', { credentials: 'include', headers: { Accept: 'application/json' } })
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled && body?.success) {
          setBillingProvider(String(body.plan?.subscription_provider || 'stripe').toLowerCase())
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  if (loading || !entitlements) {
    return <div className="text-c-text-tertiary text-sm">{t('billing.loading_plan')}</div>
  }

  const tier = entitlements.tier
  const isEnterprise = !!(entitlements as { inherited_from?: string | null })?.inherited_from?.startsWith('enterprise:')
  const storeBilled = billingProvider === 'apple' || billingProvider === 'google'
  const nativeProvider = currentStoreProvider()

  const tierLabel =
    entitlements.is_special
      ? t('billing.tier_special')
      : tier === 'premium'
        ? isEnterprise ? t('billing.tier_premium_enterprise') : t('billing.tier_premium')
        : tier === 'trial'
          ? t('billing.tier_trial')
          : tier === 'free'
            ? t('billing.tier_free')
            : tier

  // Premium / Special have no user-tier member cap — their owned
  // communities use each community's own tier (Free 25, Paid L1 75,
  // L2 150, L3 250, Enterprise unlimited). Showing "Unlimited" here
  // would mislead — the cap depends on the community, not on the plan.
  const perCommunityLabel =
    entitlements.members_per_owned_community == null
      ? t('billing.based_on_community_tier')
      : capLabel(entitlements.members_per_owned_community, '', t('billing.unlimited'))

  const unlimited = t('billing.unlimited')
  const rows: Array<[string, string]> = [
    [t('billing.steve_uses_month'), capLabel(entitlements.steve_uses_per_month, '', unlimited)],
    [t('billing.voice_transcription_month'), capLabel(entitlements.whisper_minutes_per_month, 'min', unlimited)],
    [t('billing.communities_owned'), capLabel(entitlements.communities_max, '', unlimited)],
    [t('billing.members_per_community'), perCommunityLabel],
  ]

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-c-border bg-c-hover-bg p-4">
        <div className="text-xs uppercase tracking-wide text-c-text-tertiary">{t('billing.current_plan')}</div>
        <div className="flex items-center gap-3 mt-1">
          <h3 className="text-xl font-semibold">{tierLabel}</h3>
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-c-border bg-c-hover-bg text-c-text-tertiary">
            {providerBadge(billingProvider)}
          </span>
          {entitlements.is_special && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-200 border border-purple-500/30">
              {t('billing.staff')}
            </span>
          )}
        </div>
        {isEnterprise && (
          <p className="text-xs text-c-text-tertiary mt-2">
            {t('billing.enterprise_benefit_note')}
          </p>
        )}
      </section>

      <section>
        <h4 className="text-sm font-semibold mb-3">{t('billing.included')}</h4>
        <div className="divide-y divide-c-border rounded-xl border border-c-border bg-c-hover-bg">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="text-c-text-secondary">{k}</span>
              <span className="font-medium">{v}</span>
            </div>
          ))}
        </div>
      </section>

      <PaidCommunitiesBillingSection />

      {!entitlements.is_special && tier !== 'premium' && (
        storeBilled ? (
          <button
            type="button"
            onClick={() => openExternalBillingUrl(
              billingProvider === 'apple'
                ? 'https://apps.apple.com/account/subscriptions'
                : 'https://play.google.com/store/account/subscriptions',
            )}
            className="w-full bg-c-active-bg border border-white/20 text-c-text-primary font-semibold py-3 rounded-lg hover:bg-white/20 transition"
          >
            {t('billing.manage_in_store', { provider: providerLabel(billingProvider) })}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (Capacitor.isNativePlatform() && nativeProvider) {
                window.location.href = '/subscription_plans'
              } else {
                window.location.href = '/subscription_plans'
              }
            }}
            className="w-full bg-cpoint-turquoise text-black font-semibold py-3 rounded-lg hover:brightness-90 transition"
          >
            {nativeProvider
              ? t('billing.upgrade_via_store', { provider: providerLabel(nativeProvider) })
              : t('billing.upgrade_to_premium')}
          </button>
        )
      )}
    </div>
  )
}

// --- AI Usage ------------------------------------------------------------

function AiUsageTab() {
  const { t } = useTranslation()
  const { entitlements, usage, refresh } = useEntitlements()
  const [aiData, setAiData] = useState<AiUsageResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    refresh().catch(() => {})
    fetch('/api/me/ai-usage', { credentials: 'include', headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(body => {
        if (cancelled) return
        if (body?.success) setAiData(body)
        else setErr(body?.error || 'Failed to load')
      })
      .catch(e => { if (!cancelled) setErr(String(e)) })
    return () => { cancelled = true }
  }, [refresh])

  if (err) return <div className="text-red-400 text-sm">{err}</div>
  if (!entitlements || !usage) return <div className="text-c-text-tertiary text-sm">{t('billing.loading_usage')}</div>

  return (
    <div className="space-y-5">
      <UsageRow
        label={t('billing.steve_uses_month')}
        used={usage.monthly_steve_used}
        cap={usage.monthly_steve_cap}
        resetAt={usage.resets_at_monthly}
      />
      <UsageRow
        label={t('billing.voice_transcription_month')}
        used={usage.whisper_minutes_used}
        cap={usage.whisper_minutes_cap}
        unit="min"
        resetAt={usage.resets_at_monthly}
      />
      <UsageRow
        label={t('entitlements.limit_modal.usage_steve_24h')}
        used={usage.daily_used}
        cap={usage.daily_cap}
        resetAt={usage.resets_at_daily}
        rolling
      />

      {aiData?.by_surface && (
        <section>
          <h4 className="text-sm font-semibold mb-2">{t('billing.breakdown_by_surface')}</h4>
          <div className="divide-y divide-c-border rounded-xl border border-c-border bg-c-hover-bg">
            {Object.entries(aiData.by_surface).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-c-text-secondary capitalize">{k.replace(/_/g, ' ')}</span>
                <span className="font-mono text-c-text-secondary">{v}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function UsageRow({
  label, used, cap, unit, resetAt, rolling,
}: {
  label: string
  used: number
  cap: number | null
  unit?: string
  resetAt?: string | null
  /**
   * When true, ``resetAt`` is interpreted as a rolling-window reset
   * (i.e. the moment the oldest counted row ages out) rather than a
   * calendar boundary. We include time-of-day in the rendered string
   * so it doesn't read like a midnight reset.
   */
  rolling?: boolean
}) {
  const unlimited = cap === null
  const pct = !unlimited && cap && cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0
  const over = pct >= 95
  const warn = !over && pct >= 80
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-c-text-secondary">{label}</span>
        <span className={over ? 'text-red-400' : warn ? 'text-yellow-400' : 'text-c-text-secondary'}>
          {unlimited ? (
            <>{formatNum(used)}{unit ? ` ${unit}` : ''} · unlimited</>
          ) : (
            <>{formatNum(used)} / {cap}{unit ? ` ${unit}` : ''} <span className="text-c-text-tertiary">({pct}%)</span></>
          )}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1.5 rounded-full bg-c-hover-bg overflow-hidden">
          <div
            className={`h-full ${over ? 'bg-red-500' : warn ? 'bg-yellow-500' : 'bg-cpoint-turquoise'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {resetAt && (
        <div className="text-xs text-c-text-tertiary">
          {rolling ? `Next slot frees up ${formatRollingReset(resetAt)}` : `Resets ${new Date(resetAt).toLocaleDateString()}`}
        </div>
      )}
    </div>
  )
}

// --- Billing / Payment ---------------------------------------------------

function BillingTab() {
  const { t } = useTranslation()
  const [data, setData] = useState<BillingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [portalErr, setPortalErr] = useState<string | null>(null)
  const [portalBusy, setPortalBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/me/billing', { credentials: 'include', headers: { Accept: 'application/json' } })
      const body: BillingResponse = await res.json()
      if (!body.success) throw new Error('Failed to load billing')
      setData(body)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openPortal = useCallback(async () => {
    setPortalBusy(true)
    try {
      const res = await fetch('/api/me/billing/portal', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ return_path: '/account_settings' }),
      })
      const body = await res.json()
      if (body?.success && body.url) {
        window.location.href = body.url
      } else {
        setPortalErr(portalErrorMessage(body, t))
      }
    } catch (e) {
      setPortalErr(e instanceof Error ? e.message : String(e))
    } finally {
      setPortalBusy(false)
    }
  }, [t])

  if (loading) return <div className="text-c-text-tertiary text-sm">{t('billing.loading_billing')}</div>
  if (err) return <div className="text-red-400 text-sm">{err}</div>
  if (!data) return null

  const sub = data.stripe.subscription
  const provider = String(data.plan.subscription_provider || 'stripe').toLowerCase()
  const storeBilled = provider === 'apple' || provider === 'google'
  const isIos = Capacitor.getPlatform() === 'ios'
  const iosWebBilled = isIos && provider === 'stripe'
  const iosOtherStoreBilled = isIos && provider === 'google'
  const canOpenStoreManagement = provider === 'apple' || !isIos
  const renewal = sub?.current_period_end ? new Date(sub.current_period_end * 1000) : null
  const trial = sub?.trial_end ? new Date(sub.trial_end * 1000) : null
  let amount: string | null = null
  if (sub?.price_amount_cents != null && sub.price_currency) {
    const v = (sub.price_amount_cents / 100).toFixed(2)
    amount = `${sub.price_currency} ${v}${sub.price_interval ? ` / ${sub.price_interval}` : ''}`
  }

  return (
    <div className="space-y-5">
      {!data.stripe.configured && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
          Billing is not configured on this environment. Contact support to manage your subscription.
        </div>
      )}

      <section className="rounded-xl border border-c-border bg-c-hover-bg p-4 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-c-text-tertiary">Subscription</div>
          <div className="text-base font-semibold mt-0.5 capitalize">
            {data.plan.tier}
            {data.plan.inherited_from?.startsWith('enterprise:') && (
              <span className="ml-2 text-xs text-c-text-tertiary">via Enterprise</span>
            )}
            <span className="ml-2 rounded-full border border-c-border bg-c-hover-bg px-2 py-0.5 text-[11px] font-medium text-c-text-tertiary">
              {providerBadge(provider)}
            </span>
          </div>
        </div>

        {storeBilled ? (
          <div className="text-sm text-c-text-secondary">
            {iosOtherStoreBilled
              ? t('billing.managed_original_platform')
              : t('billing.managed_provider_subscription', { provider: providerLabel(provider) })}
          </div>
        ) : iosWebBilled ? (
          <div className="text-sm text-c-text-secondary">
            {t('billing.managed_on_web_ios')}
          </div>
        ) : sub ? (
          <div className="text-sm text-c-text-secondary space-y-1">
            <div>{t('billing.subscription_status')}: <span className="font-medium capitalize">{sub.status}</span>
              {sub.cancel_at_period_end && (
                <span className="ml-2 text-xs text-yellow-400">{t('billing.cancels_at_period_end')}</span>
              )}
            </div>
            {amount && <div>{t('billing.price_label')}: <span className="font-medium">{amount}</span></div>}
            {trial && sub.status === 'trialing' && (
              <div>{t('billing.trial_ends')}: <span className="font-medium">{trial.toLocaleDateString()}</span></div>
            )}
            {renewal && sub.status !== 'trialing' && (
              <div>
                {sub.cancel_at_period_end ? t('billing.ends') : t('billing.renews')}:{' '}
                <span className="font-medium">{renewal.toLocaleDateString()}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-c-text-tertiary">{t('billing.no_active_subscription')}</div>
        )}

        {portalErr && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-100">
            {portalErr}
          </div>
        )}

        {storeBilled && canOpenStoreManagement ? (
          <button
            onClick={() => openExternalBillingUrl(
              provider === 'apple'
                ? 'https://apps.apple.com/account/subscriptions'
                : 'https://play.google.com/store/account/subscriptions',
            )}
            className="w-full mt-2 bg-c-active-bg border border-white/20 rounded-lg py-2.5 text-sm font-semibold hover:bg-white/20 transition"
          >
            <i className="fa-regular fa-credit-card mr-2" />
            {t('billing.open_provider_subscriptions', { provider: providerLabel(provider) })}
          </button>
        ) : !iosWebBilled && !iosOtherStoreBilled && data.stripe.portal_available && (
          <button
            onClick={openPortal}
            disabled={portalBusy}
            className="w-full mt-2 bg-c-active-bg border border-white/20 rounded-lg py-2.5 text-sm font-semibold hover:bg-white/20 disabled:opacity-50 transition"
          >
            <i className="fa-regular fa-credit-card mr-2" />
            {portalBusy
              ? t('billing.opening_stripe')
              : t('billing.open_billing_portal')}
          </button>
        )}
      </section>

      <PaidCommunitiesBillingSection />

      {data.plan.tier !== 'premium' && !data.plan.is_special && (
        <button
          onClick={() => { window.location.href = '/subscription_plans' }}
          className="w-full bg-cpoint-turquoise text-black font-semibold py-3 rounded-lg hover:brightness-90 transition"
        >
          {t('billing.upgrade_to_premium')}
        </button>
      )}
    </div>
  )
}

function portalErrorMessage(body: any, t: (key: string, opts?: Record<string, any>) => string): string {
  const provider = String(body?.billing_provider || '').toLowerCase()
  if (body?.reason === 'store_billing_active') {
    return provider === 'google' && Capacitor.getPlatform() === 'ios'
      ? t('billing.portal_error_original_platform')
      : t('billing.portal_error_store', { provider: providerLabel(provider) })
  }
  if (body?.reason === 'stripe_mode_mismatch') {
    return t('billing.portal_error_mode_mismatch')
  }
  if (body?.reason === 'no_customer') {
    return t('billing.portal_error_no_customer')
  }
  if (body?.reason === 'stripe_not_configured') {
    return t('billing.portal_error_not_configured')
  }
  return body?.error || t('billing.error_billing_portal')
}

function PaymentHistoryTab() {
  const { t } = useTranslation()
  const [data, setData] = useState<PaymentHistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch('/api/me/payment-history', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const body: PaymentHistoryResponse = await res.json()
        if (!res.ok || !body?.success) throw new Error('Failed to load payment history')
        if (!cancelled) {
          setData(body)
          setErr(null)
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className="text-c-text-tertiary text-sm">{t('billing.loading_payments')}</div>
  if (err) return <div className="text-red-400 text-sm">{err}</div>

  const payments = data?.payments || []
  if (payments.length === 0) {
    return (
      <section className="rounded-xl border border-c-border bg-c-hover-bg p-4">
        <h3 className="text-sm font-semibold text-c-text-primary">{t('billing.payment_history_title')}</h3>
        <p className="mt-2 text-sm text-c-text-tertiary">{t('billing.payment_history_empty')}</p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-c-border bg-c-hover-bg overflow-hidden">
      <div className="px-4 py-3 border-b border-c-border">
        <h3 className="text-sm font-semibold text-c-text-primary">{t('billing.payment_history_title')}</h3>
        <p className="mt-1 text-xs text-c-text-tertiary">{t('billing.payment_history_subtitle')}</p>
      </div>
      <ul className="divide-y divide-c-border">
        {payments.map((payment, idx) => {
          const paidAt = payment.paid_at ? new Date(payment.paid_at) : null
          const periodEnd = payment.period_end ? new Date(payment.period_end) : null
          const label = payment.scope === 'community'
            ? payment.community_name || payment.label || t('billing.payment_scope_community')
            : payment.label || t('billing.payment_scope_personal')
          return (
            <li key={`${payment.stripe_invoice_id || idx}`} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-c-text-primary truncate">{label}</div>
                  <div className="mt-1 text-xs text-c-text-tertiary">
                    {paidAt ? paidAt.toLocaleDateString() : t('billing.payment_date_unknown')}
                    {periodEnd && (
                      <span> · {t('billing.payment_period_ends')} {periodEnd.toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold text-c-text-primary">
                    {formatMoney(payment.amount_paid_cents, payment.currency)}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-c-text-tertiary">
                    {payment.scope === 'community' ? t('billing.payment_scope_community') : t('billing.payment_scope_personal')}
                  </div>
                </div>
              </div>
              {payment.hosted_invoice_url && (
                <button
                  type="button"
                  onClick={() => openExternalBillingUrl(payment.hosted_invoice_url || '')}
                  className="mt-2 text-xs font-semibold text-cpoint-turquoise hover:underline"
                >
                  {t('billing.view_invoice')}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// --- helpers -------------------------------------------------------------

function capLabel(cap: number | null, unit: string, unlimitedLabel: string): string {
  if (cap === null) return unlimitedLabel
  return `${cap}${unit ? ` ${unit}` : ''}`
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function formatMoney(cents: number, currency?: string | null): string {
  const code = (currency || 'EUR').toUpperCase()
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
    }).format((cents || 0) / 100)
  } catch {
    return `${code} ${((cents || 0) / 100).toFixed(2)}`
  }
}
