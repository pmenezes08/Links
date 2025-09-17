import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'

type Reply = { id: number; username: string; content: string; timestamp: string; reactions: Record<string, number>; user_reaction: string|null, parent_reply_id?: number|null, children?: Reply[], profile_picture?: string|null, image_path?: string|null }
type Post = { id: number; username: string; content: string; image_path?: string|null; timestamp: string; reactions: Record<string, number>; user_reaction: string|null; replies: Reply[] }

function formatTimestamp(input: string): string {
  function parseDate(str: string): Date | null {
    if (!str) return null
    const s = String(str).trim()
    if (s.startsWith('0000-00-00')) return null
    if (/^\d{10,13}$/.test(s)){
      const n = Number(s)
      const d = new Date(n > 1e12 ? n : n * 1000)
      return isNaN(d.getTime()) ? null : d
    }
    let d = new Date(s); if (!isNaN(d.getTime())) return d
    d = new Date(s.replace(' ', 'T')); if (!isNaN(d.getTime())) return d
    const mdyDots = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}) (\d{1,2}):(\d{2})$/)
    if (mdyDots){ const mm = Number(mdyDots[1]), dd = Number(mdyDots[2]), yy = Number(mdyDots[3]); const HH = Number(mdyDots[4]), MM = Number(mdyDots[5]); const dt = new Date(2000 + yy, mm - 1, dd, HH, MM); return isNaN(dt.getTime()) ? null : dt }
    const mdySlashAm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}) (\d{1,2}):(\d{2}) (AM|PM)$/i)
    if (mdySlashAm){ let hh = Number(mdySlashAm[4]); const MM = Number(mdySlashAm[5]); const ampm = mdySlashAm[6].toUpperCase(); if (ampm === 'PM' && hh < 12) hh += 12; if (ampm === 'AM' && hh === 12) hh = 0; const dt = new Date(2000 + Number(mdySlashAm[3]), Number(mdySlashAm[1]) - 1, Number(mdySlashAm[2]), hh, MM); return isNaN(dt.getTime()) ? null : dt }
    const dmyDash = s.match(/^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
    if (dmyDash){ const dd = Number(dmyDash[1]), mm = Number(dmyDash[2]), yyyy = Number(dmyDash[3]); const HH = dmyDash[4]?Number(dmyDash[4]):0; const MM = dmyDash[5]?Number(dmyDash[5]):0; const SS = dmyDash[6]?Number(dmyDash[6]):0; const dt = new Date(yyyy, mm - 1, dd, HH, MM, SS); return isNaN(dt.getTime()) ? null : dt }
    const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
    if (ymd){ const dt = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), Number(ymd[4]), Number(ymd[5]), ymd[6]?Number(ymd[6]):0); return isNaN(dt.getTime()) ? null : dt }
    return null
  }
  const d = parseDate(input)
  if (!d) return input
  const dd = String(d.getDate()).padStart(2,'0')
  const mm = String(d.getMonth()+1).padStart(2,'0')
  const yyyy = String(d.getFullYear())
  return `${dd}-${mm}-${yyyy}`
}

function renderRichText(input: string){
  const nodes: Array<React.ReactNode> = []
  const markdownRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  // First, process markdown links
  while ((match = markdownRe.exec(input))){
    if (match.index > lastIndex){
      nodes.push(...preserveNewlines(input.slice(lastIndex, match.index)))
    }
    const label = match[1]
    const url = match[2]
    nodes.push(<a key={`md-${match.index}`} href={url} target="_blank" rel="noopener noreferrer" className="text-[#4db6ac] underline-offset-2 hover:underline break-words break-all">{label}</a>)
    lastIndex = markdownRe.lastIndex
  }
  const rest = input.slice(lastIndex)
  // Then, linkify plain URLs in the rest
  const urlRe = /(https?:\/\/[^\s]+|www\.[^\s]+)/g
  let urlLast = 0
  let m: RegExpExecArray | null
  while ((m = urlRe.exec(rest))){
    if (m.index > urlLast){
      nodes.push(...preserveNewlines(rest.slice(urlLast, m.index)))
    }
    const urlText = m[0]
    const href = urlText.startsWith('http') ? urlText : `https://${urlText}`
    nodes.push(<a key={`u-${lastIndex + m.index}`} href={href} target="_blank" rel="noopener noreferrer" className="text-[#4db6ac] underline-offset-2 hover:underline break-words break-all">{urlText}</a>)
    urlLast = urlRe.lastIndex
  }
  if (urlLast < rest.length){
    nodes.push(...preserveNewlines(rest.slice(urlLast)))
  }
  return <>{nodes}</>
}

function preserveNewlines(text: string){
  const parts = text.split(/\n/)
  const out: Array<React.ReactNode> = []
  parts.forEach((p, i) => {
    if (i > 0) out.push(<br key={`br-${i}-${p.length}-${Math.random()}`} />)
    if (p) out.push(p)
  })
  return out
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
  const fileInputRef = useRef<HTMLInputElement|null>(null)

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

  async function submitInlineReply(parentId: number, text: string, file?: File){
    if (!post || (!text && !file)) return
    const fd = new FormData()
    fd.append('post_id', String(post.id))
    fd.append('content', text || '')
    fd.append('parent_reply_id', String(parentId))
    if (file) fd.append('image', file)
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
      <div className="max-w-2xl mx-auto pt-14 px-3">
        <div className="mb-2">
          <button className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-sm hover:bg-white/10" onClick={()=> navigate(-1)} aria-label="Back">
            ← Back
          </button>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] shadow-sm shadow-black/20">
          <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
            <Avatar username={post.username} url={(post as any).profile_picture || undefined} size={32} />
            <div className="font-medium">{post.username}</div>
            <div className="text-xs text-[#9fb0b5] ml-auto">{formatTimestamp((post as any).display_timestamp || post.timestamp)}</div>
          </div>
          <div className="px-3 py-2 space-y-2">
            <div className="whitespace-pre-wrap text-[14px] break-words break-all">{renderRichText(post.content)}</div>
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
            <ReplyNode key={r.id} reply={r} onToggle={(id, reaction)=> toggleReplyReaction(id, reaction)} onInlineReply={(id, text, file)=> submitInlineReply(id, text, file)} />
          ))}
        </div>
      </div>

      {/* Hidden file input for main composer */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          console.log('File selected:', e.target.files);
          setFile(e.target.files?.[0] || null);
        }}
        style={{ display: 'none', position: 'fixed', top: '-9999px', left: '-9999px' }}
      />

      {/* Fixed-bottom reply composer */}
      <div className="fixed left-0 right-0 bottom-0 z-50 bg-black/85 border-t border-white/10 backdrop-blur">
        <div className="px-3 py-2 flex flex-col gap-1.5">
          <textarea
            className="w-full resize-none max-h-36 min-h-[30px] px-3 py-1.5 rounded-2xl bg-black border border-[#4db6ac] text-[16px] focus:outline-none focus:ring-1 focus:ring-[#4db6ac]"
            placeholder="Write a reply…"
            value={content}
            onChange={(e)=> setContent(e.target.value)}
            onFocus={()=> setComposerActive(true)}
            onBlur={()=> { if (!content && !file) setComposerActive(false) }}
          />
          {(composerActive || !!content || !!file) ? (
            <>
              <div className="flex items-center justify-end gap-2 flex-wrap">
                {file && (
                  <div className="text-xs text-[#7fe7df] flex items-center gap-1">
                    <i className="fa-solid fa-check" />
                    <span>{file.name}</span>
                    <button 
                      onClick={() => setFile(null)}
                      className="ml-1 text-red-400 hover:text-red-300"
                    >
                      <i className="fa-solid fa-times" />
                    </button>
                  </div>
                )}
                <div
                  className="inline-flex items-center justify-center w-10 h-10 rounded-full hover:bg-white/10 cursor-pointer" 
                  aria-label="Add image"
                  onClick={() => {
                    console.log('Image button clicked - triggering file input');
                    if (fileInputRef.current) {
                      console.log('File input ref found, clicking...');
                      fileInputRef.current.click();
                    } else {
                      console.error('File input ref not found');
                    }
                  }}
                >
                  <i className="fa-regular fa-image text-xl" style={{ color: file ? '#7fe7df' : '#4db6ac' }} />
                </div>
                {/(https?:\/\/[^\s]+|www\.[^\s]+)/.test(content) ? (
                  <button className="px-2.5 py-1.5 rounded-full border border-white/10 text-xs text-[#9fb0b5] hover:border-[#2a3f41] break-words" onClick={()=> {
                    const m = content.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/)
                    if (!m) return
                    const urlText = m[0]
                    // eslint-disable-next-line no-alert
                    const label = window.prompt('Link text', urlText) || urlText
                    const href = urlText
                    const replacement = `[${label}](${href})`
                    setContent(content.replace(urlText, replacement))
                  }}>Link name</button>
                ) : null}
                <div
                  className="px-2.5 py-1.5 rounded-full bg-[#4db6ac] text-white border border-[#4db6ac] hover:brightness-110 cursor-pointer inline-flex items-center" 
                  onClick={() => {
                    console.log('Send button clicked - submitting reply with content:', content, 'and file:', file);
                    submitReply();
                  }} 
                  aria-label="Send reply"
                >
                  <i className="fa-solid fa-paper-plane" />
                </div>
              </div>
            </>
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

function ReplyNode({ reply, depth=0, onToggle, onInlineReply }:{ reply: Reply, depth?: number, onToggle: (id:number, reaction:string)=>void, onInlineReply: (id:number, text:string, file?: File)=>void }){
  const [showComposer, setShowComposer] = useState(false)
  const [text, setText] = useState('')
  const [img, setImg] = useState<File|null>(null)
  const inlineFileRef = useRef<HTMLInputElement|null>(null)
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
          <div className="text-[#dfe6e9] whitespace-pre-wrap mt-0.5 break-words break-all">{renderRichText(reply.content)}</div>
          {reply.image_path ? (
            <div className="mt-2">
              <img
                src={reply.image_path.startsWith('/uploads') || reply.image_path.startsWith('/static') ? reply.image_path : `/uploads/${reply.image_path}`}
                alt=""
                className="block mx-auto max-w-full max-h-[300px] rounded border border-white/10"
              />
            </div>
          ) : null}
          <div className="mt-1 flex items-center gap-2 text-[11px]">
            <Reaction icon="fa-regular fa-heart" count={reply.reactions?.['heart']||0} active={reply.user_reaction==='heart'} onClick={()=> onToggle(reply.id, 'heart')} />
            <Reaction icon="fa-regular fa-thumbs-up" count={reply.reactions?.['thumbs-up']||0} active={reply.user_reaction==='thumbs-up'} onClick={()=> onToggle(reply.id, 'thumbs-up')} />
            <Reaction icon="fa-regular fa-thumbs-down" count={reply.reactions?.['thumbs-down']||0} active={reply.user_reaction==='thumbs-down'} onClick={()=> onToggle(reply.id, 'thumbs-down')} />
            <button className="ml-2 px-2 py-1 rounded-full text-[#9fb0b5] hover:text-[#4db6ac]" onClick={()=> setShowComposer(v=>!v)}>Reply</button>
          </div>
          {showComposer ? (
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <input className="flex-1 px-3 py-1.5 rounded-full bg-black border border-[#4db6ac] text-[16px] focus:outline-none focus:ring-1 focus:ring-[#4db6ac]" value={text} onChange={(e)=> setText(e.target.value)} placeholder={`Reply to @${reply.username}`} />
                <div
                  className="inline-flex items-center justify-center w-10 h-10 rounded-full hover:bg-white/10 cursor-pointer" 
                  aria-label="Add image"
                  onClick={() => {
                    console.log('Inline image button clicked - triggering file input');
                    if (inlineFileRef.current) {
                      console.log('Inline file input ref found, clicking...');
                      inlineFileRef.current.click();
                    } else {
                      console.error('Inline file input ref not found');
                    }
                  }}
                >
                  <i className="fa-regular fa-image text-xl" style={{ color: img ? '#7fe7df' : '#4db6ac' }} />
                </div>
                <div
                  className="px-2.5 py-1.5 rounded-full bg-[#4db6ac] text-white border border-[#4db6ac] hover:brightness-110 cursor-pointer inline-flex items-center" 
                  onClick={() => {
                    console.log('Inline send button clicked - submitting reply with text:', text, 'and img:', img);
                    if (!text && !img) return;
                    onInlineReply(reply.id, text, img || undefined);
                    setText('');
                    setImg(null);
                    setShowComposer(false);
                  }} 
                  aria-label="Send reply"
                >
                  <i className="fa-solid fa-paper-plane" />
                </div>
              </div>
              {img && (
                <div className="text-xs text-[#7fe7df] flex items-center gap-1 px-3">
                  <i className="fa-solid fa-image" />
                  <span>{img.name}</span>
                  <button 
                    onClick={() => setImg(null)}
                    className="ml-1 text-red-400 hover:text-red-300"
                  >
                    <i className="fa-solid fa-times" />
                  </button>
                </div>
              )}
            </div>
          ) : null}
          <input
            ref={inlineFileRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              console.log('Inline file selected:', e.target.files);
              setImg(e.target.files?.[0] || null);
            }}
            style={{ display: 'none', position: 'absolute', top: '-9999px', left: '-9999px' }}
          />
        </div>
      </div>
      {reply.children && reply.children.length ? reply.children.map(ch => (
        <ReplyNode key={ch.id} reply={ch} depth={Math.min(depth+1, 3)} onToggle={onToggle} onInlineReply={onInlineReply} />
      )) : null}
    </div>
  )
}