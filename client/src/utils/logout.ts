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
export async function unregisterPushBeforeLogout(): Promise<void> {
  try {
    const res = await fetch('/api/push/unregister_fcm', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!res.ok) {
      console.warn('unregister_fcm response:', res.status)
    } else {
      console.log('📴 All push tokens deactivated on server')
    }
  } catch (e) {
    console.warn('unregister_fcm failed:', e)
  }

  // On native (iOS/Android): clear delivered notifications from the notification tray
  // so the prior user's messages aren't visible to the next user on this device.
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (Capacitor.isNativePlatform()) {
      const { PushNotifications } = await import('@capacitor/push-notifications')
      await PushNotifications.removeAllDeliveredNotifications()
      console.log('📴 Native delivered notifications cleared')
    }
  } catch {
    // Not on native or plugin unavailable
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
        console.log('📴 Web push subscription removed')
      }
    }
  } catch (e) {
    console.warn('web push unsubscribe failed:', e)
  }

  try {
    const win = window as unknown as { __fcmToken?: string; __reregisterPushToken?: unknown }
    delete win.__fcmToken
    delete win.__reregisterPushToken
  } catch {
    /* ignore */
  }
}

export async function performLogout(): Promise<void> {
  console.log('🚪 Starting logout process...')

  try {
    const { Capacitor } = await import('@capacitor/core')
    if (Capacitor.isNativePlatform()) {
      const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth')
      await GoogleAuth.signOut()
    }
  } catch {}

  // Push first: session cookie, install cookie, and service worker must still be present.
  await unregisterPushBeforeLogout()

  await clearCapacitorStorage()

  await resetAccountScopedState({
    clearSessionStorage: true,
    unregisterServiceWorkers: true,
  })

  // Keep native_push_install_id until /logout so the server can match install-scoped rows.
  console.log('🚪 Navigating to /logout endpoint...')
  window.location.replace('/logout')
}
