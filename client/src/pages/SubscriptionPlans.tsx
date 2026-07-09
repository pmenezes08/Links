import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import ManageMembershipModal, { type MembershipTab } from '../components/membership/ManageMembershipModal'
import SettingsPanel from '../components/settings/SettingsPanel'
import AddonsPanel from '../components/subscriptions/AddonsPanel'
import CommunityPickerPanel from '../components/subscriptions/CommunityPickerPanel'
import CommunityTiersPanel from '../components/subscriptions/CommunityTiersPanel'
import PersonalPlanPanel from '../components/subscriptions/PersonalPlanPanel'
import StevePickerPanel from '../components/subscriptions/StevePickerPanel'
import SubscriptionsHome from '../components/subscriptions/SubscriptionsHome'
import SubscriptionsHubSkeleton from '../components/subscriptions/SubscriptionsHubSkeleton'
import {
  maybeConfirmPendingCheckout,
  resetSubscriptionPageScroll,
  storePendingCheckout,
} from '../components/subscriptions/subscriptionCheckout'
import { tierLabel } from '../components/subscriptions/subscriptionFormatters'
import type {
  ActiveSubscriptionsPayload,
  CommunityTierLevel,
  PricingPayload,
  SubscriptionsPanelKey,
} from '../components/subscriptions/subscriptionTypes'
import { useHeader } from '../contexts/HeaderContext'
import { ENTITLEMENTS_REFRESH_EVENT } from '../hooks/useEntitlements'
import { triggerHaptic } from '../utils/haptics'
import {
  canUseNativeStoreIap,
  currentStoreProvider,
  loadIapConfig,
  nativeIapPurchasesEnabled,
  providerLabel,
  purchaseStoreSubscription,
  restoreStorePurchases,
  type IapConfig,
} from '../utils/mobileStoreBilling'

export default function SubscriptionPlans() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const [pricing, setPricing] = useState<PricingPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [panelStack, setPanelStack] = useState<SubscriptionsPanelKey[]>([])
  const [pendingTier, setPendingTier] = useState<CommunityTierLevel | null>(null)
  const [activeSubscriptions, setActiveSubscriptions] = useState<ActiveSubscriptionsPayload | null>(null)
  const [iapConfig, setIapConfig] = useState<IapConfig | null>(null)
  const [mobileBillingNotice, setMobileBillingNotice] = useState(false)
  const [membershipTab, setMembershipTab] = useState<MembershipTab | null>(null)
  const historyDepthRef = useRef(0)
  const skipPopstateRef = useRef(false)

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

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type })
    void triggerHaptic(type === 'success' ? 'success' : 'error')
  }, [])

  useEffect(() => {
    const qsStatus = queryParams.get('status')
    if (qsStatus === 'cancelled') {
      showToast(t('subscriptions.checkout_cancelled'))
      resetSubscriptionPageScroll()
    }
  }, [queryParams, showToast, t])

  const topPanel = panelStack[panelStack.length - 1] ?? null
  const isPanelOpen = panelStack.length > 0

  const pushPanel = useCallback((panel: SubscriptionsPanelKey, opts?: { skipHistory?: boolean }) => {
    void triggerHaptic('light')
    setPanelStack(prev => (prev.includes(panel) && prev[prev.length - 1] === panel ? prev : [...prev, panel]))
    if (!opts?.skipHistory) {
      historyDepthRef.current += 1
      window.history.pushState({ subscriptionsPanel: panel }, '')
    }
  }, [])

  const popPanel = useCallback((opts?: { skipHistory?: boolean }) => {
    void triggerHaptic('light')
    setPanelStack(prev => {
      const next = prev.slice(0, -1)
      if (prev[prev.length - 1] === 'communityPicker') {
        setPendingTier(current => (next[next.length - 1] === 'communityTiers' ? current : null))
      }
      if (next.length === 0) {
        setPanelError(null)
        setMobileBillingNotice(false)
      }
      return next
    })
    if (!opts?.skipHistory && historyDepthRef.current > 0) {
      skipPopstateRef.current = true
      historyDepthRef.current -= 1
      window.history.back()
    }
  }, [])

  useEffect(() => {
    const onPopState = () => {
      if (skipPopstateRef.current) {
        skipPopstateRef.current = false
        return
      }
      if (historyDepthRef.current > 0) {
        historyDepthRef.current -= 1
      }
      setPanelStack(prev => {
        const next = prev.slice(0, -1)
        if (prev[prev.length - 1] === 'communityPicker' && next[next.length - 1] !== 'communityTiers') {
          setPendingTier(null)
        }
        if (next.length === 0) {
          setPanelError(null)
          setMobileBillingNotice(false)
        }
        return next
      })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const locked = isPanelOpen
    const previous = document.body.style.overflow
    if (locked) document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [isPanelOpen])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 2400)
    return () => window.clearTimeout(id)
  }, [toast])

  useEffect(() => {
    const requestedOpen = queryParams.get('open')
    if (requestedOpen === 'community_plans') {
      setPanelError(null)
      setPanelStack(['communityTiers'])
      historyDepthRef.current = 1
      window.history.replaceState({ subscriptionsPanel: 'communityTiers' }, '')
      resetSubscriptionPageScroll()
    } else if (requestedOpen === 'community_addons') {
      setPanelError(null)
      setPanelStack(['stevePicker'])
      historyDepthRef.current = 1
      window.history.replaceState({ subscriptionsPanel: 'stevePicker' }, '')
      resetSubscriptionPageScroll()
    }
  }, [queryParams])

  // Steve gating reads the entitlements snapshot cached by useEntitlements
  // (20s focus throttle). After a successful purchase/restore we dispatch the
  // global refresh event so caps update immediately instead of on next focus.
  const refreshEntitlements = useCallback(() => {
    window.dispatchEvent(new Event(ENTITLEMENTS_REFRESH_EVENT))
  }, [])

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
        refreshEntitlements()
        showToast(successMessage)
        setPanelStack([])
        setPendingTier(null)
        setPanelError(null)
        historyDepthRef.current = 0
        resetSubscriptionPageScroll()
      }
    }
    return data
  }, [refreshEntitlements, showToast])

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
          throw new Error(i18n.t('subscriptions.error_load_pricing'))
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
          const portalReason =
            data?.reason === 'already_subscribed' || data?.reason === 'steve_package_already_active'
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
        else {
          setError(message)
          void triggerHaptic('error')
        }
        setCheckoutLoading(null)
      }
    },
    [],
  )

  const storeProvider = currentStoreProvider()
  const iapEnabled = nativeIapPurchasesEnabled(iapConfig)
  // When KB purchases are off (or config failed to load) on a native shell,
  // purchase CTAs become informational only — never a web checkout link
  // (App Store 3.1.1). Restore stays available regardless.
  const iapPurchasesDisabledOnNative = !!storeProvider && !iapEnabled

  const onSubscribePremium = useCallback(async () => {
    // `cpoint_premium_monthly` was removed from sale in the app stores
    // (July 2026): there is no native Premium purchase path any more. The
    // panel hides the CTA on native; this guard keeps a stray call from
    // falling through to a Stripe checkout inside the native shell.
    if (currentStoreProvider()) {
      setError(t('subscriptions.premium_native_unavailable'))
      void triggerHaptic('error')
      resetSubscriptionPageScroll()
      return
    }
    startCheckout({ plan_id: 'premium', billing_cycle: 'monthly' }, 'premium')
  }, [startCheckout, t])

  const onRestorePurchases = useCallback(async () => {
    // Restore is intentionally NOT gated on iap_purchases_enabled: legacy
    // buyers (including retired App Store Premium purchasers) must always be
    // able to re-link what they already paid for.
    const provider = currentStoreProvider()
    if (!provider || !iapConfig) return
    setCheckoutLoading(`restore:${provider}`)
    setError(null)
    setPanelError(null)
    try {
      const outcome = await restoreStorePurchases(provider, iapConfig)
      const label = providerLabel(provider)
      // Map the typed outcome to reassurance-first copy — never surface a raw
      // backend code. Money anxiety is the real failure mode on a reinstall.
      if (outcome.reason === 'restored') {
        showToast(t('subscriptions.status_restored', { count: outcome.count }))
        refreshEntitlements()
        await loadActiveSubscriptions()
      } else if (outcome.reason === 'account_mismatch') {
        showToast(t('subscriptions.restore_account_mismatch'), 'error')
      } else if (outcome.reason === 'transient') {
        showToast(t('subscriptions.restore_transient', { provider: label }), 'error')
      } else {
        showToast(t('subscriptions.restore_no_purchase', { provider: label }), 'error')
      }
    } catch {
      // Unexpected failure — treat as transient, still no raw code.
      showToast(t('subscriptions.restore_transient', { provider: providerLabel(provider) }), 'error')
    } finally {
      setCheckoutLoading(null)
    }
  }, [iapConfig, loadActiveSubscriptions, refreshEntitlements, showToast, t])

  const onPickTier = useCallback(
    (tier: CommunityTierLevel) => {
      setPendingTier(tier)
      setPanelError(null)
      setMobileBillingNotice(false)
      resetSubscriptionPageScroll()
      pushPanel('communityPicker')
    },
    [pushPanel],
  )

  const onCommunityChosen = useCallback(
    async (communityId: number) => {
      if (!pendingTier) return
      // Native + purchases disabled: informational stop, never a checkout.
      if (currentStoreProvider() && !nativeIapPurchasesEnabled(iapConfig)) {
        setMobileBillingNotice(false)
        setPanelError(t('subscriptions.iap_purchases_unavailable'))
        void triggerHaptic('error')
        return
      }
      const activeCommunity = activeSubscriptions?.communities?.find(item => item.id === communityId)
      if (activeCommunity) {
        const billingProvider = String(activeCommunity.billing_provider || 'stripe').toLowerCase()
        if (billingProvider === 'apple' || billingProvider === 'google') {
          const provider = currentStoreProvider()
          const productId =
            provider === billingProvider
              ? iapConfig?.[provider]?.community_product_ids?.[pendingTier.tier_code]
              : ''
          if (
            provider !== billingProvider
            || !productId
            || !canUseNativeStoreIap(provider, iapConfig, productId)
          ) {
            setMobileBillingNotice(false)
            setPanelError(
              t('subscriptions.error_managed_store', { provider: providerLabel(billingProvider) }),
            )
            void triggerHaptic('error')
            return
          }
          const key = `community_tier:${pendingTier.tier_code}:${communityId}`
          setCheckoutLoading(key)
          setPanelError(null)
          setMobileBillingNotice(false)
          try {
            await purchaseStoreSubscription({ provider, productId, communityId })
            showToast(
              t('subscriptions.status_community_provider', {
                tier: tierLabel(pendingTier.tier_code),
                provider: providerLabel(provider),
              }),
            )
            setPanelStack([])
            setPendingTier(null)
            historyDepthRef.current = 0
            resetSubscriptionPageScroll()
            refreshEntitlements()
            await loadActiveSubscriptions()
          } catch (err) {
            setPanelError(err instanceof Error ? err.message : t('subscriptions.error_iap'))
            void triggerHaptic('error')
          } finally {
            setCheckoutLoading(null)
          }
          return
        }
        const key = `change-tier:${communityId}:${pendingTier.tier_code}`
        setCheckoutLoading(key)
        setPanelError(null)
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
          showToast(
            t('subscriptions.status_tier_changed', {
              name: activeCommunity.name,
              tier: tierLabel(pendingTier.tier_code),
            }),
          )
          setPanelStack([])
          setPendingTier(null)
          historyDepthRef.current = 0
          resetSubscriptionPageScroll()
          await loadActiveSubscriptions()
        } catch (err) {
          setPanelError(err instanceof Error ? err.message : t('subscriptions.error_change_tier'))
          void triggerHaptic('error')
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
        const existingStoreCommunity = activeSubscriptions?.communities?.find(item => {
          const bp = String(item.billing_provider || '').toLowerCase()
          return bp === provider && item.id !== communityId
        })
        if (existingStoreCommunity) {
          setMobileBillingNotice(true)
          setPanelError(
            t('subscriptions.error_one_store_community', { provider: providerLabel(provider) }),
          )
          void triggerHaptic('warning')
          return
        }
        const key = `community_tier:${pendingTier.tier_code}:${communityId}`
        setCheckoutLoading(key)
        setPanelError(null)
        setMobileBillingNotice(false)
        try {
          await purchaseStoreSubscription({ provider, productId, communityId })
          showToast(
            t('subscriptions.status_community_provider', {
              tier: tierLabel(pendingTier.tier_code),
              provider: providerLabel(provider),
            }),
          )
          setPanelStack([])
          setPendingTier(null)
          historyDepthRef.current = 0
          resetSubscriptionPageScroll()
          refreshEntitlements()
          await loadActiveSubscriptions()
        } catch (err) {
          setPanelError(err instanceof Error ? err.message : t('subscriptions.error_iap'))
          void triggerHaptic('error')
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
          onError: msg => {
            setPanelError(msg)
            void triggerHaptic('error')
          },
          onBeforeRedirect: () => {
            setPanelStack([])
            setPendingTier(null)
            historyDepthRef.current = 0
          },
        },
      )
    },
    [activeSubscriptions, iapConfig, loadActiveSubscriptions, pendingTier, refreshEntitlements, showToast, startCheckout, t],
  )

  const onSteveCommunityChosen = useCallback(
    async (communityId: number) => {
      const provider = currentStoreProvider()
      // Native + purchases disabled: informational stop, never a checkout.
      if (provider && !nativeIapPurchasesEnabled(iapConfig)) {
        setPanelError(t('subscriptions.iap_purchases_unavailable'))
        void triggerHaptic('error')
        return
      }
      const activeCommunity = activeSubscriptions?.communities?.find(item => item.id === communityId)
      const billingProvider = String(activeCommunity?.billing_provider || 'stripe').toLowerCase()
      const incomingProvider = provider || 'stripe'
      if (billingProvider && billingProvider !== incomingProvider) {
        setPanelError(
          t('subscriptions.error_managed_store', { provider: providerLabel(billingProvider) }),
        )
        void triggerHaptic('error')
        return
      }
      const steveProductId =
        provider && iapConfig?.[provider]?.steve_product_id
          ? iapConfig[provider].steve_product_id
          : ''
      const loadingKey = `steve_package:${communityId}`

      if (provider && steveProductId && canUseNativeStoreIap(provider, iapConfig, steveProductId)) {
        setCheckoutLoading(loadingKey)
        setPanelError(null)
        try {
          await purchaseStoreSubscription({
            provider,
            productId: steveProductId,
            communityId,
          })
          refreshEntitlements()
          const refreshed = await loadActiveSubscriptions()
          const name =
            refreshed?.communities?.find(c => c.id === communityId)?.name
            || activeSubscriptions?.communities?.find(c => c.id === communityId)?.name
            || t('dashboard.community_fallback')
          setPanelStack([])
          historyDepthRef.current = 0
          showToast(t('subscriptions.status_steve_active', { name }))
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : t('subscriptions.error_checkout')
          setPanelError(message)
          void triggerHaptic('error')
        } finally {
          setCheckoutLoading(null)
        }
        return
      }

      if (provider) {
        // No store product id for the Steve add-on on this platform: plain
        // informational notice — an external checkout link here would break
        // App Store 3.1.1.
        setPanelError(t('subscriptions.steve_addon_web_only'))
        void triggerHaptic('warning')
        return
      }
      startCheckout(
        { plan_id: 'steve_package', community_id: communityId },
        loadingKey,
        {
          onError: msg => {
            setPanelError(msg)
            void triggerHaptic('error')
          },
          onBeforeRedirect: () => {
            setPanelStack([])
            historyDepthRef.current = 0
          },
        },
      )
    },
    [activeSubscriptions, iapConfig, loadActiveSubscriptions, refreshEntitlements, showToast, startCheckout, t],
  )

  const openPanelFromHub = useCallback(
    (panel: SubscriptionsPanelKey) => {
      setPanelError(null)
      setMobileBillingNotice(false)
      if (panelStack.length === 0) {
        pushPanel(panel)
      } else {
        setPanelStack([panel])
        historyDepthRef.current = 1
        window.history.replaceState({ subscriptionsPanel: panel }, '')
      }
    },
    [panelStack.length, pushPanel],
  )

  const pickerPanelTitle = pendingTier
    ? t('subscriptions.picker_upgrade_heading', { level: pendingTier.level_label })
    : t('subscriptions.picker_pick_community')

  const settingsMinHeight = 'calc(100dvh - var(--app-header-offset, 0px))'

  return (
    <div className="overflow-hidden bg-c-bg-app text-c-text-primary" style={{ minHeight: settingsMinHeight }}>
      <div className="relative mx-auto max-w-xl overflow-hidden bg-c-bg-app" style={{ minHeight: settingsMinHeight }}>
        <div
          className={`transition-[transform,opacity,filter] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
            isPanelOpen ? '-translate-x-[24%] opacity-45 blur-[1px]' : 'translate-x-0 opacity-100 blur-0'
          }`}
          style={{ minHeight: settingsMinHeight }}
        >
          {loading ? (
            <div className="mx-auto max-w-xl px-5 pt-4">
              <h1 className="text-center text-xl font-bold tracking-[-0.02em] text-white">
                {t('subscriptions.hub_title')}
              </h1>
              <SubscriptionsHubSkeleton />
            </div>
          ) : error && !pricing ? (
            <div className="mx-auto max-w-xl px-5 pt-4">
              <h1 className="text-center text-xl font-bold tracking-[-0.02em] text-white">
                {t('subscriptions.hub_title')}
              </h1>
              <div className="mt-8 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            </div>
          ) : pricing ? (
            <>
              {error ? (
                <div className="mx-5 mt-4 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              ) : null}
              <SubscriptionsHome
                premium={pricing.sku.premium}
                communityTier={pricing.sku.community_tier}
                active={activeSubscriptions}
                activePanel={topPanel}
                showTestBanner={!!pricing.show_stripe_test_banner}
                ownerIntroFeedReturnId={ownerIntroFeedReturnId}
                restoreProvider={iapConfig ? storeProvider : null}
                restoreLoading={checkoutLoading != null && checkoutLoading.startsWith('restore:')}
                onRestorePurchases={onRestorePurchases}
                onOpenPanel={panel => {
                  void triggerHaptic('selection')
                  openPanelFromHub(panel)
                }}
                onManagePersonal={() => {
                  void triggerHaptic('selection')
                  setMembershipTab('plan')
                }}
                onManageCommunity={id => {
                  void triggerHaptic('selection')
                  navigate(`/community/${id}/edit`)
                }}
                onOwnerIntroContinue={() => {
                  void triggerHaptic('selection')
                  if (ownerIntroFeedReturnId != null) {
                    navigate(`/community_feed_react/${ownerIntroFeedReturnId}`)
                  }
                }}
              />
            </>
          ) : null}
        </div>

        {pricing ? (
          <>
            <SettingsPanel
              title={pricing.sku.premium.name}
              open={topPanel === 'personalPlan'}
              onBack={() => popPanel()}
            >
              <PersonalPlanPanel
                payload={pricing.sku.premium}
                onSubscribe={onSubscribePremium}
                loading={checkoutLoading === 'premium'}
                storeProvider={storeProvider}
                personalBillingProvider={activeSubscriptions?.personal?.subscription_provider ?? null}
                onRestore={onRestorePurchases}
                restoreLoading={checkoutLoading != null && checkoutLoading.startsWith('restore:')}
              />
            </SettingsPanel>

            <SettingsPanel
              title={t('subscriptions.modal_pick_tier')}
              open={topPanel === 'communityTiers'}
              onBack={() => popPanel()}
            >
              <CommunityTiersPanel
                payload={pricing.sku.community_tier}
                storeProvider={storeProvider}
                storeProductIds={
                  storeProvider ? iapConfig?.[storeProvider]?.community_product_ids || {} : {}
                }
                iapDisabledOnNative={iapPurchasesDisabledOnNative}
                onPickTier={tier => {
                  void triggerHaptic('selection')
                  onPickTier(tier)
                }}
                onOpenAddons={() => {
                  void triggerHaptic('selection')
                  pushPanel('addons')
                }}
                pendingKey={checkoutLoading}
                error={topPanel === 'communityTiers' ? panelError : null}
              />
            </SettingsPanel>

            <SettingsPanel
              title={pickerPanelTitle}
              open={topPanel === 'communityPicker' && !!pendingTier}
              onBack={() => popPanel()}
            >
              {pendingTier ? (
                <CommunityPickerPanel
                  tier={pendingTier}
                  preselectedCommunityId={preselectedCommunityId}
                  activeSubscriptions={activeSubscriptions}
                  error={panelError}
                  loading={!!checkoutLoading}
                  mobileBillingNotice={mobileBillingNotice}
                  onChoose={onCommunityChosen}
                  onCreate={() => {
                    setPanelStack([])
                    setPendingTier(null)
                    setPanelError(null)
                    setMobileBillingNotice(false)
                    historyDepthRef.current = 0
                    navigate('/premium_dashboard?open_create=1')
                  }}
                />
              ) : null}
            </SettingsPanel>

            <SettingsPanel
              title={t('subscriptions.addons_title')}
              open={topPanel === 'addons'}
              onBack={() => popPanel()}
            >
              <AddonsPanel
                steve={pricing.sku.steve_package}
                networking={pricing.sku.networking}
                storeProvider={storeProvider}
                steveNativePurchasable={
                  !!(
                    storeProvider
                    && iapConfig?.[storeProvider]?.steve_product_id
                    && canUseNativeStoreIap(
                      storeProvider,
                      iapConfig,
                      iapConfig[storeProvider].steve_product_id,
                    )
                  )
                }
                onOpenStevePicker={() => {
                  void triggerHaptic('selection')
                  pushPanel('stevePicker')
                }}
                steveCheckoutLoading={
                  checkoutLoading != null && checkoutLoading.startsWith('steve_package')
                }
              />
            </SettingsPanel>

            <SettingsPanel
              title={t('subscriptions.steve_pick_community')}
              open={topPanel === 'stevePicker'}
              onBack={() => popPanel()}
            >
              <StevePickerPanel
                activeSubscriptions={activeSubscriptions}
                preselectedCommunityId={preselectedCommunityId}
                error={panelError}
                loading={checkoutLoading != null && checkoutLoading.startsWith('steve_package')}
                onChoose={onSteveCommunityChosen}
                onCreate={() => {
                  setPanelStack([])
                  setPanelError(null)
                  historyDepthRef.current = 0
                  navigate('/premium_dashboard?open_create=1')
                }}
              />
            </SettingsPanel>
          </>
        ) : null}
      </div>

      {toast ? (
        <div
          className={`fixed left-1/2 top-[calc(env(safe-area-inset-top,0px)+1rem)] z-[1400] -translate-x-1/2 rounded-full border px-4 py-2 text-sm font-semibold shadow-2xl backdrop-blur-xl ${
            toast.type === 'success'
              ? 'border-c-border bg-c-active-bg text-white'
              : 'border-red-400/25 bg-red-500/20 text-red-100'
          }`}
        >
          {toast.text}
        </div>
      ) : null}

      <ManageMembershipModal
        open={membershipTab !== null}
        initialTab={membershipTab ?? 'plan'}
        onClose={() => setMembershipTab(null)}
      />
    </div>
  )
}
