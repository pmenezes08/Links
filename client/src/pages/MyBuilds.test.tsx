import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, fireEvent } from '@testing-library/react'
import MyBuilds from './MyBuilds'

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

describe('MyBuilds', () => {
  beforeEach(() => {
    navigate.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the user creations on success', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({
      success: true,
      creations: [
        { id: 7, title: 'Lisbon Quiz', kind: 'quiz', status: 'published', community_id: 3, published_post_id: 9, updated_at: null, plays: 12 },
      ],
    }))
    const { getByText } = render(<MyBuilds />)
    await waitFor(() => expect(getByText('Lisbon Quiz')).toBeTruthy())
    expect(getByText('Published')).toBeTruthy()
    // Play navigates to the community creation play route.
    fireEvent.click(getByText('Play'))
    expect(navigate).toHaveBeenCalledWith('/community/3/creation/7')
  })

  it('continues a draft in the community builder flow', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({
      success: true,
      creations: [
        { id: 5, title: 'WIP Game', kind: 'game', status: 'draft', community_id: 2, published_post_id: null, updated_at: null, plays: 0 },
      ],
    }))
    const { getByText } = render(<MyBuilds />)
    await waitFor(() => expect(getByText('WIP Game')).toBeTruthy())
    fireEvent.click(getByText('Continue building'))
    expect(navigate).toHaveBeenCalledWith('/community/2/builder?creation_id=5')
  })

  it('shows the empty-state CTA when there are no builds', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ success: true, creations: [] }))
    const { getByText } = render(<MyBuilds />)
    await waitFor(() => expect(getByText('Create your first build')).toBeTruthy())
    fireEvent.click(getByText('Choose a community'))
    expect(navigate).toHaveBeenCalledWith('/premium_dashboard')
  })

  it('shows an error state with retry when the request fails', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ success: false }, false))
    const { getByText } = render(<MyBuilds />)
    await waitFor(() => expect(getByText("We couldn't load your builds.")).toBeTruthy())
    expect(getByText('Try again')).toBeTruthy()
  })
})
