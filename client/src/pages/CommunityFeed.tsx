import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

type PollOption = { id: number; text: string; votes: number }
type Poll = { id: number; question: string; is_active: number; options: PollOption[]; user_vote: number|null; total_votes: number }
type Reply = { id: number; username: string; content: string; timestamp: string; reactions: Record<string, number>; user_reaction: string|null }
type Post = { id: number; username: string; content: string; image_path?: string|null; timestamp: string; reactions: Record<string, number>; user_reaction: string|null; poll?: Poll|null; replies: Reply[] }

export default function CommunityFeed() {
  const { community_id } = useParams()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [members, setMembers] = useState<Array<{username:string, profile_picture?:string|null}>>([])
  const [showAnnouncements, setShowAnnouncements] = useState(false)
  const [announcements, setAnnouncements] = useState<Array<{id:number, content:string, created_by:string, created_at:string}>>([])
  const [ad, setAd] = useState<any>(null)
  const [postModal, setPostModal] = useState<{open: boolean, post: Post|null}>({ open: false, post: null })

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

  async function openAnnouncements(){
    try{
      const r = await fetch(`/get_community_announcements?community_id=${community_id}`, { credentials: 'include' })
      const j = await r.json()
      if (j?.success){
        setAnnouncements(j.announcements || [])
        setShowAnnouncements(true)
      }
    }catch{}
  }

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
    <div className="min-h-screen bg-black text-white">
      {/* Header + burger (subtle translucency, compact) */}
      <div className="fixed left-0 right-0 top-0 h-14 border-b border-[#262f30] bg-black/70 backdrop-blur flex items-center px-3 z-40">
        <button className="px-3 py-2 rounded border border-[#333] bg-[#1a1a1a] mr-3 md:hidden" onClick={() => setMenuOpen(v=>!v)} aria-label="Menu">
          <i className="fa-solid fa-bars" />
        </button>
        <div className="font-semibold truncate tracking-[-0.01em]">{data.community?.name || 'Community'}</div>
      </div>

      {/* Full-screen burger menu */}
      {menuOpen && (
        <div className="fixed inset-0 z-[90] bg-black/90 backdrop-blur" onClick={(e)=> e.currentTarget===e.target && setMenuOpen(false)}>
          <div className="max-w-sm mx-auto mt-16 p-4 space-y-2">
            <a className="block px-4 py-3 rounded-xl border border-white/10 hover:border-[#2a3f41]" href="/dashboard">Dashboard</a>
            <a className="block px-4 py-3 rounded-xl border border-white/10 hover:border-[#2a3f41]" href="/profile">Profile</a>
            <a className="block px-4 py-3 rounded-xl border border-white/10 hover:border-[#2a3f41]" href="/user_chat">Messages</a>
            <a className="block px-4 py-3 rounded-xl border border-white/10 hover:border-[#2a3f41]" href="/communities">Your Communities</a>
            <a className="block px-4 py-3 rounded-xl border border-white/10 hover:border-[#2a3f41]" href="/your_sports">Your Sports</a>
            <button className="mt-3 w-full px-4 py-3 rounded-full border border-white/10" onClick={()=> setMenuOpen(false)}>Close</button>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto pt-16 px-3">
        {/* Top header image from legacy template */}
        {data.community?.background_path ? (
          <div className="community-header-image mb-3 overflow-hidden rounded-xl border border-white/10">
            <img src={data.community.background_path.startsWith('http') ? data.community.background_path : `/static/community_backgrounds/${data.community.background_path.split('/').slice(-1)[0]}`}
                 alt={data.community?.name + ' Header'} className="header-image transition-transform duration-300 hover:scale-[1.015]" />
          </div>
        ) : null}

        {/* Action bar burger + inline */}
        <div className="mb-3 flex items-center gap-2">
          <button className="px-3 py-2 rounded-full border border-white/10 hover:border-[#2a3f41]" onClick={()=> setActionsOpen(true)} aria-label="Community menu"><i className="fa-solid fa-bars" style={{ color: '#4db6ac' }} /></button>
          <div className="flex flex-wrap gap-2">
            <ActionPill icon="fa-users" label="Members" onClick={openMembers} />
            <ActionPill icon="fa-bullhorn" label="Announcements" onClick={openAnnouncements} />
            <ActionPill icon="fa-chart-pie" label="Polls" onClick={()=> window.location.href = `/community_feed/${community_id}`} />
          </div>
        </div>

        {/* Composer */}
        <Composer communityId={String(community_id)} onPosted={() => location.reload()} />

        <div className="space-y-3">
          {timeline.map((item, i) => item.type === 'ad' ? (
            <AdsCard key={`ad-${i}`} communityId={String(community_id)} ad={ad} />
          ) : (
            <PostCard key={item.post!.id} post={item.post!} currentUser={data.username} isAdmin={!!data.is_community_admin} onOpen={() => setPostModal({ open: true, post: item.post! })} />
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
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && setShowAnnouncements(false)}>
          <div className="w-[92%] max-w-[560px] rounded-2xl border border-white/10 bg-black p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Announcements</div>
              <button className="px-2 py-1 rounded-full border border-white/10" onClick={()=> setShowAnnouncements(false)}>✕</button>
            </div>
            <div className="space-y-3 max-h-[420px] overflow-y-auto">
              {announcements.length === 0 ? (
                <div className="text-sm text-[#9fb0b5]">No announcements.</div>
              ) : announcements.map(a=> (
                <div key={a.id} className="rounded-xl border border-white/10 p-3 bg-white/[0.03]">
                  <div className="text-xs text-[#9fb0b5] mb-1">{a.created_by} • {a.created_at}</div>
                  <div className="whitespace-pre-wrap text-sm">{a.content}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Actions full-screen overlay */}
      {actionsOpen && (
        <div className="fixed inset-0 z-[95] bg-black/90 backdrop-blur" onClick={(e)=> e.currentTarget===e.target && setActionsOpen(false)}>
          <div className="max-w-sm mx-auto mt-16 p-4 grid grid-cols-2 gap-2">
            <ActionPill icon="fa-users" label="Members" onClick={openMembers} />
            <ActionPill icon="fa-bullhorn" label="Announcements" onClick={openAnnouncements} />
            <ActionPill icon="fa-chart-pie" label="Polls" onClick={()=> window.location.href = `/community_feed/${community_id}`} />
            <ActionPill icon="fa-link" label="Links" onClick={()=> window.location.href = `/community/${community_id}/resources`} />
            <ActionPill icon="fa-bell" label="Notifications" onClick={()=> window.location.href = `/notifications`} />
            <ActionPill icon="fa-flag" label="Issues" onClick={()=> {}} />
            <ActionPill icon="fa-calendar" label="Calendar" onClick={()=> window.location.href = `/community/${community_id}/calendar`} />
            <ActionPill icon="fa-ellipsis" label="More" onClick={()=> {}} />
            <button className="col-span-2 mt-2 px-4 py-3 rounded-full border border-white/10" onClick={()=> setActionsOpen(false)}>Close</button>
          </div>
        </div>
      )}

      {/* Post detail modal with replies */}
      {postModal.open && postModal.post && (
        <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur" onClick={(e)=> e.currentTarget===e.target && setPostModal({ open:false, post:null })}>
          <div className="w-[92%] max-w-[700px] mx-auto mt-10 rounded-2xl border border-white/10 bg-black p-3 max-h-[80vh] overflow-y-auto">
            <PostCard key={`modal-${postModal.post.id}`} post={postModal.post} currentUser={data.username} isAdmin={!!data.is_community_admin} onOpen={()=>{}} />
            {postModal.post.replies?.length ? (
              <div className="mt-2 rounded-xl border border-white/10">
                {postModal.post.replies.map(r => (
                  <div key={r.id} className="px-3 py-2 border-b border-white/10 text-sm">
                    <div className="font-medium">{r.username}</div>
                    <div className="text-[#dfe6e9] whitespace-pre-wrap">{r.content}</div>
                    <div className="text-[11px] text-[#9fb0b5]">{r.timestamp}</div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mt-2 rounded-xl border border-white/10 p-2">
              <ReplyComposer postId={postModal.post.id} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ActionPill({ icon, label, onClick }:{ icon: string, label: string, onClick: ()=>void }){
  return (
    <button className="px-3 py-1.5 rounded-full border border-white/10 text-xs text-[#cfd8dc] hover:border-[#2a3f41]" onClick={onClick}>
      <i className={`fa-solid ${icon} mr-1`} style={{ color: '#4db6ac' }} />{label}
    </button>
  )
}

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

async function toggleReaction(postId: number, reaction: string){
  const form = new URLSearchParams({ post_id: String(postId), reaction })
  await fetch('/add_reaction', { method: 'POST', credentials: 'include', headers: { 'Content-Type':'application/x-www-form-urlencoded' }, body: form })
  location.reload()
}

function PostCard({ post, currentUser, isAdmin, onOpen }: { post: Post, currentUser: string, isAdmin: boolean, onOpen: ()=>void }) {
  const cardRef = useRef<HTMLDivElement|null>(null)
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const onEnter = () => {
      el.classList.add('ring-1')
      el.classList.add('ring-[#4db6ac]')
    }
    const onLeave = () => {
      el.classList.remove('ring-1')
      el.classList.remove('ring-[#4db6ac]')
    }
    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', onLeave)
    return () => { el.removeEventListener('mouseenter', onEnter); el.removeEventListener('mouseleave', onLeave) }
  }, [])
  return (
    <div ref={cardRef} className="rounded-2xl border border-white/10 bg-white/[0.035] shadow-sm shadow-black/20 transition-[box-shadow,border]" onClick={onOpen}>
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-white/10" />
        <div className="font-medium tracking-[-0.01em]">{post.username}</div>
        <div className="text-xs text-[#9fb0b5] ml-auto tabular-nums">{post.timestamp}</div>
        {(post.username === currentUser || isAdmin) && (
          <button className="ml-2 px-2 py-1 rounded-full border border-white/10 hover:border-[#2a3f41]" title="Delete"
            onClick={async(e)=> { e.stopPropagation(); const ok = confirm('Delete this post?'); if(!ok) return; const fd = new FormData(); fd.append('post_id', String(post.id)); await fetch('/delete_post', { method:'POST', credentials:'include', body: fd }); location.reload() }}>
            <i className="fa-regular fa-trash-can" style={{ color: '#ef5350' }} />
          </button>
        )}
      </div>
      <div className="px-3 py-2 space-y-2">
        <div className="whitespace-pre-wrap text-[14px] leading-relaxed tracking-[0]">{post.content}</div>
        {post.image_path ? (
          <img src={post.image_path.startsWith('/uploads') || post.image_path.startsWith('/static') ? post.image_path : `/uploads/${post.image_path}`} alt="" className="max-h-[360px] rounded border border-white/10" />
        ) : null}
        {post.poll ? <PollBlock poll={post.poll} postId={post.id} /> : null}
        <div className="flex items-center gap-2 text-xs" onClick={(e)=> e.stopPropagation()}>
          <ReactionFA icon="fa-regular fa-thumbs-up" count={post.reactions?.like||0} active={post.user_reaction==='like'} onClick={()=> toggleReaction(post.id, 'like')} />
          <ReactionFA icon="fa-regular fa-heart" count={post.reactions?.love||0} active={post.user_reaction==='love'} onClick={()=> toggleReaction(post.id, 'love')} />
          <ReactionFA icon="fa-solid fa-hands-clapping" count={post.reactions?.clap||0} active={post.user_reaction==='clap'} onClick={()=> toggleReaction(post.id, 'clap')} />
          <button className="ml-auto px-3 py-1 rounded-full border border-white/10 hover:border-[#2a3f41] text-[#9fb0b5]"
            onClick={(e)=> { e.stopPropagation(); onOpen() }}>
            <span className="mr-1" style={{ color: '#4db6ac' }}>💬</span>{post.replies?.length || 0}
          </button>
        </div>
      </div>
    </div>
  )
}

function ReactionFA({ icon, count, active, onClick }:{ icon: string, count: number, active: boolean, onClick: ()=>void }){
  // Match HTML colors: neutral subtle border/text; active = turquoise bg + white text
  const baseStyle: React.CSSProperties = active
    ? { backgroundColor: '#4db6ac', color: '#ffffff', borderColor: '#4db6ac' }
    : { backgroundColor: '#00000000', color: '#6c757d', borderColor: '#dee2e6' }
  return (
    <button
      className="reaction-btn px-3 py-1 rounded-full border transition-colors hover:border-[#4db6ac] hover:text-[#4db6ac]"
      style={baseStyle}
      onClick={onClick}
    >
      <i className={icon} style={{ color: 'inherit' }}></i>
      <span className="ml-1">{count}</span>
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

function Composer({ communityId, onPosted }: { communityId: string, onPosted: ()=>void }){
  const [content, setContent] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement|null>(null)
  async function submit(){
    if (!content && !imageFile) return
    const fd = new FormData()
    fd.append('content', content)
    fd.append('community_id', communityId)
    if (imageFile) fd.append('image', imageFile)
    await fetch('/post_status', { method: 'POST', credentials: 'include', body: fd })
    onPosted()
  }
  return (
    <div className="rounded-xl border border-white/10 bg-black p-3 mb-3">
      <textarea className="w-full resize-none min-h-[60px] p-2 rounded bg-black border border-[#4db6ac] text-sm focus:outline-none focus:ring-1 focus:ring-[#4db6ac]"
        placeholder="Write something…" value={content} onChange={(e)=> setContent(e.target.value)} />
      <div className="mt-2 flex items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*" onChange={(e)=> setImageFile(e.target.files?.[0]||null)} style={{ display: 'none' }} />
        <button className="px-2.5 py-1.5 rounded-full border border-white/10 text-xs text-[#9fb0b5] hover:border-[#2a3f41]" onClick={()=> fileRef.current?.click()} aria-label="Add image">
          <i className="fa-regular fa-image" style={{ color: '#4db6ac' }} />
        </button>
        <button className="ml-auto px-3 py-2 rounded-full bg-[#4db6ac] text-white border border-[#4db6ac] hover:brightness-110" onClick={submit}>Post</button>
      </div>
    </div>
  )
}

function ReplyComposer({ postId }: { postId: number }){
  const [content, setContent] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement|null>(null)
  async function submit(){
    if (!content && !imageFile) return
    const fd = new FormData()
    fd.append('post_id', String(postId))
    fd.append('content', content)
    if (imageFile) fd.append('image', imageFile)
    await fetch('/post_reply', { method: 'POST', credentials: 'include', body: fd })
    setContent(''); setImageFile(null)
    location.reload()
  }
  return (
    <div className="p-2 space-y-2">
      <textarea className="w-full resize-none min-h-[44px] px-3 py-2 rounded bg-black border border-[#4db6ac] text-sm focus:outline-none focus:ring-1 focus:ring-[#4db6ac]" placeholder="Write a reply…" value={content} onChange={(e)=> setContent(e.target.value)} />
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*" onChange={(e)=> setImageFile(e.target.files?.[0]||null)} style={{ display: 'none' }} />
        <button className="px-2.5 py-1.5 rounded-full border border-white/10 text-xs text-[#9fb0b5] hover:border-[#2a3f41]" onClick={()=> fileRef.current?.click()} aria-label="Add image">
          <i className="fa-regular fa-image" style={{ color: '#4db6ac' }} />
        </button>
        <button className="ml-auto px-3 py-1.5 rounded-full bg-[#4db6ac] text-white text-xs border border-[#4db6ac] hover:brightness-110" onClick={submit}>Reply</button>
      </div>
    </div>
  )
}

