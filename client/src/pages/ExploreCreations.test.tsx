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

  it('seeds the builder from "Build your own" with public data only', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({
      success: true,
      creations: [creation(7, 'game', { title: 'Neon Breakout' })],
    }))

    const { getByText, getAllByText } = render(<ExploreCreations />)
    await waitFor(() => expect(getByText('Neon Breakout')).toBeTruthy())

    fireEvent.click(getAllByText('Build your own')[0])
    expect(navigate).toHaveBeenCalledTimes(1)
    const target = String(navigate.mock.calls[0][0])
    expect(target.startsWith('/builder?seed=')).toBe(true)
    expect(decodeURIComponent(target)).toContain('Neon Breakout')
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
