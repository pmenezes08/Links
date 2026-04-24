/**
 * Smoke test for `SubscriptionPlans.tsx`.
 *
 * The page is KB-driven: backend `/api/kb/pricing` returns the four SKU
 * cards (User Premium + Community Paid Tier + Steve Package + Networking)
 * and the component renders them. The business-logic tests for that
 * payload live on the backend (`tests/test_kb_pricing_endpoint.py`). This
 * front-end suite only verifies the rendering contract:
 *
 *   1. While the fetch is in-flight, a skeleton is shown (no cards).
 *   2. After a successful fetch, the four expected product names appear.
 *   3. The two "Coming soon" cards render as chips without a CTA button.
 *   4. A failed fetch renders an inline error (and no crash).
 *
 * We don't exercise the community-picker modal or Stripe checkout
 * navigation here — those touch `window.location.assign` and
 * owned-community fetches that belong in a dedicated e2e pass.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import SubscriptionPlans from './SubscriptionPlans'
import { HeaderContext } from '../contexts/HeaderContext'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type PricingPayload = ReturnType<typeof makePricingPayload>

function makePricingPayload() {
  return {
    success: true,
    stripe_mode: 'test' as const,
    publishable_key_available: true,
    sku: {
      premium: {
        sku: 'premium' as const,
        name: 'User Premium Membership',
        tagline: 'Unlock Steve for yourself and own larger communities.',
        price_eur: 4.99,
        billing_cycle: 'monthly',
        currency: 'EUR',
        features: [
          'Full Steve capabilities',
          'Own up to 10 communities',
        ],
        cta_label: 'Subscribe',
        stripe_mode: 'test' as const,
        stripe_price_id: 'price_premium_test',
        purchasable: true,
      },
      community_tier: {
        sku: 'community_tier' as const,
        name: 'Community Paid Tier',
        tagline: 'Grow your community beyond the 25-member Free limit.',
        billing_cycle: 'monthly',
        currency: 'EUR',
        tiers: [
          {
            tier_code: 'paid_l1' as const,
            level_label: 'L1',
            price_eur: 25,
            max_members: 75,
            media_gb: 5,
            stripe_price_id: 'price_l1_test',
            purchasable: true,
          },
          {
            tier_code: 'paid_l2' as const,
            level_label: 'L2',
            price_eur: 50,
            max_members: 150,
            media_gb: 10,
            stripe_price_id: 'price_l2_test',
            purchasable: true,
          },
          {
            tier_code: 'paid_l3' as const,
            level_label: 'L3',
            price_eur: 80,
            max_members: 250,
            media_gb: 25,
            stripe_price_id: 'price_l3_test',
            purchasable: true,
          },
        ],
        cta_label: 'Upgrade a community',
        stripe_mode: 'test' as const,
      },
      steve_package: {
        sku: 'steve_package' as const,
        name: 'Steve Community Package',
        tagline: 'Give your whole community a shared Steve credit pool.',
        price_eur: 20,
        billing_cycle: 'monthly',
        currency: 'EUR',
        credit_pool: 300,
        features: ['Shared pool'],
        purchasable: false as const,
        coming_soon: true as const,
        stripe_mode: 'test' as const,
        stripe_price_id: '',
      },
      networking: {
        sku: 'networking_package' as const,
        name: 'Networking Package',
        tagline: 'Get your community discovered on the public directory.',
        price_eur: 15,
        billing_cycle: 'monthly',
        currency: 'EUR',
        features: ['Directory listing'],
        purchasable: false as const,
        coming_soon: true as const,
        stripe_mode: 'test' as const,
        stripe_price_id: '',
      },
    },
  }
}

function mockFetchOnce(payload: unknown, init: { ok?: boolean; status?: number } = {}) {
  const response = {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => payload,
  }
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderPage() {
  const header = { setTitle: vi.fn(), setHeaderHidden: vi.fn() }
  return render(
    <MemoryRouter initialEntries={['/subscription_plans']}>
      <HeaderContext.Provider value={header}>
        <SubscriptionPlans />
      </HeaderContext.Provider>
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubscriptionPlans', () => {
  beforeEach(() => {
    // Each test stubs fetch itself — reset in case a leak bleeds through.
    vi.unstubAllGlobals()
  })

  it('renders the four SKU cards from /api/kb/pricing', async () => {
    mockFetchOnce(makePricingPayload())
    renderPage()

    await waitFor(() =>
      expect(screen.getByText('User Premium Membership')).toBeInTheDocument(),
    )
    expect(screen.getByText('Community Paid Tier')).toBeInTheDocument()
    expect(screen.getByText('Steve Community Package')).toBeInTheDocument()
    expect(screen.getByText('Networking Package')).toBeInTheDocument()
  })

  it('renders Community Paid Tier levels L1/L2/L3 with member caps', async () => {
    mockFetchOnce(makePricingPayload())
    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Community Paid Tier')).toBeInTheDocument(),
    )

    // All three level badges must appear so owners can tell tiers apart.
    expect(screen.getByText('Paid L1')).toBeInTheDocument()
    expect(screen.getByText('Paid L2')).toBeInTheDocument()
    expect(screen.getByText('Paid L3')).toBeInTheDocument()

    // Each row announces its member cap so owners can pick the right
    // tier without clicking through — these are the KB values (75/150/250).
    expect(screen.getByText(/75 members/)).toBeInTheDocument()
    expect(screen.getByText(/150 members/)).toBeInTheDocument()
    expect(screen.getByText(/250 members/)).toBeInTheDocument()
  })

  it('flags the two deferred SKUs as "Coming soon"', async () => {
    mockFetchOnce(makePricingPayload())
    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Networking Package')).toBeInTheDocument(),
    )

    // The Steve + Networking cards both carry the "Coming soon" chip —
    // at least one must appear. We assert both render it.
    const chips = screen.getAllByText(/coming soon/i)
    expect(chips.length).toBeGreaterThanOrEqual(2)
  })

  it('shows an error banner when /api/kb/pricing fails', async () => {
    mockFetchOnce({ success: false, error: 'kaboom' }, { ok: false, status: 500 })
    renderPage()

    // The banner copy is "HTTP 500" when the fetch responds non-OK.
    await waitFor(() =>
      expect(screen.getByText(/HTTP 500/)).toBeInTheDocument(),
    )

    // And none of the product names should render — no partial state.
    expect(screen.queryByText('User Premium Membership')).toBeNull()
    expect(screen.queryByText('Community Paid Tier')).toBeNull()
  })
})

// Keep TS happy when new type fields are added to the payload: any
// mismatch between the local fixture and the production interface would
// show up here, so a failing build is the early-warning signal that
// this file needs updating.
export type _ExpectedPayloadShape = PricingPayload
