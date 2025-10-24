import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'

type PollOption = { id: number; option_text: string; votes: number; voters?: { username: string; profile_picture?: string; voted_at: string }[] }
type ActivePoll = { id:number; question:string; options: PollOption[]; single_vote?: boolean; total_votes?: number; user_vote?: number|null; is_active: number; expires_at?: string; created_by?: string }

export default function CommunityPolls(){
  const { community_id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { setTitle } = useHeader()
  const [activeTab, setActiveTab] = useState<'active'|'archive'|'create'>('active')
  const [polls, setPolls] = useState<ActivePoll[]>([])
  const [archivedPolls, setArchivedPolls] = useState<ActivePoll[]>([])
  const [loading, setLoading] = useState(true)
  const [successMsg, setSuccessMsg] = useState<string| null>(null)
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(['',''])
  const [singleVote, setSingleVote] = useState(true)
  const [expiresAt, setExpiresAt] = useState('')
  const [editingPollId, setEditingPollId] = useState<number|null>(null)
  const formRef = useRef<HTMLFormElement|null>(null)
  const scrollRef = useRef<HTMLDivElement|null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [hasUnseenAnnouncements, setHasUnseenAnnouncements] = useState(false)
  const [viewingVoters, setViewingVoters] = useState<number|null>(null)
  const [votersData, setVotersData] = useState<any>(null)
  const [loadingVoters, setLoadingVoters] = useState(false)

  useEffect(() => { setTitle(editingPollId ? 'Edit Poll' : 'Polls') }, [setTitle, editingPollId])

  async function load(){
    setLoading(true)
    try{
      const r = await fetch(`/get_active_polls?community_id=${community_id}`, { credentials:'include' })
      const j = await r.json()
      if (j?.success){
        const allPolls = (j.polls || []).map((p:any) => ({ 
          id:p.id, 
          question:p.question, 
          options:p.options||[], 
          single_vote:p.single_vote, 
          total_votes:p.total_votes, 
          user_vote:p.user_vote,
          is_active: p.is_active,
          expires_at: p.expires_at,
          created_by: p.created_by
        }))
        // Split into active and archived
        setPolls(allPolls.filter((p:ActivePoll) => p.is_active === 1))
        setArchivedPolls(allPolls.filter((p:ActivePoll) => p.is_active === 0))
      }
    }finally{ setLoading(false) }
  }
  useEffect(()=>{ load() }, [community_id])

  // Check for edit query parameter and load poll data
  useEffect(() => {
    const editParam = searchParams.get('edit')
    if (editParam) {
      const pollId = parseInt(editParam)
      setEditingPollId(pollId)
      setActiveTab('create')
      // Load poll data
      const poll = polls.find(p => p.id === pollId)
      if (poll) {
        setQuestion(poll.question)
        setOptions(poll.options.map(o => o.option_text))
        setSingleVote(poll.single_vote ?? true)
        // Prefill expiry if present
        try {
          const raw = (poll as any).expires_at as string | undefined
          if (raw) {
            const d = new Date(raw)
            if (!isNaN(d.getTime())) {
              const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
              setExpiresAt(tz.toISOString().slice(0,16))
            } else {
              setExpiresAt('')
            }
          } else {
            setExpiresAt('')
          }
        } catch { setExpiresAt('') }
      }
    }
  }, [searchParams, polls])

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

  async function createPoll(){
    if (editingPollId) {
      // Edit existing poll
      const payload = {
        poll_id: editingPollId,
        question: question.trim(),
        options: options.filter(x=> x.trim()).map(o => o.trim()),
        expires_at: expiresAt
      }
      const r = await fetch('/edit_poll', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) })
      const j = await r.json().catch(()=>null)
      if (j?.success){
        setSuccessMsg('Poll updated')
        setQuestion('')
        setOptions(['',''])
        setSingleVote(true)
        setExpiresAt('')
        setEditingPollId(null)
        setActiveTab('active')
        setTimeout(()=> setSuccessMsg(null), 2000)
        navigate(`/community/${community_id}/polls_react`)
        load()
      } else {
        alert(j?.error || 'Failed to update poll')
      }
    } else {
      // Create new poll
      const fd = new URLSearchParams()
      fd.append('question', question.trim())
      options.filter(x=> x.trim()).forEach(o => fd.append('options[]', o.trim()))
      if (community_id) fd.append('community_id', String(community_id))
      fd.append('single_vote', String(singleVote))
      if (expiresAt) {
        // Convert local time to UTC before sending to server
        try {
          const localDate = new Date(expiresAt)
          const utcString = localDate.toISOString().slice(0, 16).replace('T', 'T') // "YYYY-MM-DDTHH:MM"
          console.log(`📅 Converting poll deadline: Local=${expiresAt} → UTC=${utcString}`)
          fd.append('expires_at', utcString)
        } catch (e) {
          console.error('Failed to convert expires_at to UTC:', e)
          fd.append('expires_at', expiresAt) // Fallback to original
        }
      }
      const r = await fetch('/create_poll', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
      const j = await r.json().catch(()=>null)
      if (j?.success){
        setSuccessMsg('Poll created')
        setQuestion('')
        setOptions(['',''])
        setSingleVote(true)
        setExpiresAt('')
        setActiveTab('active')
        setTimeout(()=> setSuccessMsg(null), 2000)
        load()
      } else {
        alert(j?.error || 'Failed to create poll')
      }
    }
  }

  function optimisticVote(pollId:number, optionId:number){
    setPolls(prev => prev.map(p => {
      if (p.id !== pollId) return p
      const next = { ...p, options: p.options.map(o => ({ ...o })) }
      
      // Check if user already voted on this specific option
      const hasVotedOnThisOption = p.user_vote === optionId
      
      if (p.single_vote){
        // Single vote mode
        const prevOptId = p.user_vote || null
        if (prevOptId && prevOptId !== optionId){
          // Moving vote from one option to another
          const prevOpt = next.options.find(o => o.id === prevOptId)
          if (prevOpt && prevOpt.votes > 0) prevOpt.votes -= 1
        }
        const cur = next.options.find(o => o.id === optionId)
        if (cur) {
          if (hasVotedOnThisOption) {
            // Toggle off
            if (cur.votes > 0) cur.votes -= 1
            next.user_vote = null
          } else {
            // Vote on this option
            cur.votes += 1
            next.user_vote = optionId
          }
        }
      } else {
        // Multiple vote mode: always toggle
        const cur = next.options.find(o => o.id === optionId)
        if (cur){
          if (hasVotedOnThisOption){
            // Toggle off
            if (cur.votes > 0) cur.votes -= 1
            next.user_vote = null
          } else {
            // Toggle on
            cur.votes += 1
            next.user_vote = optionId
          }
        }
      }
      return next
    }))
  }

  async function vote(pollId:number, optionId:number){
    optimisticVote(pollId, optionId)
    const res = await fetch('/vote_poll', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ poll_id: pollId, option_id: optionId }) })
    const j = await res.json().catch(()=>null)
    if (!j?.success){
      // Reload to reconcile on error
      load()
    } else {
      // Reload to get correct user_voted state from server
      load()
    }
  }

  async function closePoll(pollId:number){
    const r = await fetch('/close_poll', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: new URLSearchParams({ poll_id: String(pollId) }) })
    const j = await r.json().catch(()=>null)
    if (j?.success) load()
  }

  async function loadVoters(pollId:number){
    setViewingVoters(pollId)
    setLoadingVoters(true)
    try{
      const r = await fetch(`/get_poll_voters/${pollId}`, { credentials:'include' })
      const j = await r.json()
      if (j?.success){
        setVotersData(j.options || [])
      }
    }finally{ setLoadingVoters(false) }
  }

  return (
    <div className="h-screen overflow-hidden bg-black text-white">
      <div className="fixed left-0 right-0 top-14 h-10 bg-black/70 backdrop-blur z-40">
        <div className="max-w-2xl mx-auto h-full flex items-center gap-2 px-2">
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> navigate(`/community_feed_react/${community_id}`)} aria-label="Back">
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="flex-1 h-full flex">
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='active' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} onClick={()=> setActiveTab('active')}>
              <div className="pt-2">Active</div>
              <div className={`h-0.5 rounded-full w-12 mx-auto mt-1 ${activeTab==='active' ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
            </button>
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='archive' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} onClick={()=> setActiveTab('archive')}>
              <div className="pt-2">Archive</div>
              <div className={`h-0.5 rounded-full w-12 mx-auto mt-1 ${activeTab==='archive' ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
            </button>
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='create' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} onClick={()=> setActiveTab('create')}>
              <div className="pt-2">Create</div>
              <div className={`h-0.5 rounded-full w-12 mx-auto mt-1 ${activeTab==='create' ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
            </button>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="max-w-2xl mx-auto pt-[70px] h-[calc(100vh-70px)] pb-20 px-3 overflow-y-auto no-scrollbar">
        {successMsg && (
          <div className="mb-3 text-sm px-3 py-2 rounded-md bg-teal-700/15 text-teal-300 border border-teal-700/30">{successMsg}</div>
        )}

        {activeTab === 'create' ? (
          <form ref={formRef} className="rounded-2xl border border-white/10 p-3 bg-white/[0.035] space-y-3" onSubmit={(e)=> { e.preventDefault(); createPoll() }}>
            <div className="text-sm font-medium">{editingPollId ? 'Edit Poll' : 'Create Poll'}</div>
            <label className="text-xs text-[#9fb0b5]">Question
              <input value={question} onChange={e=> setQuestion(e.target.value)} className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none" placeholder="What should we do?" />
            </label>
            <div className="space-y-2">
              {options.map((opt, idx) => (
                <input key={idx} value={opt} onChange={e=> setOptions(prev => prev.map((o,i)=> i===idx? e.target.value : o))} className="w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none" placeholder={`Option ${idx+1}`} />
              ))}
              <div className="flex gap-2">
                <button type="button" className="px-2 py-1 rounded-md border border-white/10 text-xs hover:bg-white/5" onClick={()=> setOptions(prev => [...prev, ''])}>Add option</button>
                <button type="button" className="px-2 py-1 rounded-md border border-white/10 text-xs hover:bg-white/5" onClick={()=> setOptions(prev => prev.length>2? prev.slice(0,-1): prev)}>Remove option</button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              <div>
                <button type="button" className={`px-2 py-1 rounded-md border text-sm whitespace-nowrap hover:bg:white/5 ${singleVote ? 'border-teal-500 text-teal-300 bg-teal-700/15' : 'border-white/10'}`} onClick={()=> setSingleVote(v=>!v)}>
                  Single vote only
                </button>
              </div>
              <div className="flex flex-col min-w-0">
                <label className="text-sm text-[#9fb0b5]">Expiry date (optional)</label>
                <div className="mt-1 flex items-center gap-2 min-w-0">
                  <input type="datetime-local" value={expiresAt} onChange={e=> setExpiresAt(e.target.value)} className="flex-1 min-w-0 rounded-md bg-black border border-white/10 px-3 py-2 text-sm focus:border-teal-400/70 outline-none" />
                  {expiresAt ? (
                    <button type="button" className="px-2 py-1 rounded-md border border-white/10 text-xs text-[#9fb0b5] hover:bg-white/5" onClick={()=> setExpiresAt('')}>Clear</button>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              {editingPollId && (
                <button type="button" className="px-3 py-1.5 rounded-md border border-white/10 text-sm hover:bg-white/5" onClick={()=> { setEditingPollId(null); setQuestion(''); setOptions(['','']); setSingleVote(true); setExpiresAt(''); navigate(`/community/${community_id}/polls_react`) }}>Cancel</button>
              )}
              <button className="px-3 py-1.5 rounded-md bg-[#4db6ac] text-black text-sm hover:brightness-110">{editingPollId ? 'Update' : 'Create'}</button>
            </div>
          </form>
        ) : activeTab === 'archive' ? (
          <div className="space-y-3">
            {loading ? (
              <div className="text-[#9fb0b5]">Loading…</div>
            ) : archivedPolls.length === 0 ? (
              <div className="text-[#9fb0b5]">No archived polls.</div>
            ) : (
              archivedPolls.map(p => (
                <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.035] opacity-75 overflow-hidden">
                  <div className="px-3 py-2 flex items-center gap-2 border-b border-white/10">
                    <div className="font-medium flex-1">{p.question}</div>
                    <span className="text-xs text-[#9fb0b5]">🔒 Closed</span>
                    <button title="View voters" className="px-2 py-1 rounded-md border border-[#4db6ac] text-[#4db6ac] hover:bg-[#4db6ac]/10 text-sm" onClick={()=> loadVoters(p.id)}>
                      <i className="fa-solid fa-users mr-1" />
                      Voters
                    </button>
                  </div>
                  <div className="px-3 py-2 space-y-2">
                    {p.options?.map((o, i) => {
                      const pct = p.total_votes ? Math.round((o.votes / p.total_votes) * 100) : 0
                      return (
                        <div key={i} className="w-full text-left px-3 py-2 rounded border border-white/10 relative overflow-hidden">
                          <div className="absolute inset-0 bg-[#4db6ac]/20" style={{ width: `${pct}%` }} />
                          <div className="relative flex items-center justify-between">
                            <span>{o.option_text}</span>
                            <span className="text-xs text-[#9fb0b5]">{o.votes} {pct > 0 ? `(${pct}%)` : ''}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {loading ? (
              <div className="text-[#9fb0b5]">Loading…</div>
            ) : polls.length === 0 ? (
              <div className="text-[#9fb0b5]">No active polls.</div>
            ) : (
              polls.map(p => (
                <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.035] overflow-hidden">
                  <div className="px-3 py-2 flex items-center gap-2 border-b border-white/10">
                    <div className="font-medium flex-1">{p.question}</div>
                    <button title="View voters" className="px-2 py-1 rounded-md border border-[#4db6ac] text-[#4db6ac] hover:bg-[#4db6ac]/10 text-sm" onClick={()=> loadVoters(p.id)}>
                      <i className="fa-solid fa-users mr-1" />
                      Voters
                    </button>
                    <button title="Close poll" className="px-2 py-1 rounded-md border border-red-400 text-red-300 hover:bg-red-500/10" onClick={()=> closePoll(p.id)}>
                      <i className="fa-regular fa-trash-can" />
                    </button>
                  </div>
                  <div className="px-3 py-2 space-y-2">
                    {p.options?.map(o => (
                      <button key={o.id} className="w-full text-left px-3 py-2 rounded border border-white/10 hover:bg-white/5 flex items-center justify-between" onClick={()=> vote(p.id, o.id)}>
                        <span>{o.option_text}</span>
                        <span className="text-xs text-[#9fb0b5]">{o.votes}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Voters Modal */}
      {viewingVoters && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={()=> { setViewingVoters(null); setVotersData(null) }}>
          <div className="bg-black border border-white/10 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden" onClick={(e)=> e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <div className="font-medium">Poll Voters</div>
              <button className="p-2 hover:bg-white/5 rounded-full" onClick={()=> { setViewingVoters(null); setVotersData(null) }}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <div className="overflow-y-auto max-h-[calc(80vh-60px)] p-4">
              {loadingVoters ? (
                <div className="text-[#9fb0b5]">Loading voters...</div>
              ) : votersData ? (
                <div className="space-y-4">
                  {votersData.map((opt: any) => (
                    <div key={opt.id} className="border border-white/10 rounded-lg p-3">
                      <div className="font-medium text-sm mb-2 text-[#4db6ac]">{opt.option_text}</div>
                      {opt.voters && opt.voters.length > 0 ? (
                        <div className="space-y-2">
                          {opt.voters.map((voter: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-2 text-sm">
                              <Avatar username={voter.username} url={voter.profile_picture} size={24} />
                              <span>{voter.username}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-[#9fb0b5]">No votes yet</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[#9fb0b5]">No data</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom navigation bar - floating (same as community) */}
      <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-40 w-[94%] max-w-[1200px] rounded-2xl border border-white/10 bg-black/80 backdrop-blur shadow-lg">
        <div className="h-14 px-6 flex items-center justify-between text-[#cfd8dc]">
          <button className="p-2 rounded-full hover:bg-white/5" aria-label="Home" onClick={()=> scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
            <i className="fa-solid fa-house" />
          </button>
          <button className="p-2 rounded-full hover:bg-white/5" aria-label="Members" onClick={()=> navigate(`/community/${community_id}/members`)}>
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
          <button className="p-2 rounded-full hover:bg-white/5" aria-label="More" onClick={()=> setMoreOpen(true)}>
            <i className="fa-solid fa-ellipsis" />
          </button>
        </div>
      </div>

      {moreOpen && (
        <div className="fixed inset-0 z-[95] bg-black/30 flex items:end justify-end" onClick={(e)=> e.currentTarget===e.target && setMoreOpen(false)}>
          <div className="w-[75%] max-w-sm mr-2 mb-2 bg:black/80 backdrop-blur border border-white/10 rounded-2xl p-2 space-y-2 transition-transform duration-200 ease-out translate-y-0">
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/polls_react`) }}>Polls</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/calendar_react`) }}>Calendar</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg:white/5" onClick={()=> { setMoreOpen(false); window.location.href = `/community/${community_id}/resources` }}>Forum</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg:white/5" onClick={()=> { setMoreOpen(false); window.location.href = `/community/${community_id}/resources` }}>Useful Links</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg:white/5" onClick={()=> { setMoreOpen(false); window.location.href = `/issues` }}>Report Issue</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg:white/5" onClick={()=> { setMoreOpen(false); window.location.href = `/anonymous_feedback` }}>Anonymous feedback</button>
          </div>
        </div>
      )}
    </div>
  )
}