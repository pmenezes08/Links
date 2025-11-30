const DEFAULT_TTL_MS = 3 * 60 * 1000 // 3 minutes

type CacheEnvelope<T> = {
  data: T
  expiresAt: number
}

const hasWindow = typeof window !== 'undefined'

function getStorage() {
  if (!hasWindow) return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readDeviceCache<T>(key: string): T | null {
  const storage = getStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const envelope = JSON.parse(raw) as CacheEnvelope<T>
    if (!envelope || typeof envelope.expiresAt !== 'number') return null
    if (envelope.expiresAt < Date.now()) {
      storage.removeItem(key)
      return null
    }
    return envelope.data
  } catch {
    return null
  }
}

export function writeDeviceCache<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS) {
  const storage = getStorage()
  if (!storage) return
  try {
    const envelope: CacheEnvelope<T> = {
      data: value,
      expiresAt: Date.now() + Math.max(ttlMs, 1000),
    }
    storage.setItem(key, JSON.stringify(envelope))
  } catch {
    // Swallow errors (storage full, private mode, etc.)
  }
}

export function clearDeviceCache(key: string) {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.removeItem(key)
  } catch {
    // ignore
  }
}

export function withDeviceCache<T>(key: string, producer: () => T, ttlMs?: number): T {
  const cached = readDeviceCache<T>(key)
  if (cached !== null) return cached
  const value = producer()
  writeDeviceCache(key, value, ttlMs)
  return value
}
