import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

/**
 * KB-driven subscriptions hub.
 *
 * Renders four product cards whose copy, prices, and Stripe price IDs
 * come from `GET /api/kb/pricing`. The backend strips the opposite
 * mode's IDs before emitting (test-mode Stripe keys never see live IDs
 * and vice versa), so this component can trust the `stripe_price_id`
 * value it receives.
 *
 * SKUs shipped this step:
 *   - `premium`         — live checkout
 *   - `community_tier`  — live checkout (L1/L2/L3), community-owner only
 *   - `steve_package`   — "Coming soon" chip, no checkout
 *   - `networking`      — "Coming soon" chip, no checkout
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

// ---------------------------------------------------------------------------
// Small display helpers
// ---------------------------------------------------------------------------

function formatEur(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'TBD'
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return 'TBD'
  return `€${n.toFixed(2).replace(/\.00$/, '')}`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SubscriptionPlans() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const location = useLocation()
  const [pricing, setPricing] = useState<PricingPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [communityPickerOpen, setCommunityPickerOpen] = useState(false)
  const [pendingTier, setPendingTier] = useState<CommunityTierLevel | null>(null)

  useEffect(() => {
    setTitle('Subscriptions')
  }, [setTitle])

  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const preselectedCommunityId = queryParams.get('community_id') || ''

  useEffect(() => {
    const qsStatus = queryParams.get('status')
    if (qsStatus === 'cancelled') {
      setStatus('Checkout cancelled — no charge was made.')
    }
  }, [queryParams])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/kb/pricing', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const data: PricingPayload = await res.json()
        if (!cancelled) {
          if (!data.success) {
            throw new Error('Pricing load failed')
          }
          setPricing(data)
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
  }, [])

  const startCheckout = useCallback(
    async (body: Record<string, string | number>, key: string) => {
      setCheckoutLoading(key)
      setError(null)
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
          throw new Error(data?.error || 'Unable to start checkout')
        }
        if (data.url) {
          window.location.assign(data.url)
          return
        }
        throw new Error('No checkout URL returned')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to start checkout')
        setCheckoutLoading(null)
      }
    },
    [],
  )

  const onSubscribePremium = useCallback(() => {
    startCheckout({ plan_id: 'premium', billing_cycle: 'monthly' }, 'premium')
  }, [startCheckout])

  const onPickCommunity = useCallback(
    (tier: CommunityTierLevel) => {
      setPendingTier(tier)
      setCommunityPickerOpen(true)
    },
    [],
  )

  const onCommunityChosen = useCallback(
    (communityId: number) => {
      if (!pendingTier) return
      setCommunityPickerOpen(false)
      startCheckout(
        {
          plan_id: 'community_tier',
          community_id: communityId,
          tier_code: pendingTier.tier_code,
        },
        `community_tier:${pendingTier.tier_code}:${communityId}`,
      )
    },
    [pendingTier, startCheckout],
  )

  return (
    <div className="min-h-screen bg-black text-white pt-16 pb-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <header className="text-center pt-8 pb-12">
          <p className="text-xs uppercase tracking-[0.28em] text-cpoint-turquoise/80">
            Memberships & add-ons
          </p>
          <h1 className="mt-4 text-3xl sm:text-4xl font-semibold tracking-tight">
            Unlock more of C-Point.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-white/60 text-base leading-relaxed">
            Upgrade your own experience or your community. All plans are
            month-to-month — cancel any time from the billing portal.
          </p>
          {pricing?.stripe_mode === 'test' && (
            <p className="mt-4 text-[11px] uppercase tracking-[0.25em] text-amber-300/80">
              Test mode — no real charges will be made
            </p>
          )}
        </header>

        {status && (
          <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <PremiumCard
                payload={pricing.sku.premium}
                onSubscribe={onSubscribePremium}
                loading={checkoutLoading === 'premium'}
              />
              <ComingSoonCard payload={pricing.sku.steve_package} />
            </div>
            <CommunityTierCard
              payload={pricing.sku.community_tier}
              onPick={onPickCommunity}
              preselectedCommunityId={preselectedCommunityId}
              pendingKey={checkoutLoading}
            />
            <ComingSoonCard payload={pricing.sku.networking} />
          </div>
        )}

        <p className="mt-12 text-center text-xs text-white/40">
          Questions? <a href="mailto:hello@c-point.co" className="text-cpoint-turquoise hover:underline">hello@c-point.co</a>
        </p>
      </div>

      {communityPickerOpen && pendingTier && (
        <CommunityPickerModal
          tier={pendingTier}
          preselectedCommunityId={preselectedCommunityId}
          onCancel={() => {
            setCommunityPickerOpen(false)
            setPendingTier(null)
          }}
          onChoose={onCommunityChosen}
          onCreate={() => {
            setCommunityPickerOpen(false)
            navigate('/communities?create=1')
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PricingSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-2xl border border-white/10 bg-white/5 p-8 animate-pulse"
          style={{ minHeight: 260 }}
        />
      ))}
    </div>
  )
}

function PremiumCard({
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
          <h2 className="mt-2 text-xl font-semibold">{payload.name}</h2>
        </div>
        <i className="fa-solid fa-crown text-cpoint-turquoise text-2xl" aria-hidden="true" />
      </div>
      <p className="mt-3 text-sm text-white/60">{payload.tagline}</p>

      <div className="mt-6 flex items-baseline gap-2">
        <span className="text-4xl font-bold">{formatEur(payload.price_eur)}</span>
        <span className="text-white/50">/ month</span>
      </div>

      <ul className="mt-6 space-y-3 text-sm text-white/80 flex-1">
        {payload.features.map((f) => (
          <li key={f} className="flex items-start gap-3">
            <span className="mt-2 inline-block h-1.5 w-1.5 rounded-full bg-cpoint-turquoise shrink-0" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onSubscribe}
        disabled={disabled}
        className={
          'mt-8 inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold transition duration-150 ' +
          (disabled
            ? 'bg-white/10 text-white/40 cursor-not-allowed'
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

function CommunityTierCard({
  payload,
  onPick,
  preselectedCommunityId,
  pendingKey,
}: {
  payload: CommunityTierPayload
  onPick: (tier: CommunityTierLevel) => void
  preselectedCommunityId: string
  pendingKey: string | null
}) {
  return (
    <section
      id="community-tier"
      className="rounded-2xl border border-white/10 bg-white/5 p-8"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
            For your community
          </p>
          <h2 className="mt-2 text-xl font-semibold">{payload.name}</h2>
          <p className="mt-2 text-sm text-white/60 max-w-xl">{payload.tagline}</p>
        </div>
        <i className="fa-solid fa-people-group text-cpoint-turquoise text-2xl" aria-hidden="true" />
      </div>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {payload.tiers.map((tier) => {
          const loading =
            !!pendingKey && pendingKey.startsWith(`community_tier:${tier.tier_code}`)
          return (
            <div
              key={tier.tier_code}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-5 flex flex-col"
            >
              <div className="flex items-baseline justify-between">
                <span className="text-sm uppercase tracking-[0.2em] text-white/50">
                  Paid {tier.level_label}
                </span>
                <span className="text-xs text-white/40">
                  {tier.max_members ? `${tier.max_members} members` : 'TBD'}
                </span>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold">{formatEur(tier.price_eur)}</span>
                <span className="text-white/50 text-xs">/ mo</span>
              </div>
              <button
                type="button"
                onClick={() => onPick(tier)}
                disabled={!tier.purchasable || loading}
                className={
                  'mt-5 inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-semibold transition duration-150 ' +
                  (!tier.purchasable
                    ? 'bg-white/10 text-white/40 cursor-not-allowed'
                    : loading
                    ? 'bg-cpoint-turquoise/60 text-black cursor-wait'
                    : 'bg-cpoint-turquoise text-black hover:bg-cpoint-turquoise/90')
                }
              >
                {loading ? 'Starting…' : tier.purchasable ? payload.cta_label : 'Coming soon'}
              </button>
            </div>
          )
        })}
      </div>
      <p className="mt-5 text-xs text-white/40">
        {preselectedCommunityId
          ? 'Upgrading the community you were just viewing — pick a tier above.'
          : 'Pick a tier and we\'ll ask which of your communities to upgrade.'}
      </p>
    </section>
  )
}

function ComingSoonCard({ payload }: { payload: ComingSoonPayload }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-8 flex flex-col">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
            Add-on
          </p>
          <h2 className="mt-2 text-xl font-semibold">{payload.name}</h2>
        </div>
        <span className="inline-flex items-center rounded-full border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-cpoint-turquoise">
          Coming soon
        </span>
      </div>
      <p className="mt-3 text-sm text-white/60">{payload.tagline}</p>
      <div className="mt-6 flex items-baseline gap-2">
        <span className="text-3xl font-bold">{formatEur(payload.price_eur)}</span>
        <span className="text-white/50">/ month</span>
      </div>
      {payload.features && payload.features.length > 0 && (
        <ul className="mt-4 space-y-2 text-sm text-white/70 flex-1">
          {payload.features.map((f) => (
            <li key={f} className="flex items-start gap-3">
              <span className="mt-2 inline-block h-1.5 w-1.5 rounded-full bg-white/30 shrink-0" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}
      <a
        href="mailto:hello@c-point.co"
        className="mt-6 inline-flex items-center justify-start text-xs text-cpoint-turquoise/80 hover:text-cpoint-turquoise hover:underline"
      >
        Contact us for early access →
      </a>
    </section>
  )
}

function CommunityPickerModal({
  tier,
  preselectedCommunityId,
  onCancel,
  onChoose,
  onCreate,
}: {
  tier: CommunityTierLevel
  preselectedCommunityId: string
  onCancel: () => void
  onChoose: (communityId: number) => void
  onCreate: () => void
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
        const me = typeof data.username === 'string' ? data.username : null
        const owned = flat.filter((c) => {
          const withParent = c as Community & { parent_community_id?: number | null }
          if (withParent.parent_community_id) return false
          if (me && c.creator_username && c.creator_username === me) return true
          if (c.role && c.role.toLowerCase() === 'owner') return true
          return false
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
  }, [])

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
          Upgrade to Paid {tier.level_label}
        </p>
        <h2 className="mt-2 text-lg font-semibold">Pick a community</h2>
        <p className="mt-1 text-sm text-white/60">
          You can only upgrade communities you own. The new tier unlocks up to{' '}
          {tier.max_members ?? '?'} members at {formatEur(tier.price_eur)} / month.
        </p>

        {loadErr && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {loadErr}
          </div>
        )}

        <div className="mt-5 max-h-64 space-y-2 overflow-y-auto pr-1">
          {communities === null && !loadErr && (
            <div className="text-sm text-white/50">Loading your communities…</div>
          )}
          {communities !== null && communities.length === 0 && (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-white/60">
              You don't own any communities yet. Create one first.
            </div>
          )}
          {communities?.map((c) => (
            <label
              key={c.id}
              className={
                'flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition ' +
                (selectedId === c.id
                  ? 'border-cpoint-turquoise/60 bg-cpoint-turquoise/10'
                  : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]')
              }
            >
              <input
                type="radio"
                name="community"
                className="accent-[#00CEC8]"
                checked={selectedId === c.id}
                onChange={() => setSelectedId(c.id)}
              />
              <span className="flex-1">{c.name}</span>
            </label>
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            disabled={!selectedId}
            onClick={() => selectedId && onChoose(selectedId)}
            className={
              'inline-flex w-full items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition ' +
              (selectedId
                ? 'bg-cpoint-turquoise text-black hover:bg-cpoint-turquoise/90'
                : 'bg-white/10 text-white/40 cursor-not-allowed')
            }
          >
            Continue to checkout
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
      </div>
    </div>
  )
}
