import { useEffect, useMemo, useState } from 'react'
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
    monthly: 500,
    yearly: 5500,
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
    monthly: 900,
    yearly: 9900,
    cta: 'Buy Now',
    features: [
      'White-glove onboarding',
      'Dedicated success squad',
      'Custom analytics and exports',
      'Unlimited storage and audit logging',
      'Preview access to new labs',
    ],
  },
]

function formatPrice(plan: Plan, cycle: BillingCycle) {
  const amount = cycle === 'monthly' ? plan.monthly : plan.yearly
  const suffix = cycle === 'monthly' ? 'per month' : 'per year'
  if (amount === 0) return <>₹0 <span className="text-sm font-normal text-white/70">{suffix}</span></>
  return (
    <>
      ₹{amount.toLocaleString('en-IN')}
      <span className="text-sm font-normal text-white/70"> {suffix}</span>
    </>
  )
}

export default function SubscriptionPlans() {
  const { setTitle } = useHeader()
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly')

  useEffect(() => {
    setTitle('Subscription Plans')
  }, [setTitle])

  const cards = useMemo(
    () =>
      PLAN_DATA.map(plan => (
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
            <div className="text-3xl font-semibold">{formatPrice(plan, billingCycle)}</div>
            <p className="text-sm text-white/70">{plan.description}</p>
          </div>
          <button className="mt-4 w-full rounded-2xl border border-[#4db6ac]/30 px-4 py-2 text-sm font-semibold text-white hover:border-[#4db6ac]/60 hover:bg-[#4db6ac]/10">
            {plan.cta}
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
      )),
    [billingCycle],
  )

  return (
    <div className="min-h-screen bg-black text-white pt-16 pb-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4">
        <section className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Manage your subscription</h1>
            <p className="text-sm text-white/70">Compare plans and switch billing frequency at any time.</p>
          </div>
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

        <section className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-4 snap-x snap-mandatory">{cards}</section>

        <section className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm text-white/70">
          Looking for something more custom? Contact our team and we&#39;ll help craft a tailored plan.
        </section>
      </div>
    </div>
  )
}
