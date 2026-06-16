import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { apiFetch } from '../utils/apiFetch'
import { syncEventReminders, type ReminderEvent } from '../utils/eventReminders'

// Reconcile on-device event reminders with the user's "going" RSVPs on app open and on
// every native resume, so reminders survive reinstall/reboot and reflect RSVPs made on
// other devices (scheduleEventReminder is idempotent per event id). No-op on web — there
// are no local notifications there — and we skip the network call entirely off-device.
export function useEventReminderSync(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !Capacitor.isNativePlatform()) return
    let cancelled = false
    let resumeListener: { remove: () => void } | null = null

    const run = async () => {
      try {
        const r = await apiFetch('/api/all_calendar_events', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const j = await r.json().catch(() => null)
        if (cancelled || !j?.success || !Array.isArray(j.events)) return
        const going: ReminderEvent[] = j.events
          .filter((e: any) => e?.user_rsvp === 'going' && e?.starts_at_utc)
          .map((e: any) => ({
            id: e.id,
            title: e.title,
            starts_at_utc: e.starts_at_utc,
            community_name: e.community_name,
          }))
        await syncEventReminders(going)
      } catch {
        /* offline / not ready — the next resume retries */
      }
    }

    void run()
    CapacitorApp.addListener('resume', () => { void run() })
      .then(l => { if (cancelled) l.remove(); else resumeListener = l })
      .catch(() => {})

    return () => {
      cancelled = true
      resumeListener?.remove()
    }
  }, [enabled])
}
