import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'

import SteveCreateCard from './SteveCreateCard'

describe('SteveCreateCard', () => {
  it('renders the creation CTAs and calls their handlers', () => {
    const onCreate = vi.fn()
    const onExplore = vi.fn()

    const { getByText } = render(<SteveCreateCard onCreate={onCreate} onExplore={onExplore} />)

    expect(getByText('Bring an idea to life')).toBeTruthy()
    expect(getByText('Describe what you want. Steve makes it real: apps, websites, games, and tools you can share with your communities.')).toBeTruthy()

    fireEvent.click(getByText('Create with Steve'))
    fireEvent.click(getByText('Explore Creations'))

    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onExplore).toHaveBeenCalledTimes(1)
  })
})
