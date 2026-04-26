import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import '@testing-library/jest-dom/vitest'

import FrozenCommunityModal from './FrozenCommunityModal'

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/community_feed_react/42']}>
      <Routes>
        <Route path="/community_feed_react/:id" element={ui} />
        <Route path="/subscription_plans" element={<RouteSpy testId="subscription-plans-route" />} />
      </Routes>
    </MemoryRouter>,
  )
}

function RouteSpy({ testId }: { testId: string }) {
  const location = useLocation()
  return (
    <div data-testid={testId} data-search={location.search}>
      Routed
    </div>
  )
}

describe('FrozenCommunityModal', () => {
  it('does not render when open is false', () => {
    renderWithRouter(
      <FrozenCommunityModal
        open={false}
        communityId={42}
        communityName="Sunday Club"
        memberCount={50}
        freeMemberCap={25}
        onManageMembers={vi.fn()}
      />,
    )
    expect(screen.queryByText('Subscription expired')).toBeNull()
  })

  it('renders the suspension copy with the member count and free cap', () => {
    renderWithRouter(
      <FrozenCommunityModal
        open
        communityId={42}
        communityName="Sunday Club"
        memberCount={50}
        freeMemberCap={25}
        frozenAt="2030-01-01 00:00:00"
        onManageMembers={vi.fn()}
      />,
    )
    expect(screen.getByText('"Sunday Club" is suspended')).toBeInTheDocument()
    expect(screen.getByText('50')).toBeInTheDocument()
    // Free tier limit appears in the dedicated breakdown row.
    const cap = screen.getAllByText('25')
    expect(cap.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Members over limit')).toBeInTheDocument()
  })

  it('navigates to the subscription plans page when the renew CTA is clicked', () => {
    renderWithRouter(
      <FrozenCommunityModal
        open
        communityId={42}
        communityName="Sunday Club"
        memberCount={50}
        freeMemberCap={25}
        onManageMembers={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Renew subscription' }))

    const route = screen.getByTestId('subscription-plans-route')
    expect(route).toBeInTheDocument()
    expect(route.getAttribute('data-search')).toBe('?community_id=42')
  })

  it('invokes onManageMembers when the remove-members CTA is clicked', () => {
    const onManageMembers = vi.fn()
    renderWithRouter(
      <FrozenCommunityModal
        open
        communityId={42}
        communityName="Sunday Club"
        memberCount={50}
        freeMemberCap={25}
        onManageMembers={onManageMembers}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove members' }))
    expect(onManageMembers).toHaveBeenCalledTimes(1)
  })

  it('exposes a dialog role with an aria-labelledby title', () => {
    renderWithRouter(
      <FrozenCommunityModal
        open
        communityId={42}
        communityName="Sunday Club"
        memberCount={50}
        freeMemberCap={25}
        onManageMembers={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).toBe('frozen-community-modal-title')
    expect(screen.getByText('"Sunday Club" is suspended').id).toBe(labelledBy)
  })
})
