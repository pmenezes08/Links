import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, fireEvent, within } from '@testing-library/react'
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
    expect(getByText('Continue building')).toBeTruthy()
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
        json: async () => ({ success: true, communities: [] }),
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
    fireEvent.click(getByLabelText('Open options for Lisbon Quiz'))
    await waitFor(() => expect(getByText('Delete build')).toBeTruthy())
    fireEvent.click(getByText('Delete build'))

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
    } as Response).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, communities: [] }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => false))

    const { getByText, getByLabelText } = render(<MyBuilds />)
    await waitFor(() => expect(getByText('WIP Game')).toBeTruthy())
    fireEvent.click(getByLabelText('Open options for WIP Game'))
    await waitFor(() => expect(getByText('Delete build')).toBeTruthy())
    fireEvent.click(getByText('Delete build'))

    expect(fetchMock).not.toHaveBeenCalledWith('/api/builder/5', expect.objectContaining({ method: 'DELETE' }))
  })

  it('copies an existing public build link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
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
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, communities: [] }),
      } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { getByText, getByLabelText } = render(<MyBuilds />)
    await waitFor(() => expect(getByText('Public RSVP')).toBeTruthy())
    expect(getByText('Public web')).toBeTruthy()
    fireEvent.click(getByLabelText('Open options for Public RSVP'))
    await waitFor(() => expect(getByText('Copy public link')).toBeTruthy())
    fireEvent.click(getByText('Copy public link'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://builds.c-point.co/public-rsvp-8'))
  })

  it('blocks games from public web publishing in the UI', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          creations: [
            { id: 5, title: 'Chess', kind: 'game', status: 'draft', community_id: 2, published_post_id: null, updated_at: null, plays: 0 },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, communities: [] }),
      } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { getByText, getByLabelText, queryByText } = render(<MyBuilds />)
    await waitFor(() => expect(getByText('Chess')).toBeTruthy())
    expect(queryByText('Games stay inside C-Point')).toBeNull()
    fireEvent.click(getByLabelText('Open options for Chess'))
    expect(getByText('Games stay inside C-Point.')).toBeTruthy()
    expect(queryByText('Publish web')).toBeNull()
  })

  it('keeps secondary actions inside the options sheet', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          creations: [
            { id: 9, title: 'Tiny Tool', kind: 'app', status: 'draft', community_id: null, published_post_id: null, updated_at: null, plays: 0 },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, communities: [] }),
      } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { getByText, queryByText, getByLabelText } = render(<MyBuilds />)
    await waitFor(() => expect(getByText('Tiny Tool')).toBeTruthy())

    expect(queryByText('List in Explore Creations')).toBeNull()
    expect(queryByText('Publish web')).toBeNull()
    expect(queryByText('Delete build')).toBeNull()
    fireEvent.click(getByLabelText('Open options for Tiny Tool'))
    await waitFor(() => expect(getByText('Build options')).toBeTruthy())
  })

  it('shares through the root-to-sub-community picker and marks shared targets', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          creations: [
            {
              id: 10,
              title: 'Member Quiz',
              kind: 'quiz',
              status: 'draft',
              community_id: null,
              published_post_id: null,
              updated_at: null,
              plays: 0,
              shared_community_ids: [21],
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          communities: [
            {
              id: 20,
              name: 'Root Club',
              children: [
                { id: 21, name: 'Already Shared', children: [] },
                { id: 22, name: 'New Subgroup', children: [] },
              ],
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, community_id: 22, post_id: 77 }),
      } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { getByText, getByLabelText } = render(<MyBuilds />)
    await waitFor(() => expect(getByText('Member Quiz')).toBeTruthy())
    fireEvent.click(getByLabelText('Open options for Member Quiz'))
    await waitFor(() => expect(getByText('Root Club')).toBeTruthy())
    fireEvent.click(getByText('Root Club'))

    const sharedRow = getByText('Already Shared').closest('div')
    expect(sharedRow).toBeTruthy()
    expect(within(sharedRow as HTMLElement).getByText('Shared')).toBeTruthy()

    const subgroupRow = getByText('New Subgroup').closest('div')
    expect(subgroupRow).toBeTruthy()
    fireEvent.click(within(subgroupRow as HTMLElement).getByText('Share'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/builder/10/share', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ community_id: 22 }),
    })))
    expect(getByText('Shared to New Subgroup.')).toBeTruthy()
  })
})
