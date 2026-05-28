import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

import { resetAccountScopedState } from './accountStateReset'
import { unregisterPushBeforeLogout } from './logout'

/**
 * Full client-side teardown used by account deletion (and logout parity).
 *
 * Wipes localStorage, sessionStorage, IndexedDB, Capacitor Preferences and all
 * service-worker caches, deactivates push tokens, and clears the server session.
 * After this resolves the app is in a true cold-start state, so the caller can
 * navigate to a fresh document immediately (no arbitrary delay needed).
 */
export async function clearAllUserData(): Promise<void> {
  console.log('🗑️ Clearing all user data...')

  // Deactivate push tokens while the session cookie is still valid.
  await unregisterPushBeforeLogout()

  // Clear any cached native Google Sign-In account so re-login is clean.
  try {
    if (Capacitor.isNativePlatform()) {
      const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth')
      await GoogleAuth.signOut()
    }
  } catch {
    /* GoogleAuth not initialised / not signed in — ignore */
  }

  try {
    if (Capacitor.isNativePlatform()) {
      await Preferences.clear()
      console.log('✅ Capacitor Preferences (native storage) cleared')
    }
  } catch (e) {
    console.warn('Error clearing Capacitor Preferences:', e)
  }

  await resetAccountScopedState({
    localStorageMode: 'all',
    clearSessionStorage: true,
    preserveSessionStorageKeys: [],
    cacheMode: 'all',
    unregisterServiceWorkers: true,
  })

  try {
    await fetch('/logout?_=' + Date.now(), {
      credentials: 'include',
      cache: 'no-store',
    })
    console.log('✅ Server session cleared via /logout')
  } catch (e) {
    console.warn('Error calling logout:', e)
  }
}
