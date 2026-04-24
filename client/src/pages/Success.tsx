import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import { useEntitlements } from '../hooks/useEntitlements'

/**
 * Post-Stripe-Checkout landing page.
 *
 * Stripe redirects here with `?session_id=cs_...`. We poll
 * `/api/me/entitlements` at short intervals (and rely on the hook's
 * focus-refresh) until the webhook has processed
 * `checkout.session.completed` and flipped the tier. That guarantees the
 * "Premium is active" copy is truthful before we show it.
 *
 * The user's tier is NOT mutated here — the server-side `/success`
 * route serves this SPA; the webhook is the single source of truth for
 * subscription state.
 */

const MAX_POLL_ATTEMPTS = 10
const POLL_INTERVAL_MS = 2_000

export default function Success() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sessionId = searchParams.get('session_id') || ''
  const { entitlements, loading, refresh } = useEntitlements()
  const [attempts, setAttempts] = useState(0)
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)
  const pollTimer = useRef<number | null>(null)

  useEffect(() => {
    setTitle('Welcome')
  }, [setTitle])

  const tier = entitlements?.tier
  const isPaid = tier === 'premium' || tier === 'special'

  // Poll until the webhook updates the tier or we exhaust the budget.
  useEffect(() => {
    if (isPaid) return
    if (attempts >= MAX_POLL_ATTEMPTS) return
    const handle = window.setTimeout(() => {
      refresh().catch(() => undefined)
      setAttempts((n) => n + 1)
    }, POLL_INTERVAL_MS)
    pollTimer.current = handle
    return () => {
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
    }
  }, [attempts, isPaid, refresh])

  const onOpenPortal = useCallback(async () => {
    setPortalLoading(true)
    setPortalError(null)
    try {
      const res = await fetch('/api/me/billing/portal', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ return_path: '/account_settings' }),
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
  }, [])

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
          Payment received.
        </h1>
        <p className="mt-4 text-white/60 leading-relaxed">
          {isPaid
            ? 'Your Premium benefits are active across C-Point.'
            : loading || attempts < MAX_POLL_ATTEMPTS
            ? 'Finalising your subscription — this usually takes a few seconds…'
            : "We've recorded your payment. Your plan may take a minute to appear — you can refresh the page if you don't see it shortly."}
        </p>

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
          <button
            type="button"
            onClick={() => navigate('/home')}
            className="inline-flex w-full items-center justify-center rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white hover:bg-white/5"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
