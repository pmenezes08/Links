import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
  rsvp_counts?: { going: number; maybe: number; not_going: number }
}

export default function CommunityCalendar(){
  const { community_id } = useParams()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [events, setEvents] = useState<EventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)
  const [members, setMembers] = useState<Array<{ username:string; profile_picture?:string|null }>>([])
  const [inviteAll, setInviteAll] = useState(false)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [activeTab, setActiveTab] = useState<'calendar'|'create'>('calendar')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string| null>(null)
  const formRef = useRef<HTMLFormElement|null>(null)

  useEffect(() => { setTitle('Calendar') }, [setTitle])

  useEffect(() => {
    let mounted = true
    async function load(){
      setLoading(true)
      try{
        // Reuse existing API that returns calendar events with RSVP info
        const r = await fetch('/get_calendar_events', { credentials:'include' })
        const j = await r.json()
        if (!mounted) return
        if (j?.success && Array.isArray(j.events)){
          const filtered = (j.events as any[]).filter(e => !community_id || `${e.community_id||''}` === `${community_id}`)
          setEvents(filtered as any)
        } else {
          setError('Failed to load events')
        }
      }catch{
        if (!mounted) return
        setError('Failed to load events')
      } finally { mounted && setLoading(false) }
    }
    load()
    ;(async () => {
      try{
        const r = await fetch(`/community/${community_id}/members/list`, { credentials:'include' })
        const j = await r.json()
        if (j?.success && Array.isArray(j.members)){
          if (!mounted) return
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
      try{ const rr = await fetch('/get_calendar_events', { credentials:'include' }); const jj = await rr.json(); if (jj?.success) setEvents((jj.events||[]).filter((e:any)=> !community_id || `${e.community_id||''}`===`${community_id}`)) }catch{}
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
      await fetch(`/community/${community_id}/event/${eventId}/rsvp`, { credentials:'include' })
      setEvents(prev => prev.map(ev => ev.id===eventId ? ({ ...ev, user_rsvp: response, rsvp_counts: { ...(ev.rsvp_counts||{going:0,maybe:0,not_going:0}), [response]: ((ev.rsvp_counts?.[response]||0) + 1) } }) : ev))
    }catch{}
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="sticky top-0 z-30 h-12 border-b border-white/10 bg-black/80 backdrop-blur flex items-center px-3 gap-2">
        <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> navigate(`/community_feed_react/${community_id}`)} aria-label="Back">
          <i className="fa-solid fa-arrow-left" />
        </button>
        <div className="font-medium">Calendar</div>
      </div>

      <div className="max-w-2xl mx-auto p-3">
        <div className="mb-3 inline-flex border border-white/10 rounded-xl overflow-hidden">
          <button className={`px-4 py-2 text-sm ${activeTab==='calendar'?'bg-white/10 text-white':'text-[#9fb0b5]'}`} onClick={()=> setActiveTab('calendar')}>Calendar</button>
          <button className={`px-4 py-2 text-sm ${activeTab==='create'?'bg-white/10 text-white':'text-[#9fb0b5]'}`} onClick={()=> setActiveTab('create')}>Create</button>
        </div>

        {successMsg && (
          <div className="mb-3 text-sm px-3 py-2 rounded-md bg-teal-700/15 text-teal-300 border border-teal-700/30">{successMsg}</div>
        )}

        {activeTab === 'create' ? (
          <form ref={formRef} className="rounded-xl border border-white/10 p-3 bg-white/5 space-y-3" onSubmit={(e)=> { e.preventDefault(); createEvent(new FormData(e.currentTarget)) }}>
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

            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={inviteAll} onChange={(e)=> setInviteAll(e.target.checked)} />
                Invite all members
              </label>
              <button type="button" className="px-3 py-1.5 rounded-md border border-white/10 text-sm hover:bg-white/5" onClick={()=> setInviteAll(true)}>Invite all</button>
              <button type="button" className="px-3 py-1.5 rounded-md border border-white/10 text-sm hover:bg-white/5" onClick={()=> setInviteOpen(o=>!o)}>
                Select members to invite
              </button>
            </div>

            {!inviteAll && inviteOpen && (
              <div className="max-h-48 overflow-y-auto border border-white/10 rounded-md p-2">
                {members.length === 0 ? (
                  <div className="text-sm text-[#9fb0b5]">No members</div>
                ) : members.map(m => (
                  <label key={m.username} className="flex items-center gap-2 py-1">
                    <input type="checkbox" checked={!!selected[m.username]} onChange={(e)=> setSelected(s => ({ ...s, [m.username]: e.target.checked }))} />
                    <span className="text-sm">{m.username}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <button className="px-4 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110">Add</button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            {loading ? (
              <div className="text-[#9fb0b5]">Loading events…</div>
            ) : error ? (
              <div className="text-red-400">{error}</div>
            ) : grouped.length === 0 ? (
              <div className="text-[#9fb0b5]">No events yet.</div>
            ) : (
              grouped.map(([date, items]) => (
                <div key={date} className="rounded-xl border border-white/10 overflow-hidden">
                  <div className="px-3 py-2 bg-white/5 text-xs text-[#9fb0b5]">{date}</div>
                  <div className="divide-y divide-white/10">
                    {items.map(ev => (
                      <div key={ev.id} className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="font-medium flex-1">{ev.title}</div>
                          <div className="text-xs text-[#9fb0b5]">{[ev.start_time, ev.end_time].filter(Boolean).join(' - ')}</div>
                        </div>
                        {ev.description ? (<div className="text-sm text-[#cfd8dc] mt-1">{ev.description}</div>) : null}
                        <div className="text-xs text-[#9fb0b5] mt-2 flex items-center gap-2">
                          <span>RSVP:</span>
                          <button className={`px-2 py-1 rounded ${ev.user_rsvp==='going'?'bg-teal-700/20 text-teal-300':'bg-white/5'}`} onClick={()=> rsvp(ev.id, 'going')}>Going</button>
                          <button className={`px-2 py-1 rounded ${ev.user_rsvp==='maybe'?'bg-teal-700/20 text-teal-300':'bg-white/5'}`} onClick={()=> rsvp(ev.id, 'maybe')}>Maybe</button>
                          <button className={`px-2 py-1 rounded ${ev.user_rsvp==='not_going'?'bg-teal-700/20 text-teal-300':'bg-white/5'}`} onClick={()=> rsvp(ev.id, 'not_going')}>Not going</button>
                          {!!ev.rsvp_counts && (
                            <span className="ml-auto text-[#9fb0b5]">{ev.rsvp_counts.going||0} going</span>
                          )}
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
    </div>
  )
}

