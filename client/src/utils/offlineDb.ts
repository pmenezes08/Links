import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'cpoint-offline'
const DB_VERSION = 2

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
  posts: {
    key: string
    value: {
      id: string
      communityId: string
      data: unknown
      updatedAt: number
    }
    indexes: { community: string }
  }
  feeds: {
    key: string
    value: {
      communityId: string
      data: unknown
      updatedAt: number
    }
  }
  outbox: {
    key: number
    value: {
      id?: number
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

function getDb(): Promise<IDBPDatabase<OfflineDB>> {
  if (dbPromise) return dbPromise
  dbPromise = openDB<OfflineDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const msgStore = db.createObjectStore('messages', { keyPath: 'id' })
        msgStore.createIndex('conversation', 'conversationKey')
        db.createObjectStore('conversations', { keyPath: 'username' })
        const postStore = db.createObjectStore('posts', { keyPath: 'id' })
        postStore.createIndex('community', 'communityId')
        db.createObjectStore('feeds', { keyPath: 'communityId' })
        db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
        db.createObjectStore('keyval', { keyPath: 'key' })
      }
      if (oldVersion < 2) {
        // v2: extended outbox fields (groupId, replyTo, media paths) are optional —
        // no structural migration needed since the outbox store is schemaless.
        // Flush any stale outbox entries from v1 to avoid type mismatches.
        if (db.objectStoreNames.contains('outbox')) {
          try {
            db.deleteObjectStore('outbox')
          } catch { /* ignore */ }
          db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
        }
      }
    },
  }).catch((err) => {
    console.warn('IndexedDB unavailable, offline cache disabled:', err)
    dbPromise = null
    throw err
  })
  return dbPromise
}

// ---------- Messages ----------

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

export async function cacheConversations(threads: unknown[]): Promise<void> {
  try {
    const db = await getDb()
    const tx = db.transaction('conversations', 'readwrite')
    const len = threads.length
    for (let i = 0; i < len; i++) {
      const t = (threads as any[])[i]
      await tx.store.put({
        username: t.other_username || t.username || String(t.id),
        data: t,
        updatedAt: len - i,
      })
    }
    await tx.done
  } catch { /* ignore */ }
}

export async function getCachedConversations(): Promise<unknown[] | null> {
  try {
    const db = await getDb()
    const all = await db.getAll('conversations')
    if (!all.length) return null
    all.sort((a, b) => b.updatedAt - a.updatedAt)
    return all.map(r => r.data)
  } catch {
    return null
  }
}

// ---------- Community feed ----------

export async function cacheFeed(communityId: string, feedData: unknown): Promise<void> {
  try {
    const db = await getDb()
    await db.put('feeds', {
      communityId,
      data: feedData,
      updatedAt: Date.now(),
    })
  } catch { /* ignore */ }
}

export async function getCachedFeed(communityId: string): Promise<unknown | null> {
  try {
    const db = await getDb()
    const row = await db.get('feeds', communityId)
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

// ---------- Outbox ----------

export type OutboxEntry = OfflineDB['outbox']['value']

export async function addToOutbox(entry: Omit<OutboxEntry, 'id'>): Promise<number> {
  const db = await getDb()
  return db.add('outbox', entry as OfflineDB['outbox']['value']) as Promise<number>
}

export async function getOutboxEntries(): Promise<OfflineDB['outbox']['value'][]> {
  try {
    const db = await getDb()
    return db.getAll('outbox')
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
