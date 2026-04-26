import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

/**
 * KB-driven subscriptions hub — Personal + Community redesign.
 *
 * The page intentionally exposes only TWO entry tiles ("Personal" and
 * "Community"). Picking Community opens a modal listing the paid
 * tiers (L1, L2, L3, Enterprise) plus a "Community Add-ons" row that
 * opens a sub-modal showing the Steve and Networking packages as
 * "Coming soon" with mailto CTAs.
 *
 * Pricing, copy, and Stripe price IDs all come from
 * ``GET /api/kb/pricing`` so admins can edit them through admin-web
 * without code changes. The backend strips the opposite mode's IDs
 * before emitting (test-mode Stripe keys never see live IDs and
 * vice versa), so this component can trust the ``stripe_price_id``
 * value it receives.
 *
 * Live SKUs:
 *   - ``premium``         — Personal card → Stripe Checkout
 *   - ``community_tier``  — Community modal → CommunityPickerModal → Checkout
 * Coming-soon SKUs (no checkout, mailto only):
 *   - ``steve_package``
 *   - ``networking``
 * Enterprise tier is a sales-driven mailto — not a Stripe SKU.
 */

// ---------------------------------------------------------------------------
// Types mirroring backend/blueprints/subscriptions.py _premium_payload etc.
// ---------------------------------------------------------------------------

interface PremiumPayload {
  sku: 'premium'
  name: string
  tagline: string
  price_eur: number | string | null
  billing_cycle: string
  currency: string
  features: string[]
  cta_label: string
  stripe_mode: 'test' | 'live'
  stripe_price_id: string
  purchasable: boolean
}

interface CommunityTierLevel {
  tier_code: 'paid_l1' | 'paid_l2' | 'paid_l3'
  level_label: string
  price_eur: number | string | null
  max_members: number | null
  media_gb: number | null
  stripe_price_id: string
  purchasable: boolean
}

interface CommunityTierPayload {
  sku: 'community_tier'
  name: string
  tagline: string
  billing_cycle: string
  currency: string
  tiers: CommunityTierLevel[]
  cta_label: string
  stripe_mode: 'test' | 'live'
}

interface ComingSoonPayload {
  sku: 'steve_package' | 'networking_package'
  name: string
  tagline: string
  price_eur: number | string | null
  billing_cycle: string
  currency: string
  features?: string[]
  credit_pool?: number | null
  purchasable: false
  coming_soon: true
  stripe_mode: 'test' | 'live'
  stripe_price_id?: string
}

interface PricingPayload {
  success: boolean
  stripe_mode: 'test' | 'live'
  publishable_key_available: boolean
  sku: {
    premium: PremiumPayload
    community_tier: CommunityTierPayload
    steve_package: ComingSoonPayload
    networking: ComingSoonPayload
  }
}

interface Community {
  id: number
  name: string
  creator_username?: string
  role?: string
  tier?: string
}

interface ActivePersonalSubscription {
  active: boolean
  subscription?: string
  subscription_status?: string | null
  current_period_end?: string | null
  cancel_at_period_end?: boolean
  benefits_end_at?: string | null
  is_special?: boolean
}

interface ActiveCommunitySubscription {
  id: number
  name: string
  tier?: string
  subscription_status?: string | null
  current_period_end?: string | null
  cancel_at_period_end?: boolean
  benefits_end_at?: string | null
}

interface ActiveSubscriptionsPayload {
  success: boolean
  personal: ActivePersonalSubscription
  communities: ActiveCommunitySubscription[]
}

// ---------------------------------------------------------------------------
// Small display helpers
// ---------------------------------------------------------------------------

function formatEur(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'TBD'
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return 'TBD'
  return `€${n.toFixed(2).replace(/\.00$/, '')}`
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

const SALES_EMAIL = 'sales@c-point.co'

function resetSubscriptionPageScroll() {
  const reset = () => {
    const region = document.querySelector<HTMLElement>('[data-scroll-region="true"]')
    if (region) region.scrollTop = 0
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  requestAnimationFrame(reset)
}

function storePendingCheckout(body: Record<string, string | number>) {
  try {
    sessionStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify({
      plan_id: body.plan_id,
      community_id: body.community_id,
      tier_code: body.tier_code,
      created_at: Date.now(),
    }))
  } catch {
    // sessionStorage can be unavailable in private contexts.
  }
}

function maybeConfirmPendingCheckout(active: ActiveSubscriptionsPayload) {
  try {
    const raw = sessionStorage.getItem(PENDING_CHECKOUT_KEY)
    if (!raw) return
    const pending = JSON.parse(raw) as {
      plan_id?: string
      community_id?: number
      tier_code?: string
      created_at?: number
    }
    if (pending.created_at && Date.now() - pending.created_at > 1000 * 60 * 30) {
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY)
      return
    }
    if (pending.plan_id === 'premium' && active.personal?.active) {
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY)
      return 'Premium is active.'
    }
    const communityId = Number(pending.community_id || 0)
    const match = active.communities?.find((c) => (
      c.id === communityId
      && (!pending.tier_code || String(c.tier || '').toLowerCase() === String(pending.tier_code).toLowerCase())
    ))
    if (match) {
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY)
      return `${match.name} is active on ${tierLabel(match.tier)}.`
    }
  } catch {
    try { sessionStorage.removeItem(PENDING_CHECKOUT_KEY) } catch {}
  }
  return null
}

function tierLabel(tier?: string | null) {
  const value = String(tier || '').toLowerCase()
  if (value === 'paid_l1') return 'Paid L1'
  if (value === 'paid_l2') return 'Paid L2'
  if (value === 'paid_l3') return 'Paid L3'
  if (value === 'free') return 'Free'
  return tier || 'active'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ModalView = 'community' | 'addons' | 'picker' | null
type PageMode = 'choose' | 'active' | null

const PENDING_CHECKOUT_KEY = 'cpoint_pending_subscription_checkout'

export default function SubscriptionPlans() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const location = useLocation()
  const [pricing, setPricing] = useState<PricingPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [modalError, setModalError] = useState<string | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [view, setView] = useState<ModalView>(null)
  const [pageMode, setPageMode] = useState<PageMode>(null)
  const [pendingTier, setPendingTier] = useState<CommunityTierLevel | null>(null)
  const [activeSubscriptions, setActiveSubscriptions] = useState<ActiveSubscriptionsPayload | null>(null)

  useEffect(() => {
    setTitle('Subscriptions')
  }, [setTitle])

  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const preselectedCommunityId = queryParams.get('community_id') || ''

  useEffect(() => {
    const qsStatus = queryParams.get('status')
    if (qsStatus === 'cancelled') {
      setStatus('Checkout cancelled — no charge was made.')
      resetSubscriptionPageScroll()
    }
  }, [queryParams])

  useEffect(() => {
    const requestedMode = queryParams.get('mode')
    const requestedOpen = queryParams.get('open')
    if (requestedMode === 'choose' || requestedOpen === 'community_plans') {
      setPageMode('choose')
    }
    if (requestedOpen === 'community_plans') {
      setModalError(null)
      setView('community')
      resetSubscriptionPageScroll()
    }
  }, [queryParams])

  const loadActiveSubscriptions = useCallback(async () => {
    const res = await fetch('/api/me/subscriptions', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    const data: ActiveSubscriptionsPayload = await res.json()
    if (res.ok && data?.success) {
      setActiveSubscriptions(data)
      const successMessage = maybeConfirmPendingCheckout(data)
      if (successMessage) {
        setStatus(successMessage)
        setView(null)
        setPageMode('active')
        setPendingTier(null)
        setModalError(null)
        resetSubscriptionPageScroll()
      }
    }
    return data
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [pricingRes, activeRes] = await Promise.all([
          fetch('/api/kb/pricing', {
            credentials: 'include',
            headers: { Accept: 'application/json' },
          }),
          loadActiveSubscriptions().catch(() => null),
        ])
        if (!pricingRes.ok) {
          throw new Error(`HTTP ${pricingRes.status}`)
        }
        const data: PricingPayload = await pricingRes.json()
        if (!cancelled) {
          if (!data.success) {
            throw new Error('Pricing load failed')
          }
          setPricing(data)
          if (activeRes?.success) setActiveSubscriptions(activeRes)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load pricing')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [loadActiveSubscriptions])

  useEffect(() => {
    const resetCheckoutState = () => {
      setCheckoutLoading(null)
      void loadActiveSubscriptions().catch(() => {})
    }
    window.addEventListener('pageshow', resetCheckoutState)
    document.addEventListener('visibilitychange', resetCheckoutState)
    return () => {
      window.removeEventListener('pageshow', resetCheckoutState)
      document.removeEventListener('visibilitychange', resetCheckoutState)
    }
  }, [loadActiveSubscriptions])

  const startCheckout = useCallback(
    async (
      body: Record<string, string | number>,
      key: string,
      options?: {
        onError?: (message: string) => void
        onBeforeRedirect?: () => void
      },
    ) => {
      setCheckoutLoading(key)
      setError(null)
      options?.onError?.('')
      try {
        const res = await fetch('/api/stripe/create_checkout_session', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok || !data?.success) {
          const communityId = Number(data?.community_id || body.community_id || 0)
          if (data?.reason === 'already_subscribed' && communityId > 0) {
            const portalRes = await fetch(`/api/me/billing/portal?community_id=${communityId}`, {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: JSON.stringify({ return_path: `/community/${communityId}/edit` }),
            })
            const portalData = await portalRes.json()
            if (portalRes.ok && portalData?.success && portalData?.url) {
              options?.onBeforeRedirect?.()
              window.location.assign(portalData.url)
              return
            }
            throw new Error(portalData?.error || 'Unable to open billing portal')
          }
          throw new Error(data?.error || 'Unable to start checkout')
        }
        if (data.url) {
          storePendingCheckout(body)
          options?.onBeforeRedirect?.()
          window.location.assign(data.url)
          return
        }
        throw new Error('No checkout URL returned')
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to start checkout'
        if (options?.onError) options.onError(message)
        else setError(message)
        setCheckoutLoading(null)
      }
    },
    [],
  )

  const onSubscribePremium = useCallback(() => {
    startCheckout({ plan_id: 'premium', billing_cycle: 'monthly' }, 'premium')
  }, [startCheckout])

  const onPickTier = useCallback(
    (tier: CommunityTierLevel) => {
      setPendingTier(tier)
      setModalError(null)
      setView('picker')
    },
    [],
  )

  const onCommunityChosen = useCallback(
    async (communityId: number) => {
      if (!pendingTier) return
      const activeCommunity = activeSubscriptions?.communities?.find((item) => item.id === communityId)
      if (activeCommunity) {
        const key = `change-tier:${communityId}:${pendingTier.tier_code}`
        setCheckoutLoading(key)
        setModalError(null)
        try {
          const res = await fetch(`/api/communities/${communityId}/billing/change-tier`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ tier_code: pendingTier.tier_code }),
          })
          const data = await res.json()
          if (!res.ok || !data?.success) {
            throw new Error(data?.error || 'Unable to change tier')
          }
          setStatus(`${activeCommunity.name} changed to ${tierLabel(pendingTier.tier_code)}.`)
          setView(null)
          setPendingTier(null)
          resetSubscriptionPageScroll()
          await loadActiveSubscriptions()
        } catch (err) {
          setModalError(err instanceof Error ? err.message : 'Unable to change tier')
        } finally {
          setCheckoutLoading(null)
        }
        return
      }
      startCheckout(
        {
          plan_id: 'community_tier',
          community_id: communityId,
          tier_code: pendingTier.tier_code,
        },
        `community_tier:${pendingTier.tier_code}:${communityId}`,
        {
          onError: setModalError,
          onBeforeRedirect: () => {
            setView(null)
            setPendingTier(null)
          },
        },
      )
    },
    [activeSubscriptions, loadActiveSubscriptions, pendingTier, startCheckout],
  )

  return (
    <div className="min-h-screen bg-black text-white pt-16 pb-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <header className="text-center pt-8 pb-10">
          <p className="text-xs uppercase tracking-[0.28em] text-cpoint-turquoise/80">
            Memberships
          </p>
          <h1 className="mt-4 text-3xl sm:text-4xl font-semibold tracking-tight">
            Choose your plan.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-white/60 text-base leading-relaxed">
            Upgrade your own experience or your community. Month-to-month
            — cancel any time from the billing portal.
          </p>
          {pricing?.stripe_mode === 'test' && (
            <p className="mt-4 text-[11px] uppercase tracking-[0.25em] text-amber-300/80">
              Test mode — no real charges will be made
            </p>
          )}
        </header>

        {status && (
          <div className="mb-6 rounded-xl border border-cpoint-turquoise/60 bg-cpoint-turquoise/10 p-4 text-sm text-white/90 shadow-[0_0_0_1px_rgba(0,206,200,0.12)]">
            {status}
          </div>
        )}
        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        {loading && <PricingSkeleton />}

        {!loading && pricing && (
          <div className="space-y-10">
            <ModeHeader mode={pageMode} onChange={() => setPageMode(null)} />
            {pageMode === 'choose' && (
              <section aria-labelledby="subscriptions-heading">
                <div className="mb-4">
                  <h2 id="subscriptions-heading" className="text-xl font-semibold">Choose your plan</h2>
                  <p className="mt-1 text-sm text-white/55">Choose a personal plan or upgrade a parent community.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <PersonalCard
                    payload={pricing.sku.premium}
                    onSubscribe={onSubscribePremium}
                    loading={checkoutLoading === 'premium'}
                  />
                  <CommunityCard
                    payload={pricing.sku.community_tier}
                    onOpen={() => {
                      setModalError(null)
                      setView('community')
                    }}
                  />
                </div>
              </section>
            )}
            {pageMode === 'active' && (
              <ActiveSubscriptionsSection
                active={activeSubscriptions}
                onManageCommunity={(id) => navigate(`/community/${id}/edit`)}
              />
            )}
          </div>
        )}

        <p className="mt-12 text-center text-xs text-white/40">
          Questions?{' '}
          <a
            href={`mailto:${SALES_EMAIL}`}
            className="text-cpoint-turquoise hover:underline"
          >
            {SALES_EMAIL}
          </a>
        </p>
      </div>

      {!loading && pricing && pageMode === null && (
        <EntryChoiceModal
          onChoosePlans={() => setPageMode('choose')}
          onChooseActive={() => setPageMode('active')}
        />
      )}

      {view === 'community' && pricing && (
        <CommunityModal
          payload={pricing.sku.community_tier}
          onPickTier={onPickTier}
          onOpenAddons={() => setView('addons')}
          onClose={() => setView(null)}
          pendingKey={checkoutLoading}
          error={modalError}
        />
      )}

      {view === 'addons' && pricing && (
        <AddonsModal
          steve={pricing.sku.steve_package}
          networking={pricing.sku.networking}
          onBack={() => setView('community')}
          onClose={() => setView(null)}
        />
      )}

      {view === 'picker' && pendingTier && (
        <CommunityPickerModal
          tier={pendingTier}
          preselectedCommunityId={preselectedCommunityId}
          onCancel={() => {
            setView('community')
            setPendingTier(null)
            setModalError(null)
          }}
          onChoose={onCommunityChosen}
          activeSubscriptions={activeSubscriptions}
          error={modalError}
          loading={!!checkoutLoading}
          onCreate={() => {
            setView(null)
            setModalError(null)
            navigate('/communities?create=1')
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Top-level cards
// ---------------------------------------------------------------------------

function PricingSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="rounded-2xl border border-white/10 bg-white/5 p-8 animate-pulse"
          style={{ minHeight: 260 }}
        />
      ))}
    </div>
  )
}

function EntryChoiceModal({
  onChoosePlans,
  onChooseActive,
}: {
  onChoosePlans: () => void
  onChooseActive: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose subscription view"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 backdrop-blur sm:items-center p-0 sm:p-4"
    >
      <div className="w-full sm:max-w-xl rounded-t-[28px] sm:rounded-[28px] border border-white/10 bg-[#070707] p-6 shadow-2xl shadow-black">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cpoint-turquoise">
          Subscriptions
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
          What would you like to manage?
        </h2>
        <p className="mt-2 text-sm leading-6 text-white/55">
          Choose a new plan or review what is already active. You can switch views at any time.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onChoosePlans}
            className="rounded-2xl border border-cpoint-turquoise/35 bg-cpoint-turquoise/10 p-5 text-left transition hover:bg-cpoint-turquoise/15"
          >
            <span className="text-sm font-semibold text-white">Choose your plan</span>
            <span className="mt-2 block text-xs leading-5 text-white/55">
              Personal Premium or Community L1/L2/L3.
            </span>
          </button>
          <button
            type="button"
            onClick={onChooseActive}
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left transition hover:border-cpoint-turquoise/35 hover:bg-white/[0.06]"
          >
            <span className="text-sm font-semibold text-white">Active subscriptions</span>
            <span className="mt-2 block text-xs leading-5 text-white/55">
              See current plans, renewals, and tier changes.
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

function ModeHeader({ mode, onChange }: { mode: PageMode; onChange: () => void }) {
  if (!mode) return null
  return (
    <div className="flex items-center justify-between rounded-2xl border border-cpoint-turquoise/45 bg-cpoint-turquoise/[0.04] px-4 py-3">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-white/35">Current view</p>
        <p className="mt-0.5 text-sm font-medium text-white">
          {mode === 'choose' ? 'Choose your plan' : 'Active subscriptions'}
        </p>
      </div>
      <button
        type="button"
        onClick={onChange}
        className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-white hover:bg-white/5"
      >
        Switch
      </button>
    </div>
  )
}

function PersonalCard({
  payload,
  onSubscribe,
  loading,
}: {
  payload: PremiumPayload
  onSubscribe: () => void
  loading: boolean
}) {
  const disabled = !payload.purchasable || loading
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-8 flex flex-col">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
            Personal
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{payload.name}</h2>
        </div>
        <i className="fa-solid fa-crown text-cpoint-turquoise text-2xl" aria-hidden="true" />
      </div>
      <p className="mt-3 text-sm text-white/60">{payload.tagline}</p>

      <div className="mt-6 flex items-baseline gap-2">
        <span className="text-4xl font-bold">{formatEur(payload.price_eur)}</span>
        <span className="text-white/50">/ month</span>
      </div>

      {payload.features.length > 0 && (
        <ul className="mt-6 space-y-3 text-sm text-white/80 flex-1">
          {payload.features.slice(0, 5).map((f) => (
            <li key={f} className="flex items-start gap-3">
              <i
                className="fa-solid fa-check text-cpoint-turquoise text-xs mt-1.5 shrink-0"
                aria-hidden="true"
              />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onSubscribe}
        disabled={disabled}
        className={
          'mt-8 inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold transition duration-150 ' +
          (disabled
            ? 'border border-white/15 bg-white/5 text-white/40 cursor-not-allowed'
            : 'bg-cpoint-turquoise text-black hover:bg-cpoint-turquoise/90')
        }
      >
        {loading ? 'Starting checkout…' : payload.cta_label}
      </button>
      {!payload.purchasable && (
        <p className="mt-3 text-xs text-white/40">
          Checkout will open once a Stripe price is configured.
        </p>
      )}
    </section>
  )
}

function CommunityCard({
  payload,
  onOpen,
}: {
  payload: CommunityTierPayload
  onOpen: () => void
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-8 flex flex-col">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
            Community
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{payload.name}</h2>
        </div>
        <i
          className="fa-solid fa-people-group text-cpoint-turquoise text-2xl"
          aria-hidden="true"
        />
      </div>
      <p className="mt-3 text-sm text-white/60">{payload.tagline}</p>

      <ul className="mt-6 space-y-3 text-sm text-white/80 flex-1">
        <li className="flex items-start gap-3">
          <i className="fa-solid fa-check text-cpoint-turquoise text-xs mt-1.5 shrink-0" aria-hidden="true" />
          <span>L1 to Enterprise tiers — pick the right size</span>
        </li>
        <li className="flex items-start gap-3">
          <i className="fa-solid fa-check text-cpoint-turquoise text-xs mt-1.5 shrink-0" aria-hidden="true" />
          <span>Higher member caps and media storage</span>
        </li>
        <li className="flex items-start gap-3">
          <i className="fa-solid fa-check text-cpoint-turquoise text-xs mt-1.5 shrink-0" aria-hidden="true" />
          <span>Optional add-ons: Steve and Networking</span>
        </li>
      </ul>

      <button
        type="button"
        onClick={onOpen}
        className="mt-8 inline-flex items-center justify-center rounded-full bg-cpoint-turquoise text-black px-6 py-3 text-sm font-semibold transition duration-150 hover:bg-cpoint-turquoise/90"
      >
        See community plans
      </button>
    </section>
  )
}

function ActiveSubscriptionsSection({
  active,
  onManageCommunity,
}: {
  active: ActiveSubscriptionsPayload | null
  onManageCommunity: (communityId: number) => void
}) {
  const personal = active?.personal
  const communities = active?.communities || []
  const hasPersonal = !!personal?.active
  const hasCommunities = communities.length > 0
  return (
    <section aria-labelledby="active-subscriptions-heading">
      <div className="mb-4">
        <h2 id="active-subscriptions-heading" className="text-xl font-semibold">Active Subscriptions</h2>
        <p className="mt-1 text-sm text-white/55">Review your current personal and community billing state.</p>
      </div>
      {!active ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/55">
          Loading active subscriptions…
        </div>
      ) : !hasPersonal && !hasCommunities ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/55">
          No active subscriptions yet.
        </div>
      ) : (
        <div className="space-y-8">
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-cpoint-turquoise">
              User
            </h3>
            {hasPersonal ? (
              <ActiveRow
                title={personal?.is_special ? 'Special Premium entitlement' : 'User Premium Membership'}
                subtitle={personal?.cancel_at_period_end ? benefitsCopy(personal.benefits_end_at || personal.current_period_end) : renewalCopy(personal?.current_period_end)}
                status={personal?.is_special ? 'special' : personal?.subscription_status || personal?.subscription || 'active'}
              />
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
                No active user subscription.
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-cpoint-turquoise">
              Community
            </h3>
            {hasCommunities ? (
              <div className="space-y-3">
                {communities.map((community) => (
                  <ActiveRow
                    key={community.id}
                    title={community.name}
                    subtitle={community.cancel_at_period_end ? benefitsCopy(community.benefits_end_at || community.current_period_end) : renewalCopy(community.current_period_end)}
                    status={tierLabel(community.tier || community.subscription_status)}
                    actionLabel="Manage"
                    onAction={() => onManageCommunity(community.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
                No active community subscriptions.
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function ActiveRow({
  title,
  subtitle,
  status,
  actionLabel,
  onAction,
  children,
}: {
  title: string
  subtitle: string
  status: string
  actionLabel?: string
  onAction?: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium text-white">{title}</h3>
          <span className="rounded-full border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 px-2 py-0.5 text-[11px] font-medium text-cpoint-turquoise">
            {status}
          </span>
        </div>
        <p className="mt-1 text-sm text-white/55">{subtitle}</p>
      </div>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-white hover:bg-white/5"
        >
          {actionLabel}
        </button>
      )}
      </div>
      {children && <div className="mt-4 border-t border-white/10 pt-4">{children}</div>}
    </div>
  )
}

function renewalCopy(value?: string | null) {
  return value ? `Next renewal: ${formatDate(value)}` : 'Renewal date unavailable'
}

function benefitsCopy(value?: string | null) {
  return value ? `Benefits active until: ${formatDate(value)}` : 'Cancellation pending'
}

function currentTierLabel(community: Community, active: ActiveSubscriptionsPayload | null) {
  const activeItem = active?.communities?.find((item) => item.id === community.id)
  const tier = activeItem?.tier || community.tier
  if (!tier || tier === 'free') return null
  return `Current: ${tierLabel(tier)}`
}

// ---------------------------------------------------------------------------
// Community modal — tier list + Add-ons entry row
// ---------------------------------------------------------------------------

function ModalShell({
  children,
  onClose,
  ariaLabel,
}: {
  children: React.ReactNode
  onClose: () => void
  ariaLabel: string
}) {
  // Full-screen on mobile, centered card on desktop. Backdrop click +
  // top-right close button both dismiss; ``e.stopPropagation`` on the
  // surface keeps clicks inside from leaking to the overlay.
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur sm:items-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full sm:max-w-lg max-h-full overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
        {children}
      </div>
    </div>
  )
}

function CommunityModal({
  payload,
  onPickTier,
  onOpenAddons,
  onClose,
  pendingKey,
  error,
}: {
  payload: CommunityTierPayload
  onPickTier: (tier: CommunityTierLevel) => void
  onOpenAddons: () => void
  onClose: () => void
  pendingKey: string | null
  error?: string | null
}) {
  return (
    <ModalShell onClose={onClose} ariaLabel="Community plans">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
            Community plans
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            Pick your tier
          </h2>
          <p className="mt-1 text-sm text-white/60">
            Tiers are billed monthly on the parent community. Sub-communities
            inherit the parent's tier automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
        >
          <i className="fa-solid fa-xmark" />
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="mt-6 space-y-2">
        {payload.tiers.map((tier) => (
          <TierRow
            key={tier.tier_code}
            tier={tier}
            ctaLabel={payload.cta_label}
            loading={
              !!pendingKey && pendingKey.startsWith(`community_tier:${tier.tier_code}`)
            }
            onPick={() => onPickTier(tier)}
          />
        ))}
        <EnterpriseRow />
      </div>

      <div className="mt-6 border-t border-white/10 pt-5">
        <button
          type="button"
          onClick={onOpenAddons}
          className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition hover:border-cpoint-turquoise/40 hover:bg-cpoint-turquoise/5"
        >
          <div>
            <div className="text-sm font-medium text-white">
              Community Add-ons
            </div>
            <div className="mt-0.5 text-xs text-white/50">
              Steve and Networking — optional packages
            </div>
          </div>
          <i className="fa-solid fa-chevron-right text-white/40 text-xs" />
        </button>
      </div>
    </ModalShell>
  )
}

function TierRow({
  tier,
  ctaLabel,
  loading,
  onPick,
}: {
  tier: CommunityTierLevel
  ctaLabel: string
  loading: boolean
  onPick: () => void
}) {
  const disabled = !tier.purchasable || loading
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-white">
            Paid {tier.level_label}
          </span>
          <span className="text-xs text-white/40">
            {tier.max_members ? `up to ${tier.max_members} members` : 'TBD'}
            {tier.media_gb ? ` · ${tier.media_gb} GB media` : ''}
          </span>
        </div>
        <div className="mt-1 text-xs text-white/50">
          {formatEur(tier.price_eur)} / month
        </div>
      </div>
      <button
        type="button"
        onClick={onPick}
        disabled={disabled}
        className={
          'inline-flex shrink-0 items-center justify-center rounded-full px-4 py-2 text-xs font-semibold transition ' +
          (!tier.purchasable
            ? 'border border-white/15 bg-white/5 text-white/40 cursor-not-allowed'
            : loading
            ? 'bg-cpoint-turquoise/60 text-black cursor-wait'
            : 'bg-cpoint-turquoise text-black hover:bg-cpoint-turquoise/90')
        }
      >
        {loading ? 'Starting…' : tier.purchasable ? ctaLabel : 'Coming soon'}
      </button>
    </div>
  )
}

function EnterpriseRow() {
  // Enterprise is sales-driven only — not a Stripe SKU. The mailto
  // intentionally targets sales@c-point.co; subject is pre-filled so
  // the inbound thread is easy to triage.
  return (
    <div className="flex items-center gap-3 rounded-xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/[0.04] p-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-white">Enterprise</span>
          <span className="text-xs text-white/40">unlimited members</span>
        </div>
        <div className="mt-1 text-xs text-white/50">Custom pricing</div>
      </div>
      <a
        href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent('Enterprise community plan')}`}
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-cpoint-turquoise/60 px-4 py-2 text-xs font-semibold text-cpoint-turquoise transition hover:bg-cpoint-turquoise/10"
      >
        Contact Us
      </a>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add-ons modal (Steve + Networking, both Coming soon)
// ---------------------------------------------------------------------------

function AddonsModal({
  steve,
  networking,
  onBack,
  onClose,
}: {
  steve: ComingSoonPayload
  networking: ComingSoonPayload
  onBack: () => void
  onClose: () => void
}) {
  return (
    <ModalShell onClose={onClose} ariaLabel="Community Add-ons">
      <div className="flex items-start justify-between">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-3 inline-flex items-center gap-2 text-xs text-white/60 hover:text-white"
          >
            <i className="fa-solid fa-arrow-left" />
            <span>Back to plans</span>
          </button>
          <p className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
            Community Add-ons
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            Optional packages
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
        >
          <i className="fa-solid fa-xmark" />
        </button>
      </div>

      <div className="mt-6 space-y-4">
        <AddonCard
          payload={steve}
          subjectLabel="Steve Package"
        />
        <AddonCard
          payload={networking}
          subjectLabel="Networking Package"
        />
      </div>
    </ModalShell>
  )
}

function AddonCard({
  payload,
  subjectLabel,
}: {
  payload: ComingSoonPayload
  subjectLabel: string
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{payload.name}</h3>
          <p className="mt-1 text-xs text-white/60">{payload.tagline}</p>
        </div>
        <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/50">
          Coming soon
        </span>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-white">
          {formatEur(payload.price_eur)}
        </span>
        <span className="text-xs text-white/50">/ month</span>
      </div>

      <a
        href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent(`Notify me - ${subjectLabel}`)}`}
        className="mt-4 inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition hover:border-cpoint-turquoise/60 hover:text-cpoint-turquoise"
      >
        Notify me
      </a>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Community picker (existing) — invoked after a tier is chosen
// ---------------------------------------------------------------------------

function CommunityPickerModal({
  tier,
  preselectedCommunityId,
  onCancel,
  onChoose,
  onCreate,
  activeSubscriptions,
  error,
  loading,
}: {
  tier: CommunityTierLevel
  preselectedCommunityId: string
  onCancel: () => void
  onChoose: (communityId: number) => void
  onCreate: () => void
  activeSubscriptions: ActiveSubscriptionsPayload | null
  error?: string | null
  loading?: boolean
}) {
  const [communities, setCommunities] = useState<Community[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(
    preselectedCommunityId ? Number(preselectedCommunityId) : null,
  )

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/user_communities_hierarchical', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const data = await res.json()
        if (cancelled) return
        if (!data?.success) {
          throw new Error(data?.error || 'Failed to load communities')
        }
        // Flatten the hierarchical tree and keep only root communities
        // the user owns (subs inherit billing from their root parent so
        // we never upgrade them directly). The server re-checks owner
        // on checkout creation; this is a UX filter.
        const flat: Community[] = []
        const walk = (list: unknown[]) => {
          for (const raw of list || []) {
            const item = raw as Community & {
              children?: Community[]
              parent_community_id?: number | null
            }
            if (item && typeof item.id === 'number') flat.push(item)
            if (item && Array.isArray(item.children)) walk(item.children)
          }
        }
        walk(data.communities || [])
        const me = typeof data.username === 'string'
          ? data.username.trim().toLowerCase()
          : null
        const activeByCommunity = new Map(
          (activeSubscriptions?.communities || []).map((item) => [item.id, item]),
        )
        const owned = flat.filter((c) => {
          const withParent = c as Community & { parent_community_id?: number | null }
          if (withParent.parent_community_id) return false
          if (me && c.creator_username && c.creator_username.trim().toLowerCase() === me) return true
          if (c.role && c.role.toLowerCase() === 'owner') return true
          return false
        }).filter((c) => {
          const active = activeByCommunity.get(c.id)
          return String(active?.tier || c.tier || '').toLowerCase() !== tier.tier_code
        })
        setCommunities(owned)
      } catch (err) {
        if (!cancelled) setLoadErr(err instanceof Error ? err.message : 'Failed to load')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [activeSubscriptions, tier.tier_code])

  return (
    <ModalShell onClose={onCancel} ariaLabel={`Pick a community for Paid ${tier.level_label}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
            Upgrade to Paid {tier.level_label}
          </p>
          <h2 className="mt-2 text-lg font-semibold">Pick a community</h2>
          <p className="mt-1 text-sm text-white/60">
            You can only upgrade communities you own. The new tier unlocks up to{' '}
            {tier.max_members ?? '?'} members at {formatEur(tier.price_eur)} / month.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="-mr-1 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
        >
          <i className="fa-solid fa-xmark" />
        </button>
      </div>

      {loadErr && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {loadErr}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="mt-5 max-h-64 space-y-2 overflow-y-auto pr-1">
        {communities === null && !loadErr && (
          <div className="text-sm text-white/50">Loading your communities…</div>
        )}
        {communities !== null && communities.length === 0 && (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-white/60">
            No eligible owned communities for {tierLabel(tier.tier_code)}. Communities already on this tier are hidden.
          </div>
        )}
        {communities?.map((c) => (
          <label
            key={c.id}
            className={
              'flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition ' +
              (selectedId === c.id
                ? 'border-cpoint-turquoise/60 bg-cpoint-turquoise/10'
                : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]')
            }
          >
            <input
              type="radio"
              name="community"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#00CEC8]"
              checked={selectedId === c.id}
              onChange={() => setSelectedId(c.id)}
            />
            <span className="min-w-0 flex-1 break-words leading-5">
              {c.name}
              {currentTierLabel(c, activeSubscriptions) && (
                <span className="ml-2 text-xs text-white/40">
                  {currentTierLabel(c, activeSubscriptions)}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-2">
        <button
          type="button"
          disabled={!selectedId || loading}
          onClick={() => selectedId && onChoose(selectedId)}
          className={
            'inline-flex w-full items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition ' +
            (selectedId && !loading
              ? 'bg-cpoint-turquoise text-black hover:bg-cpoint-turquoise/90'
              : 'border border-white/15 bg-white/5 text-white/40 cursor-not-allowed')
          }
        >
          {loading ? 'Starting checkout…' : 'Continue to checkout'}
        </button>
        {communities !== null && communities.length === 0 && (
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex w-full items-center justify-center rounded-full border border-white/20 px-5 py-3 text-sm font-semibold text-white hover:bg-white/5"
          >
            Create a community
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="mt-1 text-xs text-white/40 hover:text-white/70"
        >
          Cancel
        </button>
      </div>
    </ModalShell>
  )
}
