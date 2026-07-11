/**
 * Write-through preview bumps for the Messages (user_chat) inbox caches.
 *
 * The inbox seeds instantly from device caches (localStorage + IndexedDB) and
 * only then reconciles with /api/chat_threads. Without a write-through, a user
 * returning from a thread sees the preview as-of the LAST list fetch until the
 * network round-trip lands. Thread pages call these bumps whenever their newest
 * message changes so the inbox paints fresh previews on the first frame.
 *
 * Only text previews are bumped — media-only messages keep the previous
 * preview until the server list refresh supplies its canonical media label.
 */

import { readDeviceCache, writeDeviceCache } from '../utils/deviceCache'
import {
  threadsListCacheKey,
  groupChatsListCacheKey,
  THREADS_LIST_CACHE_VERSION,
  THREADS_LIST_CACHE_TTL_MS,
} from '../utils/chatThreadsCache'
import { cacheConversations, cacheKeyVal, getCachedKeyVal } from '../utils/offlineDb'
import type { DmThreadRowLike, GroupChatRowLike } from '../utils/chatThreadListMerge'

/** Server list rows use ISO-like "YYYY-MM-DDTHH:MM:SS"; message rows may use a space. */
export function normalizeIsoLikeTime(time?: string | null): string {
  const s = (time || '').trim()
  if (s) return s.replace(' ', 'T')
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

export interface DmPreviewBump {
  /** Raw message text; empty/whitespace means "don't touch the preview" (media rows). */
  text?: string | null
  /** Message time as delivered by the server or optimistic send. */
  time?: string | null
  sentByViewer: boolean
}

/**
 * Update the viewer's DM inbox caches after the newest message in a thread
 * changed. Also zeroes the unread badge for that thread — the viewer has it
 * open. No-op when the list cache is cold (first visit paints from network).
 */
export function bumpDmThreadPreview(
  viewerUsername: string,
  peerUsername: string,
  bump: DmPreviewBump,
): void {
  if (!viewerUsername || !peerUsername) return
  const key = threadsListCacheKey(viewerUsername)
  const rows = readDeviceCache<DmThreadRowLike[]>(key, THREADS_LIST_CACHE_VERSION)
  if (!rows || rows.length === 0) return
  const idx = rows.findIndex(r => r.other_username === peerUsername)
  if (idx < 0) return

  // Monotonic: thread pages seed from a possibly-stale device cache on open —
  // never regress a fresher list preview backward (ISO-like strings compare
  // lexicographically). The network reconcile re-bumps with the true newest.
  const bumpTime = normalizeIsoLikeTime(bump.time)
  const existingTime = rows[idx].last_activity_time || ''
  const hasText = !!(bump.text && bump.text.trim()) && bumpTime >= existingTime
  const row: DmThreadRowLike = { ...rows[idx], unread_count: 0 }
  if (hasText) {
    row.last_message_text = bump.text as string
    row.last_activity_time = bumpTime
    row.last_sender = bump.sentByViewer ? viewerUsername : peerUsername
  }

  // New activity floats the row to the top (matches server recency sort);
  // an unread-only bump keeps the existing order.
  const next = hasText
    ? [row, ...rows.slice(0, idx), ...rows.slice(idx + 1)]
    : [...rows.slice(0, idx), row, ...rows.slice(idx + 1)]

  writeDeviceCache(key, next, THREADS_LIST_CACHE_TTL_MS, THREADS_LIST_CACHE_VERSION)
  void cacheConversations(viewerUsername, next)
}

export interface GroupPreviewBump {
  text?: string | null
  time?: string | null
  sender?: string | null
}

/** Group-chat variant of {@link bumpDmThreadPreview} (IndexedDB keyval list). */
export async function bumpGroupChatPreview(
  viewerUsername: string,
  groupId: number,
  bump: GroupPreviewBump,
): Promise<void> {
  if (!viewerUsername || !groupId) return
  try {
    const key = groupChatsListCacheKey(viewerUsername)
    const rows = await getCachedKeyVal<GroupChatRowLike[]>(key)
    if (!rows || rows.length === 0) return
    const idx = rows.findIndex(r => r.id === groupId)
    if (idx < 0) return

    // Monotonic — see bumpDmThreadPreview.
    const bumpTime = normalizeIsoLikeTime(bump.time)
    const existingTime = normalizeIsoLikeTime(rows[idx].last_message?.time ?? '1970-01-01T00:00:00')
    const hasText = !!(bump.text && bump.text.trim()) && bumpTime >= existingTime
    const row: GroupChatRowLike = { ...rows[idx], unread_count: 0 }
    if (hasText) {
      row.last_message = {
        sender: bump.sender || '',
        text: bump.text as string,
        time: bumpTime,
      }
    }

    const next = hasText
      ? [row, ...rows.slice(0, idx), ...rows.slice(idx + 1)]
      : [...rows.slice(0, idx), row, ...rows.slice(idx + 1)]
    await cacheKeyVal(key, next)
  } catch {
    /* cache write must never break the thread page */
  }
}
