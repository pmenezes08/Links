import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'

import ExploreCreations from './ExploreCreations'

const navigate = vi.fn()
const locationState: { current: unknown } = { current: null }
const searchParams: { current: URLSearchParams } = { current: new URLSearchParams() }
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ state: locationState.current }),
  useSearchParams: () => [searchParams.current, vi.fn()],
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

function creation(id: number, kind: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Creation ${id}`,
    kind,
    play_url: `/creation/${id}`,
    label: 'Made with Steve',
    plays: 0,
    ...extra,
  }
}

describe('ExploreCreations', () => {
  beforeEach(() => {
    navigate.mockReset()
    locationState.current = null
    searchParams.current = new URLSearchParams()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders anonymous approved creations without a cache-buster and opens on card tap', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({
      success: true,
      creations: [creation(12, 'game', { title: 'Lisbon City Guide' })],
    }))

    const { container, getByText, queryByText, getByRole } = render(<ExploreCreations />)

    await waitFor(() => expect(getByText('Lisbon City Guide')).toBeTruthy())
    expect(queryByText('maker')).toBeNull()
    expect(container.innerHTML).not.toContain('created_by')
    expect(container.innerHTML).not.toContain('community_id')
    // Cache-buster and no-store are gone: the endpoint is short-cacheable.
    expect(fetch).toHaveBeenCalledWith('/api/builder/explore?limit=60', expect.objectContaining({
      credentials: 'include',
    }))

    fireEvent.click(getByRole('button', { name: /Lisbon City Guide/ }))
    expect(navigate).toHaveBeenCalledWith('/creation/12')
  })

  it('shows play counts only at or above the social-proof floor', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({
      success: true,
      creations: [
        creation(1, 'game', { title: 'Popular Game', plays: 128 }),
        creation(2, 'game', { title: 'Quiet Game', plays: 3 }),
      ],
    }))

    const { getByText, queryByText } = render(<ExploreCreations />)
    await waitFor(() => expect(getByText('Popular Game')).toBeTruthy())
    expect(getByText('128 opens')).toBeTruthy()
    expect(queryByText('3 opens')).toBeNull()
  })

  it('collapses to one mixed grid on thin supply and sections when every shelf has depth', async () => {
    // Thin: 3 items total → mixed shelf, no per-kind section headers.
    vi.stubGlobal('fetch', mockFetchOnce({
      success: true,
      creations: [creation(1, 'game'), creation(2, 'app'), creation(3, 'website')],
    }))
    const thin = render(<ExploreCreations />)
    await waitFor(() => expect(thin.getByText('Creation 1')).toBeTruthy())
    expect(thin.getByText('Fresh from the community')).toBeTruthy()
    expect(thin.queryByRole('heading', { name: 'Games' })).toBeNull()
    thin.unmount()

    // Rich: 4 per kind, 12 total → sectioned shelves in Games→Apps→Websites order.
    const rich = [
      ...[1, 2, 3, 4].map(i => creation(i, 'game')),
      ...[5, 6, 7, 8].map(i => creation(i, 'app')),
      ...[9, 10, 11, 12].map(i => creation(i, 'website')),
    ]
    vi.stubGlobal('fetch', mockFetchOnce({ success: true, creations: rich }))
    const sectioned = render(<ExploreCreations />)
    await waitFor(() => expect(sectioned.getByRole('heading', { name: 'Games' })).toBeTruthy())
    expect(sectioned.getByRole('heading', { name: 'Apps' })).toBeTruthy()
    expect(sectioned.getByRole('heading', { name: 'Websites' })).toBeTruthy()
    expect(sectioned.queryByText('Fresh from the community')).toBeNull()
  })

  it('hands "Build your own" to the builder with the remix source and an editable seed', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({
      success: true,
      creations: [creation(7, 'game', { title: 'Neon Breakout' })],
    }))

    const { getByText, getAllByText } = render(<ExploreCreations />)
    await waitFor(() => expect(getByText('Neon Breakout')).toBeTruthy())

    fireEvent.click(getAllByText('Build your own')[0])
    expect(navigate).toHaveBeenCalledTimes(1)
    const target = String(navigate.mock.calls[0][0])
    expect(target.startsWith('/builder?remix=7&seed=')).toBe(true)
    expect(decodeURIComponent(target)).toContain('Neon Breakout')
  })

  it('shows the Steve-voiced hook on cards when present', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({
      success: true,
      creations: [creation(5, 'game', { title: 'Hooked Game', hook: 'A neon breakout you will rage-replay' })],
    }))

    const { getByText } = render(<ExploreCreations />)
    await waitFor(() => expect(getByText('Hooked Game')).toBeTruthy())
    expect(getByText('A neon breakout you will rage-replay')).toBeTruthy()
  })

  it('renders supply-gated sub-category chips that filter a shelf in place', async () => {
    // Games shelf: 6 items across 2 categories → chips render; Apps/Websites
    // get 4 uncategorised items each so the page is sectioned but their
    // shelves stay chip-free (supply gate).
    const rich = [
      ...[1, 2, 3].map(i => creation(i, 'game', { title: `Arcade ${i}`, category: 'arcade' })),
      ...[4, 5, 6].map(i => creation(i, 'game', { title: `Puzzle ${i}`, category: 'puzzle' })),
      ...[7, 8, 9, 10].map(i => creation(i, 'app')),
      ...[11, 12, 13, 14].map(i => creation(i, 'website')),
    ]
    vi.stubGlobal('fetch', mockFetchOnce({ success: true, creations: rich }))

    const { getByText, queryByText, getByRole, getAllByRole } = render(<ExploreCreations />)
    await waitFor(() => expect(getByText('Arcade 1')).toBeTruthy())

    // Chips exist for the Games shelf only (chips are buttons; the card's
    // category label is plain text).
    expect(getByRole('button', { name: 'Arcade' })).toBeTruthy()
    expect(getByRole('button', { name: 'Puzzle' })).toBeTruthy()

    fireEvent.click(getByRole('button', { name: 'Puzzle' }))
    expect(queryByText('Arcade 1')).toBeNull()
    expect(getByText('Puzzle 4')).toBeTruthy()

    // Toggle back to all.
    fireEvent.click(getAllByRole('button', { name: 'All creations' })[0])
    expect(getByText('Arcade 1')).toBeTruthy()
  })

  it('shows a just-listed creation immediately while the network refresh catches up', async () => {
    window.sessionStorage.setItem('cpoint:explore:optimistic_creations', JSON.stringify([
      creation(44, 'game', { title: 'Instant Arcade' }),
    ]))
    vi.stubGlobal('fetch', mockFetchOnce({ success: true, creations: [] }))

    const { getByText } = render(<ExploreCreations />)

    expect(getByText('Instant Arcade')).toBeTruthy()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
  })

  it('routes viewers to the builder from the empty state', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ success: true, creations: [] }))

    const { getByText } = render(<ExploreCreations />)
    await waitFor(() => expect(getByText('Nothing here yet.')).toBeTruthy())

    fireEvent.click(getByText('Start building'))
    expect(navigate).toHaveBeenCalledWith('/builder')
  })

  it('renders a Featured shelf first when admin picks exist', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({
      success: true,
      creations: [
        creation(1, 'game', { title: 'Star Pick', featured: true }),
        creation(2, 'app', { title: 'Regular App' }),
      ],
    }))

    const { getAllByText, getByRole } = render(<ExploreCreations />)
    // Featured is a highlight: the item shows in the Featured shelf AND in
    // the regular catalog below.
    await waitFor(() => expect(getAllByText('Star Pick').length).toBeGreaterThan(0))
    expect(getByRole('heading', { name: 'Featured' })).toBeTruthy()
  })

  it('shows the opt-in builder credit and filters by builder on tap', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({
      success: true,
      creations: [
        creation(1, 'game', { title: 'Credited Game', builder: 'NightOwl Builds' }),
        creation(2, 'game', { title: 'Anonymous Game' }),
      ],
    }))

    const { getByText, queryByText } = render(<ExploreCreations />)
    await waitFor(() => expect(getByText('Credited Game')).toBeTruthy())
    expect(getByText('by NightOwl Builds')).toBeTruthy()
    // The anonymous card carries no credit line.
    expect(queryByText(/^by (?!NightOwl)/)).toBeNull()

    fireEvent.click(getByText('by NightOwl Builds'))
    expect(navigate).toHaveBeenCalledWith('/explore-creations?builder=NightOwl%20Builds')
  })

  it('prefers a persisted cover image over the gradient', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({
      success: true,
      creations: [creation(9, 'website', { title: 'Covered Site', cover_url: '/api/builder/explore/9/cover' })],
    }))

    const { getByText, container } = render(<ExploreCreations />)
    await waitFor(() => expect(getByText('Covered Site')).toBeTruthy())
    const img = container.querySelector('img[src="/api/builder/explore/9/cover"]')
    expect(img).toBeTruthy()
  })

  it('filters to a sub-category via ?kind=&category= deep link', async () => {
    searchParams.current = new URLSearchParams('kind=app&category=travel')
    vi.stubGlobal('fetch', mockFetchOnce({
      success: true,
      creations: [
        creation(1, 'app', { title: 'Trip Planner', category: 'travel' }),
        creation(2, 'app', { title: 'Budget App', category: 'finance' }),
        creation(3, 'game', { title: 'Travel Quiz Game', category: 'trivia' }),
      ],
    }))

    const { getByText, queryByText } = render(<ExploreCreations />)
    await waitFor(() => expect(getByText('Trip Planner')).toBeTruthy())
    expect(queryByText('Budget App')).toBeNull()
    expect(queryByText('Travel Quiz Game')).toBeNull()
    // Header names the narrowing.
    expect(getByText(/Apps · Travel/)).toBeTruthy()
  })

  it('shows search only above the supply floor, filters, and nudges on 0-1 results', async () => {
    // 12 games → deep grid is searchable.
    const many = Array.from({ length: 12 }, (_, i) =>
      creation(i + 1, 'game', { title: i === 0 ? 'Chess Blitz' : `Arcade Game ${i}` }))
    searchParams.current = new URLSearchParams('kind=game')
    vi.stubGlobal('fetch', mockFetchOnce({ success: true, creations: many }))

    const { getByText, queryByText, getByLabelText } = render(<ExploreCreations />)
    await waitFor(() => expect(getByText('Chess Blitz')).toBeTruthy())

    const input = getByLabelText('Search these creations…')
    // One match → nudge INSTEAD of a lonely grid (founder decision).
    fireEvent.change(input, { target: { value: 'chess' } })
    expect(queryByText('Chess Blitz')).toBeNull()
    expect(getByText('No "chess" here yet.')).toBeTruthy()
    fireEvent.click(getByText('Build it with Steve'))
    const target = decodeURIComponent(String(navigate.mock.calls.at(-1)?.[0]))
    expect(target.startsWith('/builder?seed=')).toBe(true)
    expect(target).toContain('chess')

    // Multiple matches → grid + live count.
    fireEvent.change(input, { target: { value: 'arcade game' } })
    expect(getByText('11 results')).toBeTruthy()
    expect(getByText('Arcade Game 1')).toBeTruthy()
  })

  it('hides search below the supply floor', async () => {
    searchParams.current = new URLSearchParams('kind=game')
    vi.stubGlobal('fetch', mockFetchOnce({
      success: true,
      creations: [1, 2, 3].map(i => creation(i, 'game')),
    }))

    const { getByText, queryByLabelText } = render(<ExploreCreations />)
    await waitFor(() => expect(getByText('Creation 1')).toBeTruthy())
    expect(queryByLabelText('Search these creations…')).toBeNull()
  })

  it('filters to one section via ?kind= deep link', async () => {
    searchParams.current = new URLSearchParams('kind=game')
    vi.stubGlobal('fetch', mockFetchOnce({
      success: true,
      creations: [creation(1, 'game', { title: 'Only Game' }), creation(2, 'app', { title: 'Some App' })],
    }))

    const { getByText, queryByText } = render(<ExploreCreations />)
    await waitFor(() => expect(getByText('Only Game')).toBeTruthy())
    expect(queryByText('Some App')).toBeNull()

    fireEvent.click(getByText('All creations'))
    expect(navigate).toHaveBeenCalledWith('/explore-creations')
  })
})
