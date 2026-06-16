import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import LoadErrorRetry from './LoadErrorRetry'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

describe('LoadErrorRetry', () => {
  it('renders the provided message and fires onRetry on click', () => {
    const onRetry = vi.fn()
    const { getByText, getByRole } = render(<LoadErrorRetry message="Boom" onRetry={onRetry} />)
    expect(getByText('Boom')).toBeTruthy()
    fireEvent.click(getByRole('button'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('falls back to the generic network message when none is given', () => {
    const { getByText } = render(<LoadErrorRetry onRetry={() => {}} />)
    expect(getByText('errors.network')).toBeTruthy()
  })
})
