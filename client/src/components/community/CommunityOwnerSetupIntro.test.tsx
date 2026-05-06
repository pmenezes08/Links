import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'

import CommunityOwnerSetupIntro, { communityOwnerSetupStorageKey } from './CommunityOwnerSetupIntro'

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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ success: true, personalities: [] }),
      }),
    )
  })

  afterEach(() => {
    localStorage.clear()
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

  it('advances steps and completes wizard with Manage hint', () => {
    renderIntro()
    expect(screen.getByText(/Set up your community/i)).toBeInTheDocument()
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    }
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(screen.getByText(/finish setting up the community/i)).toBeInTheDocument()
    expect(screen.getByText(/More/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /stay on feed/i }))
    expect(base.onFinished).toHaveBeenCalledWith('completed')
    expect(localStorage.getItem(communityOwnerSetupStorageKey('alice', '42'))).toBe('completed')
  })

  it('skip then stay dismisses with dismissed status', () => {
    renderIntro()
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    fireEvent.click(screen.getByRole('button', { name: /stay on feed/i }))
    expect(base.onFinished).toHaveBeenCalledWith('dismissed')
    expect(localStorage.getItem(communityOwnerSetupStorageKey('alice', '42'))).toBe('dismissed')
  })
})
