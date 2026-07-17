import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Action taps fire a fire-and-forget attribution POST; stub the network.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }) as Response),
  )
})

import MetricCard from './MetricCard'
import OverviewTab from './OverviewTab'
import type { OwnerMetric, OwnerOverview } from './types'

function steveTrialMetric(overrides: Partial<OwnerMetric> = {}): OwnerMetric {
  return {
    id: 'steve_trial',
    group: 'overview',
    format: 'steve_value',
    tier: 'free',
    label_key: 'owner.metric.steve_value',
    owner_only: true,
    locked: false,
    value: {
      is_trial: true,
      trial_days_left: 9,
      trial_total_days: 14,
      pool_cap: 500,
      pool_used: 120,
      pool_remaining: 380,
      wau: 12,
    },
    ...overrides,
  }
}

function renderCard(metric: OwnerMetric, { isOwner = true, onUpgrade = vi.fn() } = {}) {
  render(
    <MemoryRouter>
      <MetricCard metric={metric} onUpgrade={onUpgrade} isOwner={isOwner} communityId={7} />
    </MemoryRouter>,
  )
  return { onUpgrade }
}

describe('MetricCard steve_value format', () => {
  it('renders the trial countdown, pool usage, and keep-Steve CTA for owners', () => {
    const { onUpgrade } = renderCard(steveTrialMetric())

    expect(screen.getByText('Steve in your community')).toBeInTheDocument()
    expect(screen.getByText('Trial — 9 of 14 days left')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('of 500 Steve moments used this month')).toBeInTheDocument()

    const cta = screen.getByRole('button', { name: /Keep Steve for your members/ })
    fireEvent.click(cta)
    expect(onUpgrade).toHaveBeenCalledTimes(1)
  })

  it('hides the upgrade CTA for non-owners (billing is the owner move)', () => {
    renderCard(steveTrialMetric(), { isOwner: false })
    expect(screen.queryByRole('button', { name: /Keep Steve/ })).not.toBeInTheDocument()
  })

  it('renders as a plain value card once the package is paid (no trial line, no CTA)', () => {
    renderCard(
      steveTrialMetric({
        value: {
          is_trial: false,
          trial_days_left: null,
          trial_total_days: null,
          pool_cap: 500,
          pool_used: 340,
          pool_remaining: 160,
          wau: 30,
        },
      }),
    )
    expect(screen.queryByText(/days left/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Keep Steve/ })).not.toBeInTheDocument()
    expect(screen.getByText('340')).toBeInTheDocument()
  })
})

function overview(actions: OwnerOverview['steve']['actions']): OwnerOverview {
  return {
    success: true,
    community: { id: 7, name: 'Runners Lisbon', tier: 'free', is_paid: false },
    scope: 'self',
    network: { available: false, locked: false, teaser_members: null },
    metrics: [
      {
        id: 'members',
        group: 'overview',
        format: 'stat',
        tier: 'free',
        label_key: 'owner.metric.members',
        locked: false,
        value: { count: 12, delta_7d: 2, cap: null, cap_warning: false },
      },
    ],
    steve: {
      greeting_key: 'owner.steve.greeting',
      read_key: 'owner.steve.read_default',
      read_params: { delta: 2, wau: 5, mau: 9, communicating: 3, complete: 4, total: 12 },
      actions,
      low_data: false,
    },
    generated_at: '2026-07-10T00:00:00Z',
  }
}

describe('OverviewTab upgrade_steve action wiring', () => {
  it('makes the trial-ending action tappable for owners and routes it to onUpgrade', () => {
    const onUpgrade = vi.fn()
    render(
      <MemoryRouter>
        <OverviewTab
          data={overview([
            {
              key: 'owner.steve.action_trial_ending',
              params: { days: 2, used: 120 },
              action: 'upgrade_steve',
            },
          ])}
          onUpgrade={onUpgrade}
          isOwner
          communityId={7}
        />
      </MemoryRouter>,
    )
    const row = screen.getByRole('button', { name: /Your Steve trial ends in 2 days/ })
    fireEvent.click(row)
    expect(onUpgrade).toHaveBeenCalledTimes(1)
  })

  it('renders the action as plain text for delegated admins', () => {
    render(
      <MemoryRouter>
        <OverviewTab
          data={overview([
            {
              key: 'owner.steve.action_trial_ending',
              params: { days: 2, used: 120 },
              action: 'upgrade_steve',
            },
          ])}
          onUpgrade={vi.fn()}
          isOwner={false}
          communityId={7}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText(/Your Steve trial ends in 2 days/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Your Steve trial ends in 2 days/ }),
    ).not.toBeInTheDocument()
  })
})
