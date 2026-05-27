import type { MutableRefObject } from 'react'
import { readDeviceCacheStale } from '../utils/deviceCache'
import { CHAT_CACHE_VERSION } from './utils'

export type ThreadCacheSnapshot = {
  count: number
  tailId: string | number | undefined
}

/** Stale-while-revalidate read — returns data even when localStorage TTL expired. */
export function readStaleDeviceCache<T>(
  cacheKey: string | null | undefined,
  version: string = CHAT_CACHE_VERSION,
): T | null {
  if (!cacheKey) return null
  return readDeviceCacheStale<T>(cacheKey, version).data
}

export function snapshotFromMessages(
  messages: ReadonlyArray<{ id?: string | number }>,
): ThreadCacheSnapshot {
  return {
    count: messages.length,
    tailId: messages[messages.length - 1]?.id,
  }
}

export function markThreadCachePainted(
  cachePaintedGenRef: MutableRefObject<number | null>,
  cacheSnapshotRef: MutableRefObject<ThreadCacheSnapshot | null>,
  gen: number,
  messages: ReadonlyArray<{ id?: string | number }>,
): void {
  cachePaintedGenRef.current = gen
  cacheSnapshotRef.current = snapshotFromMessages(messages)
}

export function isCachePaintedForGen(
  cachePaintedGenRef: MutableRefObject<number | null>,
  gen: number,
): boolean {
  return cachePaintedGenRef.current === gen
}

/** Skip network merge + badge refresh when server tail matches cache paint. */
export function isUnchangedFromCacheSnapshot(
  snap: ThreadCacheSnapshot | null,
  fromCache: boolean,
  processedMessages: ReadonlyArray<{ id?: string | number }>,
): boolean {
  if (!fromCache || snap == null) return false
  return (
    processedMessages.length === snap.count &&
    String(processedMessages[processedMessages.length - 1]?.id) === String(snap.tailId)
  )
}

export type IndexedDbThreadHydrateOptions<TRaw, TMeta = unknown> = {
  gen: number
  isGenerationCurrent: (gen: number) => boolean
  fetchMessages: () => Promise<TRaw[] | null | undefined>
  fetchMeta?: () => Promise<TMeta | null | undefined>
  hasLocalStaleMessages: boolean
  onMeta?: (meta: TMeta) => void
  onMessages: (messages: TRaw[]) => void
  onEmpty?: () => void
}

/** IndexedDB fallback when synchronous stale localStorage did not paint. */
export async function hydrateThreadFromIndexedDb<TRaw, TMeta = unknown>(
  options: IndexedDbThreadHydrateOptions<TRaw, TMeta>,
): Promise<boolean> {
  const {
    gen,
    isGenerationCurrent,
    fetchMessages,
    fetchMeta,
    hasLocalStaleMessages,
    onMeta,
    onMessages,
    onEmpty,
  } = options

  try {
    const [idbMsgs, idbMeta] = await Promise.all([
      fetchMessages(),
      fetchMeta ? fetchMeta() : Promise.resolve(undefined),
    ])

    if (!isGenerationCurrent(gen)) return false

    if (idbMeta != null && idbMeta !== undefined && onMeta) {
      onMeta(idbMeta)
    }

    if (idbMsgs?.length) {
      onMessages(idbMsgs)
      return true
    }

    if (!hasLocalStaleMessages) {
      onEmpty?.()
    }
    return false
  } catch {
    if (!isGenerationCurrent(gen)) return false
    if (!hasLocalStaleMessages) {
      onEmpty?.()
    }
    return false
  }
}
