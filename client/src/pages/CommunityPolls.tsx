import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'

type PollOption = { id: number; option_text: string; votes: number; voters?: { username: string; profile_picture?: string; voted_at: string }[] }
type ActivePoll = { id:number; question:string; options: PollOption[]; single_vote?: boolean; total_votes?: number; user_vote?: number|null; is_active: number; expires_at?: string; created_by?: string }

export default function CommunityPolls(){
  const { t } = useTranslation()
  const { community_id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const groupId = searchParams.get('group_id')
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
  const [viewingVoters, setViewingVoters] = useState<number|null>(null)
  const [votersData, setVotersData] = useState<any>(null)
  const [loadingVoters, setLoadingVoters] = useState(false)

  useEffect(() => {
    setTitle(editingPollId ? t('communities.polls_edit_title') : t('communities.polls_title'))
  }, [setTitle, editingPollId, t])

  async function load(){
    if (groupId) {
      setPolls([])
      setArchivedPolls([])
      setLoading(false)
      return
    }
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
        setPolls(allPolls.filter((p:ActivePoll) => p.is_active === 1))
        setArchivedPolls(allPolls.filter((p:ActivePoll) => p.is_active === 0))
      }
    }finally{ setLoading(false) }
  }
  useEffect(()=>{ load() }, [community_id, groupId])

  useEffect(() => {
    const editParam = searchParams.get('edit')
    if (editParam) {
      const pollId = parseInt(editParam)
      setEditingPollId(pollId)
      setActiveTab('create')
      const poll = polls.find(p => p.id === pollId)
      if (poll) {
        setQuestion(poll.question)
        setOptions(poll.options.map(o => o.option_text))
        setSingleVote(poll.single_vote ?? true)
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

  async function createPoll(){
    if (editingPollId) {
      const payload = {
        poll_id: editingPollId,
        question: question.trim(),
        options: options.filter(x=> x.trim()).map(o => o.trim()),
        expires_at: expiresAt
      }
      const r = await fetch('/edit_poll', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) })
      const j = await r.json().catch(()=>null)
      if (j?.success){
        setSuccessMsg(t('communities.polls_updated'))
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
        alert(j?.error || t('communities.polls_update_failed'))
      }
    } else {
      const fd = new URLSearchParams()
      fd.append('question', question.trim())
      options.filter(x=> x.trim()).forEach(o => fd.append('options[]', o.trim()))
      if (community_id) fd.append('community_id', String(community_id))
      fd.append('single_vote', String(singleVote))
      if (expiresAt) {
        try {
          const localDate = new Date(expiresAt)
          const utcString = localDate.toISOString().slice(0, 16).replace('T', 'T')
          fd.append('expires_at', utcString)
        } catch {
          fd.append('expires_at', expiresAt)
        }
      }
      const r = await fetch('/create_poll', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
      const j = await r.json().catch(()=>null)
      if (j?.success){
        setSuccessMsg(t('communities.polls_created'))
        setQuestion('')
        setOptions(['',''])
        setSingleVote(true)
        setExpiresAt('')
        setActiveTab('active')
        setTimeout(()=> setSuccessMsg(null), 2000)
        load()
      } else {
        alert(j?.error || t('communities.polls_create_failed'))
      }
    }
  }

  function optimisticVote(pollId:number, optionId:number){
    setPolls(prev => prev.map(p => {
      if (p.id !== pollId) return p
      const next = { ...p, options: p.options.map(o => ({ ...o })) }
      const hasVotedOnThisOption = p.user_vote === optionId
      if (p.single_vote){
        const prevOptId = p.user_vote || null
        if (prevOptId && prevOptId !== optionId){
          const prevOpt = next.options.find(o => o.id === prevOptId)
          if (prevOpt && prevOpt.votes > 0) prevOpt.votes -= 1
        }
        const cur = next.options.find(o => o.id === optionId)
        if (cur) {
          if (hasVotedOnThisOption) {
            if (cur.votes > 0) cur.votes -= 1
            next.user_vote = null
          } else {
            cur.votes += 1
            next.user_vote = optionId
          }
        }
      } else {
        const cur = next.options.find(o => o.id === optionId)
        if (cur){
          if (hasVotedOnThisOption){
            if (cur.votes > 0) cur.votes -= 1
            next.user_vote = null
          } else {
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
      load()
    } else {
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

  if (groupId) {
    return (
      <div className="min-h-screen bg-c-bg-app text-c-text-primary">
        <div
          className="fixed left-0 right-0 h-10 bg-c-bg-app/70 backdrop-blur z-40"
          style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))', '--app-subnav-height': '40px' } as CSSProperties}
        >
          <div className="max-w-2xl mx-auto h-full flex items-center gap-2 px-2">
            <button className="p-2 rounded-full hover:bg-c-hover-bg" onClick={()=> navigate(`/group_feed_react/${groupId}`)} aria-label={t('common.back')}>
              <i className="fa-solid fa-arrow-left" />
            </button>
            <div className="flex-1 font-medium">{t('communities.polls_title')}</div>
          </div>
        </div>
        <div
          className="app-subnav-offset max-w-2xl mx-auto pb-20 px-3 overflow-y-auto no-scrollbar"
          style={{
            WebkitOverflowScrolling: 'touch' as any,
            minHeight: 'calc(100vh - var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px))))',
            '--app-subnav-height': '40px',
          } as CSSProperties}
        >
          <p className="text-sm text-c-text-tertiary py-8 leading-relaxed">
            {t('communities.polls_group_stub')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-c-bg-app text-c-text-primary">
      <div
        className="fixed left-0 right-0 h-10 bg-c-bg-app/70 backdrop-blur z-40"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))', '--app-subnav-height': '40px' } as CSSProperties}
      >
        <div className="max-w-2xl mx-auto h-full flex items-center gap-2 px-2">
          <button className="p-2 rounded-full hover:bg-c-hover-bg" onClick={()=> navigate(groupId ? `/group_feed_react/${groupId}` : `/community_feed_react/${community_id}`)} aria-label={t('common.back')}>
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="flex-1 h-full flex">
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='active' ? 'text-c-text-secondary' : 'text-c-text-tertiary hover:text-c-text-secondary'}`} onClick={()=> setActiveTab('active')}>
              <div className="pt-2">{t('communities.polls_tab_active')}</div>
              <div className={`h-0.5 rounded-full w-12 mx-auto mt-1 ${activeTab==='active' ? 'bg-cpoint-turquoise' : 'bg-transparent'}`} />
            </button>
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='archive' ? 'text-c-text-secondary' : 'text-c-text-tertiary hover:text-c-text-secondary'}`} onClick={()=> setActiveTab('archive')}>
              <div className="pt-2">{t('communities.polls_tab_archive')}</div>
              <div className={`h-0.5 rounded-full w-12 mx-auto mt-1 ${activeTab==='archive' ? 'bg-cpoint-turquoise' : 'bg-transparent'}`} />
            </button>
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='create' ? 'text-c-text-secondary' : 'text-c-text-tertiary hover:text-c-text-secondary'}`} onClick={()=> setActiveTab('create')}>
              <div className="pt-2">{t('communities.polls_tab_create')}</div>
              <div className={`h-0.5 rounded-full w-12 mx-auto mt-1 ${activeTab==='create' ? 'bg-cpoint-turquoise' : 'bg-transparent'}`} />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="app-subnav-offset max-w-2xl mx-auto pb-20 px-3 overflow-y-auto no-scrollbar"
        style={{
          WebkitOverflowScrolling: 'touch' as any,
          minHeight: 'calc(100vh - var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px))))',
          '--app-subnav-height': '40px',
        } as CSSProperties}
      >
        {successMsg && (
          <div className="mb-3 text-sm px-3 py-2 rounded-md bg-teal-700/15 text-teal-300 border border-teal-700/30">{successMsg}</div>
        )}

        {activeTab === 'create' ? (
          <form ref={formRef} className="rounded-2xl border border-c-border p-3 bg-white/[0.035] space-y-3" onSubmit={(e)=> { e.preventDefault(); createPoll() }}>
            <div className="text-sm font-medium">{editingPollId ? t('communities.polls_edit_form_title') : t('communities.polls_create_form_title')}</div>
            <label className="text-xs text-c-text-tertiary">{t('communities.polls_question_label')}
              <input value={question} onChange={e=> setQuestion(e.target.value)} className="mt-1 w-full rounded-md bg-c-bg-app border border-c-border px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none" placeholder={t('communities.poll_question_placeholder')} />
            </label>
            <div className="space-y-2">
              {options.map((opt, idx) => (
                <input key={idx} value={opt} onChange={e=> setOptions(prev => prev.map((o,i)=> i===idx? e.target.value : o))} className="w-full rounded-md bg-c-bg-app border border-c-border px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none" placeholder={t('communities.poll_option_placeholder', { number: idx + 1 })} />
              ))}
              <div className="flex gap-2">
                <button type="button" className="px-2 py-1 rounded-md border border-c-border text-xs hover:bg-c-hover-bg" onClick={()=> setOptions(prev => [...prev, ''])}>{t('communities.add_option')}</button>
                <button type="button" className="px-2 py-1 rounded-md border border-c-border text-xs hover:bg-c-hover-bg" onClick={()=> setOptions(prev => prev.length>2? prev.slice(0,-1): prev)}>{t('communities.remove_option')}</button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              <div>
                <button type="button" className={`px-2 py-1 rounded-md border text-sm whitespace-nowrap hover:bg:white/5 ${singleVote ? 'border-teal-500 text-teal-300 bg-teal-700/15' : 'border-c-border'}`} onClick={()=> setSingleVote(v=>!v)}>
                  {t('communities.polls_single_vote')}
                </button>
              </div>
              <div className="flex flex-col min-w-0">
                <label className="text-sm text-c-text-tertiary">{t('communities.polls_expiry_label')}</label>
                <div className="mt-1 flex items-center gap-2 min-w-0">
                  <input type="datetime-local" value={expiresAt} onChange={e=> setExpiresAt(e.target.value)} className="flex-1 min-w-0 rounded-md bg-c-bg-app border border-c-border px-3 py-2 text-sm focus:border-teal-400/70 outline-none" />
                  {expiresAt ? (
                    <button type="button" className="px-2 py-1 rounded-md border border-c-border text-xs text-c-text-tertiary hover:bg-c-hover-bg" onClick={()=> setExpiresAt('')}>{t('communities.polls_clear_expiry')}</button>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              {editingPollId && (
                <button type="button" className="px-3 py-1.5 rounded-md border border-c-border text-sm hover:bg-c-hover-bg" onClick={()=> { setEditingPollId(null); setQuestion(''); setOptions(['','']); setSingleVote(true); setExpiresAt(''); navigate(`/community/${community_id}/polls_react`) }}>{t('common.cancel')}</button>
              )}
              <button className="px-3 py-1.5 rounded-md bg-cpoint-turquoise text-black text-sm hover:brightness-110">{editingPollId ? t('communities.polls_update') : t('communities.create_poll')}</button>
            </div>
          </form>
        ) : activeTab === 'archive' ? (
          <div className="space-y-3">
            {loading ? (
              <div className="text-c-text-tertiary">{t('common.loading')}</div>
            ) : archivedPolls.length === 0 ? (
              <div className="text-c-text-tertiary">{t('communities.no_archived_polls')}</div>
            ) : (
              archivedPolls.map(p => (
                <div key={p.id} className="rounded-2xl border border-c-border bg-white/[0.035] opacity-75 overflow-hidden">
                  <div className="px-3 py-2 flex items-center gap-2 border-b border-c-border">
                    <div className="font-medium flex-1">{p.question}</div>
                    <span className="text-xs text-c-text-tertiary">🔒 {t('communities.polls_closed')}</span>
                    <button title={t('communities.polls_voters')} className="px-2 py-1 rounded-md border border-cpoint-turquoise text-cpoint-turquoise hover:bg-cpoint-turquoise/10 text-sm" onClick={()=> loadVoters(p.id)}>
                      <i className="fa-solid fa-users mr-1" />
                      {t('communities.polls_voters')}
                    </button>
                  </div>
                  <div className="px-3 py-2 space-y-2">
                    {p.options?.map((o, i) => {
                      const pct = p.total_votes ? Math.round((o.votes / p.total_votes) * 100) : 0
                      return (
                        <div key={i} className="w-full text-left px-3 py-2 rounded border border-c-border relative overflow-hidden">
                          <div className="absolute inset-0 bg-cpoint-turquoise/20" style={{ width: `${pct}%` }} />
                          <div className="relative flex items-center justify-between">
                            <span>{o.option_text}</span>
                            <span className="text-xs text-c-text-tertiary">{o.votes} {pct > 0 ? `(${pct}%)` : ''}</span>
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
              <div className="text-c-text-tertiary">{t('common.loading')}</div>
            ) : polls.length === 0 ? (
              <div className="text-c-text-tertiary">{t('communities.no_active_polls')}</div>
            ) : (
              polls.map(p => (
                <div key={p.id} className="rounded-2xl border border-c-border bg-white/[0.035] overflow-hidden">
                  <div className="px-3 py-2 flex items-center gap-2 border-b border-c-border">
                    <div className="font-medium flex-1">{p.question}</div>
                    <button title={t('communities.polls_voters')} className="px-2 py-1 rounded-md border border-cpoint-turquoise text-cpoint-turquoise hover:bg-cpoint-turquoise/10 text-sm" onClick={()=> loadVoters(p.id)}>
                      <i className="fa-solid fa-users mr-1" />
                      {t('communities.polls_voters')}
                    </button>
                    <button title={t('communities.polls_close_poll')} className="px-2 py-1 rounded-md border border-red-400 text-red-300 hover:bg-red-500/10" onClick={()=> closePoll(p.id)}>
                      <i className="fa-regular fa-trash-can" />
                    </button>
                  </div>
                  <div className="px-3 py-2 space-y-2">
                    {p.options?.map(o => (
                      <button key={o.id} className="w-full text-left px-3 py-2 rounded border border-c-border hover:bg-c-hover-bg flex items-center justify-between" onClick={()=> vote(p.id, o.id)}>
                        <span>{o.option_text}</span>
                        <span className="text-xs text-c-text-tertiary">{o.votes}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {viewingVoters && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={()=> { setViewingVoters(null); setVotersData(null) }}>
          <div className="bg-c-bg-app border border-c-border rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden" onClick={(e)=> e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-c-border flex items-center justify-between">
              <div className="font-medium">{t('communities.polls_voters_modal')}</div>
              <button className="p-2 hover:bg-c-hover-bg rounded-full" onClick={()=> { setViewingVoters(null); setVotersData(null) }}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <div className="overflow-y-auto max-h-[calc(80vh-60px)] p-4">
              {loadingVoters ? (
                <div className="text-c-text-tertiary">{t('communities.loading_voters')}</div>
              ) : votersData ? (
                <div className="space-y-4">
                  {votersData.map((opt: any) => (
                    <div key={opt.id} className="border border-c-border rounded-lg p-3">
                      <div className="font-medium text-sm mb-2 text-cpoint-turquoise">{opt.option_text}</div>
                      {opt.voters && opt.voters.length > 0 ? (
                        <div className="space-y-2">
                          {opt.voters.map((voter: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-2 text-sm">
                              <Avatar username={voter.username} url={voter.profile_picture} size={24} linkToProfile />
                              <span>{voter.username}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-c-text-tertiary">{t('communities.no_votes')}</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-c-text-tertiary">{t('communities.no_data')}</div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
