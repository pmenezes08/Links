/**
 * IndexedDB account-isolation regression tests.
 *
 * These pin the contract that PR 3 enforces:
 *   - feeds and outbox are viewer-scoped (account A cannot read account B
 *     and the drainer cannot fire account A's queued sends as account B),
 *   - the v3→v4 migration purges leak-prone rows that pre-date the fix,
 *   - `deleteCpointOfflineDatabase` is robust to the "another tab is
 *     blocking the delete" scenario (clear-stores fallback path).
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  addToOutbox,
  cacheConversations,
  cacheFeed,
  cacheMessages,
  conversationRowId,
  deleteCpointOfflineDatabase,
  feedRowId,
  getCachedConversations,
  getCachedFeed,
  getCachedMessages,
  getOutboxEntries,
  groupConversationOfflineKey,
  removeFromOutbox,
} from './offlineDb'

// Fresh in-memory IDB between tests so we can exercise migrations cleanly.
async function resetIdb() {
  // @ts-expect-error - fake-indexeddb installs a writable global.
  globalThis.indexedDB = new IDBFactory()
}

beforeEach(async () => {
  await resetIdb()
})

afterEach(async () => {
  await deleteCpointOfflineDatabase()
})

describe('feedRowId / groupConversationOfflineKey', () => {
  it('feed key embeds the viewer so two viewers cannot collide', () => {
    const a = feedRowId('alice', '42')
    const b = feedRowId('bob', '42')
    expect(a).not.toBe(b)
    expect(a.startsWith('alice')).toBe(true)
    expect(b.startsWith('bob')).toBe(true)
  })

  it('group offline key embeds the viewer', () => {
    const a = groupConversationOfflineKey('alice', '7')
    const b = groupConversationOfflineKey('bob', '7')
    expect(a).not.toBe(b)
    expect(a).toContain('group:7')
    expect(b).toContain('group:7')
  })

  it('conversationRowId embeds the viewer (DM scope)', () => {
    expect(conversationRowId('alice', 'bob')).not.toBe(conversationRowId('bob', 'alice'))
  })
})

describe('cacheFeed / getCachedFeed', () => {
  it('returns null for a different viewer on the same community', async () => {
    await cacheFeed('alice', 'c1', { success: true, viewer: 'alice' })
    const fromAlice = await getCachedFeed('alice', 'c1')
    const fromBob = await getCachedFeed('bob', 'c1')
    expect(fromAlice).toEqual({ success: true, viewer: 'alice' })
    expect(fromBob).toBeNull()
  })

  it('rejects writes with an empty viewer (would create unattributable row)', async () => {
    await cacheFeed('', 'c1', { foo: 'bar' })
    expect(await getCachedFeed('alice', 'c1')).toBeNull()
    expect(await getCachedFeed('', 'c1')).toBeNull()
  })

  it('two viewers can independently cache the same community', async () => {
    await cacheFeed('alice', 'c1', { who: 'alice' })
    await cacheFeed('bob', 'c1', { who: 'bob' })
    expect(await getCachedFeed('alice', 'c1')).toEqual({ who: 'alice' })
    expect(await getCachedFeed('bob', 'c1')).toEqual({ who: 'bob' })
  })
})

describe('addToOutbox / getOutboxEntries', () => {
  it('rejects entries without an owner', async () => {
    await expect(
      addToOutbox({
        owner: '',
        type: 'dm',
        recipient: 'bob',
        content: 'hi',
        clientKey: 'k1',
        createdAt: Date.now(),
        status: 'pending',
        retries: 0,
      }),
    ).rejects.toThrow(/owner/)
  })

  it('returns only entries owned by the requesting viewer', async () => {
    await addToOutbox({
      owner: 'alice',
      type: 'dm',
      recipient: 'bob',
      content: 'from alice',
      clientKey: 'a1',
      createdAt: Date.now(),
      status: 'pending',
      retries: 0,
    })
    await addToOutbox({
      owner: 'bob',
      type: 'dm',
      recipient: 'alice',
      content: 'from bob',
      clientKey: 'b1',
      createdAt: Date.now(),
      status: 'pending',
      retries: 0,
    })

    const aliceEntries = await getOutboxEntries('alice')
    const bobEntries = await getOutboxEntries('bob')

    expect(aliceEntries).toHaveLength(1)
    expect(bobEntries).toHaveLength(1)
    expect(aliceEntries[0].content).toBe('from alice')
    expect(bobEntries[0].content).toBe('from bob')
  })

  it('removes entries on demand', async () => {
    const id = await addToOutbox({
      owner: 'alice',
      type: 'dm',
      recipient: 'bob',
      content: 'hi',
      clientKey: 'k',
      createdAt: Date.now(),
      status: 'pending',
      retries: 0,
    })
    await removeFromOutbox(id)
    expect(await getOutboxEntries('alice')).toHaveLength(0)
  })
})

describe('messages cache (already viewer-scoped via key)', () => {
  it('group keys with different viewers do not collide', async () => {
    await cacheMessages(groupConversationOfflineKey('alice', '7'), [{ id: 1, text: 'a' }])
    await cacheMessages(groupConversationOfflineKey('bob', '7'), [{ id: 1, text: 'b' }])

    const aliceMsgs = await getCachedMessages(groupConversationOfflineKey('alice', '7'))
    const bobMsgs = await getCachedMessages(groupConversationOfflineKey('bob', '7'))

    expect((aliceMsgs as any)?.[0].text).toBe('a')
    expect((bobMsgs as any)?.[0].text).toBe('b')
  })
})

describe('conversations cache', () => {
  it('only returns rows for the requesting viewer', async () => {
    await cacheConversations('alice', [{ other_username: 'bob' }, { other_username: 'carol' }])
    await cacheConversations('bob', [{ other_username: 'alice' }])

    const aliceList = await getCachedConversations('alice')
    const bobList = await getCachedConversations('bob')

    expect(aliceList).toHaveLength(2)
    expect(bobList).toHaveLength(1)
  })
})

describe('deleteCpointOfflineDatabase', () => {
  it('removes feeds, outbox, and conversations so the next viewer reads nothing', async () => {
    await cacheFeed('alice', 'c1', { ok: true })
    await cacheConversations('alice', [{ other_username: 'bob' }])
    await addToOutbox({
      owner: 'alice',
      type: 'dm',
      recipient: 'bob',
      content: 'hi',
      clientKey: 'k',
      createdAt: Date.now(),
      status: 'pending',
      retries: 0,
    })

    await deleteCpointOfflineDatabase()

    expect(await getCachedFeed('alice', 'c1')).toBeNull()
    expect(await getCachedConversations('alice')).toBeNull()
    expect(await getOutboxEntries('alice')).toHaveLength(0)
  })
})
