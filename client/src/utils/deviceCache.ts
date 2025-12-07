const DEFAULT_TTL_MS = 3 * 60 * 1000 // 3 minutes
const DEFAULT_VERSION = 'v1'

type CacheEnvelope<T> = {
  data: T
  expiresAt: number
  version?: string
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

function getEnvelope<T>(key: string, version: string = DEFAULT_VERSION, { allowExpired }: { allowExpired?: boolean } = {}): { data: T | null; expired: boolean } {
  const storage = getStorage()
  if (!storage) return { data: null, expired: false }
  try {
    const raw = storage.getItem(key)
    if (!raw) return { data: null, expired: false }
    const envelope = JSON.parse(raw) as CacheEnvelope<T>
    if (!envelope || typeof envelope.expiresAt !== 'number') return { data: null, expired: false }
    if (envelope.version && envelope.version !== version) {
      storage.removeItem(key)
      return { data: null, expired: false }
    }
    const expired = envelope.expiresAt < Date.now()
    if (expired && !allowExpired) {
      storage.removeItem(key)
      return { data: null, expired: true }
    }
    return { data: envelope.data ?? null, expired }
  } catch {
    return { data: null, expired: false }
  }
}

export function readDeviceCache<T>(key: string, version: string = DEFAULT_VERSION): T | null {
  const { data } = getEnvelope<T>(key, version, { allowExpired: false })
  return data
}

export function readDeviceCacheStale<T>(key: string, version: string = DEFAULT_VERSION): { data: T | null; expired: boolean } {
  return getEnvelope<T>(key, version, { allowExpired: true })
}

export function writeDeviceCache<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS, version: string = DEFAULT_VERSION) {
  const storage = getStorage()
  if (!storage) return
  try {
    const envelope: CacheEnvelope<T> = {
      data: value,
      expiresAt: Date.now() + Math.max(ttlMs, 1000),
      version,
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

export function withDeviceCache<T>(key: string, producer: () => T, ttlMs?: number, version?: string): T {
  const cached = readDeviceCache<T>(key, version)
  if (cached !== null) return cached
  const value = producer()
  writeDeviceCache(key, value, ttlMs, version)
  return value
}
