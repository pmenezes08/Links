import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import OwnerCtaCard from './OwnerCtaCard'
import Notifications from '../../pages/Notifications'

const OWNER_CTA_LINK = '/subscription_plans?open=community_addons&community_id=7'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

const ownerCtaNotif = {
  id: 42,
  type: 'owner_cta:steve_trial_ending',
  message: 'Your Steve trial for Runners Lisbon ends in 3 days.',
  is_read: false,
  created_at: '2026-07-09 10:00:00',
  link: OWNER_CTA_LINK,
}

vi.mock('../../utils/apiFetch', () => ({
  apiFetch: vi.fn(async (url: string) => {
    const json = (data: unknown) => ({ status: 200, json: async () => data }) as Response
    if (url.startsWith('/api/notifications')) {
      return json({ success: true, notifications: [ownerCtaNotif] })
    }
    if (url.includes('/invites/pending')) return json({ success: true, invites: [] })
    if (url.includes('/join_requests/pending')) return json({ success: true, requests: [] })
    return json({ success: true })
  }),
}))

function makeNotif(overrides: Partial<typeof ownerCtaNotif> = {}) {
  return { ...ownerCtaNotif, ...overrides }
}

describe('OwnerCtaCard', () => {
  it.each([
    ['steve_trial_ending', 'Your Steve trial is ending', 'Keep Steve'],
    ['steve_trial_expired', 'Your Steve trial ended', 'Bring Steve back'],
    ['steve_member_blocked', 'Your members want Steve', 'Add Steve'],
    ['steve_pool_exhausted', 'Steve pool used up', 'Get a bigger pool'],
  ])('renders title, server message, and CTA for owner_cta:%s', (subtype, title, cta) => {
    const message = `Server localized body for ${subtype}`
    render(
      <OwnerCtaCard
        notif={makeNotif({ type: `owner_cta:${subtype}`, message })}
        timeAgo="2h"
        onCta={() => {}}
      />,
    )
    expect(screen.getByText(title)).toBeInTheDocument()
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: cta })).toBeInTheDocument()
  })

  it('falls back to the generic title and CTA for unknown owner_cta subtypes', () => {
    render(
      <OwnerCtaCard
        notif={makeNotif({ type: 'owner_cta:steve_future_thing' })}
        timeAgo="2h"
        onCta={() => {}}
      />,
    )
    expect(screen.getByText('For your community')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument()
  })

  it('fires onCta when the CTA button is pressed', () => {
    const onCta = vi.fn()
    render(<OwnerCtaCard notif={makeNotif()} timeAgo="2h" onCta={onCta} />)
    fireEvent.click(screen.getByRole('button', { name: 'Keep Steve' }))
    expect(onCta).toHaveBeenCalledTimes(1)
  })
})

describe('Notifications page owner_cta integration', () => {
  it('renders the CTA card and navigates internally to the subscription link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }) as Response),
    )

    render(
      <MemoryRouter initialEntries={['/notifications']}>
        <Notifications />
      </MemoryRouter>,
    )

    // Card renders with the client-side title and the server message body.
    expect(await screen.findByText('Your Steve trial is ending')).toBeInTheDocument()
    expect(screen.getByText(ownerCtaNotif.message)).toBeInTheDocument()

    // CTA navigates via SPA navigation (react-router), not a full reload.
    fireEvent.click(screen.getByRole('button', { name: 'Keep Steve' }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1))
    expect(mockNavigate.mock.calls[0][0]).toBe(OWNER_CTA_LINK)
  })
})
