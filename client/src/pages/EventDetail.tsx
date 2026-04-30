import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import { exportEventToDeviceCalendar, removeNativeCalendarMirrorForCpointEvent } from '../utils/calendarExport'
import type { CalendarExportEventFields } from '../utils/calendarExportTypes'

type EventData = {
  id: number
  title: string
  date: string
  end_date?: string|null
  start_time?: string|null
  end_time?: string|null
  timezone?: string|null
  description?: string|null
  username: string
  community_id?: number
  community_name?: string
  user_rsvp?: string|null
  rsvp_counts?: { going: number; maybe: number; not_going: number; no_response?: number }
  creator_username?: string|null
}

type RSVPDetails = {
  going: { username: string }[]
  maybe: { username: string }[]
  not_going: { username: string }[]
  no_response: { username: string }[]
}

const glassPanel =
  'relative rounded-2xl overflow-hidden liquid-glass-surface border border-white/15 shadow-[0_24px_56px_rgba(0,0,0,0.48)]'

export default function EventDetail(){
  const { event_id } = useParams()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [event, setEvent] = useState<EventData| null>(null)
  const [loading, setLoading] = useState(true)
  const [rsvpDetails, setRsvpDetails] = useState<RSVPDetails| null>(null)
  const [showAttendees, setShowAttendees] = useState(false)
  const [attendeeFilter, setAttendeeFilter] = useState<'going'|'maybe'|'not_going'|'no_response'>('going')
  const [currentUser, setCurrentUser] = useState<string|null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [calExporting, setCalExporting] = useState(false)

  useEffect(() => { setTitle('Event Details') }, [setTitle])
  
  useEffect(() => {
    let mounted = true
    async function loadUser(){
      try{
        const r = await fetch('/api/home_timeline', { credentials:'include', headers: { 'Accept': 'application/json' } })
        const j = await r.json().catch(()=>null)
        if (!mounted) return
        if (j?.success && j.username) {
          setCurrentUser(j.username)
        }
      }catch{}
    }
    loadUser()
    return () => { mounted = false }
  }, [])

  async function loadEvent(){
    try{
      const r = await fetch(`/get_calendar_event/${event_id}`, { credentials:'include' })
      const j = await r.json()
      if (j?.success && j.event){
        setEvent(j.event)
      }
    }catch{}
  }

  useEffect(() => {
    let mounted = true
    setLoading(true)
    loadEvent().finally(()=> mounted && setLoading(false))
    return () => { mounted = false }
  }, [event_id])

  async function rsvp(response:'going'|'maybe'|'not_going'){
    if (!event_id) return
    try{
      const r = await fetch(`/event/${event_id}/rsvp`, { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ response }) })
      const j = await r.json().catch(()=>null)
      if (j?.success){
        await loadEvent()
      }
    }catch{}
  }

  async function loadAttendees(){
    if (!event_id) return
    setAttendeeFilter('going')
    setRsvpDetails(null)
    setShowAttendees(true)
    try{
      const q = new URLSearchParams({ event_id: String(event_id) })
      const r = await fetch(`/get_event_rsvp_details?${q.toString()}`, { credentials:'include' })
      const j = await r.json()
      if (j?.success){
        setRsvpDetails(j.attendees as RSVPDetails)
      }
    }catch{}
  }

  async function addToDeviceCalendar() {
    if (!event_id || calExporting || !event) return
    setCalExporting(true)
    try {
      const snap: CalendarExportEventFields = {
        id: event.id,
        title: event.title,
        date: event.date,
        end_date: event.end_date,
        start_time: event.start_time,
        end_time: event.end_time,
        description: event.description,
        community_name: event.community_name,
      }
      const outcome = await exportEventToDeviceCalendar(event_id, snap)
      if (outcome.via === 'native') {
        alert('Event added to your calendar.')
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not export calendar'
      alert(msg)
    } finally {
      setCalExporting(false)
    }
  }

  async function deleteEvent(){
    if (!event_id || deleting) return
    setDeleting(true)
    try{
      const formData = new FormData()
      formData.append('event_id', String(event_id))
      const r = await fetch('/delete_calendar_event', { method: 'POST', credentials: 'include', body: formData })
      const j = await r.json().catch(()=>null)
      if (j?.success){
        if (event?.id) {
          try {
            await removeNativeCalendarMirrorForCpointEvent(Number(event.id))
          } catch {
            /* best effort */
          }
        }
        if (event?.community_id) {
          navigate(`/community/${event.community_id}/calendar_react`)
        } else {
          navigate(-1)
        }
      } else {
        alert(j?.message || 'Failed to delete event')
      }
    }catch(err){
      console.error('Error deleting event:', err)
      alert('Failed to delete event')
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }
  
  const canDelete = currentUser && event && (
    currentUser === event.username ||
    currentUser === 'admin' ||
    currentUser === event.creator_username
  )

  if (loading) {
    return (
      <div className="min-h-screen chat-thread-bg flex items-center justify-center px-4">
        <div className="text-[#9fb0b5] text-sm">Loading event…</div>
      </div>
    )
  }
  if (!event) {
    return (
      <div className="min-h-screen chat-thread-bg flex items-center justify-center px-4">
        <div className="text-red-400/90 text-sm">Event not found</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen chat-thread-bg text-white">
      <div className="max-w-2xl mx-auto px-3 pb-24 pt-2">
        <header className="mb-2 flex items-center">
          <button
            type="button"
            className="rounded-full p-2 text-[#cfe7e4] hover:bg-white/5"
            onClick={() => navigate(-1)}
            aria-label="Back"
          >
            <i className="fa-solid fa-arrow-left" />
          </button>
        </header>

        <div className={`${glassPanel} mb-3`}>
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-teal-300/60 to-transparent opacity-80 pointer-events-none" />
          <div className="relative px-4 py-3 border-b border-[#4db6ac]/30 bg-gradient-to-r from-[#4db6ac]/12 via-[#4db6ac]/6 to-transparent flex items-start justify-between gap-2">
            <h1 className="text-base sm:text-lg font-semibold text-white tracking-tight leading-snug min-w-0 flex-1">{event.title}</h1>
            {canDelete ? (
              <button
                type="button"
                className="shrink-0 p-2 rounded-full text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowDeleteConfirm(true)
                }}
                title="Delete Event"
                aria-label="Delete Event"
              >
                <i className="fa-solid fa-trash text-sm" />
              </button>
            ) : null}
          </div>

          <div className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              <i className="fa-solid fa-calendar text-[#4db6ac] w-4 pt-0.5 text-sm shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[#9fb0b5] mb-0.5">Date</div>
                <div className="text-white/90 text-sm">
                  {event.date}
                  {event.end_date && event.end_date !== event.date && event.end_date !== '0000-00-00' && (
                    <> → {event.end_date}</>
                  )}
                </div>
              </div>
            </div>

            {(event.start_time || event.end_time) && (
              <div className="flex items-start gap-3">
                <i className="fa-solid fa-clock text-[#4db6ac] w-4 pt-0.5 text-sm shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[#9fb0b5] mb-0.5">Time</div>
                  <div className="text-white/90 text-sm">
                    {(() => {
                      const times = [event.start_time, event.end_time]
                        .filter(t => t && t !== '0000-00-00 00:00:00' && t !== '00:00:00' && t !== '00:00')
                      const timeStr = times.join(' - ') || 'All day'
                      return event.timezone ? `${timeStr} ${event.timezone}` : timeStr
                    })()}
                  </div>
                </div>
              </div>
            )}

            {event.description && (
              <div className="flex items-start gap-3">
                <i className="fa-solid fa-info-circle text-[#4db6ac] w-4 pt-0.5 text-sm shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[#9fb0b5] mb-0.5">Description</div>
                  <div className="text-white/90 text-sm whitespace-pre-wrap leading-relaxed">{event.description}</div>
                </div>
              </div>
            )}

            <div className="flex items-start gap-3">
              <i className="fa-solid fa-user text-[#4db6ac] w-4 pt-0.5 text-sm shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[#9fb0b5] mb-0.5">Organizer</div>
                <div className="text-white/90 text-sm">{event.username}</div>
              </div>
            </div>

            <div className="pt-1">
              <button
                type="button"
                className="w-full min-h-[44px] py-2.5 rounded-xl border border-[#4db6ac]/40 bg-[#4db6ac]/10 text-sm font-medium text-[#8ff4e9] hover:bg-[#4db6ac]/20 transition-all disabled:opacity-50"
                disabled={calExporting}
                onClick={() => void addToDeviceCalendar()}
              >
                {calExporting ? (
                  'Preparing…'
                ) : (
                  <>
                    <i className="fa-regular fa-calendar-plus mr-2" aria-hidden />
                    Add to my calendar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className={`${glassPanel} p-4 mb-3 relative`}>
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-teal-300/50 to-transparent opacity-70 pointer-events-none" />
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-lg font-semibold text-green-400 tabular-nums">{event.rsvp_counts?.going || 0}</div>
              <div className="text-[11px] text-[#9fb0b5] mt-0.5">Going</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-yellow-400 tabular-nums">{event.rsvp_counts?.maybe || 0}</div>
              <div className="text-[11px] text-[#9fb0b5] mt-0.5">Maybe</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-red-400/90 tabular-nums">{event.rsvp_counts?.not_going || 0}</div>
              <div className="text-[11px] text-[#9fb0b5] mt-0.5">Can't Go</div>
            </div>
          </div>
          {typeof event.rsvp_counts?.no_response === 'number' && event.rsvp_counts.no_response > 0 && (
            <div className="mt-3 pt-3 border-t border-white/10 text-center">
              <div className="text-xs text-[#9fb0b5]">{event.rsvp_counts.no_response} haven't responded yet</div>
            </div>
          )}
        </div>

        <div className={`${glassPanel} p-4 mb-3 relative`}>
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-teal-300/50 to-transparent opacity-70 pointer-events-none" />
          <div className="text-center mb-3 text-white/90 text-sm font-medium">Will you attend this event?</div>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              className={`min-h-[44px] py-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${
                event.user_rsvp==='going'
                  ? 'border-green-500/60 bg-green-500/10 text-green-400'
                  : 'border-white/12 text-white/80 hover:border-teal-400/35 hover:bg-white/[0.04]'
              }`}
              onClick={()=> rsvp('going')}
            >
              <i className="fa-solid fa-check-circle text-base" />
              <span className="text-xs font-medium">Going</span>
            </button>
            <button
              type="button"
              className={`min-h-[44px] py-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${
                event.user_rsvp==='maybe'
                  ? 'border-yellow-500/60 bg-yellow-500/10 text-yellow-400'
                  : 'border-white/12 text-white/80 hover:border-teal-400/35 hover:bg-white/[0.04]'
              }`}
              onClick={()=> rsvp('maybe')}
            >
              <i className="fa-solid fa-question-circle text-base" />
              <span className="text-xs font-medium">Maybe</span>
            </button>
            <button
              type="button"
              className={`min-h-[44px] py-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${
                event.user_rsvp==='not_going'
                  ? 'border-red-500/55 bg-red-500/10 text-red-400'
                  : 'border-white/12 text-white/80 hover:border-teal-400/35 hover:bg-white/[0.04]'
              }`}
              onClick={()=> rsvp('not_going')}
            >
              <i className="fa-solid fa-times-circle text-base" />
              <span className="text-xs font-medium">Can't Go</span>
            </button>
          </div>
        </div>

        <button
          type="button"
          className="w-full min-h-[44px] py-2.5 rounded-xl border border-white/15 liquid-glass-surface hover:border-teal-400/35 text-sm text-white/90 mb-3 shadow-[0_12px_32px_rgba(0,0,0,0.35)] transition-all"
          onClick={()=> loadAttendees()}
        >
          View Who's Coming
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="min-h-[44px] py-2.5 rounded-xl bg-[#4db6ac] text-black text-sm font-medium hover:brightness-110 shadow-[0_12px_28px_rgba(77,182,172,0.25)]"
            onClick={()=> navigate(event.community_id ? `/community/${event.community_id}/calendar_react` : '/premium_dashboard')}
          >
            View Events
          </button>
          <button
            type="button"
            className="min-h-[44px] py-2.5 rounded-xl border border-white/15 liquid-glass-surface text-sm text-white/90 hover:border-teal-400/35"
            onClick={()=> navigate(event.community_id ? `/community_feed_react/${event.community_id}` : '/premium_dashboard')}
          >
            Back to Community
          </button>
        </div>
      </div>

      {showAttendees && (
        <div
          className="fixed left-0 right-0 bottom-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center px-4"
          style={{
            top: 'calc(56px + env(safe-area-inset-top, 0px))',
            paddingTop: '16px',
            paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
          }}
          onClick={(e)=> e.currentTarget===e.target && setShowAttendees(false)}
        >
          <div
            className={`w-full max-w-[560px] ${glassPanel} p-4 flex flex-col relative`}
            style={{ maxHeight: '100%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-teal-300/55 to-transparent opacity-80 pointer-events-none" />
            <div className="flex items-center justify-between gap-3 mb-3 flex-shrink-0">
              <div className="font-semibold text-sm text-white">Who's coming</div>
              <div className="flex items-center gap-2">
                <select
                  value={attendeeFilter}
                  onChange={(e)=> setAttendeeFilter(e.target.value as 'going'|'maybe'|'not_going'|'no_response')}
                  className="rounded-lg liquid-glass-surface border border-white/12 px-2 py-1.5 text-xs text-white/90 focus:border-[#4db6ac]/50 outline-none"
                >
                  <option value="going">Going</option>
                  <option value="maybe">Maybe</option>
                  <option value="not_going">Not going</option>
                  <option value="no_response">Not responded</option>
                </select>
                <button
                  type="button"
                  className="px-2 py-1 rounded-full border border-white/12 text-xs text-white/80 hover:bg-white/5"
                  onClick={()=> setShowAttendees(false)}
                >
                  ✕
                </button>
              </div>
            </div>

            {!rsvpDetails ? (
              <div className="text-[#9fb0b5] text-sm">Loading…</div>
            ) : (
              (() => {
                const list =
                  attendeeFilter === 'going' ? rsvpDetails.going :
                  attendeeFilter === 'maybe' ? rsvpDetails.maybe :
                  attendeeFilter === 'not_going' ? rsvpDetails.not_going :
                  rsvpDetails.no_response

                const label =
                  attendeeFilter === 'going' ? 'Going' :
                  attendeeFilter === 'maybe' ? 'Maybe' :
                  attendeeFilter === 'not_going' ? 'Not going' :
                  'Not responded'

                const labelClass =
                  attendeeFilter === 'going' ? 'text-green-400' :
                  attendeeFilter === 'maybe' ? 'text-yellow-400' :
                  attendeeFilter === 'not_going' ? 'text-red-400' :
                  'text-[#9fb0b5]'

                return (
                  <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/10 liquid-glass-surface p-3">
                    <div className={`font-medium text-xs mb-2 ${labelClass}`}>{label} ({list.length})</div>
                    {list.length === 0 ? (
                      <div className="text-xs text-[#9fb0b5]">No users in this category yet.</div>
                    ) : (
                      <ul className="space-y-1 text-sm text-white/88">
                        {list.map((u, idx) => (<li key={`${attendeeFilter}-${idx}`}>{u.username}</li>))}
                      </ul>
                    )}
                  </div>
                )
              })()
            )}
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-[110] bg-black/75 backdrop-blur-md flex items-center justify-center px-4"
          onClick={(e)=> e.currentTarget===e.target && setShowDeleteConfirm(false)}
        >
          <div className={`w-full max-w-sm ${glassPanel} p-5 relative`} onClick={(e) => e.stopPropagation()}>
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-teal-300/45 to-transparent opacity-70 pointer-events-none" />
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-red-500/18 flex items-center justify-center shrink-0">
                <i className="fa-solid fa-trash text-red-400 text-sm" />
              </div>
              <div className="font-semibold text-base text-white">Delete Event?</div>
            </div>
            <p className="text-xs text-[#9fb0b5] mb-4 leading-relaxed">
              Are you sure you want to delete &quot;{event?.title}&quot;? This action cannot be undone and will remove all RSVPs.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 min-h-[44px] py-2 rounded-xl border border-white/12 text-sm text-white/90 hover:bg-white/[0.05] transition-colors"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 min-h-[44px] py-2 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
                onClick={deleteEvent}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
