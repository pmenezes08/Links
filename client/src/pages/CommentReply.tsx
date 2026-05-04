import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import { useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'
import ZoomableImage from '../components/ZoomableImage'
import { formatSmartTime, parseFlexibleDate } from '../utils/time'
import MentionTextarea from '../components/MentionTextarea'
import GifPicker from '../components/GifPicker'
import type { GifSelection } from '../components/GifPicker'
import { gifSelectionToFile } from '../utils/gif'
import { renderRichText } from '../utils/linkUtils'
import { openExternalInApp } from '../utils/openExternalInApp'
import { useAudioRecorder } from '../components/useAudioRecorder'
import EditableAISummary from '../components/EditableAISummary'
import { isVideoAttachmentPath } from '../utils/replyMedia'
import { ENTITLEMENTS_REFRESH_EVENT } from '../hooks/useEntitlements'
import { clearDeviceCache } from '../utils/deviceCache'

function replyDisplayUrl(raw: string | null | undefined): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  if (s.startsWith('http') || s.startsWith('/')) return s
  return `/uploads/${s}`
}

type Reply = {
  id: number
  username: string
  content: string
  timestamp: string
  reactions: Record<string, number>
  user_reaction: string | null
  profile_picture?: string | null
  image_path?: string | null
  video_path?: string | null
  audio_path?: string | null
  audio_summary?: string | null
  parent_reply_id?: number | null
  reply_count?: number
  view_count?: number
  nested_replies?: Reply[]
}

type ReactionGroup = { reaction_type: string; users: Array<{ username: string; profile_picture?: string | null }> }
type ReplyViewer = { username: string; profile_picture?: string | null; viewed_at?: string | null }

type PostInfo = {
  id: number
  username: string
  content: string
  community_id?: number
  timestamp: string
  profile_picture?: string | null
  image_path?: string | null
}

type ParentReply = {
  id: number
  username: string
  content: string
  timestamp: string
  profile_picture?: string | null
  image_path?: string | null
  video_path?: string | null
  audio_path?: string | null
  audio_summary?: string | null
  parent_reply_id?: number | null
}

export default function CommentReply() {
  const { reply_id } = useParams<{ reply_id: string }>()
  const navigate = useNavigate()
  const mainReplyRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [reply, setReply] = useState<Reply | null>(null)
  const [post, setPost] = useState<PostInfo | null>(null)
  const [parentChain, setParentChain] = useState<ParentReply[]>([])
  const [currentUser, setCurrentUser] = useState<string>('')
  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [showGifPicker, setShowGifPicker] = useState(false)
  const [selectedGif, setSelectedGif] = useState<GifSelection | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const replyTokenRef = useRef<string>(`${Date.now()}_${Math.random().toString(36).slice(2)}`)
  const { recording, recordMs, preview: replyPreview, start: startRec, stop: stopRec, clearPreview: clearReplyPreview, level } = useAudioRecorder() as any

  const openArticleReader = useCallback((url: string) => {
    void openExternalInApp(url)
  }, [])
  
  // Edit state for main reply
  const [isEditingMain, setIsEditingMain] = useState(false)
  const [editMainText, setEditMainText] = useState('')
  
  // Edit state for nested replies (keyed by reply id)
  const [editingNestedId, setEditingNestedId] = useState<number | null>(null)
  const [editNestedText, setEditNestedText] = useState('')

  // Reply view tracking
  const viewRecordedRef = useRef(false)

  // Reactors modal state
  const [showReactorsModal, setShowReactorsModal] = useState(false)
  const [reactorsLoading, setReactorsLoading] = useState(false)
  const [reactorGroups, setReactorGroups] = useState<ReactionGroup[]>([])
  const [reactorViewers, setReactorViewers] = useState<ReplyViewer[]>([])
  const [reactorViewCount, setReactorViewCount] = useState<number | null>(null)

  // Steve AI state
  const [steveIsTyping, setSteveIsTyping] = useState(false)

  const [lightboxImageSrc, setLightboxImageSrc] = useState<string | null>(null)
  const [lightboxVideoSrc, setLightboxVideoSrc] = useState<string | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)

  // Check if message contains @Steve mention (case insensitive) - same as CommunityFeed
  const containsSteveMention = (text: string) => {
    const result = /@steve\b/i.test(text)
    console.log('[Steve AI] Checking for @Steve in:', text, '-> Found:', result)
    return result
  }

  // Call Steve AI to generate a reply - matching CommunityFeed implementation
  // Privacy gate is enforced on backend via user_can_access_steve_kb
  // (see docs/STEVE_PRIVACY_GATE.md - uses root parent of post's original community)
  const callSteveAI = async (userMessage: string, parentReplyId: number | null) => {
    console.log('[Steve AI] callSteveAI called with:', userMessage, 'parentReplyId:', parentReplyId)
    if (!containsSteveMention(userMessage)) {
      console.log('[Steve AI] No @Steve mention found, skipping')
      return
    }
    
    try {
      console.log('[Steve AI] Calling API...')
      setSteveIsTyping(true)
      const response = await fetch('/api/ai/steve_reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          post_id: post?.id,
          parent_reply_id: parentReplyId,
          user_message: userMessage,
          community_id: post?.community_id ? Number(post.community_id) : null
        })
      })
      
      const data = await response.json()
      console.log('[Steve AI] API response:', data)
      
      if (data.success && data.reply) {
        console.log('[Steve AI] Success! Adding Steve reply')
        // Add Steve's reply to the nested replies
        setReply((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            nested_replies: [...(prev.nested_replies || []), data.reply],
            reply_count: (prev.reply_count || 0) + 1,
          }
        })
        try { window.dispatchEvent(new Event(ENTITLEMENTS_REFRESH_EVENT)) } catch { /* noop */ }
      } else if (!data.success) {
        console.error('[Steve AI] Error:', data.error)
      }
    } catch (err) {
      console.error('[Steve AI] Failed to get Steve AI reply:', err)
    } finally {
      console.log('[Steve AI] Done, hiding typing indicator')
      setSteveIsTyping(false)
    }
  }

  // Keyboard handling state
  const keyboardOffsetRef = useRef(0)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const viewportBaseRef = useRef<number | null>(null)
  const [safeBottomPx, setSafeBottomPx] = useState(0)

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

  // Visual viewport tracking for web keyboard only (native uses Capacitor Keyboard;
  // dual sources caused bogus keyboard offset after iOS resume).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (Capacitor.getPlatform() !== 'web') return
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

  // Reset keyboard lift and nudge layout after app resume (fixes frozen / dead touches on iOS WebView).
  useEffect(() => {
    const nudgeLayout = () => {
      keyboardOffsetRef.current = 0
      setKeyboardOffset(0)
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'))
        requestAnimationFrame(() => {
          try {
            scrollAreaRef.current?.scrollBy({ top: 0, left: 0 })
          } catch {
            /* ignore */
          }
        })
      })
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') nudgeLayout()
    }
    document.addEventListener('visibilitychange', onVisibility)

    let resumeHandle: { remove: () => Promise<void> } | undefined
    const setupResume = async () => {
      if (!Capacitor.isNativePlatform()) return
      const { App } = await import('@capacitor/app')
      resumeHandle = await App.addListener('resume', () => {
        nudgeLayout()
      })
    }
    void setupResume()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      void resumeHandle?.remove()
    }
  }, [])

  // Fetch current user
  useEffect(() => {
    fetch('/api/profile_me', { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then((r) => r.json())
      .then((d) => {
        if (d?.success && d.profile?.username) {
          setCurrentUser(d.profile.username)
        }
      })
      .catch(() => {})
  }, [])

  // Fetch reply data
  const fetchReply = useCallback(async () => {
    if (!reply_id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/reply/${reply_id}`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
      const data = await res.json()
      if (data.success) {
        setReply(data.reply)
        setPost(data.post)
        setParentChain(data.parent_chain || [])
        setEditMainText(data.reply.content)
      }
    } catch (err) {
      console.error('Failed to fetch reply:', err)
    } finally {
      setLoading(false)
    }
  }, [reply_id])

  useEffect(() => {
    fetchReply()
  }, [fetchReply])

  // Record reply view
  useEffect(() => {
    if (!reply_id || viewRecordedRef.current) return
    viewRecordedRef.current = true
    fetch('/api/reply_view', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply_id: Number(reply_id) })
    })
      .then(r => r.json())
      .then(j => {
        if (j?.success && typeof j.view_count === 'number') {
          setReply(prev => prev && prev.id === Number(reply_id) ? { ...prev, view_count: j.view_count } : prev)
        }
      })
      .catch(() => { viewRecordedRef.current = false })
  }, [reply_id])

  // Scroll to main reply on load
  useEffect(() => {
    if (!loading && mainReplyRef.current) {
      setTimeout(() => {
        mainReplyRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' })
      }, 100)
    }
  }, [loading, reply_id])

  // Close attachment menu on outside click
  useEffect(() => {
    if (!showAttachMenu) return
    const handleClickOutside = () => setShowAttachMenu(false)
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 10)
    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [showAttachMenu])

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

  useEffect(() => {
    let revokedUrl: string | null = null
    let cancelled = false
    async function buildPreview() {
      if (selectedGif) { setFilePreviewUrl(null); setUploadFile(null); return }
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
        if (isImage && 'createImageBitmap' in window) {
          const maxEdge = 256
          const bmp = await (window as any).createImageBitmap(file, { resizeWidth: maxEdge, resizeHeight: maxEdge, resizeQuality: 'high' })
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
        if (!cancelled && file) setUploadFile(file)
      }
    }
    buildPreview()
    return () => {
      cancelled = true
      if (revokedUrl) {
        try { URL.revokeObjectURL(revokedUrl) } catch {}
      }
    }
  }, [file, selectedGif])

  // Submit a reply
  const handleSubmitReply = async () => {
    if (!reply || !post) return
    const hasMedia = !!(selectedGif || file || uploadFile || replyPreview?.blob)
    if (!replyText.trim() && !hasMedia) return
    setSendingReply(true)
    try {
      const fd = new FormData()
      fd.append('post_id', String(post.id))
      fd.append('content', replyText.trim())
      fd.append('parent_reply_id', String(reply.id))
      fd.append('dedupe_token', replyTokenRef.current)

      try {
        let imageFile: File | null = null
        if (selectedGif) {
          imageFile = await gifSelectionToFile(selectedGif, 'reply-gif')
        } else if (uploadFile) {
          imageFile = uploadFile
        } else if (file) {
          imageFile = file
        }
        if (imageFile) fd.append('image', imageFile)
      } catch (err) {
        console.error('Failed to prepare image/GIF attachment', err)
        setSendingReply(false)
        alert('Unable to attach media. Please try again.')
        return
      }

      if (replyPreview?.blob) {
        fd.append('audio', replyPreview.blob, (replyPreview.blob.type.includes('mp4') ? 'audio.mp4' : 'audio.webm'))
        const durSec = (replyPreview as { duration?: number }).duration ?? (recordMs / 1000)
        if (durSec > 0) fd.append('voice_duration_seconds', String(durSec))
      }

      const res = await fetch('/post_reply', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()

      if (data.success && data.reply) {
        setReply((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            nested_replies: [...(prev.nested_replies || []), data.reply],
            reply_count: (prev.reply_count || 0) + 1,
          }
        })
        const messageText = replyText.trim()
        console.log('[Steve AI] Reply posted, checking message:', messageText)
        if (containsSteveMention(messageText)) {
          console.log('[Steve AI] @Steve found, calling AI with user reply ID:', data.reply.id)
          callSteveAI(messageText, data.reply.id)
        }
        setReplyText('')
        setSelectedGif(null)
        setFile(null)
        setUploadFile(null)
        setFilePreviewUrl(null)
        clearReplyPreview()
        if (fileInputRef.current) fileInputRef.current.value = ''
        setShowAttachMenu(false)
        replyTokenRef.current = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      } else {
        alert(data.error || 'Failed to post reply')
      }
    } catch (err) {
      console.error('Failed to submit reply:', err)
      alert('Failed to post reply')
    } finally {
      setSendingReply(false)
    }
  }

  function formatViewerRelative(viewed_at?: string | null): string {
    if (!viewed_at) return ''
    const date = parseFlexibleDate(viewed_at)
    if (!date) return ''
    const diffMs = Date.now() - date.getTime()
    const diffMins = Math.round(diffMs / 60000)
    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHrs = Math.round(diffMins / 60)
    if (diffHrs < 24) return `${diffHrs}h ago`
    const diffDays = Math.round(diffHrs / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  async function openReplyReactorsModal(replyId: number) {
    setShowReactorsModal(true)
    setReactorsLoading(true)
    setReactorGroups([])
    setReactorViewers([])
    setReactorViewCount(null)
    try {
      const r = await fetch(`/get_reply_reactors/${replyId}`, { credentials: 'include' })
      const j = await r.json().catch(() => null)
      if (j?.success) {
        setReactorGroups(Array.isArray(j.groups) ? j.groups : [])
        const viewerList: ReplyViewer[] = Array.isArray(j.viewers)
          ? (j.viewers as Array<any>)
              .map((v: any) => ({ username: v?.username, profile_picture: v?.profile_picture ?? null, viewed_at: v?.viewed_at ?? null }))
              .filter((v: any) => typeof v.username === 'string' && v.username.length > 0)
          : []
        setReactorViewers(viewerList)
        setReactorViewCount(typeof j.view_count === 'number' ? j.view_count : viewerList.length || null)
      }
    } finally {
      setReactorsLoading(false)
    }
  }

  const handleReaction = async (targetReplyId: number, reactionType: string = 'heart') => {
    try {
      const fd = new FormData()
      fd.append('reply_id', String(targetReplyId))
      fd.append('reaction', reactionType)
      const res = await fetch('/add_reply_reaction', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      if (data.success) {
        setReply((prev) => {
          if (!prev) return prev
          if (prev.id === targetReplyId) {
            return { ...prev, reactions: data.counts, user_reaction: data.user_reaction }
          }
          return {
            ...prev,
            nested_replies: (prev.nested_replies || []).map((nr) =>
              nr.id === targetReplyId ? { ...nr, reactions: data.counts, user_reaction: data.user_reaction } : nr
            ),
          }
        })
      }
    } catch (err) {
      console.error('Failed to add reaction:', err)
    }
  }

  // Delete a reply
  const handleDelete = async (targetReplyId: number) => {
    if (!confirm('Delete this reply?')) return
    try {
      const fd = new FormData()
      fd.append('reply_id', String(targetReplyId))
      const res = await fetch('/delete_reply', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      if (data.success) {
        // Invalidate caches so PostDetail and feeds don't resurrect the deleted reply
        try {
          if (post?.id) clearDeviceCache(`post-${post.id}`)
          const cid = (post as any)?.community_id
          if (cid !== undefined && cid !== null && cid !== '') {
            clearDeviceCache(`community-feed:${cid}`)
          }
          clearDeviceCache('home-timeline')
        } catch {}

        if (targetReplyId === reply?.id) {
          // Simple approach: always go to the post (PostDetail will handle community context)
          if (post) {
            navigate(`/post/${post.id}`)
          } else {
            navigate(-1)
          }
        } else {
          setReply((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              nested_replies: (prev.nested_replies || []).filter((nr) => nr.id !== targetReplyId),
              reply_count: Math.max(0, (prev.reply_count || 0) - 1),
            }
          })
        }
      }
    } catch (err) {
      console.error('Failed to delete reply:', err)
    }
  }

  // Edit main reply
  const handleEditMain = async () => {
    if (!reply) return
    try {
      const fd = new FormData()
      fd.append('reply_id', String(reply.id))
      fd.append('content', editMainText)
      const res = await fetch('/edit_reply', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      if (data.success) {
        setReply((prev) => prev ? { ...prev, content: editMainText } : prev)
        setIsEditingMain(false)
      } else {
        alert(data.error || 'Failed to edit')
      }
    } catch (err) {
      console.error('Failed to edit reply:', err)
      alert('Failed to edit reply')
    }
  }

  // Edit nested reply
  const handleEditNested = async (nestedId: number) => {
    try {
      const fd = new FormData()
      fd.append('reply_id', String(nestedId))
      fd.append('content', editNestedText)
      const res = await fetch('/edit_reply', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      if (data.success) {
        setReply((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            nested_replies: (prev.nested_replies || []).map((nr) =>
              nr.id === nestedId ? { ...nr, content: editNestedText } : nr
            ),
          }
        })
        setEditingNestedId(null)
        setEditNestedText('')
      } else {
        alert(data.error || 'Failed to edit')
      }
    } catch (err) {
      console.error('Failed to edit reply:', err)
      alert('Failed to edit reply')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <i className="fa-solid fa-spinner fa-spin text-2xl text-[#4db6ac]" />
      </div>
    )
  }

  if (!reply) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-4">
        <p className="text-white/60">Reply not found</p>
        <button
          onClick={() => {
            // Simple approach: always go to the post (PostDetail will handle community context)
            if (post) {
              navigate(`/post/${post.id}`)
            } else {
              navigate(-1)
            }
          }}
          className="px-4 py-2 rounded-lg bg-[#4db6ac] text-black font-medium"
        >
          Go Back
        </button>
      </div>
    )
  }

  const heartCount = reply.reactions?.['heart'] || reply.reactions?.['❤️'] || 0
  const isHeartActive = reply.user_reaction === 'heart' || reply.user_reaction === '❤️'
  const thumbsUpCount = reply.reactions?.['thumbs-up'] || 0
  const isThumbsUpActive = reply.user_reaction === 'thumbs-up'
  const thumbsDownCount = reply.reactions?.['thumbs-down'] || 0
  const isThumbsDownActive = reply.user_reaction === 'thumbs-down'
  
  // Calculate keyboard lift (subtract safe area since keyboard height includes it on iOS)
  const keyboardLift = Math.max(0, keyboardOffset - safeBottomPx)
  const showKeyboard = keyboardOffset > 2

  return (
    <div
      className="min-h-screen bg-black text-white flex flex-col"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
      {/* Fixed Header - exactly like PostDetail */}
      <div
        className="flex-shrink-0 border-b border-white/10 z-50"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          background: '#000',
        }}
      >
        <div className="h-14 flex items-center gap-2 px-3">
          <button
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
            onClick={() => {
              // Simple approach: always go to the post. PostDetail will handle
              // smart context detection to decide whether to go to community feed
              if (post) {
                navigate(`/post/${post.id}`)
              } else {
                navigate(-1)
              }
            }}
            aria-label="Back"
          >
            <i className="fa-solid fa-arrow-left text-white text-lg" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="font-semibold tracking-[-0.01em] text-sm text-white">Thread</div>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div 
        ref={scrollAreaRef}
        className="flex-1 overflow-y-auto"
        style={{ 
          paddingBottom: showKeyboard 
            ? `${90 + keyboardLift}px`  // Composer height + keyboard lift + buffer
            : `${90 + safeBottomPx}px`  // Composer height + safe area + buffer
        }}
      >
        <div className="max-w-2xl mx-auto">
          
          {/* Original Post Context */}
          {post && (
            <div
              className="px-4 py-4 border-b border-white/10 cursor-pointer hover:bg-white/[0.02]"
              onClick={() => navigate(`/post/${post.id}`)}
            >
              <div className="flex gap-3">
                <div className="flex flex-col items-center">
                  <Avatar username={post.username} url={post.profile_picture || undefined} size={40} />
                  {/* Connector line to next item */}
                  <div className="flex-1 w-0.5 bg-white/20 mt-2 min-h-[20px]" />
                </div>
                <div className="flex-1 min-w-0 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{post.username}</span>
                    <span className="text-xs text-white/40">{formatSmartTime(post.timestamp)}</span>
                  </div>
                  <div className="mt-1 text-[14px] text-white/70 line-clamp-3">
                    {renderRichText(post.content, false, (u) => navigate(`/profile/${encodeURIComponent(u)}`), openArticleReader)}
                  </div>
                  {post.image_path && !isVideoAttachmentPath(post.image_path) && (
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                      <ImageLoader
                        src={replyDisplayUrl(post.image_path)}
                        alt="Post image"
                        className="rounded-lg max-h-[150px] object-contain cursor-zoom-in"
                        onClick={() => setLightboxImageSrc(replyDisplayUrl(post.image_path))}
                      />
                    </div>
                  )}
                  {post.image_path && isVideoAttachmentPath(post.image_path) && (
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                      <video
                        src={replyDisplayUrl(post.image_path) + '#t=0.1'}
                        className="w-full max-h-[150px] rounded-lg bg-black"
                        controls
                        playsInline
                        preload="metadata"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Parent Chain Context (ancestors from root comment to immediate parent) */}
          {parentChain.map((parent) => (
            <div
              key={parent.id}
              className="px-4 py-3 border-b border-white/10 cursor-pointer hover:bg-white/[0.02]"
              onClick={() => navigate(`/reply/${parent.id}`)}
            >
              <div className="flex gap-3">
                <div className="flex flex-col items-center">
                  <Avatar username={parent.username} url={parent.profile_picture || undefined} size={36} />
                  {/* Connector line to next item */}
                  <div className="flex-1 w-0.5 bg-white/20 mt-2 min-h-[16px]" />
                </div>
                <div className="flex-1 min-w-0 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{parent.username}</span>
                    <span className="text-xs text-white/40">{formatSmartTime(parent.timestamp)}</span>
                  </div>
                  <div className="mt-1 text-[13px] text-white/60 line-clamp-2">
                    {renderRichText(parent.content, false, (u) => navigate(`/profile/${encodeURIComponent(u)}`), openArticleReader)}
                  </div>
                  {parent.image_path && !isVideoAttachmentPath(parent.image_path) && (
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                      <ImageLoader
                        src={replyDisplayUrl(parent.image_path)}
                        alt="Reply image"
                        className="rounded-lg max-h-[100px] object-contain cursor-zoom-in"
                        onClick={() => setLightboxImageSrc(replyDisplayUrl(parent.image_path))}
                      />
                    </div>
                  )}
                  {(parent.video_path || (parent.image_path && isVideoAttachmentPath(parent.image_path))) && (
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                      <video
                        src={replyDisplayUrl((parent.video_path || parent.image_path) as string) + '#t=0.1'}
                        className="w-full max-h-[120px] rounded-lg bg-black"
                        controls
                        playsInline
                        preload="metadata"
                      />
                    </div>
                  )}
                  {parent.audio_path && (
                    <div className="mt-2 space-y-1" onClick={(e) => e.stopPropagation()}>
                      {parent.audio_summary ? (
                        <p className="text-[12px] text-white/70 italic line-clamp-4">{parent.audio_summary}</p>
                      ) : (() => {
                        const t = parseFlexibleDate(parent.timestamp)?.getTime()
                        if (t != null && !Number.isNaN(t) && Date.now() - t < 120000) {
                          return (
                            <div className="flex items-center gap-1">
                              <i className="fa-solid fa-wand-magic-sparkles text-[9px] text-white/40" />
                              <span className="text-[11px] text-white/40">Steve summary generating</span>
                            </div>
                          )
                        }
                        return null
                      })()}
                      <audio
                        controls
                        className="w-full max-h-8"
                        src={parent.audio_path.startsWith('http') || parent.audio_path.startsWith('/') ? parent.audio_path : `/uploads/${parent.audio_path}`}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Main Reply (the focus of this page) */}
          <div ref={mainReplyRef} className="px-4 py-4 border-b border-white/10 bg-white/[0.02]">
            <div className="flex gap-3">
              <Avatar username={reply.username} url={reply.profile_picture || undefined} size={44} linkToProfile />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{reply.username}</span>
                  <span className="text-sm text-white/40">{formatSmartTime(reply.timestamp)}</span>
                  {/* Edit/Delete buttons for main reply - show for author or admin */}
                  {(currentUser === reply.username || currentUser === 'admin') ? (
                    <>
                      <button
                        className="ml-2 px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]"
                        title="Edit reply"
                        onClick={() => {
                          setEditMainText(reply.content)
                          setIsEditingMain(true)
                        }}
                      >
                        <i className="fa-regular fa-pen-to-square" />
                      </button>
                      <button
                        className="ml-1 px-2 py-1 rounded-full text-[#6c757d] hover:text-red-400"
                        title="Delete reply"
                        onClick={() => handleDelete(reply.id)}
                      >
                        <i className="fa-regular fa-trash-can" />
                      </button>
                    </>
                  ) : null}
                </div>

                {/* Reply content or edit form */}
                {!isEditingMain ? (
                  <>
                    {reply.content && (
                      <div className="mt-2 text-[15px] whitespace-pre-wrap break-words text-white/90">
                        {renderRichText(reply.content, false, (u) => navigate(`/profile/${encodeURIComponent(u)}`), openArticleReader)}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="mt-2">
                    <textarea
                      className="w-full resize-none max-h-60 min-h-[100px] px-3 py-2 rounded-md bg-black border border-[#4db6ac] text-[14px] focus:outline-none focus:ring-1 focus:ring-[#4db6ac]"
                      value={editMainText}
                      onChange={(e) => setEditMainText(e.target.value)}
                      autoFocus
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        className="px-3 py-1.5 rounded-md bg-[#4db6ac] text-black text-sm font-medium"
                        onClick={handleEditMain}
                      >
                        Save
                      </button>
                      <button
                        className="px-3 py-1.5 rounded-md border border-white/10 text-sm"
                        onClick={() => {
                          setIsEditingMain(false)
                          setEditMainText(reply.content)
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Reply image or video */}
                {reply.image_path && !isVideoAttachmentPath(reply.image_path) && !isEditingMain && (
                  <div className="mt-3">
                    <ImageLoader
                      src={replyDisplayUrl(reply.image_path)}
                      alt="Reply image"
                      className="rounded-xl max-h-[400px] object-contain cursor-zoom-in"
                      onClick={() => setLightboxImageSrc(replyDisplayUrl(reply.image_path))}
                    />
                  </div>
                )}
                {(reply.video_path || (reply.image_path && isVideoAttachmentPath(reply.image_path))) &&
                  !isEditingMain && (
                    <div className="mt-3 space-y-2">
                      <video
                        src={
                          replyDisplayUrl((reply.video_path || reply.image_path) as string) + '#t=0.1'
                        }
                        className="w-full max-h-[360px] rounded-xl bg-black"
                        controls
                        playsInline
                        preload="metadata"
                      />
                      <button
                        type="button"
                        className="text-sm text-[#4db6ac] hover:underline"
                        onClick={() =>
                          setLightboxVideoSrc(
                            replyDisplayUrl((reply.video_path || reply.image_path) as string)
                          )
                        }
                      >
                        Open full screen
                      </button>
                    </div>
                  )}

                {/* Reply audio */}
                {reply.audio_path && !isEditingMain && (
                  <div className="mt-3 space-y-2">
                    {reply.audio_summary ? (
                      <EditableAISummary
                        replyId={reply.id}
                        initialSummary={reply.audio_summary}
                        isOwner={currentUser === reply.username || currentUser === 'admin'}
                        onSummaryUpdate={(newSummary) =>
                          setReply((prev) => (prev ? { ...prev, audio_summary: newSummary } : prev))
                        }
                      />
                    ) : (() => {
                      const t = parseFlexibleDate(reply.timestamp)?.getTime()
                      if (t != null && !Number.isNaN(t) && Date.now() - t < 120000) {
                        return (
                          <div className="flex items-center gap-1">
                            <i className="fa-solid fa-wand-magic-sparkles text-[9px] text-white/40" />
                            <span className="text-[11px] text-white/40">Steve summary generating</span>
                            <span className="flex gap-0.5 ml-0.5">
                              <span className="w-1 h-1 bg-[#4db6ac] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                              <span className="w-1 h-1 bg-[#4db6ac] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                              <span className="w-1 h-1 bg-[#4db6ac] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </span>
                          </div>
                        )
                      }
                      return null
                    })()}
                    <audio
                      controls
                      className="w-full"
                      src={
                        reply.audio_path.startsWith('http') || reply.audio_path.startsWith('/')
                          ? reply.audio_path
                          : `/uploads/${reply.audio_path}`
                      }
                    />
                  </div>
                )}

                {/* Reactions + view + reply count */}
                {!isEditingMain && (
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      onClick={() => handleReaction(reply.id, 'heart')}
                      className={`flex items-center gap-1 text-sm transition ${isHeartActive ? 'text-red-400' : 'text-white/40 hover:text-red-400'}`}
                    >
                      <i className={`${isHeartActive ? 'fa-solid' : 'fa-regular'} fa-heart`} />
                      {heartCount > 0 && <span>{heartCount}</span>}
                    </button>
                    <button
                      onClick={() => handleReaction(reply.id, 'thumbs-up')}
                      className={`flex items-center gap-1 text-sm transition ${isThumbsUpActive ? 'text-[#4db6ac]' : 'text-white/40 hover:text-[#4db6ac]'}`}
                    >
                      <i className={`${isThumbsUpActive ? 'fa-solid' : 'fa-regular'} fa-thumbs-up`} />
                      {thumbsUpCount > 0 && <span>{thumbsUpCount}</span>}
                    </button>
                    <button
                      onClick={() => handleReaction(reply.id, 'thumbs-down')}
                      className={`flex items-center gap-1 text-sm transition ${isThumbsDownActive ? 'text-orange-400' : 'text-white/40 hover:text-orange-400'}`}
                    >
                      <i className={`${isThumbsDownActive ? 'fa-solid' : 'fa-regular'} fa-thumbs-down`} />
                      {thumbsDownCount > 0 && <span>{thumbsDownCount}</span>}
                    </button>
                    <button
                      className="flex items-center gap-1 text-sm text-white/40 hover:text-white transition"
                      onClick={() => openReplyReactorsModal(reply.id)}
                      title="View reactions & viewers"
                    >
                      <i className="fa-regular fa-eye" />
                      <span>{typeof reply.view_count === 'number' ? reply.view_count : 0}</span>
                    </button>
                    <span className="flex items-center gap-1.5 text-sm text-white/40">
                      <i className="fa-regular fa-comment" />
                      {reply.reply_count || 0}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Nested replies */}
          {reply.nested_replies && reply.nested_replies.length > 0 && (
            <div className="divide-y divide-white/5">
              {reply.nested_replies.map((nr) => {
                const nrHeartCount = nr.reactions?.['heart'] || nr.reactions?.['❤️'] || 0
                const nrIsHeartActive = nr.user_reaction === 'heart' || nr.user_reaction === '❤️'
                const nrThumbsUpCount = nr.reactions?.['thumbs-up'] || 0
                const nrIsThumbsUpActive = nr.user_reaction === 'thumbs-up'
                const nrThumbsDownCount = nr.reactions?.['thumbs-down'] || 0
                const nrIsThumbsDownActive = nr.user_reaction === 'thumbs-down'
                const nrReplyCount = nr.reply_count || 0
                const isEditingThis = editingNestedId === nr.id

                return (
                  <div
                    key={nr.id}
                    className="px-4 py-4 hover:bg-white/[0.02] cursor-pointer"
                    onClick={() => !isEditingThis && navigate(`/reply/${nr.id}`)}
                  >
                    <div className="flex gap-3">
                      <div onClick={(e) => e.stopPropagation()}>
                        <Avatar username={nr.username} url={nr.profile_picture || undefined} size={36} linkToProfile />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{nr.username}</span>
                          <span className="text-xs text-white/40">{formatSmartTime(nr.timestamp)}</span>
                          {/* Edit/Delete buttons for nested reply - show for author or admin */}
                          {(currentUser === nr.username || currentUser === 'admin') ? (
                            <div onClick={(e) => e.stopPropagation()}>
                              <button
                                className="ml-2 px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]"
                                title="Edit reply"
                                onClick={() => {
                                  setEditNestedText(nr.content)
                                  setEditingNestedId(nr.id)
                                }}
                              >
                                <i className="fa-regular fa-pen-to-square" />
                              </button>
                              <button
                                className="ml-1 px-2 py-1 rounded-full text-[#6c757d] hover:text-red-400"
                                title="Delete reply"
                                onClick={() => handleDelete(nr.id)}
                              >
                                <i className="fa-regular fa-trash-can" />
                              </button>
                            </div>
                          ) : null}
                        </div>

                        {/* Content or edit form */}
                        {!isEditingThis ? (
                          <>
                            {nr.content && (
                              <div className="mt-1 text-[14px] whitespace-pre-wrap break-words text-white/80">
                                {renderRichText(nr.content, false, (u) => navigate(`/profile/${encodeURIComponent(u)}`), openArticleReader)}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                            <textarea
                              className="w-full resize-none max-h-40 min-h-[80px] px-3 py-2 rounded-md bg-black border border-[#4db6ac] text-[13px] focus:outline-none focus:ring-1 focus:ring-[#4db6ac]"
                              value={editNestedText}
                              onChange={(e) => setEditNestedText(e.target.value)}
                              autoFocus
                            />
                            <div className="mt-2 flex gap-2">
                              <button
                                className="px-3 py-1 rounded-md bg-[#4db6ac] text-black text-xs font-medium"
                                onClick={() => handleEditNested(nr.id)}
                              >
                                Save
                              </button>
                              <button
                                className="px-3 py-1 rounded-md border border-white/10 text-xs"
                                onClick={() => {
                                  setEditingNestedId(null)
                                  setEditNestedText('')
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {nr.image_path && !isVideoAttachmentPath(nr.image_path) && !isEditingThis && (
                          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                            <ImageLoader
                              src={replyDisplayUrl(nr.image_path)}
                              alt="Reply image"
                              className="rounded-lg max-h-[200px] object-contain cursor-zoom-in"
                              onClick={() => setLightboxImageSrc(replyDisplayUrl(nr.image_path))}
                            />
                          </div>
                        )}
                        {(nr.video_path ||
                          (nr.image_path && isVideoAttachmentPath(nr.image_path))) &&
                          !isEditingThis && (
                            <div className="mt-2 space-y-1" onClick={(e) => e.stopPropagation()}>
                              <video
                                src={
                                  replyDisplayUrl((nr.video_path || nr.image_path) as string) +
                                  '#t=0.1'
                                }
                                className="w-full max-h-[220px] rounded-lg bg-black"
                                controls
                                playsInline
                                preload="metadata"
                              />
                              <button
                                type="button"
                                className="text-xs text-[#4db6ac] hover:underline"
                                onClick={() =>
                                  setLightboxVideoSrc(
                                    replyDisplayUrl((nr.video_path || nr.image_path) as string)
                                  )
                                }
                              >
                                Open full screen
                              </button>
                            </div>
                          )}

                        {nr.audio_path && !isEditingThis && (
                          <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                            {nr.audio_summary ? (
                              <EditableAISummary
                                replyId={nr.id}
                                initialSummary={nr.audio_summary}
                                isOwner={currentUser === nr.username || currentUser === 'admin'}
                                onSummaryUpdate={(newSummary) =>
                                  setReply((prev) => {
                                    if (!prev?.nested_replies) return prev
                                    return {
                                      ...prev,
                                      nested_replies: prev.nested_replies.map((x) =>
                                        x.id === nr.id ? { ...x, audio_summary: newSummary } : x
                                      ),
                                    }
                                  })
                                }
                              />
                            ) : (() => {
                              const t = parseFlexibleDate(nr.timestamp)?.getTime()
                              if (t != null && !Number.isNaN(t) && Date.now() - t < 120000) {
                                return (
                                  <div className="flex items-center gap-1 text-[11px] text-white/40">
                                    <i className="fa-solid fa-wand-magic-sparkles text-[9px]" />
                                    Steve summary generating
                                  </div>
                                )
                              }
                              return null
                            })()}
                            <audio
                              controls
                              className="w-full"
                              src={
                                nr.audio_path.startsWith('http') || nr.audio_path.startsWith('/')
                                  ? nr.audio_path
                                  : `/uploads/${nr.audio_path}`
                              }
                            />
                          </div>
                        )}

                        {/* Reactions + view + reply count */}
                        {!isEditingThis && (
                          <div className="mt-2 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => handleReaction(nr.id, 'heart')}
                              className={`flex items-center gap-1 text-xs transition ${nrIsHeartActive ? 'text-red-400' : 'text-white/40 hover:text-red-400'}`}
                            >
                              <i className={`${nrIsHeartActive ? 'fa-solid' : 'fa-regular'} fa-heart`} />
                              {nrHeartCount > 0 && <span>{nrHeartCount}</span>}
                            </button>
                            <button
                              onClick={() => handleReaction(nr.id, 'thumbs-up')}
                              className={`flex items-center gap-1 text-xs transition ${nrIsThumbsUpActive ? 'text-[#4db6ac]' : 'text-white/40 hover:text-[#4db6ac]'}`}
                            >
                              <i className={`${nrIsThumbsUpActive ? 'fa-solid' : 'fa-regular'} fa-thumbs-up`} />
                              {nrThumbsUpCount > 0 && <span>{nrThumbsUpCount}</span>}
                            </button>
                            <button
                              onClick={() => handleReaction(nr.id, 'thumbs-down')}
                              className={`flex items-center gap-1 text-xs transition ${nrIsThumbsDownActive ? 'text-orange-400' : 'text-white/40 hover:text-orange-400'}`}
                            >
                              <i className={`${nrIsThumbsDownActive ? 'fa-solid' : 'fa-regular'} fa-thumbs-down`} />
                              {nrThumbsDownCount > 0 && <span>{nrThumbsDownCount}</span>}
                            </button>
                            <button
                              className="flex items-center gap-1 text-xs text-white/40 hover:text-white transition"
                              onClick={() => openReplyReactorsModal(nr.id)}
                              title="View reactions & viewers"
                            >
                              <i className="fa-regular fa-eye" />
                              <span>{typeof nr.view_count === 'number' ? nr.view_count : 0}</span>
                            </button>
                            <span className="flex items-center gap-1 text-xs text-white/40">
                              <i className="fa-regular fa-comment" />
                              {nrReplyCount}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Steve is typing indicator */}
          {steveIsTyping && (
            <div className="px-4 py-3 border-t border-white/5 flex items-center gap-2 text-xs text-white/60">
              <span className="font-medium text-[#4db6ac]">Steve</span>
              <span>is typing</span>
              <span className="inline-flex gap-0.5">
                <span className="w-1 h-1 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          )}

          {/* Empty state */}
          {(!reply.nested_replies || reply.nested_replies.length === 0) && !steveIsTyping && (
            <div className="px-4 py-16 text-center text-white/30">
              <i className="fa-regular fa-comments text-3xl mb-3 block" />
              <p className="text-sm">No replies yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Fixed bottom reply composer */}
      <div 
        className="fixed left-0 right-0 z-[100] bg-black border-t border-white/10"
        style={{ bottom: showKeyboard ? keyboardLift : 0 }}
      >
        <div className="max-w-2xl mx-auto px-3 py-3">
          {(file || selectedGif || replyPreview) && (
            <div className="mb-2 flex items-center gap-2 flex-wrap">
              {file && filePreviewUrl && (
                <div className="flex items-center gap-2">
                  <div className="w-12 h-12 rounded-md overflow-hidden border border-white/10">
                    {typeof file.type === 'string' && file.type.startsWith('video/') ? (
                      <video src={filePreviewUrl} className="w-full h-full object-cover" muted playsInline />
                    ) : (
                      <img src={filePreviewUrl} alt="preview" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setFile(null); setUploadFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                    className="text-red-400 hover:text-red-300"
                    aria-label="Remove file"
                  >
                    <i className="fa-solid fa-times" />
                  </button>
                </div>
              )}
              {selectedGif && (
                <div className="flex items-center gap-2">
                  <div className="w-12 h-12 rounded-md overflow-hidden border border-white/10">
                    <img src={selectedGif.previewUrl} alt="GIF" className="w-full h-full object-cover" loading="lazy" />
                  </div>
                  <button type="button" onClick={() => setSelectedGif(null)} className="text-red-400 hover:text-red-300" aria-label="Remove GIF">
                    <i className="fa-solid fa-times" />
                  </button>
                </div>
              )}
              {replyPreview && (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <audio controls className="flex-1 h-8" playsInline webkit-playsinline="true" src={replyPreview.url} />
                  <button type="button" onClick={() => clearReplyPreview()} className="text-[#9fb0b5] hover:text-white" aria-label="Remove audio">
                    <i className="fa-regular fa-trash-can" />
                  </button>
                </div>
              )}
            </div>
          )}

          {recording && (
            <div className="mb-2 flex items-center gap-3 px-1">
              <span className="inline-block w-2 h-2 bg-[#4db6ac] rounded-full animate-pulse" />
              <div className="flex-1 h-2 bg-white/10 rounded overflow-hidden">
                <div className="h-full bg-[#7fe7df] transition-all" style={{ width: `${Math.max(6, Math.min(96, (level || 0) * 100))}%` }} />
              </div>
              <div className="text-xs text-white/70">{Math.min(60, Math.round((recordMs || 0) / 1000))}s</div>
            </div>
          )}

          <div className="flex min-w-0 items-end gap-2">
            <div className="relative">
              <button
                type="button"
                className="w-9 h-9 flex-none flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/15"
                onClick={() => setShowAttachMenu(!showAttachMenu)}
                aria-label="Add attachment"
              >
                <i className={`fa-solid ${showAttachMenu ? 'fa-times' : 'fa-plus'} text-sm`} style={{ color: (file || selectedGif) ? '#7fe7df' : '#fff' }} />
              </button>
              {showAttachMenu && (
                <div className="absolute bottom-full left-0 mb-2 w-40 rounded-xl bg-[#1a1a1c] border border-white/10 shadow-xl overflow-hidden z-10">
                  <button
                    type="button"
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/10 transition-colors text-left"
                    onClick={() => {
                      fileInputRef.current?.click()
                      setShowAttachMenu(false)
                    }}
                  >
                    <i className="fa-solid fa-image text-[#4db6ac]" />
                    <span className="text-sm text-white">Photo / Video</span>
                  </button>
                  <button
                    type="button"
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/10 transition-colors text-left border-t border-white/5"
                    onClick={() => {
                      setShowGifPicker(true)
                      setShowAttachMenu(false)
                    }}
                  >
                    <i className="fa-solid fa-images text-[#4db6ac]" />
                    <span className="text-sm text-white">GIF</span>
                  </button>
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              onChange={(e) => {
                const next = (e.target as HTMLInputElement).files?.[0] || null
                setFile(next)
                setUploadFile(null)
                setSelectedGif(null)
              }}
              className="hidden"
            />

            <div className="flex-1 min-w-0 flex items-center rounded-lg border border-white/20 bg-white/5">
              <MentionTextarea
                value={replyText}
                onChange={setReplyText}
                communityId={post?.community_id}
                postId={post?.id}
                replyId={reply.id}
                placeholder={`Reply to @${reply.username}...`}
                className="bg-transparent px-3 py-2 text-[15px] text-white placeholder-white/40 outline-none resize-none max-h-24 min-h-[36px]"
                rows={1}
                autoExpand
                perfDegraded={!!uploadFile}
              />
            </div>

            {!recording && !replyText.trim() && (
              <button
                type="button"
                className="w-9 h-9 flex-none flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/15"
                onClick={() => startRec()}
                aria-label="Record audio"
              >
                <i className="fa-solid fa-microphone text-sm text-white/70" />
              </button>
            )}

            {recording && (
              <button
                type="button"
                className="w-9 h-9 flex-none flex items-center justify-center rounded-lg bg-[#4db6ac] text-white"
                onClick={async () => {
                  const p = await stopRec()
                  if (!p?.blob?.size) {
                    alert('Could not capture audio. Try recording for at least one second.')
                  }
                }}
                aria-label="Stop recording"
              >
                <i className="fa-solid fa-stop text-sm" />
              </button>
            )}

            {!recording && (replyText.trim() || file || replyPreview || selectedGif) && (
              <button
                type="button"
                onClick={handleSubmitReply}
                disabled={sendingReply}
                className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-[#4db6ac] text-white transition-opacity disabled:opacity-40"
              >
                <span className="inline-flex h-5 w-5 items-center justify-center" aria-hidden>
                  {sendingReply ? <i className="fa-solid fa-spinner fa-spin text-sm" /> : <i className="fa-solid fa-paper-plane text-sm" />}
                </span>
              </button>
            )}
          </div>
        </div>
        {/* Safe area spacer for iOS - only when keyboard is closed */}
        {!showKeyboard && (
          <div style={{ height: 'env(safe-area-inset-bottom, 0px)' }} />
        )}
      </div>

      {lightboxImageSrc ? (
        <div
          className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setLightboxImageSrc(null)}
        >
          <button
            type="button"
            className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white flex items-center justify-center z-10"
            onClick={() => setLightboxImageSrc(null)}
            aria-label="Close preview"
          >
            <i className="fa-solid fa-xmark" />
          </button>
          <div className="w-[94vw] h-[86vh] max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <ZoomableImage
              src={lightboxImageSrc}
              alt="Preview"
              className="w-full h-full"
              onRequestClose={() => setLightboxImageSrc(null)}
            />
          </div>
        </div>
      ) : null}

      {lightboxVideoSrc ? (
        <div
          className="fixed inset-0 z-[1000] bg-black/95 flex flex-col items-center justify-center p-4"
          onClick={() => setLightboxVideoSrc(null)}
        >
          <button
            type="button"
            className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white flex items-center justify-center z-10"
            onClick={() => setLightboxVideoSrc(null)}
            aria-label="Close video"
          >
            <i className="fa-solid fa-xmark" />
          </button>
          <video
            src={lightboxVideoSrc.includes('#') ? lightboxVideoSrc : `${lightboxVideoSrc}#t=0.1`}
            controls
            playsInline
            className="max-h-[88vh] max-w-full rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}

      {/* GIF Picker Modal */}
      <GifPicker
        isOpen={showGifPicker}
        onSelect={(gif) => {
          setSelectedGif(gif)
          setShowGifPicker(false)
          setFile(null)
          setUploadFile(null)
          setFilePreviewUrl(null)
          if (fileInputRef.current) fileInputRef.current.value = ''
        }}
        onClose={() => setShowGifPicker(false)}
      />

      {/* Reply Reactors/Viewers Modal */}
      {showReactorsModal && (
        <div
          className="fixed inset-0 z-[95] bg-black/70 backdrop-blur flex items-center justify-center"
          onClick={(e) => e.currentTarget === e.target && setShowReactorsModal(false)}
        >
          <div className="w-[92%] max-w-[560px] rounded-2xl border border-white/10 bg-black p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Views & Reactions</div>
              <button
                className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-sm text-white/80 hover:bg-white/10"
                onClick={() => setShowReactorsModal(false)}
                aria-label="Close"
              >
                <span className="leading-none">✕</span>
              </button>
            </div>
            {reactorsLoading ? (
              <div className="text-[#9fb0b5] text-sm py-4 text-center">Loading...</div>
            ) : (
              <div className="space-y-3 max-h-[420px] overflow-y-auto">
                <div className="rounded-lg border border-white/10 p-2">
                  <div className="flex items-center justify-between text-xs text-white/80 uppercase tracking-wide">
                    <span>Views</span>
                    <span className="text-sm font-semibold text-white">{reactorViewCount ?? 0}</span>
                  </div>
                  {reactorViewers.length === 0 ? (
                    <div className="mt-2 text-xs text-[#9fb0b5]">No views yet.</div>
                  ) : (
                    <div className="mt-2 flex flex-col gap-1">
                      {reactorViewers.map((viewer) => {
                        const viewedLabel = formatViewerRelative(viewer.viewed_at)
                        return (
                          <div key={`rv-${viewer.username}-${viewer.viewed_at ?? ''}`} className="flex items-center gap-2 text-xs text-[#9fb0b5]">
                            <Avatar username={viewer.username} url={viewer.profile_picture || undefined} size={18} linkToProfile />
                            <div className="flex-1 truncate">@{viewer.username}</div>
                            {viewedLabel && <div className="text-[10px] text-white/40">{viewedLabel}</div>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
                {reactorGroups.length === 0 ? (
                  <div className="text-sm text-[#9fb0b5]">No reactions yet.</div>
                ) : reactorGroups.map((group) => (
                  <div key={group.reaction_type} className="rounded-lg border border-white/10 p-2">
                    <div className="text-xs text-white/80 mb-1 capitalize">{group.reaction_type.replace('-', ' ')}</div>
                    <div className="flex flex-col gap-1">
                      {(group.users || []).map((u) => (
                        <div key={`${group.reaction_type}-${u.username}`} className="flex items-center gap-2 text-xs text-[#9fb0b5]">
                          <Avatar username={u.username} url={u.profile_picture || undefined} size={18} linkToProfile />
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
