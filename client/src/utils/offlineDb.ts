import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'cpoint-offline'
const DB_VERSION = 1

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
      content: string
      clientKey: string
      createdAt: number
      status: 'pending' | 'sending' | 'failed'
      retries: number
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
    upgrade(db) {
      if (!db.objectStoreNames.contains('messages')) {
        const msgStore = db.createObjectStore('messages', { keyPath: 'id' })
        msgStore.createIndex('conversation', 'conversationKey')
      }
      if (!db.objectStoreNames.contains('conversations')) {
        db.createObjectStore('conversations', { keyPath: 'username' })
      }
      if (!db.objectStoreNames.contains('posts')) {
        const postStore = db.createObjectStore('posts', { keyPath: 'id' })
        postStore.createIndex('community', 'communityId')
      }
      if (!db.objectStoreNames.contains('feeds')) {
        db.createObjectStore('feeds', { keyPath: 'communityId' })
      }
      if (!db.objectStoreNames.contains('outbox')) {
        db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
      }
      if (!db.objectStoreNames.contains('keyval')) {
        db.createObjectStore('keyval', { keyPath: 'key' })
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
    const now = Date.now()
    for (const t of threads as any[]) {
      await tx.store.put({
        username: t.other_username || t.username || String(t.id),
        data: t,
        updatedAt: now,
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

export async function addToOutbox(entry: Omit<OfflineDB['outbox']['value'], 'id'>): Promise<number> {
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
