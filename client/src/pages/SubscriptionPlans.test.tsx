/**
 * Smoke + flow test for `SubscriptionPlans.tsx` (settings-style hub redesign).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import SubscriptionPlans from './SubscriptionPlans'
import { HeaderContext } from '../contexts/HeaderContext'

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
        price_eur: 7.99,
        early_price_eur: 4.99,
        early_adoption_duration_months: 3,
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
        tagline: 'Give your whole community a shared Steve call pool.',
        price_eur: 49,
        billing_cycle: 'monthly',
        currency: 'EUR',
        credit_pool: 200,
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
        price_eur: null,
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
        tier_subscription_active: true,
      },
    ],
  }
}

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
    if (url.startsWith('/api/iap/config')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: false }),
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

function renderPage(initialEntry = '/subscription_plans') {
  const header = { setTitle: vi.fn(), setHeaderHidden: vi.fn(), setTitleAccessory: vi.fn() }
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <HeaderContext.Provider value={header}>
        <SubscriptionPlans />
      </HeaderContext.Provider>
    </MemoryRouter>,
  )
}

async function waitForHub() {
  expect(await screen.findByText('Get a plan')).toBeInTheDocument()
}

function openPersonalPlanPanel() {
  const rows = screen.getAllByRole('button', { name: /User Premium Membership/i })
  fireEvent.click(rows[rows.length - 1])
}

function openCommunityTiersPanel() {
  fireEvent.click(screen.getByRole('button', { name: /^Community Paid Tier/i }))
}

describe('SubscriptionPlans (settings-style hub)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    window.scrollTo = vi.fn()
    window.history.replaceState({}, '', '/subscription_plans')
  })

  it('renders the hub immediately with plan rows and hides tier details until opened', async () => {
    mockFetchOnce(makePricingPayload())
    renderPage()
    await waitForHub()

    expect(screen.getAllByText('User Premium Membership').length).toBeGreaterThan(0)
    expect(screen.getByText('Community Paid Tier')).toBeInTheDocument()
    expect(screen.getByText('Jola de Domingo')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /upgrade a community/i })).toBeNull()
  })

  it('shows standard Premium price with early-adoption subline in the personal panel', async () => {
    mockFetchOnce(makePricingPayload())
    renderPage()
    await waitForHub()

    openPersonalPlanPanel()

    await waitFor(() => expect(screen.getByText('€7.99')).toBeInTheDocument())
    expect(screen.getByText('€4.99 / month for your first 3 months')).toBeInTheDocument()
  })

  it('hides the personal Premium purchase tile for users without a personal subscription (B2B soft retire)', async () => {
    installFetch({
      '/api/kb/pricing': makePricingPayload(),
      '/api/me/subscriptions': {
        success: true,
        personal: { active: false, subscription: 'free' },
        communities: [],
      },
    })
    renderPage()
    await waitForHub()

    // The slide-over panel title stays mounted; what must disappear is the hub row.
    expect(screen.queryByRole('button', { name: /User Premium Membership/i })).toBeNull()
    expect(screen.getByText('Community Paid Tier')).toBeInTheDocument()
  })

  it('shows active subscriptions on the hub', async () => {
    mockFetchOnce(makePricingPayload())
    renderPage()
    await waitForHub()

    expect(screen.getByText('Jola de Domingo')).toBeInTheDocument()
    expect(screen.getAllByText(/Next renewal:/).length).toBeGreaterThan(0)
  })

  it('opens community plans directly from query parameters', async () => {
    mockFetchOnce(makePricingPayload())
    renderPage('/subscription_plans?mode=choose&open=community_plans&community_id=7')

    expect((await screen.findAllByText('Paid L1')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: /^back$/i })).toBeInTheDocument()
  })

  it('opens the community tiers panel with L1/L2/L3 + Enterprise + Add-ons row', async () => {
    mockFetchOnce(makePricingPayload())
    renderPage()
    await waitForHub()

    openCommunityTiersPanel()

    expect((await screen.findAllByText('Paid L1')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Paid L2')).toBeInTheDocument()
    expect(screen.getByText('Paid L3')).toBeInTheDocument()
    expect(screen.getByText('Enterprise')).toBeInTheDocument()
    expect(screen.getAllByText('Community Add-ons').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/75 members/)).toBeInTheDocument()
    expect(screen.getByText(/150 members/)).toBeInTheDocument()
    expect(screen.getByText(/250 members/)).toBeInTheDocument()
  })

  it('Enterprise row exposes a mailto link to sales@c-point.co', async () => {
    mockFetchOnce(makePricingPayload())
    renderPage()
    await waitForHub()

    openCommunityTiersPanel()

    const link = await screen.findByRole('link', { name: /contact us/i })
    expect(link).toHaveAttribute(
      'href',
      'mailto:sales@c-point.co?subject=Enterprise%20community%20plan',
    )
  })

  it('clicking a tier opens the community picker panel', async () => {
    installFetch({
      '/api/kb/pricing': makePricingPayload(),
      '/api/user_communities_hierarchical': {
        success: true,
        username: 'paulo',
        communities: [{ id: 1, name: 'Paulo IST', creator_username: 'paulo' }],
      },
    })
    renderPage()
    await waitForHub()

    openCommunityTiersPanel()
    const upgradeButtons = await screen.findAllByRole('button', {
      name: /upgrade a community/i,
    })
    fireEvent.click(upgradeButtons[0])

    await waitFor(() =>
      expect(screen.getByText(/Upgrade to Paid L1/)).toBeInTheDocument(),
    )
    expect(screen.getByText('Paulo IST')).toBeInTheDocument()
  })

  it('hides communities already on the selected tier from the picker', async () => {
    installFetch({
      '/api/kb/pricing': makePricingPayload(),
      '/api/me/subscriptions': {
        success: true,
        personal: { active: false, subscription: 'free' },
        communities: [{ id: 1, name: 'Already L1', tier: 'paid_l1', subscription_status: 'active' }],
      },
      '/api/user_communities_hierarchical': {
        success: true,
        username: 'paulo',
        communities: [{ id: 1, name: 'Already L1', creator_username: 'paulo' }],
      },
    })
    renderPage()
    await waitForHub()

    openCommunityTiersPanel()
    const upgradeButtons = await screen.findAllByRole('button', { name: /upgrade a community/i })
    fireEvent.click(upgradeButtons[0])

    expect(await screen.findByText(/No eligible owned communities for Paid L1/)).toBeInTheDocument()
  })

  it('keeps checkout errors inside the picker panel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
              communities: [
                {
                  id: 1,
                  name: 'A very long community name that should wrap correctly',
                  creator_username: 'paulo',
                },
              ],
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
      }),
    )
    renderPage()
    await waitForHub()

    openCommunityTiersPanel()
    const upgradeButtons = await screen.findAllByRole('button', { name: /upgrade a community/i })
    fireEvent.click(upgradeButtons[0])
    fireEvent.click(await screen.findByRole('button', { name: /A very long community name/ }))
    fireEvent.click(screen.getByRole('button', { name: /continue to checkout/i }))

    expect((await screen.findAllByText('Only the community owner can subscribe.')).length).toBeGreaterThan(0)
    expect(screen.getByText(/Upgrade to Paid L1/)).toBeInTheDocument()
  })

  it('add-ons panel shows Steve + Networking with Coming soon + Notify me', async () => {
    mockFetchOnce(makePricingPayload())
    renderPage()
    await waitForHub()

    fireEvent.click(screen.getByRole('button', { name: /Community Add-ons/i }))

    expect(await screen.findByText('Steve Community Package')).toBeInTheDocument()
    expect(screen.getByText('Networking Package')).toBeInTheDocument()
    const chips = screen.getAllByText(/coming soon/i)
    expect(chips.length).toBeGreaterThanOrEqual(2)

    const notifyLinks = await screen.findAllByRole('link', { name: /notify me/i })
    expect(notifyLinks.length).toBeGreaterThanOrEqual(2)
    expect(notifyLinks[0]).toHaveAttribute(
      'href',
      'mailto:sales@c-point.co?subject=Notify%20me%20-%20Steve%20Package',
    )
    expect(notifyLinks[1]).toHaveAttribute(
      'href',
      'mailto:sales@c-point.co?subject=Notify%20me%20-%20Networking%20Package',
    )
  })

  it('panel back closes nested picker and returns to tiers panel', async () => {
    installFetch({
      '/api/kb/pricing': makePricingPayload(),
      '/api/user_communities_hierarchical': {
        success: true,
        username: 'paulo',
        communities: [{ id: 1, name: 'Paulo IST', creator_username: 'paulo' }],
      },
    })
    renderPage()
    await waitForHub()

    openCommunityTiersPanel()
    const upgradeButtons = await screen.findAllByRole('button', { name: /upgrade a community/i })
    fireEvent.click(upgradeButtons[0])
    await screen.findByText('Paulo IST')

    fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(await screen.findAllByRole('button', { name: /upgrade a community/i })).toHaveLength(3)
  })

  it('shows an error banner when /api/kb/pricing fails', async () => {
    mockFetchOnce({ success: false, error: 'kaboom' }, { ok: false, status: 500 })
    renderPage()

    await waitFor(() => expect(screen.getByText(/HTTP 500/)).toBeInTheDocument())
    expect(screen.queryByText('User Premium Membership')).toBeNull()
  })
})

export type _ExpectedPayloadShape = PricingPayload
