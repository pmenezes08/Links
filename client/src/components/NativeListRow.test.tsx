import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { NativeListRow } from './NativeListRow'

vi.mock('../utils/haptics', () => ({
  triggerHaptic: vi.fn(() => Promise.resolve()),
}))

describe('NativeListRow', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders children and handles click', () => {
    const onClick = vi.fn()
    render(
      <NativeListRow onClick={onClick}>
        <span>Thread row</span>
      </NativeListRow>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('skips haptic when disabled', async () => {
    const { triggerHaptic } = await import('../utils/haptics')
    render(
      <NativeListRow disabled haptic="selection">
        <span>Disabled</span>
      </NativeListRow>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(triggerHaptic).not.toHaveBeenCalled()
  })
})
