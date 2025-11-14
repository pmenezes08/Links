import { useCallback, useEffect, useRef, useState, memo } from 'react'
import GifPicker from '../components/GifPicker'
import type { GifSelection } from '../components/GifPicker'
import { gifSelectionToFile } from '../utils/gif'
import type React from 'react'
import MentionTextarea from '../components/MentionTextarea'
import { useAudioRecorder } from '../components/useAudioRecorder'
import { useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'
import ZoomableImage from '../components/ZoomableImage'
import { formatSmartTime } from '../utils/time'
import VideoEmbed from '../components/VideoEmbed'
import { extractVideoEmbed, removeVideoUrlFromText } from '../utils/videoEmbed'
import EditableAISummary from '../components/EditableAISummary'

type Reply = { id: number; username: string; content: string; timestamp: string; reactions: Record<string, number>; user_reaction: string|null, parent_reply_id?: number|null, children?: Reply[], profile_picture?: string|null, image_path?: string|null, video_path?: string|null }
type Post = { id: number; username: string; content: string; image_path?: string|null; video_path?: string|null; audio_path?: string|null; audio_summary?: string|null; timestamp: string; reactions: Record<string, number>; user_reaction: string|null; replies: Reply[]; ai_videos?: Array<{video_path: string; generated_by: string; created_at: string; style: string}>; view_count?: number }

// old formatTimestamp removed; using formatSmartTime

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
    nodes.push(<a key={`md-${match.index}`} href={url} target="_blank" rel="noopener noreferrer" className="text-[#4db6ac] underline-offset-2 hover:underline break-words">{label}</a>)
    lastIndex = markdownRe.lastIndex
  }
  const rest = input.slice(lastIndex)
  // Then, linkify plain URLs in the rest
  const urlRe = /(https?:\/\/[^\s]+|www\.[^\s]+)/g
  let urlLast = 0
  let m: RegExpExecArray | null
  while ((m = urlRe.exec(rest))){
    if (m.index > urlLast){
      // Before URLs, also colorize @mentions in the chunk
      nodes.push(...colorizeMentions(preserveNewlines(rest.slice(urlLast, m.index))))
    }
    const urlText = m[0]
    const href = urlText.startsWith('http') ? urlText : `https://${urlText}`
    nodes.push(<a key={`u-${lastIndex + m.index}`} href={href} target="_blank" rel="noopener noreferrer" className="text-[#4db6ac] underline-offset-2 hover:underline break-words">{urlText}</a>)
    urlLast = urlRe.lastIndex
  }
  if (urlLast < rest.length){
    nodes.push(...colorizeMentions(preserveNewlines(rest.slice(urlLast))))
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

function colorizeMentions(nodes: Array<React.ReactNode>): Array<React.ReactNode> {
  // Transform plain-text strings in nodes to add color for @mentions
  const out: Array<React.ReactNode> = []
  const mentionRe = /(^|\s)(@([a-zA-Z0-9_]{1,30}))/g
  nodes.forEach((n, idx) => {
    if (typeof n !== 'string'){ out.push(n); return }
    const segs: Array<React.ReactNode> = []
    let last = 0
    let m: RegExpExecArray | null
    while ((m = mentionRe.exec(n))){
      const start = m.index
      const lead = m[1]
      const full = m[2]
      if (start > last){ segs.push(n.slice(last, start)) }
      if (lead){ segs.push(lead) }
      segs.push(<span key={`men-${idx}-${start}`} className="text-[#4db6ac]">{full}</span>)
      last = start + lead.length + full.length
    }
    if (last < n.length){ segs.push(n.slice(last)) }
    out.push(...segs)
  })
  return out
}

function normalizePath(p?: string | null): string {
  const s = (p || '').trim()
  if (!s) return ''
  if (s.startsWith('http')) return s
  if (s.startsWith('/uploads') || s.startsWith('/static')) return s
  if (s.startsWith('uploads') || s.startsWith('static')) return `/${s}`
  return `/uploads/${s}`
}

export default function PostDetail(){
  const { post_id } = useParams()
  const navigate = useNavigate()
  const [post, setPost] = useState<Post|null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File|null>(null)
  const [uploadFile, setUploadFile] = useState<File|null>(null)
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null)
  const [replyGif, setReplyGif] = useState<GifSelection | null>(null)
  const [gifPickerOpen, setGifPickerOpen] = useState(false)
  const [currentUser, setCurrentUser] = useState<{username: string; profile_picture?: string | null} | null>(null)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [submittingReply, setSubmittingReply] = useState(false)
  const { recording, recordMs, preview: replyPreview, start: startRec, stop: stopRec, clearPreview: clearReplyPreview, level } = useAudioRecorder() as any
  const replyTokenRef = useRef<string>(`${Date.now()}_${Math.random().toString(36).slice(2)}`)
  const [inlineSending, setInlineSending] = useState<Record<number, boolean>>({})
  const fileInputRef = useRef<HTMLInputElement|null>(null)
  const [refreshHint, setRefreshHint] = useState(false)
  const [pullPx, setPullPx] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const viewRecordedRef = useRef(false)
  
  useEffect(() => {
    if (!post_id) return
    if (viewRecordedRef.current) return
    viewRecordedRef.current = true
    let cancelled = false
    async function recordView(){
      try{
        const res = await fetch('/api/post_view', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ post_id: Number(post_id) })
        })
        const j = await res.json().catch(() => null)
        if (!cancelled && j?.success && typeof j.view_count === 'number'){
          setPost(prev => {
            if (!prev) return prev
            if (Number(prev.id) !== Number(post_id)) return prev
            return { ...prev, view_count: j.view_count }
          })
        }
      } catch {
        viewRecordedRef.current = false
      }
    }
    recordView()
    return () => { cancelled = true }
  }, [post_id])

  async function compressImageFile(input: File, maxEdge = 1600, quality = 0.82): Promise<File> {
    try {
      const isImage = typeof input.type === 'string' && input.type.startsWith('image/')
      if (!isImage) return input
      const bmp = ('createImageBitmap' in window)
        ? await (window as any).createImageBitmap(input)
        : await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image()
            const url = URL.createObjectURL(input)
            img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
            img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
            img.src = url
            ;(img as any).decoding = 'async'
          })
      const width = (bmp as any).width
      const height = (bmp as any).height
      const scale = Math.min(maxEdge / width, maxEdge / height, 1)
      const outW = Math.max(1, Math.round(width * scale))
      const outH = Math.max(1, Math.round(height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = outW
      canvas.height = outH
      const ctx = canvas.getContext('2d')
      if (!ctx) return input
      ctx.drawImage(bmp as any, 0, 0, outW, outH)
      const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (!blob) return input
      const outName = input.name.toLowerCase().endsWith('.jpg') || input.name.toLowerCase().endsWith('.jpeg') ? input.name : (input.name.split('.')[0] + '.jpg')
      return new File([blob], outName, { type: 'image/jpeg' })
    } catch {
      return input
    }
  }

  // Generate a lightweight, stable preview URL only when the selected file changes
  useEffect(() => {
    let revokedUrl: string | null = null
    let cancelled = false
    async function buildPreview() {
      if (replyGif) { setFilePreviewUrl(null); setUploadFile(null); return }
      if (!file) { setFilePreviewUrl(null); setUploadFile(null); return }
      if (typeof file.type === 'string' && file.type === 'image/gif') {
        try {
          const url = URL.createObjectURL(file)
          setFilePreviewUrl(url)
          revokedUrl = url
        } catch {}
        if (!cancelled) setUploadFile(file)
        return
      }
      try {
        const isImage = typeof file.type === 'string' && file.type.startsWith('image/')
        // Try off-main-thread decode + resize for very large images
        if (isImage && 'createImageBitmap' in window) {
          const maxEdge = 256
          // Attempt resized bitmap (supported in most modern browsers)
          // @ts-ignore - resize options may not be typed in TS lib yet
          const bmp = await (window as any).createImageBitmap(file, { resizeWidth: maxEdge, resizeHeight: maxEdge, resizeQuality: 'high' })
          // Draw to canvas to produce a small thumbnail blob
          const scale = Math.min(maxEdge / bmp.width, maxEdge / bmp.height, 1)
          const w = Math.max(1, Math.round(bmp.width * scale))
          const h = Math.max(1, Math.round(bmp.height * scale))
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          if (ctx) ctx.drawImage(bmp, 0, 0, w, h)
          await new Promise<void>((resolve) => {
            canvas.toBlob((blob) => {
              if (cancelled) return resolve()
              if (blob) {
                const url = URL.createObjectURL(blob)
                setFilePreviewUrl(url)
                revokedUrl = url
              } else {
                const fallback = URL.createObjectURL(file)
                setFilePreviewUrl(fallback)
                revokedUrl = fallback
              }
              resolve()
            }, 'image/jpeg', 0.8)
          })
          if (!cancelled) {
            const compressed = await compressImageFile(file, 1600, 0.82)
            if (!cancelled) setUploadFile(compressed)
          }
        } else {
          // Fallback to direct object URL once
          const url = URL.createObjectURL(file)
          setFilePreviewUrl(url)
          revokedUrl = url
          const compressed = await compressImageFile(file, 1600, 0.82)
          if (!cancelled) setUploadFile(compressed)
        }
      } catch {
        try {
          const url = URL.createObjectURL(file)
          setFilePreviewUrl(url)
          revokedUrl = url
        } catch {}
      }
    }
    buildPreview()
    return () => {
      cancelled = true
      if (revokedUrl) {
        try { URL.revokeObjectURL(revokedUrl) } catch {}
      }
    }
  }, [file, replyGif])

  const refreshPost = useCallback(async () => {
    try{
      // Try group first
      let r = await fetch(`/api/group_post?post_id=${post_id}`, { credentials: 'include' })
      let j = await r.json().catch(()=>null)
      if (!j?.success){
        r = await fetch(`/get_post?post_id=${post_id}`, { credentials: 'include' })
        j = await r.json().catch(()=>null)
      }
      if (j?.success) setPost(j.post)
    }catch{}
  }, [post_id])

  useEffect(() => {
    // Pull-to-refresh on overscroll at top
    let startY = 0
    const threshold = 64
    const reloading = { current: false }
    function onTS(ev: TouchEvent){
      try{ startY = ev.touches?.[0]?.clientY || 0 }catch{ startY = 0 }
      setPullPx(0)
      setRefreshHint(false)
    }
    function onTM(ev: TouchEvent){
      try{
        const y = window.scrollY || 0
        const curY = ev.touches?.[0]?.clientY || 0
        const dy = curY - startY
        if (y <= 0 && dy > 0){
          const px = Math.min(100, Math.max(0, dy * 0.5))
          setPullPx(px)
          setRefreshHint(px > 8)
          if (px >= threshold && !reloading.current){
            reloading.current = true
            setRefreshing(true)
            refreshPost().finally(()=>{
              setRefreshing(false)
              setPullPx(0)
              setRefreshHint(false)
              reloading.current = false
            })
          }
        } else {
          setPullPx(0)
          setRefreshHint(false)
        }
      }catch{}
    }
    function onTE(){ setPullPx(0); setRefreshHint(false) }
    window.addEventListener('touchstart', onTS, { passive: true })
    window.addEventListener('touchmove', onTM, { passive: true })
    window.addEventListener('touchend', onTE, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTS as any)
      window.removeEventListener('touchmove', onTM as any)
      window.removeEventListener('touchend', onTE as any)
    }
  }, [refreshPost])

  // (inline) top refresh hint UI rendered conditionally in JSX below

  useEffect(() => {
    let mounted = true
    async function load(){
      try{
        let r = await fetch(`/api/group_post?post_id=${post_id}`, { credentials: 'include' })
        let j = await r.json().catch(()=>null)
        if (!j?.success){
          r = await fetch(`/get_post?post_id=${post_id}`, { credentials: 'include' })
          j = await r.json().catch(()=>null)
        }
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

  // Load current username for ownership checks (lightweight usage of existing endpoint)
  useEffect(() => {
    let mounted = true
    async function loadUser(){
      try{
        const r = await fetch('/api/home_timeline', { credentials:'include' })
        const j = await r.json().catch(()=>null)
        if (!mounted) return
        if (j?.success && j.username) {
          setCurrentUser({
            username: j.username,
            profile_picture: j.profile_picture || null
          })
        }
      }catch{}
    }
    loadUser()
    return () => { mounted = false }
  }, [])

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
    if (!post || (!content && !file && !replyPreview?.blob && !replyGif)) return
    if (submittingReply) return
    
    setSubmittingReply(true)
    const fd = new FormData()
    fd.append('post_id', String(post.id))
    fd.append('content', content)
    if (parentReplyId) fd.append('parent_reply_id', String(parentReplyId))
    try {
      let imageFile: File | null = null
      if (replyGif){
        imageFile = await gifSelectionToFile(replyGif, 'post-reply')
      } else if (uploadFile){
        imageFile = uploadFile
      } else if (file){
        imageFile = file
      }
      if (imageFile) fd.append('image', imageFile)
    } catch (err){
      console.error('Failed to prepare GIF attachment', err)
      setSubmittingReply(false)
      alert('Unable to attach GIF. Please try again.')
      return
    }
    if (replyPreview?.blob) fd.append('audio', replyPreview.blob, (replyPreview.blob.type.includes('mp4') ? 'audio.mp4' : 'audio.webm'))
    fd.append('dedupe_token', replyTokenRef.current)
    const r = await fetch('/post_reply', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    setSubmittingReply(false)
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
      setContent(''); setFile(null); setUploadFile(null); setReplyGif(null); setFilePreviewUrl(null); if (fileInputRef.current) fileInputRef.current.value = ''
      replyTokenRef.current = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    }
  }

  async function submitInlineReply(parentId: number, text: string, file?: File){
    if (!post || (!text && !file)) return
    if (inlineSending[parentId]) return
    setInlineSending(s => ({ ...s, [parentId]: true }))
    const fd = new FormData()
    fd.append('post_id', String(post.id))
    fd.append('content', text || '')
    fd.append('parent_reply_id', String(parentId))
    if (file) {
      // Detect whether the file is an audio blob or an image; append to the correct form field
      if (typeof (file as any).type === 'string' && (file as any).type.startsWith('audio/')) {
        fd.append('audio', file)
      } else if (typeof (file as any).type === 'string' && (file as any).type.startsWith('image/')) {
        fd.append('image', file)
      } else {
        fd.append('image', file)
      }
    }
    fd.append('dedupe_token', `${Date.now()}_${Math.random().toString(36).slice(2)}`)
    const r = await fetch('/post_reply', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    setInlineSending(s => ({ ...s, [parentId]: false }))
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

  async function deleteReply(replyId: number){
    if (!post) return
    const ok = window.confirm('Delete this reply?')
    if (!ok) return
    try{
      const fd = new FormData()
      fd.append('reply_id', String(replyId))
      const r = await fetch('/delete_reply', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (!j?.success) return
      setPost(p => {
        if (!p) return p
        function removeById(list: Reply[]): Reply[] {
          const out: Reply[] = []
          for (const item of list){
            if (item.id === replyId) continue
            const children = item.children ? removeById(item.children) : item.children
            out.push({ ...item, children })
          }
          return out
        }
        return { ...p, replies: removeById(p.replies) }
      })
    }catch{}
  }


  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading</div>
  if (error || !post) return <div className="p-4 text-red-400">{error||'Error'}</div>

  return (
    <div className="min-h-screen bg-black text-white pb-24">
      {(refreshHint || refreshing) ? (
        <div className="fixed top-[72px] left-0 right-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="px-2 py-1 text-xs rounded-full bg-white/10 border border-white/15 text-white/80 flex items-center gap-2">
            <i className="fa-solid fa-rotate fa-spin" />
          </div>
        </div>
      ) : null}
      <div className="max-w-2xl mx-auto px-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 14rem)', paddingTop: `calc(3.5rem + ${pullPx}px)` }}>
        <div className="mb-2">
          <button className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-sm hover:bg-white/10" onClick={()=> navigate(-1)} aria-label="Back">
            <i className="fa-solid fa-arrow-left mr-1" /> Back
          </button>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black shadow-sm shadow-black/20">
          <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
            <Avatar username={post.username} url={(post as any).profile_picture || undefined} size={32} linkToProfile />
            <div className="font-medium">{post.username}</div>
            <div className="text-xs text-[#9fb0b5] ml-auto">{formatSmartTime((post as any).display_timestamp || post.timestamp)}</div>
          </div>
          <div className="py-2 space-y-2">
            {(() => {
              const videoEmbed = extractVideoEmbed(post.content)
              const displayContent = videoEmbed ? removeVideoUrlFromText(post.content, videoEmbed) : post.content
              return (
                <>
                  {displayContent && <div className="px-3 whitespace-pre-wrap text-[14px] break-words">{renderRichText(displayContent)}</div>}
                  {videoEmbed && <VideoEmbed embed={videoEmbed} />}
                </>
              )
            })()}
          {post.image_path ? (
            <div className="px-0">
              <ImageLoader
                src={normalizePath(post.image_path as string)}
                alt="Post image"
                className="block mx-auto max-w-full max-h-[520px] rounded border border-white/10 cursor-zoom-in"
                onClick={()=> setPreviewSrc(normalizePath(post.image_path as string))}
              />
            </div>
          ) : post.video_path ? (
            <div className="px-3">
              <video
                className="w-full max-h-[420px] rounded border border-white/10 bg-black"
                src={normalizePath(post.video_path)}
                controls
                playsInline
              />
            </div>
          ) : null}
          {post.audio_path ? (
            <div className="px-3 space-y-2">
              {post.audio_summary && (
                <EditableAISummary
                  postId={post.id}
                  initialSummary={post.audio_summary}
                  isOwner={post.username === currentUser?.username}
                  onSummaryUpdate={(newSummary) => {
                    setPost(prev => prev ? {...prev, audio_summary: newSummary} as any : null);
                  }}
                />
              )}
              <audio controls className="w-full" playsInline webkit-playsinline="true" src={(() => {
                const path = normalizePath(post.audio_path as string);
                const separator = path.includes('?') ? '&' : '?';
                return `${path}${separator}_cb=${Date.now()}`;
              })()} />
            </div>
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
            <ReplyNodeMemo
              key={r.id}
              reply={r}
              currentUser={currentUser?.username || null}
              onToggle={(id, reaction)=> toggleReplyReaction(id, reaction)}
              onInlineReply={(id, text, file)=> submitInlineReply(id, text, file)}
              onDelete={(id)=> deleteReply(id)}
              onPreviewImage={(src)=> setPreviewSrc(src)}
              inlineSendingFlag={!!inlineSending[r.id]}
              communityId={(post as any)?.community_id}
              postId={post?.id}
            />
          ))}
        </div>
        {/* Spacer to prevent fixed composer overlap with first replies */}
        <div style={{ height: 'calc(env(safe-area-inset-bottom, 0px) + 12rem)' }} />
      </div>
      {/* Image preview modal */}
          {previewSrc ? (
        <div className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-sm flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && setPreviewSrc(null)}>
          <button className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white flex items-center justify-center" onClick={()=> setPreviewSrc(null)} aria-label="Close preview">
            <i className="fa-solid fa-xmark" />
          </button>
          <div className="w-[94vw] h-[86vh] max-w-4xl">
            <ZoomableImage src={previewSrc} alt="preview" className="w-full h-full" onRequestClose={()=> setPreviewSrc(null)} />
          </div>
        </div>
      ) : null}

      {/* Fixed-bottom reply composer */}
      <div className="fixed left-0 right-0 bottom-0 z-[100] bg-black/85 border-t border-white/10 backdrop-blur pointer-events-auto">
        <div className="px-3 py-2 flex flex-col gap-1.5">
          <MentionTextarea
            value={content}
            onChange={setContent}
            communityId={(post as any)?.community_id}
            postId={post?.id}
            placeholder="Write a reply?"
            className="w-full resize-none max-h-36 min-h-[30px] px-3 py-1.5 rounded-2xl bg-black border border-[#4db6ac] text-[16px] focus:outline-none focus:ring-1 focus:ring-[#4db6ac]"
            rows={3}
            perfDegraded={!!uploadFile}
          />
          <div className="flex items-center justify-end gap-2 flex-wrap">
            {file && (
              <div className="flex items-center gap-2 mr-auto">
                <div className="w-16 h-16 rounded-md overflow-hidden border border-white/10">
                  {filePreviewUrl ? (
                    <img src={filePreviewUrl} alt="preview" className="w-full h-full object-cover" decoding="async" width={64} height={64} draggable={false} />
                  ) : null}
                </div>
                <div className="text-xs text-[#7fe7df] flex items-center gap-1">
                  <i className="fa-solid fa-image" />
                  <span className="max-w-[160px] truncate">{file.name}</span>
                  <button 
                    onClick={() => { setFile(null); setUploadFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                    className="ml-1 text-red-400 hover:text-red-300"
                    aria-label="Remove file"
                  >
                    <i className="fa-solid fa-times" />
                  </button>
                </div>
              </div>
            )}
            {replyGif && (
              <div className="flex items-center gap-2 mr-auto">
                <div className="w-16 h-16 rounded-md overflow-hidden border border-white/10">
                  <img src={replyGif.previewUrl} alt="Selected GIF" className="w-full h-full object-cover" loading="lazy" />
                </div>
                <div className="text-xs text-[#7fe7df] flex items-center gap-1">
                  <i className="fa-solid fa-images" />
                  <span>GIF</span>
                  <button
                    onClick={() => { setReplyGif(null) }}
                    className="ml-1 text-red-400 hover:text-red-300"
                    aria-label="Remove GIF"
                  >
                    <i className="fa-solid fa-times" />
                  </button>
                </div>
              </div>
            )}
            {replyPreview && (
              <div className="flex items-center gap-2 mr-auto flex-1 min-w-0">
                <audio controls className="w-full" playsInline webkit-playsinline="true" src={replyPreview.url} />
                <button 
                  onClick={() => { clearReplyPreview(); }}
                  className="ml-1 text-[#9fb0b5] hover:text-white"
                  aria-label="Remove audio"
                >
                  <i className="fa-regular fa-trash-can" />
                </button>
              </div>
            )}
            <button type="button" className="w-10 h-10 rounded-full hover:bg-white/10 grid place-items-center" aria-label="Add image" onClick={()=> fileInputRef.current?.click()}>
              <i className="fa-regular fa-image text-xl" style={{ color: file ? '#7fe7df' : '#4db6ac' }} />
            </button>
            <button
              type="button"
              className="w-10 h-10 rounded-full grid place-items-center text-[#4db6ac] hover:bg-white/10"
              aria-label="Add GIF"
              onClick={()=> { setGifPickerOpen(true) }}
            >
              <i className="fa-solid fa-images text-lg" style={{ color: replyGif ? '#7fe7df' : '#4db6ac' }} />
            </button>
            <button
              type="button"
              className={`w-10 h-10 rounded-full grid place-items-center text-[#4db6ac] hover:bg-white/10 ${recording ? 'brightness-125' : ''}`}
              aria-label={recording ? "Stop recording" : "Record audio"}
              onClick={()=> recording ? stopRec() : startRec()}
            >
              <i className={`fa-solid ${recording ? 'fa-stop' : 'fa-microphone'} text-xl`} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e)=> {
                const next = (e.target as HTMLInputElement).files?.[0] || null
                setFile(next)
                setUploadFile(null)
                setReplyGif(null)
              }}
              className="hidden"
            />
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
            {/* Recording visualizer and timer */}
            {recording && (
              <div className="flex items-center gap-2 mr-auto flex-1 min-w-0">
                <div className="text-xs text-[#9fb0b5] whitespace-nowrap">{Math.min(60, Math.round((recordMs||0)/1000))}s</div>
                <div className="h-2 w-full bg-white/5 rounded overflow-hidden">
                  <div className="h-full bg-[#4db6ac] transition-all" style={{ width: `${Math.min(100, ((recordMs||0)/600) )}%` }} />
                </div>
                <div className="h-6 w-20 bg-white/5 rounded hidden xs:flex items-center">
                  <div className="h-2 bg-[#7fe7df] rounded transition-all" style={{ width: `${Math.max(6, Math.min(96, level*100))}%`, marginLeft: '2%' }} />
                </div>
              </div>
            )}
            <button
              className="px-2.5 py-1.5 rounded-full bg-[#4db6ac] text-white border border-[#4db6ac] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={()=> submitReply()}
              aria-label="Send reply"
              disabled={(!content && !file && !replyPreview && !replyGif) || submittingReply}
            >
              {submittingReply ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-paper-plane" />}
            </button>
          </div>
        </div>
      </div>
      <GifPicker
        isOpen={gifPickerOpen}
        onClose={()=> setGifPickerOpen(false)}
        onSelect={(gif) => {
          setReplyGif(gif)
          setGifPickerOpen(false)
          setFile(null)
          setUploadFile(null)
          setFilePreviewUrl(null)
          if (fileInputRef.current) fileInputRef.current.value = ''
        }}
      />
      
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

const ReplyNodeMemo = memo(ReplyNode, (prev, next) => {
  if (prev.reply !== next.reply) return false
  if (prev.inlineSendingFlag !== next.inlineSendingFlag) return false
  if (prev.currentUser !== next.currentUser) return false
  if (prev.depth !== next.depth) return false
  return true
})

function ReplyNode({ reply, depth=0, currentUser: currentUserName, onToggle, onInlineReply, onDelete, onPreviewImage, inlineSendingFlag, communityId, postId }:{ reply: Reply, depth?: number, currentUser?: string|null, onToggle: (id:number, reaction:string)=>void, onInlineReply: (id:number, text:string, file?: File)=>void, onDelete: (id:number)=>void, onPreviewImage: (src:string)=>void, inlineSendingFlag: boolean, communityId?: number | string, postId?: number }){
  const currentUser = currentUserName
  const [showComposer, setShowComposer] = useState(false)
  const [text, setText] = useState('')
  const [img, setImg] = useState<File|null>(null)
  const inlineFileRef = useRef<HTMLInputElement|null>(null)
  const { recording: rec, preview: inlinePreview, start: startInlineRec, stop: stopInlineRec, clearPreview: clearInlinePreview } = useAudioRecorder()
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(reply.content)
  const [showGifPicker, setShowGifPicker] = useState(false)
  const [inlineGif, setInlineGif] = useState<GifSelection | null>(null)
  const [gifFile, setGifFile] = useState<File | null>(null)
  const hasChildren = reply.children && reply.children.length > 0
  useEffect(() => {
    if (!showComposer){
      setShowGifPicker(false)
      setInlineGif(null)
      setGifFile(null)
      setImg(null)
      if (inlineFileRef.current) inlineFileRef.current.value = ''
      clearInlinePreview()
    }
  }, [showComposer, clearInlinePreview])
  return (
    <div className={`relative py-2 ${depth === 0 ? 'border-b border-white/10' : ''}`}>
      <div className="relative flex items-start gap-2 px-3">
        <div className="relative w-10 flex-shrink-0 self-stretch" style={{ zIndex: 1 }}>
          <Avatar username={reply.username} url={reply.profile_picture || undefined} size={28} linkToProfile />
          {/* Vertical connector line from avatar to children */}
          {hasChildren && (
            <div 
              className="absolute left-[13px] top-[28px] bottom-0 w-[2px] bg-gradient-to-b from-[#4db6ac]/70 to-[#4db6ac]/20" 
              style={{ height: 'calc(100% - 28px)' }}
            />
          )}
        </div>
        <div className="flex-1 min-w-0 pr-2">
          <div className="flex items-center gap-2">
            <div className="font-medium">{reply.username}</div>
            <div className="text-[11px] text-[#9fb0b5] ml-auto">{formatSmartTime(reply.timestamp)}</div>
            {(currentUser && (currentUser === reply.username || currentUser === 'admin')) ? (
              <>
                <button
                  className="ml-2 px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]"
                  title="Edit reply"
                  onClick={()=> setIsEditing(v=>!v)}
                >
                  <i className="fa-regular fa-pen-to-square" />
                </button>
                <button
                  className="ml-1 px-2 py-1 rounded-full text-[#6c757d] hover:text-red-400"
                  title="Delete reply"
                  onClick={()=> onDelete(reply.id)}
                >
                  <i className="fa-regular fa-trash-can" />
                </button>
              </>
            ) : null}
          </div>
          {!isEditing ? (
            <div className="text-[#dfe6e9] whitespace-pre-wrap mt-0.5 break-words">{renderRichText(reply.content)}</div>
          ) : (
            <div className="mt-1">
              <textarea
                className="w-full resize-none max-h-60 min-h-[100px] px-3 py-2 rounded-md bg-black border border-[#4db6ac] text-[14px] focus:outline-none focus:ring-1 focus:ring-[#4db6ac]"
                value={editText}
                onChange={(e)=> setEditText(e.target.value)}
              />
              <div className="mt-1 flex gap-2">
                <button className="px-3 py-1.5 rounded-md bg-[#4db6ac] text-black" onClick={async ()=>{
                  const fd = new FormData()
                  fd.append('reply_id', String(reply.id))
                  fd.append('content', editText)
                  const r = await fetch('/edit_reply', { method:'POST', credentials:'include', body: fd })
                  const j = await r.json().catch(()=>null)
                  if (j?.success){
                    (reply as any).content = editText
                    setIsEditing(false)
                  } else {
                    alert(j?.error || 'Failed to edit')
                  }
                }}>Save</button>
                <button className="px-3 py-1.5 rounded-md border border-white/10" onClick={()=> { setIsEditing(false); setEditText(reply.content) }}>Cancel</button>
              </div>
            </div>
          )}
          {reply.image_path ? (
            <div className="mt-2 flex justify-center">
              <div onClick={()=> onPreviewImage(normalizePath(reply.image_path as string))}>
                <ImageLoader
                  src={normalizePath(reply.image_path as string)}
                  alt="Reply image"
                  className="block mx-auto max-w-full max-h-[300px] rounded border border-white/10 cursor-zoom-in"
                />
              </div>
            </div>
          ) : null}
          {reply.video_path ? (
            <div className="mt-2">
              <video
                className="w-full max-h-[320px] rounded border border-white/10 bg-black"
                src={normalizePath(reply.video_path)}
                controls
                playsInline
              />
            </div>
          ) : null}
          {(reply as any)?.audio_path ? (
            <div className="mt-2">
              <audio controls className="w-full" playsInline webkit-playsinline="true" src={(() => {
                const path = normalizePath((reply as any).audio_path as string);
                const separator = path.includes('?') ? '&' : '?';
                return `${path}${separator}_cb=${Date.now()}`;
              })()} />
            </div>
          ) : null}
          <div className="mt-1 flex items-center gap-2 text-[11px]">
            <Reaction icon="fa-regular fa-heart" count={reply.reactions?.['heart']||0} active={reply.user_reaction==='heart'} onClick={()=> onToggle(reply.id, 'heart')} />
            <Reaction icon="fa-regular fa-thumbs-up" count={reply.reactions?.['thumbs-up']||0} active={reply.user_reaction==='thumbs-up'} onClick={()=> onToggle(reply.id, 'thumbs-up')} />
            <Reaction icon="fa-regular fa-thumbs-down" count={reply.reactions?.['thumbs-down']||0} active={reply.user_reaction==='thumbs-down'} onClick={()=> onToggle(reply.id, 'thumbs-down')} />
            <div className="ml-auto flex items-center gap-1">
              <button className="px-2 py-1 rounded-full text-[#9fb0b5] hover:text-[#4db6ac]" onClick={()=> setShowComposer(v=>!v)}>Reply</button>
            </div>
          </div>
          {showComposer ? (
            <div className="mt-2 space-y-2">
              <div className="flex items-start gap-2">
                <MentionTextarea
                  value={text}
                  onChange={setText}
                  communityId={communityId}
                  postId={postId}
                  placeholder={`Reply to @${reply.username}`}
                  className="flex-1 px-3 py-1.5 rounded-2xl bg-black border border-[#4db6ac] text-[16px] focus:outline-none focus:ring-1 focus:ring-[#4db6ac] min-h-[36px]"
                  rows={2}
                />
                <button type="button" className="w-10 h-10 rounded-full hover:bg:white/10 grid place-items-center" aria-label="Add image" onClick={()=> inlineFileRef.current?.click()}>
                  <i className="fa-regular fa-image text-xl" style={{ color: img ? '#7fe7df' : '#4db6ac' }} />
                </button>
                <input
                  ref={inlineFileRef}
                  type="file"
                  accept="image/*"
                  onChange={(e)=> {
                    const next = (e.target as HTMLInputElement).files?.[0] || null
                    setImg(next)
                    setInlineGif(null)
                    setGifFile(null)
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  className="w-10 h-10 rounded-full grid place-items-center text-[#4db6ac] hover:bg-white/10"
                  aria-label="Add GIF"
                  onClick={()=> { setShowGifPicker(true) }}
                >
                  <i className="fa-solid fa-images text-lg" style={{ color: inlineGif ? '#7fe7df' : '#4db6ac' }} />
                </button>
                {/* Inline mic button using shared hook via parent handlers: pass audio as file */}
                {/* We'll allow only image OR audio at a time in inline composer */}
                <button
                  type="button"
                  className={`w-10 h-10 rounded-full grid place-items-center text-[#4db6ac] hover:bg-white/10 ${rec ? 'brightness-125' : ''}`}
                  aria-label={rec ? "Stop recording" : "Record audio"}
                  onClick={()=> rec ? stopInlineRec() : startInlineRec()}
                >
                  <i className={`fa-solid ${rec ? 'fa-stop' : 'fa-microphone'} text-xl`} />
                </button>
                <button className="px-2.5 py-1.5 rounded-full bg-[#4db6ac] text-white border border-[#4db6ac] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed" onClick={()=> {
                  if (!text && !img && !inlinePreview && !gifFile) return
                  const attachment = inlinePreview
                    ? new File([inlinePreview.blob], inlinePreview.blob.type.includes('mp4') ? 'audio.mp4' : 'audio.webm', { type: inlinePreview.blob.type })
                    : (img || gifFile || undefined)
                  onInlineReply(reply.id, text, attachment as any)
                  setText('')
                  setImg(null)
                  setInlineGif(null)
                  setGifFile(null)
                  if (inlineFileRef.current) inlineFileRef.current.value=''
                  clearInlinePreview()
                  setShowComposer(false)
                }} aria-label="Send reply" disabled={!text && !img && !inlinePreview && !gifFile || !!inlineSendingFlag}>
                  {inlineSendingFlag ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-paper-plane" />}
                </button>
              {inlinePreview && (
                <div className="text-xs text-[#7fe7df] flex items-center gap-1 px-3">
                  <i className="fa-solid fa-microphone" />
                  <span className="max-w-[160px] truncate">audio</span>
                  <button 
                    onClick={() => { clearInlinePreview() }}
                    className="ml-1 text-red-400 hover:text-red-300"
                    aria-label="Remove audio"
                  >
                    <i className="fa-solid fa-times" />
                  </button>
                </div>
              )}
              </div>
              {img && (
                <div className="text-xs text-[#7fe7df] flex items-center gap-1 px-3">
                  <i className="fa-solid fa-image" />
                  <span className="max-w-[160px] truncate">{img.name}</span>
                  <button 
                    onClick={() => { setImg(null); setInlineGif(null); setGifFile(null); if (inlineFileRef.current) inlineFileRef.current.value = '' }}
                    className="ml-1 text-red-400 hover:text-red-300"
                    aria-label="Remove file"
                  >
                    <i className="fa-solid fa-times" />
                  </button>
                </div>
              )}
              {inlineGif && (
                <div className="text-xs text-[#7fe7df] flex items-center gap-2 px-3">
                  <div className="w-12 h-12 rounded border border-white/10 overflow-hidden">
                    <img src={inlineGif.previewUrl} alt="Selected GIF" className="w-full h-full object-cover" loading="lazy" />
                  </div>
                  <span>GIF</span>
                  <button
                    onClick={() => { setInlineGif(null); setGifFile(null) }}
                    className="ml-1 text-red-400 hover:text-red-300"
                    aria-label="Remove GIF"
                  >
                    <i className="fa-solid fa-times" />
                  </button>
                </div>
              )}
              <GifPicker
                isOpen={showGifPicker}
                onClose={()=> setShowGifPicker(false)}
                onSelect={async (gif) => {
                  try {
                    const file = await gifSelectionToFile(gif, 'reply-gif')
                    setInlineGif(gif)
                    setGifFile(file)
                    setImg(null)
                    if (inlineFileRef.current) inlineFileRef.current.value = ''
                  } catch (err) {
                    console.error('Failed to prepare GIF for reply', err)
                    alert('Unable to attach GIF. Please try again.')
                  } finally {
                    setShowGifPicker(false)
                  }
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
      {reply.children && reply.children.length ? (
        <div className="relative">
          {reply.children.map((ch) => (
            <ReplyNodeMemo
              key={ch.id}
              reply={ch}
              depth={Math.min(depth+1, 3)}
              currentUser={currentUser}
              onToggle={onToggle}
              onInlineReply={onInlineReply}
              onDelete={onDelete}
              onPreviewImage={onPreviewImage}
              inlineSendingFlag={false}
              communityId={communityId}
              postId={postId}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}