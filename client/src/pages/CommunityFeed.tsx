import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { formatSmartTime } from '../utils/time'
import ImageLoader from '../components/ImageLoader'
import { useHeader } from '../contexts/HeaderContext'

type PollOption = { id: number; text: string; votes: number }
type Poll = { id: number; question: string; is_active: number; options: PollOption[]; user_vote: number|null; total_votes: number }
type Reply = { id: number; username: string; content: string; timestamp: string; reactions: Record<string, number>; user_reaction: string|null, profile_picture?: string|null }
type Post = { id: number; username: string; content: string; image_path?: string|null; timestamp: string; reactions: Record<string, number>; user_reaction: string|null; poll?: Poll|null; replies: Reply[], profile_picture?: string|null }

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
  // Modal removed in favor of dedicated PostDetail route

  // Set header title consistently
  const { setTitle } = useHeader()
  useEffect(() => { if (data?.community?.name) setTitle(data.community.name) }, [setTitle, data?.community?.name])

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
  }, [community_id])

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
      {/* Scrollable content area below fixed global header */}
      <div ref={scrollRef} className="h-full max-w-2xl mx-auto overflow-y-auto no-scrollbar pt-3 pb-20 px-3" style={{ WebkitOverflowScrolling: 'touch' as any }}>
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
              <img 
                src={
                  data.community.background_path.startsWith('http')
                    ? data.community.background_path
                    : (data.community.background_path.includes('community_backgrounds/')
                        ? `/static/${data.community.background_path}`
                        : `/static/community_backgrounds/${data.community.background_path.split('/').slice(-1)[0]}`)
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
          {postsOnly.map((p: Post) => (
            <PostCard key={p.id} post={p} currentUser={data.username} isAdmin={!!data.is_community_admin} onOpen={() => navigate(`/post/${p.id}`)} onToggleReaction={handleToggleReaction} />
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
                  <div className="text-xs text-[#9fb0b5] mb-1">{a.created_by} • {a.created_at}</div>
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

      {/* Bottom navigation bar - floating */}
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

      {/* Bottom sheet for More */}
      {moreOpen && (
        <div className="fixed inset-0 z-[95] bg-black/30 flex items-end justify-end" onClick={(e)=> e.currentTarget===e.target && setMoreOpen(false)}>
          <div className="w-[75%] max-w-sm mr-2 mb-2 bg-black/80 backdrop-blur border border-white/10 rounded-2xl p-2 space-y-2 transition-transform duration-200 ease-out translate-y-0">
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/polls_react`) }}>Polls</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/calendar_react`) }}>Calendar</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/photos`) }}>Photos</button>
            {/* Hide Forum/Useful Links for General communities */}
            {((data?.community?.type||'').toLowerCase() !== 'general') && (
              <>
                <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/resources_react`) }}>Forum</button>
                <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/useful_links_react`) }}>Useful Links & Docs</button>
              </>
            )}
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/members`) }}>Members</button>
            <EditCommunityButton communityId={String(community_id)} onClose={()=> setMoreOpen(false)} />
            {/* Hide Report Issue and Anonymous Feedback for General */}
            {((data?.community?.type||'').toLowerCase() !== 'general') && (
              <>
                <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); window.location.href = `/issues` }}>Report Issue</button>
                <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); window.location.href = `/anonymous_feedback` }}>Anonymous feedback</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ActionPill removed from UI in this layout

// Ad components removed

function PostCard({ post, currentUser, isAdmin, onOpen, onToggleReaction }: { post: Post & { display_timestamp?: string }, currentUser: string, isAdmin: boolean, onOpen: ()=>void, onToggleReaction: (postId:number, reaction:string)=>void }) {
  const cardRef = useRef<HTMLDivElement|null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(post.content)
  async function saveEdit(){
    const fd = new URLSearchParams({ post_id: String(post.id), content: editText })
    const r = await fetch('/edit_post', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success){ setIsEditing(false); try{ (window as any).location.reload() }catch{} }
    else alert(j?.error || 'Failed to update post')
  }
  return (
    <div id={`post-${post.id}`} ref={cardRef} className="rounded-2xl border border-white/10 bg-black shadow-sm shadow-black/20" onClick={onOpen}>
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <Avatar username={post.username} url={post.profile_picture || undefined} size={32} />
        <div className="font-medium tracking-[-0.01em]">{post.username}</div>
        <div className="text-xs text-[#9fb0b5] ml-auto tabular-nums">{formatSmartTime((post as any).display_timestamp || post.timestamp)}</div>
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
      <div className="px-3 py-2 space-y-2">
        {!isEditing ? (
          <div className="whitespace-pre-wrap text-[14px] leading-relaxed tracking-[0]">{post.content}</div>
        ) : (
          <div className="space-y-2" onClick={(e)=> e.stopPropagation()}>
            <textarea className="w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none min-h-[100px]" value={editText} onChange={(e)=> setEditText(e.target.value)} />
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
            className="block mx-auto max-w-full max-h-[360px] rounded border border-white/10"
          />
        ) : null}
        {/* Polls are not displayed on the timeline in React */}
        <div className="flex items-center gap-2 text-xs" onClick={(e)=> e.stopPropagation()}>
          <ReactionFA icon="fa-regular fa-heart" count={post.reactions?.['heart']||0} active={post.user_reaction==='heart'} onClick={()=> onToggleReaction(post.id, 'heart')} />
          <ReactionFA icon="fa-regular fa-thumbs-up" count={post.reactions?.['thumbs-up']||0} active={post.user_reaction==='thumbs-up'} onClick={()=> onToggleReaction(post.id, 'thumbs-up')} />
          <ReactionFA icon="fa-regular fa-thumbs-down" count={post.reactions?.['thumbs-down']||0} active={post.user_reaction==='thumbs-down'} onClick={()=> onToggleReaction(post.id, 'thumbs-down')} />
          <button className="ml-auto px-2.5 py-1 rounded-full text-[#cfd8dc]"
            onClick={(e)=> { e.stopPropagation(); onOpen() }}>
            <i className="fa-regular fa-comment" />
            <span className="ml-1">{post.replies?.length || 0}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function ReactionFA({ icon, count, active, onClick }:{ icon: string, count: number, active: boolean, onClick: ()=>void }){
  // Border-only turquoise for active icon (stroke/outline vibe); neutral grey. No pill/border backgrounds.
  const [popping, setPopping] = useState(false)
  const iconStyle: React.CSSProperties = active
    ? { color: '#4db6ac', WebkitTextStroke: '1px #4db6ac' }
    : { color: '#6c757d' }
  const handleClick = () => {
    setPopping(true)
    try { onClick() } finally { setTimeout(() => setPopping(false), 140) }
  }
  return (
    <button className="px-2 py-1 rounded transition-colors" onClick={handleClick}>
      <i className={`${icon} ${popping ? 'scale-125' : 'scale-100'} transition-transform duration-150`} style={iconStyle} />
      <span className="ml-1" style={{ color: active ? '#cfe9e7' : '#9fb0b5' }}>{count}</span>
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

