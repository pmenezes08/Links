import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'
import ZoomableImage from '../components/ZoomableImage'
import { formatSmartTime, parseFlexibleDate } from '../utils/time'
import MentionTextarea from '../components/MentionTextarea'
import GifPicker from '../components/GifPicker'
import type { GifSelection } from '../components/GifPicker'
import { gifSelectionToFile } from '../utils/gif'
import { renderBoldText, renderRichText } from '../utils/linkUtils'
import { openExternalInApp } from '../utils/openExternalInApp'
import { useAudioRecorder } from '../components/useAudioRecorder'
import EditableAISummary from '../components/EditableAISummary'
import { isVideoAttachmentPath } from '../utils/replyMedia'
import { ENTITLEMENTS_REFRESH_EVENT, useEntitlements } from '../hooks/useEntitlements'
import { useEntitlementsHandler } from '../contexts/EntitlementsContext'
import { clearDeviceCache } from '../utils/deviceCache'
import {
  buildClientPremiumRequiredError,
  mentionsSteve,
  shouldClientBlockSteveIntent,
} from '../utils/steveClientGate'
import { preflightSteveMention } from '../utils/stevePreflight'
import { NativeActionButton } from '../components/NativeActionButton'
import { NativeIconButton } from '../components/NativeIconButton'
import { FixedComposerShell } from '../components/FixedComposerShell'
import { useFixedComposerKeyboard } from '../hooks/useFixedComposerKeyboard'
import { composerControlPointerProps } from '../utils/composerBlurGuard'
import { triggerHaptic, hapticImpactLight } from '../utils/haptics'
import { handleBasicProfileRequired } from '../utils/basicProfileGate'

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
  group_id?: number | null
  is_group_post?: boolean
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
  const { t } = useTranslation()
  const { reply_id } = useParams<{ reply_id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const isGroupThread = location.pathname.startsWith('/group_reply/')
  const threadPath = (id: number) => (isGroupThread ? `/group_reply/${id}` : `/reply/${id}`)
  const entitlementsHandler = useEntitlementsHandler()
  const { entitlements, enforcement_enabled, loading: entitlementsLoading } = useEntitlements()
  const blockSteveMentionReply = useCallback(
    (text: string, communityId?: number | string | null) => {
      if (!mentionsSteve(text)) return false
      if (
        !shouldClientBlockSteveIntent({
          enforcement_enabled,
          loading: entitlementsLoading,
          entitlements,
          isSteveDm: false,
          hasCommunityContext: communityId !== undefined && communityId !== null && communityId !== '',
          text,
        })
      ) {
        return false
      }
      entitlementsHandler.showError(buildClientPremiumRequiredError())
      return true
    },
    [enforcement_enabled, entitlementsLoading, entitlements, entitlementsHandler],
  )
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
  const { keyboardLift, showKeyboard, safeBottomPx } = useFixedComposerKeyboard({
    onLayoutNudge: () => {
      try {
        scrollAreaRef.current?.scrollBy({ top: 0, left: 0 })
      } catch {
        /* ignore */
      }
    },
  })

  // When the keyboard opens, shift the content up by the keyboard height so what
  // you're replying to stays visible above the composer instead of hiding behind
  // it (same fix as PostDetail; the composer lifts on its own).
  const prevKeyboardLiftRef = useRef(0)
  useEffect(() => {
    const prev = prevKeyboardLiftRef.current
    prevKeyboardLiftRef.current = keyboardLift
    const delta = keyboardLift - prev
    if (delta <= 0) return
    const el = scrollAreaRef.current
    if (!el) return
    const raf = requestAnimationFrame(() => {
      try { el.scrollBy({ top: delta, left: 0, behavior: 'auto' }) } catch { /* ignore */ }
    })
    return () => cancelAnimationFrame(raf)
  }, [keyboardLift])
  const [replyComposerExpanded, setReplyComposerExpanded] = useState(false)
  const [expandedComposerViewportLift, setExpandedComposerViewportLift] = useState(0)
  const expandedComposerRef = useRef<HTMLDivElement | null>(null)

  // Check if message contains @Steve mention (case insensitive) - same as CommunityFeed
  const containsSteveMention = (text: string) => {
    const result = /@steve\b/i.test(text)
    console.log('[Steve AI] Checking for @Steve in:', text, '-> Found:', result)
    return result
  }

  const openExpandedReplyComposer = () => {
    try {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
    } catch {
      /* noop */
    }
    setShowAttachMenu(false)
    setReplyComposerExpanded(true)
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
    if (blockSteveMentionReply(userMessage, post?.community_id)) return
    
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
          community_id: post?.community_id ? Number(post.community_id) : null,
          is_group_post: isGroupThread,
        })
      })
      
      const data = await entitlementsHandler.handleResponse<{ success?: boolean; reply?: Reply; error?: string }>(
        response,
      )
      if (!data) return
      console.log('[Steve AI] API response:', data)

      if (data.success && data.reply) {
        const steveReply = data.reply
        console.log('[Steve AI] Success! Adding Steve reply')
        setReply((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            nested_replies: [...(prev.nested_replies || []), steveReply],
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
      const url = isGroupThread ? `/api/group_reply/${reply_id}` : `/api/reply/${reply_id}`
      const res = await fetch(url, { credentials: 'include', headers: { 'Accept': 'application/json' } })
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
  }, [reply_id, isGroupThread])

  useEffect(() => {
    fetchReply()
  }, [fetchReply])

  useEffect(() => {
    viewRecordedRef.current = false
  }, [reply_id, isGroupThread])

  // Record reply view
  useEffect(() => {
    if (!reply_id || viewRecordedRef.current) return
    viewRecordedRef.current = true
    const viewUrl = isGroupThread ? '/api/group_reply_view' : '/api/reply_view'
    fetch(viewUrl, {
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
  }, [reply_id, isGroupThread])

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

  useEffect(() => {
    if (!replyComposerExpanded) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setReplyComposerExpanded(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    const focusTimer = window.setTimeout(() => {
      const textarea = expandedComposerRef.current?.querySelector('textarea')
      textarea?.focus()
    }, 80)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.clearTimeout(focusTimer)
    }
  }, [replyComposerExpanded])

  useEffect(() => {
    if (!replyComposerExpanded || typeof window === 'undefined') {
      setExpandedComposerViewportLift(0)
      return
    }
    const viewport = window.visualViewport
    if (!viewport) return
    let rafId: number | null = null
    const updateLift = () => {
      const next = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      setExpandedComposerViewportLift(prev => (Math.abs(prev - next) < 1 ? prev : next))
    }
    const schedule = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updateLift)
    }
    viewport.addEventListener('resize', schedule)
    viewport.addEventListener('scroll', schedule)
    updateLift()
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', schedule)
      viewport.removeEventListener('scroll', schedule)
      setExpandedComposerViewportLift(0)
    }
  }, [replyComposerExpanded])

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
    if (sendingReply) return
    const messageText = replyText.trim()
    if (blockSteveMentionReply(messageText, post?.community_id)) return

    void triggerHaptic('light')
    setSendingReply(true)

    const preflight = await preflightSteveMention({
      text: messageText,
      communityId: post?.community_id,
      postId: post.id,
      entitlementsHandler,
    })
    if (!preflight.ok) {
      if (preflight.error) alert(preflight.error)
      setSendingReply(false)
      return
    }

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
        alert(t('feed.media_attach_failed'))
        return
      }

      if (replyPreview?.blob) {
        fd.append('audio', replyPreview.blob, (replyPreview.blob.type.includes('mp4') ? 'audio.mp4' : 'audio.webm'))
        const durSec = (replyPreview as { duration?: number }).duration ?? (recordMs / 1000)
        if (durSec > 0) fd.append('voice_duration_seconds', String(durSec))
      }

      const submitUrl = isGroupThread ? '/api/group_replies' : '/post_reply'
      if (isGroupThread) {
        fd.delete('post_id')
        fd.append('group_post_id', String(post.id))
      }
      const res = await fetch(submitUrl, { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()

      if (handleBasicProfileRequired(data)) {
        return
      }

      if (data.success && data.reply) {
        const raw = data.reply as Reply & { children?: Reply[] }
        const normalized: Reply = {
          ...raw,
          nested_replies: raw.nested_replies ?? raw.children ?? [],
        }
        setReply((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            nested_replies: [...(prev.nested_replies || []), normalized],
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
        setReplyComposerExpanded(false)
        replyTokenRef.current = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      } else {
        alert(data.error || t('feed.post_reply_failed'))
      }
    } catch (err) {
      console.error('Failed to submit reply:', err)
      alert(t('feed.post_reply_failed'))
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
      const r = await fetch(
        isGroupThread ? `/api/group_reply_reactors/${replyId}` : `/get_reply_reactors/${replyId}`,
        { credentials: 'include' },
      )
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
      const endpoint = isGroupThread ? '/api/group_replies/react' : '/add_reply_reaction'
      const res = await fetch(endpoint, { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      if (handleBasicProfileRequired(data)) return
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
    if (!confirm(t('feed.delete_reply_confirm'))) return
    try {
      const fd = new FormData()
      fd.append('reply_id', String(targetReplyId))
      const endpoint = isGroupThread ? '/api/group_replies/delete' : '/delete_reply'
      const res = await fetch(endpoint, { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      if (data.success) {
        // Invalidate caches so PostDetail and feeds don't resurrect the deleted reply
        try {
          if (post?.id) clearDeviceCache(`post-${post.id}`)
          if (post?.community_id != null) {
            clearDeviceCache(`community-feed:${post.community_id}`)
          }
          if (post?.group_id != null) {
            clearDeviceCache(`group-feed:${post.group_id}`)
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
      const res = await fetch(
        isGroupThread ? '/api/group_replies/edit' : '/edit_reply',
        { method: 'POST', credentials: 'include', body: fd },
      )
      const data = await res.json()
      if (data.success) {
        setReply((prev) => prev ? { ...prev, content: editMainText } : prev)
        setIsEditingMain(false)
      } else {
        alert(data.error || t('feed.edit_failed'))
      }
    } catch (err) {
      console.error('Failed to edit reply:', err)
      alert(t('feed.edit_reply_failed'))
    }
  }

  // Edit nested reply
  const handleEditNested = async (nestedId: number) => {
    try {
      const fd = new FormData()
      fd.append('reply_id', String(nestedId))
      fd.append('content', editNestedText)
      const res = await fetch(
        isGroupThread ? '/api/group_replies/edit' : '/edit_reply',
        { method: 'POST', credentials: 'include', body: fd },
      )
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
        alert(data.error || t('feed.edit_failed'))
      }
    } catch (err) {
      console.error('Failed to edit reply:', err)
      alert(t('feed.edit_reply_failed'))
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-c-bg-app text-c-text-primary flex items-center justify-center">
        <i className="fa-solid fa-spinner fa-spin text-2xl text-cpoint-turquoise" />
      </div>
    )
  }

  if (!reply) {
    return (
      <div className="min-h-screen bg-c-bg-app text-c-text-primary flex flex-col items-center justify-center gap-4">
        <p className="text-c-text-tertiary">{t('feed.reply_not_found')}</p>
        <button
          onClick={() => {
            // Simple approach: always go to the post (PostDetail will handle community context)
            if (post) {
              navigate(`/post/${post.id}`)
            } else {
              navigate(-1)
            }
          }}
          className="px-4 py-2 rounded-lg bg-cpoint-turquoise text-black font-medium"
        >
          {t('navigation.back')}
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
  
  const expandedComposerLift = Math.max(keyboardLift, expandedComposerViewportLift)
  const expandedComposerKeyboardOpen = expandedComposerLift > 2

  return (
    <div
      className="min-h-screen bg-c-bg-app text-c-text-primary flex flex-col"
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
        className="flex-shrink-0 border-b border-c-border z-50 bg-c-header-bg"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        <div className="h-14 flex items-center gap-2 px-3">
          <button
            className="p-2 rounded-full hover:bg-c-hover-bg transition-colors"
            onClick={() => {
              hapticImpactLight()
              // Simple approach: always go to the post. PostDetail will handle
              // smart context detection to decide whether to go to community feed
              if (post) {
                navigate(`/post/${post.id}`)
              } else {
                navigate(-1)
              }
            }}
            aria-label={t('navigation.back')}
          >
            <i className="fa-solid fa-arrow-left text-c-text-primary text-lg" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="font-semibold tracking-[-0.01em] text-sm text-c-text-primary">{t('feed.thread')}</div>
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
              className="px-4 py-4 border-b border-c-border cursor-pointer hover:bg-white/[0.02]"
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
                    <span className="text-xs text-c-text-tertiary">{formatSmartTime(post.timestamp)}</span>
                  </div>
                  <div className="mt-1 text-[14px] text-c-text-secondary line-clamp-3">
                    {renderRichText(post.content, false, (u) => navigate(`/profile/${encodeURIComponent(u)}`), openArticleReader)}
                  </div>
                  {post.image_path && !isVideoAttachmentPath(post.image_path) && (
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                      <ImageLoader
                        src={replyDisplayUrl(post.image_path)}
                        alt={t('feed.post_image_alt')}
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
              className="px-4 py-3 border-b border-c-border cursor-pointer hover:bg-white/[0.02]"
              onClick={() => navigate(threadPath(parent.id))}
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
                    <span className="text-xs text-c-text-tertiary">{formatSmartTime(parent.timestamp)}</span>
                  </div>
                  <div className="mt-1 text-[13px] text-c-text-tertiary line-clamp-2">
                    {renderRichText(parent.content, false, (u) => navigate(`/profile/${encodeURIComponent(u)}`), openArticleReader)}
                  </div>
                  {parent.image_path && !isVideoAttachmentPath(parent.image_path) && (
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                      <ImageLoader
                        src={replyDisplayUrl(parent.image_path)}
                        alt={t('feed.reply_image_alt')}
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
                        <p className="text-[12px] text-c-text-secondary italic line-clamp-4">{renderBoldText(parent.audio_summary)}</p>
                      ) : (() => {
                        const timestampMs = parseFlexibleDate(parent.timestamp)?.getTime()
                        if (timestampMs != null && !Number.isNaN(timestampMs) && Date.now() - timestampMs < 120000) {
                          return (
                            <div className="flex items-center gap-1">
                              <i className="fa-solid fa-wand-magic-sparkles text-[9px] text-c-text-tertiary" />
                              <span className="text-[11px] text-c-text-tertiary">{t('feed.steve_summary_generating')}</span>
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
          <div ref={mainReplyRef} className="px-4 py-4 border-b border-c-border bg-white/[0.02]">
            <div className="flex gap-3">
              <Avatar username={reply.username} url={reply.profile_picture || undefined} size={44} linkToProfile />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{reply.username}</span>
                  <span className="text-sm text-c-text-tertiary">{formatSmartTime(reply.timestamp)}</span>
                  {/* Edit/Delete buttons for main reply - show for author or admin */}
                  {(currentUser === reply.username || currentUser === 'admin') ? (
                    <>
                      <button
                        className="ml-2 px-2 py-1 rounded-full text-[#6c757d] hover:text-cpoint-turquoise"
                        title={t('feed.edit_reply')}
                        onClick={() => {
                          setEditMainText(reply.content)
                          setIsEditingMain(true)
                        }}
                      >
                        <i className="fa-regular fa-pen-to-square" />
                      </button>
                      <button
                        className="ml-1 px-2 py-1 rounded-full text-[#6c757d] hover:text-red-400"
                        title={t('feed.delete_reply')}
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
                      <div className="mt-2 text-[15px] whitespace-pre-wrap break-words text-c-text-primary">
                        {renderRichText(reply.content, false, (u) => navigate(`/profile/${encodeURIComponent(u)}`), openArticleReader)}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="mt-2">
                    <textarea
                      className="w-full resize-none max-h-60 min-h-[100px] px-3 py-2 rounded-md bg-c-bg-app border border-cpoint-turquoise text-[14px] focus:outline-none focus:ring-1 focus:ring-cpoint-turquoise"
                      value={editMainText}
                      onChange={(e) => setEditMainText(e.target.value)}
                      autoFocus
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        className="px-3 py-1.5 rounded-md bg-cpoint-turquoise text-black text-sm font-medium"
                        onClick={handleEditMain}
                      >
                        {t('common.save')}
                      </button>
                      <button
                        className="px-3 py-1.5 rounded-md border border-c-border text-sm"
                        onClick={() => {
                          setIsEditingMain(false)
                          setEditMainText(reply.content)
                        }}
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                )}

                {/* Reply image or video */}
                {reply.image_path && !isVideoAttachmentPath(reply.image_path) && !isEditingMain && (
                  <div className="mt-3">
                    <ImageLoader
                      src={replyDisplayUrl(reply.image_path)}
                      alt={t('feed.reply_image_alt')}
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
                        className="text-sm text-cpoint-turquoise hover:underline"
                        onClick={() =>
                          setLightboxVideoSrc(
                            replyDisplayUrl((reply.video_path || reply.image_path) as string)
                          )
                        }
                      >
                        {t('feed.open_full_screen')}
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
                      const timestampMs = parseFlexibleDate(reply.timestamp)?.getTime()
                      if (timestampMs != null && !Number.isNaN(timestampMs) && Date.now() - timestampMs < 120000) {
                        return (
                          <div className="flex items-center gap-1">
                            <i className="fa-solid fa-wand-magic-sparkles text-[9px] text-c-text-tertiary" />
                            <span className="text-[11px] text-c-text-tertiary">{t('feed.steve_summary_generating')}</span>
                            <span className="flex gap-0.5 ml-0.5">
                              <span className="w-1 h-1 bg-cpoint-turquoise rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                              <span className="w-1 h-1 bg-cpoint-turquoise rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                              <span className="w-1 h-1 bg-cpoint-turquoise rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
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
                      className={`flex items-center gap-1 text-sm transition ${isHeartActive ? 'text-red-400' : 'text-c-text-tertiary hover:text-red-400'}`}
                    >
                      <i className={`${isHeartActive ? 'fa-solid' : 'fa-regular'} fa-heart`} />
                      {heartCount > 0 && <span>{heartCount}</span>}
                    </button>
                    <button
                      onClick={() => handleReaction(reply.id, 'thumbs-up')}
                      className={`flex items-center gap-1 text-sm transition ${isThumbsUpActive ? 'text-cpoint-turquoise' : 'text-c-text-tertiary hover:text-cpoint-turquoise'}`}
                    >
                      <i className={`${isThumbsUpActive ? 'fa-solid' : 'fa-regular'} fa-thumbs-up`} />
                      {thumbsUpCount > 0 && <span>{thumbsUpCount}</span>}
                    </button>
                    <button
                      onClick={() => handleReaction(reply.id, 'thumbs-down')}
                      className={`flex items-center gap-1 text-sm transition ${isThumbsDownActive ? 'text-orange-400' : 'text-c-text-tertiary hover:text-orange-400'}`}
                    >
                      <i className={`${isThumbsDownActive ? 'fa-solid' : 'fa-regular'} fa-thumbs-down`} />
                      {thumbsDownCount > 0 && <span>{thumbsDownCount}</span>}
                    </button>
                    <button
                      className="flex items-center gap-1 text-sm text-c-text-tertiary hover:text-c-text-primary transition"
                      onClick={() => openReplyReactorsModal(reply.id)}
                      title={t('feed.view_reactions_viewers')}
                    >
                      <i className="fa-regular fa-eye" />
                      <span>{typeof reply.view_count === 'number' ? reply.view_count : 0}</span>
                    </button>
                    <span className="flex items-center gap-1.5 text-sm text-c-text-tertiary">
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
                    onClick={() => !isEditingThis && navigate(threadPath(nr.id))}
                  >
                    <div className="flex gap-3">
                      <div onClick={(e) => e.stopPropagation()}>
                        <Avatar username={nr.username} url={nr.profile_picture || undefined} size={36} linkToProfile />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{nr.username}</span>
                          <span className="text-xs text-c-text-tertiary">{formatSmartTime(nr.timestamp)}</span>
                          {/* Edit/Delete buttons for nested reply - show for author or admin */}
                          {(currentUser === nr.username || currentUser === 'admin') ? (
                            <div onClick={(e) => e.stopPropagation()}>
                              <button
                                className="ml-2 px-2 py-1 rounded-full text-[#6c757d] hover:text-cpoint-turquoise"
                                title={t('feed.edit_reply')}
                                onClick={() => {
                                  setEditNestedText(nr.content)
                                  setEditingNestedId(nr.id)
                                }}
                              >
                                <i className="fa-regular fa-pen-to-square" />
                              </button>
                              <button
                                className="ml-1 px-2 py-1 rounded-full text-[#6c757d] hover:text-red-400"
                                title={t('feed.delete_reply')}
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
                              <div className="mt-1 text-[14px] whitespace-pre-wrap break-words text-c-text-secondary">
                                {renderRichText(nr.content, false, (u) => navigate(`/profile/${encodeURIComponent(u)}`), openArticleReader)}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                            <textarea
                              className="w-full resize-none max-h-40 min-h-[80px] px-3 py-2 rounded-md bg-c-bg-app border border-cpoint-turquoise text-[13px] focus:outline-none focus:ring-1 focus:ring-cpoint-turquoise"
                              value={editNestedText}
                              onChange={(e) => setEditNestedText(e.target.value)}
                              autoFocus
                            />
                            <div className="mt-2 flex gap-2">
                              <button
                                className="px-3 py-1 rounded-md bg-cpoint-turquoise text-black text-xs font-medium"
                                onClick={() => handleEditNested(nr.id)}
                              >
                                {t('common.save')}
                              </button>
                              <button
                                className="px-3 py-1 rounded-md border border-c-border text-xs"
                                onClick={() => {
                                  setEditingNestedId(null)
                                  setEditNestedText('')
                                }}
                              >
                                {t('common.cancel')}
                              </button>
                            </div>
                          </div>
                        )}

                        {nr.image_path && !isVideoAttachmentPath(nr.image_path) && !isEditingThis && (
                          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                            <ImageLoader
                              src={replyDisplayUrl(nr.image_path)}
                              alt={t('feed.reply_image_alt')}
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
                                className="text-xs text-cpoint-turquoise hover:underline"
                                onClick={() =>
                                  setLightboxVideoSrc(
                                    replyDisplayUrl((nr.video_path || nr.image_path) as string)
                                  )
                                }
                              >
                                {t('feed.open_full_screen')}
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
                              const timestampMs = parseFlexibleDate(nr.timestamp)?.getTime()
                              if (timestampMs != null && !Number.isNaN(timestampMs) && Date.now() - timestampMs < 120000) {
                                return (
                                  <div className="flex items-center gap-1 text-[11px] text-c-text-tertiary">
                                    <i className="fa-solid fa-wand-magic-sparkles text-[9px]" />
                                    {t('feed.steve_summary_generating')}
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
                              className={`flex items-center gap-1 text-xs transition ${nrIsHeartActive ? 'text-red-400' : 'text-c-text-tertiary hover:text-red-400'}`}
                            >
                              <i className={`${nrIsHeartActive ? 'fa-solid' : 'fa-regular'} fa-heart`} />
                              {nrHeartCount > 0 && <span>{nrHeartCount}</span>}
                            </button>
                            <button
                              onClick={() => handleReaction(nr.id, 'thumbs-up')}
                              className={`flex items-center gap-1 text-xs transition ${nrIsThumbsUpActive ? 'text-cpoint-turquoise' : 'text-c-text-tertiary hover:text-cpoint-turquoise'}`}
                            >
                              <i className={`${nrIsThumbsUpActive ? 'fa-solid' : 'fa-regular'} fa-thumbs-up`} />
                              {nrThumbsUpCount > 0 && <span>{nrThumbsUpCount}</span>}
                            </button>
                            <button
                              onClick={() => handleReaction(nr.id, 'thumbs-down')}
                              className={`flex items-center gap-1 text-xs transition ${nrIsThumbsDownActive ? 'text-orange-400' : 'text-c-text-tertiary hover:text-orange-400'}`}
                            >
                              <i className={`${nrIsThumbsDownActive ? 'fa-solid' : 'fa-regular'} fa-thumbs-down`} />
                              {nrThumbsDownCount > 0 && <span>{nrThumbsDownCount}</span>}
                            </button>
                            <button
                              className="flex items-center gap-1 text-xs text-c-text-tertiary hover:text-c-text-primary transition"
                              onClick={() => openReplyReactorsModal(nr.id)}
                              title={t('feed.view_reactions_viewers')}
                            >
                              <i className="fa-regular fa-eye" />
                              <span>{typeof nr.view_count === 'number' ? nr.view_count : 0}</span>
                            </button>
                            <span className="flex items-center gap-1 text-xs text-c-text-tertiary">
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
            <div className="px-4 py-3 border-t border-c-border flex items-center gap-2 text-xs text-c-text-tertiary">
              <span className="font-medium text-cpoint-turquoise">Steve</span>
              <span>{t('feed.is_typing')}</span>
              <span className="inline-flex gap-0.5">
                <span className="w-1 h-1 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          )}

          {/* Empty state */}
          {(!reply.nested_replies || reply.nested_replies.length === 0) && !steveIsTyping && (
            <div className="px-4 py-16 text-center text-c-text-tertiary">
              <i className="fa-regular fa-comments text-3xl mb-3 block" />
              <p className="text-sm">{t('feed.no_replies_yet')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Fixed bottom reply composer — hidden while the GIF picker is open
          so the glass sheet does not show the composer chrome through it. */}
      {!showGifPicker && (
      <FixedComposerShell
        keyboardLift={keyboardLift}
        safeBottomPx={safeBottomPx}
        className="fixed left-0 right-0 z-[100] bg-c-bg-app border-t border-c-border"
      >
        <div className="max-w-2xl mx-auto px-3 py-2 w-full">
          {(file || selectedGif || replyPreview) && (
            <div className="mb-2 flex items-center gap-2 flex-wrap">
              {file && filePreviewUrl && (
                <div className="flex items-center gap-2">
                  <div className="w-12 h-12 rounded-md overflow-hidden border border-c-border">
                    {typeof file.type === 'string' && file.type.startsWith('video/') ? (
                      <video src={filePreviewUrl} className="w-full h-full object-cover" muted playsInline />
                    ) : (
                      <img src={filePreviewUrl} alt={t('feed.preview_alt', { number: '' })} className="w-full h-full object-cover" />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setFile(null); setUploadFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                    className="text-red-400 hover:text-red-300"
                    aria-label={t('feed.remove_file')}
                  >
                    <i className="fa-solid fa-times" />
                  </button>
                </div>
              )}
              {selectedGif && (
                <div className="flex items-center gap-2">
                  <div className="w-12 h-12 rounded-md overflow-hidden border border-c-border">
                    <img src={selectedGif.previewUrl} alt={t('feed.selected_gif_alt')} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                  <button type="button" onClick={() => setSelectedGif(null)} className="text-red-400 hover:text-red-300" aria-label={t('feed.remove_gif')}>
                    <i className="fa-solid fa-times" />
                  </button>
                </div>
              )}
              {replyPreview && (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <audio controls className="flex-1 h-8" playsInline webkit-playsinline="true" src={replyPreview.url} />
                  <button type="button" onClick={() => clearReplyPreview()} className="text-c-text-tertiary hover:text-c-text-primary" aria-label={t('feed.remove_audio')}>
                    <i className="fa-regular fa-trash-can" />
                  </button>
                </div>
              )}
            </div>
          )}

          {recording && (
            <div className="mb-2 flex items-center gap-3 px-1">
              <span className="inline-block w-2 h-2 bg-cpoint-turquoise rounded-full animate-pulse" />
              <div className="flex-1 h-2 bg-c-active-bg rounded overflow-hidden">
                <div className="h-full bg-c-accent-ink transition-all" style={{ width: `${Math.max(6, Math.min(96, (level || 0) * 100))}%` }} />
              </div>
              <div className="text-xs text-c-text-secondary">{Math.min(60, Math.round((recordMs || 0) / 1000))}s</div>
            </div>
          )}

          <div className="flex min-w-0 items-center gap-2">
            <div className="relative">
              <NativeIconButton
                preventBlur
                size="md"
                variant="muted"
                className="rounded-lg"
                aria-label={t('feed.add_attachment')}
                onClick={() => setShowAttachMenu(!showAttachMenu)}
              >
                <i className={`fa-solid ${showAttachMenu ? 'fa-times' : 'fa-plus'} text-sm ${(file || selectedGif) ? 'text-c-accent-ink' : 'text-c-text-primary'}`} />
              </NativeIconButton>
              {showAttachMenu && (
                <div className="absolute bottom-full left-0 mb-2 w-40 rounded-xl bg-c-bg-surface border border-c-border shadow-xl overflow-hidden z-10">
                  <button
                    type="button"
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-c-hover-bg transition-colors text-left"
                    onClick={() => {
                      fileInputRef.current?.click()
                      setShowAttachMenu(false)
                    }}
                  >
                    <i className="fa-solid fa-image text-cpoint-turquoise" />
                    <span className="text-sm text-c-text-primary">{t('feed.photo_video')}</span>
                  </button>
                  <button
                    type="button"
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-c-hover-bg transition-colors text-left border-t border-c-border"
                    onClick={() => {
                      setShowGifPicker(true)
                      setShowAttachMenu(false)
                    }}
                  >
                    <i className="fa-solid fa-images text-cpoint-turquoise" />
                    <span className="text-sm text-c-text-primary">GIF</span>
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

            <div className="flex-1 min-w-0 flex min-h-9 items-center rounded-lg border border-cpoint-turquoise bg-c-composer-input-bg">
              <MentionTextarea
                value={replyText}
                onChange={setReplyText}
                communityId={post?.community_id}
                postId={post?.id}
                replyId={reply.id}
                placeholder={t('feed.write_reply_placeholder')}
                className="w-full bg-transparent px-3 py-1 text-[15px] leading-5 text-c-text-primary placeholder:text-c-text-tertiary outline-none resize-none max-h-24 min-h-0"
                rows={1}
                autoExpand
                perfDegraded={!!uploadFile}
              />
            </div>

            <NativeIconButton
              preventBlur
              size="md"
              variant="muted"
              className="rounded-lg"
              aria-label={t('feed.expand_reply_composer')}
              title={t('feed.expand_reply_composer')}
              onClick={openExpandedReplyComposer}
            >
              <i className="fa-solid fa-up-right-and-down-left-from-center text-xs text-c-text-secondary" />
            </NativeIconButton>

            {!recording && !replyText.trim() && (
              <NativeIconButton
                preventBlur
                size="md"
                variant="muted"
                className="rounded-lg"
                aria-label={t('feed.record_audio')}
                onClick={() => startRec()}
              >
                <i className="fa-solid fa-microphone text-sm text-c-text-secondary" />
              </NativeIconButton>
            )}

            {recording && (
              <NativeIconButton
                preventBlur
                size="md"
                className="rounded-lg bg-cpoint-turquoise text-c-text-primary"
                aria-label={t('feed.stop_recording')}
                onClick={async () => {
                  const p = await stopRec()
                  if (!p?.blob?.size) {
                    alert(t('feed.audio_capture_minimum_short'))
                  }
                }}
              >
                <i className="fa-solid fa-stop text-sm" />
              </NativeIconButton>
            )}

            {!recording && (replyText.trim() || file || replyPreview || selectedGif) && (
              <NativeActionButton
                variant="composer"
                haptic="light"
                className="h-9 w-9 flex-none rounded-lg"
                {...composerControlPointerProps}
                onClick={handleSubmitReply}
                disabled={sendingReply}
                aria-label={t('feed.send_reply')}
              >
                {sendingReply ? (
                  <i className="fa-solid fa-spinner fa-spin text-sm pointer-events-none" />
                ) : (
                  <i className="fa-solid fa-paper-plane text-sm pointer-events-none" />
                )}
              </NativeActionButton>
            )}
          </div>
        </div>
      </FixedComposerShell>
      )}

      {replyComposerExpanded && reply && post && (
        <div
          className="fixed inset-0 z-[300] bg-black/90 backdrop-blur"
          role="dialog"
          aria-modal="true"
          aria-labelledby="expanded-nested-reply-composer-title"
          onClick={(e) => e.currentTarget === e.target && setReplyComposerExpanded(false)}
        >
          <div
            ref={expandedComposerRef}
            className="absolute left-0 right-0 mx-auto flex max-w-2xl flex-col overflow-hidden bg-c-bg-app text-c-text-primary sm:rounded-3xl sm:bg-c-bg-elevated/95"
            style={{
              top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
              bottom: expandedComposerKeyboardOpen
                ? `${Math.max(8, expandedComposerLift + 8)}px`
                : 'max(env(safe-area-inset-bottom, 0px), 12px)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 px-5 pb-4 pt-2">
              <div className="min-w-0">
                <h2 id="expanded-nested-reply-composer-title" className="text-base font-semibold">
                  {t('feed.write_reply_modal_title')}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-c-text-tertiary line-clamp-2">
                  {t('feed.write_reply_modal_hint')}
                </p>
              </div>
              <button
                type="button"
                className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-c-active-bg text-c-text-primary transition hover:bg-white/20"
                onClick={() => setReplyComposerExpanded(false)}
                aria-label={t('feed.close_reply_composer')}
              >
                <i className="fa-solid fa-xmark text-sm" />
              </button>
            </header>

            {(file || selectedGif || replyPreview) && (
              <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
                {file && (
                  <div className="flex items-center gap-2 rounded-2xl bg-white/[0.06] px-2 py-2">
                    <div className="h-12 w-12 overflow-hidden rounded-md border border-c-border">
                      {filePreviewUrl ? (
                        typeof file.type === 'string' && file.type.startsWith('video/') ? (
                          <video src={filePreviewUrl} className="h-full w-full object-cover" muted playsInline />
                        ) : (
                          <img src={filePreviewUrl} alt={t('feed.preview_alt', { number: '' })} className="h-full w-full object-cover" />
                        )
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-c-text-tertiary">
                          <i className="fa-solid fa-file" />
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="text-red-400 hover:text-red-300"
                      onClick={() => {
                        setFile(null)
                        setUploadFile(null)
                        setFilePreviewUrl(null)
                        if (fileInputRef.current) fileInputRef.current.value = ''
                      }}
                      aria-label={t('feed.remove_file')}
                    >
                      <i className="fa-solid fa-times" />
                    </button>
                  </div>
                )}
                {selectedGif && (
                  <div className="flex items-center gap-2 rounded-2xl bg-white/[0.06] px-2 py-2">
                    <div className="h-12 w-12 overflow-hidden rounded-md border border-c-border">
                      <img src={selectedGif.previewUrl} alt={t('feed.selected_gif_alt')} className="h-full w-full object-cover" loading="lazy" />
                    </div>
                    <button
                      type="button"
                      className="text-red-400 hover:text-red-300"
                      onClick={() => setSelectedGif(null)}
                      aria-label={t('feed.remove_gif')}
                    >
                      <i className="fa-solid fa-times" />
                    </button>
                  </div>
                )}
                {replyPreview && (
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl bg-white/[0.06] px-2 py-2">
                    <audio controls className="h-8 flex-1" playsInline webkit-playsinline="true" src={replyPreview.url} />
                    <button
                      type="button"
                      className="text-c-text-tertiary hover:text-c-text-primary"
                      onClick={() => clearReplyPreview()}
                      aria-label={t('feed.remove_audio')}
                    >
                      <i className="fa-regular fa-trash-can" />
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex min-h-0 flex-1 px-5 pb-3">
              <div className="flex min-h-0 flex-1 rounded-2xl border border-c-border bg-white/[0.035] transition-colors focus-within:border-cpoint-turquoise/60">
                <MentionTextarea
                  value={replyText}
                  onChange={setReplyText}
                  communityId={post.community_id}
                  postId={post.id}
                  replyId={reply.id}
                  placeholder={t('feed.reply_to_user_ellipsis', { username: reply.username })}
                  className="h-full min-h-0 resize-none overflow-y-auto bg-transparent px-4 py-4 text-[16px] leading-relaxed text-c-text-primary outline-none placeholder:text-c-text-tertiary"
                  rows={10}
                  perfDegraded={!!uploadFile}
                />
              </div>
            </div>

            <footer className="flex items-center justify-between gap-3 px-5 pb-2 pt-1">
              <button
                type="button"
                className="rounded-full px-2 py-2 text-sm font-medium text-c-text-tertiary transition hover:text-c-text-primary"
                onClick={() => setReplyComposerExpanded(false)}
              >
                {t('common.cancel')}
              </button>
              <NativeActionButton
                variant="composer"
                className="h-10 w-10 rounded-full shadow-[0_10px_28px_rgba(0,206,200,0.22)]"
                onClick={handleSubmitReply}
                aria-label={t('feed.send_reply')}
                disabled={sendingReply || (!replyText.trim() && !file && !replyPreview && !selectedGif)}
              >
                {sendingReply ? (
                  <i className="fa-solid fa-spinner fa-spin text-sm pointer-events-none" />
                ) : (
                  <i className="fa-solid fa-paper-plane text-sm pointer-events-none" />
                )}
              </NativeActionButton>
            </footer>
          </div>
        </div>
      )}

      {lightboxImageSrc ? (
        <div
          className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setLightboxImageSrc(null)}
        >
          <button
            type="button"
            className="absolute top-3 right-3 w-10 h-10 rounded-full bg-c-active-bg hover:bg-c-hover-bg border border-c-border text-c-text-primary flex items-center justify-center z-10"
            onClick={() => setLightboxImageSrc(null)}
            aria-label={t('feed.close_preview')}
          >
            <i className="fa-solid fa-xmark" />
          </button>
          <div className="w-[94vw] h-[86vh] max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <ZoomableImage
              src={lightboxImageSrc}
              alt={t('feed.preview_alt', { number: '' })}
              className="w-full h-full"
              onRequestClose={() => setLightboxImageSrc(null)}
            />
          </div>
        </div>
      ) : null}

      {lightboxVideoSrc
        ? createPortal(
            // Portaled to body so it escapes the page's fixed-root stacking context
            // and covers the body-portaled composer (which would otherwise bleed
            // over a fullscreen video). Close lives in its own top bar — outside the
            // video bounds — so iOS native video controls can never obscure it.
            <div
              className="fixed inset-0 z-[1100] flex flex-col bg-black/95"
              style={{
                paddingTop: 'max(env(safe-area-inset-top), 12px)',
                paddingBottom: 'max(env(safe-area-inset-bottom), 12px)',
              }}
              onClick={() => setLightboxVideoSrc(null)}
            >
              <div className="flex shrink-0 items-center justify-end px-3 pb-2">
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/40 bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
                  onClick={() => setLightboxVideoSrc(null)}
                  aria-label={t('feed.close_video')}
                >
                  <i className="fa-solid fa-xmark text-base" />
                </button>
              </div>
              <div
                className="flex min-h-0 flex-1 items-center justify-center px-4 pb-4"
                onClick={() => setLightboxVideoSrc(null)}
              >
                <video
                  src={lightboxVideoSrc.includes('#') ? lightboxVideoSrc : `${lightboxVideoSrc}#t=0.1`}
                  controls
                  playsInline
                  className="max-h-full max-w-full rounded-lg"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>,
            document.body,
          )
        : null}

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
          <div className="w-[92%] max-w-[560px] rounded-2xl border border-c-border bg-c-bg-app p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">{t('feed.views_reactions')}</div>
              <button
                className="w-8 h-8 rounded-full border border-c-border flex items-center justify-center text-sm text-c-text-secondary hover:bg-c-hover-bg"
                onClick={() => setShowReactorsModal(false)}
                aria-label={t('common.close')}
              >
                <span className="leading-none">✕</span>
              </button>
            </div>
            {reactorsLoading ? (
              <div className="text-c-text-tertiary text-sm py-4 text-center">{t('common.loading')}</div>
            ) : (
              <div className="space-y-3 max-h-[420px] overflow-y-auto">
                <div className="rounded-lg border border-c-border p-2">
                  <div className="flex items-center justify-between text-xs text-c-text-secondary uppercase tracking-wide">
                    <span>{t('feed.views')}</span>
                    <span className="text-sm font-semibold text-c-text-primary">{reactorViewCount ?? 0}</span>
                  </div>
                  {reactorViewers.length === 0 ? (
                    <div className="mt-2 text-xs text-c-text-tertiary">{t('feed.no_views_yet')}</div>
                  ) : (
                    <div className="mt-2 flex flex-col gap-1">
                      {reactorViewers.map((viewer) => {
                        const viewedLabel = formatViewerRelative(viewer.viewed_at)
                        return (
                          <div key={`rv-${viewer.username}-${viewer.viewed_at ?? ''}`} className="flex items-center gap-2 text-xs text-c-text-tertiary">
                            <Avatar username={viewer.username} url={viewer.profile_picture || undefined} size={18} linkToProfile />
                            <div className="flex-1 truncate">@{viewer.username}</div>
                            {viewedLabel && <div className="text-[10px] text-c-text-tertiary">{viewedLabel}</div>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
                {reactorGroups.length === 0 ? (
                  <div className="text-sm text-c-text-tertiary">{t('feed.no_reactions_yet')}</div>
                ) : reactorGroups.map((group) => (
                  <div key={group.reaction_type} className="rounded-lg border border-c-border p-2">
                    <div className="text-xs text-c-text-secondary mb-1 capitalize">{group.reaction_type.replace('-', ' ')}</div>
                    <div className="flex flex-col gap-1">
                      {(group.users || []).map((u) => (
                        <div key={`${group.reaction_type}-${u.username}`} className="flex items-center gap-2 text-xs text-c-text-tertiary">
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
