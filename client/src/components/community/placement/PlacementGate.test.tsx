import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PlacementGateController, { PLACEMENT_OPEN_EVENT } from './PlacementGate'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length ? `${key}|${Object.values(opts).join(',')}` : key,
  }),
}))

vi.mock('../../../utils/dashboardCache', () => ({
  refreshDashboardCommunities: vi.fn(async () => null),
}))

vi.mock('../../../utils/serverPull', () => ({
  triggerDashboardServerPull: vi.fn(async () => undefined),
}))

const PENDING = {
  success: true,
  pending: [
    {
      community_id: 7,
      community_name: 'Meridian',
      inviter_username: 'ana',
      questions: [
        {
          id: 11,
          prompt: 'Which area do you work in?',
          allow_multi: false,
          options: [
            { id: 1, label: 'Engineering' },
            { id: 2, label: 'Corporate' },
          ],
        },
        {
          id: 12,
          prompt: 'Anything else?',
          allow_multi: true,
          options: [{ id: 3, label: 'Running club' }],
        },
      ],
    },
  ],
}

function mockFetch(respond: Record<string, unknown>) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url)
    if (path.includes('/api/me/placement/pending')) {
      return { ok: true, json: async () => PENDING } as Response
    }
    if (path.includes('/placement/respond')) {
      return { ok: true, json: async () => respond } as Response
    }
    throw new Error(`unexpected fetch ${path}`)
  })
}

describe('PlacementGateController', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.stubGlobal('fetch', mockFetch({ success: true, allocated: [{ id: 9, name: 'Engineering & MRO' }] }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders nothing without a username', () => {
    const { container } = render(<PlacementGateController username={null} />)
    expect(container).toBeEmptyDOMElement()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('walks welcome -> questions -> done and posts the answers', async () => {
    render(<PlacementGateController username="new_member" />)

    // Steve welcome names the community and the inviter.
    await screen.findByText('communities.placement.welcome_title|Meridian')
    expect(screen.getByText('communities.placement.welcome_body|Meridian,ana')).toBeTruthy()

    fireEvent.click(screen.getByText('communities.placement.continue'))

    // Mandatory answers: confirm stays disabled until the single-choice is picked.
    const confirm = screen.getByText('communities.placement.confirm') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByText('Engineering'))
    expect(confirm.disabled).toBe(false)

    fireEvent.click(confirm)

    // Allocation result reveals the sub-community names only now.
    await screen.findByText('Engineering & MRO')
    const respondCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([u]) =>
      String(u).includes('/placement/respond')
    )
    expect(respondCall).toBeTruthy()
    expect(String(respondCall![0])).toContain('/api/community/7/placement/respond')
    expect(JSON.parse((respondCall![1] as RequestInit).body as string)).toEqual({
      answers: { '11': [1], '12': [] },
    })

    // Closing the done step dismisses the gate.
    fireEvent.click(screen.getByText('communities.placement.done_cta'))
    await waitFor(() => {
      expect(screen.queryByText('communities.placement.done_title')).toBeNull()
    })
  })

  it('deferring requires Steve\'s waiting-sub-communities confirmation, then snoozes for the session', async () => {
    render(<PlacementGateController username="new_member" />)
    await screen.findByText('communities.placement.welcome_title|Meridian')

    // "Later" never dismisses directly — it routes through Steve's warning.
    fireEvent.click(screen.getByText('communities.placement.later_link'))
    expect(screen.getByText('communities.placement.later_title')).toBeTruthy()
    expect(screen.getByText('communities.placement.later_body|Meridian')).toBeTruthy()
    expect(screen.queryByText('communities.placement.welcome_title|Meridian')).toBeNull()

    // Backing out returns to the questions, nothing dismissed.
    fireEvent.click(screen.getByText('communities.placement.later_back_cta'))
    expect(screen.getByText('communities.placement.confirm')).toBeTruthy()

    // Confirming the deferral closes the modal and snoozes this session.
    fireEvent.click(screen.getByText('communities.placement.later_link'))
    fireEvent.click(screen.getByText('communities.placement.later_confirm_cta'))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(sessionStorage.getItem('cpoint:placement_snooze:7')).toBe('1')

    // The feed card's open event clears the snooze and brings the modal back.
    act(() => {
      window.dispatchEvent(new CustomEvent(PLACEMENT_OPEN_EVENT, { detail: { communityId: 7 } }))
    })
    await screen.findByText('communities.placement.welcome_title|Meridian')
    expect(sessionStorage.getItem('cpoint:placement_snooze:7')).toBeNull()
  })
})
