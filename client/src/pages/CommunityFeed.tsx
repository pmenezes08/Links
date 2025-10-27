import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import MentionTextarea from '../components/MentionTextarea'
import { formatSmartTime } from '../utils/time'
import ImageLoader from '../components/ImageLoader'
import { useHeader } from '../contexts/HeaderContext'
import VideoEmbed from '../components/VideoEmbed'
import { extractVideoEmbed, removeVideoUrlFromText } from '../utils/videoEmbed'
import { renderTextWithLinks, detectLinks, replaceLinkInText, type DetectedLink } from '../utils/linkUtils.tsx'

type PollOption = { id: number; text: string; votes: number; user_voted?: boolean }
type Poll = { id: number; question: string; is_active: number; options: PollOption[]; user_vote: number|null; total_votes: number; single_vote?: boolean; expires_at?: string | null }
type Reply = { id: number; username: string; content: string; timestamp: string; reactions: Record<string, number>; user_reaction: string|null, profile_picture?: string|null, image_path?: string|null, parent_reply_id?: number | null }
type Post = { id: number; username: string; content: string; image_path?: string|null; timestamp: string; reactions: Record<string, number>; user_reaction: string|null; poll?: Poll|null; replies: Reply[], profile_picture?: string|null, is_starred?: boolean, is_community_starred?: boolean }

// old formatTimestamp removed; using formatSmartTime

export default function CommunityFeed() {
  let { community_id } = useParams()
  if (!community_id){
    try{ community_id = window.location.pathname.split('/').filter(Boolean).pop() as any }catch{}
  }
  const navigate = useNavigate()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)
  const [hasUnseenAnnouncements, setHasUnseenAnnouncements] = useState(false)
  const [hasUnansweredPolls, setHasUnansweredPolls] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [showAnnouncements, _setShowAnnouncements] = useState(false)
  const [_announcements, _setAnnouncements] = useState<Array<{id:number, content:string, created_by:string, created_at:string}>>([])
  const [newAnnouncement, setNewAnnouncement] = useState('')
  const [savingAnn, setSavingAnn] = useState(false)
  // Ads removed
  const [moreOpen, setMoreOpen] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [q, setQ] = useState('#')
  const [results, setResults] = useState<Array<{id:number, username:string, content:string, timestamp:string}>>([])
  const scrollRef = useRef<HTMLDivElement|null>(null)
  const [refreshHint, setRefreshHint] = useState(false)
  const [pullPx, setPullPx] = useState(0)
  // Voters modal state
  const [viewingVotersPollId, setViewingVotersPollId] = useState<number|null>(null)
  const [votersLoading, setVotersLoading] = useState(false)
  const [votersData, setVotersData] = useState<Array<{ id:number; option_text:string; voters:Array<{ username:string; profile_picture?:string|null; voted_at?:string }> }>>([])
  // Reaction details modal state
  const [reactorsPostId, setReactorsPostId] = useState<number|null>(null)
  const [reactorsLoading, setReactorsLoading] = useState(false)
  const [reactorGroups, setReactorGroups] = useState<Array<{ reaction_type:string; users: Array<{ username:string; profile_picture?:string|null }> }>>([])
  
  // Check if we should highlight from onboarding
  const [highlightStep, setHighlightStep] = useState<'reaction' | 'post' | null>(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('highlight_post') === 'true') {
      setHighlightStep('reaction') // Start with reaction
    }
  }, [])
  // Modal removed in favor of dedicated PostDetail route

  // Set header title consistently
  const { setTitle } = useHeader()
  useEffect(() => { if (data?.community?.name) setTitle(data.community.name) }, [setTitle, data?.community?.name])

  useEffect(() => {
    // Pull-to-refresh behavior on overscroll at top with a small elastic offset
    const el = scrollRef.current
    if (!el) return
    let startY = 0
    const threshold = 64
    const reloadingRef = { current: false }
    function onTS(ev: TouchEvent){
      try{ startY = ev.touches[0]?.clientY || 0 }catch{ startY = 0 }
      // reset tracking
    }
    function onTM(ev: TouchEvent){
      try{
        const y = (el ? el.scrollTop : 0) || 0
        const curY = ev.touches[0]?.clientY || 0
        const dy = curY - startY
        if (y <= 0 && dy > 0){
          const px = Math.min(100, Math.max(0, dy * 0.5))
          setPullPx(px)
          setRefreshHint(px > 8)
          if (px >= threshold && !reloadingRef.current){ reloadingRef.current = true; location.reload() }
        } else {
          setPullPx(0)
          setRefreshHint(false)
        }
      }catch{}
    }
    function onTE(){ setPullPx(0); setRefreshHint(false) }
    el.addEventListener('touchstart', onTS, { passive: true })
    el.addEventListener('touchmove', onTM, { passive: true })
    el.addEventListener('touchend', onTE, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTS as any)
      el.removeEventListener('touchmove', onTM as any)
      el.removeEventListener('touchend', onTE as any)
    }
  }, [])

  useEffect(() => {
    // Ensure legacy css is attached once to avoid flashes between pages
    let link = document.getElementById('legacy-styles') as HTMLLinkElement | null
    if (!link){
      link = document.createElement('link')
      link.id = 'legacy-styles'
      link.rel = 'stylesheet'
      link.href = '/static/styles.css'
      document.head.appendChild(link)
    }
  }, [])

  // Remember last visited community for quick return from Communities tab
  useEffect(() => {
    if (community_id) {
      try { localStorage.setItem('last_community_id', String(community_id)) } catch {}
    }
  }, [community_id])

  // Refresh data when page becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        setRefreshKey(prev => prev + 1)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  useEffect(() => {
    let isMounted = true
    setLoading(true)
    fetch(`/api/community_feed/${community_id}`, { credentials: 'include' })
      .then(r => r.json().catch(() => ({ success: false, error: 'Invalid response' })))
      .then(json => { 
        if (!isMounted) return; 
        if (json?.success){ setData(json) }
        else {
          setError(json?.error || 'Error')
          const ua = navigator.userAgent || ''
          const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua) || window.innerWidth < 768
          if (isMobile && community_id){
            // Fallback to HTML feed to avoid blank screen
            window.location.href = `/community_feed/${community_id}`
          }
        }
      })
      .catch(() => { if (isMounted){
        setError('Error loading feed')
        const ua = navigator.userAgent || ''
        const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua) || window.innerWidth < 768
        if (isMobile && community_id){ window.location.href = `/community_feed/${community_id}` }
      }})
      .finally(() => isMounted && setLoading(false))
    return () => { isMounted = false }
  }, [community_id, refreshKey])

  // Ads removed

  useEffect(() => {
    // Check for unseen announcements (highlight icon)
    let mounted = true
    async function check(){
      try{
        const r = await fetch(`/get_community_announcements?community_id=${community_id}`, { credentials: 'include' })
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

  // Derive unanswered polls flag from feed data to avoid extra network roundtrip
  useEffect(() => {
    try{
      const posts = Array.isArray(data?.posts) ? data.posts : []
      const hasUnanswered = posts.some((p:any) => p?.poll && (p.poll.user_vote == null))
      setHasUnansweredPolls(hasUnanswered)
    }catch{ setHasUnansweredPolls(false) }
  }, [data])

  async function fetchAnnouncements(){
    try{
      const r = await fetch(`/get_community_announcements?community_id=${community_id}`, { credentials: 'include' })
      const j = await r.json()
      if (j?.success){
        _setAnnouncements(j.announcements || [])
        _setShowAnnouncements(true)
        try{
          const key = `ann_last_seen_${community_id}`
          localStorage.setItem(key, new Date().toISOString())
          setHasUnseenAnnouncements(false)
        }catch{}
      }
    }catch{}
  }

  // inline voters loader lives in onClick handler below

  async function saveAnnouncement(){
    if (!community_id) return
    const content = (newAnnouncement || '').trim()
    if (!content) return
    setSavingAnn(true)
    try{
      const fd = new URLSearchParams({ community_id: String(community_id), content })
      const r = await fetch('/save_community_announcement', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (j?.success){
        setNewAnnouncement('')
        fetchAnnouncements()
      } else {
        alert(j?.error || 'Failed to save announcement')
      }
    } finally {
      setSavingAnn(false)
    }
  }

  async function deleteAnnouncement(announcementId: number){
    if (!community_id) return
    const ok = confirm('Delete this announcement?')
    if (!ok) return
    try{
      const fd = new URLSearchParams({ community_id: String(community_id), announcement_id: String(announcementId) })
      const r = await fetch('/delete_community_announcement', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (j?.success){ fetchAnnouncements() }
      else alert(j?.error || 'Failed to delete')
    }catch{}
  }

  async function openVoters(pollId: number){
    try{
      setViewingVotersPollId(pollId)
      setVotersLoading(true)
      const r = await fetch(`/get_poll_voters/${pollId}`, { credentials:'include' })
      const j = await r.json().catch(()=>null)
      if (j?.success){ setVotersData(j.options || []) } else { setVotersData([]) }
    } finally { setVotersLoading(false) }
  }

  function onAddReply(postId: number, reply: Reply){
    setData((prev:any) => {
      if (!prev) return prev
      const posts = Array.isArray(prev.posts) ? prev.posts : []
      const updated = posts.map((p:any) => {
        if (p.id !== postId) return p
        const existing = Array.isArray(p.replies) ? p.replies : []
        // Prepend newest reply (API returns newest first elsewhere)
        return { ...p, replies: [reply, ...existing] }
      })
      return { ...prev, posts: updated }
    })
  }

  async function openReactors(postId: number){
    try{
      setReactorsPostId(postId)
      setReactorsLoading(true)
      setReactorGroups([])
      const r = await fetch(`/get_post_reactors/${postId}`, { credentials:'include' })
      const j = await r.json().catch(()=>null)
      if (j?.success){ setReactorGroups(j.groups || []) }
      else { setReactorGroups([]) }
    } finally {
      setReactorsLoading(false)
    }
  }

  async function handleToggleReaction(postId: number, reaction: string){
    // Optimistic update: toggle user reaction and adjust counts immediately
    setData((prev:any) => {
      if (!prev) return prev
      const updatedPosts = (prev.posts || []).map((p: any) => {
        if (p.id !== postId) return p
        const prevUserReaction = p.user_reaction
        const nextUserReaction = prevUserReaction === reaction ? null : reaction
        const counts = { ...(p.reactions || {}) }
        if (prevUserReaction){
          counts[prevUserReaction] = Math.max(0, (counts[prevUserReaction] || 0) - 1)
        }
        if (nextUserReaction){
          counts[nextUserReaction] = (counts[nextUserReaction] || 0) + 1
        }
        return { ...p, user_reaction: nextUserReaction, reactions: counts }
      })
      return { ...prev, posts: updatedPosts }
    })

    try{
      const form = new URLSearchParams({ post_id: String(postId), reaction })
      const r = await fetch('/add_reaction', { method: 'POST', credentials: 'include', headers: { 'Content-Type':'application/x-www-form-urlencoded' }, body: form })
      const j = await r.json().catch(()=>null)
      if (!j?.success) return
      // Reconcile with server counts
      setData((prev:any) => {
        if (!prev) return prev
        const updatedPosts = (prev.posts || []).map((p: any) => p.id === postId ? ({ ...p, reactions: { ...p.reactions, ...j.counts }, user_reaction: j.user_reaction }) : p)
        return { ...prev, posts: updatedPosts }
      })
    }catch{}
  }

  // Reply reactions handled inside PostDetail page

  async function handlePollVote(postId: number, pollId: number, optionId: number){
    // Optimistic update for poll vote
    setData((prev:any) => {
      if (!prev) return prev
      const updatedPosts = (prev.posts || []).map((p: any) => {
        if (p.id !== postId || !p.poll) return p
        const poll = p.poll
        
        // Find the option being clicked
        const clickedOption = poll.options.find((opt: any) => opt.id === optionId)
        const hasVotedOnThisOption = clickedOption?.user_voted || false
        
        const sv = (poll as any)?.single_vote
        const isSingle = (sv === true || sv === 1 || sv === '1' || sv === 'true')
        const updatedOptions = poll.options.map((opt: any) => {
          if (opt.id === optionId) {
            // Toggle: if already voted, remove vote; otherwise add vote
            return { 
              ...opt, 
              votes: hasVotedOnThisOption ? Math.max(0, opt.votes - 1) : opt.votes + 1,
              user_voted: !hasVotedOnThisOption 
            }
          }
          // If single vote, reduce previous vote when voting on different option
          if (isSingle && opt.user_voted && opt.id !== optionId) {
            return { ...opt, votes: Math.max(0, opt.votes - 1), user_voted: false }
          }
          return opt
        })
        
        // Update user_vote for single vote polls
        const newUserVote = hasVotedOnThisOption ? null : optionId
        return { ...p, poll: { ...poll, options: updatedOptions, user_vote: isSingle ? newUserVote : poll.user_vote } }
      })
      return { ...prev, posts: updatedPosts }
    })

    // Send vote to server
    try{
      const res = await fetch('/vote_poll', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ poll_id: pollId, option_id: optionId }) })
      const j = await res.json().catch(()=>null)
      if (!j?.success) return
      if (Array.isArray(j.poll_results)){
        // Reconcile this post's poll counts with server truth without full reload
        setData((prev:any) => {
          if (!prev) return prev
          const updatedPosts = (prev.posts || []).map((p: any) => {
            if (p.id !== postId || !p.poll) return p
            const rows = j.poll_results as Array<any>
            const newOptions = p.poll.options.map((opt:any) => {
              const row = rows.find(r => r.id === opt.id)
              return row ? { ...opt, votes: row.votes, user_voted: (row.user_voted ? true : false) } : opt
            })
            const newUserVote = typeof rows[0]?.user_vote !== 'undefined' ? (rows[0].user_vote || null) : p.poll.user_vote
            const totalVotes = rows[0]?.total_votes ?? newOptions.reduce((a:number, b:any) => a + (b.votes||0), 0)
            return { ...p, poll: { ...p.poll, options: newOptions, user_vote: newUserVote, total_votes: totalVotes } }
          })
          return { ...prev, posts: updatedPosts }
        })
      }
    }catch{}
  }

  const postsOnly = useMemo(() => Array.isArray(data?.posts) ? data.posts : [], [data])

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading…</div>
  if (error) return <div className="p-4 text-red-400">{error || 'Failed to load feed.'}</div>
  if (!data) return <div className="p-4 text-[#9fb0b5]">No posts yet.</div>

  async function runSearch(){
    const term = (q || '').trim()
    if (!term || !community_id) { setResults([]); return }
    try{
      const r = await fetch(`/api/community_posts_search?community_id=${community_id}&q=${encodeURIComponent(term)}`, { credentials:'include' })
      const j = await r.json().catch(()=>null)
      if (j?.success) setResults(j.posts||[])
      else setResults([])
    }catch{ setResults([]) }
  }

  function scrollToPost(postId: number){
    try{
      const el = document.getElementById(`post-${postId}`)
      if (el){ el.scrollIntoView({ behavior:'smooth', block:'start' }) }
      setShowSearch(false)
    }catch{}
  }

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white">
      {refreshHint && (
        <div className="fixed top-[72px] left-0 right-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="px-2 py-1 text-xs rounded-full bg-white/10 border border-white/15 text-white/80 flex items-center gap-2">
            <i className="fa-solid fa-rotate fa-spin" />
            <span>Refreshing…</span>
          </div>
        </div>
      )}
      {/* Scrollable content area below fixed global header */}
      <div ref={scrollRef} className={`h-full max-w-2xl mx-auto ${highlightStep === 'reaction' ? 'overflow-hidden' : 'overflow-y-auto'} no-scrollbar pb-20 px-3`} style={{ WebkitOverflowScrolling: 'touch' as any, overflowY: highlightStep === 'reaction' ? 'hidden' : 'auto', overscrollBehaviorY: 'contain', touchAction: highlightStep === 'reaction' ? 'none' : 'pan-y', paddingTop: `calc(12px + ${pullPx}px)` }}>
        <div className="space-y-3">
          {/* Back to communities (parent) + Search */}
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-sm hover:bg-white/10"
              onClick={()=> {
                const pid = (data?.parent_community?.id || data?.community?.parent_community_id || data?.community?.id)
                if (pid) window.location.href = `/communities?parent_id=${pid}`
                else window.location.href = '/communities'
              }}
            >
              ← Back to Communities
            </button>
            <button className="ml-auto p-2 rounded-full border border-white/10 hover:bg-white/10" aria-label="Search"
              onClick={()=> { setShowSearch(true); setTimeout(()=>{ try{ (document.getElementById('hashtag-input') as HTMLInputElement)?.focus() }catch{} }, 50) }}>
              <i className="fa-solid fa-magnifying-glass" />
            </button>
          </div>
          {/* Top header image from legacy template */}
          {data.community?.background_path ? (
            <div className="community-header-image overflow-hidden rounded-xl border border-white/10 mb-3 relative">
              {/* Dark overlay during reaction highlight */}
              {highlightStep === 'reaction' && (
                <div className="absolute inset-0 bg-black/90 z-[45] pointer-events-none" />
              )}
              <img 
                src={
                  (() => {
                    const p = String(data.community.background_path || '').trim()
                    if (!p) return ''
                    if (p.startsWith('http')) return p
                    if (p.startsWith('/uploads') || p.startsWith('uploads/')) return p.startsWith('/') ? p : `/${p}`
                    if (p.startsWith('/static')) return p
                    if (p.startsWith('static/')) return `/${p}`
                    const fname = p.split('/').slice(-1)[0]
                    return `/static/community_backgrounds/${fname}`
                  })()
                }
                alt={data.community?.name + ' Header'}
                className="block w-full h-auto header-image transition-transform duration-300 hover:scale-[1.015]"
                onError={(e:any)=>{ e.currentTarget.style.display='none' }}
                style={{ 
                  opacity: 1,
                  transition: 'opacity 0.3s ease-in-out'
                }}
                onLoad={(e) => {
                  // Hide loading overlay when image loads
                  const loadingOverlay = e.currentTarget.parentElement?.querySelector('.loading-overlay')
                  if (loadingOverlay) {
                    (loadingOverlay as HTMLElement).style.display = 'none'
                  }
                }}
              />
              
              {/* Loading overlay - same size as image container */}
              <div className="loading-overlay absolute inset-0 bg-white/5 flex items-center justify-center">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin"></div>
                  <div className="text-xs text-white/50">Loading header...</div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Feed items */}
          {postsOnly.map((p: Post, idx: number) => (
            <div key={p.id} className="relative">
              <PostCard
                post={p}
                idx={idx}
                currentUser={data.username}
                isAdmin={!!(data?.is_community_admin || data?.community?.creator_username === data?.username || data?.username === 'admin')}
                highlightStep={highlightStep}
                onOpen={() => navigate(`/post/${p.id}`)}
                onToggleReaction={handleToggleReaction}
                onPollVote={handlePollVote}
                communityId={community_id}
                navigate={navigate}
                onPollClick={() => navigate(`/community/${community_id}/polls_react`)}
                onOpenVoters={openVoters}
                onAddReply={onAddReply}
                onOpenReactions={() => openReactors(p.id)}
              />
              {/* Dark overlay for all posts except first one during reaction highlight */}
              {highlightStep === 'reaction' && idx !== 0 && (
                <div className="absolute inset-0 bg-black/90 z-[45] pointer-events-none" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Members modal removed: dedicated page now */}

      {/* Announcements modal */}
      {showAnnouncements && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && _setShowAnnouncements(false)}>
          <div className="w-[92%] max-w-[560px] rounded-2xl border border-white/10 bg-black p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Announcements</div>
              <button className="px-2 py-1 rounded-full border border-white/10" onClick={()=> _setShowAnnouncements(false)}>✕</button>
            </div>
            {(data?.is_community_admin || data?.community?.creator_username === data?.username || data?.username === 'admin') && (
              <div className="mb-3 p-2 rounded-xl border border-white/10 bg-white/[0.02]">
                <textarea value={newAnnouncement} onChange={(e)=> setNewAnnouncement(e.target.value)} placeholder="Write an announcement…" className="w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm focus:border-teal-400/70 outline-none min-h-[72px]" />
                <div className="text-right mt-2">
                  <button disabled={savingAnn || !newAnnouncement.trim()} onClick={saveAnnouncement} className="px-3 py-1.5 rounded-md bg-[#4db6ac] disabled:opacity-50 text-black text-sm hover:brightness-110">Post</button>
                </div>
              </div>
            )}
            <div className="space-y-3 max-h-[420px] overflow-y-auto">
              {_announcements.length === 0 ? (
                <div className="text-sm text-[#9fb0b5]">No announcements.</div>
              ) : _announcements.map((a:any)=> (
                <div key={a.id} className="rounded-xl border border-white/10 p-3 bg-white/[0.03]">
                  <div className="text-xs text-[#9fb0b5] mb-1">{a.created_by} • {(() => { try { const d = new Date(a.created_at); if (!isNaN(d.getTime())) return d.toLocaleDateString(); } catch(e) {} const s = String(a.created_at||'').split(' '); return s[0] || String(a.created_at||''); })()}</div>
                  <div className="whitespace-pre-wrap text-sm">{a.content}</div>
                  {(data?.is_community_admin || data?.community?.creator_username === data?.username || data?.username === 'admin') && (
                    <div className="mt-2 text-right">
                      <button className="px-2 py-1 rounded-full border border-white/10 text-xs hover:bg-white/5" onClick={()=> deleteAnnouncement(a.id)}>Delete</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Search modal */}
      {showSearch && (
        <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && setShowSearch(false)}>
          <div className="w-[92%] max-w-[560px] rounded-2xl border border-white/10 bg-black p-3">
            <div className="flex items-center gap-2 mb-2">
              <i className="fa-solid fa-hashtag text-[#4db6ac]" />
              <input id="hashtag-input" value={q} onChange={(e)=> setQ(e.target.value)} placeholder="#hashtag" className="flex-1 rounded-md bg-black border border-white/10 px-3 py-2 text-sm focus:border-teal-400/70 outline-none" />
              <button className="px-3 py-2 rounded-md bg-[#4db6ac] text-black text-sm hover:brightness-110" onClick={runSearch}>Search</button>
            </div>
            <div className="max-h-[320px] overflow-y-auto space-y-2">
              {results.length === 0 ? (
                <div className="text-[#9fb0b5] text-sm">No results</div>
              ) : results.map(r => (
                <button key={r.id} className="w-full text-left rounded-xl border border-white/10 p-2 hover:bg-white/5" onClick={()=> scrollToPost(r.id)}>
                  <div className="text-sm text-white/90 truncate">{r.content}</div>
                  <div className="text-xs text-[#9fb0b5]">{r.username} • {formatSmartTime(r.timestamp)}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Highlight overlay - Reaction Step */}
      {highlightStep === 'reaction' && (
        <>
          {/* Full-screen blocker - blocks all clicks except specific elements */}
          <div className="fixed inset-0 z-[48] pointer-events-auto" onClick={(e)=> e.stopPropagation()} />
          
          {/* Dark cover above the highlighted post (covers back button and community logo) */}
          <div className="fixed top-[56px] left-0 right-0 h-[30vh] z-[50] bg-black/90 pointer-events-none" />
          
          {/* Instruction prompt and Next button */}
          <div className="fixed top-[15%] left-1/2 transform -translate-x-1/2 z-[51] text-center w-[90%] max-w-sm pointer-events-auto">
            <div className="text-white text-base font-medium px-6 py-3 rounded-xl bg-black/70 backdrop-blur-md border border-[#4db6ac]/30 shadow-lg mb-3">
              React to a post <span className="text-[#4db6ac] text-sm ml-2">(1/2)</span>
            </div>
            <div className="flex gap-3 justify-center">
              <button 
                className="px-6 py-2 rounded-full bg-[#4db6ac]/50 text-white text-sm font-medium hover:bg-[#4db6ac]/70 shadow-[0_0_20px_rgba(77,182,172,0.6)] hover:shadow-[0_0_30px_rgba(77,182,172,0.8)]"
                onClick={()=> setHighlightStep('post')}
              >
                Next
              </button>
              <button 
                className="px-6 py-2 rounded-full border border-white/20 bg-white/[0.08] text-white text-sm font-medium hover:bg-white/[0.12]"
                onClick={()=> {
                  setHighlightStep(null);
                  try { 
                    const username = data?.username || '';
                    const doneKey = username ? `onboarding_done:${username}` : 'onboarding_done';
                    localStorage.setItem(doneKey, '1');
                  } catch {}
                }}
              >
                Skip
              </button>
            </div>
          </div>
        </>
      )}

      {/* Highlight overlay - Post Creation Step */}
      {highlightStep === 'post' && (
        <div className="fixed inset-0 z-[39] bg-black/85">
          {/* Description near the glowing button at bottom */}
          <div className="fixed bottom-32 left-1/2 transform -translate-x-1/2 text-center w-[90%] max-w-sm">
            <div className="text-white text-base font-medium px-6 py-3 rounded-xl bg-black/70 backdrop-blur-md border border-[#4db6ac]/30 shadow-lg">
              Click here to Create Your First Post <span className="text-[#4db6ac] text-sm ml-2">(2/2)</span>
            </div>
            <div className="w-1 h-12 mx-auto bg-gradient-to-b from-[#4db6ac]/50 to-transparent" />
          </div>
          
          {/* Action buttons at top */}
          <div className="absolute top-[15%] left-1/2 transform -translate-x-1/2 w-[90%] max-w-sm">
            <div className="flex justify-center">
              <button 
                className="px-8 py-2.5 rounded-full border border-white/20 bg-white/[0.08] text-white font-medium hover:bg-white/[0.12]"
                onClick={()=> {
                  setHighlightStep(null);
                  // Mark onboarding as complete
                  try { 
                    const username = data?.username || '';
                    const doneKey = username ? `onboarding_done:${username}` : 'onboarding_done';
                    localStorage.setItem(doneKey, '1');
                  } catch {}
                }}
              >
                Skip for now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom navigation bar - floating */}
      <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-40 w-[94%] max-w-[1200px] rounded-2xl border border-white/10 bg-black/80 backdrop-blur shadow-lg">
        <div className="h-14 px-6 flex items-center justify-between text-[#cfd8dc]">
          <button className="p-2 rounded-full hover:bg-white/5" aria-label="Home" onClick={()=> scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
            <i className="fa-solid fa-house" />
          </button>
          <button className="p-2 rounded-full hover:bg-white/5" aria-label="Members" onClick={()=> navigate(`/community/${community_id}/members`)}>
            <i className="fa-solid fa-users" />
          </button>
          <button 
            className={`w-10 h-10 rounded-md bg-[#4db6ac] text-black hover:brightness-110 grid place-items-center transition-all ${highlightStep === 'post' ? 'ring-[6px] ring-[#4db6ac] shadow-[0_0_40px_rgba(77,182,172,0.8)] animate-pulse scale-125 z-[40] relative' : ''}`}
            aria-label="New Post" 
            onClick={()=> { 
              const isFromOnboarding = highlightStep === 'post'
              if (isFromOnboarding) {
                setHighlightStep(null);
                // Mark onboarding as complete
                try { 
                  const username = data?.username || '';
                  const doneKey = username ? `onboarding_done:${username}` : 'onboarding_done';
                  localStorage.setItem(doneKey, '1');
                } catch {}
              }
              // Add first_post param if from onboarding
              navigate(`/compose?community_id=${community_id}${isFromOnboarding ? '&first_post=true' : ''}`);
            }}
          >
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

      {/* Bottom sheet for More */}
      {moreOpen && (
        <div className="fixed inset-0 z-[95] bg-black/30 flex items-end justify-end" onClick={(e)=> e.currentTarget===e.target && setMoreOpen(false)}>
          <div className="w-[75%] max-w-sm mr-2 mb-2 bg-black/80 backdrop-blur border border-white/10 rounded-2xl p-2 space-y-2 transition-transform duration-200 ease-out translate-y-0">
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/key_posts`) }}>
              Key Posts
            </button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5 flex items-center justify-end gap-2" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/polls_react`) }}>
              Polls
              {hasUnansweredPolls && <span className="w-2 h-2 bg-[#4db6ac] rounded-full" />}
            </button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/calendar_react`) }}>Calendar</button>
            {((data?.community?.type||'').toLowerCase().includes('university') || (data?.community?.name||'').toLowerCase().includes('university')) && (
              <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/tasks_react`) }}>Tasks</button>
            )}
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/photos_react`) }}>Photos</button>
            {/* Hide Forum/Useful Links for General communities */}
            {((data?.community?.type||'').toLowerCase() !== 'general') && (
              <>
                <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/resources_react`) }}>Forum</button>
                <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/useful_links_react`) }}>Useful Links & Docs</button>
              </>
            )}
            <EditCommunityButton communityId={String(community_id)} onClose={()=> setMoreOpen(false)} />
          </div>
        </div>
      )}

      {/* Voters modal */}
      {viewingVotersPollId && (
        <div className="fixed inset-0 z-[95] bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && setViewingVotersPollId(null)}>
          <div className="w-[92%] max-w-[560px] rounded-2xl border border-white/10 bg-black p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Voters</div>
              <button className="px-2 py-1 rounded-full border border-white/10" onClick={()=> setViewingVotersPollId(null)}>✕</button>
            </div>
            {votersLoading ? (
              <div className="text-[#9fb0b5] text-sm">Loading voters…</div>
            ) : (
              <div className="space-y-3 max-h-[420px] overflow-y-auto">
                {votersData.length === 0 ? (
                  <div className="text-sm text-[#9fb0b5]">No voters yet.</div>
                ) : votersData.map(opt => (
                  <div key={opt.id} className="rounded-lg border border-white/10 p-2">
                    <div className="text-xs text-white/80 mb-1">{opt.option_text}</div>
                    <div className="flex flex-col gap-1">
                      {(opt.voters||[]).map(v => (
                        <div key={`${opt.id}-${v.username}-${v.voted_at||''}`} className="flex items-center gap-2 text-xs text-[#9fb0b5]">
                          <Avatar username={v.username} url={v.profile_picture || undefined} size={18} />
                          <div className="flex-1 truncate">@{v.username}</div>
                          {/* remove timestamp in feed voters modal */}
                          <div className="tabular-nums" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reaction details modal */}
      {reactorsPostId && (
        <div className="fixed inset-0 z-[95] bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && setReactorsPostId(null)}>
          <div className="w-[92%] max-w-[560px] rounded-2xl border border-white/10 bg-black p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Reactions</div>
              <button className="px-2 py-1 rounded-full border border-white/10" onClick={()=> setReactorsPostId(null)}>✕</button>
            </div>
            {reactorsLoading ? (
              <div className="text-[#9fb0b5] text-sm">Loading…</div>
            ) : (
              <div className="space-y-3 max-h-[420px] overflow-y-auto">
                {reactorGroups.length === 0 ? (
                  <div className="text-sm text-[#9fb0b5]">No reactions yet.</div>
                ) : reactorGroups.map(group => (
                  <div key={group.reaction_type} className="rounded-lg border border-white/10 p-2">
                    <div className="text-xs text-white/80 mb-1 capitalize">{group.reaction_type.replace('-', ' ')}</div>
                    <div className="flex flex-col gap-1">
                      {(group.users||[]).map(u => (
                        <div key={`${group.reaction_type}-${u.username}`} className="flex items-center gap-2 text-xs text-[#9fb0b5]">
                          <Avatar username={u.username} url={u.profile_picture || undefined} size={18} />
                          <div className="flex-1 truncate">@{u.username}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ActionPill removed from UI in this layout

// Ad components removed

function PostCard({ post, idx, currentUser, isAdmin, highlightStep, onOpen, onToggleReaction, onPollVote, onPollClick, onOpenVoters, communityId, navigate, onAddReply, onOpenReactions }: { post: Post & { display_timestamp?: string }, idx: number, currentUser: string, isAdmin: boolean, highlightStep: 'reaction' | 'post' | null, onOpen: ()=>void, onToggleReaction: (postId:number, reaction:string)=>void, onPollVote?: (postId:number, pollId:number, optionId:number)=>void, onPollClick?: ()=>void, onOpenVoters?: (pollId:number)=>void, communityId?: string, navigate?: any, onAddReply?: (postId:number, reply: Reply)=>void, onOpenReactions?: ()=>void }) {
  const cardRef = useRef<HTMLDivElement|null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(post.content)
  const [starring, setStarring] = useState(false)
  const [detectedLinks, setDetectedLinks] = useState<DetectedLink[]>([])
  const [renamingLink, setRenamingLink] = useState<DetectedLink | null>(null)
  const [linkDisplayName, setLinkDisplayName] = useState('')
  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [activeChildReplyFor, setActiveChildReplyFor] = useState<number|null>(null)
  const [childReplyText, setChildReplyText] = useState('')
  const [sendingChildReply, setSendingChildReply] = useState(false)

  // Detect links when editing
  useEffect(() => {
    if (!isEditing) {
      setDetectedLinks([])
      return
    }
    const links = detectLinks(editText)
    // Filter out video embed URLs (YouTube, Vimeo, TikTok)
    // Instagram is treated as regular link (can be renamed)
    const nonVideoLinks = links.filter(link => {
      const url = link.url.toLowerCase()
      return !url.includes('youtube.com') && 
             !url.includes('youtu.be') && 
             !url.includes('vimeo.com') &&
             !url.includes('tiktok.com')
    })
    setDetectedLinks(nonVideoLinks)
  }, [editText, isEditing])

  function startRenamingLink(link: DetectedLink) {
    setRenamingLink(link)
    setLinkDisplayName(link.displayText)
  }

  function saveRenamedLink() {
    if (!renamingLink) return
    const newContent = replaceLinkInText(editText, renamingLink.url, linkDisplayName)
    setEditText(newContent)
    setRenamingLink(null)
    setLinkDisplayName('')
  }

  function cancelRenaming() {
    setRenamingLink(null)
    setLinkDisplayName('')
  }

  async function toggleStar(e: React.MouseEvent){
    e.stopPropagation()
    if (starring) return
    setStarring(true)
    try{
      // Optimistic flip
      const prev = post.is_starred
      ;(post as any).is_starred = !prev
      const fd = new URLSearchParams({ post_id: String(post.id) })
      const r = await fetch('/api/toggle_key_post', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
      const j = await r.json().catch(()=>null)
      if (!j?.success){
        ;(post as any).is_starred = prev
        alert(j?.error || 'Failed to update')
      } else {
        ;(post as any).is_starred = !!j.starred
      }
    } finally {
      setStarring(false)
    }
  }
  async function toggleCommunityStar(e: React.MouseEvent){
    e.stopPropagation()
    if (starring) return
    setStarring(true)
    try{
      const prev = post.is_community_starred
      ;(post as any).is_community_starred = !prev
      const fd = new URLSearchParams({ post_id: String(post.id) })
      const r = await fetch('/api/toggle_community_key_post', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
      const j = await r.json().catch(()=>null)
      if (!j?.success){
        ;(post as any).is_community_starred = prev
        alert(j?.error || 'Failed to update')
      } else {
        ;(post as any).is_community_starred = !!j.starred
      }
    } finally {
      setStarring(false)
    }
  }
  async function saveEdit(){
    const fd = new URLSearchParams({ post_id: String(post.id), content: editText })
    const r = await fetch('/edit_post', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success){ setIsEditing(false); try{ (window as any).location.reload() }catch{} }
    else alert(j?.error || 'Failed to update post')
  }
  return (
    <div id={`post-${post.id}`} ref={cardRef} className="rounded-2xl border border-white/10 bg-black shadow-sm shadow-black/20" onClick={post.poll ? undefined : onOpen}>
      {!post.poll && (
        <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
          <Avatar username={post.username} url={post.profile_picture || undefined} size={32} />
          <div className="font-medium tracking-[-0.01em]">{post.username}</div>
          <div className="text-xs text-[#9fb0b5] ml-auto tabular-nums">{formatSmartTime((post as any).display_timestamp || post.timestamp)}</div>
          {/* Personal star (turquoise when selected) */}
          <button className="ml-2 px-2 py-1 rounded-full" title={post.is_starred ? 'Unstar (yours)' : 'Star (yours)'} onClick={toggleStar} aria-label="Star post (yours)">
            <i className={`${post.is_starred ? 'fa-solid' : 'fa-regular'} fa-star`} style={{ color: post.is_starred ? '#4db6ac' : '#6c757d' }} />
          </button>
          {/* Community star (yellow) for owner/admins */}
          {(isAdmin || currentUser === 'admin') && (
            <button className="ml-1 px-2 py-1 rounded-full" title={post.is_community_starred ? 'Unfeature (community)' : 'Feature (community)'} onClick={toggleCommunityStar} aria-label="Star post (community)">
              <i className={`${post.is_community_starred ? 'fa-solid' : 'fa-regular'} fa-star`} style={{ color: post.is_community_starred ? '#ffd54f' : '#6c757d' }} />
            </button>
          )}
          {(post.username === currentUser || isAdmin || currentUser === 'admin') && (
            <button className="ml-2 px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]" title="Delete"
              onClick={async(e)=> { e.stopPropagation(); const ok = confirm('Delete this post?'); if(!ok) return; const fd = new FormData(); fd.append('post_id', String(post.id)); await fetch('/delete_post', { method:'POST', credentials:'include', body: fd }); location.reload() }}>
              <i className="fa-regular fa-trash-can" style={{ color: 'inherit' }} />
            </button>
          )}
          {(post.username === currentUser || isAdmin || currentUser === 'admin') && (
            <button className="ml-2 px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]" title="Edit"
              onClick={(e)=> { e.stopPropagation(); setIsEditing(true) }}>
              <i className="fa-regular fa-pen-to-square" />
            </button>
          )}
        </div>
      )}
      <div className="py-2 space-y-2">
        {!isEditing ? (
          <>
            {(() => {
              const videoEmbed = extractVideoEmbed(post.content)
              const displayContent = videoEmbed ? removeVideoUrlFromText(post.content, videoEmbed) : post.content
              return (
                <>
                  {displayContent && <div className="px-3 whitespace-pre-wrap text-[14px] leading-relaxed tracking-[0]">{renderTextWithLinks(displayContent)}</div>}
                  {videoEmbed && <VideoEmbed embed={videoEmbed} />}
                </>
              )
            })()}
          </>
        ) : (
          <div className="px-3 space-y-2" onClick={(e)=> e.stopPropagation()}>
            <textarea className="w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none min-h-[100px]" value={editText} onChange={(e)=> setEditText(e.target.value)} />
            
            {/* Detected links */}
            {detectedLinks.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-[#9fb0b5] font-medium">Detected Links:</div>
                {detectedLinks.map((link, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 rounded-lg border border-white/10 bg-white/5">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-[#4db6ac] truncate">{link.displayText}</div>
                      {link.displayText !== link.url && (
                        <div className="text-xs text-white/50 truncate">{link.url}</div>
                      )}
                    </div>
                    <button
                      className="px-2 py-1 rounded text-xs border border-[#4db6ac]/30 text-[#4db6ac] hover:bg-[#4db6ac]/10"
                      onClick={() => startRenamingLink(link)}
                    >
                      Rename
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="flex gap-2 justify-end">
              <button className="px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/5 text-sm" onClick={()=> { setEditText(post.content); setIsEditing(false) }}>Cancel</button>
              <button className="px-3 py-1.5 rounded-md bg-[#4db6ac] text-black text-sm hover:brightness-110" onClick={saveEdit}>Save</button>
            </div>
          </div>
        )}
        {post.image_path ? (
          <ImageLoader
            src={(() => {
              const p = post.image_path
              if (!p) return ''
              if (p.startsWith('http')) return p
              if (p.startsWith('/uploads') || p.startsWith('/static')) return p
              return p.startsWith('uploads') ? `/${p}` : `/uploads/${p}`
            })()}
            alt="Post image"
            className="block mx-auto max-w-full max-h-[360px] rounded border border-white/10 px-3"
          />
        ) : null}
        {/* Poll display */}
        {post.poll && (
          <div className="px-3 space-y-2" onClick={(e)=> e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <i className="fa-solid fa-chart-bar text-[#4db6ac]" />
              <div className="font-medium text-sm flex-1">
                {post.poll.question}
                {post.poll.expires_at ? (
                  <span className="ml-2 text-[11px] text-[#9fb0b5]">• closes {(() => { try { const d = new Date(post.poll.expires_at as any); if (!isNaN(d.getTime())) return d.toLocaleDateString(); } catch(e) {} return String(post.poll.expires_at) })()}</span>
                ) : null}
              </div>
              {(post.username === currentUser || isAdmin || currentUser === 'admin') && (
                <>
                  <button 
                    className="ml-auto px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]" 
                    title="Edit poll"
                    onClick={(e)=> { e.preventDefault(); e.stopPropagation(); if (navigate && communityId) navigate(`/community/${communityId}/polls_react?edit=${post.poll?.id}`) }}
                  >
                    <i className="fa-regular fa-pen-to-square" />
                  </button>
                  <button 
                    className="ml-1 px-2 py-1 rounded-full text-red-400 hover:text-red-300" 
                    title="Delete poll"
                    onClick={async (e)=> { 
                      e.preventDefault()
                      e.stopPropagation()
                      if (!confirm('Delete this poll? This cannot be undone.')) return
                      try {
                        const r = await fetch('/delete_poll', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify({ poll_id: post.poll?.id })
                        })
                        const j = await r.json()
                        if (j?.success) {
                          window.location.reload()
                        } else {
                          alert(j?.error || 'Failed to delete poll')
                        }
                      } catch (err) {
                        alert('Error deleting poll')
                      }
                    }}
                  >
                    <i className="fa-regular fa-trash-can" />
                  </button>
                </>
              )}
              <button 
                className="ml-1 px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]" 
                title="Voters"
                onClick={(e)=> { e.preventDefault(); e.stopPropagation(); onOpenVoters && onOpenVoters(post.poll!.id) }}
              >
                <i className="fa-solid fa-users" />
              </button>
            </div>
            <div className="space-y-2">
              {post.poll.options?.map(option => {
                const percentage = post.poll?.total_votes ? Math.round((option.votes / post.poll.total_votes) * 100) : 0
                const isUserVote = option.user_voted || false
                // Check both is_active flag AND expires_at timestamp
                const isClosed = post.poll!.is_active === 0
                const isExpiredByTime = (() => { try { const raw = (post.poll as any)?.expires_at; if (!raw) return false; const d = new Date(raw); return !isNaN(d.getTime()) && Date.now() >= d.getTime(); } catch { return false } })()
                const isExpired = isClosed || isExpiredByTime
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={isExpired}
                    className={`w-full text-left px-3 py-2 rounded-lg border relative overflow-hidden ${isExpired ? 'opacity-60 cursor-not-allowed' : (isUserVote ? 'border-[#4db6ac] bg-[#4db6ac]/10' : 'border-white/10 hover:bg-white/5')}`}
                    onClick={(e)=> { e.preventDefault(); e.stopPropagation(); if (!isExpired && onPollVote) onPollVote(post.id, post.poll!.id, option.id) }}
                  >
                    <div className="absolute inset-0 bg-[#4db6ac]/20" style={{ width: `${percentage}%`, transition: 'width 0.3s ease' }} />
                    <div className="relative flex items-center justify-between">
                      <span className="text-sm">{option.text}</span>
                      <span className="text-xs text-[#9fb0b5] font-medium">{option.votes} {percentage > 0 ? `(${percentage}%)` : ''}</span>
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="flex items-center justify-between text-xs text-[#9fb0b5] pt-1">
              {(() => { const sv = (post.poll as any)?.single_vote; const isSingle = !(sv === false || sv === 0 || sv === '0' || sv === 'false'); return isSingle })() && (
                <span>{post.poll.total_votes || 0} {post.poll.total_votes === 1 ? 'vote' : 'votes'}</span>
              )}
              <button 
                type="button"
                onClick={(e)=> { e.preventDefault(); e.stopPropagation(); if (onPollClick) onPollClick() }}
                className="text-[#4db6ac] hover:underline"
              >
                View all polls →
              </button>
            </div>
          </div>
        )}
        {/* Hide reactions and comments for poll posts */}
        {!post.poll && (
          <div className={`flex items-center gap-2 text-xs ${highlightStep === 'reaction' && idx === 0 ? 'relative z-[9999] pointer-events-auto' : ''}`} onClick={(e)=> e.stopPropagation()}>
            <div className={`${highlightStep === 'reaction' && idx === 0 ? 'ring-[3px] ring-[#4db6ac] shadow-[0_0_25px_rgba(77,182,172,1),0_0_50px_rgba(77,182,172,0.8)] rounded-lg bg-[#4db6ac]/10 animate-pulse' : ''}`}>
              <ReactionFA 
                icon="fa-regular fa-heart" 
                count={post.reactions?.['heart']||0} 
                active={post.user_reaction==='heart'} 
                onClick={()=> onToggleReaction(post.id, 'heart')}
                isHighlighted={highlightStep === 'reaction' && idx === 0}
              />
            </div>
            <ReactionFA icon="fa-regular fa-thumbs-up" count={post.reactions?.['thumbs-up']||0} active={post.user_reaction==='thumbs-up'} onClick={()=> onToggleReaction(post.id, 'thumbs-up')} />
            <ReactionFA icon="fa-regular fa-thumbs-down" count={post.reactions?.['thumbs-down']||0} active={post.user_reaction==='thumbs-down'} onClick={()=> onToggleReaction(post.id, 'thumbs-down')} />
            <button className="px-2 py-1 rounded-full text-[#9fb0b5] hover:text-white" title="View reactions" onClick={(e)=> { e.stopPropagation(); onOpenReactions && onOpenReactions() }}>
              <i className="fa-solid fa-users" />
            </button>
            <button className="ml-auto px-2.5 py-1 rounded-full text-[#cfd8dc]"
              onClick={(e)=> { e.stopPropagation(); onOpen() }}>
              <i className="fa-regular fa-comment" />
              <span className="ml-1">{post.replies?.length || 0}</span>
            </button>
          </div>
        )}
      </div>
      {/* Inline recent replies (last 1–2) */}
      {!post.poll && Array.isArray(post.replies) && post.replies.length > 0 && (
        <div className="px-3 pb-2 space-y-2" onClick={(e)=> e.stopPropagation()}>
          {(() => {
            const ordered = (() => {
              const pair = post.replies.slice(0, 2)
              if (pair.length === 2){
                const [a, b] = pair
                if (a && b){
                  // If one is the parent of the other, ensure parent appears first
                  if ((a as any).parent_reply_id === b.id) return [b, a]
                  if ((b as any).parent_reply_id === a.id) return [a, b]
                }
              }
              return pair
            })()
            return ordered.map(r => (
              <div key={r.id} className="flex items-start gap-2 text-sm">
                <Avatar username={r.username} url={r.profile_picture || undefined} size={22} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.username}</span>
                    <span className="text-[11px] text-[#9fb0b5]">{formatSmartTime(r.timestamp)}</span>
                    <button
                      className="ml-auto px-2 py-0.5 rounded-full text-[11px] text-[#9fb0b5] hover:text-[#4db6ac]"
                      onClick={(e)=> { e.stopPropagation(); setActiveChildReplyFor(id => id === r.id ? null : r.id); setChildReplyText('') }}
                    >
                      Reply
                    </button>
                  </div>
                  {r.parent_reply_id ? (
                    <div className="mb-1 text-[11px] text-white/60">
                      <span className="opacity-70">Replying to</span> <span className="opacity-90">a comment</span>
                    </div>
                  ) : null}
                  <div className="text-[#dfe6e9] whitespace-pre-wrap break-words">{r.content}</div>
                  {r.image_path ? (
                    <div className="mt-1">
                      <ImageLoader src={(r.image_path.startsWith('http') || r.image_path.startsWith('/')) ? r.image_path : `/uploads/${r.image_path}`} alt="Reply image" className="max-h-[200px] rounded border border-white/10" />
                    </div>
                  ) : null}

                  {activeChildReplyFor === r.id && (
                    <div className="mt-2 relative rounded-lg border border-white/5 bg-white/[0.03] focus-within:border-[#4db6ac]/40 transition-colors">
                      <MentionTextarea
                        value={childReplyText}
                        onChange={setChildReplyText}
                        communityId={communityId as any}
                        postId={post.id}
                        replyId={r.id as any}
                        placeholder={`Reply to @${r.username}`}
                        className="w-full resize-none px-3 py-1.5 pr-9 rounded-lg bg-transparent border-0 outline-none text-[14px] placeholder-white/40"
                        rows={1}
                      />
                      <button
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-full text-[#4db6ac] hover:text-white transition disabled:opacity-40"
                        disabled={sendingChildReply || !childReplyText.trim()}
                        onClick={async ()=>{
                          if (!childReplyText.trim() || sendingChildReply) return
                          try{
                            setSendingChildReply(true)
                            const fd = new FormData()
                            fd.append('post_id', String(post.id))
                            fd.append('content', childReplyText.trim())
                            fd.append('parent_reply_id', String(r.id))
                            fd.append('dedupe_token', `${Date.now()}_${Math.random().toString(36).slice(2)}`)
                            const resp = await fetch('/post_reply', { method:'POST', credentials:'include', body: fd })
                            const j = await resp.json().catch(()=>null)
                            if (j?.success && j.reply){
                              onAddReply && onAddReply(post.id, j.reply as any)
                              setChildReplyText('')
                              setActiveChildReplyFor(null)
                            } else {
                              alert(j?.error || 'Failed to reply')
                            }
                          } finally {
                            setSendingChildReply(false)
                          }
                        }}
                        aria-label="Send reply"
                      >
                        {sendingChildReply ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-paper-plane" />}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          })()}
          {post.replies.length > 2 && (
            <button className="text-xs text-[#4db6ac] hover:underline" onClick={()=> onOpen()}>View all replies →</button>
          )}
        </div>
      )}
      {/* Inline quick reply composer - sleek, full-width, low-distraction */}
      {!post.poll && (
        <div className="px-3 pb-3" onClick={(e)=> e.stopPropagation()}>
          <div className="relative group rounded-xl border border-white/5 bg-white/[0.03] focus-within:border-[#4db6ac]/40 transition-colors">
            <MentionTextarea
              value={replyText}
              onChange={setReplyText}
              communityId={communityId as any}
              postId={post.id}
              placeholder="Write a reply…"
              className="w-full resize-none px-3 py-1.5 pr-10 rounded-xl bg-transparent border-0 outline-none text-[14px] placeholder-white/40"
              rows={1}
            />
            <button
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-full text-[#4db6ac] hover:text-white transition disabled:opacity-40"
              disabled={sendingReply || !replyText.trim()}
              onClick={async ()=>{
                if (!replyText.trim() || sendingReply) return
                try{
                  setSendingReply(true)
                  const fd = new FormData()
                  fd.append('post_id', String(post.id))
                  fd.append('content', replyText.trim())
                  fd.append('dedupe_token', `${Date.now()}_${Math.random().toString(36).slice(2)}`)
                  const r = await fetch('/post_reply', { method:'POST', credentials:'include', body: fd })
                  const j = await r.json().catch(()=>null)
                  if (j?.success && j.reply){
                    onAddReply && onAddReply(post.id, j.reply as any)
                    setReplyText('')
                  } else {
                    alert(j?.error || 'Failed to reply')
                  }
                } finally {
                  setSendingReply(false)
                }
              }}
              aria-label="Send reply"
            >
              {sendingReply ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-paper-plane" />}
            </button>
          </div>
        </div>
      )}
      
      {/* Rename link modal */}
      {renamingLink && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm" onClick={(e)=> e.stopPropagation()}>
          <div className="w-[90%] max-w-md rounded-2xl border border-[#4db6ac]/30 bg-[#0b0b0b] p-6 shadow-[0_0_40px_rgba(77,182,172,0.3)]">
            <h3 className="text-lg font-bold text-white mb-4">Rename Link</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#9fb0b5] mb-1 block">Original URL:</label>
                <div className="text-xs text-white/70 truncate p-2 rounded bg-white/5 border border-white/10">
                  {renamingLink.url}
                </div>
              </div>
              <div>
                <label className="text-xs text-[#9fb0b5] mb-1 block">Display as:</label>
                <input
                  type="text"
                  value={linkDisplayName}
                  onChange={(e) => setLinkDisplayName(e.target.value)}
                  className="w-full p-2 rounded bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#4db6ac]"
                  placeholder="Enter display name"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                className="flex-1 px-4 py-2 rounded-lg border border-white/20 text-white/80 text-sm hover:bg-white/5"
                onClick={(e)=> { e.stopPropagation(); cancelRenaming() }}
              >
                Cancel
              </button>
              <button
                className="flex-1 px-4 py-2 rounded-lg bg-[#4db6ac] text-black font-medium hover:brightness-110"
                onClick={(e)=> { e.stopPropagation(); saveRenamedLink() }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ReactionFA({ icon, count, active, onClick, isHighlighted }:{ icon: string, count: number, active: boolean, onClick: ()=>void, isHighlighted?: boolean }){
  // Border-only turquoise for active icon (stroke/outline vibe); neutral grey. No pill/border backgrounds.
  const [popping, setPopping] = useState(false)
  const iconStyle: React.CSSProperties = isHighlighted 
    ? { color: '#5ffff0', filter: 'brightness(1.5) saturate(1.5)' }
    : active
    ? { color: '#4db6ac', WebkitTextStroke: '1px #4db6ac' }
    : { color: '#6c757d' }
  const handleClick = () => {
    setPopping(true)
    try { onClick() } finally { setTimeout(() => setPopping(false), 140) }
  }
  return (
    <button className={`px-2 py-1 rounded transition-colors`} onClick={handleClick}>
      <i className={`${icon} ${popping ? 'scale-125' : 'scale-100'} transition-transform duration-150`} style={iconStyle} />
      <span className="ml-1" style={{ color: isHighlighted ? '#5ffff0' : (active ? '#cfe9e7' : '#9fb0b5'), filter: isHighlighted ? 'brightness(1.5)' : undefined }}>{count}</span>
    </button>
  )
}

function EditCommunityButton({ communityId, onClose }:{ communityId: string, onClose: ()=>void }){
  const navigate = useNavigate()
  const [allowed, setAllowed] = useState<boolean>(false)
  useEffect(() => {
    let mounted = true
    async function check(){
      try{
        const fd = new URLSearchParams({ community_id: String(communityId) })
        const r = await fetch('/get_community_members', { method:'POST', credentials:'include', body: fd })
        const j = await r.json()
        if (!mounted) return
        const role = j?.current_user_role
        const can = role === 'app_admin' || role === 'owner'
        setAllowed(!!can)
      }catch{ setAllowed(false) }
    }
    check()
    return () => { mounted = false }
  }, [communityId])
  if (!allowed) return null
  return (
    <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { onClose(); navigate(`/community/${communityId}/edit`) }}>
      Manage Community
    </button>
  )
}

