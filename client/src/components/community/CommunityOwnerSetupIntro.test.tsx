import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'

import CommunityOwnerSetupIntro, {
  communityOwnerSetupDraftKey,
  communityOwnerSetupResumeKey,
  communityOwnerSetupStorageKey,
} from './CommunityOwnerSetupIntro'

const snapshot = {
  name: 'Test Comm',
  description: '',
  networkType: 'professional',
  parentCommunityId: null as number | null,
  notifyOnNewMember: true,
  maxMembers: '',
  backgroundPath: null as string | null,
}

describe('CommunityOwnerSetupIntro', () => {
  const base = {
    communityId: '42',
    username: 'alice',
    ownerDisplayName: 'Alice',
    showSubCommunityFirstStep: false,
    memberCap: 25 as number | null,
    tierLabel: 'Free' as string | null,
    billingInherited: false,
    initialSnapshot: { ...snapshot },
    deviceFeedCacheKey: 'community-feed:42',
    onFinished: vi.fn(),
    onOpenManageCommunity: vi.fn(),
    onCommunityUpdated: vi.fn(),
  }

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ success: true, personalities: [] }),
      }),
    )
  })

  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  function renderIntro(props: Partial<typeof base> = {}) {
    return render(
      <MemoryRouter>
        <CommunityOwnerSetupIntro {...base} {...props} />
      </MemoryRouter>,
    )
  }

  it('shows welcome with Option B for everyone (no structure on step 0)', () => {
    renderIntro({ ownerDisplayName: 'Pat' })
    expect(screen.getByText(/Hey Pat, Steve here/i)).toBeInTheDocument()
    expect(screen.getByText(/Let's set up your community/i)).toBeInTheDocument()
    expect(screen.getByText(/We'll start with structure/i)).toBeInTheDocument()
    expect(screen.queryByText(/Let's define your community structure/i)).not.toBeInTheDocument()
  })

  it('shows structure as second step when showSubCommunityFirstStep', () => {
    renderIntro({ showSubCommunityFirstStep: true })
    expect(screen.getByText(/Hey Alice, Steve here/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/Let's define your community structure/i)).toBeInTheDocument()
    expect(screen.getByText(/Everyone who joins the community is part of the main network/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /see where to manage structure/i })).toBeInTheDocument()
  })

  it('resumes at subscription via step id', () => {
    sessionStorage.setItem(
      communityOwnerSetupResumeKey('alice', '42'),
      JSON.stringify({ step: 'subscription' }),
    )
    renderIntro()
    expect(screen.getByRole('heading', { name: /subscription/i })).toBeInTheDocument()
  })

  it('shows invite step last with Members page copy', () => {
    renderIntro()
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    }
    expect(screen.getByRole('heading', { name: /your community is ready/i })).toBeInTheDocument()
    expect(
      screen.getByText(/I'll take you to the Members page/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /invite people/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /not yet/i })).toBeInTheDocument()
  })

  it('advances steps and completes wizard with Manage hint', () => {
    renderIntro()
    expect(screen.getByText(/Hey Alice, Steve here/i)).toBeInTheDocument()
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    }
    fireEvent.click(screen.getByRole('button', { name: /not yet/i }))
    expect(screen.getByText(/finish setting up the community/i)).toBeInTheDocument()
    expect(screen.getByText(/More/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /stay on feed/i }))
    expect(base.onFinished).toHaveBeenCalledWith('completed')
    expect(localStorage.getItem(communityOwnerSetupStorageKey('alice', '42'))).toBe('completed')
    expect(sessionStorage.getItem(communityOwnerSetupResumeKey('alice', '42'))).toBeNull()
  })

  it('skip then stay dismisses with dismissed status', () => {
    renderIntro()
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    fireEvent.click(screen.getByRole('button', { name: /stay on feed/i }))
    expect(base.onFinished).toHaveBeenCalledWith('dismissed')
    expect(localStorage.getItem(communityOwnerSetupStorageKey('alice', '42'))).toBe('dismissed')
    expect(sessionStorage.getItem(communityOwnerSetupResumeKey('alice', '42'))).toBeNull()
  })

  describe('never loses what the owner filled in', () => {
    type FetchCall = { url: string; init?: RequestInit }

    function stubFetch(opts: { updateOk?: boolean } = {}) {
      const calls: FetchCall[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
          const href = String(url)
          calls.push({ url: href, init })
          if (href.includes('/update_community')) {
            return {
              json: async () => ({
                success: opts.updateOk !== false,
                error: 'server said no',
              }),
            }
          }
          return { json: async () => ({ success: true, personalities: [] }) }
        }),
      )
      return calls
    }

    function updateCalls(calls: FetchCall[]) {
      return calls.filter(c => c.url.includes('/update_community'))
    }

    function savedField(calls: FetchCall[], field: string) {
      const last = updateCalls(calls).at(-1)
      return (last?.init?.body as FormData | undefined)?.get(field)
    }

    /** Advance to the description step and type into it. */
    function typeDescription(text: string) {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
      fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
    }

    beforeEach(() => {
      vi.stubGlobal('alert', vi.fn())
    })

    it('saves the current step when moving to the next one', async () => {
      const calls = stubFetch()
      renderIntro()
      typeDescription('A place for runners')
      fireEvent.click(screen.getByRole('button', { name: /next|saving/i }))

      await waitFor(() => expect(updateCalls(calls)).toHaveLength(1))
      expect(savedField(calls, 'description')).toBe('A place for runners')
      await screen.findByRole('heading', { name: /subscription/i })
    })

    it('saves before skipping out of the wizard', async () => {
      const calls = stubFetch()
      renderIntro()
      typeDescription('Saved on skip')
      fireEvent.click(screen.getByRole('button', { name: /skip/i }))

      await waitFor(() => expect(updateCalls(calls)).toHaveLength(1))
      expect(savedField(calls, 'description')).toBe('Saved on skip')
    })

    it('saves before leaving for Manage Community', async () => {
      const calls = stubFetch()
      renderIntro()
      typeDescription('Saved on manage')
      fireEvent.click(screen.getByRole('button', { name: /skip/i }))
      await waitFor(() => expect(updateCalls(calls)).toHaveLength(1))

      fireEvent.click(screen.getByRole('button', { name: /open manage community/i }))
      await waitFor(() => expect(base.onOpenManageCommunity).toHaveBeenCalled())
      expect(savedField(calls, 'description')).toBe('Saved on manage')
    })

    it('keeps the owner on the step when the save fails', async () => {
      const calls = stubFetch({ updateOk: false })
      renderIntro()
      typeDescription('Will not persist')
      fireEvent.click(screen.getByRole('button', { name: /next|saving/i }))

      await waitFor(() => expect(updateCalls(calls)).toHaveLength(1))
      expect(screen.getByRole('textbox')).toHaveValue('Will not persist')
      expect(screen.queryByRole('heading', { name: /subscription/i })).not.toBeInTheDocument()
    })

    it('restores an unsaved draft after the app reloads', () => {
      stubFetch()
      const first = renderIntro()
      typeDescription('Half-finished thought')
      expect(sessionStorage.getItem(communityOwnerSetupDraftKey('alice', '42'))).toContain(
        'Half-finished thought',
      )

      first.unmount()
      renderIntro()
      expect(screen.getByRole('textbox')).toHaveValue('Half-finished thought')
    })

    it('does not touch the server when nothing changed', async () => {
      const calls = stubFetch()
      renderIntro()
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
      await waitFor(() => expect(screen.getByRole('heading', { name: /subscription/i })).toBeInTheDocument())
      expect(updateCalls(calls)).toHaveLength(0)
    })
  })
})
