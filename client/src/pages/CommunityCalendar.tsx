import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import { useHeader } from '../contexts/HeaderContext'
import i18n, { normalizeLocale } from '../i18n'
import { exportEventToDeviceCalendar, removeNativeCalendarMirrorForCpointEvent, syncNativeCalendarAfterServerChange } from '../utils/calendarExport'
import type { CalendarExportEventFields } from '../utils/calendarExportTypes'

function calendarLocale() {
  return normalizeLocale(i18n.language)
}

type EventItem = {
  id: number
  title: string
  date: string
  community_id?: number | string
  end_date?: string | null
  start_time?: string | null
  end_time?: string | null
  timezone?: string | null
  starts_at_utc?: string | null
  ends_at_utc?: string | null
  meeting_url?: string | null
  description?: string | null
  user_rsvp?: RSVPResponse | null
  rsvp_counts?: {
    going: number
    maybe: number
    not_going: number
    no_response?: number
  }
}

type RSVPResponse = 'going' | 'maybe' | 'not_going'
type CalendarTab = 'upcoming' | 'archive'
type CreateStep = 'details' | 'invite'

function eventItemToExportFields(event: EventItem): CalendarExportEventFields {
  return {
    id: event.id,
    title: event.title,
    date: event.date,
    end_date: event.end_date ?? null,
    start_time: event.start_time ?? null,
    end_time: event.end_time ?? null,
    description: event.description ?? null,
    community_name: null,
    timezone: event.timezone ?? null,
    starts_at_utc: event.starts_at_utc ?? null,
    ends_at_utc: event.ends_at_utc ?? null,
    meeting_url: event.meeting_url ?? null,
  }
}

type Member = {
  username: string
  profile_picture?: string | null
}

const COMMON_TIMEZONE_VALUES = [
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Athens',
  'Europe/Helsinki',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Africa/Casablanca',
  'Africa/Johannesburg',
  'Africa/Cairo',
  'Asia/Dubai',
  'Asia/Jerusalem',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
] as const

type TimeZoneOption = {
  value: string
  label: string
  searchText: string
}

function supportedTimeZoneValues(): string[] {
  const values = new Set<string>(['UTC'])
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
    if (typeof fn === 'function') {
      fn('timeZone').forEach((tz) => values.add(tz))
    }
  } catch {
    /* Fall back to the common zones below. */
  }
  COMMON_TIMEZONE_VALUES.forEach((tz) => values.add(tz))
  return Array.from(values)
}

function timeZoneCity(tz: string): string {
  const parts = tz.split('/')
  return (parts[parts.length - 1] || tz).replace(/_/g, ' ')
}

function timeZoneRegion(tz: string): string {
  if (tz === 'UTC') return 'UTC'
  return (tz.split('/')[0] || 'Other').replace(/_/g, ' ')
}

function timeZoneOptionLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      timeZoneName: 'longOffset',
    }).formatToParts(new Date())
    const off = parts.find((p) => p.type === 'timeZoneName')?.value || ''
    return `${off} - ${timeZoneCity(tz)} (${tz})`
  } catch {
    return tz
  }
}

function timeZoneOption(tz: string): TimeZoneOption {
  const label = timeZoneOptionLabel(tz)
  return {
    value: tz,
    label,
    searchText: `${label} ${tz} ${timeZoneRegion(tz)} ${timeZoneCity(tz)}`.toLowerCase(),
  }
}

function buildTimeZoneOptions(currentTz?: string | null): TimeZoneOption[] {
  const pinned = new Set<string>()
  COMMON_TIMEZONE_VALUES.forEach((tz) => pinned.add(tz))
  if (currentTz) pinned.add(currentTz)

  const common = Array.from(pinned).map(timeZoneOption)
  const supported = supportedTimeZoneValues()
    .filter((tz) => !pinned.has(tz))
    .map(timeZoneOption)
    .sort((a, b) => a.label.localeCompare(b.label))

  return [...common, ...supported]
}

const INPUT_CLASS = 'mt-1 w-full rounded-xl border border-c-border bg-c-bg-app/70 px-3 py-2 text-[16px] text-c-text-primary outline-none transition focus:border-cpoint-turquoise/80 focus:ring-2 focus:ring-cpoint-turquoise/20'
const LABEL_CLASS = 'text-xs font-medium text-c-text-tertiary'

function isBlankTime(value?: string | null) {
  return !value || value === 'None' || value === '00:00' || value === '00:00:00' || value === '0000-00-00 00:00:00'
}

function isBlankDate(value?: string | null) {
  return !value || value === 'None' || value === '0000-00-00'
}

function normalizeTime(value?: string | null) {
  if (isBlankTime(value)) return ''
  const raw = String(value)
  if (raw.includes(' ')) return raw.split(' ')[1]?.slice(0, 5) || ''
  return raw.slice(0, 5)
}

function buildEventDateTime(event: EventItem, preferEnd = false) {
  const date = preferEnd && !isBlankDate(event.end_date) ? event.end_date! : event.date
  const time = preferEnd ? normalizeTime(event.end_time) || normalizeTime(event.start_time) : normalizeTime(event.start_time)
  const iso = time ? `${date}T${time}:00` : `${date}T${preferEnd ? '23:59:59' : '00:00:00'}`
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? new Date(`${event.date}T23:59:59`) : parsed
}

function isPastEvent(event: EventItem) {
  return buildEventDateTime(event, true).getTime() < Date.now()
}

function formatDateLabel(date: string, variant: 'short' | 'long' = 'long') {
  const parsed = new Date(`${date}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat(calendarLocale(), {
    weekday: variant === 'long' ? 'long' : 'short',
    month: variant === 'long' ? 'long' : 'short',
    day: 'numeric',
  }).format(parsed)
}

function formatMonth(date: string) {
  const parsed = new Date(`${date}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat(calendarLocale(), { month: 'short' }).format(parsed).toUpperCase()
}

function formatDay(date: string) {
  const parsed = new Date(`${date}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return '--'
  return new Intl.DateTimeFormat(calendarLocale(), { day: '2-digit' }).format(parsed)
}

function formatTimeRange(event: EventItem) {
  const start = normalizeTime(event.start_time)
  const end = normalizeTime(event.end_time)
  const range = [start, end].filter(Boolean).join(' - ')
  return range && event.timezone ? `${range} ${event.timezone}` : range || i18n.t('calendar.all_day')
}

function formatDateRange(event: EventItem) {
  if (!isBlankDate(event.end_date) && event.end_date !== event.date) {
    return `${formatDateLabel(event.date, 'short')} - ${formatDateLabel(event.end_date!, 'short')}`
  }
  return formatDateLabel(event.date)
}

function getCountdownLabel(event?: EventItem | null) {
  if (!event) return ''
  const diff = buildEventDateTime(event).getTime() - Date.now()
  if (diff <= 0) return i18n.t('calendar.starting_soon')
  const minutes = Math.ceil(diff / 60000)
  if (minutes < 60) return i18n.t('calendar.countdown_minutes', { count: minutes })
  const hours = Math.ceil(minutes / 60)
  if (hours < 48) return i18n.t('calendar.countdown_hours', { count: hours })
  return i18n.t('calendar.countdown_days', { count: Math.ceil(hours / 24) })
}

function toUtcFormFields(formData: FormData) {
  const params = new URLSearchParams()
  const append = (name: string, value?: string | null) => {
    if (value) params.append(name, value)
  }

  append('title', String(formData.get('title') || '').trim())
  append('description', String(formData.get('description') || '').trim())
  append('meeting_url', String(formData.get('meeting_url') || '').trim())
  append('timezone', String(formData.get('timezone') || ''))
  append('notification_preferences', String(formData.get('notification_preferences') || 'all'))
  append('date', String(formData.get('date') || ''))
  append('start_time', String(formData.get('start_time') || ''))
  append('end_date', String(formData.get('end_date') || ''))
  append('end_time', String(formData.get('end_time') || ''))

  return params
}

function EventFormFields({ event }: { event?: EventItem }) {
  const { t } = useTranslation()
  const defaultTimezone = event?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const [timezoneSearch, setTimezoneSearch] = useState('')
  const [selectedTimezone, setSelectedTimezone] = useState(defaultTimezone)
  const timezoneOptions = useMemo(() => buildTimeZoneOptions(selectedTimezone), [selectedTimezone])
  const normalizedTimezoneSearch = timezoneSearch.trim().toLowerCase()
  const visibleTimezoneOptions = useMemo(() => {
    if (!normalizedTimezoneSearch) {
      return timezoneOptions.filter((option) => COMMON_TIMEZONE_VALUES.includes(option.value as typeof COMMON_TIMEZONE_VALUES[number]) || option.value === selectedTimezone)
    }
    return timezoneOptions
      .filter((option) => option.value === selectedTimezone || option.searchText.includes(normalizedTimezoneSearch))
      .slice(0, 80)
  }, [normalizedTimezoneSearch, selectedTimezone, timezoneOptions])

  return (
    <div className="grid grid-cols-2 gap-2.5">
      <label className={`col-span-2 ${LABEL_CLASS}`}>{t('calendar.title_label')}
        <input name="title" defaultValue={event?.title || ''} className={INPUT_CLASS} required placeholder={t('calendar.title_placeholder')} />
      </label>
      <label className={LABEL_CLASS}>{t('calendar.start_date')}
        <input name="date" type="date" defaultValue={event?.date || ''} className={INPUT_CLASS} required />
      </label>
      <label className={LABEL_CLASS}>{t('calendar.end_date')}
        <input name="end_date" type="date" defaultValue={event?.end_date || ''} className={INPUT_CLASS} />
      </label>
      <label className={LABEL_CLASS}>{t('calendar.start_time')}
        <input name="start_time" type="time" defaultValue={normalizeTime(event?.start_time)} className={INPUT_CLASS} />
      </label>
      <label className={LABEL_CLASS}>{t('calendar.end_time')}
        <input name="end_time" type="time" defaultValue={normalizeTime(event?.end_time)} className={INPUT_CLASS} />
      </label>
      <label className={`col-span-2 ${LABEL_CLASS}`}>{t('calendar.timezone')}
        <input
          type="search"
          value={timezoneSearch}
          onChange={(e) => setTimezoneSearch(e.target.value)}
          className={INPUT_CLASS}
          placeholder={t('calendar.search_timezone')}
          autoComplete="off"
        />
        <select name="timezone" value={selectedTimezone} onChange={(e) => setSelectedTimezone(e.target.value)} className={INPUT_CLASS} required>
          <option value="">{t('calendar.select_timezone')}</option>
          {visibleTimezoneOptions.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </select>
        <span className="mt-2 block text-[11px] font-normal normal-case tracking-normal text-c-text-tertiary">{t('calendar.timezone_search_hint')}</span>
      </label>
      <label className={`col-span-2 ${LABEL_CLASS}`}>{t('calendar.description')}
        <textarea name="description" defaultValue={event?.description || ''} rows={3} className={INPUT_CLASS} placeholder={t('calendar.description_placeholder')} />
      </label>
      <label className={`col-span-2 ${LABEL_CLASS}`}>{t('calendar.meeting_link')}
        <input name="meeting_url" type="url" inputMode="url" defaultValue={event?.meeting_url || ''} className={INPUT_CLASS} placeholder={t('calendar.meeting_link_placeholder')} />
        <span className="mt-2 block text-[11px] font-normal normal-case tracking-normal text-c-text-tertiary">{t('calendar.meeting_link_hint')}</span>
      </label>
      {!event ? (
        <label className={`col-span-2 ${LABEL_CLASS}`}>{t('calendar.reminders')}
          <select name="notification_preferences" defaultValue="all" className={INPUT_CLASS}>
            <option value="none">{t('calendar.reminder_none')}</option>
            <option value="1_week">{t('calendar.reminder_1_week')}</option>
            <option value="1_day">{t('calendar.reminder_1_day')}</option>
            <option value="1_hour">{t('calendar.reminder_1_hour')}</option>
            <option value="all">{t('calendar.reminder_all')}</option>
          </select>
          <span className="mt-2 block text-[11px] font-normal normal-case tracking-normal text-c-text-tertiary">{t('calendar.reminders_hint')}</span>
        </label>
      ) : null}
    </div>
  )
}

type EventCardProps = {
  event: EventItem
  archived?: boolean
  onOpen: (event: EventItem) => void
  onRsvp: (eventId: number, response: RSVPResponse) => void
  onShowDetails: (event: EventItem) => void
  onEdit: (event: EventItem) => void
  onDelete: (event: EventItem) => void
  onNativeCalendarSaved?: () => void
}

function EventCard({ event, archived = false, onOpen, onRsvp, onShowDetails, onEdit, onDelete, onNativeCalendarSaved }: EventCardProps) {
  const { t } = useTranslation()
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-c-border bg-c-bg-surface p-3 shadow-c-card backdrop-blur-xl transition hover:border-cpoint-turquoise/45 hover:bg-c-hover-bg">
      <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-cpoint-turquoise/70 to-transparent" />
      <button type="button" className="w-full text-left" onClick={() => onOpen(event)}>
        <div className="flex items-start gap-2.5">
          <div className="grid h-12 w-11 shrink-0 place-items-center rounded-xl border border-cpoint-turquoise/35 bg-cpoint-turquoise/10 text-center">
            <div>
              <div className="text-[9px] font-bold tracking-[0.16em] text-cpoint-turquoise">{formatMonth(event.date)}</div>
              <div className="text-lg font-semibold leading-tight text-c-text-primary">{formatDay(event.date)}</div>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-c-text-tertiary">
              <span>{formatTimeRange(event)}</span>
              {archived ? <span className="rounded-full border border-c-border px-2 py-0.5 normal-case tracking-normal">{t('calendar.archived')}</span> : null}
            </div>
            <h3 className="mt-0.5 line-clamp-2 text-base font-semibold text-c-text-primary">{event.title}</h3>
            <p className="mt-0.5 text-xs text-c-text-secondary">{formatDateRange(event)}</p>
            {event.description ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-c-text-secondary">{event.description}</p> : null}
          </div>
        </div>
      </button>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-c-text-secondary" onClick={clickEvent => clickEvent.stopPropagation()}>
        <button type="button" className={`rounded-full border px-2.5 py-1 transition ${event.user_rsvp === 'going' ? 'border-cpoint-turquoise bg-cpoint-turquoise/15 text-c-accent-ink' : 'border-c-border hover:border-cpoint-turquoise/45 hover:text-c-text-primary'}`} onClick={() => onRsvp(event.id, 'going')}>
          {t('calendar.going')} {event.rsvp_counts?.going || 0}
        </button>
        <button type="button" className={`rounded-full border px-2.5 py-1 transition ${event.user_rsvp === 'maybe' ? 'border-cpoint-turquoise bg-cpoint-turquoise/15 text-c-accent-ink' : 'border-c-border hover:border-cpoint-turquoise/45 hover:text-c-text-primary'}`} onClick={() => onRsvp(event.id, 'maybe')}>
          {t('calendar.maybe')} {event.rsvp_counts?.maybe || 0}
        </button>
        <button type="button" className={`rounded-full border px-2.5 py-1 transition ${event.user_rsvp === 'not_going' ? 'border-cpoint-turquoise bg-cpoint-turquoise/15 text-c-accent-ink' : 'border-c-border hover:border-cpoint-turquoise/45 hover:text-c-text-primary'}`} onClick={() => onRsvp(event.id, 'not_going')}>
          {t('calendar.not_going')} {event.rsvp_counts?.not_going || 0}
        </button>
        <button type="button" className="ml-auto rounded-full border border-c-border px-2.5 py-1 hover:border-cpoint-turquoise/45 hover:text-c-text-primary" onClick={() => onShowDetails(event)}>
          {t('calendar.details')}
        </button>
        <button
          type="button"
          className="rounded-full border border-c-border px-2.5 py-1 hover:border-cpoint-turquoise/45 hover:text-c-text-primary"
          onClick={(e) => {
            e.stopPropagation()
            void (async () => {
              try {
                const outcome = await exportEventToDeviceCalendar(event.id, eventItemToExportFields(event))
                if (outcome.via === 'native') onNativeCalendarSaved?.()
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : t('calendar.could_not_export')
                alert(msg)
              }
            })()
          }}
          aria-label={t('calendar.add_to_device_calendar')}
          title={t('calendar.add_to_device_calendar')}
        >
          <i className="fa-regular fa-calendar-plus" />
        </button>
        {!archived ? (
          <>
            <button type="button" className="rounded-full border border-c-border px-2.5 py-1 hover:border-cpoint-turquoise/45 hover:text-c-text-primary" onClick={() => onEdit(event)} aria-label={t('calendar.edit_event_aria')}>
              <i className="fa-regular fa-pen-to-square" />
            </button>
            <button type="button" className="rounded-full border border-red-400/45 px-2.5 py-1 text-red-200 hover:bg-red-500/10" onClick={() => onDelete(event)} aria-label={t('calendar.delete_event_card_aria')}>
              <i className="fa-regular fa-trash-can" />
            </button>
          </>
        ) : null}
      </div>
    </article>
  )
}

export default function CommunityCalendar() {
  const { t } = useTranslation()
  const { community_id } = useParams()
  const [searchParams] = useSearchParams()
  const groupId = searchParams.get('group_id')
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const createFormRef = useRef<HTMLFormElement | null>(null)

  const [events, setEvents] = useState<EventItem[]>([])
  const [archivedEvents, setArchivedEvents] = useState<EventItem[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<CalendarTab>('upcoming')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createStep, setCreateStep] = useState<CreateStep>('details')
  const [inviteAll, setInviteAll] = useState(false)
  const [selectedMembers, setSelectedMembers] = useState<Record<string, boolean>>({})
  const [rsvpEvent, setRsvpEvent] = useState<EventItem | null>(null)
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const keyboardOffsetRef = useRef(0)
  const focusedFieldRef = useRef<HTMLElement | null>(null)
  const isNativePlatform = useMemo(() => typeof window !== 'undefined' && Capacitor.getPlatform() !== 'web', [])

  useEffect(() => { setTitle(t('calendar.page_title')) }, [setTitle, t])

  const updateKeyboardOffset = useCallback((next: number) => {
    const clamped = Math.max(0, Math.round(next))
    if (Math.abs(keyboardOffsetRef.current - clamped) < 2) return
    keyboardOffsetRef.current = clamped
    setKeyboardOffset(clamped)
  }, [])

  useEffect(() => {
    if (isNativePlatform) return
    if (typeof window === 'undefined') return
    const viewport = window.visualViewport
    if (!viewport) return

    let baseHeight: number | null = null
    let rafId: number | null = null

    const update = () => {
      const current = viewport.height
      if (baseHeight === null || current > baseHeight - 4) baseHeight = current
      const offset = (baseHeight ?? current) - current - viewport.offsetTop
      updateKeyboardOffset(offset)
    }

    const onChange = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(update)
    }

    viewport.addEventListener('resize', onChange)
    viewport.addEventListener('scroll', onChange)
    update()

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', onChange)
      viewport.removeEventListener('scroll', onChange)
    }
  }, [isNativePlatform, updateKeyboardOffset])

  useEffect(() => {
    if (!isNativePlatform) return
    let showSub: PluginListenerHandle | undefined
    let changeSub: PluginListenerHandle | undefined
    let hideSub: PluginListenerHandle | undefined

    const handleShow = (info: KeyboardInfo) => updateKeyboardOffset(info?.keyboardHeight ?? 0)
    const handleHide = () => updateKeyboardOffset(0)

    Keyboard.addListener('keyboardWillShow', handleShow).then(handle => { showSub = handle })
    Keyboard.addListener('keyboardDidShow', handleShow).then(handle => { changeSub = handle })
    Keyboard.addListener('keyboardWillHide', handleHide).then(handle => { hideSub = handle })

    return () => {
      showSub?.remove()
      changeSub?.remove()
      hideSub?.remove()
    }
  }, [isNativePlatform, updateKeyboardOffset])

  const trackFocusedField = useCallback((event: FocusEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    if (!target) return
    const tag = target.tagName
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return
    focusedFieldRef.current = target
    if (typeof target.scrollIntoView === 'function') {
      requestAnimationFrame(() => {
        try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch {}
      })
    }
  }, [])

  useEffect(() => {
    if (keyboardOffset <= 0) return
    const target = focusedFieldRef.current
    if (!target || typeof target.scrollIntoView !== 'function') return
    const id = window.setTimeout(() => {
      try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch {}
    }, 80)
    return () => window.clearTimeout(id)
  }, [keyboardOffset])

  const reloadEvents = useCallback(async () => {
    try {
      const url = groupId ? `/api/group_calendar/${groupId}` : '/get_calendar_events'
      const response = await fetch(url, { credentials: 'include' })
      const payload = await response.json()
      if (payload?.success && Array.isArray(payload.events)) {
        const filtered = groupId
          ? payload.events
          : payload.events.filter((event: EventItem) => `${event.community_id || ''}` === `${community_id}`)

        const upcoming: EventItem[] = []
        const archived: EventItem[] = []
        filtered.forEach((event: EventItem) => {
          if (isPastEvent(event)) archived.push(event)
          else upcoming.push(event)
        })
        upcoming.sort((a, b) => buildEventDateTime(a).getTime() - buildEventDateTime(b).getTime())
        archived.sort((a, b) => buildEventDateTime(b).getTime() - buildEventDateTime(a).getTime())
        setEvents(upcoming)
        setArchivedEvents(archived)
        setSelectedDate(current => current && upcoming.some(event => event.date === current) ? current : upcoming[0]?.date || null)
      }
    } catch {
      setEvents([])
      setArchivedEvents([])
    }
  }, [community_id, groupId])

  useEffect(() => {
    let mounted = true
    setLoading(true)
    reloadEvents().finally(() => mounted && setLoading(false))
    ;(async () => {
      try {
        const membersUrl = groupId ? `/api/group_members/${groupId}` : `/community/${community_id}/members/list`
        const response = await fetch(membersUrl, { credentials: 'include' })
        const payload = await response.json()
        if (mounted && payload?.success && Array.isArray(payload.members)) setMembers(payload.members)
      } catch {}
    })()
    return () => { mounted = false }
  }, [community_id, groupId, reloadEvents])

  const dateStrip = useMemo(() => {
    const unique = Array.from(new Map(events.map(event => [event.date, event])).values())
    return unique.slice(0, 14)
  }, [events])

  const visibleEvents = useMemo(() => {
    if (activeTab === 'archive') return archivedEvents
    if (!selectedDate) return events
    return events.filter(event => event.date === selectedDate)
  }, [activeTab, archivedEvents, events, selectedDate])

  const nextEvent = events[0] || null
  const selectedCount = Object.values(selectedMembers).filter(Boolean).length

  const notifyNativeCalendarSaved = useCallback(() => {
    setSuccessMsg(t('calendar.event_added_to_calendar'))
    setTimeout(() => setSuccessMsg(null), 2200)
  }, [t])

  function continueCreateFlow() {
    setCreateError(null)
    const form = createFormRef.current
    if (form && !form.reportValidity()) return
    setCreateStep('invite')
  }

  async function createEvent(formData: FormData) {
    if (isCreating) return
    setCreateError(null)
    const title = String(formData.get('title') || '').trim()
    const date = String(formData.get('date') || '').trim()
    const timezone = String(formData.get('timezone') || '').trim()
    if (!title || !date || !timezone) {
      setCreateStep('details')
      setCreateError(t('calendar.complete_event_details'))
      requestAnimationFrame(() => createFormRef.current?.reportValidity())
      return
    }

    const params = toUtcFormFields(formData)
    if (community_id) params.append('community_id', String(community_id))
    if (groupId) params.append('group_id', groupId)
    params.append('invite_all', inviteAll ? 'true' : 'false')
    if (!inviteAll) {
      Object.entries(selectedMembers)
        .filter(([, checked]) => checked)
        .forEach(([username]) => params.append('invited_members[]', username))
    }

    setIsCreating(true)
    try {
      const response = await fetch('/add_calendar_event', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      })
      const payload = await response.json().catch(() => null)
      if (payload?.success) {
        await reloadEvents()
        setSuccessMsg(t('calendar.event_created'))
        setCreateOpen(false)
        setCreateStep('details')
        setInviteAll(false)
        setSelectedMembers({})
        createFormRef.current?.reset()
        setTimeout(() => setSuccessMsg(null), 2200)
      } else {
        setCreateError(payload?.message || t('calendar.create_failed'))
      }
    } catch {
      setCreateError(t('calendar.create_failed'))
    } finally {
      setIsCreating(false)
    }
  }

  async function saveEditedEvent(formData: FormData) {
    if (!editingEvent) return
    const params = toUtcFormFields(formData)
    params.set('event_id', String(editingEvent.id))
    const response = await fetch('/edit_calendar_event', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    })
    const payload = await response.json().catch(() => null)
    if (payload?.success) {
      const eid = editingEvent.id
      await reloadEvents()
      setEditingEvent(null)
      setSuccessMsg(t('calendar.event_updated'))
      setTimeout(() => setSuccessMsg(null), 2200)
      void (async () => {
        try {
          const r = await fetch(`/api/calendar_events/${eid}`, {
            credentials: 'include',
            headers: { Accept: 'application/json' },
          })
          const j = await r.json().catch(() => null)
          if (j?.success && j.event) {
            const e = j.event
            await syncNativeCalendarAfterServerChange({
              id: Number(e.id),
              title: String(e.title ?? ''),
              date: String(e.date ?? ''),
              end_date: e.end_date ?? null,
              start_time: e.start_time ?? null,
              end_time: e.end_time ?? null,
              description: e.description ?? null,
              meeting_url: e.meeting_url ?? null,
              community_name: e.community_name ?? null,
              timezone: e.timezone ?? null,
              starts_at_utc: e.starts_at_utc ?? null,
              ends_at_utc: e.ends_at_utc ?? null,
            })
          }
        } catch (e) {
          console.warn('[calendar] syncNativeCalendarAfterServerChange failed', e)
        }
      })()
    } else {
      alert(payload?.message || t('calendar.update_failed'))
    }
  }

  async function rsvp(eventId: number, response: RSVPResponse) {
    try {
      const result = await fetch(`/event/${eventId}/rsvp`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      })
      const payload = await result.json().catch(() => null)
      if (payload?.success) {
        await reloadEvents()
        setRsvpEvent(current => current?.id === eventId ? { ...current, user_rsvp: response } : current)
      }
    } catch {}
  }

  async function deleteEvent(event: EventItem) {
    if (!confirm(t('calendar.delete_confirm_short'))) return
    try {
      const response = await fetch('/delete_calendar_event', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ event_id: String(event.id) }),
      })
      const payload = await response.json().catch(() => null)
      if (payload?.success) {
        try {
          await removeNativeCalendarMirrorForCpointEvent(event.id)
        } catch {
          /* best effort */
        }
        await reloadEvents()
        setRsvpEvent(null)
      } else {
        alert(payload?.message || t('calendar.could_not_delete'))
      }
    } catch {}
  }

  return (
    <div className="min-h-screen bg-c-bg-app text-c-text-primary">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(0,206,200,0.22),transparent_34%),radial-gradient(circle_at_15%_20%,rgba(0,206,200,0.10),transparent_28%)]" />
      <div
        className="relative mx-auto max-w-3xl px-3 pt-2 pb-28"
        style={{ WebkitOverflowScrolling: 'touch' as any } as CSSProperties}
      >
        <header className="mb-0 flex items-center">
          <button className="rounded-full p-2 text-c-text-secondary hover:bg-c-hover-bg" onClick={() => navigate(groupId ? `/group_feed_react/${groupId}` : `/community_feed_react/${community_id}`)} aria-label={t('common.back')}>
            <i className="fa-solid fa-arrow-left" />
          </button>
        </header>

        {successMsg ? <div className="mb-2 rounded-xl border border-cpoint-turquoise/25 bg-cpoint-turquoise/10 px-3 py-2 text-xs text-c-accent-ink">{successMsg}</div> : null}

        <section className="mb-2.5 overflow-hidden rounded-2xl border border-c-border bg-c-bg-surface p-3 shadow-c-card backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-c-text-tertiary">{t('calendar.next_up')}</p>
              <h2 className="mt-1 truncate text-lg font-semibold text-c-text-primary">{nextEvent?.title || t('calendar.no_upcoming_yet')}</h2>
              <p className="mt-1 line-clamp-2 text-xs text-c-text-secondary">{nextEvent ? `${formatDateRange(nextEvent)} • ${formatTimeRange(nextEvent)}` : t('calendar.create_first_hint')}</p>
            </div>
            <div className="shrink-0 rounded-xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 px-2.5 py-1.5 text-right">
              <div className="text-[11px] text-c-accent-ink">{nextEvent ? getCountdownLabel(nextEvent) : t('calendar.ready')}</div>
            </div>
          </div>
          {nextEvent ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="rounded-full bg-cpoint-turquoise px-3 py-1.5 text-xs font-semibold text-c-text-on-accent" onClick={() => setRsvpEvent(nextEvent)}>{t('calendar.rsvp_now')}</button>
              <button className="rounded-full border border-c-border px-3 py-1.5 text-xs text-c-text-secondary hover:border-cpoint-turquoise/45" onClick={() => navigate(`/event/${nextEvent.id}`)}>{t('calendar.open_details')}</button>
              <button
                className="rounded-full border border-c-border px-3 py-1.5 text-xs text-c-text-secondary hover:border-cpoint-turquoise/45"
                onClick={() =>
                  void (async () => {
                    try {
                      const outcome = await exportEventToDeviceCalendar(nextEvent.id, eventItemToExportFields(nextEvent))
                      if (outcome.via === 'native') notifyNativeCalendarSaved()
                    } catch (err: unknown) {
                      const msg = err instanceof Error ? err.message : t('calendar.could_not_export')
                      alert(msg)
                    }
                  })()
                }
              >
                {t('calendar.add_to_calendar')}
              </button>
            </div>
          ) : null}
        </section>

        <div className="mb-3 flex rounded-full border border-c-border bg-c-bg-surface p-1">
          <button className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${activeTab === 'upcoming' ? 'bg-cpoint-turquoise text-black' : 'text-c-text-tertiary hover:text-c-text-primary'}`} onClick={() => setActiveTab('upcoming')}>{t('calendar.upcoming')}</button>
          <button className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${activeTab === 'archive' ? 'bg-cpoint-turquoise text-black' : 'text-c-text-tertiary hover:text-c-text-primary'}`} onClick={() => setActiveTab('archive')}>{t('calendar.archive')}</button>
        </div>

        {activeTab === 'upcoming' && dateStrip.length > 0 ? (
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {dateStrip.map(event => (
              <button key={event.date} className={`min-w-[58px] rounded-xl border px-2 py-2 text-center transition ${selectedDate === event.date ? 'border-cpoint-turquoise bg-cpoint-turquoise/15 text-c-text-primary' : 'border-c-border bg-c-bg-recessed text-c-text-tertiary'}`} onClick={() => setSelectedDate(event.date)}>
                <div className="text-[9px] font-bold tracking-[0.16em] text-cpoint-turquoise">{formatMonth(event.date)}</div>
                <div className="text-lg font-semibold leading-tight">{formatDay(event.date)}</div>
                <div className="text-[10px]">{t('calendar.events_on_date', { count: events.filter(item => item.date === event.date).length })}</div>
              </button>
            ))}
          </div>
        ) : null}

        <main className="space-y-2.5">
          {loading ? (
            <div className="rounded-2xl border border-c-border bg-c-bg-surface p-4 text-sm text-c-text-tertiary">{t('calendar.loading_events')}</div>
          ) : visibleEvents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-c-border bg-c-bg-recessed p-5 text-center">
              <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-cpoint-turquoise/10 text-cpoint-turquoise"><i className="fa-regular fa-calendar" /></div>
              <h3 className="mt-3 text-base font-semibold">{activeTab === 'archive' ? t('calendar.no_archived_events') : t('calendar.nothing_scheduled')}</h3>
              <p className="mt-1.5 text-xs text-c-text-tertiary">{activeTab === 'archive' ? t('calendar.archive_empty_hint') : t('calendar.upcoming_empty_hint')}</p>
              {activeTab !== 'archive' ? <button className="mt-4 rounded-full bg-cpoint-turquoise px-4 py-1.5 text-xs font-semibold text-black" onClick={() => { setCreateError(null); setCreateOpen(true) }}>{t('calendar.create_event')}</button> : null}
            </div>
          ) : (
            visibleEvents.map(event => (
              <EventCard
                key={event.id}
                event={event}
                archived={activeTab === 'archive'}
                onOpen={item => navigate(`/event/${item.id}`)}
                onRsvp={rsvp}
                onShowDetails={setRsvpEvent}
                onEdit={setEditingEvent}
                onDelete={deleteEvent}
                onNativeCalendarSaved={notifyNativeCalendarSaved}
              />
            ))
          )}
        </main>
      </div>

      {activeTab !== 'archive' ? (
        <button
          type="button"
          className="fixed bottom-[5.25rem] left-1/2 z-40 inline-flex w-[88%] max-w-sm -translate-x-1/2 items-center justify-center gap-2 rounded-full bg-cpoint-turquoise px-5 py-3 text-sm font-semibold text-c-text-on-accent shadow-[0_0_28px_rgba(0,206,200,0.45)] hover:brightness-110"
          onClick={() => { setCreateError(null); setCreateOpen(true) }}
        >
          <i className="fa-solid fa-plus text-xs" />
          <span>{t('calendar.new_event')}</span>
        </button>
      ) : null}

      {createOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-c-bg-app/70 px-3 backdrop-blur"
          style={{
            paddingTop: keyboardOffset > 0
              ? '8px'
              : 'calc(var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px))) + 8px)',
            paddingBottom: `${keyboardOffset + 16}px`,
            transition: 'padding 180ms ease',
          } as CSSProperties}
          onClick={event => {
            if (event.currentTarget === event.target) {
              setCreateError(null)
              setCreateOpen(false)
            }
          }}
          onFocusCapture={trackFocusedField}
        >
          <div className="w-full max-w-2xl rounded-2xl border border-c-border bg-c-bg-elevated p-3.5 shadow-2xl">
            <div className="mb-2.5 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">{t('calendar.create_event_title')}</h2>
                <p className="mt-0.5 text-xs text-c-text-tertiary">{t('calendar.step_of', { current: createStep === 'details' ? 1 : 2, total: 2 })}</p>
              </div>
              <button className="grid h-8 w-8 place-items-center rounded-full border border-c-border hover:bg-c-hover-bg" onClick={() => { setCreateError(null); setCreateOpen(false) }} aria-label={t('common.close')}><i className="fa-solid fa-xmark" /></button>
            </div>
            <form ref={createFormRef} noValidate onSubmit={event => { event.preventDefault(); createEvent(new FormData(event.currentTarget)) }}>
              <div className={createStep === 'details' ? 'block' : 'hidden'}>
                <EventFormFields />
                <div className="mt-3 flex justify-end">
                  <button type="button" className="rounded-full bg-cpoint-turquoise px-4 py-2 text-sm font-semibold text-black hover:brightness-110" onClick={continueCreateFlow}>{t('calendar.continue')}</button>
                </div>
              </div>
              <div className={createStep === 'invite' ? 'block' : 'hidden'}>
                <div className="rounded-xl border border-c-border bg-c-bg-recessed p-2.5">
                  <div className="flex gap-1.5">
                    <button type="button" className={`flex-1 rounded-lg border px-3 py-2 text-sm ${inviteAll ? 'border-cpoint-turquoise bg-cpoint-turquoise/15 text-c-accent-ink' : 'border-c-border text-c-text-secondary'}`} onClick={() => setInviteAll(true)}>{t('calendar.invite_all')}</button>
                    <button type="button" className={`flex-1 rounded-lg border px-3 py-2 text-sm ${!inviteAll ? 'border-cpoint-turquoise bg-cpoint-turquoise/15 text-c-accent-ink' : 'border-c-border text-c-text-secondary'}`} onClick={() => setInviteAll(false)}>{t('calendar.choose_members')}</button>
                  </div>
                  {!inviteAll ? (
                    <div className="mt-2.5 max-h-52 space-y-1 overflow-y-auto pr-1">
                      {members.length === 0 ? <div className="text-sm text-c-text-tertiary">{t('calendar.no_members_found')}</div> : members.map(member => (
                        <label key={member.username} className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 hover:bg-c-hover-bg">
                          <span className="text-sm">{member.username}</span>
                          <input type="checkbox" checked={!!selectedMembers[member.username]} onChange={() => setSelectedMembers(current => ({ ...current, [member.username]: !current[member.username] }))} className="h-5 w-5 accent-cpoint-turquoise" />
                        </label>
                      ))}
                    </div>
                  ) : <p className="mt-2.5 text-sm text-c-text-tertiary">{t('calendar.invite_all_hint')}</p>}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <button type="button" className="rounded-full border border-c-border px-4 py-2 text-sm hover:bg-c-hover-bg disabled:opacity-60" onClick={() => setCreateStep('details')} disabled={isCreating}>{t('common.back')}</button>
                  <button type="submit" className="rounded-full bg-cpoint-turquoise px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:cursor-wait disabled:opacity-60" disabled={isCreating}>
                    {isCreating ? t('calendar.creating_event') : inviteAll ? t('calendar.create_for_everyone') : selectedCount ? t('calendar.create_for_count', { count: selectedCount }) : t('calendar.create_event_submit')}
                  </button>
                </div>
              </div>
              {createError ? (
                <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {createError}
                </div>
              ) : null}
            </form>
          </div>
        </div>
      ) : null}

      {rsvpEvent ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-c-bg-app/70 backdrop-blur" onClick={event => event.currentTarget === event.target && setRsvpEvent(null)}>
          <div className="w-full max-w-xl rounded-t-2xl border border-c-border bg-c-bg-elevated p-3.5 sm:mb-4 sm:rounded-2xl">
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-cpoint-turquoise">{t('calendar.rsvp_label')}</p>
                <h2 className="text-base font-semibold">{rsvpEvent.title}</h2>
                <p className="mt-1 text-xs text-c-text-tertiary">{formatDateRange(rsvpEvent)} • {formatTimeRange(rsvpEvent)}</p>
              </div>
              <button className="grid h-8 w-8 place-items-center rounded-full border border-c-border hover:bg-c-hover-bg" onClick={() => setRsvpEvent(null)} aria-label={t('common.close')}><i className="fa-solid fa-xmark" /></button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {([
                ['going', t('calendar.going'), rsvpEvent.rsvp_counts?.going || 0],
                ['maybe', t('calendar.maybe'), rsvpEvent.rsvp_counts?.maybe || 0],
                ['not_going', t('calendar.not_going'), rsvpEvent.rsvp_counts?.not_going || 0],
              ] as const).map(([value, label, count]) => (
                <button key={value} className={`rounded-xl border px-2 py-3 text-xs transition ${rsvpEvent.user_rsvp === value ? 'border-cpoint-turquoise bg-cpoint-turquoise/15 text-c-accent-ink' : 'border-c-border text-c-text-secondary hover:border-cpoint-turquoise/45'}`} onClick={() => rsvp(rsvpEvent.id, value)}>
                  <span className="block font-semibold">{label}</span>
                  <span className="text-xs text-c-text-tertiary">{count}</span>
                </button>
              ))}
            </div>
            {typeof rsvpEvent.rsvp_counts?.no_response === 'number' ? <p className="mt-4 text-center text-xs text-c-text-tertiary">{t('calendar.no_response_yet', { count: rsvpEvent.rsvp_counts.no_response })}</p> : null}
          </div>
        </div>
      ) : null}

      {editingEvent ? (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-c-bg-app/70 px-3 backdrop-blur"
          style={{
            paddingTop: keyboardOffset > 0
              ? '8px'
              : 'calc(var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px))) + 8px)',
            paddingBottom: `${keyboardOffset + 16}px`,
            transition: 'padding 180ms ease',
          } as CSSProperties}
          onClick={event => event.currentTarget === event.target && setEditingEvent(null)}
          onFocusCapture={trackFocusedField}
        >
          <div className="w-full max-w-2xl rounded-2xl border border-c-border bg-c-bg-elevated p-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-base font-semibold">{t('calendar.edit_event')}</h2>
              <button className="grid h-8 w-8 place-items-center rounded-full border border-c-border hover:bg-c-hover-bg" onClick={() => setEditingEvent(null)} aria-label={t('common.close')}><i className="fa-solid fa-xmark" /></button>
            </div>
            <form onSubmit={event => { event.preventDefault(); saveEditedEvent(new FormData(event.currentTarget)) }}>
              <EventFormFields event={editingEvent} />
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" className="rounded-full border border-c-border px-4 py-2 text-sm hover:bg-c-hover-bg" onClick={() => setEditingEvent(null)}>{t('common.cancel')}</button>
                <button type="submit" className="rounded-full bg-cpoint-turquoise px-4 py-2 text-sm font-semibold text-black hover:brightness-110">{t('calendar.save_changes')}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
