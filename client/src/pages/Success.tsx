import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

const MAX_POLL_ATTEMPTS = 10
const POLL_INTERVAL_MS = 2_000

type CheckoutStatus = {
  success: boolean
  sku?: 'premium' | 'community_tier'
  status?: 'pending' | 'active' | 'cancelled' | 'failed' | 'unknown'
  community_id?: number | null
  community_name?: string | null
  tier_label?: string | null
  billing_state?: {
    stripe_customer_id?: string | null
  }
  error?: string
}

export default function Success() {
  const { t } = useTranslation()
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sessionId = searchParams.get('session_id') || ''
  const [attempts, setAttempts] = useState(0)
  const [checkout, setCheckout] = useState<CheckoutStatus | null>(null)
  const [loading, setLoading] = useState(!!sessionId)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)
  const pollTimer = useRef<number | null>(null)

  useEffect(() => {
    setTitle(t('billing.checkout_success.page_title'))
  }, [setTitle, t])

  const isActive = checkout?.status === 'active'
  const isCommunity = checkout?.sku === 'community_tier'
  const portalAvailable = !!checkout?.billing_state?.stripe_customer_id

  useEffect(() => {
    if (!sessionId) {
      setLoading(false)
      return
    }
    let cancelled = false
    async function loadInitialStatus() {
      try {
        const res = await fetch(`/api/stripe/checkout_status?session_id=${encodeURIComponent(sessionId)}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const data = await res.json()
        if (cancelled) return
        setCheckout(data)
        if (!data?.success) setStatusError(data?.error || t('billing.checkout_success.confirm_failed'))
      } catch {
        if (!cancelled) setStatusError(t('billing.checkout_success.confirm_failed'))
      } finally {
        if (!cancelled) {
          setLoading(false)
          setAttempts(1)
        }
      }
    }
    loadInitialStatus()
    return () => {
      cancelled = true
    }
  }, [sessionId, t])

  useEffect(() => {
    if (!sessionId || isActive) return
    if (attempts >= MAX_POLL_ATTEMPTS) return
    const handle = window.setTimeout(() => {
      fetch(`/api/stripe/checkout_status?session_id=${encodeURIComponent(sessionId)}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
        .then(r => r.json())
        .then(data => {
          setCheckout(data)
          if (!data?.success) setStatusError(data?.error || t('billing.checkout_success.confirm_failed'))
        })
        .catch(() => setStatusError(t('billing.checkout_success.confirm_failed')))
        .finally(() => {
          setLoading(false)
          setAttempts(n => n + 1)
        })
    }, POLL_INTERVAL_MS)
    pollTimer.current = handle
    return () => {
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
    }
  }, [attempts, isActive, sessionId, t])

  const onOpenPortal = useCallback(async () => {
    setPortalLoading(true)
    setPortalError(null)
    try {
      const portalUrl =
        isCommunity && checkout?.community_id
          ? `/api/me/billing/portal?community_id=${checkout.community_id}`
          : '/api/me/billing/portal'
      const res = await fetch(portalUrl, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          return_path:
            isCommunity && checkout?.community_id
              ? `/community/${checkout.community_id}/edit`
              : '/account_settings',
        }),
      })
      const data = await res.json()
      if (!res.ok || !data?.success || !data?.url) {
        throw new Error(data?.error || t('billing.checkout_success.portal_open_failed'))
      }
      window.location.assign(data.url)
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : t('billing.checkout_success.portal_open_failed'))
      setPortalLoading(false)
    }
  }, [checkout?.community_id, isCommunity, t])

  const headline = isActive
    ? isCommunity
      ? t('billing.checkout_success.tier_active', {
          tier: checkout?.tier_label || t('billing.checkout_success.paid_tier_fallback'),
        })
      : t('billing.checkout_success.premium_active')
    : t('billing.checkout_success.payment_received')

  const body = isActive
    ? isCommunity
      ? t('billing.checkout_success.community_body', {
          name: checkout?.community_name || t('billing.checkout_success.community_fallback'),
        })
      : t('billing.checkout_success.premium_body')
    : loading || attempts < MAX_POLL_ATTEMPTS
      ? t('billing.checkout_success.finalising')
      : isCommunity
        ? t('billing.checkout_success.syncing_community')
        : t('billing.checkout_success.syncing_membership')

  return (
    <div className="min-h-screen bg-c-bg-app text-c-text-primary pt-16 pb-24">
      <div className="mx-auto max-w-md px-4 pt-16 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-cpoint-turquoise/30 bg-cpoint-turquoise/10">
          <svg
            className="h-8 w-8 text-cpoint-turquoise"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight">{headline}</h1>
        <p className="mt-4 text-c-text-tertiary leading-relaxed">{body}</p>

        {statusError ? (
          <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            {statusError}
          </div>
        ) : null}

        {sessionId ? (
          <p className="mt-4 text-[11px] uppercase tracking-[0.22em] text-c-text-tertiary">
            {t('billing.checkout_success.ref_prefix')} {sessionId.slice(0, 18)}…
          </p>
        ) : null}

        {portalError ? (
          <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {portalError}
          </div>
        ) : null}

        <div className="mt-10 flex flex-col gap-3">
          {portalAvailable ? (
            <button
              type="button"
              onClick={onOpenPortal}
              disabled={portalLoading}
              className={
                'inline-flex w-full items-center justify-center rounded-full px-6 py-3 text-sm font-semibold transition ' +
                (portalLoading
                  ? 'bg-cpoint-turquoise/60 text-black cursor-wait'
                  : 'bg-cpoint-turquoise text-black hover:bg-cpoint-turquoise/90')
              }
            >
              {portalLoading ? t('billing.checkout_success.opening_portal') : t('billing.checkout_success.open_portal')}
            </button>
          ) : null}
          {isCommunity && checkout?.community_id ? (
            <button
              type="button"
              onClick={() => navigate(`/community/${checkout.community_id}/edit`)}
              className="inline-flex w-full items-center justify-center rounded-full bg-cpoint-turquoise px-6 py-3 text-sm font-semibold text-black hover:bg-cpoint-turquoise/90"
            >
              {t('billing.checkout_success.manage_community')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() =>
              navigate(isCommunity && checkout?.community_id ? `/community_feed_react/${checkout.community_id}` : '/home')
            }
            className="inline-flex w-full items-center justify-center rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-c-text-primary hover:bg-c-hover-bg"
          >
            {t('billing.checkout_success.continue')}
          </button>
        </div>
      </div>
    </div>
  )
}
