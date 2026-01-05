import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

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

  useEffect(() => { setTitle('Event Details') }, [setTitle])
  
  // Load current user
  useEffect(() => {
    let mounted = true
    async function loadUser(){
      try{
        const r = await fetch('/api/home_timeline', { credentials:'include' })
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

  async function deleteEvent(){
    if (!event_id || deleting) return
    setDeleting(true)
    try{
      const formData = new FormData()
      formData.append('event_id', String(event_id))
      const r = await fetch('/delete_calendar_event', { 
        method: 'POST', 
        credentials: 'include',
        body: formData
      })
      const j = await r.json().catch(()=>null)
      if (j?.success){
        // Navigate back to calendar or community
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
  
  // Check if current user can delete the event
  const canDelete = currentUser && event && (
    currentUser === event.username || // Event creator
    currentUser === 'admin' || // App admin
    currentUser === event.creator_username // Community owner
  )

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading event…</div>
  if (!event) return <div className="p-4 text-red-400">Event not found</div>

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="fixed left-0 right-0 top-0 h-14 border-b border-white/10 bg-black/70 backdrop-blur flex items-center justify-between px-3 z-40">
        <div className="flex items-center">
          <button className="px-3 py-2 rounded-full text-[#cfd8dc] hover:text-[#4db6ac]" onClick={()=> navigate(-1)}>
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="ml-2 font-semibold">Event Details</div>
        </div>
        {canDelete && (
          <button 
            className="px-3 py-2 rounded-full text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
            onClick={() => setShowDeleteConfirm(true)}
            title="Delete Event"
          >
            <i className="fa-solid fa-trash" />
          </button>
        )}
      </div>

      <div className="max-w-2xl mx-auto pt-16 px-3 pb-24">
        {/* Event Info Card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] overflow-hidden mb-4">
          <div className="px-4 py-3 bg-[#4db6ac]">
            <h1 className="text-xl font-bold text-black">{event.title}</h1>
          </div>
          
          <div className="p-4 space-y-3">
            {/* Date */}
            <div className="flex items-start gap-3">
              <i className="fa-solid fa-calendar text-[#4db6ac] w-5 pt-0.5" />
              <div className="flex-1">
                <div className="text-xs text-[#9fb0b5] mb-0.5">Date</div>
                <div className="text-white">
                  {event.date}
                  {event.end_date && event.end_date !== event.date && event.end_date !== '0000-00-00' && (
                    <> → {event.end_date}</>
                  )}
                </div>
              </div>
            </div>

            {/* Time */}
            {(event.start_time || event.end_time) && (
              <div className="flex items-start gap-3">
                <i className="fa-solid fa-clock text-[#4db6ac] w-5 pt-0.5" />
                <div className="flex-1">
                  <div className="text-xs text-[#9fb0b5] mb-0.5">Time</div>
                  <div className="text-white">
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

            {/* Description */}
            {event.description && (
              <div className="flex items-start gap-3">
                <i className="fa-solid fa-info-circle text-[#4db6ac] w-5 pt-0.5" />
                <div className="flex-1">
                  <div className="text-xs text-[#9fb0b5] mb-0.5">Description</div>
                  <div className="text-white whitespace-pre-wrap">{event.description}</div>
                </div>
              </div>
            )}

            {/* Organizer */}
            <div className="flex items-start gap-3">
              <i className="fa-solid fa-user text-[#4db6ac] w-5 pt-0.5" />
              <div className="flex-1">
                <div className="text-xs text-[#9fb0b5] mb-0.5">Organizer</div>
                <div className="text-white">{event.username}</div>
              </div>
            </div>
          </div>
        </div>

        {/* RSVP Counts */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 mb-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-green-400">{event.rsvp_counts?.going || 0}</div>
              <div className="text-xs text-[#9fb0b5] mt-1">Going</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-yellow-400">{event.rsvp_counts?.maybe || 0}</div>
              <div className="text-xs text-[#9fb0b5] mt-1">Maybe</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-red-400">{event.rsvp_counts?.not_going || 0}</div>
              <div className="text-xs text-[#9fb0b5] mt-1">Can't Go</div>
            </div>
          </div>
          {typeof event.rsvp_counts?.no_response === 'number' && event.rsvp_counts.no_response > 0 && (
            <div className="mt-3 pt-3 border-t border-white/10 text-center">
              <div className="text-sm text-[#9fb0b5]">{event.rsvp_counts.no_response} haven't responded yet</div>
            </div>
          )}
        </div>

        {/* RSVP Question */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 mb-4">
          <div className="text-center mb-4 text-white font-medium">Will you attend this event?</div>
          <div className="grid grid-cols-3 gap-3">
            <button 
              className={`py-3 rounded-lg border flex flex-col items-center gap-2 transition-all ${event.user_rsvp==='going' ? 'border-green-500 bg-green-500/10 text-green-400' : 'border-white/10 text-white/80 hover:bg-white/5'}`}
              onClick={()=> rsvp('going')}
            >
              <i className="fa-solid fa-check-circle text-2xl" />
              <span className="text-sm font-medium">Going</span>
            </button>
            <button 
              className={`py-3 rounded-lg border flex flex-col items-center gap-2 transition-all ${event.user_rsvp==='maybe' ? 'border-yellow-500 bg-yellow-500/10 text-yellow-400' : 'border-white/10 text-white/80 hover:bg-white/5'}`}
              onClick={()=> rsvp('maybe')}
            >
              <i className="fa-solid fa-question-circle text-2xl" />
              <span className="text-sm font-medium">Maybe</span>
            </button>
            <button 
              className={`py-3 rounded-lg border flex flex-col items-center gap-2 transition-all ${event.user_rsvp==='not_going' ? 'border-red-500 bg-red-500/10 text-red-400' : 'border-white/10 text-white/80 hover:bg-white/5'}`}
              onClick={()=> rsvp('not_going')}
            >
              <i className="fa-solid fa-times-circle text-2xl" />
              <span className="text-sm font-medium">Can't Go</span>
            </button>
          </div>
        </div>

        {/* View Attendees Button */}
        <button 
          className="w-full py-3 rounded-lg border border-white/10 bg-white/[0.035] hover:bg-white/5 text-sm mb-4"
          onClick={()=> loadAttendees()}
        >
          View Who's Coming
        </button>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button 
            className="py-3 rounded-lg bg-[#4db6ac] text-black font-medium hover:brightness-110"
            onClick={()=> navigate(event.community_id ? `/community/${event.community_id}/calendar_react` : '/communities_react')}
          >
            View Events
          </button>
          <button 
            className="py-3 rounded-lg border border-white/10 bg-white/[0.035] hover:bg-white/5"
            onClick={()=> navigate(event.community_id ? `/community_feed_react/${event.community_id}` : '/communities_react')}
          >
            Back to Community
          </button>
        </div>
      </div>
      {/* Attendees Modal */}
      {showAttendees && (
        <div
          className="fixed left-0 right-0 bottom-0 z-[100] bg-black/60 backdrop-blur flex items-center justify-center px-4"
          style={{
            top: 'calc(56px + env(safe-area-inset-top, 0px))',
            paddingTop: '16px',
            paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
          }}
          onClick={(e)=> e.currentTarget===e.target && setShowAttendees(false)}
        >
          <div 
            className="w-full max-w-[560px] rounded-2xl border border-white/10 bg-black p-4 flex flex-col"
            style={{ maxHeight: '100%' }}
          >
            <div className="flex items-center justify-between gap-3 mb-3 flex-shrink-0">
              <div className="font-semibold">Who's coming</div>
              <div className="flex items-center gap-2">
                <select
                  value={attendeeFilter}
                  onChange={(e)=> setAttendeeFilter(e.target.value as any)}
                  className="rounded-lg bg-black border border-white/10 px-3 py-2 text-sm text-white/90 focus:border-[#4db6ac]/70 outline-none"
                >
                  <option value="going">Going</option>
                  <option value="maybe">Maybe</option>
                  <option value="not_going">Not going</option>
                  <option value="no_response">Not responded</option>
                </select>
                <button className="px-2 py-1 rounded-full border border-white/10" onClick={()=> setShowAttendees(false)}>✕</button>
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
                  <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className={`font-medium mb-2 ${labelClass}`}>{label} ({list.length})</div>
                    {list.length === 0 ? (
                      <div className="text-sm text-[#9fb0b5]">No users in this category yet.</div>
                    ) : (
                      <ul className="space-y-1 text-sm text-white/90">
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

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-[110] bg-black/80 backdrop-blur flex items-center justify-center px-4"
          onClick={(e)=> e.currentTarget===e.target && setShowDeleteConfirm(false)}
        >
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0b0f10] p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <i className="fa-solid fa-trash text-red-400" />
              </div>
              <div className="font-semibold text-lg text-white">Delete Event?</div>
            </div>
            <p className="text-sm text-[#9fb0b5] mb-5">
              Are you sure you want to delete "{event?.title}"? This action cannot be undone and will remove all RSVPs.
            </p>
            <div className="flex gap-3">
              <button
                className="flex-1 py-2.5 rounded-lg border border-white/10 text-white hover:bg-white/5 transition-colors"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="flex-1 py-2.5 rounded-lg bg-red-500 text-white font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
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
