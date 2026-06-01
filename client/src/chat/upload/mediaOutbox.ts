import { openDB, type IDBPDatabase } from 'idb'
import type { CompletedPart, MediaOutboxRecord, UploadContext, MediaKind } from './types'

const MEDIA_OUTBOX_DB = 'cpoint-media-outbox'
const MEDIA_OUTBOX_VERSION = 2
/** Skip IDB blob persistence above this size (upload still proceeds; resume unavailable). */
const MAX_OUTBOX_BLOB_BYTES = 80 * 1024 * 1024
const STALE_LOCK_MS = 60 * 1000
const GHOST_UPLOAD_MS = 10 * 60 * 1000
const MAX_AUTO_RETRIES = 5

interface StoredBlobRow {
  clientKey: string
  data: ArrayBuffer
  contentType: string
  updatedAt: number
}

/** Legacy v1 row shape (Blob) — read-only for migration. */
interface LegacyBlobRow {
  clientKey: string
  blob: Blob
  updatedAt: number
}

interface MediaOutboxDb {
  records: {
    key: number
    value: MediaOutboxRecord
  }
  blobs: {
    key: string
    value: StoredBlobRow | LegacyBlobRow
  }
}

let dbPromise: Promise<IDBPDatabase<MediaOutboxDb>> | null = null

function getDb(): Promise<IDBPDatabase<MediaOutboxDb>> {
  if (dbPromise) return dbPromise
  dbPromise = openDB<MediaOutboxDb>(MEDIA_OUTBOX_DB, MEDIA_OUTBOX_VERSION, {
    upgrade(db, oldVersion) {
      if (!db.objectStoreNames.contains('records')) {
        db.createObjectStore('records', { keyPath: 'id', autoIncrement: true })
      }
      if (oldVersion > 0 && oldVersion < 2 && db.objectStoreNames.contains('blobs')) {
        db.deleteObjectStore('blobs')
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'clientKey' })
      }
    },
  }).catch(err => {
    console.warn('Media outbox unavailable:', err)
    dbPromise = null
    throw err
  })
  return dbPromise
}

async function blobToStorable(blob: Blob): Promise<StoredBlobRow | null> {
  if (!blob.size) return null
  if (blob.size > MAX_OUTBOX_BLOB_BYTES) return null
  try {
    const data = await blob.arrayBuffer()
    return {
      clientKey: '',
      data,
      contentType: blob.type || 'application/octet-stream',
      updatedAt: Date.now(),
    }
  } catch {
    return null
  }
}

function rowToBlob(row: StoredBlobRow | LegacyBlobRow): Blob | null {
  if ('data' in row && row.data instanceof ArrayBuffer) {
    return new Blob([row.data], { type: row.contentType || 'application/octet-stream' })
  }
  if ('blob' in row && row.blob instanceof Blob) {
    return row.blob
  }
  return null
}

export async function saveMediaOutboxRecord(
  record: Omit<MediaOutboxRecord, 'id'>,
  blob?: Blob,
): Promise<number | undefined> {
  try {
    const db = await getDb()
    let hasBlob = false
    const id = (await db.add('records', {
      ...record,
      hasBlob: false,
      updatedAt: Date.now(),
    })) as number

    if (blob) {
      const storable = await blobToStorable(blob)
      if (storable) {
        await db.put('blobs', {
          clientKey: record.clientKey,
          data: storable.data,
          contentType: storable.contentType,
          updatedAt: storable.updatedAt,
        })
        hasBlob = true
        await db.put('records', { ...record, id, hasBlob, updatedAt: Date.now() })
      }
    }

    return id
  } catch (err) {
    console.warn('[mediaOutbox] save failed (upload continues):', err)
    return undefined
  }
}

export async function updateMediaOutboxRecord(
  id: number,
  patch: Partial<MediaOutboxRecord>,
): Promise<void> {
  try {
    const db = await getDb()
    const row = await db.get('records', id)
    if (!row) return
    await db.put('records', { ...row, ...patch, id, updatedAt: Date.now() })
  } catch (err) {
    console.warn('[mediaOutbox] update failed:', err)
  }
}

export async function claimMediaOutboxRecord(id: number): Promise<(MediaOutboxRecord & { id: number }) | null> {
  try {
    const db = await getDb()
    const row = await db.get('records', id)
    if (!row) return null
    const now = Date.now()
    if (row.lockedAt && now - row.lockedAt < STALE_LOCK_MS) return null
    const claimed = { ...row, id, lockedAt: now, updatedAt: now }
    await db.put('records', claimed)
    return claimed as MediaOutboxRecord & { id: number }
  } catch (err) {
    console.warn('[mediaOutbox] claim failed:', err)
    return null
  }
}

export async function releaseMediaOutboxRecord(id: number): Promise<void> {
  try {
    const db = await getDb()
    const row = await db.get('records', id)
    if (!row) return
    const { lockedAt: _lockedAt, ...rest } = row
    await db.put('records', { ...rest, id, updatedAt: Date.now() })
  } catch {
    /* ignore */
  }
}

export async function getMediaOutboxBlob(clientKey: string): Promise<Blob | null> {
  try {
    const db = await getDb()
    const row = await db.get('blobs', clientKey)
    if (!row) return null
    return rowToBlob(row)
  } catch {
    return null
  }
}

export async function removeMediaOutboxRecord(id: number, clientKey?: string): Promise<void> {
  try {
    const db = await getDb()
    await db.delete('records', id)
    if (clientKey) await db.delete('blobs', clientKey)
  } catch {
    /* ignore */
  }
}

export async function removeMediaOutboxRecordsByPrefix(clientKeyPrefix: string): Promise<void> {
  try {
    const db = await getDb()
    const all = await db.getAll('records')
    await Promise.all(
      all
        .filter(row => row.clientKey === clientKeyPrefix || row.clientKey.startsWith(`${clientKeyPrefix}_`))
        .map(row => removeMediaOutboxRecord(row.id as number, row.clientKey)),
    )
  } catch {
    /* ignore */
  }
}

export async function listPendingMediaOutbox(): Promise<Array<MediaOutboxRecord & { id: number }>> {
  try {
    const db = await getDb()
    const all = await db.getAll('records')
    const now = Date.now()
    await Promise.all(
      all
        .filter(r => (r.status === 'uploading' || r.status === 'committing') && now - (r.updatedAt || r.createdAt || 0) > GHOST_UPLOAD_MS)
        .map(r => updateMediaOutboxRecord(r.id as number, { status: 'failed', error: 'chat.upload_interrupted_retry' })),
    )
    return all.filter(r => r.status === 'pending' || r.status === 'failed' || r.status === 'uploading' || r.status === 'committing') as Array<
      MediaOutboxRecord & { id: number }
    >
  } catch {
    return []
  }
}

export async function resumeOutboxUploads(
  handler: (record: MediaOutboxRecord & { id: number }, blob: Blob) => Promise<void>,
  options?: {
    onMissingBlob?: (record: MediaOutboxRecord & { id: number }) => void
    onRetryLimit?: (record: MediaOutboxRecord & { id: number }) => void
  },
): Promise<void> {
  const pending = await listPendingMediaOutbox()
  for (const record of pending) {
    if (record.status === 'cancelled') continue
    if ((record.retries || 0) >= MAX_AUTO_RETRIES) {
      options?.onRetryLimit?.(record)
      continue
    }
    const blob = await getMediaOutboxBlob(record.clientKey)
    if (!blob) {
      await updateMediaOutboxRecord(record.id, { status: 'failed', error: 'chat.upload_unrecoverable' })
      options?.onMissingBlob?.(record)
      continue
    }
    try {
      await handler(record, blob)
    } catch (err) {
      console.warn('[mediaOutbox] resume failed', record.clientKey, err)
    }
  }
}

export async function clearMediaOutbox(): Promise<void> {
  try {
    const db = await getDb()
    await Promise.all([db.clear('records'), db.clear('blobs')])
  } catch {
    /* ignore */
  }
}

export type { UploadContext, MediaKind, CompletedPart, MediaOutboxRecord }
