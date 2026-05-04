/**
 * Proper logout utility that clears all client-side state before navigating to /logout
 */

import { resetAccountScopedState } from './accountStateReset'

// Dynamic import for Capacitor to avoid issues on web
async function clearCapacitorStorage(): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (Capacitor.isNativePlatform()) {
      const { Preferences } = await import('@capacitor/preferences')
      await Preferences.clear()
      console.log('✅ Capacitor Preferences cleared')
    }
  } catch (e) {
    // Not on native platform or Capacitor not available
    console.log('Capacitor not available or not on native platform')
  }
}

/** Deactivate server-side push mappings and browser subscription before session cookies are cleared. */
async function unregisterPushBeforeLogout(): Promise<void> {
  const w = typeof window !== 'undefined' ? (window as unknown as { __fcmToken?: string }) : null
  const fcmToken = w?.__fcmToken?.trim() || ''

  try {
    const res = await fetch('/api/push/unregister_fcm', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: fcmToken }),
    })
    if (!res.ok) {
      console.warn('unregister_fcm response:', res.status)
    }
  } catch (e) {
    console.warn('unregister_fcm failed:', e)
  }

  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        const endpoint = sub.endpoint
        await fetch('/api/push/unsubscribe_web', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        })
        await sub.unsubscribe()
      }
    }
  } catch (e) {
    console.warn('web push unsubscribe failed:', e)
  }
}

export async function performLogout(): Promise<void> {
  console.log('🚪 Starting logout process...')
  
  // 0. Clear Google Sign-In cached account (so next sign-in shows account picker)
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (Capacitor.isNativePlatform()) {
      const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth')
      await GoogleAuth.signOut()
    }
  } catch {}

  // 0a. Clear Capacitor native storage first (critical for iOS apps)
  await clearCapacitorStorage()

  await resetAccountScopedState({
    clearSessionStorage: true,
    unregisterServiceWorkers: true,
  })

  // Expire native push install id cookie client-side (server also clears on /logout)
  try {
    document.cookie = 'native_push_install_id=; Max-Age=0; Path=/; SameSite=Lax'
  } catch {
    /* ignore */
  }

  // 6. Unregister push tokens while session cookie is still valid (stops post-logout notifications)
  await unregisterPushBeforeLogout()

  // 7. Clear any cached data in memory by reloading the page after logout
  console.log('🚪 Navigating to /logout endpoint...')

  // Navigate to logout endpoint - use replace to prevent back button issues
  window.location.replace('/logout')
}
