import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

type PollOption = { id: number; option_text: string; votes: number }
type ActivePoll = { id:number; question:string; options: PollOption[]; single_vote?: boolean; total_votes?: number; user_vote?: number|null }

export default function CommunityPolls(){
  const { community_id } = useParams()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [activeTab, setActiveTab] = useState<'active'|'create'>('active')
  const [polls, setPolls] = useState<ActivePoll[]>([])
  const [loading, setLoading] = useState(true)
  const [successMsg, setSuccessMsg] = useState<string| null>(null)
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(['',''])
  const [singleVote, setSingleVote] = useState(true)
  const [expiresAt, setExpiresAt] = useState('')
  const formRef = useRef<HTMLFormElement|null>(null)
  const scrollRef = useRef<HTMLDivElement|null>(null)
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => { setTitle('Polls') }, [setTitle])

  async function load(){
    setLoading(true)
    try{
      const r = await fetch(`/get_active_polls?community_id=${community_id}`, { credentials:'include' })
      const j = await r.json()
      if (j?.success){
        setPolls((j.polls || []).map((p:any) => ({ id:p.id, question:p.question, options:p.options||[], single_vote:p.single_vote, total_votes:p.total_votes, user_vote:p.user_vote })))
      }
    }finally{ setLoading(false) }
  }
  useEffect(()=>{ load() }, [community_id])

  async function createPoll(){
    const fd = new URLSearchParams()
    fd.append('question', question.trim())
    options.filter(x=> x.trim()).forEach(o => fd.append('options[]', o.trim()))
    if (community_id) fd.append('community_id', String(community_id))
    fd.append('single_vote', String(singleVote))
    if (expiresAt) fd.append('expires_at', expiresAt)
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

  function optimisticVote(pollId:number, optionId:number, toggle:boolean){
    setPolls(prev => prev.map(p => {
      if (p.id !== pollId) return p
      const next = { ...p, options: p.options.map(o => ({ ...o })) }
      if (p.single_vote){
        const prevOptId = p.user_vote || null
        if (prevOptId && prevOptId !== optionId){
          const prevOpt = next.options.find(o => o.id === prevOptId)
          if (prevOpt && prevOpt.votes > 0) prevOpt.votes -= 1
        }
        const cur = next.options.find(o => o.id === optionId)
        if (cur) cur.votes += 1
        next.user_vote = optionId
      } else {
        // Multiple vote mode: toggle off if same option clicked and toggle is true
        const cur = next.options.find(o => o.id === optionId)
        if (cur){
          if (toggle){
            if (cur.votes > 0) cur.votes -= 1
          } else {
            cur.votes += 1
          }
        }
      }
      return next
    }))
  }

  async function vote(pollId:number, optionId:number){
    const poll = polls.find(p => p.id === pollId)
    const isToggle = poll && !poll.single_vote && !!poll.options.find(o => o.id===optionId) // allow toggle for multi-vote
    optimisticVote(pollId, optionId, !!isToggle)
    const res = await fetch('/vote_poll', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ poll_id: pollId, option_id: optionId, toggle_vote: !poll?.single_vote && poll?.options?.some(o=> o.id===optionId) ? true : false }) })
    const j = await res.json().catch(()=>null)
    if (!j?.success){
      // Reload to reconcile on error
      load()
    }
  }

  async function closePoll(pollId:number){
    const r = await fetch('/close_poll', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: new URLSearchParams({ poll_id: String(pollId) }) })
    const j = await r.json().catch(()=>null)
    if (j?.success) load()
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
              <div className="pt-2">Active Polls</div>
              <div className={`h-0.5 rounded-full w-16 mx-auto mt-1 ${activeTab==='active' ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
            </button>
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='create' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} onClick={()=> setActiveTab('create')}>
              <div className="pt-2">Create Poll</div>
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
          <form ref={formRef} className="rounded-2xl border border-white/10 p-3 bg-white/[0.035] space-y-3" onSubmit={(e)=> { e.preventDefault(); createPoll() }}>
            <div className="text-sm font-medium">Create Poll</div>
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
            <div className="flex items-center gap-3">
              <button type="button" className={`px-2 py-1 rounded-md border text-sm whitespace-nowrap hover:bg:white/5 ${singleVote ? 'border-teal-500 text-teal-300 bg-teal-700/15' : 'border-white/10'}`} onClick={()=> setSingleVote(v=>!v)}>
                Single vote only
              </button>
              <label className="text-sm text-[#9fb0b5] whitespace-nowrap">Expiry date
                <input type="datetime-local" value={expiresAt} onChange={e=> setExpiresAt(e.target.value)} className="mt-1 w-60 rounded-md bg-black border border-white/10 px-3 py-2 text-sm focus:border-teal-400/70 outline-none" />
              </label>
            </div>
            <div className="flex justify-end">
              <button className="px-3 py-1.5 rounded-md bg-[#4db6ac] text-black text-sm hover:brightness-110">Create</button>
            </div>
          </form>
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