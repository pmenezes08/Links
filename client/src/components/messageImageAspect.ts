/** Default width/height for chat photos before dimensions are known (portrait phone). */
export const MESSAGE_IMAGE_DEFAULT_ASPECT_RATIO = 3 / 4

const MIN_ASPECT_RATIO = 0.45
const MAX_ASPECT_RATIO = 2.2

/** Session cache: normalized src → width/height ratio (w/h). */
const aspectRatioBySrc = new Map<string, number>()

export function messageImageCacheKey(src: string): string {
  return src?.split('?')[0]?.toLowerCase() || ''
}

export function clampMessageImageAspectRatio(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return MESSAGE_IMAGE_DEFAULT_ASPECT_RATIO
  }
  const ratio = width / height
  return Math.min(MAX_ASPECT_RATIO, Math.max(MIN_ASPECT_RATIO, ratio))
}

export function readCachedMessageImageAspectRatio(src: string): number | undefined {
  const key = messageImageCacheKey(src)
  if (!key) return undefined
  return aspectRatioBySrc.get(key)
}

export function writeCachedMessageImageAspectRatio(
  src: string,
  width: number,
  height: number,
): number {
  const key = messageImageCacheKey(src)
  const ratio = clampMessageImageAspectRatio(width, height)
  if (key) aspectRatioBySrc.set(key, ratio)
  return ratio
}

/** For tests — reset module cache between cases. */
export function clearMessageImageAspectCache(): void {
  aspectRatioBySrc.clear()
}

/**
 * Probe intrinsic dimensions (browser cache hit returns before paint).
 * Safe to call from useLayoutEffect; no-op resolve on empty src.
 */
export function probeMessageImageAspectRatio(
  loadSrc: string,
  { cacheSrc = loadSrc, signal }: { cacheSrc?: string; signal?: AbortSignal } = {},
): Promise<number | undefined> {
  if (!loadSrc || typeof Image === 'undefined') return Promise.resolve(undefined)

  const cached = readCachedMessageImageAspectRatio(cacheSrc)
  if (cached !== undefined) return Promise.resolve(cached)

  return new Promise(resolve => {
    if (signal?.aborted) {
      resolve(undefined)
      return
    }

    const img = new Image()
    const finish = (ratio: number | undefined) => {
      img.onload = null
      img.onerror = null
      resolve(ratio)
    }

    const onAbort = () => finish(undefined)
    signal?.addEventListener('abort', onAbort, { once: true })

    img.onload = () => {
      signal?.removeEventListener('abort', onAbort)
      finish(writeCachedMessageImageAspectRatio(cacheSrc, img.naturalWidth, img.naturalHeight))
    }
    img.onerror = () => {
      signal?.removeEventListener('abort', onAbort)
      finish(undefined)
    }
    img.decoding = 'async'
    img.src = loadSrc
  })
}
