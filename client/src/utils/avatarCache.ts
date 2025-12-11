/**
 * Avatar Cache - Prevents constant re-fetching of profile pictures
 * 
 * Uses a combination of:
 * 1. In-memory cache for instant access during session
 * 2. localStorage for URL-to-URL mapping persistence
 * 3. Browser's native image caching with cache-busting only when URL changes
 */

const AVATAR_CACHE_KEY = 'avatar-url-cache'
const AVATAR_CACHE_VERSION = 'v1'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

type AvatarCacheEntry = {
  originalUrl: string
  cachedAt: number
}

type AvatarCache = {
  version: string
  entries: Record<string, AvatarCacheEntry>
}

// In-memory cache for instant access (blob URLs for loaded images)
const memoryCache = new Map<string, string>()

// Track which URLs are currently being loaded to prevent duplicate fetches
const loadingPromises = new Map<string, Promise<string>>()

// Track URLs that have been verified this session (no need to re-verify)
const verifiedUrls = new Set<string>()

function getStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function loadCache(): AvatarCache {
  const storage = getStorage()
  if (!storage) return { version: AVATAR_CACHE_VERSION, entries: {} }
  
  try {
    const raw = storage.getItem(AVATAR_CACHE_KEY)
    if (!raw) return { version: AVATAR_CACHE_VERSION, entries: {} }
    
    const parsed = JSON.parse(raw) as AvatarCache
    if (parsed.version !== AVATAR_CACHE_VERSION) {
      storage.removeItem(AVATAR_CACHE_KEY)
      return { version: AVATAR_CACHE_VERSION, entries: {} }
    }
    
    // Clean up expired entries
    const now = Date.now()
    const cleaned: Record<string, AvatarCacheEntry> = {}
    Object.entries(parsed.entries).forEach(([key, entry]) => {
      if (now - entry.cachedAt < CACHE_TTL_MS) {
        cleaned[key] = entry
      }
    })
    
    return { version: AVATAR_CACHE_VERSION, entries: cleaned }
  } catch {
    return { version: AVATAR_CACHE_VERSION, entries: {} }
  }
}

function saveCache(cache: AvatarCache) {
  const storage = getStorage()
  if (!storage) return
  
  try {
    storage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Storage full or unavailable - ignore
  }
}

/**
 * Get a cache key for a username
 */
function getCacheKey(username: string): string {
  return username.toLowerCase()
}

/**
 * Check if we have a cached URL for this user that matches the current URL
 * Returns true if the URL is unchanged (can use browser cache)
 */
export function isAvatarCached(username: string, currentUrl: string): boolean {
  const key = getCacheKey(username)
  
  // Check in-memory first
  if (verifiedUrls.has(`${key}:${currentUrl}`)) {
    return true
  }
  
  // Check localStorage
  const cache = loadCache()
  const entry = cache.entries[key]
  
  if (entry && entry.originalUrl === currentUrl) {
    // URL matches - mark as verified for this session
    verifiedUrls.add(`${key}:${currentUrl}`)
    return true
  }
  
  return false
}

/**
 * Mark a URL as cached for a username
 */
export function cacheAvatarUrl(username: string, url: string) {
  const key = getCacheKey(username)
  
  // Update in-memory
  verifiedUrls.add(`${key}:${url}`)
  
  // Update localStorage
  const cache = loadCache()
  cache.entries[key] = {
    originalUrl: url,
    cachedAt: Date.now(),
  }
  saveCache(cache)
}

/**
 * Get the cached URL for a username (if different from current, triggers re-fetch)
 */
export function getCachedAvatarUrl(username: string): string | null {
  const key = getCacheKey(username)
  const cache = loadCache()
  const entry = cache.entries[key]
  return entry?.originalUrl || null
}

/**
 * Clear cache for a specific user (call when profile picture is updated)
 */
export function clearAvatarCache(username: string) {
  const key = getCacheKey(username)
  
  // Clear from memory
  memoryCache.delete(key)
  verifiedUrls.forEach(v => {
    if (v.startsWith(`${key}:`)) {
      verifiedUrls.delete(v)
    }
  })
  
  // Clear from localStorage
  const cache = loadCache()
  delete cache.entries[key]
  saveCache(cache)
}

/**
 * Preload an avatar image and cache the blob URL
 * Returns a blob URL for the image that can be used without network requests
 */
export async function preloadAvatar(url: string, username: string): Promise<string> {
  const key = getCacheKey(username)
  
  // Return from memory cache if available
  const cached = memoryCache.get(key)
  if (cached) {
    return cached
  }
  
  // If already loading, wait for that promise
  const loading = loadingPromises.get(key)
  if (loading) {
    return loading
  }
  
  // Start loading
  const promise = (async () => {
    try {
      const response = await fetch(url, { 
        credentials: 'include',
        cache: 'force-cache' // Use browser cache if available
      })
      
      if (!response.ok) {
        throw new Error(`Failed to load avatar: ${response.status}`)
      }
      
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      
      // Store in memory cache
      memoryCache.set(key, blobUrl)
      
      // Mark as cached
      cacheAvatarUrl(username, url)
      
      return blobUrl
    } catch (error) {
      // On error, just return the original URL
      console.warn(`Failed to preload avatar for ${username}:`, error)
      return url
    } finally {
      loadingPromises.delete(key)
    }
  })()
  
  loadingPromises.set(key, promise)
  return promise
}

/**
 * Get avatar URL with cache awareness
 * If URL hasn't changed since last cache, returns a cache-friendly version
 */
export function getAvatarUrl(username: string, url: string | null | undefined): string | null {
  if (!url) return null
  
  const key = getCacheKey(username)
  
  // Check memory cache first
  const memCached = memoryCache.get(key)
  if (memCached) {
    return memCached
  }
  
  // If URL is cached and unchanged, browser will use its cache
  if (isAvatarCached(username, url)) {
    return url
  }
  
  // New or changed URL - cache it for future reference
  cacheAvatarUrl(username, url)
  return url
}

/**
 * Cleanup function to revoke blob URLs when they're no longer needed
 * Call this when the app unmounts or periodically to prevent memory leaks
 */
export function cleanupAvatarCache() {
  memoryCache.forEach((blobUrl) => {
    try {
      URL.revokeObjectURL(blobUrl)
    } catch {
      // ignore
    }
  })
  memoryCache.clear()
}
