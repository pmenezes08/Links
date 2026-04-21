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
 *   - Notifications : email + push preferences (placeholder, renders the
 *                     existing notifications panel copy)
 *
 * The modal never calls Stripe directly — it hits `/api/me/billing` for
 * state and `/api/me/billing/portal` when the user clicks "Manage payment
 * method", then redirects to the returned Stripe-hosted URL.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEntitlements } from '../../hooks/useEntitlements'

export type MembershipTab = 'plan' | 'ai' | 'billing' | 'payment' | 'notifications'

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
    } | null
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

const TABS: { id: MembershipTab; label: string; icon: string }[] = [
  { id: 'plan', label: 'Plan', icon: 'fa-id-card' },
  { id: 'ai', label: 'AI Usage', icon: 'fa-robot' },
  { id: 'billing', label: 'Billing', icon: 'fa-receipt' },
  { id: 'payment', label: 'Payment', icon: 'fa-credit-card' },
  { id: 'notifications', label: 'Notifications', icon: 'fa-bell' },
]

export default function ManageMembershipModal({ open, onClose, initialTab = 'plan' }: Props) {
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
        className="fixed inset-0 bg-black/70 z-50"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Manage Membership"
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div
          onClick={e => e.stopPropagation()}
          className="w-full max-w-3xl max-h-[90vh] overflow-hidden bg-[#0f1114] border border-white/10 rounded-2xl shadow-2xl flex flex-col"
        >
          <header className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <div>
              <div className="text-xs text-white/50">Account</div>
              <h2 className="text-lg font-semibold">Manage Membership</h2>
            </div>
            <button
              onClick={onClose}
              className="text-white/60 hover:text-white transition"
              aria-label="Close"
            >
              <i className="fa-solid fa-xmark text-lg" />
            </button>
          </header>

          <div className="flex flex-1 overflow-hidden">
            <nav className="w-44 shrink-0 border-r border-white/10 p-2 overflow-y-auto hidden sm:block">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition ${
                    tab === t.id
                      ? 'bg-[#4db6ac]/15 text-[#4db6ac]'
                      : 'text-white/70 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <i className={`fa-solid ${t.icon} w-4 text-center`} />
                  {t.label}
                </button>
              ))}
            </nav>

            <div className="flex-1 overflow-y-auto">
              <div className="sm:hidden flex gap-1 p-2 border-b border-white/10 overflow-x-auto">
                {TABS.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap transition ${
                      tab === t.id
                        ? 'bg-[#4db6ac]/15 text-[#4db6ac]'
                        : 'bg-white/5 text-white/70'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="p-5">
                {tab === 'plan' && <PlanTab />}
                {tab === 'ai' && <AiUsageTab />}
                {(tab === 'billing' || tab === 'payment') && <BillingTab variant={tab} />}
                {tab === 'notifications' && <NotificationsTab />}
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
  const { entitlements, loading } = useEntitlements()
  if (loading || !entitlements) return <div className="text-white/60 text-sm">Loading plan…</div>

  const tier = entitlements.tier
  const isEnterprise = !!(entitlements as { inherited_from?: string | null })?.inherited_from?.startsWith('enterprise:')

  const tierLabel =
    entitlements.is_special
      ? 'Special'
      : tier === 'premium'
        ? isEnterprise ? 'Premium (via Enterprise)' : 'Premium'
        : tier === 'trial'
          ? 'Free trial (Premium features)'
          : tier === 'free'
            ? 'Free'
            : tier

  // Premium / Special have no user-tier member cap — their owned
  // communities use each community's own tier (Free 25, Paid L1 75,
  // L2 150, L3 250, Enterprise unlimited). Showing "Unlimited" here
  // would mislead — the cap depends on the community, not on the plan.
  const perCommunityLabel =
    entitlements.members_per_owned_community == null
      ? 'Based on community tier'
      : capLabel(entitlements.members_per_owned_community, '')

  const rows: Array<[string, string]> = [
    ['Steve uses / month', capLabel(entitlements.steve_uses_per_month, '')],
    ['Voice transcription / month', capLabel(entitlements.whisper_minutes_per_month, 'min')],
    ['Communities you can own', capLabel(entitlements.communities_max, '')],
    ['Members per community', perCommunityLabel],
  ]

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="text-xs uppercase tracking-wide text-white/50">Current plan</div>
        <div className="flex items-center gap-3 mt-1">
          <h3 className="text-xl font-semibold">{tierLabel}</h3>
          {entitlements.is_special && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-200 border border-purple-500/30">
              staff
            </span>
          )}
        </div>
        {isEnterprise && (
          <p className="text-xs text-white/60 mt-2">
            Your Premium features come from an Enterprise community you belong to.
            Leaving that community will pause these benefits.
          </p>
        )}
      </section>

      <section>
        <h4 className="text-sm font-semibold mb-3">Included</h4>
        <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="text-white/70">{k}</span>
              <span className="font-medium">{v}</span>
            </div>
          ))}
        </div>
      </section>

      {!entitlements.is_special && tier !== 'premium' && (
        <button
          onClick={() => { window.location.href = '/subscription_plans' }}
          className="w-full bg-[#4db6ac] text-black font-semibold py-3 rounded-lg hover:bg-[#3da398] transition"
        >
          Upgrade to Premium
        </button>
      )}
    </div>
  )
}

// --- AI Usage ------------------------------------------------------------

function AiUsageTab() {
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
  if (!entitlements || !usage) return <div className="text-white/60 text-sm">Loading usage…</div>

  return (
    <div className="space-y-5">
      <UsageRow
        label="Steve uses this month"
        used={usage.monthly_steve_used}
        cap={usage.monthly_steve_cap}
        resetAt={usage.resets_at_monthly}
      />
      <UsageRow
        label="Voice transcription this month"
        used={usage.whisper_minutes_used}
        cap={usage.whisper_minutes_cap}
        unit="min"
        resetAt={usage.resets_at_monthly}
      />
      <UsageRow
        label="Steve uses today"
        used={usage.daily_used}
        cap={usage.daily_cap}
        resetAt={usage.resets_at_daily}
      />

      {aiData?.by_surface && (
        <section>
          <h4 className="text-sm font-semibold mb-2">Breakdown by surface</h4>
          <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
            {Object.entries(aiData.by_surface).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-white/70 capitalize">{k.replace(/_/g, ' ')}</span>
                <span className="font-mono text-white/90">{v}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function UsageRow({
  label, used, cap, unit, resetAt,
}: {
  label: string
  used: number
  cap: number | null
  unit?: string
  resetAt?: string | null
}) {
  const unlimited = cap === null
  const pct = !unlimited && cap && cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0
  const over = pct >= 95
  const warn = !over && pct >= 80
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-white/80">{label}</span>
        <span className={over ? 'text-red-400' : warn ? 'text-yellow-400' : 'text-white/80'}>
          {unlimited ? (
            <>{formatNum(used)}{unit ? ` ${unit}` : ''} · unlimited</>
          ) : (
            <>{formatNum(used)} / {cap}{unit ? ` ${unit}` : ''} <span className="text-white/40">({pct}%)</span></>
          )}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            className={`h-full ${over ? 'bg-red-500' : warn ? 'bg-yellow-500' : 'bg-[#4db6ac]'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {resetAt && (
        <div className="text-xs text-white/40">Resets {new Date(resetAt).toLocaleDateString()}</div>
      )}
    </div>
  )
}

// --- Billing / Payment ---------------------------------------------------

function BillingTab({ variant }: { variant: 'billing' | 'payment' }) {
  const [data, setData] = useState<BillingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
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
        setErr(body?.error || 'Failed to open billing portal')
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setPortalBusy(false)
    }
  }, [])

  if (loading) return <div className="text-white/60 text-sm">Loading billing…</div>
  if (err) return <div className="text-red-400 text-sm">{err}</div>
  if (!data) return null

  const sub = data.stripe.subscription
  const renewal = sub?.current_period_end ? new Date(sub.current_period_end * 1000) : null
  const trial = sub?.trial_end ? new Date(sub.trial_end * 1000) : null
  const amount = useMemo(() => {
    if (sub?.price_amount_cents == null || !sub.price_currency) return null
    const v = (sub.price_amount_cents / 100).toFixed(2)
    return `${sub.price_currency} ${v}${sub.price_interval ? ` / ${sub.price_interval}` : ''}`
  }, [sub])

  return (
    <div className="space-y-5">
      {!data.stripe.configured && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
          Billing is not configured on this environment. Contact support to manage your subscription.
        </div>
      )}

      <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-white/50">Subscription</div>
          <div className="text-base font-semibold mt-0.5 capitalize">
            {data.plan.tier}
            {data.plan.inherited_from?.startsWith('enterprise:') && (
              <span className="ml-2 text-xs text-white/50">via Enterprise</span>
            )}
          </div>
        </div>

        {sub ? (
          <div className="text-sm text-white/80 space-y-1">
            <div>Status: <span className="font-medium capitalize">{sub.status}</span>
              {sub.cancel_at_period_end && (
                <span className="ml-2 text-xs text-yellow-400">cancels at period end</span>
              )}
            </div>
            {amount && <div>Price: <span className="font-medium">{amount}</span></div>}
            {trial && sub.status === 'trialing' && (
              <div>Trial ends: <span className="font-medium">{trial.toLocaleDateString()}</span></div>
            )}
            {renewal && sub.status !== 'trialing' && (
              <div>
                {sub.cancel_at_period_end ? 'Ends' : 'Renews'}:{' '}
                <span className="font-medium">{renewal.toLocaleDateString()}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-white/60">
            No active subscription linked to your email.
          </div>
        )}

        {data.stripe.portal_available && (
          <button
            onClick={openPortal}
            disabled={portalBusy}
            className="w-full mt-2 bg-white/10 border border-white/20 rounded-lg py-2.5 text-sm font-semibold hover:bg-white/20 disabled:opacity-50 transition"
          >
            <i className="fa-regular fa-credit-card mr-2" />
            {portalBusy ? 'Opening Stripe…' : variant === 'payment' ? 'Manage payment method' : 'Open billing portal'}
          </button>
        )}
      </section>

      {data.plan.tier !== 'premium' && !data.plan.is_special && (
        <button
          onClick={() => { window.location.href = '/subscription_plans' }}
          className="w-full bg-[#4db6ac] text-black font-semibold py-3 rounded-lg hover:bg-[#3da398] transition"
        >
          Upgrade to Premium
        </button>
      )}
    </div>
  )
}

// --- Notifications -------------------------------------------------------

function NotificationsTab() {
  return (
    <div className="space-y-4 text-sm">
      <p className="text-white/70">
        Device notification settings are managed from the main Account Settings screen.
      </p>
      <button
        onClick={() => { window.location.href = '/account_settings' }}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-white/20 hover:border-white/40 transition"
      >
        <i className="fa-solid fa-gear" />
        Open notification settings
      </button>
    </div>
  )
}

// --- helpers -------------------------------------------------------------

function capLabel(cap: number | null, unit: string): string {
  if (cap === null) return 'Unlimited'
  return `${cap}${unit ? ` ${unit}` : ''}`
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
