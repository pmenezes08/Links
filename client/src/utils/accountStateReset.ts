/**
 * Unified, comprehensive client-side account-state reset.
 *
 * Account-isolation guarantee (PR 2). Every place we transition between
 * identities — explicit logout, post-logout redirect, login completion, or
 * the App.tsx login-epoch mismatch detector — funnels through
 * `resetAllAccountState` so we never get stuck with a partial wipe (e.g.
 * IndexedDB cleared but localStorage kept). The previous implementation in
 * `logout.ts` did this once, but `MobileLogin.finishSuccess` performed only
 * a fraction of the work; that drift is what allowed a previous account's
 * chat threads to bleed into a fresh Google sign-in.
 *
 * The module is the single source of truth for:
 *
 *   - the localStorage prefix purge list
 *   - the sessionStorage preserve list (deep-link dedupe)
 *   - the set of IndexedDB databases we own
 *   - the Cache Storage names that may hold user-scoped bytes
 *
 * Behaviour is intentionally fail-soft: every step is wrapped in try/catch
 * and logs at warn level. Account isolation must not regress just because
 * one cleanup leg threw on a particular browser (Firefox private mode,
 * Safari ITP variants, embedded webviews, etc.).
 */

import { VIEWER_SCOPED_LOCAL_STORAGE_PREFIXES } from './chatThreadsCache'

/** Explicit localStorage keys we always remove. */
export const PURGE_KEYS: readonly string[] = [
  'signal_device_id',
  'current_username',
  'last_login_id',
  'encryption_keys_generated_at',
  'encryption_needs_sync',
  'encryption_reset_requested',
  'last_community_id',
  'mic_permission_granted',
  'home-timeline',
  'communityManagementShowNested',
  'cached_profile',
] as const

/** localStorage prefixes we always remove. Keep in sync with the App.tsx purge list. */
export const PURGE_PREFIXES: readonly string[] = [
  'signal_',
  'chat_',
  'community_',
  'cpoint_',
  'onboarding_',
  'signal-store-',
  'dashboard-',
  'community-feed:',
  'group-feed:',
  ...VIEWER_SCOPED_LOCAL_STORAGE_PREFIXES,
] as const

/** sessionStorage keys we deliberately preserve across logout/account switch. */
const SESSION_PRESERVE_KEYS: readonly string[] = ['cpoint_processed_deep_links']

/** IndexedDB databases this app owns. */
const OWNED_INDEXED_DBS: readonly string[] = [
  'cpoint-offline',
  'chat-encryption',
  'signal-protocol',
  'signal-store',
]

export interface ResetAllAccountStateOptions {
  /**
   * If true (default), call `navigator.serviceWorker.getRegistrations()` and
   * unregister every worker so the next navigation re-fetches the shell
   * from the network. Set to false on login-epoch mismatch — we want the
   * SW to stay registered there, just with caches purged.
   */
  unregisterServiceWorkers?: boolean

  /**
   * If true (default), clear `Capacitor.Preferences` on native platforms.
   * Set to false from a context that still needs to read native prefs after
   * the reset (rarely useful — kept for symmetry).
   */
  clearCapacitorPreferences?: boolean

  /** Extra localStorage keys to preserve (rare; e.g. an A/B test bucket). */
  preserveKeys?: readonly string[]
}

async function clearLocalStorage(preserve: readonly string[]): Promise<void> {
  if (typeof localStorage === 'undefined') return
  const preserved = new Map<string, string>()
  for (const key of preserve) {
    try {
      const v = localStorage.getItem(key)
      if (v != null) preserved.set(key, v)
    } catch {}
  }

  try {
    for (const key of PURGE_KEYS) {
      try {
        localStorage.removeItem(key)
      } catch {}
    }

    // Use the standard Web Storage iteration (length + key(i)) instead of
    // `Object.keys`. The latter returns own-property names of the storage
    // object, which on some browsers (and on every Storage stub used in
    // tests) does NOT include the stored entries.
    const allKeys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k) allKeys.push(k)
    }
    for (const key of allKeys) {
      if (PURGE_PREFIXES.some((p) => key.startsWith(p))) {
        try {
          localStorage.removeItem(key)
        } catch {}
      }
    }
  } catch (err) {
    console.warn('[accountStateReset] localStorage purge failed', err)
  }

  for (const [key, val] of preserved) {
    try {
      localStorage.setItem(key, val)
    } catch {}
  }
}

async function clearSessionStorage(): Promise<void> {
  if (typeof sessionStorage === 'undefined') return
  try {
    const preserved = new Map<string, string>()
    for (const key of SESSION_PRESERVE_KEYS) {
      try {
        const v = sessionStorage.getItem(key)
        if (v != null) preserved.set(key, v)
      } catch {}
    }
    sessionStorage.clear()
    for (const [key, val] of preserved) {
      try {
        sessionStorage.setItem(key, val)
      } catch {}
    }
  } catch (err) {
    console.warn('[accountStateReset] sessionStorage clear failed', err)
  }
}

/**
 * Delete an IndexedDB database with two layers of insurance:
 *  1. We open it first so we can call `db.close()` — `deleteDatabase` blocks
 *     forever on Safari and some embedded webviews if any tab still holds
 *     a connection. Closing first avoids the silent `onblocked` hang that
 *     used to leave a previous user's offline DM rows around.
 *  2. After 1.5s without success/error, we resolve and move on. Account
 *     isolation must not block on a single misbehaving DB.
 */
async function deleteIndexedDb(name: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (!settled) {
          settled = true
          resolve()
        }
      }
      try {
        const openReq = indexedDB.open(name)
        openReq.onsuccess = () => {
          try {
            openReq.result.close()
          } catch {}
          const delReq = indexedDB.deleteDatabase(name)
          delReq.onsuccess = () => finish()
          delReq.onerror = () => finish()
          delReq.onblocked = () => finish()
        }
        openReq.onerror = () => {
          // Couldn't open (might not exist) — try delete anyway.
          const delReq = indexedDB.deleteDatabase(name)
          delReq.onsuccess = () => finish()
          delReq.onerror = () => finish()
          delReq.onblocked = () => finish()
        }
      } catch {
        finish()
      }
      setTimeout(finish, 1500)
    })
  } catch (err) {
    console.warn(`[accountStateReset] failed to delete IndexedDB ${name}`, err)
  }
}

async function clearIndexedDbs(): Promise<void> {
  // PR 3 will also call the offlineDb.deleteCpointOfflineDatabase helper
  // for the explicit close-then-delete dance with retry; that helper
  // already lives in `offlineDb.ts`. We keep using it here to avoid
  // duplicating its retry/fallback logic.
  try {
    const { deleteCpointOfflineDatabase } = await import('./offlineDb')
    await deleteCpointOfflineDatabase()
  } catch {}

  for (const name of OWNED_INDEXED_DBS) {
    if (name === 'cpoint-offline') continue // handled above
    await deleteIndexedDb(name)
  }
}

/**
 * Predicate: should we delete this Cache Storage bucket on account reset?
 *
 * Strategy: delete anything user-scoped, keep the app shell. We accept any
 * `cp-*` (current SW versions), any `runtime-*` (legacy SW), and any
 * unprefixed runtime cache an old build may have left behind. Only the
 * app-shell bucket survives so the next nav is fast offline.
 *
 * Exported for testing — vitest exercises the predicate directly.
 */
export function shouldPurgeCacheBucket(name: string): boolean {
  if (name.startsWith('cp-shell-')) return false
  if (name === 'app-shell' || name.startsWith('app-shell-')) return false
  return (
    name.startsWith('cp-') ||
    name.startsWith('runtime-') ||
    name.startsWith('cp-runtime-') ||
    name.startsWith('cp-media-')
  )
}

async function clearCacheStorage(): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    const names = await caches.keys()
    await Promise.all(
      names.filter(shouldPurgeCacheBucket).map((name) => caches.delete(name)),
    )
  } catch (err) {
    console.warn('[accountStateReset] cache storage purge failed', err)
  }
}

async function tellServiceWorkerToFlush(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.ready
    if (!reg.active) return
    await new Promise<void>((resolve) => {
      const requestId = `reset-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const onMsg = (ev: MessageEvent) => {
        if (ev.data?.type === 'CLEAR_USER_CACHES_COMPLETE' && ev.data?.requestId === requestId) {
          navigator.serviceWorker.removeEventListener('message', onMsg)
          resolve()
        }
      }
      navigator.serviceWorker.addEventListener('message', onMsg)
      try {
        reg.active!.postMessage({ type: 'CLEAR_USER_CACHES', requestId })
      } catch {
        navigator.serviceWorker.removeEventListener('message', onMsg)
        resolve()
      }
      setTimeout(() => {
        navigator.serviceWorker.removeEventListener('message', onMsg)
        resolve()
      }, 1500)
    })
  } catch (err) {
    console.warn('[accountStateReset] SW flush message failed', err)
  }
}

async function unregisterAllServiceWorkers(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((r) => r.unregister().catch(() => false)))
  } catch (err) {
    console.warn('[accountStateReset] SW unregister failed', err)
  }
}

async function clearCapacitorPreferences(): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.clear()
  } catch {
    /* not on native platform */
  }
}

async function clearGoogleAuthSession(): Promise<void> {
  // Sign out of the Capacitor Google Auth plugin so the next sign-in shows
  // the account picker rather than silently re-using the previous account.
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return
    const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth')
    await GoogleAuth.signOut()
  } catch {
    /* no-op on web */
  }
}

async function clearAvatarCache(): Promise<void> {
  try {
    const { clearAllAvatarCache } = await import('./avatarCache')
    clearAllAvatarCache()
  } catch {}
}

/**
 * Reset every piece of client-side state tied to a user identity.
 *
 * Order matters:
 *   1. Tell the SW to flush its caches first — that way any background
 *      revalidation racing the reset cannot repopulate them.
 *   2. Clear avatar cache, Google auth, Capacitor prefs.
 *   3. Wipe localStorage / sessionStorage.
 *   4. Delete IndexedDB databases (close first, then delete with timeout).
 *   5. Wipe Cache Storage directly as a belt-and-braces step.
 *   6. Optionally unregister all SWs so the next nav fetches a fresh shell.
 */
export async function resetAllAccountState(
  options: ResetAllAccountStateOptions = {},
): Promise<void> {
  const {
    unregisterServiceWorkers = true,
    clearCapacitorPreferences: shouldClearCap = true,
    preserveKeys = [],
  } = options

  await tellServiceWorkerToFlush()
  await clearAvatarCache()
  await clearGoogleAuthSession()
  if (shouldClearCap) {
    await clearCapacitorPreferences()
  }
  await clearLocalStorage(preserveKeys)
  await clearSessionStorage()
  await clearIndexedDbs()
  await clearCacheStorage()
  if (unregisterServiceWorkers) {
    await unregisterAllServiceWorkers()
  }

  try {
    document.cookie = 'native_push_install_id=; Max-Age=0; Path=/; SameSite=Lax'
  } catch {}
}
