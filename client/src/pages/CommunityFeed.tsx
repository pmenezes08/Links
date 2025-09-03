import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

type PollOption = { id: number; text: string; votes: number }
type Poll = { id: number; question: string; is_active: number; options: PollOption[]; user_vote: number|null; total_votes: number }
type Reply = { id: number; username: string; content: string; timestamp: string; reactions: Record<string, number>; user_reaction: string|null, profile_picture?: string|null }
type Post = { id: number; username: string; content: string; image_path?: string|null; timestamp: string; reactions: Record<string, number>; user_reaction: string|null; poll?: Poll|null; replies: Reply[], profile_picture?: string|null }

function formatTimestamp(input: string): string {
  function parseDate(str: string): Date | null {
    // Epoch ms
    if (/^\d{10,13}$/.test(str.trim())){
      const n = Number(str)
      const d = new Date(n > 1e12 ? n : n * 1000)
      return isNaN(d.getTime()) ? null : d
    }
    // ISO or browser-parseable
    let d = new Date(str)
    if (!isNaN(d.getTime())) return d
    // Replace space with T
    d = new Date(str.replace(' ', 'T'))
    if (!isNaN(d.getTime())) return d
    // MM.DD.YY HH:MM (24h)
    const mdyDots = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}) (\d{1,2}):(\d{2})$/)
    if (mdyDots){
      const mm = Number(mdyDots[1])
      const dd = Number(mdyDots[2])
      const yy = Number(mdyDots[3])
      const HH = Number(mdyDots[4])
      const MM = Number(mdyDots[5])
      const year = 2000 + yy
      const dt = new Date(year, mm - 1, dd, HH, MM)
      return isNaN(dt.getTime()) ? null : dt
    }
    // MM/DD/YY hh:MM AM/PM
    const mdySlashAm = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}) (\d{1,2}):(\d{2}) (AM|PM)$/i)
    if (mdySlashAm){
      const mm = Number(mdySlashAm[1])
      const dd = Number(mdySlashAm[2])
      const yy = Number(mdySlashAm[3])
      let hh = Number(mdySlashAm[4])
      const MM = Number(mdySlashAm[5])
      const ampm = mdySlashAm[6].toUpperCase()
      if (ampm === 'PM' && hh < 12) hh += 12
      if (ampm === 'AM' && hh === 12) hh = 0
      const year = 2000 + yy
      const dt = new Date(year, mm - 1, dd, hh, MM)
      return isNaN(dt.getTime()) ? null : dt
    }
    // YYYY-MM-DD HH:MM:SS
    const ymd = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
    if (ymd){
      const year = Number(ymd[1])
      const mm = Number(ymd[2])
      const dd = Number(ymd[3])
      const HH = Number(ymd[4])
      const MM = Number(ymd[5])
      const SS = ymd[6] ? Number(ymd[6]) : 0
      const dt = new Date(year, mm - 1, dd, HH, MM, SS)
      return isNaN(dt.getTime()) ? null : dt
    }
    return null
  }

  const date = parseDate(input)
  if (!date) return input
  const now = new Date()
  let diffMs = now.getTime() - date.getTime()
  if (diffMs < 0) diffMs = 0
  const minuteMs = 60 * 1000
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs
  if (diffMs < hourMs){
    const mins = Math.floor(diffMs / minuteMs)
    return `${mins}m`
  }
  if (diffMs < dayMs){
    const hours = Math.floor(diffMs / hourMs)
    return `${hours}h`
  }
  const days = Math.floor(diffMs / dayMs)
  if (days < 10){
    return `${days}d`
  }
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const yy = String(date.getFullYear() % 100).padStart(2, '0')
  return `${mm}/${dd}/${yy}`
}

export default function CommunityFeed() {
  const { community_id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [members, setMembers] = useState<Array<{username:string, profile_picture?:string|null}>>([])
  const [showAnnouncements, _setShowAnnouncements] = useState(false)
  const [_announcements, _setAnnouncements] = useState<Array<{id:number, content:string, created_by:string, created_at:string}>>([])
  const [ad, setAd] = useState<any>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement|null>(null)
  // Modal removed in favor of dedicated PostDetail route

  useEffect(() => {
    // Inject legacy css to match compact desktop/brand styles
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/static/styles.css'
    document.head.appendChild(link)
    return () => { document.head.removeChild(link) }
  }, [])

  useEffect(() => {
    let isMounted = true
    setLoading(true)
    fetch(`/api/community_feed/${community_id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(json => { if (!isMounted) return; json?.success ? setData(json) : setError(json?.error || 'Error') })
      .catch(() => isMounted && setError('Error loading feed'))
      .finally(() => isMounted && setLoading(false))
    return () => { isMounted = false }
  }, [community_id])

  useEffect(() => {
    // Pull ads from backend ads section for the community
    async function loadAds(){
      try{
        const r = await fetch(`/get_university_ads?community_id=${community_id}`, { credentials: 'include' })
        const j = await r.json()
        if (j?.success && j.ads?.length){
          setAd(j.ads[0])
        } else {
          setAd(null)
        }
      }catch{
        setAd(null)
      }
    }
    loadAds()
  }, [community_id])

  async function openMembers(){
    try{
      const r = await fetch(`/community/${community_id}/members/list`, { credentials: 'include' })
      const j = await r.json()
      if (j && j.success !== false){
        const list = Array.isArray(j) ? j : (j.members || [])
        setMembers(list)
        setShowMembers(true)
      }
    }catch{}
  }

  async function fetchAnnouncements(){
    try{
      const r = await fetch(`/get_community_announcements?community_id=${community_id}`, { credentials: 'include' })
      const j = await r.json()
      if (j?.success){
        _setAnnouncements(j.announcements || [])
        _setShowAnnouncements(true)
      }
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

  const timeline = useMemo(() => {
    if (!data?.posts) return []
    const items: Array<{ type: 'post'|'ad'; post?: Post }> = []
    data.posts.forEach((p: Post, idx: number) => {
      if (idx === 3) items.push({ type: 'ad' })
      items.push({ type: 'post', post: p })
    })
    if (items.length === 0) items.push({ type: 'ad' })
    return items
  }, [data])

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading…</div>
  if (error) return <div className="p-4 text-red-400">{error}</div>
  if (!data) return null

  return (
    <div ref={scrollRef} className="h-screen overflow-y-auto no-scrollbar bg-black text-white">
      {/* Header with avatar + community name */}
      <div className="fixed left-0 right-0 top-0 h-14 border-b border-[#262f30] bg-black/70 backdrop-blur flex items-center px-3 z-40">
        <button className="mr-3 md:hidden" onClick={() => setMenuOpen(v=>!v)} aria-label="Menu">
          <div className="w-8 h-8 rounded-full bg-white/10 overflow-hidden">
            {data.current_user_profile_picture ? (
              <img src={(data.current_user_profile_picture.startsWith('http') || data.current_user_profile_picture.startsWith('/static')) ? data.current_user_profile_picture : `/static/${data.current_user_profile_picture}`} alt="" className="w-full h-full object-cover" />
            ) : (<i className="fa-solid fa-user" />)}
          </div>
        </button>
        <div className="font-semibold truncate tracking-[-0.01em] flex-1">{data.community?.name || 'Community'}</div>
        <div className="flex items-center gap-2">
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> window.location.href = `/user_chat`} aria-label="Messages">
            <i className="fa-solid fa-cloud" />
          </button>
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> window.location.href = `/notifications`} aria-label="Notifications">
            <i className="fa-regular fa-bell" />
          </button>
        </div>
      </div>

      {/* Slide-out menu (90% width), remaining 10% translucent to close with header */}
      {menuOpen && (
        <div className="fixed inset-0 z-[90] flex bg-black/50" onClick={(e)=> e.currentTarget===e.target && setMenuOpen(false)}>
          <div className="w-[90%] h-full bg-black/95 backdrop-blur border-r border-white/10 p-4 space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-white/10">
              <div className="w-10 h-10 rounded-full overflow-hidden bg-white/10">
                {data.current_user_profile_picture ? (
                  <img src={(data.current_user_profile_picture.startsWith('http') || data.current_user_profile_picture.startsWith('/static')) ? data.current_user_profile_picture : `/static/${data.current_user_profile_picture}`} alt="" className="w-full h-full object-cover" />
                ) : (<i className="fa-solid fa-user" />)}
              </div>
              <div className="font-medium truncate">{data.current_user_display_name || data.username}</div>
            </div>
            {data.username === 'admin' ? (
              <>
                <a className="block px-4 py-3 rounded-xl hover:bg-white/5" href="/admin_profile">Admin Profile</a>
                <a className="block px-4 py-3 rounded-xl hover:bg-white/5" href="/admin">Admin Dashboard</a>
              </>
            ) : null}
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5" href="/dashboard">Dashboard</a>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5" href="/profile">Profile</a>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5" href="/user_chat">Messages</a>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5" href="/communities">Your Communities</a>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5" href="/your_sports">Your Sports</a>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5" href="/logout">Logout</a>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5" href="/account_settings">Settings</a>
          </div>
          <div className="flex-1 h-full" onClick={()=> setMenuOpen(false)} />
        </div>
      )}

      <div className="max-w-2xl mx-auto pt-16 pb-20 px-3">
        <div className="space-y-3">
          {/* Top header image from legacy template */}
          {data.community?.background_path ? (
            <div className="community-header-image overflow-hidden rounded-xl border border-white/10">
              <img src={data.community.background_path.startsWith('http') ? data.community.background_path : `/static/community_backgrounds/${data.community.background_path.split('/').slice(-1)[0]}`}
                   alt={data.community?.name + ' Header'} className="header-image transition-transform duration-300 hover:scale-[1.015]" />
            </div>
          ) : null}

          {/* Feed items */}
          {timeline.map((item, i) => item.type === 'ad' ? (
            <AdsCard key={`ad-${i}`} communityId={String(community_id)} ad={ad} />
          ) : (
            <PostCard key={item.post!.id} post={item.post!} currentUser={data.username} isAdmin={!!data.is_community_admin} onOpen={() => { window.location.href = `/post/${item.post!.id}` }} onToggleReaction={handleToggleReaction} />
          ))}
        </div>
      </div>

      {/* Members modal */}
      {showMembers && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && setShowMembers(false)}>
          <div className="w-[90%] max-w-[480px] rounded-2xl border border-white/10 bg-black p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Members</div>
              <button className="px-2 py-1 rounded-full border border-white/10" onClick={()=> setShowMembers(false)}>✕</button>
            </div>
            <div className="max-h-[380px] overflow-y-auto space-y-2">
              {members.map((m,i)=> (
                <div key={i} className="flex items-center gap-2 p-2 rounded border border-white/10">
                  <div className="w-8 h-8 rounded-full bg-white/10" />
                  <div className="text-sm">{m.username || (m as any)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Announcements modal */}
      {showAnnouncements && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && _setShowAnnouncements(false)}>
          <div className="w-[92%] max-w-[560px] rounded-2xl border border-white/10 bg-black p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Announcements</div>
              <button className="px-2 py-1 rounded-full border border-white/10" onClick={()=> _setShowAnnouncements(false)}>✕</button>
            </div>
            <div className="space-y-3 max-h-[420px] overflow-y-auto">
              {_announcements.length === 0 ? (
                <div className="text-sm text-[#9fb0b5]">No announcements.</div>
              ) : _announcements.map((a:any)=> (
                <div key={a.id} className="rounded-xl border border-white/10 p-3 bg-white/[0.03]">
                  <div className="text-xs text-[#9fb0b5] mb-1">{a.created_by} • {a.created_at}</div>
                  <div className="whitespace-pre-wrap text-sm">{a.content}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom navigation bar */}
      <div className="fixed left-0 right-0 bottom-0 h-14 border-t border-white/10 bg-black/80 backdrop-blur z-40">
        <div className="max-w-2xl mx-auto h-full px-6 flex items-center justify-between text-[#cfd8dc]">
          <button className="p-2 rounded-full hover:bg-white/5" aria-label="Home" onClick={()=> scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
            <i className="fa-solid fa-house" />
          </button>
          <button className="p-2 rounded-full hover:bg-white/5" aria-label="Members" onClick={openMembers}>
            <i className="fa-solid fa-users" />
          </button>
          <button className="w-10 h-10 rounded-md bg-[#4db6ac] text-black hover:brightness-110 grid place-items-center" aria-label="New Post" onClick={()=> navigate(`/compose?community_id=${community_id}`)}>
            <i className="fa-solid fa-plus" />
          </button>
          <button className="p-2 rounded-full hover:bg-white/5" aria-label="Announcements" onClick={()=> { fetchAnnouncements() }}>
            <i className="fa-solid fa-bullhorn" />
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
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); window.location.href = `/community_feed/${community_id}` }}>Polls</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); window.location.href = `/community/${community_id}/calendar` }}>Calendar</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); window.location.href = `/community/${community_id}/resources` }}>Forum</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); window.location.href = `/community/${community_id}/resources` }}>Useful Links</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); window.location.href = `/issues` }}>Report Issue</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); window.location.href = `/anonymous_feedback` }}>Anonymous feedback</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ActionPill removed from UI in this layout

function AdsCard({ communityId: _communityId, ad }:{ communityId: string, ad: any }){
  if (!ad) return null
  const onClick = async () => {
    try{
      await fetch('/track_ad_click', { method: 'POST', credentials: 'include', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ ad_id: ad.id }) })
    }catch{}
    if (ad.link_url) window.open(ad.link_url, '_blank')
  }
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 shadow-sm shadow-black/20">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded bg-white/10 overflow-hidden flex items-center justify-center">
          {ad.image_url ? (<img src={ad.image_url} alt={ad.title} className="w-full h-full object-cover" />) : (<i className="fa-solid fa-store" />)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-[#9fb0b5]">Sponsored • University Store</div>
          <div className="font-medium truncate">{ad.title || 'Store'}</div>
          <div className="text-sm text-[#9fb0b5] truncate">{ad.description || 'Explore official merch and accessories.'}</div>
        </div>
        <button className="px-3 py-2 rounded-full bg-[#4db6ac] text-white border border-[#4db6ac] hover:brightness-110" onClick={onClick}>Shop</button>
      </div>
      {ad.image_url ? (
        <div className="mt-2 rounded-lg overflow-hidden border border-white/10">
          <img src={ad.image_url} alt={ad.title} className="w-full h-auto" onClick={onClick} style={{ cursor: 'pointer' }} />
        </div>
      ) : null}
    </div>
  )
}

// Removed legacy toggleReaction; reactions handled inline with state

function PostCard({ post, currentUser, isAdmin, onOpen, onToggleReaction }: { post: Post, currentUser: string, isAdmin: boolean, onOpen: ()=>void, onToggleReaction: (postId:number, reaction:string)=>void }) {
  const cardRef = useRef<HTMLDivElement|null>(null)
  return (
    <div ref={cardRef} className="rounded-2xl border border-white/10 bg-white/[0.035] shadow-sm shadow-black/20" onClick={onOpen}>
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-white/10 overflow-hidden">
          {post.profile_picture ? (
            <img src={(post.profile_picture.startsWith('http') || post.profile_picture.startsWith('/static')) ? post.profile_picture : `/static/${post.profile_picture}`}
                 alt="" className="w-full h-full object-cover" />
          ) : null}
        </div>
        <div className="font-medium tracking-[-0.01em]">{post.username}</div>
        <div className="text-xs text-[#9fb0b5] ml-auto tabular-nums">{formatTimestamp(post.timestamp)}</div>
        {(post.username === currentUser || isAdmin || currentUser === 'admin') && (
          <button className="ml-2 px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]" title="Delete"
            onClick={async(e)=> { e.stopPropagation(); const ok = confirm('Delete this post?'); if(!ok) return; const fd = new FormData(); fd.append('post_id', String(post.id)); await fetch('/delete_post', { method:'POST', credentials:'include', body: fd }); location.reload() }}>
            <i className="fa-regular fa-trash-can" style={{ color: 'inherit' }} />
          </button>
        )}
      </div>
      <div className="px-3 py-2 space-y-2">
        <div className="whitespace-pre-wrap text-[14px] leading-relaxed tracking-[0]">{post.content}</div>
        {post.image_path ? (
          <img src={post.image_path.startsWith('/uploads') || post.image_path.startsWith('/static') ? post.image_path : `/uploads/${post.image_path}`} alt="" className="block mx-auto max-w-full max-h-[360px] rounded border border-white/10" />
        ) : null}
        {post.poll ? <PollBlock poll={post.poll} postId={post.id} /> : null}
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

function PollBlock({ poll, postId }: { poll: Poll, postId: number }) {
  async function vote(optionId: number) {
    await fetch('/vote_poll', { method: 'POST', credentials: 'include', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ poll_id: poll.id, option_id: optionId, post_id: postId }) })
    location.reload()
  }
  return (
    <div className="rounded border border-white/10 p-2">
      <div className="font-medium mb-1 text-[14px]">{poll.question}</div>
      <div className="space-y-2">
        {poll.options.map(opt => (
          <button key={opt.id} className={`w-full text-left px-3 py-2 rounded border ${poll.user_vote===opt.id?'border-teal-500/50 bg-teal-700/10':'border-white/10 bg-white/5'}`} onClick={() => vote(opt.id)}>
            {opt.text}
            <span className="float-right text-xs text-[#9fb0b5]">{opt.votes}</span>
          </button>
        ))}
      </div>
      <div className="text-xs text-[#9fb0b5] mt-1">Total votes: {poll.total_votes}</div>
    </div>
  )
}

// Composer removed in this layout

// ReplyComposerInline removed in favor of fixed-bottom composer on PostDetail

