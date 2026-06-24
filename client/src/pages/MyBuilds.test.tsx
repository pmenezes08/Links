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

  it('deletes a build after confirmation and removes it from the list', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          creations: [
            { id: 7, title: 'Lisbon Quiz', kind: 'quiz', status: 'published', community_id: 3, published_post_id: 9, updated_at: null, plays: 12 },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response)
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('alert', vi.fn())

    const { getByText, getByLabelText, queryByText } = render(<MyBuilds />)
    await waitFor(() => expect(getByText('Lisbon Quiz')).toBeTruthy())
    fireEvent.click(getByLabelText('Delete Lisbon Quiz'))

    await waitFor(() => expect(queryByText('Lisbon Quiz')).toBeNull())
    expect(fetchMock).toHaveBeenLastCalledWith('/api/builder/7', expect.objectContaining({ method: 'DELETE' }))
  })

  it('does not call delete when confirmation is cancelled', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        creations: [
          { id: 5, title: 'WIP Game', kind: 'game', status: 'draft', community_id: 2, published_post_id: null, updated_at: null, plays: 0 },
        ],
      }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => false))

    const { getByText, getByLabelText } = render(<MyBuilds />)
    await waitFor(() => expect(getByText('WIP Game')).toBeTruthy())
    fireEvent.click(getByLabelText('Delete WIP Game'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('copies an existing public build link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('fetch', mockFetchOnce({
      success: true,
      creations: [
        {
          id: 8,
          title: 'Public RSVP',
          kind: 'app',
          status: 'published',
          community_id: 3,
          published_post_id: 9,
          updated_at: null,
          plays: 4,
          public_status: 'published',
          public_url: 'https://builds.c-point.co/public-rsvp-8',
        },
      ],
    }))

    const { getByText } = render(<MyBuilds />)
    await waitFor(() => expect(getByText('Public RSVP')).toBeTruthy())
    expect(getByText('Public web')).toBeTruthy()
    fireEvent.click(getByText('Copy public link'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://builds.c-point.co/public-rsvp-8'))
  })

  it('blocks games from public web publishing in the UI', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({
      success: true,
      creations: [
        { id: 5, title: 'Chess', kind: 'game', status: 'draft', community_id: 2, published_post_id: null, updated_at: null, plays: 0 },
      ],
    }))

    const { getByText, queryByText } = render(<MyBuilds />)
    await waitFor(() => expect(getByText('Chess')).toBeTruthy())
    expect(getByText('Games stay inside C-Point')).toBeTruthy()
    expect(queryByText('Publish web')).toBeNull()
  })
})
