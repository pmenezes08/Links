import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'

type Reply = { id: number; username: string; content: string; timestamp: string; reactions: Record<string, number>; user_reaction: string|null, parent_reply_id?: number|null, children?: Reply[], profile_picture?: string|null }
type Post = { id: number; username: string; content: string; image_path?: string|null; timestamp: string; reactions: Record<string, number>; user_reaction: string|null; replies: Reply[] }

function formatTimestamp(input: string): string {
  function parseDate(str: string): Date | null {
    if (/^\d{10,13}$/.test(str.trim())){
      const n = Number(str)
      const d = new Date(n > 1e12 ? n : n * 1000)
      return isNaN(d.getTime()) ? null : d
    }
    let d = new Date(str)
    if (!isNaN(d.getTime())) return d
    d = new Date(str.replace(' ', 'T'))
    if (!isNaN(d.getTime())) return d
    const mdyDots = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}) (\d{1,2}):(\d{2})$/)
    if (mdyDots){
      const mm = Number(mdyDots[1]), dd = Number(mdyDots[2]), yy = Number(mdyDots[3])
      const HH = Number(mdyDots[4]), MM = Number(mdyDots[5])
      const dt = new Date(2000 + yy, mm - 1, dd, HH, MM)
      return isNaN(dt.getTime()) ? null : dt
    }
    const mdySlashAm = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}) (\d{1,2}):(\d{2}) (AM|PM)$/i)
    if (mdySlashAm){
      const mm = Number(mdySlashAm[1]), dd = Number(mdySlashAm[2]), yy = Number(mdySlashAm[3])
      let hh = Number(mdySlashAm[4]); const MM = Number(mdySlashAm[5]); const ampm = mdySlashAm[6].toUpperCase()
      if (ampm === 'PM' && hh < 12) hh += 12
      if (ampm === 'AM' && hh === 12) hh = 0
      const dt = new Date(2000 + yy, mm - 1, dd, hh, MM)
      return isNaN(dt.getTime()) ? null : dt
    }
    const ymd = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
    if (ymd){
      const year = Number(ymd[1]), mm = Number(ymd[2]), dd = Number(ymd[3])
      const HH = Number(ymd[4]), MM = Number(ymd[5]), SS = ymd[6] ? Number(ymd[6]) : 0
      const dt = new Date(year, mm - 1, dd, HH, MM, SS)
      return isNaN(dt.getTime()) ? null : dt
    }
    return null
  }
  const d = parseDate(input)
  if (!d) return input
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
  const [composerActive, setComposerActive] = useState(false)

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
    // Optimistic update
    setPost(p => {
      if (!p) return p
      const prevUser = p.user_reaction
      const nextUser = prevUser === reaction ? null : reaction
      const counts = { ...(p.reactions || {}) }
      if (prevUser) counts[prevUser] = Math.max(0, (counts[prevUser] || 0) - 1)
      if (nextUser) counts[nextUser] = (counts[nextUser] || 0) + 1
      return { ...p, user_reaction: nextUser, reactions: counts }
    })
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
        function update(list: Reply[]): Reply[] {
          return list.map(rep => {
            if (rep.id === replyId){
              return { ...rep, reactions: { ...rep.reactions, ...j.counts }, user_reaction: j.user_reaction }
            }
            return { ...rep, children: rep.children ? update(rep.children) : rep.children }
          })
        }
        return { ...p, replies: update(p.replies) }
      })
    }
  }

  async function submitReply(parentReplyId?: number){
    if (!post || (!content && !file)) return
    const fd = new FormData()
    fd.append('post_id', String(post.id))
    fd.append('content', content)
    if (parentReplyId) fd.append('parent_reply_id', String(parentReplyId))
    if (file) fd.append('image', file)
    const r = await fetch('/post_reply', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success && j.reply){
      setPost(p => {
        if (!p) return p
        if (parentReplyId){
          function attach(list: Reply[]): Reply[] {
            return list.map(item => {
              if (item.id === parentReplyId){
                const children = item.children ? [j.reply, ...item.children] : [j.reply]
                return { ...item, children }
              }
              return { ...item, children: item.children ? attach(item.children) : item.children }
            })
          }
          return { ...p, replies: attach(p.replies) }
        }
        return { ...p, replies: [j.reply, ...p.replies] }
      })
      setContent(''); setFile(null)
    }
  }

  async function submitInlineReply(parentId: number, text: string){
    if (!post || !text) return
    const fd = new FormData()
    fd.append('post_id', String(post.id))
    fd.append('content', text)
    fd.append('parent_reply_id', String(parentId))
    const r = await fetch('/post_reply', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success && j.reply){
      setPost(p => {
        if (!p) return p
        function attach(list: Reply[]): Reply[] {
          return list.map(item => {
            if (item.id === parentId){
              const children = item.children ? [j.reply, ...item.children] : [j.reply]
              return { ...item, children }
            }
            return { ...item, children: item.children ? attach(item.children) : item.children }
          })
        }
        return { ...p, replies: attach(p.replies) }
      })
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
            <Avatar username={post.username} url={(post as any).profile_picture || undefined} size={32} />
            <div className="font-medium">{post.username}</div>
            <div className="text-xs text-[#9fb0b5] ml-auto">{formatTimestamp(post.timestamp)}</div>
          </div>
          <div className="px-3 py-2 space-y-2">
            <div className="whitespace-pre-wrap text-[14px]">{post.content}</div>
            {post.image_path ? (
              <img src={post.image_path.startsWith('/uploads') || post.image_path.startsWith('/static') ? post.image_path : `/uploads/${post.image_path}`} alt="" className="block mx-auto max-w-full max-h-[360px] rounded border border-white/10" />
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
            <ReplyNode key={r.id} reply={r} onToggle={(id, reaction)=> toggleReplyReaction(id, reaction)} onInlineReply={(id, text)=> submitInlineReply(id, text)} />
          ))}
        </div>
      </div>

      {/* Fixed-bottom reply composer */}
      <div className="fixed left-0 right-0 bottom-0 z-50 bg-black/85 border-t border-white/10 backdrop-blur">
        <div className="px-3 py-2 flex flex-col gap-1.5">
          <textarea
            className="w-full resize-none max-h-36 min-h-[30px] px-3 py-1.5 rounded-2xl bg-black border border-[#4db6ac] text-sm focus:outline-none focus:ring-1 focus:ring-[#4db6ac]"
            placeholder="Write a reply…"
            value={content}
            onChange={(e)=> setContent(e.target.value)}
            onFocus={()=> setComposerActive(true)}
            onBlur={()=> { if (!content && !file) setComposerActive(false) }}
          />
          {(composerActive || !!content || !!file) ? (
            <div className="flex items-center justify-end gap-2">
              <label className="px-2.5 py-1.5 rounded-full border border-white/10 text-xs text-[#9fb0b5] hover:border-[#2a3f41] cursor-pointer">
                <i className="fa-regular fa-image" style={{ color: '#4db6ac' }} />
                <input type="file" accept="image/*" onChange={(e)=> setFile(e.target.files?.[0]||null)} style={{ display: 'none' }} />
              </label>
              <button className="px-2.5 py-1.5 rounded-full bg-[#4db6ac] text-white border border-[#4db6ac] hover:brightness-110" onClick={()=> submitReply()} aria-label="Send reply">
                <i className="fa-solid fa-paper-plane" />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Reaction({ icon, count, active, onClick }:{ icon: string, count: number, active: boolean, onClick: ()=>void }){
  // Border-only turquoise for active icon
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

function ReplyNode({ reply, depth=0, onToggle, onInlineReply }:{ reply: Reply, depth?: number, onToggle: (id:number, reaction:string)=>void, onInlineReply: (id:number, text:string)=>void }){
  const [showComposer, setShowComposer] = useState(false)
  const [text, setText] = useState('')
  const avatarSizePx = 28
  return (
    <div className="border-b border-white/10 py-2">
      <div className="relative flex items-start gap-2 px-3">
        <div className="relative w-10 flex-shrink-0">
          {depth > 0 ? (
            <div className="absolute" style={{ left: '50%', transform: 'translateX(-0.5px)', top: 0, height: `calc(50% - ${avatarSizePx/2}px)`, width: '1px', background: 'rgba(255,255,255,0.15)', borderRadius: '9999px' }} />
          ) : null}
          {reply.children && reply.children.length ? (
            <div className="absolute" style={{ left: '50%', transform: 'translateX(-0.5px)', top: `calc(50% + ${avatarSizePx/2}px)`, bottom: 0, width: '1px', background: 'rgba(255,255,255,0.15)', borderRadius: '9999px' }} />
          ) : null}
          <Avatar username={reply.username} url={reply.profile_picture || undefined} size={28} />
        </div>
        <div className="flex-1 min-w-0 pr-2">
          <div className="flex items-center gap-2">
            <div className="font-medium">{reply.username}</div>
            <div className="text-[11px] text-[#9fb0b5] ml-auto">{formatTimestamp(reply.timestamp)}</div>
          </div>
          <div className="text-[#dfe6e9] whitespace-pre-wrap mt-0.5">{reply.content}</div>
          <div className="mt-1 flex items-center gap-2 text-[11px]">
            <Reaction icon="fa-regular fa-heart" count={reply.reactions?.['heart']||0} active={reply.user_reaction==='heart'} onClick={()=> onToggle(reply.id, 'heart')} />
            <Reaction icon="fa-regular fa-thumbs-up" count={reply.reactions?.['thumbs-up']||0} active={reply.user_reaction==='thumbs-up'} onClick={()=> onToggle(reply.id, 'thumbs-up')} />
            <Reaction icon="fa-regular fa-thumbs-down" count={reply.reactions?.['thumbs-down']||0} active={reply.user_reaction==='thumbs-down'} onClick={()=> onToggle(reply.id, 'thumbs-down')} />
            <button className="ml-2 px-2 py-1 rounded-full text-[#9fb0b5] hover:text-[#4db6ac]" onClick={()=> setShowComposer(v=>!v)}>Reply</button>
          </div>
          {showComposer ? (
            <div className="mt-2 flex items-center gap-2">
              <input className="flex-1 px-3 py-1.5 rounded-full bg-black border border-[#4db6ac] text-sm focus:outline-none focus:ring-1 focus:ring-[#4db6ac]" value={text} onChange={(e)=> setText(e.target.value)} placeholder={`Reply to @${reply.username}`} />
              <button className="px-2.5 py-1.5 rounded-full bg-[#4db6ac] text-white border border-[#4db6ac] hover:brightness-110" onClick={()=> { if (!text) return; onInlineReply(reply.id, text); setText(''); setShowComposer(false) }} aria-label="Send reply">
                <i className="fa-solid fa-paper-plane" />
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {reply.children && reply.children.length ? reply.children.map(ch => (
        <ReplyNode key={ch.id} reply={ch} depth={Math.min(depth+1, 3)} onToggle={onToggle} onInlineReply={onInlineReply} />
      )) : null}
    </div>
  )
}