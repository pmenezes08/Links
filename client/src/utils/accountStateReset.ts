import { VIEWER_SCOPED_LOCAL_STORAGE_PREFIXES } from './chatThreadsCache'
import { deleteCpointOfflineDatabase } from './offlineDb'

const SESSION_PRESERVE_ON_LOGOUT = ['cpoint_processed_deep_links'] as const

export const ACCOUNT_SCOPED_LOCAL_STORAGE_KEYS: readonly string[] = [
  'signal_device_id',
  'current_username',
  'encryption_keys_generated_at',
  'encryption_needs_sync',
  'encryption_reset_requested',
  'last_community_id',
  'mic_permission_granted',
  'home-timeline',
  'communityManagementShowNested',
  'cached_profile',
]

export const ACCOUNT_SCOPED_LOCAL_STORAGE_PREFIXES: readonly string[] = [
  'signal_',
  'chat_',
  'community_',
  'cpoint_',
  'onboarding_',
  'signal-store-',
  'dashboard-',
  'community-feed:',
  'group-feed:',
  'community-management:',
  'communities:',
  'ann_last_seen_',
  'docs_last_seen_',
  'docs_last_seen_group_',
  ...VIEWER_SCOPED_LOCAL_STORAGE_PREFIXES,
]

const LEGACY_ACCOUNT_INDEXED_DBS = [
  'chat-encryption',
  'signal-protocol',
  'signal-store',
] as const

type CacheResetMode = 'account' | 'all' | false
type LocalStorageResetMode = 'account' | 'all'

export interface AccountStateResetOptions {
  localStorageMode?: LocalStorageResetMode
  clearSessionStorage?: boolean
  preserveSessionStorageKeys?: readonly string[]
  clearIndexedDb?: boolean
  clearAvatarCache?: boolean
  cacheMode?: CacheResetMode
  unregisterServiceWorkers?: boolean
}

export function clearAccountScopedLocalStorage(mode: LocalStorageResetMode = 'account'): void {
  try {
    if (mode === 'all') {
      localStorage.clear()
      return
    }

    ACCOUNT_SCOPED_LOCAL_STORAGE_KEYS.forEach((key) => {
      try {
        localStorage.removeItem(key)
      } catch {
        /* ignore */
      }
    })

    Object.keys(localStorage).forEach((key) => {
      if (ACCOUNT_SCOPED_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        try {
          localStorage.removeItem(key)
        } catch {
          /* ignore */
        }
      }
    })
  } catch (e) {
    console.warn('Error clearing account-scoped localStorage:', e)
  }
}

export function clearSessionStorageForAccount(preserveKeys: readonly string[] = SESSION_PRESERVE_ON_LOGOUT): void {
  try {
    const preserved: Record<string, string> = {}
    for (const key of preserveKeys) {
      try {
        const value = sessionStorage.getItem(key)
        if (value != null) preserved[key] = value
      } catch {
        /* ignore */
      }
    }

    sessionStorage.clear()

    for (const [key, value] of Object.entries(preserved)) {
      try {
        sessionStorage.setItem(key, value)
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    console.warn('Error clearing sessionStorage:', e)
  }
}

async function deleteIndexedDbDatabase(dbName: string): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(dbName)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
      setTimeout(resolve, 1000)
    })
  } catch (e) {
    console.warn(`Error deleting IndexedDB ${dbName}:`, e)
  }
}

export async function clearAccountIndexedDb(): Promise<void> {
  await deleteCpointOfflineDatabase()
  await Promise.all(LEGACY_ACCOUNT_INDEXED_DBS.map((dbName) => deleteIndexedDbDatabase(dbName)))
}

export async function clearAccountCaches(mode: CacheResetMode = 'account'): Promise<void> {
  if (!mode) return

  try {
    if (!('caches' in window)) return
    const cacheNames = await caches.keys()
    const namesToDelete =
      mode === 'all'
        ? cacheNames
        : cacheNames.filter((cacheName) => cacheName.includes('runtime') || cacheName.includes('cp-'))

    await Promise.all(namesToDelete.map((cacheName) => caches.delete(cacheName)))
  } catch (e) {
    console.warn('Error clearing service worker caches:', e)
  }
}

export async function clearAccountAvatarCache(): Promise<void> {
  try {
    const { clearAllAvatarCache } = await import('./avatarCache')
    clearAllAvatarCache()
  } catch {
    /* ignore */
  }
}

export async function unregisterServiceWorkersForAccount(): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const registrations = await navigator.serviceWorker.getRegistrations()
    for (const registration of registrations) {
      await registration.unregister()
    }
  } catch (e) {
    console.warn('Error unregistering service workers:', e)
  }
}

export async function resetAccountScopedState(options: AccountStateResetOptions = {}): Promise<void> {
  const {
    localStorageMode = 'account',
    clearSessionStorage = false,
    preserveSessionStorageKeys = SESSION_PRESERVE_ON_LOGOUT,
    clearIndexedDb = true,
    clearAvatarCache = true,
    cacheMode = 'account',
    unregisterServiceWorkers = false,
  } = options

  clearAccountScopedLocalStorage(localStorageMode)

  if (clearSessionStorage) {
    clearSessionStorageForAccount(preserveSessionStorageKeys)
  }

  await Promise.all([
    clearIndexedDb ? clearAccountIndexedDb() : Promise.resolve(),
    clearAvatarCache ? clearAccountAvatarCache() : Promise.resolve(),
    clearAccountCaches(cacheMode),
    unregisterServiceWorkers ? unregisterServiceWorkersForAccount() : Promise.resolve(),
  ])
}
