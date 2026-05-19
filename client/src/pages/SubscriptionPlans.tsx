import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { useHeader } from '../contexts/HeaderContext'
import {
  canUseNativeStoreIap,
  currentStoreProvider,
  loadIapConfig,
  nativeIapPurchasesEnabled,
  openExternalBillingUrl,
  providerBadge,
  providerLabel,
  purchaseStoreSubscription,
  restoreStorePurchases,
  type IapConfig,
  type StoreProvider,
} from '../utils/mobileStoreBilling'

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
 *   - ``steve_package``   — Community Add-ons → Steve picker → Checkout (Paid tier roots only)
 * Coming-soon SKUs:
 *   - ``networking`` — mailto / notify flow until live Stripe wiring lands
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
  early_price_eur?: number | string | null
  early_adoption_duration_months?: number | null
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

interface NetworkingComingSoonPayload {
  sku: 'networking_package'
  name: string
  tagline: string
  price_eur: number | string | null
  billing_cycle: string
  currency: string
  features: string[]
  purchasable: false
  coming_soon: true
  stripe_mode: 'test' | 'live'
  stripe_price_id: string
}

interface StevePackagePayload {
  sku: 'steve_package'
  name: string
  tagline: string
  price_eur: number | string | null
  billing_cycle: string
  currency: string
  features?: string[]
  credit_pool?: number | null
  purchasable: boolean
  coming_soon?: boolean
  stripe_mode: 'test' | 'live'
  stripe_price_id: string
}

interface PricingPayload {
  success: boolean
  stripe_mode: 'test' | 'live'
  publishable_key_available: boolean
  sku: {
    premium: PremiumPayload
    community_tier: CommunityTierPayload
    steve_package: StevePackagePayload
    networking: NetworkingComingSoonPayload
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
  subscription_active?: boolean
  needs_attention?: boolean
  renewal_date_status?: string
  subscription?: string
  subscription_status?: string | null
  current_period_end?: string | null
  cancel_at_period_end?: boolean
  benefits_end_at?: string | null
  is_special?: boolean
  subscription_provider?: string | null
}

interface ActiveCommunitySubscription {
  id: number
  name: string
  tier?: string
  subscription_status?: string | null
  stripe_subscription_id?: string | null
  current_period_end?: string | null
  cancel_at_period_end?: boolean
  benefits_end_at?: string | null
  steve_package_subscription_active?: boolean
  needs_attention?: boolean
  renewal_date_status?: string
  /** Paid tier subscription active/trialing with future renewal boundary (API-derived). */
  tier_subscription_active?: boolean
  tier_subscription_live?: boolean
  steve_addon_eligible?: boolean
  steve_addon_reason?: string
  steve_addon_message?: string
  billing_provider?: string | null
}

interface ActiveSubscriptionsPayload {
  success: boolean
  error?: string
  personal: ActivePersonalSubscription
  communities: ActiveCommunitySubscription[]
}

// ---------------------------------------------------------------------------
// Small display helpers
// ---------------------------------------------------------------------------

function formatEur(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return i18n.t('subscriptions.price_tbd')
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return i18n.t('subscriptions.price_tbd')
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
    if (pending.plan_id === 'premium' && (active.personal?.subscription_active ?? active.personal?.active)) {
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY)
      return i18n.t('subscriptions.status_premium_active')
    }
    const communityId = Number(pending.community_id || 0)
    const match = active.communities?.find((c) => (
      c.id === communityId
      && (!pending.tier_code || String(c.tier || '').toLowerCase() === String(pending.tier_code).toLowerCase())
    ))
    if (match) {
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY)
      return i18n.t('subscriptions.status_community_active', {
        name: match.name,
        tier: tierLabel(match.tier),
      })
    }
    if (pending.plan_id === 'steve_package') {
      const steveMatch = active.communities?.find((c) => (
        c.id === communityId && c.steve_package_subscription_active
      ))
      if (steveMatch) {
        sessionStorage.removeItem(PENDING_CHECKOUT_KEY)
        return i18n.t('subscriptions.status_steve_active', { name: steveMatch.name })
      }
    }
  } catch {
    try { sessionStorage.removeItem(PENDING_CHECKOUT_KEY) } catch {}
  }
  return null
}

function tierLabel(tier?: string | null) {
  const value = String(tier || '').toLowerCase()
  if (value === 'paid_l1') return i18n.t('subscriptions.tier_paid_l1')
  if (value === 'paid_l2') return i18n.t('subscriptions.tier_paid_l2')
  if (value === 'paid_l3') return i18n.t('subscriptions.tier_paid_l3')
  if (value === 'free') return i18n.t('subscriptions.tier_free')
  return tier || i18n.t('subscriptions.tier_active_fallback')
}

/** Paid ladder rank for upgrade vs downgrade copy (Enterprise ranks above L3). */
function paidTierRank(tier?: string | null): number {
  const value = String(tier || '').toLowerCase()
  if (value === 'paid_l1') return 1
  if (value === 'paid_l2') return 2
  if (value === 'paid_l3') return 3
  if (value === 'enterprise') return 4
  return 0
}

function communityStripeHealthy(c: ActiveCommunitySubscription): boolean {
  if (c.tier_subscription_active === true) return true
  return c.tier_subscription_live === true
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ModalView = 'community' | 'addons' | 'picker' | 'steve_picker' | null
type PageMode = 'choose' | 'active' | null

const PENDING_CHECKOUT_KEY = 'cpoint_pending_subscription_checkout'

export default function SubscriptionPlans() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
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
  const [iapConfig, setIapConfig] = useState<IapConfig | null>(null)
  const [mobileBillingNotice, setMobileBillingNotice] = useState(false)

  useEffect(() => {
    setTitle(t('navigation.subscriptions'))
  }, [setTitle, t])

  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const preselectedCommunityId = queryParams.get('community_id') || ''

  const ownerIntroFeedReturnId = useMemo(() => {
    if (queryParams.get('from_owner_intro') !== '1') return null
    const raw = queryParams.get('community_id')
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  }, [queryParams])

  useEffect(() => {
    const qsStatus = queryParams.get('status')
    if (qsStatus === 'cancelled') {
      setStatus(t('subscriptions.checkout_cancelled'))
      resetSubscriptionPageScroll()
    }
  }, [queryParams, t])

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
    if (requestedOpen === 'community_addons') {
      setModalError(null)
      setView('steve_picker')
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
        const [pricingRes, activeRes, iapRes] = await Promise.all([
          fetch('/api/kb/pricing', {
            credentials: 'include',
            headers: { Accept: 'application/json' },
          }),
          loadActiveSubscriptions().catch(() => null),
          loadIapConfig().catch(() => null),
        ])
        if (!pricingRes.ok) {
          throw new Error(`HTTP ${pricingRes.status}`)
        }
        const data: PricingPayload = await pricingRes.json()
        if (!cancelled) {
          if (!data.success) {
            throw new Error(i18n.t('subscriptions.error_load_pricing'))
          }
          setPricing(data)
          if (activeRes?.success) setActiveSubscriptions(activeRes)
          if (iapRes?.success) setIapConfig(iapRes)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : i18n.t('subscriptions.error_load_pricing'))
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
          const portalReason = data?.reason === 'already_subscribed'
            || data?.reason === 'steve_package_already_active'
          if (portalReason && communityId > 0) {
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
            throw new Error(portalData?.error || i18n.t('subscriptions.error_billing_portal'))
          }
          throw new Error(data?.error || i18n.t('subscriptions.error_checkout'))
        }
        if (data.url) {
          storePendingCheckout(body)
          options?.onBeforeRedirect?.()
          window.location.assign(data.url)
          return
        }
        throw new Error(i18n.t('subscriptions.error_checkout_url'))
      } catch (err) {
        const message = err instanceof Error ? err.message : i18n.t('subscriptions.error_checkout')
        if (options?.onError) options.onError(message)
        else setError(message)
        setCheckoutLoading(null)
      }
    },
    [],
  )

  const storeProvider = currentStoreProvider()
  const iapEnabled = nativeIapPurchasesEnabled(iapConfig)
  const webBillingUrl = iapConfig?.web_app_billing_url || 'https://app.c-point.co/subscription_plans'

  const onSubscribePremium = useCallback(async () => {
    const provider = currentStoreProvider()
    const productId = provider ? iapConfig?.[provider]?.premium_product_id : ''
    if (provider && productId && canUseNativeStoreIap(provider, iapConfig, productId)) {
      setCheckoutLoading('premium')
      setError(null)
      try {
        await purchaseStoreSubscription({ provider, productId })
        setStatus(t('subscriptions.status_premium_provider', { provider: providerLabel(provider) }))
        await loadActiveSubscriptions()
      } catch (err) {
        setError(err instanceof Error ? err.message : t('subscriptions.error_iap'))
        resetSubscriptionPageScroll()
      } finally {
        setCheckoutLoading(null)
      }
      return
    }
    startCheckout({ plan_id: 'premium', billing_cycle: 'monthly' }, 'premium')
  }, [iapConfig, loadActiveSubscriptions, startCheckout, t])

  const onRestorePurchases = useCallback(async () => {
    const provider = currentStoreProvider()
    if (!provider || !iapConfig || !nativeIapPurchasesEnabled(iapConfig)) return
    setCheckoutLoading(`restore:${provider}`)
    setError(null)
    setModalError(null)
    try {
      const count = await restoreStorePurchases(provider, iapConfig)
      setStatus(
        count > 0
          ? t('subscriptions.status_restored', { count }) // i18n plural: _one / _other
          : t('subscriptions.status_no_restore'),
      )
      await loadActiveSubscriptions()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('subscriptions.error_iap'))
    } finally {
      setCheckoutLoading(null)
    }
  }, [iapConfig, loadActiveSubscriptions, t])

  const onPickTier = useCallback(
    (tier: CommunityTierLevel) => {
      setPendingTier(tier)
      setModalError(null)
      setMobileBillingNotice(false)
      resetSubscriptionPageScroll()
      setView('picker')
    },
    [],
  )

  const onCommunityChosen = useCallback(
    async (communityId: number) => {
      if (!pendingTier) return
      const activeCommunity = activeSubscriptions?.communities?.find((item) => item.id === communityId)
      if (activeCommunity) {
        const billingProvider = String(activeCommunity.billing_provider || 'stripe').toLowerCase()
        if (billingProvider === 'apple' || billingProvider === 'google') {
          setMobileBillingNotice(false)
          setModalError(
            t('subscriptions.error_managed_store', { provider: providerLabel(billingProvider) }),
          )
          return
        }
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
            throw new Error(data?.error || t('subscriptions.error_change_tier'))
          }
          setStatus(
            t('subscriptions.status_tier_changed', {
              name: activeCommunity.name,
              tier: tierLabel(pendingTier.tier_code),
            }),
          )
          setView(null)
          setPendingTier(null)
          resetSubscriptionPageScroll()
          await loadActiveSubscriptions()
        } catch (err) {
          setModalError(err instanceof Error ? err.message : t('subscriptions.error_change_tier'))
        } finally {
          setCheckoutLoading(null)
        }
        return
      }
      const provider = currentStoreProvider()
      const productId = provider
        ? iapConfig?.[provider]?.community_product_ids?.[pendingTier.tier_code]
        : ''
      if (provider && productId && canUseNativeStoreIap(provider, iapConfig, productId)) {
        const existingStoreCommunity = activeSubscriptions?.communities?.find((item) => {
          const billingProvider = String(item.billing_provider || '').toLowerCase()
          return billingProvider === provider && item.id !== communityId
        })
        if (existingStoreCommunity) {
          setMobileBillingNotice(true)
          setModalError(
            t('subscriptions.error_one_store_community', { provider: providerLabel(provider) }),
          )
          return
        }
        const key = `community_tier:${pendingTier.tier_code}:${communityId}`
        setCheckoutLoading(key)
        setModalError(null)
        setMobileBillingNotice(false)
        try {
          await purchaseStoreSubscription({ provider, productId, communityId })
          setStatus(
            t('subscriptions.status_community_provider', {
              tier: tierLabel(pendingTier.tier_code),
              provider: providerLabel(provider),
            }),
          )
          setView(null)
          setPendingTier(null)
          resetSubscriptionPageScroll()
          await loadActiveSubscriptions()
        } catch (err) {
          setModalError(err instanceof Error ? err.message : t('subscriptions.error_iap'))
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
    [activeSubscriptions, iapConfig, loadActiveSubscriptions, pendingTier, startCheckout, t],
  )

  const onSteveCommunityChosen = useCallback(
    async (communityId: number) => {
      if (currentStoreProvider()) {
        setModalError(null)
        openExternalBillingUrl(
          `${webBillingUrl}${webBillingUrl.includes('?') ? '&' : '?'}open=community_addons&community_id=${communityId}`,
        )
        return
      }
      startCheckout(
        { plan_id: 'steve_package', community_id: communityId },
        `steve_package:${communityId}`,
        {
          onError: setModalError,
          onBeforeRedirect: () => {
            setView(null)
          },
        },
      )
    },
    [startCheckout, webBillingUrl],
  )

  return (
    <div className="glass-page min-h-screen text-white pb-safe">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        {ownerIntroFeedReturnId != null && (
          <div className="mb-6 flex flex-col gap-3 rounded-xl border border-cpoint-turquoise/40 bg-cpoint-turquoise/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-white/85">
              {t('subscriptions.owner_intro_body')}
            </p>
            <button
              type="button"
              className="shrink-0 rounded-full bg-cpoint-turquoise px-4 py-2.5 text-sm font-semibold text-black hover:bg-cpoint-turquoise/90"
              onClick={() => navigate(`/community_feed_react/${ownerIntroFeedReturnId}`)}
            >
              {t('subscriptions.owner_intro_cta')}
            </button>
          </div>
        )}
        <header className="text-center pt-2 pb-4">
          <p className="text-xs uppercase tracking-[0.28em] text-cpoint-turquoise/80">
            {t('subscriptions.header_kicker')}
          </p>
          <h1 className="mt-4 text-3xl sm:text-4xl font-semibold tracking-tight">
            {t('subscriptions.header_title')}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-white/60 text-base leading-relaxed">
            {t('subscriptions.header_subtitle')}
          </p>
          {pricing?.stripe_mode === 'test' && (
            <p className="mt-4 text-[11px] uppercase tracking-[0.25em] text-amber-300/80">
              {t('subscriptions.test_mode_banner')}
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
          <div className="space-y-6">
            <ModeHeader mode={pageMode} onChange={() => setPageMode(null)} />
            {pageMode === 'choose' && (
              <section aria-labelledby="subscriptions-heading">
                <div className="mb-4">
                  <h2 id="subscriptions-heading" className="text-xl font-semibold">{t('subscriptions.choose_section_title')}</h2>
                  <p className="mt-1 text-sm text-white/55">{t('subscriptions.choose_section_subtitle')}</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <PersonalCard
                    payload={pricing.sku.premium}
                    onSubscribe={onSubscribePremium}
                    loading={checkoutLoading === 'premium'}
                    storeProvider={storeProvider}
                    storeProductAvailable={!!(storeProvider && iapConfig?.[storeProvider]?.premium_product_id)}
                    onRestore={onRestorePurchases}
                    restoreLoading={checkoutLoading != null && checkoutLoading.startsWith('restore:')}
                  />
                  <CommunityCard
                    payload={pricing.sku.community_tier}
                    onOpen={() => {
                      setModalError(null)
                      setMobileBillingNotice(false)
                      setView('community')
                      resetSubscriptionPageScroll()
                    }}
                  />
                </div>
              </section>
            )}
            {pageMode === 'active' && (
              <ActiveSubscriptionsSection
                active={activeSubscriptions}
                onManageCommunity={(id) => navigate(`/community/${id}/edit`)}
                onManagePersonalBilling={() => navigate('/account_settings')}
              />
            )}
          </div>
        )}

        <p className="mt-12 text-center text-xs text-white/40">
          {t('subscriptions.sales_questions')}{' '}
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
          storeProvider={storeProvider}
          storeProductIds={
            iapEnabled && storeProvider
              ? iapConfig?.[storeProvider]?.community_product_ids || {}
              : {}
          }
          iapDisabledOnNative={!!storeProvider && !iapEnabled}
          webBillingUrl={webBillingUrl}
          onPickTier={onPickTier}
          onOpenAddons={() => {
            resetSubscriptionPageScroll()
            setView('addons')
          }}
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
          onOpenStevePicker={() => {
            setModalError(null)
            resetSubscriptionPageScroll()
            setView('steve_picker')
          }}
          steveCheckoutLoading={
            checkoutLoading != null && checkoutLoading.startsWith('steve_package')
          }
        />
      )}

      {view === 'steve_picker' && (
        <SteveAddonPickerModal
          activeSubscriptions={activeSubscriptions}
          preselectedCommunityId={preselectedCommunityId}
          onCancel={() => {
            setModalError(null)
            setView('addons')
          }}
          onChoose={onSteveCommunityChosen}
          error={modalError}
          loading={
            checkoutLoading != null && checkoutLoading.startsWith('steve_package')
          }
          onCreate={() => {
            setView(null)
            setModalError(null)
            navigate('/premium_dashboard?open_create=1')
          }}
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
            setMobileBillingNotice(false)
          }}
          onChoose={onCommunityChosen}
          activeSubscriptions={activeSubscriptions}
          error={modalError}
          loading={!!checkoutLoading}
          mobileBillingNotice={mobileBillingNotice}
          webBillingUrl={iapConfig?.web_app_billing_url || 'https://app.c-point.co/subscription_plans'}
          onCreate={() => {
            setView(null)
            setModalError(null)
            setMobileBillingNotice(false)
            navigate('/premium_dashboard?open_create=1')
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
  const { t } = useTranslation()
  const navigate = useNavigate()

  const goBack = () => {
    if (window.history.length > 1) navigate(-1)
    else navigate('/premium_dashboard')
  }

  useEffect(() => {
    resetSubscriptionPageScroll()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('subscriptions.entry_aria')}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-hidden bg-black/80 backdrop-blur px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-4"
    >
      <div className="w-full sm:max-w-xl rounded-2xl border border-white/10 bg-[#070707] p-6 shadow-2xl shadow-black">
        <button
          type="button"
          className="mb-4 inline-flex items-center gap-2 text-sm text-[#9fb0b5] hover:text-white"
          onClick={goBack}
          aria-label={t('common.back')}
        >
          <i className="fa-solid fa-arrow-left" />
          {t('common.back')}
        </button>
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cpoint-turquoise">
          {t('subscriptions.entry_kicker')}
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
          {t('subscriptions.entry_title')}
        </h2>
        <p className="mt-2 text-sm leading-6 text-white/55">
          {t('subscriptions.entry_body')}
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onChoosePlans}
            className="rounded-2xl border border-cpoint-turquoise/35 bg-cpoint-turquoise/10 p-5 text-left transition hover:bg-cpoint-turquoise/15"
          >
            <span className="text-sm font-semibold text-white">{t('subscriptions.entry_choose_plan')}</span>
            <span className="mt-2 block text-xs leading-5 text-white/55">
              {t('subscriptions.entry_choose_plan_hint')}
            </span>
          </button>
          <button
            type="button"
            onClick={onChooseActive}
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left transition hover:border-cpoint-turquoise/35 hover:bg-white/[0.06]"
          >
            <span className="text-sm font-semibold text-white">{t('subscriptions.entry_active')}</span>
            <span className="mt-2 block text-xs leading-5 text-white/55">
              {t('subscriptions.entry_active_hint')}
            </span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ModeHeader({ mode, onChange }: { mode: PageMode; onChange: () => void }) {
  const { t } = useTranslation()
  if (!mode) return null
  return (
    <div className="flex items-center justify-between rounded-2xl border border-cpoint-turquoise/45 bg-cpoint-turquoise/[0.04] px-4 py-3">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-white/35">{t('subscriptions.mode_current_view')}</p>
        <p className="mt-0.5 text-sm font-medium text-white">
          {mode === 'choose' ? t('subscriptions.mode_choose_plan') : t('subscriptions.mode_active')}
        </p>
      </div>
      <button
        type="button"
        onClick={onChange}
        className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-white hover:bg-white/5"
      >
        {t('subscriptions.mode_switch')}
      </button>
    </div>
  )
}

function PersonalCard({
  payload,
  onSubscribe,
  loading,
  storeProvider,
  storeProductAvailable,
  iapDisabledOnNative,
  webBillingUrl,
  onRestore,
  restoreLoading,
}: {
  payload: PremiumPayload
  onSubscribe: () => void
  loading: boolean
  storeProvider: StoreProvider | null
  storeProductAvailable: boolean
  iapDisabledOnNative?: boolean
  webBillingUrl?: string
  onRestore: () => void
  restoreLoading: boolean
}) {
  const { t } = useTranslation()
  const disabled =
    (!payload.purchasable && !storeProductAvailable)
    || loading
    || restoreLoading
    || !!iapDisabledOnNative
  const ctaLabel = storeProvider && storeProductAvailable
    ? t('subscriptions.subscribe_with_provider', { provider: providerLabel(storeProvider) })
    : payload.cta_label
  const earlyMonths = payload.early_adoption_duration_months ?? 3
  const standardNum = Number(payload.price_eur)
  const earlyNum = Number(payload.early_price_eur)
  const showEarlyOffer =
    payload.early_price_eur != null &&
    payload.early_price_eur !== '' &&
    Number.isFinite(earlyNum) &&
    earlyNum > 0 &&
    (!Number.isFinite(standardNum) || earlyNum !== standardNum)
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-8 flex flex-col">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
            {t('subscriptions.card_personal')}
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{payload.name}</h2>
        </div>
        <i className="fa-solid fa-crown text-cpoint-turquoise text-2xl" aria-hidden="true" />
      </div>
      <p className="mt-3 text-sm text-white/60">{payload.tagline}</p>

      <div className="mt-6">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold">{formatEur(payload.price_eur)}</span>
          <span className="text-white/50">{t('subscriptions.per_month')}</span>
        </div>
        {showEarlyOffer && (
          <p className="mt-2 text-sm font-medium text-cpoint-turquoise">
            {t('subscriptions.early_offer', {
              price: formatEur(payload.early_price_eur),
              months: earlyMonths,
            })}
          </p>
        )}
        {storeProvider && showEarlyOffer && (
          <p className="mt-1 text-xs text-white/45">
            {t('subscriptions.early_offer_checkout_hint')}
          </p>
        )}
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
        {loading ? t('subscriptions.starting_checkout') : ctaLabel}
      </button>
      {storeProvider && storeProductAvailable && (
        <button
          type="button"
          onClick={onRestore}
          disabled={restoreLoading}
          className="mt-3 text-xs font-semibold text-cpoint-turquoise hover:underline disabled:text-white/35 disabled:no-underline"
        >
          {restoreLoading
            ? t('subscriptions.restoring')
            : t('subscriptions.restore_purchases', { provider: providerLabel(storeProvider) })}
        </button>
      )}
      {iapDisabledOnNative && (
        <p className="mt-3 text-xs text-white/55">
          {t('subscriptions.iap_disabled_notice')}
          {webBillingUrl && (
            <button
              type="button"
              onClick={() => openExternalBillingUrl(webBillingUrl)}
              className="mt-2 block text-left text-cpoint-turquoise underline"
            >
              {t('subscriptions.open_web_billing', { url: webBillingUrl })}
            </button>
          )}
        </p>
      )}
      {!payload.purchasable && !iapDisabledOnNative && (
        <p className="mt-3 text-xs text-white/40">
          {storeProductAvailable
            ? t('subscriptions.store_billing_available', { provider: providerLabel(storeProvider) })
            : t('subscriptions.stripe_price_pending')}
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
  const { t } = useTranslation()
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-8 flex flex-col">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
            {t('subscriptions.card_community')}
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
          <span>{t('subscriptions.card_community_bullet_1')}</span>
        </li>
        <li className="flex items-start gap-3">
          <i className="fa-solid fa-check text-cpoint-turquoise text-xs mt-1.5 shrink-0" aria-hidden="true" />
          <span>{t('subscriptions.card_community_bullet_2')}</span>
        </li>
        <li className="flex items-start gap-3">
          <i className="fa-solid fa-check text-cpoint-turquoise text-xs mt-1.5 shrink-0" aria-hidden="true" />
          <span>{t('subscriptions.card_community_bullet_3')}</span>
        </li>
      </ul>

      <button
        type="button"
        onClick={onOpen}
        className="mt-8 inline-flex items-center justify-center rounded-full bg-cpoint-turquoise text-black px-6 py-3 text-sm font-semibold transition duration-150 hover:bg-cpoint-turquoise/90"
      >
        {t('subscriptions.see_community_plans')}
      </button>
    </section>
  )
}

function ActiveSubscriptionsSection({
  active,
  onManageCommunity,
  onManagePersonalBilling,
}: {
  active: ActiveSubscriptionsPayload | null
  onManageCommunity: (communityId: number) => void
  onManagePersonalBilling?: () => void
}) {
  const { t } = useTranslation()
  const personal = active?.personal
  const communities = active?.communities || []

  const personalSpecial = !!personal?.is_special
  const personalSubscriptionHealthy =
    personalSpecial || !!(personal?.subscription_active ?? personal?.active)
  const personalNeedsAttention =
    !!personal?.needs_attention && !personalSpecial

  const healthyCommunities = communities.filter((c) => communityStripeHealthy(c))
  const needsCommunities = communities.filter((c) => !communityStripeHealthy(c))

  const loading = !active
  const emptyAll =
    !loading && !personalSubscriptionHealthy && !personalNeedsAttention
      && healthyCommunities.length === 0 && needsCommunities.length === 0

  return (
    <section aria-labelledby="active-subscriptions-heading">
      <div className="mb-4">
        <h2 id="active-subscriptions-heading" className="text-xl font-semibold">
          {t('subscriptions.active_section_title')}
        </h2>
        <p className="mt-1 text-sm text-white/55">
          {t('subscriptions.active_section_subtitle')}
        </p>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/55">
          {t('subscriptions.loading_active')}
        </div>
      ) : emptyAll ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/55">
          {t('subscriptions.no_subscriptions')}
        </div>
      ) : (
        <div className="space-y-10">
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-cpoint-turquoise">
              {t('subscriptions.personal_active_heading')}
            </h3>
            {personalSubscriptionHealthy ? (
              <ActiveRow
                title={personal?.is_special ? t('subscriptions.special_premium_title') : t('subscriptions.premium_membership_title')}
                subtitle={
                  personal?.cancel_at_period_end
                    ? benefitsCopy(personal.benefits_end_at || personal.current_period_end)
                    : renewalCopy(personal?.current_period_end)
                }
                status={personal?.is_special ? 'special' : personal?.subscription_status || personal?.subscription || 'active'}
                provider={personal?.subscription_provider || 'stripe'}
              />
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
                {t('subscriptions.no_personal_active')}
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-amber-200/90">
              {t('subscriptions.personal_needs_attention_heading')}
            </h3>
            {personalNeedsAttention ? (
              <ActiveRow
                title={t('subscriptions.premium_membership_title')}
                subtitle={
                  personal?.subscription_status === 'past_due'
                    ? t('subscriptions.personal_past_due')
                    : t('subscriptions.personal_billing_attention')
                }
                status={personal?.subscription_status || personal?.subscription || 'attention'}
                provider={personal?.subscription_provider || 'stripe'}
                actionLabel={t('subscriptions.manage')}
                onAction={() => {
                  if (onManagePersonalBilling) onManagePersonalBilling()
                  else window.location.assign('/account_settings')
                }}
              />
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/45">
                {t('subscriptions.no_personal_issues')}
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-cpoint-turquoise">
              {t('subscriptions.community_active_heading')}
            </h3>
            {healthyCommunities.length ? (
              <div className="space-y-3">
                {healthyCommunities.map((community) => (
                  <ActiveRow
                    key={community.id}
                    title={community.name}
                    subtitle={communitySubtitleCommunity(community)}
                    status={tierLabel(community.tier || community.subscription_status)}
                    provider={community.billing_provider || 'stripe'}
                    actionLabel={t('subscriptions.manage')}
                    onAction={() => onManageCommunity(community.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
                {t('subscriptions.no_community_active')}
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-amber-200/90">
              {t('subscriptions.community_needs_attention_heading')}
            </h3>
            {needsCommunities.length ? (
              <div className="space-y-3">
                {needsCommunities.map((community) => (
                  <ActiveRow
                    key={`need-${community.id}`}
                    title={community.name}
                    subtitle={
                      community.steve_addon_message
                        ? community.steve_addon_message
                        : communitySubtitleCommunity(community)
                    }
                    status={tierLabel(community.tier || community.subscription_status)}
                    provider={community.billing_provider || 'stripe'}
                    actionLabel={t('subscriptions.manage')}
                    onAction={() => onManageCommunity(community.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/45">
                {t('subscriptions.no_community_issues')}
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
  provider,
}: {
  title: string
  subtitle: string
  status: string
  actionLabel?: string
  onAction?: () => void
  children?: React.ReactNode
  provider?: string | null
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
          {provider && (
            <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-white/60">
              {providerBadge(provider)}
            </span>
          )}
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
  return value
    ? i18n.t('subscriptions.renewal_next', { date: formatDate(value) })
    : i18n.t('subscriptions.renewal_unavailable')
}

function benefitsCopy(value?: string | null) {
  return value
    ? i18n.t('subscriptions.benefits_until', { date: formatDate(value) })
    : i18n.t('subscriptions.cancellation_pending')
}

function communitySubtitleCommunity(c: ActiveCommunitySubscription): string {
  const renewalLine = c.cancel_at_period_end
    ? benefitsCopy(c.benefits_end_at || c.current_period_end)
    : renewalCopy(c.current_period_end)
  return renewalLine
}

function currentTierLabel(community: Community, active: ActiveSubscriptionsPayload | null) {
  const activeItem = active?.communities?.find((item) => item.id === community.id)
  const tier = activeItem?.tier || community.tier
  if (!tier || tier === 'free') return null
  return i18n.t('subscriptions.current_tier', { tier: tierLabel(tier) })
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
  useEffect(() => {
    resetSubscriptionPageScroll()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-hidden bg-black/80 backdrop-blur px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full sm:max-w-lg max-h-[min(720px,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-1.5rem))] overflow-y-auto rounded-2xl border border-white/10 bg-[#0a0a0a] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

function CommunityModal({
  payload,
  storeProvider,
  storeProductIds,
  iapDisabledOnNative,
  webBillingUrl,
  onPickTier,
  onOpenAddons,
  onClose,
  pendingKey,
  error,
}: {
  payload: CommunityTierPayload
  storeProvider: StoreProvider | null
  storeProductIds: Record<string, string>
  iapDisabledOnNative?: boolean
  webBillingUrl?: string
  onPickTier: (tier: CommunityTierLevel) => void
  onOpenAddons: () => void
  onClose: () => void
  pendingKey: string | null
  error?: string | null
}) {
  const { t } = useTranslation()
  return (
    <ModalShell onClose={onClose} ariaLabel={t('subscriptions.modal_community_plans_aria')}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
            {t('subscriptions.modal_community_plans_kicker')}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            {t('subscriptions.modal_pick_tier')}
          </h2>
          <p className="mt-1 text-sm text-white/60">
            {t('subscriptions.modal_tier_billing_hint')}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('subscriptions.close')}
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

      {iapDisabledOnNative && (
        <p className="mt-4 text-sm text-white/60">
          {t('subscriptions.iap_disabled_notice')}
          {webBillingUrl && (
            <button
              type="button"
              onClick={() => openExternalBillingUrl(webBillingUrl)}
              className="mt-2 block text-left text-cpoint-turquoise underline"
            >
              {t('subscriptions.open_web_billing', { url: webBillingUrl })}
            </button>
          )}
        </p>
      )}

      <div className="mt-6 space-y-2">
        {payload.tiers.map((tier) => (
          <TierRow
            key={tier.tier_code}
            tier={tier}
            ctaLabel={payload.cta_label}
            storeProvider={storeProvider}
            storeProductAvailable={!iapDisabledOnNative && !!storeProductIds[tier.tier_code]}
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
              {t('subscriptions.addons_title')}
            </div>
            <div className="mt-0.5 text-xs text-white/50">
              {t('subscriptions.addons_subtitle')}
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
  storeProvider,
  storeProductAvailable,
  loading,
  onPick,
}: {
  tier: CommunityTierLevel
  ctaLabel: string
  storeProvider: StoreProvider | null
  storeProductAvailable: boolean
  loading: boolean
  onPick: () => void
}) {
  const { t } = useTranslation()
  const canPurchase = tier.purchasable || storeProductAvailable
  const disabled = !canPurchase || loading
  const label = storeProvider && storeProductAvailable
    ? t('subscriptions.subscribe_with_provider', { provider: providerLabel(storeProvider) })
    : ctaLabel
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-white">
            {t('subscriptions.tier_paid_label', { level: tier.level_label })}
          </span>
          <span className="text-xs text-white/40">
            {tier.max_members
              ? t('subscriptions.tier_members_up_to', { count: tier.max_members })
              : t('subscriptions.price_tbd')}
            {tier.media_gb ? ` · ${t('subscriptions.tier_media_gb', { gb: tier.media_gb })}` : ''}
          </span>
        </div>
        <div className="mt-1 text-xs text-white/50">
          {formatEur(tier.price_eur)} {t('subscriptions.per_month')}
        </div>
      </div>
      <button
        type="button"
        onClick={onPick}
        disabled={disabled}
        className={
          'inline-flex shrink-0 items-center justify-center rounded-full px-4 py-2 text-xs font-semibold transition ' +
          (!canPurchase
            ? 'border border-white/15 bg-white/5 text-white/40 cursor-not-allowed'
            : loading
            ? 'bg-cpoint-turquoise/60 text-black cursor-wait'
            : 'bg-cpoint-turquoise text-black hover:bg-cpoint-turquoise/90')
        }
      >
        {loading ? t('subscriptions.starting') : canPurchase ? label : t('subscriptions.coming_soon')}
      </button>
    </div>
  )
}

function EnterpriseRow() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 rounded-xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/[0.04] p-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-white">{t('subscriptions.enterprise')}</span>
          <span className="text-xs text-white/40">{t('subscriptions.enterprise_members')}</span>
        </div>
        <div className="mt-1 text-xs text-white/50">{t('subscriptions.enterprise_custom_pricing')}</div>
      </div>
      <a
        href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent(t('subscriptions.mailto_enterprise_subject'))}`}
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-cpoint-turquoise/60 px-4 py-2 text-xs font-semibold text-cpoint-turquoise transition hover:bg-cpoint-turquoise/10"
      >
        {t('subscriptions.contact_us')}
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
  onOpenStevePicker,
  steveCheckoutLoading,
}: {
  steve: StevePackagePayload
  networking: NetworkingComingSoonPayload
  onBack: () => void
  onClose: () => void
  onOpenStevePicker: () => void
  steveCheckoutLoading: boolean
}) {
  const { t } = useTranslation()
  return (
    <ModalShell onClose={onClose} ariaLabel={t('subscriptions.addons_title')}>
      <div className="flex items-start justify-between">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-3 inline-flex items-center gap-2 text-xs text-white/60 hover:text-white"
          >
            <i className="fa-solid fa-arrow-left" />
            <span>{t('subscriptions.addons_back')}</span>
          </button>
          <p className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
            {t('subscriptions.addons_title')}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            {t('subscriptions.addons_optional')}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('subscriptions.close')}
          className="-mr-1 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
        >
          <i className="fa-solid fa-xmark" />
        </button>
      </div>

      <div className="mt-6 space-y-4">
        <SteveAddonCard
          payload={steve}
          loading={steveCheckoutLoading}
          onSubscribe={onOpenStevePicker}
        />
        <NetworkingAddonCard payload={networking} />
      </div>
    </ModalShell>
  )
}

function SteveAddonCard({
  payload,
  loading,
  onSubscribe,
}: {
  payload: StevePackagePayload
  loading: boolean
  onSubscribe: () => void
}) {
  const { t } = useTranslation()
  const badgeComingSoon = !payload.purchasable || payload.coming_soon
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{payload.name}</h3>
          <p className="mt-1 text-xs text-white/60">{payload.tagline}</p>
        </div>
        <span
          className={
            'shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ' +
            (badgeComingSoon
              ? 'border-white/15 text-white/50'
              : 'border-cpoint-turquoise/40 text-cpoint-turquoise')
          }
        >
          {badgeComingSoon ? t('subscriptions.coming_soon') : t('subscriptions.live')}
        </span>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-white">
          {formatEur(payload.price_eur)}
        </span>
        <span className="text-xs text-white/50">{t('subscriptions.per_month')}</span>
      </div>

      {payload.credit_pool != null && Number(payload.credit_pool) > 0 && (
        <p className="mt-2 text-xs text-white/45">
          {t('subscriptions.steve_credit_pool', { count: payload.credit_pool })}
        </p>
      )}

      {badgeComingSoon ? (
        <a
          href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent(t('subscriptions.mailto_notify_steve'))}`}
          className="mt-4 inline-flex w-full items-center justify-center rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition hover:border-cpoint-turquoise/60 hover:text-cpoint-turquoise"
        >
          {t('subscriptions.notify_me')}
        </a>
      ) : (
        <button
          type="button"
          disabled={loading}
          onClick={onSubscribe}
          className={
            'mt-4 inline-flex w-full items-center justify-center rounded-full px-4 py-2 text-xs font-semibold transition ' +
            (loading
              ? 'bg-cpoint-turquoise/60 text-black cursor-wait'
              : 'bg-cpoint-turquoise text-black hover:bg-cpoint-turquoise/90')
          }
        >
          {loading ? t('subscriptions.starting_checkout') : t('subscriptions.subscribe')}
        </button>
      )}
    </section>
  )
}

function NetworkingAddonCard({
  payload,
}: {
  payload: NetworkingComingSoonPayload
}) {
  const { t } = useTranslation()
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{payload.name}</h3>
          <p className="mt-1 text-xs text-white/60">{payload.tagline}</p>
        </div>
        <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/50">
          {t('subscriptions.coming_soon')}
        </span>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-white">
          {formatEur(payload.price_eur)}
        </span>
        <span className="text-xs text-white/50">{t('subscriptions.per_month')}</span>
      </div>

      <a
        href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent(t('subscriptions.mailto_notify_networking'))}`}
        className="mt-4 inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition hover:border-cpoint-turquoise/60 hover:text-cpoint-turquoise"
      >
        {t('subscriptions.notify_me')}
      </a>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Steve package community picker (Paid tier roots without Steve yet)
// ---------------------------------------------------------------------------

function SteveAddonPickerModal({
  activeSubscriptions,
  preselectedCommunityId,
  onCancel,
  onChoose,
  onCreate,
  error,
  loading,
}: {
  activeSubscriptions: ActiveSubscriptionsPayload | null
  preselectedCommunityId: string
  onCancel: () => void
  onChoose: (communityId: number) => void
  onCreate: () => void
  error?: string | null
  loading?: boolean
}) {
  const { t } = useTranslation()
  const [fullRows, setFullRows] = useState<ActiveCommunitySubscription[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const focusId = useMemo(() => {
    const raw = preselectedCommunityId.trim()
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) && n > 0 ? n : null
  }, [preselectedCommunityId])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (activeSubscriptions?.success && Array.isArray(activeSubscriptions.communities)) {
        if (!cancelled) {
          setFullRows(activeSubscriptions.communities)
          setLoadErr(null)
        }
        return
      }
      try {
        const res = await fetch('/api/me/subscriptions', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const data: ActiveSubscriptionsPayload = await res.json()
        if (cancelled) return
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || t('subscriptions.error_load_subscriptions'))
        }
        setFullRows(data.communities || [])
      } catch (err) {
        if (!cancelled) setLoadErr(err instanceof Error ? err.message : t('subscriptions.error_load_subscriptions'))
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [activeSubscriptions])

  const focusRow = useMemo(() => {
    if (!focusId || !fullRows) return null
    return fullRows.find((c) => c.id === focusId) ?? null
  }, [focusId, fullRows])

  const eligibleList = useMemo(
    () => (fullRows || []).filter((c) => c.steve_addon_eligible),
    [fullRows],
  )

  useEffect(() => {
    if (focusRow) {
      setSelectedId(focusRow.steve_addon_eligible ? focusRow.id : null)
    }
  }, [focusRow])

  const heading = focusRow
    ? focusRow.steve_addon_eligible
      ? t('subscriptions.steve_subscribe_heading', { name: focusRow.name })
      : focusRow.name
    : t('subscriptions.steve_pick_community')

  const showRadioList = !focusRow

  return (
    <ModalShell onClose={onCancel} ariaLabel={t('subscriptions.steve_picker_aria')}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
            {t('subscriptions.steve_package_kicker')}
          </p>
          <h2 className="mt-2 text-lg font-semibold">{heading}</h2>
          <p className="mt-1 text-sm text-white/60">
            {t('subscriptions.steve_eligibility_hint')}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label={t('subscriptions.close')}
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

      {focusRow && !focusRow.steve_addon_eligible && (
        <div className="mt-4 rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-50">
          {focusRow.steve_addon_message || t('subscriptions.steve_not_eligible')}
        </div>
      )}

      <div className="mt-5 max-h-64 space-y-2 overflow-y-auto pr-1">
        {fullRows === null && !loadErr && (
          <div className="text-sm text-white/50">{t('subscriptions.steve_loading_subscriptions')}</div>
        )}
        {fullRows !== null && showRadioList && eligibleList.length === 0 && (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-white/60">
            {t('subscriptions.steve_no_eligible')}
          </div>
        )}
        {showRadioList && eligibleList.map((c) => (
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
              name="steve-community"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#00CEC8]"
              checked={selectedId === c.id}
              onChange={() => setSelectedId(c.id)}
            />
            <span className="min-w-0 flex-1 break-words leading-5">
              {c.name}
              {c.tier && c.tier !== 'free' && (
                <span className="ml-2 text-xs text-white/40">
                  {t('subscriptions.current_tier', { tier: tierLabel(c.tier) })}
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
          {loading ? t('subscriptions.starting_checkout') : t('subscriptions.continue_checkout')}
        </button>
        {focusId == null && fullRows !== null && eligibleList.length === 0 && (
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex w-full items-center justify-center rounded-full border border-white/20 px-5 py-3 text-sm font-semibold text-white hover:bg-white/5"
          >
            {t('subscriptions.create_community')}
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="mt-1 text-xs text-white/40 hover:text-white/70"
        >
          {t('subscriptions.back')}
        </button>
      </div>
    </ModalShell>
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
  mobileBillingNotice,
  webBillingUrl,
}: {
  tier: CommunityTierLevel
  preselectedCommunityId: string
  onCancel: () => void
  onChoose: (communityId: number) => void
  onCreate: () => void
  activeSubscriptions: ActiveSubscriptionsPayload | null
  error?: string | null
  loading?: boolean
  mobileBillingNotice?: boolean
  webBillingUrl: string
}) {
  const { t } = useTranslation()
  const [communities, setCommunities] = useState<Community[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(
    preselectedCommunityId ? Number(preselectedCommunityId) : null,
  )

  const activeByCommunity = useMemo(
    () => new Map((activeSubscriptions?.communities || []).map((item) => [item.id, item])),
    [activeSubscriptions],
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
          throw new Error(data?.error || t('subscriptions.error_load_communities'))
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
        const activeByCommunityLocal = new Map(
          (activeSubscriptions?.communities || []).map((item) => [item.id, item]),
        )
        const owned = flat.filter((c) => {
          const withParent = c as Community & { parent_community_id?: number | null }
          if (withParent.parent_community_id) return false
          if (me && c.creator_username && c.creator_username.trim().toLowerCase() === me) return true
          if (c.role && c.role.toLowerCase() === 'owner') return true
          return false
        }).filter((c) => {
          const active = activeByCommunityLocal.get(c.id)
          return String(active?.tier || c.tier || '').toLowerCase() !== tier.tier_code
        })
        setCommunities(owned)
      } catch (err) {
        if (!cancelled) setLoadErr(err instanceof Error ? err.message : t('subscriptions.error_load_communities'))
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [activeSubscriptions, tier.tier_code])

  const downgradeFlow = useMemo(() => {
    if (!communities?.length) return false
    const targetR = paidTierRank(tier.tier_code)
    return communities.some((c) => {
      const row = activeByCommunity.get(c.id)
      return paidTierRank(row?.tier || c.tier) > targetR
    })
  }, [communities, activeByCommunity, tier.tier_code])

  return (
    <ModalShell onClose={onCancel} ariaLabel={t('subscriptions.picker_aria', { level: tier.level_label })}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
            {downgradeFlow ? t('subscriptions.picker_change_heading', { level: tier.level_label }) : t('subscriptions.picker_upgrade_heading', { level: tier.level_label })}
          </p>
          <h2 className="mt-2 text-lg font-semibold">{t('subscriptions.picker_pick_community')}</h2>
          <p className="mt-1 text-sm text-white/60">
            {downgradeFlow
              ? t('subscriptions.picker_downgrade_hint')
              : t('subscriptions.picker_upgrade_hint', {
                  maxMembers: tier.max_members ?? '?',
                  price: formatEur(tier.price_eur),
                })}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label={t('subscriptions.close')}
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
          {mobileBillingNotice && (
            <button
              type="button"
              onClick={() => openExternalBillingUrl(webBillingUrl)}
              className="mt-3 block text-left text-cpoint-turquoise underline"
            >
              {t('subscriptions.open_web_billing', { url: webBillingUrl })}
            </button>
          )}
        </div>
      )}

      <div className="mt-5 max-h-64 space-y-2 overflow-y-auto pr-1">
        {communities === null && !loadErr && (
          <div className="text-sm text-white/50">{t('subscriptions.picker_loading_communities')}</div>
        )}
        {communities !== null && communities.length === 0 && (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-white/60">
            {t('subscriptions.picker_no_eligible', { tier: tierLabel(tier.tier_code) })}
          </div>
        )}
        {communities?.map((c) => {
          const row = activeByCommunity.get(c.id)
          const curRank = paidTierRank(row?.tier || c.tier)
          const targetRank = paidTierRank(tier.tier_code)
          const blockedHigher = curRank > targetRank && targetRank >= 1
          return (
          <label
            key={c.id}
            className={
              'flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition ' +
              (blockedHigher
                ? 'cursor-not-allowed border-white/5 bg-white/[0.02] opacity-55'
                : selectedId === c.id
                ? 'border-cpoint-turquoise/60 bg-cpoint-turquoise/10'
                : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]')
            }
          >
            <input
              type="radio"
              name="community"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#00CEC8]"
              checked={selectedId === c.id}
              disabled={blockedHigher}
              onChange={() => setSelectedId(c.id)}
            />
            <span className="min-w-0 flex-1 break-words leading-5">
              {c.name}
              {currentTierLabel(c, activeSubscriptions) && (
                <span className="ml-2 text-xs text-white/40">
                  {currentTierLabel(c, activeSubscriptions)}
                </span>
              )}
              {blockedHigher && (
                <span className="mt-1 block text-[11px] text-amber-200/80">
                  {t('subscriptions.picker_higher_tier_blocked')}
                </span>
              )}
            </span>
          </label>
          )
        })}
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
          {loading ? t('subscriptions.starting_checkout') : t('subscriptions.continue_checkout')}
        </button>
        {communities !== null && communities.length === 0 && (
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex w-full items-center justify-center rounded-full border border-white/20 px-5 py-3 text-sm font-semibold text-white hover:bg-white/5"
          >
            {t('subscriptions.create_community')}
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="mt-1 text-xs text-white/40 hover:text-white/70"
        >
          {t('subscriptions.cancel')}
        </button>
      </div>
    </ModalShell>
  )
}
