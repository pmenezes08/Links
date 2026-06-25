import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'

import ExploreCreations from './ExploreCreations'

const navigate = vi.fn()
const locationState: { current: unknown } = { current: null }
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ state: locationState.current }),
}))
vi.mock('../contexts/HeaderContext', () => ({
  useHeader: () => ({ setTitle: vi.fn(), setHeaderHidden: vi.fn(), setTitleAccessory: vi.fn() }),
}))

function mockFetchOnce(value: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => value,
  } as Response)
}

describe('ExploreCreations', () => {
  beforeEach(() => {
    navigate.mockReset()
    locationState.current = null
    window.sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders anonymous approved creations and no creator/community identity', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({
      success: true,
      creations: [
        {
          id: 12,
          title: 'Lisbon City Guide',
          kind: 'game',
          play_url: '/creation/12',
          label: 'Made with Steve',
        },
      ],
    }))

    const { container, getAllByText, getByText, queryByText } = render(<ExploreCreations />)

    await waitFor(() => expect(getByText('Lisbon City Guide')).toBeTruthy())
    expect(getAllByText('Made with Steve').length).toBeGreaterThan(0)
    expect(queryByText('maker')).toBeNull()
    expect(queryByText('Community')).toBeNull()
    expect(container.innerHTML).not.toContain('created_by')
    expect(container.innerHTML).not.toContain('community_id')
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/builder\/explore\?limit=60&_=/), expect.objectContaining({
      cache: 'no-store',
    }))

    fireEvent.click(getByText('Open creation'))
    expect(navigate).toHaveBeenCalledWith('/creation/12')
  })

  it('shows a just-listed creation immediately while the network refresh catches up', async () => {
    window.sessionStorage.setItem('cpoint:explore:optimistic_creations', JSON.stringify([
      {
        id: 44,
        title: 'Instant Arcade',
        kind: 'game',
        play_url: '/creation/44',
        label: 'Made with Steve',
      },
    ]))
    vi.stubGlobal('fetch', mockFetchOnce({ success: true, creations: [] }))

    const { getByText } = render(<ExploreCreations />)

    expect(getByText('Instant Arcade')).toBeTruthy()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
  })

  it('routes viewers to the personal builder CTA', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ success: true, creations: [] }))

    const { getByText } = render(<ExploreCreations />)
    await waitFor(() => expect(getByText('No public creations yet')).toBeTruthy())

    fireEvent.click(getByText('Create with Steve'))
    expect(navigate).toHaveBeenCalledWith('/builder')
  })
})
