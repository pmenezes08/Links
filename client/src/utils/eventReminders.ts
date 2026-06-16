// On-device reminders ~30 min before an event the user RSVP'd "going" to. Scheduled
// off the absolute `starts_at_utc` (never the local date+timezone strings), with a
// deterministic id per event so schedule/cancel are idempotent (an un-RSVP cancels
// cleanly, and an app-open sync re-schedules without duplicating).
import { Capacitor } from '@capacitor/core'

const REMINDER_OFFSET_MS = 30 * 60 * 1000
/** Local-notification ids must be 32-bit; event ids are small, namespaced into a band. */
const reminderId = (eventId: number) => 700000000 + (eventId % 1000000)

export interface ReminderEvent {
  id: number
  title?: string | null
  starts_at_utc?: string | null
  community_name?: string | null
}

async function ensureReady(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    if (Capacitor.getPlatform() === 'android') {
      try {
        await LocalNotifications.createChannel({ id: 'event-reminders', name: 'Event reminders', importance: 4 })
      } catch {
        /* channel may already exist */
      }
    }
    let p = await LocalNotifications.checkPermissions()
    if (p.display === 'prompt' || p.display === 'prompt-with-rationale') {
      p = await LocalNotifications.requestPermissions()
    }
    return p.display === 'granted'
  } catch {
    return false
  }
}

export async function scheduleEventReminder(e: ReminderEvent): Promise<void> {
  if (!Capacitor.isNativePlatform() || !e?.id || !e.starts_at_utc) return
  const startMs = Date.parse(e.starts_at_utc)
  if (Number.isNaN(startMs)) return
  const fireAt = new Date(startMs - REMINDER_OFFSET_MS)
  if (fireAt.getTime() <= Date.now()) return // too late / past
  if (!(await ensureReady())) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.schedule({
      notifications: [
        {
          id: reminderId(e.id),
          title: e.title || 'Upcoming event',
          body: `Starts in 30 minutes${e.community_name ? ' · ' + e.community_name : ''}`,
          schedule: { at: fireAt, allowWhileIdle: true },
          channelId: 'event-reminders',
          smallIcon: 'ic_stat_name',
          extra: { eventId: e.id, kind: 'event_reminder' },
        },
      ],
    })
  } catch {
    /* ignore */
  }
}

export async function cancelEventReminder(eventId: number): Promise<void> {
  if (!Capacitor.isNativePlatform() || !eventId) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: [{ id: reminderId(eventId) }] })
  } catch {
    /* ignore */
  }
}

/** Reconcile reminders from the user's current RSVPs (call on app open / resume). */
export async function syncEventReminders(goingEvents: ReminderEvent[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  for (const e of goingEvents) {
    await scheduleEventReminder(e)
  }
}
