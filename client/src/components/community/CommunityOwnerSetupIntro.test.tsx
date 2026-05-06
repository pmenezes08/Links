import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'

import CommunityOwnerSetupIntro, {
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

  it('advances steps and completes wizard with Manage hint', () => {
    renderIntro()
    expect(screen.getByText(/Hey Alice, Steve here/i)).toBeInTheDocument()
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    }
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
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
})
