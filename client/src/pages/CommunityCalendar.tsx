import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

type EventItem = {
  id: number
  title: string
  date: string
  end_date?: string|null
  start_time?: string|null
  end_time?: string|null
  description?: string|null
  user_rsvp?: string|null
  rsvp_counts?: { going: number; maybe: number; not_going: number; no_response?: number }
}

type RSVPDetails = {
  going: { username: string }[]
  maybe: { username: string }[]
  not_going: { username: string }[]
  no_response: { username: string }[]
}

export default function CommunityCalendar(){
  const { community_id } = useParams()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [events, setEvents] = useState<EventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [members, setMembers] = useState<Array<{ username:string; profile_picture?:string|null }>>([])
  const [inviteAll, setInviteAll] = useState(false)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [activeTab, setActiveTab] = useState<'calendar'|'create'>('calendar')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string| null>(null)
  const [modalEvent, setModalEvent] = useState<EventItem| null>(null)
  const [modalDetails, setModalDetails] = useState<RSVPDetails| null>(null)
  const formRef = useRef<HTMLFormElement|null>(null)
  const scrollRef = useRef<HTMLDivElement|null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [hasUnseenAnnouncements, setHasUnseenAnnouncements] = useState(false)

  useEffect(() => { setTitle('Calendar') }, [setTitle])

  useEffect(() => {
    let mounted = true
    async function check(){
      try{
        const r = await fetch(`/get_community_announcements?community_id=${community_id}`, { credentials:'include' })
        const j = await r.json()
        if (!mounted) return
        if (j?.success){
          const key = `ann_last_seen_${community_id}`
          const lastSeenStr = localStorage.getItem(key)
          const lastSeen = lastSeenStr ? Date.parse(lastSeenStr) : 0
          const hasNew = (j.announcements || []).some((a:any) => Date.parse(a.created_at) > lastSeen)
          setHasUnseenAnnouncements(hasNew)
        }
      }catch{}
    }
    check()
    return () => { mounted = false }
  }, [community_id])

  async function fetchAnnouncements(){
    try{
      const r = await fetch(`/get_community_announcements?community_id=${community_id}`, { credentials:'include' })
      const j = await r.json()
      if (j?.success){
        try{
          const key = `ann_last_seen_${community_id}`
          localStorage.setItem(key, new Date().toISOString())
          setHasUnseenAnnouncements(false)
        }catch{}
        alert('No UI here: announcements viewed.')
      }
    }catch{}
  }

  async function reloadEvents(){
    try{
      const r = await fetch('/get_calendar_events', { credentials:'include' })
      const j = await r.json()
      if (j?.success && Array.isArray(j.events)){
        const filtered = (j.events as any[]).filter(e => `${e.community_id||''}` === `${community_id}`)
        setEvents(filtered as any)
      }
    }catch{}
  }

  useEffect(() => {
    let mounted = true
    setLoading(true)
    reloadEvents().finally(()=> mounted && setLoading(false))
    ;(async () => {
      try{
        const r = await fetch(`/community/${community_id}/members/list`, { credentials:'include' })
        const j = await r.json()
        if (j?.success && Array.isArray(j.members)){
          setMembers(j.members)
        }
      }catch{}
    })()
    return () => { mounted = false }
  }, [community_id])

  const grouped = useMemo(() => {
    const map = new Map<string, EventItem[]>()
    events.forEach(ev => {
      const key = ev.date
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(ev)
    })
    return Array.from(map.entries()).sort(([a],[b]) => a.localeCompare(b))
  }, [events])

  async function createEvent(formData: FormData){
    const params = new URLSearchParams()
    ;['title','date','end_date','start_time','end_time','description'].forEach(k => {
      const v = (formData.get(k) as string) || ''
      if (v) params.append(k, v)
    })
    if (community_id) params.append('community_id', String(community_id))
    params.append('invite_all', inviteAll ? 'true' : 'false')
    if (!inviteAll){
      Object.keys(selected).filter(u => selected[u]).forEach(u => params.append('invited_members[]', u))
    }
    const r = await fetch('/add_calendar_event', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: params })
    const j = await r.json().catch(()=>null)
    if (j?.success){
      await reloadEvents()
      setSuccessMsg('Event created')
      setActiveTab('calendar')
      try { formRef.current?.reset(); setInviteAll(false); setSelected({}); setInviteOpen(false) } catch {}
      setTimeout(() => setSuccessMsg(null), 2000)
    } else {
      alert(j?.message || 'Failed to create event')
    }
  }

  async function rsvp(eventId:number, response:'going'|'maybe'|'not_going'){
    try{
      const r = await fetch(`/event/${eventId}/rsvp`, { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ response }) })
      const j = await r.json().catch(()=>null)
      if (j?.success){
        await reloadEvents()
      }
    }catch{}
  }

  async function openInviteDetails(ev: EventItem){
    setModalEvent(ev)
    setModalDetails(null)
    try{
      const q = new URLSearchParams({ event_id: String(ev.id) })
      const r = await fetch(`/get_event_rsvp_details?${q.toString()}`, { credentials:'include' })
      const j = await r.json()
      if (j?.success){
        setModalDetails(j.attendees as RSVPDetails)
      }
    }catch{}
  }

  async function deleteEvent(ev: EventItem){
    if (!confirm('Delete this event?')) return
    try{
      const body = new URLSearchParams({ event_id: String(ev.id) })
      const r = await fetch('/delete_calendar_event', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body })
      const j = await r.json().catch(()=>null)
      if (j?.success){
        await reloadEvents()
        setModalEvent(null)
        setModalDetails(null)
      } else {
        alert(j?.message || 'Could not delete')
      }
    }catch{}
  }

  return (
    <div className="h-screen overflow-hidden bg-black text-white">
      <div className="fixed left-0 right-0 top-14 h-10 bg-black/70 backdrop-blur z-40">
        <div className="max-w-2xl mx-auto h-full flex items-center gap-2 px-2">
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> navigate(`/community_feed_react/${community_id}`)} aria-label="Back">
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="flex-1 h-full flex">
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='calendar' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} onClick={()=> setActiveTab('calendar')}>
              <div className="pt-2">Calendar</div>
              <div className={`h-0.5 rounded-full w-16 mx-auto mt-1 ${activeTab==='calendar' ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
            </button>
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='create' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} onClick={()=> setActiveTab('create')}>
              <div className="pt-2">Create Event</div>
              <div className={`h-0.5 rounded-full w-16 mx-auto mt-1 ${activeTab==='create' ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
            </button>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="max-w-2xl mx-auto pt-[70px] h-[calc(100vh-70px)] pb-20 px-3 overflow-y-auto no-scrollbar">
        {successMsg && (
          <div className="mb-3 text-sm px-3 py-2 rounded-md bg-teal-700/15 text-teal-300 border border-teal-700/30">{successMsg}</div>
        )}

        {activeTab === 'create' ? (
          <form ref={formRef} className="rounded-2xl border border-white/10 p-3 bg-white/[0.035] space-y-3" onSubmit={(e)=> { e.preventDefault(); createEvent(new FormData(e.currentTarget)) }}>
            <div className="text-sm font-medium">Create Event</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="col-span-2 text-xs text-[#9fb0b5]">Title
                <input name="title" placeholder="Title" className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none" required />
              </label>
              <label className="text-xs text-[#9fb0b5]">Start date
                <input name="date" type="date" className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none" required />
              </label>
              <label className="text-xs text-[#9fb0b5]">End date
                <input name="end_date" type="date" className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none" />
              </label>
              <label className="text-xs text-[#9fb0b5]">Start time
                <input name="start_time" type="time" className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none" />
              </label>
              <label className="text-xs text-[#9fb0b5]">End time
                <input name="end_time" type="time" className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none" />
              </label>
              <label className="col-span-2 text-xs text-[#9fb0b5]">Description
                <input name="description" placeholder="Description" className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none" />
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button type="button" className={`px-2 py-1 rounded-md border text-xs hover:bg-white/5 ${inviteAll ? 'border-teal-500 text-teal-300 bg-teal-700/15' : 'border-white/10'}`} onClick={()=> { setInviteAll(v=> !v); if (!inviteAll) setInviteOpen(false) }}>
                Invite all members
              </button>
              <button type="button" className="px-2 py-1 rounded-md border border-white/10 text-xs hover:bg-white/5" onClick={()=> setInviteOpen(o=>!o)}>
                Select members
              </button>
            </div>

            {!inviteAll && inviteOpen && (
              <div className="max-h-48 overflow-y-auto border border-white/10 rounded-md p-2 space-y-1">
                {members.length === 0 ? (
                  <div className="text-sm text-[#9fb0b5]">No members</div>
                ) : members.map(m => (
                  <label key={m.username} className="flex items-center justify-between gap-2 py-1 px-2 rounded hover:bg-white/5">
                    <span className="text-sm">{m.username}</span>
                    <input type="checkbox" className="accent-[#4db6ac] w-4 h-4" checked={!!selected[m.username]} onChange={(e)=> setSelected(s => ({ ...s, [m.username]: e.target.checked }))} />
                  </label>
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <button className="px-3 py-1.5 rounded-md bg-[#4db6ac] text-black text-sm hover:brightness-110">Add</button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            {loading ? (
              <div className="text-[#9fb0b5]">Loading events…</div>
            ) : grouped.length === 0 ? (
              <div className="text-[#9fb0b5]">No events yet.</div>
            ) : (
              grouped.map(([date, items]) => (
                <div key={date} className="rounded-2xl border border-white/10 bg-white/[0.035] overflow-hidden">
                  <div className="px-3 py-2 bg-white/5 text-xs text-[#9fb0b5]">{date}</div>
                  <div className="divide-y divide-white/10">
                    {items.map(ev => (
                      <div key={ev.id} className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="font-medium flex-1">{ev.title}</div>
                          <div className="text-xs text-[#9fb0b5]">{[ev.start_time, ev.end_time].filter(Boolean).join(' - ')}</div>
                        </div>
                        {ev.description ? (<div className="text-sm text-[#cfd8dc] mt-1">{ev.description}</div>) : null}
                        <div className="text-xs text-[#9fb0b5] mt-2 flex items-center gap-2 flex-wrap">
                          <span>RSVP:</span>
                          <button className={`px-2 py-1 rounded-full border ${ev.user_rsvp==='going'?'border-teal-500 text-teal-300 bg-teal-700/15':'border-white/10'}`} onClick={()=> rsvp(ev.id, 'going')}>Going {ev.rsvp_counts?.going||0}</button>
                          <button className={`px-2 py-1 rounded-full border ${ev.user_rsvp==='maybe'?'border-teal-500 text-teal-300 bg-teal-700/15':'border-white/10'}`} onClick={()=> rsvp(ev.id, 'maybe')}>Maybe {ev.rsvp_counts?.maybe||0}</button>
                          <button className={`px-2 py-1 rounded-full border ${ev.user_rsvp==='not_going'?'border-teal-500 text-teal-300 bg-teal-700/15':'border-white/10'}`} onClick={()=> rsvp(ev.id, 'not_going')}>Not going {ev.rsvp_counts?.not_going||0}</button>
                          {typeof ev.rsvp_counts?.no_response === 'number' && (
                            <span className="px-2 py-1 rounded-full border border-white/10">No response {ev.rsvp_counts.no_response}</span>
                          )}
                          <button title="Invite details" className="ml-auto px-2 py-1 rounded-md border border-white/10 hover:bg-white/5" onClick={()=> openInviteDetails(ev)}>
                            <i className="fa-regular fa-circle-question" />
                          </button>
                          <button title="Delete event" className="px-2 py-1 rounded-md border border-red-400 text-red-300 hover:bg-red-500/10" onClick={()=> deleteEvent(ev)}>
                            <i className="fa-regular fa-trash-can" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Bottom navigation bar - floating (same as community) */}
      <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-40 w-[94%] max-w-[1200px] rounded-2xl border border-white/10 bg-black/80 backdrop-blur shadow-lg">
        <div className="h-14 px-6 flex items-center justify-between text-[#cfd8dc]">
          <button className="p-2 rounded-full hover:bg-white/5" aria-label="Home" onClick={()=> scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
            <i className="fa-solid fa-house" />
          </button>
          <button className="p-2 rounded-full hover:bg:white/5" aria-label="Members" onClick={()=> navigate(`/community/${community_id}/members`)}>
            <i className="fa-solid fa-users" />
          </button>
          <button className="w-10 h-10 rounded-md bg-[#4db6ac] text-black hover:brightness-110 grid place-items-center" aria-label="New Post" onClick={()=> navigate(`/compose?community_id=${community_id}`)}>
            <i className="fa-solid fa-plus" />
          </button>
          <button className="relative p-2 rounded-full hover:bg-white/5" aria-label="Announcements" onClick={()=> { fetchAnnouncements() }}>
            <span className="relative inline-block">
              <i className="fa-solid fa-bullhorn" style={hasUnseenAnnouncements ? { color:'#4db6ac' } : undefined} />
              {hasUnseenAnnouncements ? (<span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[#4db6ac] rounded-full" />) : null}
            </span>
          </button>
          <button className="p-2 rounded-full hover:bg:white/5" aria-label="More" onClick={()=> setMoreOpen(true)}>
            <i className="fa-solid fa-ellipsis" />
          </button>
        </div>
      </div>

      {moreOpen && (
        <div className="fixed inset-0 z-[95] bg-black/30 flex items-end justify-end" onClick={(e)=> e.currentTarget===e.target && setMoreOpen(false)}>
          <div className="w-[75%] max-w-sm mr-2 mb-2 bg-black/80 backdrop-blur border border-white/10 rounded-2xl p-2 space-y-2 transition-transform duration-200 ease-out translate-y-0">
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg:white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/polls_react`) }}>Polls</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg:white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/calendar_react`) }}>Calendar</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg:white/5" onClick={()=> { setMoreOpen(false); window.location.href = `/community/${community_id}/resources` }}>Forum</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg:white/5" onClick={()=> { setMoreOpen(false); window.location.href = `/community/${community_id}/resources` }}>Useful Links</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg:white/5" onClick={()=> { setMoreOpen(false); window.location.href = `/issues` }}>Report Issue</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg:white/5" onClick={()=> { setMoreOpen(false); window.location.href = `/anonymous_feedback` }}>Anonymous feedback</button>
          </div>
        </div>
      )}

      {modalEvent && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur flex items-end justify-center" onClick={(e)=> e.currentTarget===e.target && setModalEvent(null)}>
          <div className="w-[96%] max-w-[560px] mb-4 rounded-2xl border border-white/10 bg-black p-3">
            <div className="mb-2">
              <div className="font-semibold text-white">{modalEvent.title}</div>
              <div className="text-xs text-[#9fb0b5]">
                {modalEvent.date}{modalEvent.end_date ? ` → ${modalEvent.end_date}` : ''}
                {modalEvent.start_time ? ` • ${modalEvent.start_time}` : ''}{modalEvent.end_time ? ` - ${modalEvent.end_time}` : ''}
              </div>
              {modalEvent.description ? (<div className="text-sm text-[#cfd8dc] mt-1">{modalEvent.description}</div>) : null}
            </div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-[#9fb0b5]">Invite details</div>
              <button className="px-2 py-1 rounded-full border border-white/10" onClick={()=> setModalEvent(null)}>✕</button>
            </div>
            {!modalDetails ? (
              <div className="text-[#9fb0b5] text-sm">Loading…</div>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="font-medium text-teal-300 mb-1">Going ({modalDetails.going.length})</div>
                  <ul className="space-y-1">
                    {modalDetails.going.map((u,idx)=> (<li key={`g-${idx}`}>{u.username}</li>))}
                  </ul>
                </div>
                <div>
                  <div className="font-medium text-[#cfd8dc] mb-1">Maybe ({modalDetails.maybe.length})</div>
                  <ul className="space-y-1">
                    {modalDetails.maybe.map((u,idx)=> (<li key={`m-${idx}`}>{u.username}</li>))}
                  </ul>
                </div>
                <div>
                  <div className="font-medium text-red-300 mb-1">Not going ({modalDetails.not_going.length})</div>
                  <ul className="space-y-1">
                    {modalDetails.not_going.map((u,idx)=> (<li key={`n-${idx}`}>{u.username}</li>))}
                  </ul>
                </div>
                <div>
                  <div className="font-medium text-[#9fb0b5] mb-1">No response ({modalDetails.no_response.length})</div>
                  <ul className="space-y-1">
                    {modalDetails.no_response.map((u,idx)=> (<li key={`r-${idx}`}>{u.username}</li>))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

