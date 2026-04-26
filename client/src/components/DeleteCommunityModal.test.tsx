import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import DeleteCommunityModal from './DeleteCommunityModal'

describe('DeleteCommunityModal', () => {
  it('requires typing DELETE before the initial delete action is enabled', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ success: true })

    render(
      <DeleteCommunityModal
        open
        communityName="Sunday Club"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    )

    const button = screen.getByRole('button', { name: 'Delete community' })
    expect(button).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('Type DELETE'), { target: { value: 'delete' } })
    expect(button).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('Type DELETE'), { target: { value: 'DELETE' } })
    expect(button).toBeEnabled()
    fireEvent.click(button)

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(false))
  })

  it('shows the active-subscription confirmation and resubmits with confirmation', async () => {
    const onSubmit = vi
      .fn()
      .mockResolvedValueOnce({
        success: false,
        activeSubscription: true,
        subscriptions: [{ tier: 'paid_l2', subscription_status: 'active', benefits_end_at: '2030-01-01 00:00:00' }],
      })
      .mockResolvedValueOnce({ success: true })

    render(
      <DeleteCommunityModal
        open
        communityName="Sunday Club"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Type DELETE'), { target: { value: 'DELETE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete community' }))

    await screen.findByText('Active subscription detected')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and cancel subscription' }))

    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith(true))
  })
})
