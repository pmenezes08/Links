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
    id: 'basic',
    name: 'Basic',
    description: 'Free plan with limited access to essential tools.',
    monthly: 0,
    yearly: 0,
    cta: 'Start for Free',
    features: [
      'Access to core tools with limited functionality',
      'Community support via help center',
      'Basic analytics dashboard',
      'Single-user access with standard permissions',
      'Limited storage and export options',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    description: 'Recommended plan with personalized onboarding.',
    monthly: 500,
    yearly: 5500,
    cta: 'Buy Now',
    highlight: 'Recommended',
    features: [
      'Everything in Basic plus advanced workflows',
      'Priority community support and office hours',
      'Extended analytics and reporting suite',
      'Role-based permissions for small teams',
      'Increased storage and export allowances',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    description: 'Advanced plan with white-glove assistance.',
    monthly: 900,
    yearly: 9900,
    cta: 'Buy Now',
    features: [
      'All Business features plus concierge onboarding',
      'Dedicated success manager',
      'Custom analytics dashboards and exports',
      'Unlimited storage and audit logging',
      'Early access to experimental tooling',
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
          className={`rounded-3xl border border-white/10 bg-gradient-to-br from-[#14161e] via-[#0f1218] to-[#090b10] p-5 text-white shadow-[0_30px_60px_rgba(0,0,0,0.45)] ${
            plan.highlight ? 'ring-1 ring-[#d09bff]' : ''
          }`}
        >
          {plan.highlight ? (
            <div className="mb-4 inline-flex items-center rounded-full bg-[#d09bff]/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#d09bff]">
              {plan.highlight}
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-white/70">{plan.name}</div>
            <div className="text-3xl font-semibold">{formatPrice(plan, billingCycle)}</div>
            <p className="text-sm text-white/70">{plan.description}</p>
          </div>
          <button className="mt-4 w-full rounded-2xl border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:border-white/40 hover:bg-white/5">
            {plan.cta}
          </button>
          <ul className="mt-5 space-y-2 text-sm text-white/80">
            {plan.features.map(feature => (
              <li key={feature} className="flex items-start gap-2">
                <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-[#8f8fff]" />
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

        <section className="grid gap-4 md:grid-cols-3">{cards}</section>

        <section className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm text-white/70">
          Looking for something more custom? Contact our team and we&#39;ll help craft a tailored plan.
        </section>
      </div>
    </div>
  )
}
