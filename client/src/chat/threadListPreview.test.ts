import { beforeEach, describe, expect, it } from 'vitest'
import { bumpDmThreadPreview, normalizeIsoLikeTime } from './threadListPreview'
import { readDeviceCache, writeDeviceCache } from '../utils/deviceCache'
import {
  threadsListCacheKey,
  THREADS_LIST_CACHE_TTL_MS,
  THREADS_LIST_CACHE_VERSION,
} from '../utils/chatThreadsCache'
import type { DmThreadRowLike } from '../utils/chatThreadListMerge'

const VIEWER = 'viewer_user'

function seedThreads(rows: DmThreadRowLike[]) {
  writeDeviceCache(
    threadsListCacheKey(VIEWER),
    rows,
    THREADS_LIST_CACHE_TTL_MS,
    THREADS_LIST_CACHE_VERSION,
  )
}

function readThreads(): DmThreadRowLike[] | null {
  return readDeviceCache<DmThreadRowLike[]>(threadsListCacheKey(VIEWER), THREADS_LIST_CACHE_VERSION)
}

function row(peer: string, overrides: Partial<DmThreadRowLike> = {}): DmThreadRowLike {
  return {
    other_username: peer,
    display_name: peer,
    profile_picture_url: null,
    last_message_text: 'old preview',
    last_activity_time: '2026-07-10T10:00:00',
    last_sender: peer,
    unread_count: 3,
    ...overrides,
  }
}

describe('bumpDmThreadPreview', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('updates preview text, sender, recency and floats the row to the top', () => {
    seedThreads([row('alice'), row('bob')])
    bumpDmThreadPreview(VIEWER, 'bob', {
      text: 'fresh reply',
      time: '2026-07-11 09:30:00',
      sentByViewer: false,
    })
    const rows = readThreads()!
    expect(rows[0].other_username).toBe('bob')
    expect(rows[0].last_message_text).toBe('fresh reply')
    expect(rows[0].last_activity_time).toBe('2026-07-11T09:30:00')
    expect(rows[0].last_sender).toBe('bob')
    expect(rows[0].unread_count).toBe(0)
    expect(rows[1].other_username).toBe('alice')
  })

  it('marks viewer as sender for own sends', () => {
    seedThreads([row('alice')])
    bumpDmThreadPreview(VIEWER, 'alice', { text: 'hi!', time: null, sentByViewer: true })
    expect(readThreads()![0].last_sender).toBe(VIEWER)
  })

  it("attributes Steve's in-thread reply to steve, not the human peer", () => {
    // The inbox row prefixes "Steve:" off last_sender. Attributing Steve's
    // reply to the peer would make the row read as if the peer wrote it.
    seedThreads([row('alice')])
    bumpDmThreadPreview(VIEWER, 'alice', {
      text: 'here is what I found',
      time: '2026-07-28T09:30:00',
      sentByViewer: false,
      steveAuthored: true,
    })
    expect(readThreads()![0].last_sender).toBe('steve')
  })

  it('media rows (no text) only zero the unread badge, preserving preview and order', () => {
    seedThreads([row('alice'), row('bob')])
    bumpDmThreadPreview(VIEWER, 'bob', { text: '', time: null, sentByViewer: false })
    const rows = readThreads()!
    expect(rows[0].other_username).toBe('alice')
    expect(rows[1].other_username).toBe('bob')
    expect(rows[1].last_message_text).toBe('old preview')
    expect(rows[1].unread_count).toBe(0)
  })

  it('never regresses a fresher list preview backward (stale thread-cache seed)', () => {
    seedThreads([row('alice', { last_message_text: 'newest', last_activity_time: '2026-07-11T12:00:00' })])
    bumpDmThreadPreview(VIEWER, 'alice', {
      text: 'old cached message',
      time: '2026-07-10T08:00:00',
      sentByViewer: false,
    })
    const rows = readThreads()!
    expect(rows[0].last_message_text).toBe('newest')
    expect(rows[0].last_activity_time).toBe('2026-07-11T12:00:00')
    expect(rows[0].unread_count).toBe(0) // unread still zeroes — the thread is open
  })

  it('is a no-op when the list cache is cold or the peer is unknown', () => {
    bumpDmThreadPreview(VIEWER, 'ghost', { text: 'x', time: null, sentByViewer: false })
    expect(readThreads()).toBeNull()

    seedThreads([row('alice')])
    bumpDmThreadPreview(VIEWER, 'ghost', { text: 'x', time: null, sentByViewer: false })
    expect(readThreads()![0].last_message_text).toBe('old preview')
  })
})

describe('normalizeIsoLikeTime', () => {
  it('converts space-separated timestamps to ISO-like', () => {
    expect(normalizeIsoLikeTime('2026-07-11 09:30:00')).toBe('2026-07-11T09:30:00')
    expect(normalizeIsoLikeTime('2026-07-11T09:30:00')).toBe('2026-07-11T09:30:00')
  })

  it('falls back to a current local timestamp when missing', () => {
    expect(normalizeIsoLikeTime(null)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
  })
})
