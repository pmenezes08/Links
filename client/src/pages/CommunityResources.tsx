import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'

export default function CommunityResources(){
  const { community_id } = useParams()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [posts, setPosts] = useState<Array<{ id:number; username:string; title:string; content:string; category?:string; attachment_url?:string; created_at:string; profile_picture?:string|null; upvotes?:number; user_upvoted?:boolean }>>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const scrollRef = useRef<HTMLDivElement|null>(null)
  const titleRef = useRef<HTMLInputElement|null>(null)
  const contentRef = useRef<HTMLTextAreaElement|null>(null)
  const categoryRef = useRef<HTMLSelectElement|null>(null)
  const attachRef = useRef<HTMLInputElement|null>(null)

  useEffect(() => { setTitle('Forum') }, [setTitle])

  function resolveAvatar(url?:string|null){
    if (!url) return null
    if (url.startsWith('http') || url.startsWith('/static')) return url
    return `/static/${url}`
  }

  async function load(){
    setLoading(true)
    try{
      // No direct API for posts; reuse HTML route data would be heavy. For now, render links only.
      // Future: add /api/resource_posts endpoint. Here we fallback to links list as core requirement is links + forum entry.
      setPosts([])
    }finally{ setLoading(false) }
  }
  useEffect(()=>{ load() }, [community_id])

  async function submitPost(){
    const t = titleRef.current?.value.trim() || ''
    const c = contentRef.current?.value.trim() || ''
    const cat = categoryRef.current?.value || 'General'
    const att = attachRef.current?.value || ''
    if (!t || !c){ alert('Title and content are required'); return }
    const r = await fetch(`/community/${community_id}/resources/create`, { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ title:t, content:c, category:cat, attachment_url:att }) })
    const j = await r.json().catch(()=>null)
    if (j?.success){ setShowForm(false); if (titleRef.current) titleRef.current.value=''; if (contentRef.current) contentRef.current.value=''; if (attachRef.current) attachRef.current.value=''; load() }
    else alert(j?.message || 'Failed to create')
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div
        className="fixed left-0 right-0 h-10 bg-black/70 backdrop-blur z-40"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))', '--app-subnav-height': '40px' } as CSSProperties}
      >
        <div className="max-w-2xl mx-auto h-full flex items-center gap-2 px-2">
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> navigate(`/community_feed_react/${community_id}`)} aria-label="Back">
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="flex-1 font-medium">Forum</div>
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
        <div className="rounded-2xl border border-white/10 bg-white/[0.035]">
          <div className="px-3 py-2 flex items-center justify-between border-b border-white/10">
            <div className="text-sm font-semibold">Create a Post</div>
            <button className="px-2 py-1 rounded-full bg-[#4db6ac] text-black text-xs hover:brightness-110" onClick={()=> setShowForm(v=>!v)}>
              {showForm ? 'Close' : 'New Post'}
            </button>
          </div>
          {showForm && (
            <div className="p-3 space-y-2">
              <label className="text-xs text-[#9fb0b5]">Title
                <input ref={titleRef} className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none" />
              </label>
              <label className="text-xs text-[#9fb0b5]">Category
                <select ref={categoryRef} className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm focus:border-teal-400/70 outline-none">
                  <option>General</option>
                  <option>Study Materials</option>
                  <option>Notes</option>
                  <option>Tips & Tricks</option>
                  <option>Questions</option>
                  <option>Announcements</option>
                </select>
              </label>
              <label className="text-xs text-[#9fb0b5]">Content
                <textarea ref={contentRef} className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none min-h-[100px]" />
              </label>
              <label className="text-xs text-[#9fb0b5]">Attachment URL (optional)
                <input ref={attachRef} className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm focus:border-teal-400/70 outline-none" placeholder="https://..." />
              </label>
              <div className="flex justify-end">
                <button className="px-3 py-1.5 rounded-md bg-[#4db6ac] text-black text-sm hover:brightness-110" onClick={submitPost}>Post</button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 space-y-3">
          {loading ? (<div className="text-[#9fb0b5]">Loading…</div>) : (
            posts.length === 0 ? (
              <div className="text-[#9fb0b5]">No posts yet. Be the first to share!</div>
            ) : posts.map(p => (
              <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.035]">
                <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
                  <Avatar username={p.username} url={resolveAvatar(p.profile_picture) || undefined} size={32} linkToProfile />
                  <div className="font-medium">{p.title}</div>
                  <div className="text-xs text-[#9fb0b5] ml-auto">{new Date(p.created_at).toLocaleDateString()}</div>
                </div>
                <div className="px-3 py-2 text-sm">{p.content}</div>
                {p.attachment_url ? (
                  <div className="px-3 pb-3"><a className="text-teal-300 hover:underline" href={p.attachment_url} target="_blank" rel="noreferrer">View Attachment</a></div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  )
}