import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

/**
 * Post-Stripe-Checkout landing page.
 *
 * Stripe redirects here with `?session_id=cs_...`. We poll
 * `/api/stripe/checkout_status` until the webhook has written the SKU's
 * actual billing state. Community purchases therefore confirm the exact
 * community/tier rather than showing a personal Premium-only fallback.
 *
 * The user's tier is NOT mutated here — the server-side `/success`
 * route serves this SPA; the webhook is the single source of truth for
 * subscription state.
 */

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
    setTitle('Welcome')
  }, [setTitle])

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
        if (!data?.success) setStatusError(data?.error || 'Unable to confirm checkout')
      } catch {
        if (!cancelled) setStatusError('Unable to confirm checkout')
      } finally {
        if (!cancelled) {
          setLoading(false)
          setAttempts(1)
        }
      }
    }
    loadInitialStatus()
    return () => { cancelled = true }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId || isActive) return
    if (attempts >= MAX_POLL_ATTEMPTS) return
    const handle = window.setTimeout(() => {
      fetch(`/api/stripe/checkout_status?session_id=${encodeURIComponent(sessionId)}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
        .then((r) => r.json())
        .then((data) => {
          setCheckout(data)
          if (!data?.success) setStatusError(data?.error || 'Unable to confirm checkout')
        })
        .catch(() => setStatusError('Unable to confirm checkout'))
        .finally(() => {
          setLoading(false)
          setAttempts((n) => n + 1)
        })
    }, POLL_INTERVAL_MS)
    pollTimer.current = handle
    return () => {
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
    }
  }, [attempts, isActive, sessionId])

  const onOpenPortal = useCallback(async () => {
    setPortalLoading(true)
    setPortalError(null)
    try {
      const portalUrl = isCommunity && checkout?.community_id
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
          return_path: isCommunity && checkout?.community_id
            ? `/community/${checkout.community_id}/edit`
            : '/account_settings',
        }),
      })
      const data = await res.json()
      if (!res.ok || !data?.success || !data?.url) {
        throw new Error(data?.error || 'Unable to open billing portal')
      }
      window.location.assign(data.url)
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : 'Unable to open billing portal')
      setPortalLoading(false)
    }
  }, [checkout?.community_id, isCommunity])

  const headline = isActive
    ? isCommunity
      ? `${checkout?.tier_label || 'Paid tier'} is active.`
      : 'Premium is active.'
    : 'Payment received.'

  const body = isActive
    ? isCommunity
      ? `Your ${checkout?.community_name || 'community'} subscription has been activated.`
      : 'Your Premium benefits are active across C-Point.'
    : loading || attempts < MAX_POLL_ATTEMPTS
    ? 'Payment received, finalising subscription.'
    : isCommunity
    ? 'Payment recorded, still syncing. Check Manage Community in a minute.'
    : "Payment recorded, still syncing. Check your membership shortly."

  return (
    <div className="min-h-screen bg-black text-white pt-16 pb-24">
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

        <h1 className="mt-8 text-2xl font-semibold tracking-tight">
          {headline}
        </h1>
        <p className="mt-4 text-white/60 leading-relaxed">
          {body}
        </p>

        {statusError && (
          <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            {statusError}
          </div>
        )}

        {sessionId && (
          <p className="mt-4 text-[11px] uppercase tracking-[0.22em] text-white/30">
            Ref {sessionId.slice(0, 18)}…
          </p>
        )}

        {portalError && (
          <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {portalError}
          </div>
        )}

        <div className="mt-10 flex flex-col gap-3">
          {portalAvailable && (
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
              {portalLoading ? 'Opening portal…' : 'Open billing portal'}
            </button>
          )}
          {isCommunity && checkout?.community_id && (
            <button
              type="button"
              onClick={() => navigate(`/community/${checkout.community_id}/edit`)}
              className="inline-flex w-full items-center justify-center rounded-full bg-cpoint-turquoise px-6 py-3 text-sm font-semibold text-black hover:bg-cpoint-turquoise/90"
            >
              Manage community
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate(isCommunity && checkout?.community_id ? `/community_feed_react/${checkout.community_id}` : '/home')}
            className="inline-flex w-full items-center justify-center rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white hover:bg-white/5"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
