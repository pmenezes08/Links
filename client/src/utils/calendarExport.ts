/**
 * Add a C-Point community event to the device: native calendar on Capacitor iOS/Android
 * when permitted, otherwise .ics download / Web Share (Phase 1 fallback).
 */

import { Capacitor } from '@capacitor/core'

import type { CalendarExportEventFields } from './calendarExportTypes'
import {
  getStoredNativeCalendarEventId,
  removeNativeCalendarMirrorForCpointEvent,
  tryWriteNativeDeviceCalendar,
} from './nativeDeviceCalendar'

export type { CalendarExportEventFields } from './calendarExportTypes'

async function fetchEventSnapshot(eventId: number): Promise<CalendarExportEventFields | null> {
  const r = await fetch(`/api/calendar_events/${eventId}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  const j = await r.json().catch(() => null)
  if (!j?.success || !j.event) return null
  const e = j.event
  return {
    id: Number(e.id),
    title: String(e.title ?? ''),
    date: String(e.date ?? ''),
    end_date: e.end_date ?? null,
    start_time: e.start_time ?? null,
    end_time: e.end_time ?? null,
    description: e.description ?? null,
    community_name: e.community_name ?? null,
  }
}

async function downloadIcsFile(eventId: number | string): Promise<void> {
  const id = String(eventId)
  const res = await fetch(`/api/calendar_events/${id}/ics`, {
    credentials: 'include',
    headers: { Accept: 'text/calendar, application/json' },
  })
  if (!res.ok) {
    let msg = 'Could not load calendar file.'
    try {
      const j = await res.json()
      if (j?.message) msg = j.message
      else if (j?.error) msg = j.error
    } catch {
      /* use default */
    }
    throw new Error(msg)
  }
  const blob = await res.blob()
  const filename = `cpoint-event-${id}.ics`
  const file = new File([blob], filename, { type: 'text/calendar' })
  try {
    if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Add to calendar' })
      return
    }
  } catch {
    /* fall through to download */
  }
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

function snapshotMatchesId(snap: CalendarExportEventFields, eventId: number): boolean {
  return Number(snap.id) === eventId
}

/**
 * @param snapshot Optional event fields (avoids extra API round-trip on native when already loaded).
 */
export async function exportEventToDeviceCalendar(
  eventId: number | string,
  snapshot?: CalendarExportEventFields | null,
): Promise<void> {
  const idNum = typeof eventId === 'string' ? parseInt(eventId, 10) : eventId
  if (Number.isNaN(idNum)) throw new Error('Invalid event id')

  const isNative = typeof window !== 'undefined' && Capacitor.isNativePlatform()
  if (isNative) {
    let snap = snapshot && snapshotMatchesId(snapshot, idNum) ? snapshot : null
    if (!snap) {
      snap = await fetchEventSnapshot(idNum)
    }
    if (snap) {
      const ok = await tryWriteNativeDeviceCalendar(snap)
      if (ok) return
    }
  }

  await downloadIcsFile(eventId)
}

/** After editing an event on the server, refresh the native mirror only if one was created earlier from the app. */
export async function syncNativeCalendarAfterServerChange(
  snapshot: CalendarExportEventFields | null | undefined,
): Promise<void> {
  if (!snapshot || typeof window === 'undefined' || !Capacitor.isNativePlatform()) return
  const had = await getStoredNativeCalendarEventId(snapshot.id)
  if (!had) return
  await tryWriteNativeDeviceCalendar(snapshot)
}

export { removeNativeCalendarMirrorForCpointEvent }
