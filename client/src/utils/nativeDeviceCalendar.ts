/**
 * Native device calendar (Phase 2) via @ebarooni/capacitor-calendar.
 * Stores C-Point event id → platform event id in Capacitor Preferences for replace/delete.
 */

import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

import type { CalendarExportEventFields } from './calendarExportTypes'

const STORAGE_KEY = 'cpoint_native_calendar_event_ids_v1'

const CALENDAR_ACCESS_DENIED_MSG =
  'Calendar access was not granted. You can enable it in the Settings app.'

function isNativeCapacitor(): boolean {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform()
}

/** Capacitor / plugin bridge may return a string or nested `{ result: ... }`. */
function normalizePermissionState(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'string') return raw.trim().toLowerCase()
  if (typeof raw === 'object' && raw !== null && 'result' in raw) {
    return normalizePermissionState((raw as { result: unknown }).result)
  }
  return ''
}

function permGranted(normalized: string): boolean {
  return (
    normalized === 'granted' ||
    normalized === 'limited' ||
    normalized === 'authorized' ||
    normalized === 'full'
  )
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

function pluginErrorMessage(err: unknown): string {
  if (typeof err === 'string' && err.trim()) return err.trim()
  if (err && typeof err === 'object' && 'message' in err && typeof (err as Error).message === 'string') {
    const m = (err as Error).message.trim()
    if (m) return m
  }
  return 'Could not save the event to your calendar.'
}

/** iOS: full calendar access via READ only. Android: WRITE then READ (separate runtime permissions). */
async function ensureCalendarPermissions(
  CapacitorCalendar: CapCal,
  PluginPermission: (typeof import('@ebarooni/capacitor-calendar'))['PluginPermission'],
): Promise<void> {
  if (Capacitor.getPlatform() === 'ios') {
    const rd = await CapacitorCalendar.requestPermission({ alias: PluginPermission.READ_CALENDAR })
    if (!permGranted(normalizePermissionState(rd.result))) {
      throw new Error(CALENDAR_ACCESS_DENIED_MSG)
    }
    return
  }
  const wr = await CapacitorCalendar.requestPermission({ alias: PluginPermission.WRITE_CALENDAR })
  if (!permGranted(normalizePermissionState(wr.result))) {
    throw new Error(CALENDAR_ACCESS_DENIED_MSG)
  }
  const rd = await CapacitorCalendar.requestPermission({ alias: PluginPermission.READ_CALENDAR })
  if (!permGranted(normalizePermissionState(rd.result))) {
    throw new Error(CALENDAR_ACCESS_DENIED_MSG)
  }
}

/** Prefer default calendar if writable; else first writable calendar from listCalendars. */
async function resolveWritableCalendarId(CapacitorCalendar: CapCal): Promise<string | undefined> {
  const { result: defaultCal } = await CapacitorCalendar.getDefaultCalendar()
  if (defaultCal && typeof defaultCal === 'object' && 'id' in defaultCal) {
    const cal = defaultCal as { id?: string; allowsContentModifications?: boolean }
    if (cal.id && cal.allowsContentModifications !== false) {
      return String(cal.id)
    }
  }
  const { result: list } = await CapacitorCalendar.listCalendars()
  const writable = list?.find((c) => c.allowsContentModifications !== false && c.id)
  if (writable?.id) return String(writable.id)
  if (defaultCal && typeof defaultCal === 'object' && 'id' in defaultCal) {
    const id = (defaultCal as { id?: string }).id
    if (id) return String(id)
  }
  return undefined
}

/**
 * Create or replace the native calendar row for this C-Point event. Returns true if written natively.
 * Throws on permission denial or native plugin errors. Returns false only to allow .ics fallback (no id).
 */
export async function tryWriteNativeDeviceCalendar(snapshot: CalendarExportEventFields): Promise<boolean> {
  if (!isNativeCapacitor()) return false

  const { CapacitorCalendar, PluginPermission } = await loadCalendarPlugin()
  await ensureCalendarPermissions(CapacitorCalendar, PluginPermission)

  const existing = await getStoredNativeCalendarEventId(snapshot.id)
  if (existing) {
    try {
      await CapacitorCalendar.deleteEventsById({ ids: [existing] })
    } catch {
      /* stale id */
    }
    await persistNativeCalendarEventId(snapshot.id, null)
  }

  const isIos = Capacitor.getPlatform() === 'ios'
  /** iOS: omit calendarId so EventKit uses defaultCalendarForNewEvents; a listed id can be read-only/subscribed and break saves. */
  const calendarId = isIos ? undefined : await resolveWritableCalendarId(CapacitorCalendar)
  const payloadWithCal = buildCreateEventPayload(snapshot, calendarId)
  const payloadSansCal = buildCreateEventPayload(snapshot)

  let nativeId = ''
  try {
    const firstPayload = isIos ? payloadSansCal : payloadWithCal
    nativeId = String((await CapacitorCalendar.createEvent(firstPayload)).result ?? '').trim()
  } catch (e) {
    throw new Error(pluginErrorMessage(e))
  }

  if (!nativeId && calendarId) {
    try {
      nativeId = String((await CapacitorCalendar.createEvent(payloadSansCal)).result ?? '').trim()
    } catch (e) {
      throw new Error(pluginErrorMessage(e))
    }
  }

  if (!nativeId) {
    try {
      const { result: promptIds } = await CapacitorCalendar.createEventWithPrompt(payloadSansCal)
      nativeId = String(promptIds?.[0] ?? '').trim()
    } catch (e) {
      throw new Error(pluginErrorMessage(e))
    }
  }

  if (nativeId) {
    await persistNativeCalendarEventId(snapshot.id, nativeId)
    return true
  }

  if (import.meta.env.DEV) {
    console.warn(
      '[native calendar] no event id from native create; falling back to .ics in exportEventToDeviceCalendar',
    )
  }
  return false
}

/** Remove native row when the C-Point event was deleted in-app. */
export async function removeNativeCalendarMirrorForCpointEvent(cpointEventId: number): Promise<void> {
  if (!isNativeCapacitor()) return
  try {
    const nativeId = await getStoredNativeCalendarEventId(cpointEventId)
    if (!nativeId) return
    const { CapacitorCalendar, PluginPermission } = await loadCalendarPlugin()
    const wr = await CapacitorCalendar.requestPermission({ alias: PluginPermission.WRITE_CALENDAR })
    if (!permGranted(normalizePermissionState(wr.result))) {
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
