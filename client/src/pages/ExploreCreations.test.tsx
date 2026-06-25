import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'

import ExploreCreations from './ExploreCreations'

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
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

    fireEvent.click(getByText('Open creation'))
    expect(navigate).toHaveBeenCalledWith('/creation/12')
  })

  it('routes viewers to the personal builder CTA', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ success: true, creations: [] }))

    const { getByText } = render(<ExploreCreations />)
    await waitFor(() => expect(getByText('No public creations yet')).toBeTruthy())

    fireEvent.click(getByText('Create with Steve'))
    expect(navigate).toHaveBeenCalledWith('/builder')
  })
})
