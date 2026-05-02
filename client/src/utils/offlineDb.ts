import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'cpoint-offline'

// v4 (May 2026):
//   - Outbox now carries an `owner` field. Drainer filters by viewer so a
//     previous user's queued sends cannot fire against the new user's
//     credentials after a logout/login on the same device.
//   - Feeds are keyed by `${viewer}\x1e${communityId}` so two accounts
//     on the same device cannot read each other's cached community feed.
//   - Vestigial `posts` store dropped (no callers).
//   - Old v3 outbox/feeds rows are wiped on upgrade because they can't be
//     safely attributed to a viewer.
const DB_VERSION = 4

/** Separates viewer username from peer in conversations store `username` field (v3+). */
const VIEWER_PEER_SEP = '\x1e'

export function conversationRowId(viewerUsername: string, peerUsername: string): string {
  return `${viewerUsername}${VIEWER_PEER_SEP}${peerUsername}`
}

/** Build the per-viewer key used by ``cacheMessages`` / ``getCachedMessages`` for a group chat. */
export function groupConversationOfflineKey(viewerUsername: string, groupId: string | number): string {
  return `${viewerUsername}${VIEWER_PEER_SEP}group:${groupId}`
}

/** Build the per-viewer composite key for the ``feeds`` store. */
export function feedRowId(viewerUsername: string, communityId: string): string {
  return `${viewerUsername}${VIEWER_PEER_SEP}${communityId}`
}

export interface OfflineDB {
  messages: {
    key: string
    value: {
      id: string
      conversationKey: string
      data: unknown
      updatedAt: number
    }
    indexes: { conversation: string }
  }
  conversations: {
    key: string
    value: {
      username: string
      data: unknown
      updatedAt: number
    }
  }
  feeds: {
    key: string
    value: {
      // Composite `${viewer}\x1e${communityId}` so two accounts cannot
      // collide on the same community on a shared device.
      key: string
      viewer: string
      communityId: string
      data: unknown
      updatedAt: number
    }
    indexes: { viewer: string }
  }
  outbox: {
    key: number
    value: {
      id?: number
      // Username of the viewer who queued this entry. The drainer filters
      // by this so we never POST a previous identity's pending message as
      // the currently logged-in user.
      owner: string
      type: 'dm' | 'group'
      recipient: string
      groupId?: string
      content: string
      clientKey: string
      createdAt: number
      status: 'pending' | 'sending' | 'failed'
      retries: number
      replyTo?: string
      imagePath?: string
      voicePath?: string
      videoPath?: string
    }
    indexes: { owner: string }
  }
  keyval: {
    key: string
    value: {
      key: string
      data: unknown
      updatedAt: number
    }
  }
}

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null
let currentDb: IDBPDatabase<OfflineDB> | null = null

const STORES_TO_CLEAR_AS_FALLBACK: (keyof OfflineDB)[] = [
  'messages',
  'conversations',
  'feeds',
  'outbox',
  'keyval',
]

/**
 * Wipe the offline DM/feed cache DB.
 *
 * Called on logout / account switch so the next viewer cannot see the
 * previous viewer's data.
 *
 * Edge cases handled:
 *   * Open connection in this tab — closed before the delete request fires.
 *   * Open connection in another tab / SW — `deleteDatabase` would otherwise
 *     hang in `blocked` forever; we time out after `BLOCKED_TIMEOUT_MS` and
 *     fall back to clearing each store individually so at least the data is
 *     unreachable until the other tab closes.
 *   * IndexedDB unavailable (private mode, Safari ITP) — fail open, the
 *     state we couldn't reach is also unreachable for the next viewer.
 */
export async function deleteCpointOfflineDatabase(): Promise<void> {
  const BLOCKED_TIMEOUT_MS = 1500

  dbPromise = null
  if (currentDb) {
    try { currentDb.close() } catch { /* ignore */ }
    currentDb = null
  }

  const deleted = await new Promise<boolean>((resolve) => {
    let settled = false
    let request: IDBOpenDBRequest | undefined
    try {
      request = indexedDB.deleteDatabase(DB_NAME)
    } catch {
      resolve(false)
      return
    }
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    request.onsuccess = () => finish(true)
    request.onerror = () => finish(false)
    request.onblocked = () => {
      // Another connection is still open. Don't resolve immediately — wait
      // a moment; sometimes the other connection releases right after.
    }
    setTimeout(() => finish(false), BLOCKED_TIMEOUT_MS)
  })

  if (deleted) return

  // Fallback: open the DB at the current version and clear every store
  // individually. This still nukes per-account data even if another tab
  // is holding the connection open.
  try {
    const db = await openDB<OfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // No-op upgrade — we only want a handle to the existing schema.
        // (idb requires an upgrade callback on first open.)
        for (const store of STORES_TO_CLEAR_AS_FALLBACK) {
          if (!db.objectStoreNames.contains(store)) {
            try {
              switch (store) {
                case 'messages': {
                  const s = db.createObjectStore('messages', { keyPath: 'id' })
                  s.createIndex('conversation', 'conversationKey')
                  break
                }
                case 'conversations':
                  db.createObjectStore('conversations', { keyPath: 'username' })
                  break
                case 'feeds': {
                  const s = db.createObjectStore('feeds', { keyPath: 'key' })
                  s.createIndex('viewer', 'viewer')
                  break
                }
                case 'outbox': {
                  const s = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
                  s.createIndex('owner', 'owner')
                  break
                }
                case 'keyval':
                  db.createObjectStore('keyval', { keyPath: 'key' })
                  break
              }
            } catch { /* ignore */ }
          }
        }
      },
    })
    try {
      const stores = STORES_TO_CLEAR_AS_FALLBACK.filter(s => db.objectStoreNames.contains(s)) as ('messages'|'conversations'|'feeds'|'outbox'|'keyval')[]
      if (stores.length) {
        const tx = db.transaction(stores, 'readwrite')
        await Promise.all(stores.map(s => tx.objectStore(s).clear()))
        await tx.done
      }
    } finally {
      try { db.close() } catch { /* ignore */ }
    }
  } catch {
    // Swallow — best-effort cleanup. The deleteDatabase result above will
    // have already been logged by the caller if needed.
  }
}

function getDb(): Promise<IDBPDatabase<OfflineDB>> {
  if (dbPromise) return dbPromise
  dbPromise = openDB<OfflineDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        const msgStore = db.createObjectStore('messages', { keyPath: 'id' })
        msgStore.createIndex('conversation', 'conversationKey')
        db.createObjectStore('conversations', { keyPath: 'username' })
        db.createObjectStore('keyval', { keyPath: 'key' })
        const outboxStore = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
        outboxStore.createIndex('owner', 'owner')
        const feedStore = db.createObjectStore('feeds', { keyPath: 'key' })
        feedStore.createIndex('viewer', 'viewer')
      }
      if (oldVersion < 2) {
        // v2: extended outbox fields. Flush any v1 entries.
        if (db.objectStoreNames.contains('outbox')) {
          try { db.deleteObjectStore('outbox') } catch { /* ignore */ }
        }
        const s = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
        s.createIndex('owner', 'owner')
      }
      if (oldVersion < 3) {
        // v3: DM messages/conversations were keyed only by peer; clear so
        // the next viewer cannot see the previous user's threads.
        try {
          if (transaction) {
            transaction.objectStore('messages').clear()
            transaction.objectStore('conversations').clear()
          }
        } catch { /* ignore */ }
      }
      if (oldVersion < 4) {
        // v4: attribute outbox + feeds to a viewer. Old rows can't be
        // safely attributed, so we drop the stores and recreate them.
        try {
          if (db.objectStoreNames.contains('posts')) {
            db.deleteObjectStore('posts')
          }
        } catch { /* ignore */ }
        try {
          if (db.objectStoreNames.contains('feeds')) {
            db.deleteObjectStore('feeds')
          }
          const feedStore = db.createObjectStore('feeds', { keyPath: 'key' })
          feedStore.createIndex('viewer', 'viewer')
        } catch { /* ignore */ }
        try {
          if (db.objectStoreNames.contains('outbox')) {
            db.deleteObjectStore('outbox')
          }
          const outboxStore = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
          outboxStore.createIndex('owner', 'owner')
        } catch { /* ignore */ }
        // Messages from v3 may still be group:* keyed without viewer scope —
        // wipe them too. New writes will use ``groupConversationOfflineKey``.
        try {
          if (transaction && db.objectStoreNames.contains('messages')) {
            transaction.objectStore('messages').clear()
          }
        } catch { /* ignore */ }
      }
    },
  }).then((db) => {
    currentDb = db
    db.addEventListener('close', () => {
      if (currentDb === db) currentDb = null
      dbPromise = null
    })
    return db
  }).catch((err) => {
    console.warn('IndexedDB unavailable, offline cache disabled:', err)
    dbPromise = null
    throw err
  })
  return dbPromise
}

// ---------- Messages ----------
//
// `conversationKey` is expected to be viewer-scoped already:
//   * DMs:    use ``dmConversationOfflineKey(viewer, peer)`` from chatThreadsCache
//   * Groups: use ``groupConversationOfflineKey(viewer, groupId)`` from this module
// Otherwise two accounts on the same device collide.

export async function cacheMessages(conversationKey: string, rawMessages: unknown[]): Promise<void> {
  try {
    const db = await getDb()
    const tx = db.transaction('messages', 'readwrite')
    const now = Date.now()
    await Promise.all(
      rawMessages.map((msg: any) =>
        tx.store.put({
          id: `${conversationKey}:${msg.id}`,
          conversationKey,
          data: msg,
          updatedAt: now,
        }),
      ),
    )
    await tx.done
  } catch { /* offline db unavailable */ }
}

export async function getCachedMessages(conversationKey: string): Promise<unknown[] | null> {
  try {
    const db = await getDb()
    const rows = await db.getAllFromIndex('messages', 'conversation', conversationKey)
    if (!rows.length) return null
    rows.sort((a, b) => {
      const aId = (a.data as any)?.id ?? 0
      const bId = (b.data as any)?.id ?? 0
      return Number(aId) - Number(bId)
    })
    return rows.map(r => r.data)
  } catch {
    return null
  }
}

export async function clearConversationMessages(conversationKey: string): Promise<void> {
  try {
    const db = await getDb()
    const tx = db.transaction('messages', 'readwrite')
    const index = tx.store.index('conversation')
    let cursor = await index.openCursor(conversationKey)
    while (cursor) {
      await cursor.delete()
      cursor = await cursor.continue()
    }
    await tx.done
  } catch { /* ignore */ }
}

// ---------- Conversations list ----------

export async function cacheConversations(viewerUsername: string, threads: unknown[]): Promise<void> {
  if (!viewerUsername) return
  try {
    const db = await getDb()
    const tx = db.transaction('conversations', 'readwrite')
    const len = threads.length
    for (let i = 0; i < len; i++) {
      const t = (threads as any[])[i]
      const peer = t.other_username || t.username || String(t.id)
      await tx.store.put({
        username: conversationRowId(viewerUsername, String(peer)),
        data: t,
        updatedAt: len - i,
      })
    }
    await tx.done
  } catch { /* ignore */ }
}

export async function getCachedConversations(viewerUsername: string): Promise<unknown[] | null> {
  if (!viewerUsername) return null
  try {
    const db = await getDb()
    const all = await db.getAll('conversations')
    const prefix = `${viewerUsername}${VIEWER_PEER_SEP}`
    const filtered = all.filter(r => String(r.username).startsWith(prefix))
    if (!filtered.length) return null
    filtered.sort((a, b) => b.updatedAt - a.updatedAt)
    return filtered.map(r => r.data)
  } catch {
    return null
  }
}

/** Remove one DM thread row from IndexedDB (e.g. after clear chat so preview cannot stay stale). */
export async function deleteCachedConversationRow(viewerUsername: string, peerUsername: string): Promise<void> {
  if (!viewerUsername || !peerUsername) return
  try {
    const db = await getDb()
    await db.delete('conversations', conversationRowId(viewerUsername, peerUsername))
  } catch {
    /* ignore */
  }
}

// ---------- Community feed ----------
//
// Always pass the viewer's username. An empty string is rejected so we
// never write an unattributed row (which is what created the cross-account
// leak v4 fixes).

export async function cacheFeed(viewerUsername: string, communityId: string, feedData: unknown): Promise<void> {
  if (!viewerUsername || !communityId) return
  try {
    const db = await getDb()
    await db.put('feeds', {
      key: feedRowId(viewerUsername, communityId),
      viewer: viewerUsername,
      communityId,
      data: feedData,
      updatedAt: Date.now(),
    })
  } catch { /* ignore */ }
}

export async function getCachedFeed(viewerUsername: string, communityId: string): Promise<unknown | null> {
  if (!viewerUsername || !communityId) return null
  try {
    const db = await getDb()
    const row = await db.get('feeds', feedRowId(viewerUsername, communityId))
    return row?.data ?? null
  } catch {
    return null
  }
}

// ---------- Generic key-value (profiles, settings, etc.) ----------

export async function cacheKeyVal(key: string, data: unknown): Promise<void> {
  try {
    const db = await getDb()
    await db.put('keyval', { key, data, updatedAt: Date.now() })
  } catch { /* ignore */ }
}

export async function getCachedKeyVal<T = unknown>(key: string): Promise<T | null> {
  try {
    const db = await getDb()
    const row = await db.get('keyval', key)
    return (row?.data as T) ?? null
  } catch {
    return null
  }
}

export async function deleteCachedKeyVal(key: string): Promise<void> {
  try {
    const db = await getDb()
    await db.delete('keyval', key)
  } catch {
    /* ignore */
  }
}

// ---------- Outbox ----------

export type OutboxEntry = OfflineDB['outbox']['value']

/**
 * Queue a pending message send. ``entry.owner`` MUST be the username of
 * the currently signed-in viewer. The drainer filters by ``owner`` so a
 * pending entry from a previous account cannot fire as the new account.
 */
export async function addToOutbox(entry: Omit<OutboxEntry, 'id'>): Promise<number> {
  if (!entry.owner) {
    throw new Error('addToOutbox: owner (viewer username) is required')
  }
  const db = await getDb()
  return db.add('outbox', entry as OfflineDB['outbox']['value']) as Promise<number>
}

/**
 * Return only the queued entries that belong to ``viewerUsername``.
 *
 * Pre-v4 entries (without an ``owner`` field) are deleted on read; they
 * predate the fix and cannot be safely drained as anyone.
 */
export async function getOutboxEntries(viewerUsername: string): Promise<OfflineDB['outbox']['value'][] > {
  if (!viewerUsername) return []
  try {
    const db = await getDb()
    const all = await db.getAll('outbox')
    const ownedByViewer: OutboxEntry[] = []
    const orphanIds: number[] = []
    for (const e of all) {
      if (!e || !e.owner) {
        if (e?.id != null) orphanIds.push(e.id)
        continue
      }
      if (e.owner === viewerUsername) ownedByViewer.push(e)
    }
    if (orphanIds.length) {
      try {
        const tx = db.transaction('outbox', 'readwrite')
        await Promise.all(orphanIds.map(id => tx.store.delete(id)))
        await tx.done
      } catch { /* ignore */ }
    }
    return ownedByViewer
  } catch {
    return []
  }
}

export async function updateOutboxStatus(id: number, status: 'pending' | 'sending' | 'failed', retries?: number): Promise<void> {
  try {
    const db = await getDb()
    const entry = await db.get('outbox', id)
    if (!entry) return
    entry.status = status
    if (retries !== undefined) entry.retries = retries
    await db.put('outbox', entry)
  } catch { /* ignore */ }
}

export async function removeFromOutbox(id: number): Promise<void> {
  try {
    const db = await getDb()
    await db.delete('outbox', id)
  } catch { /* ignore */ }
}
