/**
 * Native device calendar (Phase 2) via @ebarooni/capacitor-calendar.
 * Stores C-Point event id → platform event id in Capacitor Preferences for replace/delete.
 */

import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

import type { CalendarExportEventFields } from './calendarExportTypes'

const STORAGE_KEY = 'cpoint_native_calendar_event_ids_v1'

function isNativeCapacitor(): boolean {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform()
}

function permOk(state: string): boolean {
  return state === 'granted' || state === 'limited'
}

async function loadIdMap(): Promise<Record<string, string>> {
  const { value } = await Preferences.get({ key: STORAGE_KEY })
  if (!value) return {}
  try {
    return JSON.parse(value) as Record<string, string>
  } catch {
    return {}
  }
}

export async function getStoredNativeCalendarEventId(cpointEventId: number): Promise<string | null> {
  if (!isNativeCapacitor()) return null
  const map = await loadIdMap()
  return map[String(cpointEventId)] ?? null
}

async function persistNativeCalendarEventId(cpointEventId: number, nativeEventId: string | null): Promise<void> {
  const map = await loadIdMap()
  const k = String(cpointEventId)
  if (nativeEventId) map[k] = nativeEventId
  else delete map[k]
  await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(map) })
}

function eventDeepLink(eventId: number): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/event/${eventId}`
  }
  return `https://app.c-point.co/event/${eventId}`
}

function parseYmd(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.slice(0, 10).split('-').map((x) => parseInt(x, 10))
  return { y, m: m - 1, d }
}

function parseHm(t: string | null | undefined): { h: number; min: number } | null {
  if (!t || t === '00:00' || t === '00:00:00') return null
  const s = t.includes(' ') ? (t.split(' ', 2)[1] ?? t).slice(0, 5) : t.slice(0, 5)
  const parts = s.split(':')
  const h = parseInt(parts[0] ?? '', 10)
  const min = parseInt(parts[1] ?? '0', 10)
  if (Number.isNaN(h) || h > 23 || min > 59) return null
  return { h, min }
}

/** Local wall times for calendar event (device timezone). */
export function eventToNativeRange(ev: CalendarExportEventFields): {
  startMs: number
  endMs: number
  isAllDay: boolean
} {
  const startDateStr = ev.date.length >= 10 ? ev.date.slice(0, 10) : ev.date
  const rawEnd = (ev.end_date && ev.end_date !== '0000-00-00' ? ev.end_date : '') || ''
  const endDateStr =
    rawEnd.length >= 10 && rawEnd.slice(0, 10) !== startDateStr ? rawEnd.slice(0, 10) : startDateStr

  const hmStart = parseHm(ev.start_time)
  const hmEnd = parseHm(ev.end_time)

  if (!hmStart && !hmEnd) {
    const s = parseYmd(startDateStr)
    const e = parseYmd(endDateStr)
    const startMs = new Date(s.y, s.m, s.d, 0, 0, 0, 0).getTime()
    const endExclusive = new Date(e.y, e.m, e.d, 0, 0, 0, 0)
    endExclusive.setDate(endExclusive.getDate() + 1)
    return { startMs, endMs: endExclusive.getTime(), isAllDay: true }
  }

  const s = parseYmd(startDateStr)
  const endPart = parseYmd(hmEnd ? endDateStr : startDateStr)
  const sh = hmStart!.h
  const sm = hmStart!.min
  const startMs = new Date(s.y, s.m, s.d, sh, sm, 0, 0).getTime()
  let endMs: number
  if (hmEnd) {
    endMs = new Date(endPart.y, endPart.m, endPart.d, hmEnd.h, hmEnd.min, 0, 0).getTime()
  } else {
    endMs = startMs + 60 * 60 * 1000
  }
  return { startMs, endMs, isAllDay: false }
}

let calendarModulePromise: Promise<typeof import('@ebarooni/capacitor-calendar')> | null = null

function loadCalendarPlugin(): Promise<typeof import('@ebarooni/capacitor-calendar')> {
  if (!calendarModulePromise) {
    calendarModulePromise = import('@ebarooni/capacitor-calendar')
  }
  return calendarModulePromise
}

type CapCal = Awaited<ReturnType<typeof loadCalendarPlugin>>['CapacitorCalendar']

function buildCreateEventPayload(
  snapshot: CalendarExportEventFields,
  calendarId?: string,
): Parameters<CapCal['createEvent']>[0] {
  const { startMs, endMs, isAllDay } = eventToNativeRange(snapshot)
  const payload: Parameters<CapCal['createEvent']>[0] = {
    title: snapshot.title || 'C-Point event',
    startDate: startMs,
    endDate: endMs,
    isAllDay,
  }
  const loc = snapshot.community_name?.trim()
  if (loc) payload.location = loc
  const notes = snapshot.description?.trim()
  if (notes) payload.notes = notes
  payload.url = eventDeepLink(snapshot.id)
  if (calendarId) payload.calendarId = calendarId
  return payload
}

/** Prefer default calendar if writable; else first writable calendar from listCalendars. */
async function resolveWritableCalendarId(CapacitorCalendar: CapCal): Promise<string | undefined> {
  try {
    const { result: defaultCal } = await CapacitorCalendar.getDefaultCalendar()
    if (defaultCal?.id && defaultCal.allowsContentModifications !== false) {
      return String(defaultCal.id)
    }
    const { result: list } = await CapacitorCalendar.listCalendars()
    const writable = list?.find((c) => c.allowsContentModifications !== false && c.id)
    if (writable?.id) return String(writable.id)
    if (defaultCal?.id) return String(defaultCal.id)
  } catch {
    /* ignore */
  }
  return undefined
}

/**
 * Create or replace the native calendar row for this C-Point event. Returns true if written natively.
 */
export async function tryWriteNativeDeviceCalendar(snapshot: CalendarExportEventFields): Promise<boolean> {
  if (!isNativeCapacitor()) return false
  try {
    const { CapacitorCalendar, PluginPermission } = await loadCalendarPlugin()
    const wr = await CapacitorCalendar.requestPermission({ alias: PluginPermission.WRITE_CALENDAR })
    const rd = await CapacitorCalendar.requestPermission({ alias: PluginPermission.READ_CALENDAR })
    if (!permOk(wr.result) || !permOk(rd.result)) return false

    const existing = await getStoredNativeCalendarEventId(snapshot.id)
    if (existing) {
      try {
        await CapacitorCalendar.deleteEventsById({ ids: [existing] })
      } catch {
        /* stale id */
      }
      await persistNativeCalendarEventId(snapshot.id, null)
    }

    const calendarId = await resolveWritableCalendarId(CapacitorCalendar)
    const payloadWithCal = buildCreateEventPayload(snapshot, calendarId)
    const payloadSansCal = buildCreateEventPayload(snapshot)

    let nativeId = (await CapacitorCalendar.createEvent(payloadWithCal)).result?.trim() ?? ''
    if (!nativeId && calendarId) {
      nativeId = (await CapacitorCalendar.createEvent(payloadSansCal)).result?.trim() ?? ''
    }

    if (!nativeId) {
      try {
        const { result: promptIds } = await CapacitorCalendar.createEventWithPrompt(payloadSansCal)
        nativeId = promptIds?.[0]?.trim() ?? ''
      } catch {
        /* user cancelled or sheet failed */
      }
    }

    if (nativeId) {
      await persistNativeCalendarEventId(snapshot.id, nativeId)
      return true
    }
    if (import.meta.env.DEV) {
      console.warn(
        '[native calendar] createEvent returned no id; falling back to .ics if used from exportEventToDeviceCalendar',
      )
    }
    return false
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[native calendar]', e)
    return false
  }
}

/** Remove native row when the C-Point event was deleted in-app. */
export async function removeNativeCalendarMirrorForCpointEvent(cpointEventId: number): Promise<void> {
  if (!isNativeCapacitor()) return
  try {
    const nativeId = await getStoredNativeCalendarEventId(cpointEventId)
    if (!nativeId) return
    const { CapacitorCalendar, PluginPermission } = await loadCalendarPlugin()
    const wr = await CapacitorCalendar.requestPermission({ alias: PluginPermission.WRITE_CALENDAR })
    if (!permOk(wr.result)) {
      await persistNativeCalendarEventId(cpointEventId, null)
      return
    }
    await CapacitorCalendar.deleteEventsById({ ids: [nativeId] })
  } catch {
    /* best effort */
  } finally {
    await persistNativeCalendarEventId(cpointEventId, null)
  }
}
