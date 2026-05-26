/**
 * Helpers for merging polled DM messages with optimistic local state.
 * Ensures PDF document attachments (file_path/file_name) survive poll updates.
 */

export interface DmPollMessageLike {
  id?: number | string
  text?: string
  file_path?: string | null
  file_name?: string | null
  image_path?: string | null
  video_path?: string | null
  audio_path?: string | null
  sent?: boolean
  time?: string
  isOptimistic?: boolean
  sendFailed?: boolean
}

const DOCUMENT_OPTIMISTIC_MATCH_MS = 90_000
const DOCUMENT_OPTIMISTIC_RETAIN_MS = 90_000

export function mergeDocumentFields(
  server: Pick<DmPollMessageLike, 'file_path' | 'file_name'>,
  existing?: DmPollMessageLike | null,
): Pick<DmPollMessageLike, 'file_path' | 'file_name'> {
  const serverPath = server.file_path || null
  const existingPath = existing?.file_path || null
  const file_path = serverPath || existingPath || undefined
  const file_name = server.file_name || existing?.file_name || undefined
  return { file_path: file_path ?? undefined, file_name }
}

export function isBlobUrl(path?: string | null): boolean {
  return Boolean(path && path.startsWith('blob:'))
}

/** True when an optimistic PDF upload should not be dropped by poll cleanup yet. */
export function shouldRetainOptimisticDuringUpload(msg: DmPollMessageLike, nowMs: number): boolean {
  if (!msg.isOptimistic || msg.sendFailed) return false
  if (!msg.file_path || !isBlobUrl(msg.file_path)) return false
  if (msg.image_path || msg.video_path || msg.audio_path) return false
  const ts = parseMessageTimeMs(msg.time)
  if (ts === null) return true
  return nowMs - ts < DOCUMENT_OPTIMISTIC_RETAIN_MS
}

export function parseMessageTimeMs(raw?: string): number | null {
  if (!raw) return null
  const parsed = Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T'))
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Match a server document row to an optimistic blob-URL PDF bubble.
 */
export function tryMatchDocumentOptimistic(
  serverMsg: Pick<DmPollMessageLike, 'time' | 'file_path' | 'file_name'>,
  existing: DmPollMessageLike,
  isSentByMe: boolean,
): boolean {
  if (existing.sent !== isSentByMe) return false
  if (!existing.file_path) return false

  const serverPath = serverMsg.file_path
  if (serverPath && existing.file_path === serverPath) {
    return true
  }

  if (!existing.isOptimistic || !isBlobUrl(existing.file_path)) {
    return false
  }

  // Server may return file_path on document-only rows, or text-only until MySQL merge.
  const serverTs = parseMessageTimeMs(serverMsg.time)
  const existingTs = parseMessageTimeMs(existing.time)
  if (serverTs === null || existingTs === null) return false
  return Math.abs(serverTs - existingTs) < DOCUMENT_OPTIMISTIC_MATCH_MS
}

export function documentMatchWindowMs(): number {
  return DOCUMENT_OPTIMISTIC_MATCH_MS
}

/** Fields that affect MessageBubble render — used to skip no-op poll updates. */
export function messagePollSignature(m: DmPollMessageLike & {
  reaction?: string | null
  edited_at?: string | null
  decryption_error?: boolean
  media_paths?: string[] | null
}): string {
  const mediaPaths = m.media_paths?.join('\u001e') ?? ''
  return [
    m.id ?? '',
    m.text ?? '',
    m.reaction ?? '',
    m.isOptimistic ? 1 : 0,
    m.sendFailed ? 1 : 0,
    m.edited_at ?? '',
    m.decryption_error ? 1 : 0,
    m.image_path ?? '',
    m.video_path ?? '',
    mediaPaths,
    m.audio_path ?? '',
    m.file_path ?? '',
    m.file_name ?? '',
  ].join('\u001f')
}

/** Return prev when polled merge produced an identical message list (stable array ref). */
export function retainMessagesIfUnchanged<T>(
  prev: T[],
  next: T[],
  signature: (m: T) => string,
): T[] {
  if (prev.length !== next.length) return next
  for (let i = 0; i < prev.length; i++) {
    if (signature(prev[i]) !== signature(next[i])) return next
  }
  return prev
}
