import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

type Reply = { id: number; username: string; content: string; timestamp: string; reactions: Record<string, number>; user_reaction: string|null }
type Post = { id: number; username: string; content: string; image_path?: string|null; timestamp: string; reactions: Record<string, number>; user_reaction: string|null; replies: Reply[] }

function formatTimestamp(input: string): string {
  let d = new Date(input)
  if (isNaN(d.getTime())){
    const tryD = new Date(input.replace(' ', 'T'))
    if (!isNaN(tryD.getTime())) d = tryD
  }
  if (isNaN(d.getTime())) return input
  const now = new Date()
  const diffMs = Math.max(0, now.getTime() - d.getTime())
  const minuteMs = 60*1000, hourMs = 60*minuteMs, dayMs = 24*hourMs
  if (diffMs < hourMs) return `${Math.floor(diffMs/minuteMs)}m`
  if (diffMs < dayMs) return `${Math.floor(diffMs/hourMs)}h`
  const days = Math.floor(diffMs/dayMs)
  if (days < 10) return `${days}d`
  const mm = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0'), yy = String(d.getFullYear()%100).padStart(2,'0')
  return `${mm}/${dd}/${yy}`
}

export default function PostDetail(){
  const { post_id } = useParams()
  const navigate = useNavigate()
  const [post, setPost] = useState<Post|null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File|null>(null)

  useEffect(() => {
    let mounted = true
    async function load(){
      try{
        const r = await fetch(`/get_post?post_id=${post_id}`, { credentials: 'include' })
        const j = await r.json()
        if (!mounted) return
        if (j?.success) setPost(j.post)
        else setError(j?.error || 'Error')
      }catch{
        if (mounted) setError('Error loading post')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [post_id])

  async function toggleReaction(reaction: string){
    if (!post) return
    const form = new URLSearchParams({ post_id: String(post.id), reaction })
    const r = await fetch('/add_reaction', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: form })
    const j = await r.json().catch(()=>null)
    if (j?.success){
      setPost(p => p ? ({ ...p, reactions: { ...p.reactions, ...j.counts }, user_reaction: j.user_reaction }) : p)
    }
  }

  async function toggleReplyReaction(replyId: number, reaction: string){
    const form = new URLSearchParams({ reply_id: String(replyId), reaction })
    const r = await fetch('/add_reply_reaction', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: form })
    const j = await r.json().catch(()=>null)
    if (j?.success){
      setPost(p => {
        if (!p) return p
        const replies = p.replies.map(rep => rep.id===replyId ? ({ ...rep, reactions: { ...rep.reactions, ...j.counts }, user_reaction: j.user_reaction }) : rep)
        return { ...p, replies }
      })
    }
  }

  async function submitReply(){
    if (!post || (!content && !file)) return
    const fd = new FormData()
    fd.append('post_id', String(post.id))
    fd.append('content', content)
    if (file) fd.append('image', file)
    const r = await fetch('/post_reply', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success && j.reply){
      setPost(p => p ? ({ ...p, replies: [j.reply, ...p.replies] }) : p)
      setContent(''); setFile(null)
    }
  }

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading…</div>
  if (error || !post) return <div className="p-4 text-red-400">{error||'Error'}</div>

  return (
    <div className="min-h-screen bg-black text-white pb-24">
      <div className="fixed left-0 right-0 top-0 h-12 border-b border-white/10 bg-black/70 backdrop-blur flex items-center px-3 z-40">
        <button className="px-3 py-2 rounded-full text-[#cfd8dc] hover:text-[#4db6ac]" onClick={()=> navigate(-1)}>
          <i className="fa-solid fa-arrow-left" />
        </button>
        <div className="ml-2 font-semibold">Post</div>
      </div>

      <div className="max-w-2xl mx-auto pt-14 px-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] shadow-sm shadow-black/20">
          <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-white/10" />
            <div className="font-medium">{post.username}</div>
            <div className="text-xs text-[#9fb0b5] ml-auto">{formatTimestamp(post.timestamp)}</div>
          </div>
          <div className="px-3 py-2 space-y-2">
            <div className="whitespace-pre-wrap text-[14px]">{post.content}</div>
            {post.image_path ? (
              <img src={post.image_path.startsWith('/uploads') || post.image_path.startsWith('/static') ? post.image_path : `/uploads/${post.image_path}`} alt="" className="max-h-[360px] rounded border border-white/10" />
            ) : null}
            <div className="flex items-center gap-2 text-xs">
              <Reaction icon="fa-regular fa-heart" count={post.reactions?.['heart']||0} active={post.user_reaction==='heart'} onClick={()=> toggleReaction('heart')} />
              <Reaction icon="fa-regular fa-thumbs-up" count={post.reactions?.['thumbs-up']||0} active={post.user_reaction==='thumbs-up'} onClick={()=> toggleReaction('thumbs-up')} />
              <Reaction icon="fa-regular fa-thumbs-down" count={post.reactions?.['thumbs-down']||0} active={post.user_reaction==='thumbs-down'} onClick={()=> toggleReaction('thumbs-down')} />
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-white/10">
          {post.replies.map(r => (
            <div key={r.id} className="px-3 py-2 border-b border-white/10 text-sm">
              <div className="font-medium">{r.username}</div>
              <div className="text-[#dfe6e9] whitespace-pre-wrap">{r.content}</div>
              <div className="text-[11px] text-[#9fb0b5]">{formatTimestamp(r.timestamp)}</div>
              <div className="mt-1 flex items-center gap-2 text-[11px]">
                <Reaction icon="fa-regular fa-heart" count={r.reactions?.['heart']||0} active={r.user_reaction==='heart'} onClick={()=> toggleReplyReaction(r.id, 'heart')} />
                <Reaction icon="fa-regular fa-thumbs-up" count={r.reactions?.['thumbs-up']||0} active={r.user_reaction==='thumbs-up'} onClick={()=> toggleReplyReaction(r.id, 'thumbs-up')} />
                <Reaction icon="fa-regular fa-thumbs-down" count={r.reactions?.['thumbs-down']||0} active={r.user_reaction==='thumbs-down'} onClick={()=> toggleReplyReaction(r.id, 'thumbs-down')} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Fixed-bottom reply composer */}
      <div className="fixed left-0 right-0 bottom-0 z-50 bg-black/85 border-t border-white/10 backdrop-blur">
        <div className="max-w-2xl mx-auto px-3 py-2 flex items-center gap-2">
          <textarea className="flex-1 resize-none max-h-40 min-h-[44px] px-3 py-2 rounded bg-black border border-[#4db6ac] text-sm focus:outline-none focus:ring-1 focus:ring-[#4db6ac]" placeholder="Write a reply…" value={content} onChange={(e)=> setContent(e.target.value)} />
          <label className="px-2.5 py-1.5 rounded-full border border-white/10 text-xs text-[#9fb0b5] hover:border-[#2a3f41] cursor-pointer">
            <i className="fa-regular fa-image" style={{ color: '#4db6ac' }} />
            <input type="file" accept="image/*" onChange={(e)=> setFile(e.target.files?.[0]||null)} style={{ display: 'none' }} />
          </label>
          <button className="px-3 py-2 rounded-full bg-[#4db6ac] text-white border border-[#4db6ac] hover:brightness-110" onClick={submitReply}>Reply</button>
        </div>
      </div>
    </div>
  )
}

function Reaction({ icon, count, active, onClick }:{ icon: string, count: number, active: boolean, onClick: ()=>void }){
  const baseStyle: React.CSSProperties = active ? { backgroundColor:'#4db6ac', color:'#fff' } : { backgroundColor:'transparent', color:'#6c757d' }
  return (
    <button className="px-3 py-1 rounded-full transition-colors hover:text-[#4db6ac]" style={baseStyle} onClick={onClick}>
      <i className={icon} style={{ color:'inherit' }} />
      <span className="ml-1">{count}</span>
    </button>
  )
}