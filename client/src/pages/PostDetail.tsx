import { useCallback, useEffect, useLayoutEffect, useRef, useState, memo } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
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
  const [isEditingPost, setIsEditingPost] = useState(false)
  const [editPostText, setEditPostText] = useState('')
  const [editMediaFile, setEditMediaFile] = useState<File | null>(null)
  const [editMediaPreview, setEditMediaPreview] = useState<string | null>(null)
  const [removeMedia, setRemoveMedia] = useState(false)
  const editMediaInputRef = useRef<HTMLInputElement | null>(null)
  const [activeInlineReplyFor, setActiveInlineReplyFor] = useState<number | null>(null)
  const viewRecordedRef = useRef(false)
  const safeBottom = 'env(safe-area-inset-bottom, 0px)'
  const defaultComposerPadding = 200
  const [composerHeight, setComposerHeight] = useState(defaultComposerPadding)
  const composerRef = useRef<HTMLDivElement | null>(null)
  const composerCardRef = useRef<HTMLDivElement | null>(null)
  const keyboardOffsetRef = useRef(0)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [safeBottomPx, setSafeBottomPx] = useState(0)
  const viewportBaseRef = useRef<number | null>(null)
  const [viewportLift, setViewportLift] = useState(0)
  const contentRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return
    const node = composerCardRef.current
    if (!node) return

    const updateHeight = () => {
      const height = node.getBoundingClientRect().height
      if (!height) return
      setComposerHeight(prev => (Math.abs(prev - height) < 1 ? prev : height))
    }

    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(node)

    return () => observer.disconnect()
  }, [])

  // Measure safe-area-inset-bottom
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const probe = document.createElement('div')
    probe.style.position = 'fixed'
    probe.style.bottom = '0'
    probe.style.left = '0'
    probe.style.width = '0'
    probe.style.height = 'env(safe-area-inset-bottom, 0px)'
    probe.style.pointerEvents = 'none'
    probe.style.opacity = '0'
    probe.style.zIndex = '-1'
    document.body.appendChild(probe)

    const updateSafeBottom = () => {
      const rect = probe.getBoundingClientRect()
      const next = rect.height || 0
      setSafeBottomPx(prev => (Math.abs(prev - next) < 1 ? prev : next))
    }

    updateSafeBottom()
    window.addEventListener('resize', updateSafeBottom)

    return () => {
      window.removeEventListener('resize', updateSafeBottom)
      probe.remove()
    }
  }, [])

  // Visual viewport tracking for web
  useEffect(() => {
    if (typeof window === 'undefined') return
    const viewport = window.visualViewport
    if (!viewport) return

    let rafId: number | null = null

    const updateOffset = () => {
      const currentHeight = viewport.height
      if (
        viewportBaseRef.current === null ||
        currentHeight > (viewportBaseRef.current ?? currentHeight) - 4
      ) {
        viewportBaseRef.current = currentHeight
      }
      const baseHeight = viewportBaseRef.current ?? currentHeight
      const nextOffset = Math.max(0, baseHeight - currentHeight - viewport.offsetTop)
      setViewportLift(prev => (Math.abs(prev - nextOffset) < 1 ? prev : nextOffset))
      if (Math.abs(keyboardOffsetRef.current - nextOffset) < 1) return
      keyboardOffsetRef.current = nextOffset
      setKeyboardOffset(nextOffset)
    }

    const handleChange = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updateOffset)
    }

    viewport.addEventListener('resize', handleChange)
    viewport.addEventListener('scroll', handleChange)
    updateOffset()

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', handleChange)
      viewport.removeEventListener('scroll', handleChange)
    }
  }, [])

  // Native keyboard events for Capacitor
  useEffect(() => {
    if (Capacitor.getPlatform() === 'web') return
    let showSub: PluginListenerHandle | undefined
    let hideSub: PluginListenerHandle | undefined

    const handleShow = (info: KeyboardInfo) => {
      const height = info?.keyboardHeight ?? 0
      if (Math.abs(keyboardOffsetRef.current - height) < 2) return
      keyboardOffsetRef.current = height
      setKeyboardOffset(height)
    }

    const handleHide = () => {
      if (keyboardOffsetRef.current === 0) return
      keyboardOffsetRef.current = 0
      setKeyboardOffset(0)
    }

    Keyboard.addListener('keyboardWillShow', handleShow).then(handle => {
      showSub = handle
    })
    Keyboard.addListener('keyboardWillHide', handleHide).then(handle => {
      hideSub = handle
    })

    return () => {
      showSub?.remove()
      hideSub?.remove()
    }
  }, [])

  // Scroll content to bottom when keyboard opens to show latest replies
  useEffect(() => {
    let lastHeight = window.innerHeight
    
    const handleResize = () => {
      const newHeight = window.innerHeight
      // Keyboard state changed
      if (newHeight !== lastHeight) {
        const keyboardOpened = newHeight < lastHeight
        lastHeight = newHeight
        // Scroll to bottom when keyboard opens
        if (contentRef.current && keyboardOpened) {
          setTimeout(() => {
            contentRef.current?.scrollTo({ top: contentRef.current.scrollHeight, behavior: 'smooth' })
          }, 100)
        }
      }
    }
    
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  
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

  function startEditPost() {
    if (!post) return
    setEditPostText(post.content)
    setEditMediaFile(null)
    setEditMediaPreview(null)
    setRemoveMedia(false)
    setIsEditingPost(true)
  }

  function cancelEditPost() {
    setIsEditingPost(false)
    setEditPostText('')
    setEditMediaFile(null)
    setEditMediaPreview(null)
    setRemoveMedia(false)
  }

  function handleEditMediaChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setEditMediaFile(file)
    setRemoveMedia(false)
    const url = URL.createObjectURL(file)
    setEditMediaPreview(url)
  }

  function clearEditMedia() {
    if (editMediaPreview) {
      try { URL.revokeObjectURL(editMediaPreview) } catch {}
    }
    setEditMediaFile(null)
    setEditMediaPreview(null)
    if (editMediaInputRef.current) editMediaInputRef.current.value = ''
  }

  async function saveEditPost() {
    if (!post) return
    const fd = new FormData()
    fd.append('post_id', String(post.id))
    fd.append('content', editPostText)
    if (editMediaFile) {
      fd.append('media', editMediaFile)
    } else if (removeMedia) {
      fd.append('remove_media', 'true')
    }
    try {
      const r = await fetch('/edit_post', { method: 'POST', credentials: 'include', body: fd })
      const j = await r.json().catch(() => null)
      if (j?.success) {
        // Update local state
        setPost(p => {
          if (!p) return p
          const updated = { ...p, content: editPostText }
          if (j.image_path) {
            (updated as any).image_path = j.image_path
            ;(updated as any).video_path = null
          } else if (j.video_path) {
            (updated as any).video_path = j.video_path
            ;(updated as any).image_path = null
          } else if (removeMedia) {
            (updated as any).image_path = null
            ;(updated as any).video_path = null
          }
          return updated
        })
        clearEditMedia()
        setRemoveMedia(false)
        setIsEditingPost(false)
      } else {
        alert(j?.error || 'Failed to update post')
      }
    } catch {
      alert('Failed to update post')
    }
  }

  async function deletePost() {
    if (!post) return
    const ok = window.confirm('Delete this post?')
    if (!ok) return
    try {
      const fd = new FormData()
      fd.append('post_id', String(post.id))
      const r = await fetch('/delete_post', { method: 'POST', credentials: 'include', body: fd })
      const j = await r.json().catch(() => null)
      if (j?.success) {
        navigate(-1)
      } else {
        alert(j?.error || 'Failed to delete post')
      }
    } catch {
      alert('Failed to delete post')
    }
  }


  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading</div>
  if (error || !post) return <div className="p-4 text-red-400">{error||'Error'}</div>

  const effectiveComposerHeight = Math.max(composerHeight, defaultComposerPadding)
  const liftSource = Math.max(keyboardOffset, viewportLift)
  const keyboardLift = Math.max(0, liftSource - safeBottomPx)
  const showKeyboard = liftSource > 2
  // Padding to ensure content doesn't hide behind composer
  const contentPaddingBottom = showKeyboard
    ? `${effectiveComposerHeight + keyboardLift + 16}px`
    : `calc(${safeBottom} + ${effectiveComposerHeight + 32}px)`

  return (
    <div
      className="glass-page flex flex-col overflow-hidden text-white"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
      {(refreshHint || refreshing) ? (
        <div className="fixed top-[72px] left-0 right-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="px-2 py-1 text-xs rounded-full bg-white/10 border border-white/15 text-white/80 flex items-center gap-2">
            <i className="fa-solid fa-rotate fa-spin" />
          </div>
        </div>
      ) : null}
      {/* Scrollable content area - shrinks when keyboard appears */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto overflow-x-hidden min-h-0"
        style={{
          // Add a touch more breathing room so the back button doesn't hug the header
          paddingTop: `calc(env(safe-area-inset-top, 0px) + 56px + ${pullPx}px)`,
          WebkitOverflowScrolling: 'touch' as any,
          overscrollBehaviorY: 'auto' as any,
        }}
      >
        <div className="mx-auto max-w-2xl px-3" style={{ paddingBottom: contentPaddingBottom }}>
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
            {(currentUser?.username === post.username || currentUser?.username === 'admin') && (
              <div className="flex items-center gap-1">
                <button
                  className="px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]"
                  title="Edit"
                  onClick={() => startEditPost()}
                >
                  <i className="fa-regular fa-pen-to-square" />
                </button>
                <button
                  className="px-2 py-1 rounded-full text-[#6c757d] hover:text-red-400"
                  title="Delete"
                  onClick={() => deletePost()}
                >
                  <i className="fa-regular fa-trash-can" />
                </button>
              </div>
            )}
          </div>
          <div className="py-2 space-y-2">
            {!isEditingPost ? (
              <>
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
              </>
            ) : (
              <div className="px-3 space-y-2">
                <textarea 
                  className="w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none min-h-[100px]" 
                  value={editPostText} 
                  onChange={(e) => setEditPostText(e.target.value)} 
                />
                
                {/* Current/New Media Preview */}
                {!removeMedia && (editMediaPreview || post.image_path || post.video_path) && (
                  <div style={{ position: 'relative' }} className="rounded-lg border border-white/10 overflow-hidden">
                    {editMediaPreview ? (
                      // New media preview
                      editMediaFile?.type.startsWith('video/') ? (
                        <video src={editMediaPreview} className="w-full max-h-48 object-contain bg-black block" controls />
                      ) : (
                        <img src={editMediaPreview} alt="New media" className="w-full max-h-48 object-contain block" />
                      )
                    ) : post.video_path ? (
                      <video src={normalizePath(post.video_path)} className="w-full max-h-48 object-contain bg-black block" controls />
                    ) : post.image_path ? (
                      <img src={normalizePath(post.image_path as string)} alt="Current" className="w-full max-h-48 object-contain block" />
                    ) : null}
                    <button
                      type="button"
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white hover:bg-black flex items-center justify-center"
                      onClick={() => {
                        clearEditMedia()
                        setRemoveMedia(true)
                      }}
                      title="Remove media"
                    >
                      <i className="fa-solid fa-xmark text-xs" />
                    </button>
                  </div>
                )}
                
                {/* Media buttons */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-md border border-white/10 text-sm hover:bg-white/10"
                    onClick={() => editMediaInputRef.current?.click()}
                  >
                    <i className="fa-solid fa-image mr-1" /> {editMediaFile ? 'Change' : 'Add'} Media
                  </button>
                  <input
                    ref={editMediaInputRef}
                    type="file"
                    accept="image/*,video/*"
                    onChange={handleEditMediaChange}
                    className="hidden"
                  />
                </div>
                
                {/* Save/Cancel buttons */}
                <div className="flex gap-2">
                  <button 
                    className="px-3 py-1.5 rounded-md bg-[#4db6ac] text-black" 
                    onClick={saveEditPost}
                  >
                    Save
                  </button>
                  <button 
                    className="px-3 py-1.5 rounded-md border border-white/10" 
                    onClick={cancelEditPost}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
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
              activeInlineReplyFor={activeInlineReplyFor}
              onSetActiveInlineReply={setActiveInlineReplyFor}
            />
          ))}
        </div>
      </div>
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

      {/* Fixed-bottom reply composer - hidden when inline reply is active */}
      {activeInlineReplyFor === null && (
      <div
        ref={composerRef}
        className="fixed left-0 right-0 z-[100]"
        style={{
          bottom: showKeyboard ? `${keyboardLift}px` : 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Composer card */}
        <div
          ref={composerCardRef}
          className="relative max-w-2xl w-[calc(100%-24px)] mx-auto rounded-[16px] px-2.5 py-3"
          style={{ background: '#0a0a0c' }}
        >
          {/* Attachment previews - show above input row when files attached */}
          {(file || replyGif || replyPreview) && (
            <div className="mb-2 flex items-center gap-2 flex-wrap">
              {file && (
                <div className="flex items-center gap-2">
                  <div className="w-12 h-12 rounded-md overflow-hidden border border-white/10">
                    {filePreviewUrl ? (
                      <img src={filePreviewUrl} alt="preview" className="w-full h-full object-cover" />
                    ) : null}
                  </div>
                  <button 
                    onClick={() => { setFile(null); setUploadFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                    className="text-red-400 hover:text-red-300"
                    aria-label="Remove file"
                  >
                    <i className="fa-solid fa-times" />
                  </button>
                </div>
              )}
              {replyGif && (
                <div className="flex items-center gap-2">
                  <div className="w-12 h-12 rounded-md overflow-hidden border border-white/10">
                    <img src={replyGif.previewUrl} alt="Selected GIF" className="w-full h-full object-cover" loading="lazy" />
                  </div>
                  <button
                    onClick={() => { setReplyGif(null) }}
                    className="text-red-400 hover:text-red-300"
                    aria-label="Remove GIF"
                  >
                    <i className="fa-solid fa-times" />
                  </button>
                </div>
              )}
              {replyPreview && (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <audio controls className="flex-1 h-8" playsInline webkit-playsinline="true" src={replyPreview.url} />
                  <button 
                    onClick={() => { clearReplyPreview(); }}
                    className="text-[#9fb0b5] hover:text-white"
                    aria-label="Remove audio"
                  >
                    <i className="fa-regular fa-trash-can" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Recording indicator */}
          {recording && (
            <div className="mb-2 flex items-center gap-3 px-1">
              <span className="inline-block w-2 h-2 bg-[#4db6ac] rounded-full animate-pulse" />
              <div className="flex-1 h-2 bg-white/10 rounded overflow-hidden">
                <div className="h-full bg-[#7fe7df] transition-all" style={{ width: `${Math.max(6, Math.min(96, level*100))}%` }} />
              </div>
              <div className="text-xs text-white/70">{Math.min(60, Math.round((recordMs||0)/1000))}s</div>
            </div>
          )}

          {/* Main input row */}
          <div className="flex items-end gap-1.5">
            {/* Attachment buttons */}
            <button 
              type="button" 
              className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-white/12 hover:bg-white/22 active:bg-white/28 transition-all"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Add image"
            >
              <i className="fa-solid fa-image text-sm" style={{ color: file ? '#7fe7df' : '#fff' }} />
            </button>
            <button 
              type="button" 
              className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-white/12 hover:bg-white/22 active:bg-white/28 transition-all"
              onClick={() => setGifPickerOpen(true)}
              aria-label="Add GIF"
            >
              <i className="fa-solid fa-images text-sm" style={{ color: replyGif ? '#7fe7df' : '#fff' }} />
            </button>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const next = (e.target as HTMLInputElement).files?.[0] || null
                setFile(next)
                setUploadFile(null)
                setReplyGif(null)
              }}
              className="hidden"
            />

            {/* Message input container with turquoise border */}
            <div className="flex-1 flex items-center rounded-lg border border-[#4db6ac] bg-white/8 overflow-hidden min-w-0">
              <MentionTextarea
                value={content}
                onChange={setContent}
                communityId={(post as any)?.community_id}
                postId={post?.id}
                placeholder="Write a reply..."
                className="flex-1 bg-transparent px-3 py-2 text-[15px] text-white placeholder-white/50 outline-none resize-none max-h-24 min-h-[36px]"
                rows={1}
                autoExpand
                perfDegraded={!!uploadFile}
              />
            </div>

            {/* Mic button - when not recording and no text */}
            {!recording && !content.trim() && (
              <button
                type="button"
                className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-white/12 hover:bg-white/22 active:bg-white/28 transition-all"
                onClick={() => startRec()}
                aria-label="Record audio"
              >
                <i className="fa-solid fa-microphone text-sm text-white" />
              </button>
            )}

            {/* Stop recording button */}
            {recording && (
              <button
                type="button"
                className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-[#4db6ac] text-white transition-all"
                onClick={() => stopRec()}
                aria-label="Stop recording"
              >
                <i className="fa-solid fa-stop text-sm" />
              </button>
            )}

            {/* Send button - when has content or attachment */}
            {!recording && (content.trim() || file || replyPreview || replyGif) && (
              <button
                className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-[#4db6ac] text-white hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                onClick={() => submitReply()}
                aria-label="Send reply"
                disabled={submittingReply}
              >
                {submittingReply ? <i className="fa-solid fa-spinner fa-spin text-sm" /> : <i className="fa-solid fa-paper-plane text-sm" />}
              </button>
            )}
          </div>
        </div>
        {/* Safe area spacer */}
        <div 
          style={{
            height: showKeyboard ? '4px' : 'env(safe-area-inset-bottom, 0px)',
            background: '#000',
            flexShrink: 0,
          }}
        />
      </div>
      )}
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
  if (prev.activeInlineReplyFor !== next.activeInlineReplyFor) return false
  return true
})

function ReplyNode({ reply, depth=0, currentUser: currentUserName, onToggle, onInlineReply, onDelete, onPreviewImage, inlineSendingFlag, communityId, postId, activeInlineReplyFor, onSetActiveInlineReply }:{ reply: Reply, depth?: number, currentUser?: string|null, onToggle: (id:number, reaction:string)=>void, onInlineReply: (id:number, text:string, file?: File)=>void, onDelete: (id:number)=>void, onPreviewImage: (src:string)=>void, inlineSendingFlag: boolean, communityId?: number | string, postId?: number, activeInlineReplyFor?: number | null, onSetActiveInlineReply?: (id: number | null) => void }){
  const currentUser = currentUserName
  // Use parent's activeInlineReplyFor if provided, otherwise use local state
  const [localShowComposer, setLocalShowComposer] = useState(false)
  const showComposer = onSetActiveInlineReply ? activeInlineReplyFor === reply.id : localShowComposer
  const setShowComposer = (val: boolean | ((prev: boolean) => boolean)) => {
    if (onSetActiveInlineReply) {
      const newVal = typeof val === 'function' ? val(showComposer) : val
      onSetActiveInlineReply(newVal ? reply.id : null)
    } else {
      setLocalShowComposer(val)
    }
  }
  const [text, setText] = useState('')
  const [img, setImg] = useState<File|null>(null)
  const inlineFileRef = useRef<HTMLInputElement|null>(null)
  const { recording: rec, recordMs: recMs, level: recLevel, preview: inlinePreview, start: startInlineRec, stop: stopInlineRec, clearPreview: clearInlinePreview } = useAudioRecorder()
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
    <div data-reply-node className={`relative py-2 ${depth === 0 ? 'border-b border-white/10' : ''}`}>
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
              <button className="px-2 py-1 rounded-full text-[#9fb0b5] hover:text-[#4db6ac]" onClick={(e)=> {
                setShowComposer(v => !v)
                // Scroll to show the composer under the reply
                setTimeout(() => {
                  const target = e.currentTarget.closest('[data-reply-node]')
                  target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }, 100)
              }}>Reply</button>
            </div>
          </div>
          {showComposer ? (
            <div className="mt-2 space-y-2 rounded-xl bg-[#0a0a0c] p-2">
              {/* Attachment previews */}
              {(img || inlineGif || inlinePreview) && (
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  {img && (
                    <div className="flex items-center gap-1">
                      <div className="w-10 h-10 rounded overflow-hidden border border-white/10">
                        <img src={URL.createObjectURL(img)} alt="preview" className="w-full h-full object-cover" />
                      </div>
                      <button onClick={() => { setImg(null); setInlineGif(null); setGifFile(null); if (inlineFileRef.current) inlineFileRef.current.value = '' }} className="text-red-400 hover:text-red-300 text-xs"><i className="fa-solid fa-times" /></button>
                    </div>
                  )}
                  {inlineGif && (
                    <div className="flex items-center gap-1">
                      <div className="w-10 h-10 rounded overflow-hidden border border-white/10">
                        <img src={inlineGif.previewUrl} alt="GIF" className="w-full h-full object-cover" loading="lazy" />
                      </div>
                      <button onClick={() => { setInlineGif(null); setGifFile(null) }} className="text-red-400 hover:text-red-300 text-xs"><i className="fa-solid fa-times" /></button>
                    </div>
                  )}
                  {inlinePreview && (
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <audio controls className="flex-1 h-7" playsInline src={inlinePreview.url} />
                      <button onClick={() => clearInlinePreview()} className="text-[#9fb0b5] hover:text-white text-xs"><i className="fa-regular fa-trash-can" /></button>
                    </div>
                  )}
                </div>
              )}
              {/* Recording indicator */}
              {rec && (
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 bg-[#4db6ac] rounded-full animate-pulse" />
                  <div className="flex-1 h-1.5 bg-white/10 rounded overflow-hidden">
                    <div className="h-full bg-[#7fe7df] transition-all" style={{ width: `${Math.max(6, Math.min(96, recLevel*100))}%` }} />
                  </div>
                  <span className="text-[10px] text-white/70">{Math.min(60, Math.round((recMs||0)/1000))}s</span>
                </div>
              )}
              {/* Input row */}
              <div className="flex items-end gap-1.5">
                <button type="button" className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20" onClick={() => inlineFileRef.current?.click()}>
                  <i className="fa-solid fa-image text-xs" style={{ color: img ? '#7fe7df' : '#fff' }} />
                </button>
                <button type="button" className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20" onClick={() => setShowGifPicker(true)}>
                  <i className="fa-solid fa-images text-xs" style={{ color: inlineGif ? '#7fe7df' : '#fff' }} />
                </button>
                <input ref={inlineFileRef} type="file" accept="image/*" onChange={(e) => { const next = (e.target as HTMLInputElement).files?.[0] || null; setImg(next); setInlineGif(null); setGifFile(null) }} className="hidden" />
                <div className="flex-1 flex items-center rounded-lg border border-[#4db6ac] bg-white/5 overflow-hidden min-w-0">
                  <MentionTextarea
                    value={text}
                    onChange={setText}
                    communityId={communityId}
                    postId={postId}
                    placeholder={`Reply to @${reply.username}`}
                    className="flex-1 bg-transparent px-2 py-1.5 text-[14px] text-white placeholder-white/50 outline-none resize-none max-h-20 min-h-[32px]"
                    rows={1}
                    autoExpand
                  />
                </div>
                {!rec && !text.trim() && !img && !inlinePreview && !gifFile && (
                  <button type="button" className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20" onClick={() => startInlineRec()}>
                    <i className="fa-solid fa-microphone text-xs text-white" />
                  </button>
                )}
                {rec && (
                  <button type="button" className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg bg-[#4db6ac]" onClick={() => stopInlineRec()}>
                    <i className="fa-solid fa-stop text-xs text-white" />
                  </button>
                )}
                {!rec && (text.trim() || img || inlinePreview || gifFile) && (
                  <button 
                    className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg bg-[#4db6ac] disabled:opacity-50"
                    disabled={inlineSendingFlag}
                    onClick={() => {
                      if (!text && !img && !inlinePreview && !gifFile) return
                      const attachment = inlinePreview
                        ? new File([inlinePreview.blob], inlinePreview.blob.type.includes('mp4') ? 'audio.mp4' : 'audio.webm', { type: inlinePreview.blob.type })
                        : (img || gifFile || undefined)
                      onInlineReply(reply.id, text, attachment as any)
                      setText('')
                      setImg(null)
                      setInlineGif(null)
                      setGifFile(null)
                      if (inlineFileRef.current) inlineFileRef.current.value = ''
                      clearInlinePreview()
                      setShowComposer(false)
                    }}
                  >
                    {inlineSendingFlag ? <i className="fa-solid fa-spinner fa-spin text-xs text-white" /> : <i className="fa-solid fa-paper-plane text-xs text-white" />}
                  </button>
                )}
              </div>
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
              activeInlineReplyFor={activeInlineReplyFor}
              onSetActiveInlineReply={onSetActiveInlineReply}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}