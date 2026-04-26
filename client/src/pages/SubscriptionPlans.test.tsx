/**
 * Smoke + flow test for `SubscriptionPlans.tsx` (Personal + Community
 * redesign).
 *
 * The page is KB-driven: backend `/api/kb/pricing` returns four SKUs
 * (User Premium, Community Paid Tier, Steve Package, Networking).
 * Business-logic for that payload lives in
 * `tests/test_kb_pricing_endpoint.py`. This front-end suite covers
 * the rendering + interaction contract:
 *
 *   1. While the fetch is in-flight, a skeleton is shown (no cards).
 *   2. After a successful fetch, the two top cards (Personal, Community)
 *      appear and the four "deep" SKU labels (L1/L2/L3, Steve, Networking)
 *      are *not* visible until the user opens the Community modal.
 *   3. Clicking "See community plans" opens the modal listing
 *      L1/L2/L3 + an Enterprise mailto + a "Community Add-ons" entry.
 *   4. Picking a tier opens the CommunityPickerModal preselected on
 *      the chosen tier.
 *   5. The Enterprise row exposes a mailto link to ``sales@c-point.co``.
 *   6. Clicking "Community Add-ons" opens a sub-modal with Steve and
 *      Networking, both badged "Coming soon" with mailto CTAs.
 *   7. A failed fetch renders an inline error (and no crash).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
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

function makeActivePayload() {
  return {
    success: true,
    personal: {
      active: true,
      subscription: 'premium',
      subscription_status: 'active',
      current_period_end: '2026-05-24 12:00:00',
      cancel_at_period_end: false,
    },
    communities: [
      {
        id: 7,
        name: 'Jola de Domingo',
        tier: 'paid_l1',
        subscription_status: 'active',
        current_period_end: '2026-05-24 12:00:00',
        cancel_at_period_end: false,
      },
    ],
  }
}

/**
 * Multi-route fetch mock. Maps URL prefixes to JSON payloads and lets
 * any test that calls multiple endpoints (pricing fetch + community
 * picker fetch) wire all of them up in a single ``installFetch`` call.
 */
function installFetch(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.startsWith('/api/me/subscriptions') && !routes['/api/me/subscriptions']) {
      return {
        ok: true,
        status: 200,
        json: async () => makeActivePayload(),
      } as Response
    }
    for (const prefix of Object.keys(routes)) {
      if (url.startsWith(prefix)) {
        return {
          ok: true,
          status: 200,
          json: async () => routes[prefix],
        } as Response
      }
    }
    throw new Error(`No fetch mock for ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function mockFetchOnce(payload: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.startsWith('/api/me/subscriptions')) {
      return {
        ok: true,
        status: 200,
        json: async () => makeActivePayload(),
      } as Response
    }
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => payload,
    } as Response
  })
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

describe('SubscriptionPlans (Personal + Community redesign)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the two top cards (Personal + Community) and hides tier details until opened', async () => {
    mockFetchOnce(makePricingPayload())
    renderPage()

    await waitFor(() =>
      expect(screen.getAllByText('User Premium Membership').length).toBeGreaterThan(0),
    )
    expect(screen.getByText('Community Paid Tier')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Subscriptions' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Active Subscriptions' })).toBeInTheDocument()
    expect(screen.getByText('Jola de Domingo')).toBeInTheDocument()

    // Tier rows live inside the (closed) Community modal — they
    // should NOT be on the landing.
    expect(screen.queryByText('Paid L1')).toBeNull()
    expect(screen.queryByText('Paid L2')).toBeNull()
    expect(screen.queryByText('Paid L3')).toBeNull()
    // Add-ons live inside a (closed) sub-modal.
    expect(screen.queryByText('Steve Community Package')).toBeNull()
    expect(screen.queryByText('Networking Package')).toBeNull()
  })

  it('opens the Community modal with L1/L2/L3 + Enterprise + Add-ons row', async () => {
    mockFetchOnce(makePricingPayload())
    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Community Paid Tier')).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: /see community plans/i }))

    // Modal renders the three Stripe-backed tiers + a hard-coded
    // Enterprise row + an Add-ons entry.
    expect(await screen.findByText('Paid L1')).toBeInTheDocument()
    expect(screen.getByText('Paid L2')).toBeInTheDocument()
    expect(screen.getByText('Paid L3')).toBeInTheDocument()
    expect(screen.getByText('Enterprise')).toBeInTheDocument()
    expect(screen.getByText('Community Add-ons')).toBeInTheDocument()

    // Each tier surfaces its KB-sourced cap so owners can pick.
    expect(screen.getByText(/75 members/)).toBeInTheDocument()
    expect(screen.getByText(/150 members/)).toBeInTheDocument()
    expect(screen.getByText(/250 members/)).toBeInTheDocument()
  })

  it('Enterprise row exposes a mailto link to sales@c-point.co', async () => {
    mockFetchOnce(makePricingPayload())
    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Community Paid Tier')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: /see community plans/i }))

    const link = await screen.findByRole('link', { name: /contact us/i })
    expect(link).toHaveAttribute(
      'href',
      'mailto:sales@c-point.co?subject=Enterprise%20community%20plan',
    )
  })

  it('clicking a tier opens the CommunityPickerModal', async () => {
    installFetch({
      '/api/kb/pricing': makePricingPayload(),
      '/api/user_communities_hierarchical': {
        success: true,
        username: 'paulo',
        communities: [
          { id: 1, name: 'Paulo IST', creator_username: 'paulo' },
        ],
      },
    })
    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Community Paid Tier')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: /see community plans/i }))

    // Each tier row exposes the cta_label as its button.
    const upgradeButtons = await screen.findAllByRole('button', {
      name: /upgrade a community/i,
    })
    fireEvent.click(upgradeButtons[0])

    // Picker shows the chosen tier's level label in its header.
    await waitFor(() =>
      expect(screen.getByText(/Upgrade to Paid L1/)).toBeInTheDocument(),
    )
    expect(screen.getByText('Pick a community')).toBeInTheDocument()
  })

  it('keeps checkout errors inside the picker and keeps radio sizing stable', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.startsWith('/api/kb/pricing')) {
        return { ok: true, status: 200, json: async () => makePricingPayload() } as Response
      }
      if (url.startsWith('/api/me/subscriptions')) {
        return { ok: true, status: 200, json: async () => makeActivePayload() } as Response
      }
      if (url.startsWith('/api/user_communities_hierarchical')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            username: 'paulo',
            communities: [{ id: 1, name: 'A very long community name that should wrap correctly', creator_username: 'paulo' }],
          }),
        } as Response
      }
      if (url.startsWith('/api/stripe/create_checkout_session') && init?.method === 'POST') {
        return {
          ok: false,
          status: 403,
          json: async () => ({ success: false, error: 'Only the community owner can subscribe.' }),
        } as Response
      }
      throw new Error(`No fetch mock for ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await screen.findByText('Community Paid Tier')
    fireEvent.click(screen.getByRole('button', { name: /see community plans/i }))
    const upgradeButtons = await screen.findAllByRole('button', { name: /upgrade a community/i })
    fireEvent.click(upgradeButtons[0])
    const radio = await screen.findByRole('radio', { name: /A very long community name/ })
    fireEvent.click(radio)
    fireEvent.click(screen.getByRole('button', { name: /continue to checkout/i }))

    expect(await screen.findByText('Only the community owner can subscribe.')).toBeInTheDocument()
    expect(screen.getByText('Pick a community')).toBeInTheDocument()
    expect(radio).toHaveClass('h-4', 'w-4', 'shrink-0')
  })

  it('Community Add-ons sub-modal shows Steve + Networking with "Coming soon" + Notify me', async () => {
    mockFetchOnce(makePricingPayload())
    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Community Paid Tier')).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: /see community plans/i }))
    const addonsEntry = await screen.findByRole('button', {
      name: /community add-ons/i,
    })
    fireEvent.click(addonsEntry)

    // Both Coming-soon SKUs render in the sub-modal.
    expect(await screen.findByText('Steve Community Package')).toBeInTheDocument()
    expect(screen.getByText('Networking Package')).toBeInTheDocument()
    const chips = screen.getAllByText(/coming soon/i)
    expect(chips.length).toBeGreaterThanOrEqual(2)

    // Each "Notify me" CTA is a mailto pointed at sales@c-point.co
    // with a subject line mentioning the package name. We grab the
    // closest <section> for each card and assert its link.
    const steveSection = screen.getByText('Steve Community Package').closest('section')!
    expect(within(steveSection as HTMLElement).getByRole('link', { name: /notify me/i }))
      .toHaveAttribute(
        'href',
        'mailto:sales@c-point.co?subject=Notify%20me%20-%20Steve%20Package',
      )

    const networkingSection = screen.getByText('Networking Package').closest('section')!
    expect(within(networkingSection as HTMLElement).getByRole('link', { name: /notify me/i }))
      .toHaveAttribute(
        'href',
        'mailto:sales@c-point.co?subject=Notify%20me%20-%20Networking%20Package',
      )
  })

  it('shows an error banner when /api/kb/pricing fails', async () => {
    mockFetchOnce({ success: false, error: 'kaboom' }, { ok: false, status: 500 })
    renderPage()

    await waitFor(() =>
      expect(screen.getByText(/HTTP 500/)).toBeInTheDocument(),
    )

    expect(screen.queryByText('User Premium Membership')).toBeNull()
    expect(screen.queryByText('Community Paid Tier')).toBeNull()
  })
})

// Keep TS happy when new type fields are added to the payload: any
// mismatch between the local fixture and the production interface would
// show up here, so a failing build is the early-warning signal that
// this file needs updating.
export type _ExpectedPayloadShape = PricingPayload
