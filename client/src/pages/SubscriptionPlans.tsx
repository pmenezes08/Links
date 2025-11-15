import { useEffect, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'

type BillingCycle = 'monthly' | 'yearly'

type Plan = {
  id: string
  name: string
  description: string
  monthly: number
  yearly: number
  cta: string
  highlight?: string
  features: string[]
}

const PLAN_DATA: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'Get started with essential collaboration tools.',
    monthly: 0,
    yearly: 0,
    cta: 'Start for Free',
    features: [
      'Core C-Point experience',
      'Community help center support',
      'Basic analytics dashboard',
      'Single-user seat',
      'Shared storage pool',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    description: 'Unlock advanced automation and priority support.',
    monthly: 10,
    yearly: 100,
    cta: 'Buy Now',
    highlight: 'Popular',
    features: [
      'Everything in Free',
      'Priority concierge onboarding',
      'Advanced analytics suite',
      'Role-based permissions',
      'Expanded secure storage',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Tailored partnership with dedicated experts.',
    monthly: 0,
    yearly: 0,
    cta: 'Contact Sales',
    features: [
      'White-glove onboarding',
      'Dedicated success squad',
      'Custom analytics and exports',
      'Unlimited storage and audit logging',
      'Preview access to new labs',
    ],
  },
]

type CurrencyInfo = {
  symbol: string
  code?: string
  timestamp?: number
}

const CURRENCY_INFO_KEY = 'cpoint_currency_info'
const DEFAULT_CURRENCY: CurrencyInfo = { symbol: '$', code: 'USD' }
const CURRENCY_CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours

function readStoredCurrency(): CurrencyInfo {
  try {
    const raw = sessionStorage.getItem(CURRENCY_INFO_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as CurrencyInfo
      if (parsed?.symbol) {
        return parsed
      }
    }
    const legacySymbol = sessionStorage.getItem('cpoint_currency_symbol')
    if (legacySymbol) {
      return { symbol: legacySymbol }
    }
  } catch {}
  return DEFAULT_CURRENCY
}

function persistCurrency(info: CurrencyInfo) {
  try {
    sessionStorage.setItem(
      CURRENCY_INFO_KEY,
      JSON.stringify({ ...info, timestamp: Date.now() }),
    )
    sessionStorage.setItem('cpoint_currency_symbol', info.symbol)
  } catch {}
}

function symbolFromCurrencyCode(code?: string) {
  if (!code) return undefined
  const normalized = code.toUpperCase()
  const table: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    INR: '₹',
    AUD: 'A$',
    CAD: 'C$',
    JPY: '¥',
    CHF: 'CHF',
    SEK: 'kr',
    NOK: 'kr',
    DKK: 'kr',
    PLN: 'zł',
  }
  return table[normalized]
}

function isCurrencyFresh(info?: CurrencyInfo | null) {
  if (!info?.symbol || !info?.timestamp) return false
  return Date.now() - info.timestamp < CURRENCY_CACHE_TTL
}

function formatPrice(plan: Plan, cycle: BillingCycle, currencySymbol: string) {
  const amount = cycle === 'monthly' ? plan.monthly : plan.yearly
  const suffix = cycle === 'monthly' ? 'per month' : 'per year'
  if (plan.id === 'enterprise') {
    return (
      <span className="text-sm font-medium text-[#4db6ac]">Contact us</span>
    )
  }
  if (amount === 0)
    return (
      <>
        {currencySymbol}0 <span className="text-sm font-normal text-white/70">{suffix}</span>
      </>
    )
  return <>
    {currencySymbol}
    {amount.toLocaleString(undefined)}
    <span className="text-sm font-normal text-white/70"> {suffix}</span>
  </>
}

export default function SubscriptionPlans() {
  const { setTitle } = useHeader()
  const initialCurrencyInfo = readStoredCurrency()
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly')
  const [currency, setCurrency] = useState(initialCurrencyInfo.symbol)
  const [currencyLoading, setCurrencyLoading] = useState(!isCurrencyFresh(initialCurrencyInfo))
  const [processingPlan, setProcessingPlan] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    setTitle('Subscription Plans')
  }, [setTitle])

  useEffect(() => {
    let cancelled = false
    async function detectCurrency() {
      try {
        const cached = readStoredCurrency()
        if (isCurrencyFresh(cached)) {
          if (!cancelled) {
            setCurrency(cached.symbol)
            setCurrencyLoading(false)
          }
          return
        }
        const resp = await fetch('https://ipapi.co/json/', { cache: 'no-store' })
        if (!resp.ok) throw new Error('ipapi failed')
        const data = await resp.json().catch(() => null)
        const symbol = data?.currency_symbol || symbolFromCurrencyCode(data?.currency) || DEFAULT_CURRENCY.symbol
        const info: CurrencyInfo = {
          symbol,
          code: data?.currency || DEFAULT_CURRENCY.code,
          timestamp: Date.now(),
        }
        persistCurrency(info)
        if (!cancelled) {
          setCurrency(symbol)
          setCurrencyLoading(false)
        }
      } catch {
        const fallbackSymbol = navigator.language?.toLowerCase().includes('us') ? '$' : '€'
        const info: CurrencyInfo = {
          symbol: fallbackSymbol,
          code: fallbackSymbol === '$' ? 'USD' : 'EUR',
          timestamp: Date.now(),
        }
        persistCurrency(info)
        if (!cancelled) {
          setCurrency(info.symbol)
          setCurrencyLoading(false)
        }
      }
    }
    detectCurrency()
    return () => {
      cancelled = true
    }
  }, [])

  const handlePlanAction = async (plan: Plan) => {
    setActionError(null)
    if (plan.id === 'enterprise') {
      window.open('mailto:hello@c-point.co?subject=C-Point%20Enterprise%20Plan', '_blank', 'noopener,noreferrer')
      return
    }
    if (plan.id === 'free') {
      // No checkout required
      return
    }
    setProcessingPlan(plan.id)
    try {
      const resp = await fetch('/api/stripe/create_checkout_session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          plan_id: plan.id,
          billing_cycle: billingCycle,
        }),
      })
      const payload = await resp.json().catch(() => null)
      if (!resp.ok || !payload?.success) {
        throw new Error(payload?.error || 'Unable to start the checkout flow.')
      }
      if (payload.url) {
        window.location.href = payload.url
        return
      }
      throw new Error('Stripe is not available. Please try again later.')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to start checkout.')
    } finally {
      setProcessingPlan(null)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white pt-16 pb-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4">
        <section className="flex justify-center">
          <div className="inline-flex rounded-full border border-white/15 bg-white/5 p-1">
            {(['monthly', 'yearly'] as BillingCycle[]).map(option => {
              const isActive = billingCycle === option
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setBillingCycle(option)}
                  className={`rounded-full px-4 py-1 text-xs font-semibold uppercase tracking-[0.3em] transition ${
                    isActive ? 'bg-white text-black' : 'text-white/70'
                  }`}
                >
                  {option === 'monthly' ? 'Monthly' : 'Yearly'}
                </button>
              )
            })}
          </div>
        </section>
          {actionError ? (
            <div className="rounded-2xl border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-200">
              {actionError}
            </div>
          ) : null}
          <section className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-4 snap-x snap-mandatory">
            {PLAN_DATA.map(plan => {
              const isProcessing = processingPlan === plan.id
              return (
                <article
                  key={plan.id}
                  className={`snap-center min-w-[280px] sm:min-w-[320px] rounded-3xl border border-white/10 bg-gradient-to-br from-[#020406] via-[#040b0f] to-[#010203] p-5 text-white shadow-[0_30px_60px_rgba(0,0,0,0.45)] ${
                    plan.highlight ? 'ring-1 ring-[#4db6ac]' : ''
                  }`}
                >
                  {plan.highlight ? (
                    <div className="mb-4 inline-flex items-center rounded-full bg-[#4db6ac]/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#4db6ac]">
                      {plan.highlight}
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-1">
                    <div className="text-sm font-semibold uppercase tracking-[0.2em] text-white/70">{plan.name}</div>
                    <div className="text-3xl font-semibold">
                      {currencyLoading && plan.id !== 'enterprise' ? (
                        <span className="text-base font-normal text-white/70">Detecting currency…</span>
                      ) : (
                        formatPrice(plan, billingCycle, currency)
                      )}
                    </div>
                    <p className="text-sm text-white/70">{plan.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handlePlanAction(plan)}
                    disabled={plan.id === 'premium' && isProcessing}
                    className="mt-4 w-full rounded-2xl border border-[#4db6ac]/30 px-4 py-2 text-sm font-semibold text-white transition hover:border-[#4db6ac]/60 hover:bg-[#4db6ac]/10 disabled:opacity-60"
                  >
                    {isProcessing ? 'Redirecting…' : plan.cta}
                  </button>
                  <ul className="mt-5 space-y-2 text-sm text-white/80">
                    {plan.features.map(feature => (
                      <li key={feature} className="flex items-start gap-2">
                        <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-[#4db6ac]" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              )
            })}
          </section>
      </div>
    </div>
  )
}
