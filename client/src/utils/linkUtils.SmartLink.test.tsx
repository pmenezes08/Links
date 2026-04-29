import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { SmartLink } from './linkUtils'

describe('SmartLink path-first navigation', () => {
  const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

  beforeEach(() => {
    openSpy.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('uses in-app navigation for root-relative paths (parity with @mention)', () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <div>
              <SmartLink href="/community_feed_react/42" displayText="Open feed" />
            </div>
          ),
        },
        {
          path: '/community_feed_react/42',
          element: <div>Destination</div>,
        },
      ],
      { initialEntries: ['/'] },
    )
    render(<RouterProvider router={router} />)
    fireEvent.click(screen.getByText('Open feed'))
    expect(router.state.location.pathname).toBe('/community_feed_react/42')
    expect(openSpy).not.toHaveBeenCalled()
  })
})
