import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import { useHeader } from '../contexts/HeaderContext'
import { exportEventToDeviceCalendar } from '../utils/calendarExport'

type EventItem = {
  id: number
  title: string
  date: string
  community_id?: number | string
  end_date?: string | null
  start_time?: string | null
  end_time?: string | null
  timezone?: string | null
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

type Member = {
  username: string
  profile_picture?: string | null
}

const TIMEZONE_OPTIONS = [
  ['EST', 'EST (Eastern Time)'],
  ['CST', 'CST (Central Time)'],
  ['MST', 'MST (Mountain Time)'],
  ['PST', 'PST (Pacific Time)'],
  ['GMT', 'GMT (Greenwich Mean Time)'],
  ['CET', 'CET (Central European Time)'],
  ['IST', 'IST (India Standard Time)'],
  ['JST', 'JST (Japan Standard Time)'],
  ['AEST', 'AEST (Australian Eastern Time)'],
  ['UTC', 'UTC (Coordinated Universal Time)'],
] as const

const INPUT_CLASS = 'mt-1 w-full rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-[16px] text-white outline-none transition focus:border-[#4db6ac]/80 focus:ring-2 focus:ring-[#4db6ac]/20'
const LABEL_CLASS = 'text-xs font-medium text-[#9fb0b5]'

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
  return new Intl.DateTimeFormat(undefined, {
    weekday: variant === 'long' ? 'long' : 'short',
    month: variant === 'long' ? 'long' : 'short',
    day: 'numeric',
  }).format(parsed)
}

function formatMonth(date: string) {
  const parsed = new Date(`${date}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { month: 'short' }).format(parsed).toUpperCase()
}

function formatDay(date: string) {
  const parsed = new Date(`${date}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return '--'
  return new Intl.DateTimeFormat(undefined, { day: '2-digit' }).format(parsed)
}

function formatTimeRange(event: EventItem) {
  const start = normalizeTime(event.start_time)
  const end = normalizeTime(event.end_time)
  const range = [start, end].filter(Boolean).join(' - ')
  return range && event.timezone ? `${range} ${event.timezone}` : range || 'All day'
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
  if (diff <= 0) return 'Starting soon'
  const minutes = Math.ceil(diff / 60000)
  if (minutes < 60) return `In ${minutes}m`
  const hours = Math.ceil(minutes / 60)
  if (hours < 48) return `In ${hours}h`
  return `In ${Math.ceil(hours / 24)}d`
}

function toUtcFormFields(formData: FormData) {
  const params = new URLSearchParams()
  const append = (name: string, value?: string | null) => {
    if (value) params.append(name, value)
  }

  const title = String(formData.get('title') || '').trim()
  const date = String(formData.get('date') || '')
  const endDate = String(formData.get('end_date') || '')
  const startTime = String(formData.get('start_time') || '')
  const endTime = String(formData.get('end_time') || '')

  append('title', title)
  append('description', String(formData.get('description') || '').trim())
  append('timezone', String(formData.get('timezone') || ''))
  append('notification_preferences', String(formData.get('notification_preferences') || 'all'))

  if (date && startTime) {
    try {
      const utc = new Date(`${date}T${startTime}`)
      append('date', utc.toISOString().slice(0, 10))
      append('start_time', utc.toISOString().slice(11, 16))
    } catch {
      append('date', date)
      append('start_time', startTime)
    }
  } else {
    append('date', date)
    append('start_time', startTime)
  }

  if (endDate && endTime) {
    try {
      const utc = new Date(`${endDate}T${endTime}`)
      append('end_date', utc.toISOString().slice(0, 10))
      append('end_time', utc.toISOString().slice(11, 16))
    } catch {
      append('end_date', endDate)
      append('end_time', endTime)
    }
  } else {
    append('end_date', endDate)
    append('end_time', endTime)
  }

  return params
}

function EventFormFields({ event }: { event?: EventItem }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <label className={`col-span-2 ${LABEL_CLASS}`}>Title
        <input name="title" defaultValue={event?.title || ''} className={INPUT_CLASS} required placeholder="Workout, meetup, webinar..." />
      </label>
      <label className={LABEL_CLASS}>Start date
        <input name="date" type="date" defaultValue={event?.date || ''} className={INPUT_CLASS} required />
      </label>
      <label className={LABEL_CLASS}>End date
        <input name="end_date" type="date" defaultValue={event?.end_date || ''} className={INPUT_CLASS} />
      </label>
      <label className={LABEL_CLASS}>Start time
        <input name="start_time" type="time" defaultValue={normalizeTime(event?.start_time)} className={INPUT_CLASS} />
      </label>
      <label className={LABEL_CLASS}>End time
        <input name="end_time" type="time" defaultValue={normalizeTime(event?.end_time)} className={INPUT_CLASS} />
      </label>
      <label className={`col-span-2 ${LABEL_CLASS}`}>Timezone
        <select name="timezone" defaultValue={event?.timezone || 'UTC'} className={INPUT_CLASS} required>
          <option value="">Select timezone</option>
          {TIMEZONE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className={`col-span-2 ${LABEL_CLASS}`}>Description
        <textarea name="description" defaultValue={event?.description || ''} rows={3} className={INPUT_CLASS} placeholder="Add context, location details, or agenda." />
      </label>
      {!event ? (
        <label className={`col-span-2 ${LABEL_CLASS}`}>Reminders
          <select name="notification_preferences" defaultValue="all" className={INPUT_CLASS}>
            <option value="none">No reminders</option>
            <option value="1_week">1 week before</option>
            <option value="1_day">1 day before</option>
            <option value="1_hour">1 hour before</option>
            <option value="all">All reminders</option>
          </select>
          <span className="mt-2 block text-[11px] font-normal normal-case tracking-normal text-[#8fa3a8]">Reminders follow the event start time and each invitee's RSVP.</span>
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
}

function EventCard({ event, archived = false, onOpen, onRsvp, onShowDetails, onEdit, onDelete }: EventCardProps) {
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.045] p-3 shadow-[0_12px_34px_rgba(0,0,0,0.32)] backdrop-blur-xl transition hover:border-[#4db6ac]/45 hover:bg-white/[0.065]">
      <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[#4db6ac]/70 to-transparent" />
      <button type="button" className="w-full text-left" onClick={() => onOpen(event)}>
        <div className="flex items-start gap-2.5">
          <div className="grid h-12 w-11 shrink-0 place-items-center rounded-xl border border-[#4db6ac]/35 bg-[#4db6ac]/10 text-center">
            <div>
              <div className="text-[9px] font-bold tracking-[0.16em] text-[#4db6ac]">{formatMonth(event.date)}</div>
              <div className="text-lg font-semibold leading-tight text-white">{formatDay(event.date)}</div>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-[#8fa3a8]">
              <span>{formatTimeRange(event)}</span>
              {archived ? <span className="rounded-full border border-white/10 px-2 py-0.5 normal-case tracking-normal">Archived</span> : null}
            </div>
            <h3 className="mt-0.5 line-clamp-2 text-base font-semibold text-white">{event.title}</h3>
            <p className="mt-0.5 text-xs text-[#b7c7ca]">{formatDateRange(event)}</p>
            {event.description ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#d7e1e3]/85">{event.description}</p> : null}
          </div>
        </div>
      </button>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-[#b7c7ca]" onClick={clickEvent => clickEvent.stopPropagation()}>
        <button type="button" className={`rounded-full border px-2.5 py-1 transition ${event.user_rsvp === 'going' ? 'border-[#4db6ac] bg-[#4db6ac]/15 text-[#74fff0]' : 'border-white/10 hover:border-[#4db6ac]/45 hover:text-white'}`} onClick={() => onRsvp(event.id, 'going')}>
          Going {event.rsvp_counts?.going || 0}
        </button>
        <button type="button" className={`rounded-full border px-2.5 py-1 transition ${event.user_rsvp === 'maybe' ? 'border-[#4db6ac] bg-[#4db6ac]/15 text-[#74fff0]' : 'border-white/10 hover:border-[#4db6ac]/45 hover:text-white'}`} onClick={() => onRsvp(event.id, 'maybe')}>
          Maybe {event.rsvp_counts?.maybe || 0}
        </button>
        <button type="button" className={`rounded-full border px-2.5 py-1 transition ${event.user_rsvp === 'not_going' ? 'border-[#4db6ac] bg-[#4db6ac]/15 text-[#74fff0]' : 'border-white/10 hover:border-[#4db6ac]/45 hover:text-white'}`} onClick={() => onRsvp(event.id, 'not_going')}>
          Not going {event.rsvp_counts?.not_going || 0}
        </button>
        <button type="button" className="ml-auto rounded-full border border-white/10 px-2.5 py-1 hover:border-[#4db6ac]/45 hover:text-white" onClick={() => onShowDetails(event)}>
          Details
        </button>
        <button
          type="button"
          className="rounded-full border border-white/10 px-2.5 py-1 hover:border-[#4db6ac]/45 hover:text-white"
          onClick={(e) => {
            e.stopPropagation()
            void (async () => {
              try {
                await exportEventToDeviceCalendar(event.id)
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Could not export'
                alert(msg)
              }
            })()
          }}
          aria-label="Add to device calendar"
          title="Add to device calendar"
        >
          <i className="fa-regular fa-calendar-plus" />
        </button>
        {!archived ? (
          <>
            <button type="button" className="rounded-full border border-white/10 px-2.5 py-1 hover:border-[#4db6ac]/45 hover:text-white" onClick={() => onEdit(event)} aria-label="Edit event">
              <i className="fa-regular fa-pen-to-square" />
            </button>
            <button type="button" className="rounded-full border border-red-400/45 px-2.5 py-1 text-red-200 hover:bg-red-500/10" onClick={() => onDelete(event)} aria-label="Delete event">
              <i className="fa-regular fa-trash-can" />
            </button>
          </>
        ) : null}
      </div>
    </article>
  )
}

export default function CommunityCalendar() {
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
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const keyboardOffsetRef = useRef(0)
  const focusedFieldRef = useRef<HTMLElement | null>(null)
  const isNativePlatform = useMemo(() => typeof window !== 'undefined' && Capacitor.getPlatform() !== 'web', [])

  useEffect(() => { setTitle('Calendar') }, [setTitle])

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

  async function createEvent(formData: FormData) {
    const params = toUtcFormFields(formData)
    if (community_id) params.append('community_id', String(community_id))
    if (groupId) params.append('group_id', groupId)
    params.append('invite_all', inviteAll ? 'true' : 'false')
    if (!inviteAll) {
      Object.entries(selectedMembers)
        .filter(([, checked]) => checked)
        .forEach(([username]) => params.append('invited_members[]', username))
    }

    const response = await fetch('/add_calendar_event', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    })
    const payload = await response.json().catch(() => null)
    if (payload?.success) {
      await reloadEvents()
      setSuccessMsg('Event created')
      setCreateOpen(false)
      setCreateStep('details')
      setInviteAll(false)
      setSelectedMembers({})
      createFormRef.current?.reset()
      setTimeout(() => setSuccessMsg(null), 2200)
    } else {
      alert(payload?.message || 'Failed to create event')
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
      await reloadEvents()
      setEditingEvent(null)
      setSuccessMsg('Event updated')
      setTimeout(() => setSuccessMsg(null), 2200)
    } else {
      alert(payload?.message || 'Failed to update event')
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
    if (!confirm('Delete this event?')) return
    try {
      const response = await fetch('/delete_calendar_event', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ event_id: String(event.id) }),
      })
      const payload = await response.json().catch(() => null)
      if (payload?.success) {
        await reloadEvents()
        setRsvpEvent(null)
      } else {
        alert(payload?.message || 'Could not delete event')
      }
    } catch {}
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(77,182,172,0.22),transparent_34%),radial-gradient(circle_at_15%_20%,rgba(77,182,172,0.10),transparent_28%)]" />
      <div
        className="relative mx-auto max-w-3xl px-3 pt-2 pb-28"
        style={{ WebkitOverflowScrolling: 'touch' as any } as CSSProperties}
      >
        <header className="mb-0 flex items-center">
          <button className="rounded-full p-2 text-[#cfe7e4] hover:bg-white/5" onClick={() => navigate(groupId ? `/group_feed_react/${groupId}` : `/community_feed_react/${community_id}`)} aria-label="Back">
            <i className="fa-solid fa-arrow-left" />
          </button>
        </header>

        {successMsg ? <div className="mb-2 rounded-xl border border-[#4db6ac]/25 bg-[#4db6ac]/10 px-3 py-2 text-xs text-[#9ff8ef]">{successMsg}</div> : null}

        <section className="mb-2.5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.045] p-3 shadow-[0_14px_46px_rgba(0,0,0,0.36)] backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#8fa3a8]">Next up</p>
              <h2 className="mt-1 truncate text-lg font-semibold text-white">{nextEvent?.title || 'No upcoming events yet'}</h2>
              <p className="mt-1 line-clamp-2 text-xs text-[#b7c7ca]">{nextEvent ? `${formatDateRange(nextEvent)} • ${formatTimeRange(nextEvent)}` : 'Create the first event and invite members in seconds.'}</p>
            </div>
            <div className="shrink-0 rounded-xl border border-[#4db6ac]/30 bg-[#4db6ac]/10 px-2.5 py-1.5 text-right">
              <div className="text-[11px] text-[#8ff4e9]">{nextEvent ? getCountdownLabel(nextEvent) : 'Ready'}</div>
            </div>
          </div>
          {nextEvent ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-[#e9fffd]" onClick={() => setRsvpEvent(nextEvent)}>RSVP now</button>
              <button className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-[#d7e1e3] hover:border-[#4db6ac]/45" onClick={() => navigate(`/event/${nextEvent.id}`)}>Open details</button>
              <button
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-[#d7e1e3] hover:border-[#4db6ac]/45"
                onClick={() =>
                  void (async () => {
                    try {
                      await exportEventToDeviceCalendar(nextEvent.id)
                    } catch (err: unknown) {
                      const msg = err instanceof Error ? err.message : 'Could not export'
                      alert(msg)
                    }
                  })()
                }
              >
                Add to calendar
              </button>
            </div>
          ) : null}
        </section>

        <div className="mb-3 flex rounded-full border border-white/10 bg-white/[0.04] p-1">
          <button className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${activeTab === 'upcoming' ? 'bg-[#4db6ac] text-black' : 'text-[#9fb0b5] hover:text-white'}`} onClick={() => setActiveTab('upcoming')}>Upcoming</button>
          <button className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${activeTab === 'archive' ? 'bg-[#4db6ac] text-black' : 'text-[#9fb0b5] hover:text-white'}`} onClick={() => setActiveTab('archive')}>Archive</button>
        </div>

        {activeTab === 'upcoming' && dateStrip.length > 0 ? (
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {dateStrip.map(event => (
              <button key={event.date} className={`min-w-[58px] rounded-xl border px-2 py-2 text-center transition ${selectedDate === event.date ? 'border-[#4db6ac] bg-[#4db6ac]/15 text-white' : 'border-white/10 bg-white/[0.035] text-[#9fb0b5]'}`} onClick={() => setSelectedDate(event.date)}>
                <div className="text-[9px] font-bold tracking-[0.16em] text-[#4db6ac]">{formatMonth(event.date)}</div>
                <div className="text-lg font-semibold leading-tight">{formatDay(event.date)}</div>
                <div className="text-[10px]">{events.filter(item => item.date === event.date).length} event{events.filter(item => item.date === event.date).length === 1 ? '' : 's'}</div>
              </button>
            ))}
          </div>
        ) : null}

        <main className="space-y-2.5">
          {loading ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-[#9fb0b5]">Loading events...</div>
          ) : visibleEvents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.035] p-5 text-center">
              <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-[#4db6ac]/10 text-[#4db6ac]"><i className="fa-regular fa-calendar" /></div>
              <h3 className="mt-3 text-base font-semibold">{activeTab === 'archive' ? 'No archived events' : 'Nothing scheduled here'}</h3>
              <p className="mt-1.5 text-xs text-[#9fb0b5]">{activeTab === 'archive' ? 'Past events will appear here after they end.' : 'Start with a clean event card and invite the right members.'}</p>
              {activeTab !== 'archive' ? <button className="mt-4 rounded-full bg-[#4db6ac] px-4 py-1.5 text-xs font-semibold text-black" onClick={() => setCreateOpen(true)}>Create event</button> : null}
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
              />
            ))
          )}
        </main>
      </div>

      {activeTab !== 'archive' ? (
        <button
          type="button"
          className="fixed bottom-[5.25rem] left-1/2 z-40 inline-flex w-[88%] max-w-sm -translate-x-1/2 items-center justify-center gap-2 rounded-full bg-[#4db6ac] px-5 py-3 text-sm font-semibold text-black shadow-[0_0_28px_rgba(77,182,172,0.45)] hover:brightness-110"
          onClick={() => setCreateOpen(true)}
        >
          <i className="fa-solid fa-plus text-xs" />
          <span>New event</span>
        </button>
      ) : null}

      {createOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/70 px-3 backdrop-blur"
          style={{
            paddingTop: keyboardOffset > 0
              ? '8px'
              : 'calc(var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px))) + 8px)',
            paddingBottom: `${keyboardOffset + 16}px`,
            transition: 'padding 180ms ease',
          } as CSSProperties}
          onClick={event => event.currentTarget === event.target && setCreateOpen(false)}
          onFocusCapture={trackFocusedField}
        >
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#050606] p-3.5 shadow-2xl">
            <div className="mb-2.5 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">Create event</h2>
                <p className="mt-0.5 text-xs text-[#8fa3a8]">Step {createStep === 'details' ? '1' : '2'} of 2</p>
              </div>
              <button className="grid h-8 w-8 place-items-center rounded-full border border-white/10 hover:bg-white/5" onClick={() => setCreateOpen(false)} aria-label="Close"><i className="fa-solid fa-xmark" /></button>
            </div>
            <form ref={createFormRef} onSubmit={event => { event.preventDefault(); createEvent(new FormData(event.currentTarget)) }}>
              <div className={createStep === 'details' ? 'block' : 'hidden'}>
                <EventFormFields />
                <div className="mt-3 flex justify-end">
                  <button type="button" className="rounded-full bg-[#4db6ac] px-4 py-2 text-sm font-semibold text-black hover:brightness-110" onClick={() => setCreateStep('invite')}>Continue</button>
                </div>
              </div>
              <div className={createStep === 'invite' ? 'block' : 'hidden'}>
                <div className="rounded-xl border border-white/10 bg-white/[0.035] p-2.5">
                  <div className="flex gap-1.5">
                    <button type="button" className={`flex-1 rounded-lg border px-3 py-2 text-sm ${inviteAll ? 'border-[#4db6ac] bg-[#4db6ac]/15 text-[#8ff4e9]' : 'border-white/10 text-[#b7c7ca]'}`} onClick={() => setInviteAll(true)}>Invite all</button>
                    <button type="button" className={`flex-1 rounded-lg border px-3 py-2 text-sm ${!inviteAll ? 'border-[#4db6ac] bg-[#4db6ac]/15 text-[#8ff4e9]' : 'border-white/10 text-[#b7c7ca]'}`} onClick={() => setInviteAll(false)}>Choose members</button>
                  </div>
                  {!inviteAll ? (
                    <div className="mt-2.5 max-h-52 space-y-1 overflow-y-auto pr-1">
                      {members.length === 0 ? <div className="text-sm text-[#9fb0b5]">No members found.</div> : members.map(member => (
                        <label key={member.username} className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 hover:bg-white/5">
                          <span className="text-sm">{member.username}</span>
                          <input type="checkbox" checked={!!selectedMembers[member.username]} onChange={() => setSelectedMembers(current => ({ ...current, [member.username]: !current[member.username] }))} className="h-5 w-5 accent-[#4db6ac]" />
                        </label>
                      ))}
                    </div>
                  ) : <p className="mt-2.5 text-sm text-[#9fb0b5]">Every current member will receive the invite.</p>}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <button type="button" className="rounded-full border border-white/10 px-4 py-2 text-sm hover:bg-white/5" onClick={() => setCreateStep('details')}>Back</button>
                  <button type="submit" className="rounded-full bg-[#4db6ac] px-4 py-2 text-sm font-semibold text-black hover:brightness-110">
                    Create {inviteAll ? 'for everyone' : selectedCount ? `for ${selectedCount}` : 'event'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {rsvpEvent ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 backdrop-blur" onClick={event => event.currentTarget === event.target && setRsvpEvent(null)}>
          <div className="w-full max-w-xl rounded-t-2xl border border-white/10 bg-[#050606] p-3.5 sm:mb-4 sm:rounded-2xl">
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-[#4db6ac]">RSVP</p>
                <h2 className="text-base font-semibold">{rsvpEvent.title}</h2>
                <p className="mt-1 text-xs text-[#9fb0b5]">{formatDateRange(rsvpEvent)} • {formatTimeRange(rsvpEvent)}</p>
              </div>
              <button className="grid h-8 w-8 place-items-center rounded-full border border-white/10 hover:bg-white/5" onClick={() => setRsvpEvent(null)} aria-label="Close"><i className="fa-solid fa-xmark" /></button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {([
                ['going', 'Going', rsvpEvent.rsvp_counts?.going || 0],
                ['maybe', 'Maybe', rsvpEvent.rsvp_counts?.maybe || 0],
                ['not_going', 'Not going', rsvpEvent.rsvp_counts?.not_going || 0],
              ] as const).map(([value, label, count]) => (
                <button key={value} className={`rounded-xl border px-2 py-3 text-xs transition ${rsvpEvent.user_rsvp === value ? 'border-[#4db6ac] bg-[#4db6ac]/15 text-[#8ff4e9]' : 'border-white/10 text-[#b7c7ca] hover:border-[#4db6ac]/45'}`} onClick={() => rsvp(rsvpEvent.id, value)}>
                  <span className="block font-semibold">{label}</span>
                  <span className="text-xs text-[#8fa3a8]">{count}</span>
                </button>
              ))}
            </div>
            {typeof rsvpEvent.rsvp_counts?.no_response === 'number' ? <p className="mt-4 text-center text-xs text-[#8fa3a8]">{rsvpEvent.rsvp_counts.no_response} no response yet</p> : null}
          </div>
        </div>
      ) : null}

      {editingEvent ? (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/70 px-3 backdrop-blur"
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
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#050606] p-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-base font-semibold">Edit event</h2>
              <button className="grid h-8 w-8 place-items-center rounded-full border border-white/10 hover:bg-white/5" onClick={() => setEditingEvent(null)} aria-label="Close"><i className="fa-solid fa-xmark" /></button>
            </div>
            <form onSubmit={event => { event.preventDefault(); saveEditedEvent(new FormData(event.currentTarget)) }}>
              <EventFormFields event={editingEvent} />
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" className="rounded-full border border-white/10 px-4 py-2 text-sm hover:bg-white/5" onClick={() => setEditingEvent(null)}>Cancel</button>
                <button type="submit" className="rounded-full bg-[#4db6ac] px-4 py-2 text-sm font-semibold text-black hover:brightness-110">Save changes</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
