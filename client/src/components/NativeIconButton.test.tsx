import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { NativeIconButton } from './NativeIconButton'

vi.mock('../utils/haptics', () => ({
  triggerHaptic: vi.fn(() => Promise.resolve()),
}))

describe('NativeIconButton', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders and fires click', () => {
    const onClick = vi.fn()
    render(
      <NativeIconButton aria-label="Add" onClick={onClick}>
        <span>+</span>
      </NativeIconButton>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire click when disabled', () => {
    const onClick = vi.fn()
    render(
      <NativeIconButton aria-label="Add" disabled onClick={onClick}>
        <span>+</span>
      </NativeIconButton>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('triggers haptic on web without throwing', async () => {
    const { triggerHaptic } = await import('../utils/haptics')
    const onClick = vi.fn()
    render(
      <NativeIconButton aria-label="Mic" haptic="light" onClick={onClick}>
        <span>M</span>
      </NativeIconButton>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Mic' }))
    expect(triggerHaptic).toHaveBeenCalledWith('light')
  })
})
