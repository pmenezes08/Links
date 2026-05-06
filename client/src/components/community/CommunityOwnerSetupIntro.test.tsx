import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import CommunityOwnerSetupIntro, { communityOwnerSetupStorageKey } from './CommunityOwnerSetupIntro'

describe('CommunityOwnerSetupIntro', () => {
  const base = {
    communityId: '42',
    communityName: 'Test Comm',
    username: 'alice',
    memberCap: 25 as number | null,
    tierLabel: 'Free' as string | null,
    onFinished: vi.fn(),
    onOpenManageCommunity: vi.fn(),
  }

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('advances steps and completes wizard with Manage hint', () => {
    render(<CommunityOwnerSetupIntro {...base} />)
    expect(screen.getByText(/Set up your community/i)).toBeInTheDocument()
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    }
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(screen.getByText(/finish setting up the community/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /stay on feed/i }))
    expect(base.onFinished).toHaveBeenCalledWith('completed')
    expect(localStorage.getItem(communityOwnerSetupStorageKey('alice', '42'))).toBe('completed')
  })

  it('skip then stay dismisses with dismissed status', () => {
    render(<CommunityOwnerSetupIntro {...base} />)
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    fireEvent.click(screen.getByRole('button', { name: /stay on feed/i }))
    expect(base.onFinished).toHaveBeenCalledWith('dismissed')
    expect(localStorage.getItem(communityOwnerSetupStorageKey('alice', '42'))).toBe('dismissed')
  })
})
