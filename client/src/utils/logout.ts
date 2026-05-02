/**
 * `performLogout` — explicit user-initiated logout flow.
 *
 * Delegates the heavy lifting to `resetAllAccountState`, which is the
 * single source of truth for "wipe every byte tied to the previous
 * identity". This module's only remaining job is the network round-trip
 * to deactivate push tokens before the session cookie is cleared, then
 * navigating to `/logout` so the server can revoke the remember-me
 * token and stamp `Clear-Site-Data` (PR 1).
 *
 * NEVER reintroduce inline state-clearing here — past regressions came
 * from `MobileLogin.finishSuccess` and `App.applyProfileFromServer`
 * each maintaining their own divergent purge lists. All three paths now
 * funnel through `resetAllAccountState` so they cannot drift.
 */

import { resetAllAccountState } from './accountStateReset'

/** Deactivate server-side push mappings + browser subscription before session cookies are cleared. */
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
  console.log('[logout] starting')

  // 1. Push deactivation must run while the session cookie is still valid;
  // do it before resetAllAccountState wipes the SW.
  await unregisterPushBeforeLogout()

  // 2. Wipe everything client-side (localStorage / sessionStorage / IndexedDB
  // / Cache Storage / SW registration / Capacitor prefs / Google Auth).
  await resetAllAccountState({ unregisterServiceWorkers: true })

  // 3. Hand off to the server. /logout returns Clear-Site-Data + no-store
  // (PR 1) and redirects to /welcome. We use replace so the back button
  // cannot resurrect the dashboard.
  console.log('[logout] navigating to /logout')
  window.location.replace('/logout')
}
