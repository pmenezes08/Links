import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from 'react'
import { Capacitor } from '@capacitor/core'
import { useTranslation } from 'react-i18next'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import GifPicker from '../components/GifPicker'
import type { GifSelection } from '../components/GifPicker'
import { gifSelectionToFile } from '../utils/gif'
import type React from 'react'
import MentionTextarea from '../components/MentionTextarea'
import { useAudioRecorder } from '../components/useAudioRecorder'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'
import ZoomableImage from '../components/ZoomableImage'
import { formatSmartTime, parseFlexibleDate } from '../utils/time'
import VideoEmbed from '../components/VideoEmbed'
import LinkPreview, { feedPostLinkPreviewUrls } from '../components/LinkPreview'
import { extractVideoEmbedFromPost, removeVideoUrlFromText } from '../utils/videoEmbed'
import EditableAISummary from '../components/EditableAISummary'
import { clearDeviceCache, readDeviceCache, writeDeviceCache } from '../utils/deviceCache'
import { renderRichText } from '../utils/linkUtils'
import { isVideoAttachmentPath } from '../utils/replyMedia'
import { openExternalInApp } from '../utils/openExternalInApp'
import { useEntitlementsHandler } from '../contexts/EntitlementsContext'
import { ENTITLEMENTS_REFRESH_EVENT, useEntitlements } from '../hooks/useEntitlements'
import {
  buildClientPremiumRequiredError,
  mentionsSteve,
  shouldClientBlockSteveIntent,
} from '../utils/steveClientGate'
import { preflightSteveMention } from '../utils/stevePreflight'

type Reply = { id: number; username: string; content: string; timestamp: string; reactions: Record<string, number>; user_reaction: string|null, parent_reply_id?: number|null, children?: Reply[], profile_picture?: string|null, image_path?: string|null, video_path?: string|null, audio_path?: string|null, audio_summary?: string|null, reply_count?: number, view_count?: number }
type MediaItem = { type: 'image' | 'video'; path: string }
type Post = { id: number; username: string; content: string; link_urls?: string[] | string | null; image_path?: string|null; video_path?: string|null; audio_path?: string|null; audio_summary?: string|null; timestamp: string; reactions: Record<string, number>; user_reaction: string|null; replies: Reply[]; ai_videos?: Array<{video_path: string; generated_by: string; created_at: string; style: string}>; view_count?: number; reply_count?: number; media_paths?: MediaItem[] | string | null }

const POST_DETAIL_CACHE_VERSION = 'post-detail-v2'
const POST_DETAIL_CACHE_TTL_MS = 30 * 1000

type PostDetailCachePayload = { post: Post; isGroupPost: boolean }

function readCachedPostDetail(postId: string | undefined): { post: Post | null; isGroupPost: boolean } {
  if (!postId) return { post: null, isGroupPost: false }
  const c = readDeviceCache<PostDetailCachePayload>(`post-${postId}`, POST_DETAIL_CACHE_VERSION)
  return { post: c?.post ?? null, isGroupPost: !!c?.isGroupPost }
}

// old formatTimestamp removed; using formatSmartTime

function normalizePath(p?: string | null): string {
  const s = (p || '').trim()
  if (!s) return ''
  if (s.startsWith('http')) return s
  if (s.startsWith('/uploads') || s.startsWith('/static')) return s
  if (s.startsWith('uploads') || s.startsWith('static')) return `/${s}`
  return `/uploads/${s}`
}

/** Matches server AI_USERNAME (bodybuilding_app.py) — Steve replies have parent_reply_id but must list with top-level rows. */
const STEVE_AI_USERNAME = 'steve'
function isSteveAiReply(r: Reply): boolean {
  return (r.username || '').toLowerCase() === STEVE_AI_USERNAME
}
function isReplyRowTopLevel(r: Reply): boolean {
  return !r.parent_reply_id || isSteveAiReply(r)
}

export default function PostDetail(){
  const { t } = useTranslation()
  const { post_id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
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
  const [post, setPost] = useState<Post|null>(null)
  const [isGroupPost, setIsGroupPost] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File|null>(null)
  const [uploadFile, setUploadFile] = useState<File|null>(null)
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null)
  const [replyGif, setReplyGif] = useState<GifSelection | null>(null)
  const [gifPickerOpen, setGifPickerOpen] = useState(false)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [currentUser, setCurrentUser] = useState<{username: string; profile_picture?: string | null} | null>(null)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [submittingReply, setSubmittingReply] = useState(false)
  const [mediaCarouselIndex, setMediaCarouselIndex] = useState(0)
  const [steveIsTyping, setSteveIsTyping] = useState(false)
  const [replyComposerExpanded, setReplyComposerExpanded] = useState(false)
  const expandedComposerRef = useRef<HTMLDivElement | null>(null)
  
  const openArticleReader = useCallback((url: string) => {
    void openExternalInApp(url)
  }, [])

  const onNavigateToReply = useCallback((id: number) => {
    navigate(isGroupPost ? `/group_reply/${id}` : `/reply/${id}`)
  }, [navigate, isGroupPost])
  
  // Check if message contains @Steve mention (case insensitive)
  const containsSteveMention = (text: string) => {
    return /@steve\b/i.test(text)
  }

  // Keep the textarea focused on mobile so tapping composer controls
  // doesn't dismiss the keyboard and shove the fixed bar into the safe area.
  const preventComposerBlur = (event: { preventDefault(): void }) => {
    event.preventDefault()
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
  
  // Call Steve AI to generate a reply
  // Privacy gate is enforced on backend via user_can_access_steve_kb
  // (see docs/STEVE_PRIVACY_GATE.md and backend steve_reply endpoint)
  const callSteveAI = async (userMessage: string, parentReplyId: number | null) => {
    if (!post || !containsSteveMention(userMessage)) return
    const communityIdRaw = (post as { community_id?: number | string | null }).community_id
    const communityId =
      communityIdRaw !== undefined && communityIdRaw !== null && communityIdRaw !== ''
        ? Number(communityIdRaw)
        : null
    if (blockSteveMentionReply(userMessage, communityId)) return

    try {
      setSteveIsTyping(true)
      const response = await fetch('/api/ai/steve_reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          post_id: post.id,
          parent_reply_id: parentReplyId,
          user_message: userMessage,
          community_id: Number.isFinite(communityId as number) ? communityId : null,
          is_group_post: isGroupPost,
        })
      })
      
      const data = await entitlementsHandler.handleResponse<{ success?: boolean; reply?: Reply; error?: string }>(response)
      if (!data) return // entitlements modal already shown
      
      if (data.success && data.reply) {
        const steveReply = data.reply as Reply
        // Prepend like CommunityFeed onAddReply so the row exists even if nested attach races; list filter shows Steve despite parent_reply_id.
        setPost(p => (p ? { ...p, replies: [steveReply, ...(p.replies || [])] } : p))
        try { window.dispatchEvent(new Event(ENTITLEMENTS_REFRESH_EVENT)) } catch { /* noop */ }
      } else if (!data.success) {
        console.error('[Steve AI] Error:', data.error)
      }
    } catch (err) {
      console.error('[Steve AI] Failed to get Steve AI reply:', err)
    } finally {
      setSteveIsTyping(false)
    }
  }
  
  const parsedMediaPaths = useMemo((): MediaItem[] => {
    if (!post?.media_paths) return []
    let raw: unknown[] = []
    if (Array.isArray(post.media_paths)) {
      raw = post.media_paths
    } else if (typeof post.media_paths === 'string') {
      try { raw = JSON.parse(post.media_paths) } catch { return [] }
      if (!Array.isArray(raw)) return []
    }
    return raw.map((item: unknown) => {
      if (typeof item === 'string') {
        const isVideo = /\.(mp4|mov|webm|m4v)$/i.test(item)
        return { type: isVideo ? 'video' : 'image', path: item } as MediaItem
      }
      if (item && typeof item === 'object' && 'path' in item) return item as MediaItem
      return null
    }).filter((x): x is MediaItem => x !== null)
  }, [post?.media_paths])
  
  const hasMultipleMedia = parsedMediaPaths.length > 1
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
  
  // Report/Hide/Block post state
  const [showHideModal, setShowHideModal] = useState(false)
  const [showReportModal, setShowReportModal] = useState(false)
  const [showBlockModal, setShowBlockModal] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showSummaryModal, setShowSummaryModal] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryText, setSummaryText] = useState<string | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [reportDetails, setReportDetails] = useState('')
  const [reportSubmitting, setReportSubmitting] = useState(false)
  const [blockReason, setBlockReason] = useState('')
  const [blockSubmitting, setBlockSubmitting] = useState(false)

  // Star state
  const [starring, setStarring] = useState(false)

  // Viewers/Reactors modal state
  type ReactionGroup = { reaction_type: string; users: Array<{ username: string; profile_picture?: string | null }> }
  type PostViewer = { username: string; profile_picture?: string | null; viewed_at?: string | null }
  const [showReactorsModal, setShowReactorsModal] = useState(false)
  const [reactorsLoading, setReactorsLoading] = useState(false)
  const [reactorGroups, setReactorGroups] = useState<ReactionGroup[]>([])
  const [reactorViewers, setReactorViewers] = useState<PostViewer[]>([])
  const [reactorViewCount, setReactorViewCount] = useState<number | null>(null)

  // Reply viewers/reactors modal state
  const [showReplyReactorsModal, setShowReplyReactorsModal] = useState(false)
  const [replyReactorsLoading, setReplyReactorsLoading] = useState(false)
  const [replyReactorGroups, setReplyReactorGroups] = useState<ReactionGroup[]>([])
  const [replyReactorViewers, setReplyReactorViewers] = useState<PostViewer[]>([])
  const [replyReactorViewCount, setReplyReactorViewCount] = useState<number | null>(null)

  // Unread counts for header icons
  const [unreadMsgs, setUnreadMsgs] = useState(0)
  const [unreadNotifs, setUnreadNotifs] = useState(0)

  // Poll for unread counts
  useEffect(() => {
    let mounted = true
    const poll = async () => {
      if (!mounted) return
      try {
        const m = await fetch('/check_unread_messages', { credentials: 'include' })
        const mj = await m.json().catch(() => null)
        if (mounted && mj && typeof mj.unread_count === 'number') {
          setUnreadMsgs(mj.unread_count)
        }
      } catch {}
      try {
        const n = await fetch('/api/notifications', { credentials: 'include', headers: { 'Accept': 'application/json' } })
        const nj = await n.json().catch(() => null)
        if (mounted && nj?.success && Array.isArray(nj.notifications)) {
          const cnt = nj.notifications.filter((x: any) => x && x.is_read === false && x.type !== 'message' && x.type !== 'reaction').length
          setUnreadNotifs(cnt)
        }
      } catch {}
    }
    poll()
    const interval = setInterval(poll, 10000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])
  
  // Close more menu when clicking outside (with delay to prevent immediate close)
  useEffect(() => {
    if (!showMoreMenu) return
    const handleClickOutside = () => setShowMoreMenu(false)
    // Small delay to prevent the same click that opened the menu from closing it
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 10)
    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [showMoreMenu])

  // Fetch post summary from AI
  const fetchSummary = async () => {
    if (!post) return
    setSummaryLoading(true)
    setSummaryError(null)
    setSummaryText(null)
    setShowSummaryModal(true)
    
    try {
      const response = await fetch(`/api/post/${post.id}/summary`, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
      const data = await entitlementsHandler.handleResponse<{ success?: boolean; summary?: string; error?: string }>(response)
      if (!data) {
        setShowSummaryModal(false)
        return
      }
      if (data.success) {
        setSummaryText(data.summary || null)
      } else {
        setSummaryError(data.error || 'Failed to generate summary')
      }
    } catch {
      setSummaryError('Network error. Please try again.')
    } finally {
      setSummaryLoading(false)
    }
  }

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

  // Visual viewport tracking for web only. Native uses Capacitor Keyboard;
  // mixing both sources can leave stale offsets after notification/resume.
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

  // Reset keyboard lift and nudge layout after app resume/notification open.
  useEffect(() => {
    const nudgeLayout = () => {
      keyboardOffsetRef.current = 0
      setKeyboardOffset(0)
      setViewportLift(0)
      viewportBaseRef.current = null
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'))
        requestAnimationFrame(() => {
          try {
            contentRef.current?.scrollBy({ top: 0, left: 0 })
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

    let resumeHandle: PluginListenerHandle | undefined
    const setupResume = async () => {
      if (!Capacitor.isNativePlatform()) return
      const { App } = await import('@capacitor/app')
      resumeHandle = await App.addListener('resume', nudgeLayout)
    }
    void setupResume()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      void resumeHandle?.remove()
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

  // Close attachment menu when clicking outside
  useEffect(() => {
    if (!showAttachMenu) return
    const handleClickOutside = () => setShowAttachMenu(false)
    // Small delay to prevent immediate close on the click that opened it
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

  // Scroll inline reply composer into view when keyboard opens
  useEffect(() => {
    let lastHeight = window.innerHeight
    
    const handleResize = () => {
      const newHeight = window.innerHeight
      // Keyboard state changed
      if (newHeight !== lastHeight) {
        const keyboardOpened = newHeight < lastHeight
        lastHeight = newHeight
        
        if (keyboardOpened) {
          // If there's an active inline reply, scroll that into view
          if (activeInlineReplyFor !== null) {
            setTimeout(() => {
              const composerEl = document.querySelector(`[data-inline-reply-id="${activeInlineReplyFor}"]`)
              if (composerEl) {
                composerEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            }, 150)
          } else if (contentRef.current) {
            // Otherwise scroll to bottom for main reply composer
            setTimeout(() => {
              contentRef.current?.scrollTo({ top: contentRef.current.scrollHeight, behavior: 'smooth' })
            }, 100)
          }
        }
      }
    }
    
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [activeInlineReplyFor])
  
  // Scroll inline reply composer into view when activated
  useEffect(() => {
    if (activeInlineReplyFor === null) return
    
    // Small delay to let the composer render
    const timeoutId = setTimeout(() => {
      const composerEl = document.querySelector(`[data-inline-reply-id="${activeInlineReplyFor}"]`)
      if (composerEl) {
        composerEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 100)
    
    return () => clearTimeout(timeoutId)
  }, [activeInlineReplyFor])
  
  useEffect(() => {
    viewRecordedRef.current = false
  }, [post_id, isGroupPost])

  useEffect(() => {
    if (!post_id || loading || !post) return
    if (viewRecordedRef.current) return
    viewRecordedRef.current = true
    let cancelled = false
    async function recordView() {
      try {
        const res = await fetch(
          isGroupPost ? '/api/group_post_view' : '/api/post_view',
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              isGroupPost
                ? { group_post_id: Number(post_id) }
                : { post_id: Number(post_id) },
            ),
          },
        )
        const j = await res.json().catch(() => null)
        if (!cancelled && j?.success && typeof j.view_count === 'number') {
          setPost((prev) => {
            if (!prev) return prev
            if (Number(prev.id) !== Number(post_id)) return prev
            return { ...prev, view_count: j.view_count }
          })
        }
      } catch {
        viewRecordedRef.current = false
      }
    }
    void recordView()
    return () => { cancelled = true }
  }, [post_id, isGroupPost, loading, post])

  // Fetch accurate view count + reaction counts from MySQL after post loads (community posts only)
  useEffect(() => {
    if (!post || isGroupPost) return
    let cancelled = false
    const postId = post.id
    async function fetchCounts() {
      try {
        const r = await fetch(`/get_post_reactors/${postId}`, { credentials: 'include' })
        const j = await r.json().catch(() => null)
        if (cancelled || !j?.success) return
        const viewCount = typeof j.view_count === 'number' ? j.view_count : (Array.isArray(j.viewers) ? j.viewers.length : undefined)
        const reactionCounts: Record<string, number> = {}
        if (Array.isArray(j.groups)) {
          for (const g of j.groups) {
            if (g.reaction_type && Array.isArray(g.users)) reactionCounts[g.reaction_type] = g.users.length
          }
        }
        setPost(prev => {
          if (!prev || prev.id !== postId) return prev
          return {
            ...prev,
            view_count: viewCount ?? prev.view_count,
            reactions: Object.keys(reactionCounts).length > 0 ? reactionCounts : prev.reactions,
          }
        })
      } catch {}
    }
    fetchCounts()
    return () => { cancelled = true }
  }, [post?.id, isGroupPost])

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
    try {
      const [gRes, pRes] = await Promise.all([
        fetch(`/api/group_post?post_id=${post_id}`, { credentials: 'include', headers: { 'Accept': 'application/json' } }),
        fetch(`/get_post?post_id=${post_id}`, { credentials: 'include' }),
      ])
      const gJson = await gRes.json().catch(() => null)
      const pJson = await pRes.json().catch(() => null)
      if (gJson?.success && gJson.post) {
        setPost(gJson.post)
        setIsGroupPost(true)
        writeDeviceCache(`post-${post_id}`, { post: gJson.post, isGroupPost: true }, POST_DETAIL_CACHE_TTL_MS, POST_DETAIL_CACHE_VERSION)
      } else if (pJson?.success && pJson.post) {
        setPost(pJson.post)
        setIsGroupPost(false)
        writeDeviceCache(`post-${post_id}`, { post: pJson.post, isGroupPost: false }, POST_DETAIL_CACHE_TTL_MS, POST_DETAIL_CACHE_VERSION)
      }
    } catch {}
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

  useLayoutEffect(() => {
    const c = readCachedPostDetail(post_id)
    setPost(c.post)
    setIsGroupPost(c.isGroupPost)
    setLoading(!c.post)
    setError(null)
  }, [post_id])

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const [gRes, pRes] = await Promise.all([
          fetch(`/api/group_post?post_id=${post_id}`, { credentials: 'include', headers: { 'Accept': 'application/json' } }),
          fetch(`/get_post?post_id=${post_id}`, { credentials: 'include' }),
        ])
        const gJson = await gRes.json().catch(() => null)
        const pJson = await pRes.json().catch(() => null)
        if (!mounted) return
        if (gJson?.success && gJson.post) {
          setPost(gJson.post)
          setIsGroupPost(true)
          setError(null)
          writeDeviceCache(`post-${post_id}`, { post: gJson.post, isGroupPost: true }, POST_DETAIL_CACHE_TTL_MS, POST_DETAIL_CACHE_VERSION)
        } else if (pJson?.success && pJson.post) {
          setPost(pJson.post)
          setIsGroupPost(false)
          setError(null)
          writeDeviceCache(`post-${post_id}`, { post: pJson.post, isGroupPost: false }, POST_DETAIL_CACHE_TTL_MS, POST_DETAIL_CACHE_VERSION)
        } else {
          setError(gJson?.error || pJson?.error || 'Error')
        }
      } catch {
        if (mounted) setError('Error loading post')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [post_id])

  // Load current username for ownership checks — defer until after first paint to avoid competing with post fetch
  useEffect(() => {
    let mounted = true
    const t = window.setTimeout(() => {
      ;(async () => {
        try {
          const r = await fetch('/api/home_timeline', { credentials: 'include', headers: { 'Accept': 'application/json' } })
          const j = await r.json().catch(() => null)
          if (!mounted) return
          if (j?.success && j.username) {
            setCurrentUser({
              username: j.username,
              profile_picture: j.profile_picture || null,
            })
          }
        } catch {}
      })()
    }, 0)
    return () => {
      mounted = false
      window.clearTimeout(t)
    }
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
    const endpoint = isGroupPost ? '/api/group_posts/react' : '/add_reaction'
    const r = await fetch(endpoint, { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: form })
    const j = await r.json().catch(()=>null)
    if (j?.success){
      setPost(p => p ? ({ ...p, reactions: { ...p.reactions, ...j.counts }, user_reaction: j.user_reaction }) : p)
    }
  }

  const patchReplyAudioSummary = useCallback((replyId: number, summary: string) => {
    setPost(p => {
      if (!p) return p
      function patch(list: Reply[]): Reply[] {
        return list.map(item => {
          if (item.id === replyId) return { ...item, audio_summary: summary }
          const ch = item.children
          if (ch?.length) return { ...item, children: patch(ch) }
          return item
        })
      }
      return { ...p, replies: patch(p.replies) }
    })
  }, [])

  async function toggleReplyReaction(replyId: number, reaction: string){
    const form = new URLSearchParams({ reply_id: String(replyId), reaction })
    const endpoint = isGroupPost ? '/api/group_replies/react' : '/add_reply_reaction'
    const r = await fetch(endpoint, { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: form })
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

    const messageText = content.trim()
    const communityId = (post as { community_id?: number | string | null }).community_id
    if (blockSteveMentionReply(messageText, communityId)) return
    if (!isGroupPost) {
      const preflight = await preflightSteveMention({
        text: messageText,
        communityId,
        postId: post.id,
        entitlementsHandler,
      })
      if (!preflight.ok) {
        if (preflight.error) alert(preflight.error)
        return
      }
    }
    
    setSubmittingReply(true)
    const fd = new FormData()
    if (isGroupPost) {
      fd.append('group_post_id', String(post.id))
    } else {
      fd.append('post_id', String(post.id))
    }
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
      alert(t('feed.gif_attach_failed'))
      return
    }
    if (replyPreview?.blob) {
      fd.append('audio', replyPreview.blob, (replyPreview.blob.type.includes('mp4') ? 'audio.mp4' : 'audio.webm'))
      const durSec = (replyPreview as { duration?: number }).duration ?? (recordMs / 1000)
      if (durSec > 0) fd.append('voice_duration_seconds', String(durSec))
    }
    fd.append('dedupe_token', replyTokenRef.current)
    const replyEndpoint = isGroupPost ? '/api/group_replies' : '/post_reply'
    const r = await fetch(replyEndpoint, { method:'POST', credentials:'include', body: fd })
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
      // Check if user mentioned @Steve and trigger AI reply (defer so user reply is committed first — avoids attach race)
      const messageText = content.trim()
      if (containsSteveMention(messageText)) {
        const parentId = j.reply.id as number
        queueMicrotask(() => {
          void callSteveAI(messageText, parentId)
        })
      }
      setReplyComposerExpanded(false)
      setContent(''); setFile(null); setUploadFile(null); setReplyGif(null); setFilePreviewUrl(null); if (fileInputRef.current) fileInputRef.current.value = ''
      replyTokenRef.current = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    }
  }

  async function submitInlineReply(parentId: number, text: string, file?: File, voiceDurationSec?: number){
    if (!post || (!text && !file)) return
    if (inlineSending[parentId]) return
    const messageText = (text || '').trim()
    const communityId = (post as { community_id?: number | string | null }).community_id
    if (blockSteveMentionReply(messageText, communityId)) return
    if (!isGroupPost) {
      const preflight = await preflightSteveMention({
        text: messageText,
        communityId,
        postId: post.id,
        entitlementsHandler,
      })
      if (!preflight.ok) {
        if (preflight.error) alert(preflight.error)
        return
      }
    }
    setInlineSending(s => ({ ...s, [parentId]: true }))
    const fd = new FormData()
    if (isGroupPost) {
      fd.append('group_post_id', String(post.id))
    } else {
      fd.append('post_id', String(post.id))
    }
    fd.append('content', text || '')
    fd.append('parent_reply_id', String(parentId))
    if (file) {
      if (typeof (file as any).type === 'string' && (file as any).type.startsWith('audio/')) {
        fd.append('audio', file)
        if (typeof voiceDurationSec === 'number' && voiceDurationSec > 0) {
          fd.append('voice_duration_seconds', String(voiceDurationSec))
        }
      } else if (typeof (file as any).type === 'string' && (file as any).type.startsWith('image/')) {
        fd.append('image', file)
      } else {
        fd.append('image', file)
      }
    }
    fd.append('dedupe_token', `${Date.now()}_${Math.random().toString(36).slice(2)}`)
    const inlineEndpoint = isGroupPost ? '/api/group_replies' : '/post_reply'
    const r = await fetch(inlineEndpoint, { method:'POST', credentials:'include', body: fd })
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
      if (containsSteveMention(text)) {
        const parentId = j.reply.id as number
        const msg = text
        queueMicrotask(() => {
          void callSteveAI(msg, parentId)
        })
      }
    }
  }

  async function deleteReply(replyId: number){
    if (!post) return
    const ok = window.confirm(t('feed.delete_reply_confirm'))
    if (!ok) return
    try{
      if (isGroupPost) {
        const fd = new FormData()
        fd.append('reply_id', String(replyId))
        const r = await fetch('/api/group_replies/delete', { method: 'POST', credentials: 'include', body: fd })
        const j = await r.json().catch(()=>null)
        if (!j?.success) return
      } else {
        const fd = new FormData()
        fd.append('reply_id', String(replyId))
        const r = await fetch('/delete_reply', { method: 'POST', credentials: 'include', body: fd })
        const j = await r.json().catch(()=>null)
        if (!j?.success) return
      }
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
      // Clear cache so post detail and feed reflect the deletion immediately
      clearDeviceCache(`post-${post_id}`)
      clearDeviceCache('home-timeline')
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
    if (isGroupPost) {
      try {
        if (removeMedia) {
          alert(t('feed.remove_group_media_unsupported'))
          return
        }
        const fd = new FormData()
        fd.append('post_id', String(post.id))
        fd.append('content', editPostText)
        if (editMediaFile) {
          fd.append('image', editMediaFile)
        }
        const r = await fetch('/api/group_posts/edit', { method: 'POST', credentials: 'include', body: fd })
        const j = await r.json().catch(() => null)
        if (j?.success) {
          await refreshPost()
          clearEditMedia()
          setRemoveMedia(false)
          setIsEditingPost(false)
          clearDeviceCache('home-timeline')
          try {
            const invalidateFn = (window as any).__invalidateParentTimelineCache
            if (typeof invalidateFn === 'function') invalidateFn()
          } catch {}
        } else {
          alert(j?.error || t('feed.update_post_failed'))
        }
      } catch {
        alert(t('feed.update_post_failed'))
      }
      return
    }

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
        clearDeviceCache('home-timeline')
        try {
          const invalidateFn = (window as any).__invalidateParentTimelineCache
          if (typeof invalidateFn === 'function') invalidateFn()
        } catch {}
      } else {
        alert(j?.error || t('feed.update_post_failed'))
      }
    } catch {
      alert(t('feed.update_post_failed'))
    }
  }

  async function deletePost() {
    if (!post) return
    const ok = window.confirm(t('feed.delete_post_confirm'))
    if (!ok) return
    try {
      const fd = new FormData()
      fd.append('post_id', String(post.id))
      const url = isGroupPost ? '/api/group_posts/delete' : '/delete_post'
      const r = await fetch(url, { method: 'POST', credentials: 'include', body: fd })
      const j = await r.json().catch(() => null)
      if (j?.success) {
        navigate(-1)
      } else {
        alert(j?.error || t('feed.delete_post_failed'))
      }
    } catch {
      alert(t('feed.delete_post_failed'))
    }
  }

  async function hidePost(alsoReport: boolean = false) {
    if (!post) return
    try {
      const res = await fetch('/api/hide_post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ post_id: post.id })
      })
      const j = await res.json().catch(() => null)
      if (j?.success) {
        if (alsoReport) {
          setShowHideModal(false)
          setShowReportModal(true)
        } else {
          alert(t('feed.post_hidden'))
          navigate(-1)
        }
      } else {
        alert(j?.error || t('feed.hide_post_failed'))
      }
    } catch {
      alert(t('feed.hide_post_network_failed'))
    }
  }

  async function reportPost() {
    if (!post || !reportReason) return
    setReportSubmitting(true)
    try {
      const res = await fetch('/api/report_post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          post_id: post.id,
          reason: reportReason,
          details: reportDetails
        })
      })
      const j = await res.json().catch(() => null)
      if (j?.success) {
        alert(j.message || t('feed.post_reported'))
        setShowReportModal(false)
        setReportReason('')
        setReportDetails('')
        navigate(-1)
      } else {
        alert(j?.error || t('feed.report_post_failed'))
      }
    } catch {
      alert(t('feed.report_post_network_failed'))
    } finally {
      setReportSubmitting(false)
    }
  }

  async function blockUser(alsoReport: boolean = false) {
    if (!post) return
    setBlockSubmitting(true)
    try {
      const res = await fetch('/api/block_user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          blocked_username: post.username,
          reason: blockReason,
          also_report: alsoReport
        })
      })
      const j = await res.json().catch(() => null)
      if (j?.success) {
        alert(t('feed.user_blocked', { username: post.username }))
        setShowBlockModal(false)
        setBlockReason('')
        navigate(-1)
      } else {
        alert(j?.error || t('feed.block_user_failed'))
      }
    } catch {
      alert(t('feed.block_user_network_failed'))
    } finally {
      setBlockSubmitting(false)
    }
  }

  // Toggle personal star
  async function toggleStar() {
    if (!post || starring) return
    const gid = (post as any).group_id
    if (isGroupPost && gid != null) {
      setStarring(true)
      try {
        const prev = !!(post as any).is_starred
        setPost((p: any) => (p ? { ...p, is_starred: !prev } : p))
        const fd = new URLSearchParams({
          group_id: String(gid),
          group_post_id: String(post.id),
        })
        const r = await fetch('/api/toggle_group_key_post', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: fd,
        })
        const j = await r.json().catch(() => null)
        if (!j?.success) {
          setPost((p: any) => (p ? { ...p, is_starred: prev } : p))
          alert(j?.error || 'Failed to update')
        } else {
          setPost((p: any) => (p ? { ...p, is_starred: !!j.starred } : p))
        }
      } finally {
        setStarring(false)
      }
      return
    }
    setStarring(true)
    try {
      const prev = (post as any).is_starred
      setPost((p: any) => p ? { ...p, is_starred: !prev } : p)
      const fd = new URLSearchParams({ post_id: String(post.id) })
      const r = await fetch('/api/toggle_key_post', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: fd })
      const j = await r.json().catch(() => null)
      if (!j?.success) {
        setPost((p: any) => p ? { ...p, is_starred: prev } : p)
        alert(j?.error || 'Failed to update')
      } else {
        setPost((p: any) => p ? { ...p, is_starred: !!j.starred } : p)
      }
    } finally {
      setStarring(false)
    }
  }

  // Toggle community star (for admins)
  async function toggleCommunityStar() {
    if (!post || starring) return
    const gid = (post as any).group_id
    if (isGroupPost && gid != null) {
      setStarring(true)
      try {
        const prev = !!(post as any).is_community_starred
        setPost((p: any) => (p ? { ...p, is_community_starred: !prev } : p))
        const fd = new URLSearchParams({
          group_id: String(gid),
          group_post_id: String(post.id),
        })
        const r = await fetch('/api/toggle_group_community_key_post', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: fd,
        })
        const j = await r.json().catch(() => null)
        if (!j?.success) {
          setPost((p: any) => (p ? { ...p, is_community_starred: prev } : p))
          alert(j?.error || 'Failed to update')
        } else {
          setPost((p: any) => (p ? { ...p, is_community_starred: !!j.starred } : p))
        }
      } finally {
        setStarring(false)
      }
      return
    }
    setStarring(true)
    try {
      const prev = (post as any).is_community_starred
      setPost((p: any) => p ? { ...p, is_community_starred: !prev } : p)
      const fd = new URLSearchParams({ post_id: String(post.id) })
      const r = await fetch('/api/toggle_community_key_post', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: fd })
      const j = await r.json().catch(() => null)
      if (!j?.success) {
        setPost((p: any) => p ? { ...p, is_community_starred: prev } : p)
        alert(j?.error || 'Failed to update')
      } else {
        setPost((p: any) => p ? { ...p, is_community_starred: !!j.starred } : p)
      }
    } finally {
      setStarring(false)
    }
  }

  function formatViewerRelative(value?: string | null) {
    if (!value) return ''
    const date = parseFlexibleDate(value)
    if (!date) return ''
    const diffMs = Date.now() - date.getTime()
    const diffSeconds = Math.floor(diffMs / 1000)
    if (diffSeconds < 60) return 'just now'
    const diffMinutes = Math.floor(diffSeconds / 60)
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  // Open reply viewers/reactors modal
  async function openReplyReactorsModal(replyId: number) {
    setShowReplyReactorsModal(true)
    setReplyReactorsLoading(true)
    setReplyReactorGroups([])
    setReplyReactorViewers([])
    setReplyReactorViewCount(null)
    try {
      const r = await fetch(`/get_reply_reactors/${replyId}`, { credentials: 'include' })
      const j = await r.json().catch(() => null)
      if (j?.success) {
        setReplyReactorGroups(Array.isArray(j.groups) ? j.groups : [])
        const viewerList: PostViewer[] = Array.isArray(j.viewers)
          ? (j.viewers as Array<any>)
              .map((v: any) => ({ username: v?.username, profile_picture: v?.profile_picture ?? null, viewed_at: v?.viewed_at ?? null }))
              .filter((v: any) => typeof v.username === 'string' && v.username.length > 0)
          : []
        setReplyReactorViewers(viewerList)
        const freshCount = typeof j.view_count === 'number' ? j.view_count : viewerList.length || null
        setReplyReactorViewCount(freshCount)
        // Propagate the fresh view count into the reply tree so the button updates
        if (typeof freshCount === 'number') {
          setPost(prev => {
            if (!prev) return prev
            function patchVC(replies: Reply[]): Reply[] {
              return replies.map(r => {
                if (r.id === replyId) return { ...r, view_count: freshCount! }
                if (r.children?.length) return { ...r, children: patchVC(r.children) }
                return r
              })
            }
            return { ...prev, replies: patchVC(prev.replies) }
          })
        }
      }
    } finally {
      setReplyReactorsLoading(false)
    }
  }

  // Open viewers/reactors modal
  async function openReactorsModal() {
    if (!post) return
    setShowReactorsModal(true)
    setReactorsLoading(true)
    setReactorGroups([])
    setReactorViewers([])
    setReactorViewCount(null)
    try {
      const r = await fetch(`/get_post_reactors/${post.id}`, { credentials: 'include' })
      const j = await r.json().catch(() => null)
      if (j?.success) {
        setReactorGroups(Array.isArray(j.groups) ? j.groups : [])
        const viewerList: PostViewer[] = Array.isArray(j.viewers)
          ? (j.viewers as Array<any>)
              .map((v) => ({
                username: v?.username,
                profile_picture: v?.profile_picture ?? null,
                viewed_at: v?.viewed_at ?? null,
              }))
              .filter((v) => typeof v.username === 'string' && v.username.length > 0)
          : []
        setReactorViewers(viewerList)
        const freshPostVC = typeof j.view_count === 'number' ? j.view_count : (viewerList.length > 0 ? viewerList.length : null)
        setReactorViewCount(freshPostVC)
        if (typeof freshPostVC === 'number') {
          setPost(prev => prev ? { ...prev, view_count: freshPostVC } : prev)
        }
      }
    } finally {
      setReactorsLoading(false)
    }
  }

  function closeReactorsModal() {
    setShowReactorsModal(false)
    setReactorGroups([])
    setReactorViewers([])
    setReactorViewCount(null)
  }


  if (loading) return <div className="p-4 text-[#9fb0b5]">{t('common.loading')}</div>
  if (error || !post) return <div className="p-4 text-red-400">{error||t('errors.generic')}</div>

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
      className="min-h-screen bg-black text-white flex flex-col overflow-hidden"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
      {/* Fixed Header */}
      <div
        className="flex-shrink-0 border-b border-white/10"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          background: '#000',
        }}
      >
        <div className="h-14 flex items-center gap-2 px-3">
          <button
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
            onClick={() => {
              const state = (location.state || {}) as { communityId?: string | number; groupId?: string | number }
              const gidRaw =
                (isGroupPost && (post as any)?.group_id != null && (post as any).group_id !== '')
                  ? (post as any).group_id
                  : state.groupId
              if (isGroupPost && gidRaw != null && gidRaw !== '') {
                navigate(`/group_feed_react/${String(gidRaw)}`)
                return
              }

              const communityId = (post as any)?.community_id || state.communityId

              if (communityId) {
                console.log('🧭 Smart context: returning to community feed', communityId)
                navigate(`/community_feed_react/${communityId}`)
              } else {
                console.log('🧭 No community context - using browser history')
                navigate(-1)
              }
            }}
            aria-label={t('navigation.back')}
          >
            <i className="fa-solid fa-arrow-left text-white" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="font-semibold tracking-[-0.01em] text-sm">{t('feed.post')}</div>
          </div>
          <div className="flex items-center gap-1">
            {/* Messages icon */}
            <button 
              className="relative p-2 rounded-full hover:bg-white/10 transition-colors" 
              onClick={() => navigate('/user_chat')} 
              aria-label={t('navigation.messages')}
            >
              <i className="fa-solid fa-comments text-white" />
              {unreadMsgs > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#4db6ac] text-black text-[10px] flex items-center justify-center">
                  {unreadMsgs > 99 ? '99+' : unreadMsgs}
                </span>
              )}
            </button>
            {/* Notifications icon */}
            <button 
              className="relative p-2 rounded-full hover:bg-white/10 transition-colors" 
              onClick={() => navigate('/notifications')} 
              aria-label={t('navigation.notifications')}
            >
              <i className="fa-regular fa-bell text-white" />
              {unreadNotifs > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#4db6ac] text-black text-[10px] flex items-center justify-center">
                  {unreadNotifs > 99 ? '99+' : unreadNotifs}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {(refreshHint || refreshing) ? (
        <div className="fixed top-[72px] left-0 right-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="px-2 py-1 text-xs rounded-full bg-white/10 border border-white/15 text-white/80 flex items-center gap-2">
            <i className="fa-solid fa-rotate fa-spin" />
          </div>
        </div>
      ) : null}
      {/* Scrollable content area */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto overflow-x-hidden min-h-0"
        style={{
          paddingTop: `calc(var(--app-content-gap, 8px) + ${pullPx}px)`,
          WebkitOverflowScrolling: 'touch' as any,
          overscrollBehaviorY: 'auto' as any,
        }}
      >
        <div className="max-w-2xl mx-auto px-3" style={{ paddingBottom: contentPaddingBottom }}>
        <div className="rounded-2xl border border-white/10 bg-black shadow-sm shadow-black/20">
          {/* Post Header with avatar, username, date, and action buttons */}
          <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
            <Avatar username={post.username} url={(post as any).profile_picture || undefined} size={32} linkToProfile />
            <div className="font-medium tracking-[-0.01em]">{post.username}</div>
            <div className="ml-auto flex items-center gap-1">
              {/* Date */}
              <span className="text-xs text-[#9fb0b5] tabular-nums mr-1">{formatSmartTime((post as any).display_timestamp || post.timestamp)}</span>
              {/* Personal star (turquoise when selected) */}
              <button 
                className="px-2 py-1 rounded-full" 
                title={(post as any).is_starred ? t('feed.unstar_yours') : t('feed.star_yours')} 
                onClick={toggleStar} 
                aria-label={t('feed.star_yours')}
              >
                <i className={`${(post as any).is_starred ? 'fa-solid' : 'fa-regular'} fa-star`} style={{ color: (post as any).is_starred ? '#4db6ac' : '#6c757d' }} />
              </button>
              {/* Community star (yellow) for owner/admins */}
              {(currentUser?.username === 'admin' ||
                (post as any).is_community_admin ||
                (isGroupPost && (post as any).can_toggle_community_key)) && (
                <button 
                  className="px-2 py-1 rounded-full" 
                  title={(post as any).is_community_starred ? t('feed.unfeature_community') : t('feed.feature_community')} 
                  onClick={toggleCommunityStar} 
                  aria-label={t('feed.star_community')}
                >
                  <i className={`${(post as any).is_community_starred ? 'fa-solid' : 'fa-regular'} fa-star`} style={{ color: (post as any).is_community_starred ? '#ffd54f' : '#6c757d' }} />
                </button>
              )}
              {/* Delete button for owner/admin/community admin */}
              {(currentUser?.username === post.username || currentUser?.username === 'admin' || (post as any).is_community_admin) && (
                <button 
                  className="px-2 py-1 rounded-full text-[#6c757d] hover:text-red-400" 
                  title={t('common.delete')}
                  onClick={deletePost}
                >
                  <i className="fa-regular fa-trash-can" />
                </button>
              )}
              {/* Edit button for owner/admin */}
              {(currentUser?.username === post.username || currentUser?.username === 'admin') && (
                <button 
                  className="px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]" 
                  title={t('common.edit')}
                  onClick={startEditPost}
                >
                  <i className="fa-regular fa-pen-to-square" />
                </button>
              )}
              {/* More menu (Hide, Report, Block) for other users' posts */}
              {currentUser?.username && currentUser.username !== post.username && (
                <div className="relative">
                  <button 
                    className="px-2 py-1 rounded-full text-[#6c757d] hover:text-white"
                    title={t('chat.more_options')}
                    onClick={() => setShowMoreMenu(!showMoreMenu)}
                  >
                    <i className="fa-solid fa-ellipsis-vertical" />
                  </button>
                  {showMoreMenu && (
                    <div className="absolute right-0 top-8 z-50 w-44 bg-[#1a1f25] border border-white/10 rounded-xl shadow-xl overflow-hidden">
                      <button
                        className="w-full px-4 py-3 text-left text-sm text-white hover:bg-white/10 flex items-center gap-3"
                        onClick={() => {
                          setShowMoreMenu(false)
                          fetchSummary()
                        }}
                      >
                        <i className="fa-solid fa-wand-magic-sparkles text-teal-400 w-4" />
                        {t('feed.summary')}
                      </button>
                      {!isGroupPost && (
                      <>
                      <button
                        className="w-full px-4 py-3 text-left text-sm text-white hover:bg-white/10 flex items-center gap-3"
                        onClick={() => {
                          setShowMoreMenu(false)
                          setShowHideModal(true)
                        }}
                      >
                        <i className="fa-solid fa-eye-slash text-orange-400 w-4" />
                        {t('feed.hide_post')}
                      </button>
                      <button
                        className="w-full px-4 py-3 text-left text-sm text-white hover:bg-white/10 flex items-center gap-3"
                        onClick={() => {
                          setShowMoreMenu(false)
                          setShowReportModal(true)
                        }}
                      >
                        <i className="fa-solid fa-flag text-red-400 w-4" />
                        {t('feed.report_post')}
                      </button>
                      </>
                      )}
                      <button
                        className="w-full px-4 py-3 text-left text-sm text-white hover:bg-white/10 flex items-center gap-3 border-t border-white/10"
                        onClick={() => {
                          setShowMoreMenu(false)
                          setShowBlockModal(true)
                        }}
                      >
                        <i className="fa-solid fa-ban text-red-500 w-4" />
                        {t('feed.block_user', { username: post.username })}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="py-2 space-y-2">
            {!isEditingPost ? (
              <>
                {(() => {
                  const videoEmbed = extractVideoEmbedFromPost(post.content, post.link_urls)
                  const displayContent = videoEmbed ? removeVideoUrlFromText(post.content, videoEmbed) : post.content
                  return (
                    <>
                      {displayContent && <div className="px-3 whitespace-pre-wrap text-[14px] break-words">{renderRichText(displayContent, false, (u) => navigate(`/profile/${encodeURIComponent(u)}`), openArticleReader)}</div>}
                      {feedPostLinkPreviewUrls(post.content, post.link_urls, videoEmbed).map(u => (
                        <div key={u} className="px-3 mt-2">
                          <LinkPreview url={u} sent={false} />
                        </div>
                      ))}
                      {videoEmbed && <VideoEmbed embed={videoEmbed} />}
                    </>
                  )
                })()}
                {/* Media carousel for multi-media or single media display */}
                {parsedMediaPaths.length > 0 ? (
                  <div 
                    className="relative overflow-hidden touch-pan-y"
                    onTouchStart={(e) => {
                      if (!hasMultipleMedia) return
                      const touch = e.touches[0]
                      ;(e.currentTarget as any)._swipeStartX = touch.clientX
                      ;(e.currentTarget as any)._swipeStartY = touch.clientY
                    }}
                    onTouchEnd={(e) => {
                      if (!hasMultipleMedia) return
                      const startX = (e.currentTarget as any)._swipeStartX
                      const startY = (e.currentTarget as any)._swipeStartY
                      if (startX === undefined) return
                      const touch = e.changedTouches[0]
                      const diffX = touch.clientX - startX
                      const diffY = touch.clientY - startY
                      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
                        if (diffX < 0 && mediaCarouselIndex < parsedMediaPaths.length - 1) {
                          setMediaCarouselIndex(i => i + 1)
                        } else if (diffX > 0 && mediaCarouselIndex > 0) {
                          setMediaCarouselIndex(i => i - 1)
                        }
                      }
                    }}
                  >
                    {parsedMediaPaths[mediaCarouselIndex]?.type === 'video' ? (
                      <div className="px-3">
                        <video
                          className="w-full max-h-[420px] rounded border border-white/10 bg-black"
                          src={normalizePath(parsedMediaPaths[mediaCarouselIndex].path) + '#t=0.1'}
                          controls
                          playsInline
                          preload="metadata"
                        />
                      </div>
                    ) : (
                      <div className="px-0">
                        <ImageLoader
                          src={normalizePath(parsedMediaPaths[mediaCarouselIndex]?.path || '')}
                          alt={t('feed.post_media_alt', { number: mediaCarouselIndex + 1 })}
                          className="block mx-auto max-w-full max-h-[520px] rounded border border-white/10 cursor-zoom-in"
                          onClick={() => setPreviewSrc(normalizePath(parsedMediaPaths[mediaCarouselIndex]?.path || ''))}
                        />
                      </div>
                    )}
                    
                    {/* Carousel navigation */}
                    {hasMultipleMedia && (
                      <>
                        <button
                          className="absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 disabled:opacity-30 z-10"
                          onClick={() => setMediaCarouselIndex(i => Math.max(0, i - 1))}
                          disabled={mediaCarouselIndex === 0}
                        >
                          <i className="fa-solid fa-chevron-left text-sm" />
                        </button>
                        <button
                          className="absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 disabled:opacity-30 z-10"
                          onClick={() => setMediaCarouselIndex(i => Math.min(parsedMediaPaths.length - 1, i + 1))}
                          disabled={mediaCarouselIndex === parsedMediaPaths.length - 1}
                        >
                          <i className="fa-solid fa-chevron-right text-sm" />
                        </button>
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10">
                          {parsedMediaPaths.map((_, idx) => (
                            <button
                              key={idx}
                              className={`w-2 h-2 rounded-full transition-colors ${idx === mediaCarouselIndex ? 'bg-white' : 'bg-white/40'}`}
                              onClick={() => setMediaCarouselIndex(idx)}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ) : post.image_path ? (
                  <div className="px-0">
                    <ImageLoader
                      src={normalizePath(post.image_path as string)}
                      alt={t('feed.post_image_alt')}
                      className="block mx-auto max-w-full max-h-[520px] rounded border border-white/10 cursor-zoom-in"
                      onClick={()=> setPreviewSrc(normalizePath(post.image_path as string))}
                    />
                  </div>
                ) : post.video_path ? (
                  <div className="px-3">
                    <video
                      className="w-full max-h-[420px] rounded border border-white/10 bg-black"
                      src={normalizePath(post.video_path) + '#t=0.1'}
                      controls
                      playsInline
                      preload="metadata"
                    />
                  </div>
                ) : null}
                {post.audio_path ? (
                  <div className="px-3 space-y-2">
                    {post.audio_summary ? (
                      <EditableAISummary
                        postId={post.id}
                        initialSummary={post.audio_summary}
                        isOwner={post.username === currentUser?.username}
                        onSummaryUpdate={(newSummary) => {
                          setPost(prev => prev ? {...prev, audio_summary: newSummary} as any : null);
                        }}
                      />
                    ) : (() => {
                      const timestampMs = parseFlexibleDate(post.timestamp)?.getTime()
                      if (timestampMs != null && !Number.isNaN(timestampMs) && Date.now() - timestampMs < 120000) {
                        return (
                          <div className="flex items-center gap-1 py-1">
                            <i className="fa-solid fa-wand-magic-sparkles text-[10px] text-white/40" />
                            <span className="text-[12px] text-white/40">{t('feed.steve_summary_generating')}</span>
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
                        <img src={editMediaPreview} alt={t('feed.new_media_alt')} className="w-full max-h-48 object-contain block" />
                      )
                    ) : post.video_path ? (
                      <video src={normalizePath(post.video_path)} className="w-full max-h-48 object-contain bg-black block" controls />
                    ) : post.image_path ? (
                      <img src={normalizePath(post.image_path as string)} alt={t('feed.current_media_alt')} className="w-full max-h-48 object-contain block" />
                    ) : null}
                    <button
                      type="button"
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white hover:bg-black flex items-center justify-center"
                      onClick={() => {
                        clearEditMedia()
                        setRemoveMedia(true)
                      }}
                      title={t('feed.remove_media')}
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
                    <i className="fa-solid fa-image mr-1" /> {editMediaFile ? t('feed.change_media') : t('feed.add_media')}
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
                    {t('common.save')}
                  </button>
                  <button 
                    className="px-3 py-1.5 rounded-md border border-white/10" 
                    onClick={cancelEditPost}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs px-3">
              {/* Reactions */}
              <Reaction icon="fa-regular fa-heart" count={post.reactions?.['heart']||0} active={post.user_reaction==='heart'} onClick={()=> toggleReaction('heart')} />
              <Reaction icon="fa-regular fa-thumbs-up" count={post.reactions?.['thumbs-up']||0} active={post.user_reaction==='thumbs-up'} onClick={()=> toggleReaction('thumbs-up')} />
              <Reaction icon="fa-regular fa-thumbs-down" count={post.reactions?.['thumbs-down']||0} active={post.user_reaction==='thumbs-down'} onClick={()=> toggleReaction('thumbs-down')} />
              {/* View count - opens viewers/reactors modal */}
              <button 
                className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-[#9fb0b5] hover:text-white hover:bg-white/10 transition-colors"
                onClick={openReactorsModal}
                title={t('feed.view_reactions_viewers')}
              >
                <i className="fa-regular fa-eye text-[11px]" />
                <span>{typeof post.view_count === 'number' ? post.view_count : 0}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-white/10">
          {/* Top-level + Steve AI replies (Steve has parent_reply_id in DB but should appear in this list) */}
          {post.replies.filter(r => isReplyRowTopLevel(r)).map(r => (
            <ReplyNodeMemo
              key={r.id}
              reply={r}
              currentUser={currentUser?.username || null}
              onToggle={(id, reaction)=> toggleReplyReaction(id, reaction)}
              onInlineReply={(id, text, file, voiceSec)=> submitInlineReply(id, text, file, voiceSec)}
              onReplyAudioSummaryUpdate={patchReplyAudioSummary}
              onDelete={(id)=> deleteReply(id)}
              onPreviewImage={(src)=> setPreviewSrc(src)}
              inlineSendingFlag={!!inlineSending[r.id]}
              communityId={(post as any)?.community_id}
              postId={post?.id}
              activeInlineReplyFor={activeInlineReplyFor}
              onSetActiveInlineReply={setActiveInlineReplyFor}
              onNavigateToReply={onNavigateToReply}
              onOpenReactors={openReplyReactorsModal}
              onArticleOpen={openArticleReader}
            />
          ))}
          {/* Steve is typing indicator */}
          {steveIsTyping && (
            <div className="px-4 py-3 border-t border-white/10 flex items-center gap-2 text-xs text-white/60">
              <span className="font-medium text-[#4db6ac]">Steve</span>
              <span>{t('feed.is_typing')}</span>
              <span className="inline-flex gap-0.5">
                <span className="w-1 h-1 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
      {/* Image preview modal */}
          {previewSrc ? (
        <div 
          className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-sm flex items-center justify-center" 
          onClick={() => setPreviewSrc(null)}
        >
          <button className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white flex items-center justify-center z-10" onClick={()=> setPreviewSrc(null)} aria-label={t('feed.close_preview')}>
            <i className="fa-solid fa-xmark" />
          </button>
          <div className="w-[94vw] h-[86vh] max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <ZoomableImage src={previewSrc} alt={t('feed.preview_alt', { number: '' })} className="w-full h-full" onRequestClose={()=> setPreviewSrc(null)} />
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
                      <img src={filePreviewUrl} alt={t('feed.preview_alt', { number: '' })} className="w-full h-full object-cover" />
                    ) : null}
                  </div>
                  <button 
                    onPointerDown={preventComposerBlur}
                    onClick={() => { setFile(null); setUploadFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                    className="text-red-400 hover:text-red-300"
                    aria-label={t('feed.remove_file')}
                  >
                    <i className="fa-solid fa-times" />
                  </button>
                </div>
              )}
              {replyGif && (
                <div className="flex items-center gap-2">
                  <div className="w-12 h-12 rounded-md overflow-hidden border border-white/10">
                    <img src={replyGif.previewUrl} alt={t('feed.selected_gif_alt')} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                  <button
                    onPointerDown={preventComposerBlur}
                    onClick={() => { setReplyGif(null) }}
                    className="text-red-400 hover:text-red-300"
                    aria-label={t('feed.remove_gif')}
                  >
                    <i className="fa-solid fa-times" />
                  </button>
                </div>
              )}
              {replyPreview && (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <audio controls className="flex-1 h-8" playsInline webkit-playsinline="true" src={replyPreview.url} />
                  <button 
                    onPointerDown={preventComposerBlur}
                    onClick={() => { clearReplyPreview(); }}
                    className="text-[#9fb0b5] hover:text-white"
                    aria-label={t('feed.remove_audio')}
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
          <div className="flex min-w-0 items-end gap-1.5">
            {/* Attachment + button with dropdown */}
            <div className="relative">
              <button 
                type="button" 
                className="w-9 h-9 flex-none flex items-center justify-center rounded-xl bg-white/12 hover:bg-white/22 active:bg-white/28 transition-all"
                onPointerDown={preventComposerBlur}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowAttachMenu(!showAttachMenu)}
                aria-label={t('feed.add_attachment')}
              >
                <i className={`fa-solid ${showAttachMenu ? 'fa-times' : 'fa-plus'} text-sm`} style={{ color: (file || replyGif) ? '#7fe7df' : '#fff' }} />
              </button>
              
              {/* Attachment dropdown menu */}
              {showAttachMenu && (
                <div className="absolute bottom-full left-0 mb-2 w-40 rounded-xl bg-[#1a1a1c] border border-white/10 shadow-xl overflow-hidden z-10">
                  <button
                    type="button"
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/10 transition-colors text-left"
                    onPointerDown={preventComposerBlur}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      fileInputRef.current?.click()
                      setShowAttachMenu(false)
                    }}
                  >
                    <i className="fa-solid fa-image text-[#4db6ac]" />
                    <span className="text-sm text-white">{t('feed.photo_video')}</span>
                  </button>
                  <button
                    type="button"
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/10 transition-colors text-left border-t border-white/5"
                    onPointerDown={preventComposerBlur}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setGifPickerOpen(true)
                      setShowAttachMenu(false)
                    }}
                  >
                    <i className="fa-solid fa-images text-[#4db6ac]" />
                    <span className="text-sm text-white">GIF</span>
                  </button>
                </div>
              )}
            </div>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              onChange={(e) => {
                const next = (e.target as HTMLInputElement).files?.[0] || null
                setFile(next)
                setUploadFile(null)
                setReplyGif(null)
              }}
              className="hidden"
            />

            {/* Message input container with turquoise border */}
            <div className="flex-1 min-w-0 flex items-center rounded-lg border border-[#4db6ac] bg-white/8">
              <MentionTextarea
                value={content}
                onChange={setContent}
                communityId={(post as any)?.community_id}
                postId={post?.id}
                placeholder={t('feed.write_reply_placeholder')}
                className="bg-transparent px-3 py-2 text-[15px] text-white placeholder-white/50 outline-none resize-none max-h-24 min-h-[36px]"
                rows={1}
                autoExpand
                perfDegraded={!!uploadFile}
              />
            </div>

            <button
              type="button"
              className="w-9 h-9 flex-none flex items-center justify-center rounded-xl bg-white/12 hover:bg-white/22 active:bg-white/28 transition-all"
              onPointerDown={preventComposerBlur}
              onMouseDown={(e) => e.preventDefault()}
              onClick={openExpandedReplyComposer}
              aria-label={t('feed.expand_reply_composer')}
              title={t('feed.expand_reply_composer')}
            >
              <i className="fa-solid fa-up-right-and-down-left-from-center text-xs text-white" />
            </button>

            {/* Mic button - when not recording and no text */}
            {!recording && !content.trim() && (
              <button
                type="button"
                className="w-9 h-9 flex-none flex items-center justify-center rounded-xl bg-white/12 hover:bg-white/22 active:bg-white/28 transition-all"
                onPointerDown={preventComposerBlur}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => startRec()}
                aria-label={t('feed.record_audio')}
              >
                <i className="fa-solid fa-microphone text-sm text-white" />
              </button>
            )}

            {/* Stop recording button */}
            {recording && (
              <button
                type="button"
                className="w-9 h-9 flex-none flex items-center justify-center rounded-xl bg-[#4db6ac] text-white transition-all"
                onPointerDown={preventComposerBlur}
                onMouseDown={(e) => e.preventDefault()}
                onClick={async () => {
                  const p = await stopRec()
                  if (!p?.blob?.size) {
                    alert(t('feed.audio_capture_minimum'))
                  }
                }}
                aria-label={t('feed.stop_recording')}
              >
                <i className="fa-solid fa-stop text-sm" />
              </button>
            )}

            {/* Send button - when has content or attachment */}
            {!recording && (content.trim() || file || replyPreview || replyGif) && (
              <button
                type="button"
                className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-[#4db6ac] text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 transition-opacity"
                onPointerDown={preventComposerBlur}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => submitReply()}
                aria-label={t('feed.send_reply')}
                disabled={submittingReply}
              >
                <span className="inline-flex h-5 w-5 items-center justify-center" aria-hidden>
                  {submittingReply ? <i className="fa-solid fa-spinner fa-spin text-sm" /> : <i className="fa-solid fa-paper-plane text-sm" />}
                </span>
              </button>
            )}
          </div>
        </div>
        {/* Safe area spacer — always reserve a minimum so the Send button never collides with the home indicator, even if keyboard dismissal races. */}
        <div 
          style={{
            height: showKeyboard
              ? 'max(env(safe-area-inset-bottom, 0px), 6px)'
              : 'max(env(safe-area-inset-bottom, 0px), 12px)',
            background: '#000',
            flexShrink: 0,
          }}
        />
      </div>
      )}
      {replyComposerExpanded && (
        <div
          className="fixed inset-0 z-[300] bg-black/90 backdrop-blur"
          role="dialog"
          aria-modal="true"
          aria-labelledby="expanded-reply-composer-title"
          onClick={(e) => e.currentTarget === e.target && setReplyComposerExpanded(false)}
        >
          <div
            ref={expandedComposerRef}
            className="absolute left-0 right-0 mx-auto flex max-w-2xl flex-col overflow-hidden bg-black text-white sm:rounded-3xl sm:bg-[#050607]/95"
            style={{
              top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
              bottom: showKeyboard
                ? `${Math.max(8, keyboardLift + 8)}px`
                : 'max(env(safe-area-inset-bottom, 0px), 12px)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 px-5 pb-4 pt-2">
              <div className="min-w-0">
                <h2 id="expanded-reply-composer-title" className="text-base font-semibold">
                  {t('feed.write_reply_modal_title')}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-[#9fb0b5]">
                  {t('feed.write_reply_modal_hint')}
                </p>
              </div>
              <button
                type="button"
                className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                onClick={() => setReplyComposerExpanded(false)}
                aria-label={t('feed.close_reply_composer')}
              >
                <i className="fa-solid fa-xmark text-sm" />
              </button>
            </header>

            {(file || replyGif || replyPreview) && (
              <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
                {file && (
                  <div className="flex items-center gap-2 rounded-2xl bg-white/[0.06] px-2 py-2">
                    <div className="h-12 w-12 overflow-hidden rounded-md border border-white/10">
                      {filePreviewUrl ? (
                        <img src={filePreviewUrl} alt={t('feed.preview_alt', { number: '' })} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-white/50">
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
                {replyGif && (
                  <div className="flex items-center gap-2 rounded-2xl bg-white/[0.06] px-2 py-2">
                    <div className="h-12 w-12 overflow-hidden rounded-md border border-white/10">
                      <img src={replyGif.previewUrl} alt={t('feed.selected_gif_alt')} className="h-full w-full object-cover" loading="lazy" />
                    </div>
                    <button
                      type="button"
                      className="text-red-400 hover:text-red-300"
                      onClick={() => setReplyGif(null)}
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
                      className="text-[#9fb0b5] hover:text-white"
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
              <div className="flex min-h-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.035] transition-colors focus-within:border-[#4db6ac]/60">
                <MentionTextarea
                  value={content}
                  onChange={setContent}
                  communityId={(post as any)?.community_id}
                  postId={post?.id}
                  placeholder={t('feed.write_reply_placeholder')}
                  className="h-full min-h-[48vh] resize-none overflow-y-auto bg-transparent px-4 py-4 text-[16px] leading-relaxed text-white outline-none placeholder-white/45"
                  rows={10}
                  perfDegraded={!!uploadFile}
                />
              </div>
            </div>

            <footer className="flex items-center justify-between gap-3 px-5 pb-2 pt-1">
              <button
                type="button"
                className="rounded-full px-2 py-2 text-sm font-medium text-[#9fb0b5] transition hover:text-white"
                onClick={() => setReplyComposerExpanded(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-full bg-[#4db6ac] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_28px_rgba(77,182,172,0.22)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => submitReply()}
                disabled={submittingReply || (!content.trim() && !file && !replyPreview && !replyGif)}
              >
                {submittingReply ? <i className="fa-solid fa-spinner fa-spin text-sm" /> : <i className="fa-solid fa-paper-plane text-sm" />}
                <span>{t('feed.send_reply')}</span>
              </button>
            </footer>
          </div>
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

      {/* Hide Post Modal */}
      {showHideModal && (
        <div 
          className="fixed inset-0 z-[200] bg-black/80 backdrop-blur flex items-center justify-center p-4"
          onClick={(e) => e.currentTarget === e.target && setShowHideModal(false)}
        >
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0b0f10] p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
                <i className="fa-solid fa-eye-slash text-orange-400" />
              </div>
              <div className="font-semibold text-lg text-white">{t('feed.hide_post')}</div>
            </div>
            <p className="text-sm text-[#9fb0b5] mb-5">
              {t('feed.hide_post_body')}
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="w-full py-2.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 font-medium hover:bg-red-500/30 transition-colors"
                onClick={() => hidePost(true)}
              >
                {t('feed.hide_report_post')}
              </button>
              <button
                className="w-full py-2.5 rounded-lg bg-red-600/20 text-red-300 border border-red-600/30 font-medium hover:bg-red-600/30 transition-colors"
                onClick={() => {
                  setShowHideModal(false)
                  setShowBlockModal(true)
                }}
              >
                <i className="fa-solid fa-ban mr-2" />
                {t('feed.block_user', { username: post.username })}
              </button>
              <button
                className="w-full py-2.5 rounded-lg bg-white/10 text-white border border-white/10 font-medium hover:bg-white/15 transition-colors"
                onClick={() => hidePost(false)}
              >
                {t('feed.just_hide_post')}
              </button>
              <button
                className="w-full py-2.5 rounded-lg text-[#9fb0b5] hover:text-white transition-colors"
                onClick={() => setShowHideModal(false)}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Block User Modal */}
      {showBlockModal && (
        <div 
          className="fixed inset-0 z-[200] bg-black/80 backdrop-blur flex items-center justify-center p-4"
          onClick={(e) => e.currentTarget === e.target && !blockSubmitting && setShowBlockModal(false)}
        >
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0b0f10] p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <i className="fa-solid fa-ban text-red-400" />
              </div>
              <div className="font-semibold text-lg text-white">{t('feed.block_user', { username: post.username })}</div>
            </div>
            <p className="text-sm text-[#9fb0b5] mb-4">
              {t('feed.block_user_body')}
            </p>
            <ul className="text-sm text-[#9fb0b5] mb-4 space-y-1 pl-4">
              <li>• {t('feed.block_user_effect_hide_posts')}</li>
              <li>• {t('feed.block_user_effect_messages')}</li>
              <li>• {t('feed.block_user_effect_moderation')}</li>
              <li>• {t('feed.block_user_effect_settings')}</li>
            </ul>
            
            <div className="mb-4">
              <label className="block text-sm text-[#9fb0b5] mb-2">{t('feed.block_reason_label')}</label>
              <select
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-red-500/50"
                disabled={blockSubmitting}
              >
                <option value="">{t('feed.select_reason')}</option>
                <option value="Harassment">{t('feed.report_reason_harassment')}</option>
                <option value="Spam">{t('feed.report_reason_spam')}</option>
                <option value="Offensive content">{t('feed.report_reason_offensive')}</option>
                <option value="Threats">{t('feed.report_reason_threats')}</option>
                <option value="Other">{t('feed.report_reason_other')}</option>
              </select>
            </div>

            <div className="flex gap-3">
              <button
                className="flex-1 py-2.5 rounded-lg border border-white/10 text-white hover:bg-white/5 transition-colors"
                onClick={() => {
                  setShowBlockModal(false)
                  setBlockReason('')
                }}
                disabled={blockSubmitting}
              >
                {t('common.cancel')}
              </button>
              <button
                className="flex-1 py-2.5 rounded-lg bg-red-500 text-white font-medium hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => blockUser(!!blockReason)}
                disabled={blockSubmitting}
              >
                {blockSubmitting ? t('feed.blocking') : t('feed.block_user_action')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report Post Modal */}
      {showReportModal && (
        <div 
          className="fixed inset-0 z-[200] bg-black/80 backdrop-blur flex items-center justify-center p-4"
          onClick={(e) => e.currentTarget === e.target && !reportSubmitting && setShowReportModal(false)}
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b0f10] p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <i className="fa-solid fa-flag text-red-400" />
              </div>
              <div className="font-semibold text-lg text-white">{t('feed.report_post')}</div>
            </div>
            <p className="text-sm text-[#9fb0b5] mb-4">
              {t('feed.report_post_body')}
            </p>
            
            <div className="space-y-2 mb-4">
              {[
                ['Spam or misleading', t('feed.report_reason_spam_misleading')],
                ['Harassment or bullying', t('feed.report_reason_harassment')],
                ['Hate speech', t('feed.report_reason_hate')],
                ['Violence or threats', t('feed.report_reason_violence')],
                ['Explicit content', t('feed.report_reason_explicit')],
                ['Other', t('feed.report_reason_other')],
              ].map(([reason, label]) => (
                <button
                  key={reason}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                    reportReason === reason 
                      ? 'border-red-500/50 bg-red-500/10 text-white' 
                      : 'border-white/10 bg-white/5 text-[#9fb0b5] hover:bg-white/10'
                  }`}
                  onClick={() => setReportReason(reason)}
                  disabled={reportSubmitting}
                >
                  {label}
                </button>
              ))}
            </div>

            {reportReason && (
              <div className="mb-4">
                <label className="block text-sm text-[#9fb0b5] mb-2">{t('feed.additional_details_optional')}</label>
                <textarea
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  placeholder={t('feed.report_details_placeholder')}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/40 focus:outline-none focus:border-red-500/50 resize-none"
                  rows={3}
                  disabled={reportSubmitting}
                />
              </div>
            )}

            <div className="flex gap-3">
              <button
                className="flex-1 py-2.5 rounded-lg border border-white/10 text-white hover:bg-white/5 transition-colors"
                onClick={() => {
                  setShowReportModal(false)
                  setReportReason('')
                  setReportDetails('')
                }}
                disabled={reportSubmitting}
              >
                {t('common.cancel')}
              </button>
              <button
                className="flex-1 py-2.5 rounded-lg bg-red-500 text-white font-medium hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={reportPost}
                disabled={!reportReason || reportSubmitting}
              >
                {reportSubmitting ? t('feed.submitting') : t('feed.submit_report')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Viewers/Reactors Modal */}
      {showReactorsModal && (
        <div
          className="fixed inset-0 z-[95] bg-black/70 backdrop-blur flex items-center justify-center"
          onClick={(e) => e.currentTarget === e.target && closeReactorsModal()}
        >
          <div className="w-[92%] max-w-[560px] rounded-2xl border border-white/10 bg-black p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">{t('feed.views_reactions')}</div>
              <button
                className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-sm text-white/80 hover:bg-white/10"
                onClick={closeReactorsModal}
                aria-label={t('common.close')}
              >
                <span className="leading-none">✕</span>
              </button>
            </div>
            {reactorsLoading ? (
              <div className="text-[#9fb0b5] text-sm py-4 text-center">{t('common.loading')}</div>
            ) : (
              <div className="space-y-3 max-h-[420px] overflow-y-auto">
                {/* Views section */}
                <div className="rounded-lg border border-white/10 p-2">
                  <div className="flex items-center justify-between text-xs text-white/80 uppercase tracking-wide">
                    <span>{t('feed.views')}</span>
                    <span className="text-sm font-semibold text-white">{reactorViewCount ?? 0}</span>
                  </div>
                  {reactorViewers.length === 0 ? (
                    <div className="mt-2 text-xs text-[#9fb0b5]">{t('feed.no_views_yet')}</div>
                  ) : (
                    <div className="mt-2 flex flex-col gap-1">
                      {reactorViewers.map((viewer) => {
                        const viewedLabel = formatViewerRelative(viewer.viewed_at)
                        return (
                          <div
                            key={`viewer-${viewer.username}-${viewer.viewed_at ?? ''}`}
                            className="flex items-center gap-2 text-xs text-[#9fb0b5]"
                          >
                            <Avatar
                              username={viewer.username}
                              url={viewer.profile_picture || undefined}
                              size={18}
                              linkToProfile
                            />
                            <div className="flex-1 truncate">@{viewer.username}</div>
                            {viewedLabel && <div className="text-[10px] text-white/40">{viewedLabel}</div>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
                {/* Reactions section */}
                {reactorGroups.length === 0 ? (
                  <div className="text-sm text-[#9fb0b5]">{t('feed.no_reactions_yet')}</div>
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

      {/* Reply Viewers/Reactors Modal */}
      {showReplyReactorsModal && (
        <div
          className="fixed inset-0 z-[95] bg-black/70 backdrop-blur flex items-center justify-center"
          onClick={(e) => e.currentTarget === e.target && setShowReplyReactorsModal(false)}
        >
          <div className="w-[92%] max-w-[560px] rounded-2xl border border-white/10 bg-black p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">{t('feed.views_reactions')}</div>
              <button
                className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-sm text-white/80 hover:bg-white/10"
                onClick={() => setShowReplyReactorsModal(false)}
                aria-label={t('common.close')}
              >
                <span className="leading-none">✕</span>
              </button>
            </div>
            {replyReactorsLoading ? (
              <div className="text-[#9fb0b5] text-sm py-4 text-center">{t('common.loading')}</div>
            ) : (
              <div className="space-y-3 max-h-[420px] overflow-y-auto">
                <div className="rounded-lg border border-white/10 p-2">
                  <div className="flex items-center justify-between text-xs text-white/80 uppercase tracking-wide">
                    <span>{t('feed.views')}</span>
                    <span className="text-sm font-semibold text-white">{replyReactorViewCount ?? 0}</span>
                  </div>
                  {replyReactorViewers.length === 0 ? (
                    <div className="mt-2 text-xs text-[#9fb0b5]">{t('feed.no_views_yet')}</div>
                  ) : (
                    <div className="mt-2 flex flex-col gap-1">
                      {replyReactorViewers.map((viewer) => {
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
                {replyReactorGroups.length === 0 ? (
                  <div className="text-sm text-[#9fb0b5]">{t('feed.no_reactions_yet')}</div>
                ) : replyReactorGroups.map((group) => (
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

      {/* Summary Modal */}
      {showSummaryModal && (
        <div 
          className="fixed inset-0 z-[1002] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setShowSummaryModal(false)}
        >
          <div 
            className="bg-[#1a1f25] rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden border border-white/10 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-wand-magic-sparkles text-teal-400" />
                <span className="font-semibold text-white">{t('feed.steve_summary')}</span>
              </div>
              <button 
                className="text-white/60 hover:text-white p-1"
                onClick={() => setShowSummaryModal(false)}
              >
                <i className="fa-solid fa-xmark text-lg" />
              </button>
            </div>
            
            {/* Content */}
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              {summaryLoading && (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-white/60 text-sm">{t('feed.steve_summary_loading')}</span>
                </div>
              )}
              
              {summaryError && (
                <div className="text-red-400 text-sm text-center py-4">
                  <i className="fa-solid fa-exclamation-circle mr-2" />
                  {summaryError}
                </div>
              )}
              
              {summaryText && !summaryLoading && (
                <div className="text-white text-[15px] leading-relaxed whitespace-pre-wrap">
                  {summaryText}
                </div>
              )}
            </div>
            
            {/* Footer */}
            <div className="px-4 py-3 border-t border-white/10">
              <button
                className="w-full py-2.5 rounded-xl bg-[#4db6ac] text-black font-medium hover:brightness-110"
                onClick={() => setShowSummaryModal(false)}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

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
  if (prev.onNavigateToReply !== next.onNavigateToReply) return false
  if (prev.onArticleOpen !== next.onArticleOpen) return false
  if (prev.onReplyAudioSummaryUpdate !== next.onReplyAudioSummaryUpdate) return false
  return true
})

function ReplyNode({ reply, depth=0, currentUser: currentUserName, onToggle, onInlineReply, onDelete, onPreviewImage, inlineSendingFlag, communityId, postId, activeInlineReplyFor, onSetActiveInlineReply, onNavigateToReply, onOpenReactors, onArticleOpen, onReplyAudioSummaryUpdate }:{ reply: Reply, depth?: number, currentUser?: string|null, onToggle: (id:number, reaction:string)=>void, onInlineReply: (id:number, text:string, file?: File, voiceDurationSec?: number)=>void, onDelete: (id:number)=>void, onPreviewImage: (src:string)=>void, inlineSendingFlag: boolean, communityId?: number | string, postId?: number, activeInlineReplyFor?: number | null, onSetActiveInlineReply?: (id: number | null) => void, onNavigateToReply?: (id: number) => void, onOpenReactors?: (id: number) => void, onArticleOpen?: (url: string) => void, onReplyAudioSummaryUpdate?: (replyId: number, summary: string) => void }){
  const { t } = useTranslation()
  const navigate = useNavigate()
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
  const [showInlineAttachMenu, setShowInlineAttachMenu] = useState(false)
  // For X-style, we don't show nested children inline, so no connector line needed
  const hasChildren = false // Was: reply.children && reply.children.length > 0
  useEffect(() => {
    if (!showComposer){
      setShowGifPicker(false)
      setInlineGif(null)
      setGifFile(null)
      setImg(null)
      setShowInlineAttachMenu(false)
      if (inlineFileRef.current) inlineFileRef.current.value = ''
      clearInlinePreview()
    }
  }, [showComposer, clearInlinePreview])
  
  // Close inline attach menu when clicking outside
  useEffect(() => {
    if (!showInlineAttachMenu) return
    const handleClickOutside = () => setShowInlineAttachMenu(false)
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 10)
    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [showInlineAttachMenu])
  return (
    <div data-reply-node className={`relative py-2 ${depth === 0 ? 'border-b border-white/10' : ''} cursor-pointer hover:bg-white/[0.02]`} onClick={() => onNavigateToReply?.(reply.id)}>
      <div className="relative flex items-start gap-2 px-3">
        <div className="relative w-10 flex-shrink-0 self-stretch" style={{ zIndex: 1 }} onClick={(e) => e.stopPropagation()}>
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
              <div onClick={(e) => e.stopPropagation()}>
                <button
                  className="ml-2 px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]"
                  title={t('feed.edit_reply')}
                  onClick={()=> setIsEditing(v=>!v)}
                >
                  <i className="fa-regular fa-pen-to-square" />
                </button>
                <button
                  className="ml-1 px-2 py-1 rounded-full text-[#6c757d] hover:text-red-400"
                  title={t('feed.delete_reply')}
                  onClick={()=> onDelete(reply.id)}
                >
                  <i className="fa-regular fa-trash-can" />
                </button>
              </div>
            ) : null}
          </div>
          {!isEditing ? (
            <div className="text-[#dfe6e9] whitespace-pre-wrap mt-0.5 break-words">{renderRichText(reply.content, false, (u) => navigate(`/profile/${encodeURIComponent(u)}`), onArticleOpen)}</div>
          ) : (
            <div className="mt-1" onClick={(e) => e.stopPropagation()}>
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
                    alert(j?.error || t('feed.edit_failed'))
                  }
                }}>{t('common.save')}</button>
                <button className="px-3 py-1.5 rounded-md border border-white/10" onClick={()=> { setIsEditing(false); setEditText(reply.content) }}>{t('common.cancel')}</button>
              </div>
            </div>
          )}
          {reply.image_path && !isVideoAttachmentPath(reply.image_path) ? (
            <div className="mt-2 flex justify-center" onClick={(e) => e.stopPropagation()}>
              <div onClick={()=> onPreviewImage(normalizePath(reply.image_path as string))}>
                <ImageLoader
                  src={normalizePath(reply.image_path as string)}
                  alt={t('feed.reply_image_alt')}
                  className="block mx-auto max-w-full max-h-[300px] rounded border border-white/10 cursor-zoom-in"
                />
              </div>
            </div>
          ) : null}
          {(reply.video_path || (reply.image_path && isVideoAttachmentPath(reply.image_path))) ? (
            <div className="mt-2" onClick={(e) => e.stopPropagation()}>
              <video
                className="w-full max-h-[320px] rounded border border-white/10 bg-black"
                src={normalizePath((reply.video_path || reply.image_path) as string) + '#t=0.1'}
                controls
                playsInline
                preload="metadata"
              />
            </div>
          ) : null}
          {(reply as any)?.audio_path ? (
            <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
              {reply.audio_summary ? (
                <EditableAISummary
                  replyId={reply.id}
                  initialSummary={reply.audio_summary}
                  isOwner={currentUser === reply.username || currentUser === 'admin'}
                  onSummaryUpdate={(newSummary) => onReplyAudioSummaryUpdate?.(reply.id, newSummary)}
                />
              ) : (() => {
                const timestampMs = parseFlexibleDate(reply.timestamp)?.getTime()
                if (timestampMs != null && !Number.isNaN(timestampMs) && Date.now() - timestampMs < 120000) {
                  return (
                    <div className="flex items-center gap-1">
                      <i className="fa-solid fa-wand-magic-sparkles text-[9px] text-white/40" />
                      <span className="text-[11px] text-white/40">{t('feed.steve_summary_generating')}</span>
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
              <audio controls className="w-full" playsInline webkit-playsinline="true" src={(() => {
                const path = normalizePath((reply as any).audio_path as string);
                const separator = path.includes('?') ? '&' : '?';
                return `${path}${separator}_cb=${Date.now()}`;
              })()} />
            </div>
          ) : null}
          <div className="mt-1 flex items-center gap-2 text-[11px]" onClick={(e) => e.stopPropagation()}>
            <Reaction icon="fa-regular fa-heart" count={reply.reactions?.['heart']||0} active={reply.user_reaction==='heart'} onClick={()=> onToggle(reply.id, 'heart')} />
            <Reaction icon="fa-regular fa-thumbs-up" count={reply.reactions?.['thumbs-up']||0} active={reply.user_reaction==='thumbs-up'} onClick={()=> onToggle(reply.id, 'thumbs-up')} />
            <Reaction icon="fa-regular fa-thumbs-down" count={reply.reactions?.['thumbs-down']||0} active={reply.user_reaction==='thumbs-down'} onClick={()=> onToggle(reply.id, 'thumbs-down')} />
            <div className="ml-auto flex items-center gap-1">
              {onOpenReactors && (
                <button
                  className="flex items-center gap-1 px-2 py-1 rounded text-[#9fb0b5] hover:text-white hover:bg-white/10 transition-colors"
                  onClick={(e) => { e.stopPropagation(); onOpenReactors(reply.id) }}
                  title={t('feed.view_reactions_viewers')}
                >
                  <i className="fa-regular fa-eye text-[10px]" />
                  <span>{typeof reply.view_count === 'number' ? reply.view_count : 0}</span>
                </button>
              )}
              <button className="px-2 py-1 rounded-full text-[#9fb0b5] hover:text-[#4db6ac]" onClick={(e)=> {
                e.stopPropagation()
                setShowComposer(v => !v)
                setTimeout(() => {
                  const target = e.currentTarget.closest('[data-reply-node]')
                  target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }, 100)
              }}>{t('feed.reply')}</button>
            </div>
          </div>
        </div>
      </div>
      {/* Inline reply composer - full width outside the avatar+content flex */}
      {showComposer ? (
        <div className="mt-2 mx-3 space-y-2 rounded-xl bg-[#0a0a0c] p-3" data-inline-reply-id={reply.id} onClick={(e) => e.stopPropagation()}>
          {/* Attachment previews */}
          {(img || inlineGif || inlinePreview) && (
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {img && (
                <div className="flex items-center gap-1">
                  <div className="w-10 h-10 rounded overflow-hidden border border-white/10">
                    <img src={URL.createObjectURL(img)} alt={t('feed.preview_alt', { number: '' })} className="w-full h-full object-cover" />
                  </div>
                  <button onClick={() => { setImg(null); setInlineGif(null); setGifFile(null); if (inlineFileRef.current) inlineFileRef.current.value = '' }} className="text-red-400 hover:text-red-300 text-xs"><i className="fa-solid fa-times" /></button>
                </div>
              )}
              {inlineGif && (
                <div className="flex items-center gap-1">
                  <div className="w-10 h-10 rounded overflow-hidden border border-white/10">
                    <img src={inlineGif.previewUrl} alt={t('feed.selected_gif_alt')} className="w-full h-full object-cover" loading="lazy" />
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
          <div className="flex min-w-0 items-end gap-1.5">
            {/* + button with dropdown */}
            <div className="relative">
              <button 
                type="button" 
                className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"
                onClick={() => setShowInlineAttachMenu(!showInlineAttachMenu)}
              >
                <i className={`fa-solid ${showInlineAttachMenu ? 'fa-times' : 'fa-plus'} text-xs`} style={{ color: (img || inlineGif) ? '#7fe7df' : '#fff' }} />
              </button>
              
              {showInlineAttachMenu && (
                <div className="absolute bottom-full left-0 mb-2 w-36 rounded-xl bg-[#1a1a1c] border border-white/10 shadow-xl overflow-hidden z-10">
                  <button
                    type="button"
                    className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/10 transition-colors text-left"
                    onClick={() => {
                      inlineFileRef.current?.click()
                      setShowInlineAttachMenu(false)
                    }}
                  >
                    <i className="fa-solid fa-image text-[#4db6ac] text-xs" />
                    <span className="text-xs text-white">{t('feed.photo_video')}</span>
                  </button>
                  <button
                    type="button"
                    className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/10 transition-colors text-left border-t border-white/5"
                    onClick={() => {
                      setShowGifPicker(true)
                      setShowInlineAttachMenu(false)
                    }}
                  >
                    <i className="fa-solid fa-images text-[#4db6ac] text-xs" />
                    <span className="text-xs text-white">GIF</span>
                  </button>
                </div>
              )}
            </div>
            
            <input ref={inlineFileRef} type="file" accept="image/*,video/*" onChange={(e) => { const next = (e.target as HTMLInputElement).files?.[0] || null; setImg(next); setInlineGif(null); setGifFile(null) }} className="hidden" />
            
            <div className="flex-1 min-w-0 flex items-center rounded-lg border border-[#4db6ac] bg-white/5">
              <MentionTextarea
                value={text}
                onChange={setText}
                communityId={communityId}
                postId={postId}
                placeholder={t('feed.reply_to_user', { username: reply.username })}
                className="bg-transparent px-3 py-2 text-[14px] text-white placeholder-white/50 outline-none resize-none max-h-20 min-h-[36px]"
                rows={1}
                autoExpand
              />
            </div>
            
            {/* Recording in progress - show stop button */}
            {rec && (
              <button
                type="button"
                className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg bg-[#4db6ac]"
                onClick={async () => {
                  const p = await stopInlineRec()
                  if (!p?.blob?.size) {
                    alert(t('feed.audio_capture_minimum_short'))
                  }
                }}
              >
                <i className="fa-solid fa-stop text-xs text-white" />
              </button>
            )}
            
            {/* Not recording - show mic or send based on content */}
            {!rec && (
              <>
                {/* Has content - show send button */}
                {(text.trim() || img || inlinePreview || gifFile) ? (
                  <button 
                    type="button"
                    className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#4db6ac] disabled:opacity-50 transition-opacity"
                    disabled={inlineSendingFlag}
                    onClick={() => {
                      if (!text && !img && !inlinePreview && !gifFile) return
                      const attachment = inlinePreview
                        ? new File([inlinePreview.blob], inlinePreview.blob.type.includes('mp4') ? 'audio.mp4' : 'audio.webm', { type: inlinePreview.blob.type })
                        : (img || gifFile || undefined)
                      const voiceSec = inlinePreview
                        ? ((inlinePreview as { duration?: number }).duration ?? (recMs / 1000))
                        : undefined
                      onInlineReply(reply.id, text, attachment as any, voiceSec)
                      setText('')
                      setImg(null)
                      setInlineGif(null)
                      setGifFile(null)
                      if (inlineFileRef.current) inlineFileRef.current.value = ''
                      clearInlinePreview()
                      setShowComposer(false)
                    }}
                  >
                    <span className="inline-flex size-3.5 items-center justify-center text-white" aria-hidden>
                      {inlineSendingFlag ? <i className="fa-solid fa-spinner fa-spin text-xs" /> : <i className="fa-solid fa-paper-plane text-xs" />}
                    </span>
                  </button>
                ) : (
                  /* No content - show mic button */
                  <button type="button" className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20" onClick={() => startInlineRec()}>
                    <i className="fa-solid fa-microphone text-xs text-white" />
                  </button>
                )}
              </>
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
                alert(t('feed.gif_attach_failed'))
              } finally {
                setShowGifPicker(false)
              }
            }}
          />
        </div>
      ) : null}
      {/* Show reply count link instead of nested replies (X-style) */}
      {((reply as any).reply_count > 0 || (reply.children && reply.children.length > 0)) ? (
        <div className="px-3 pb-2">
          <button
            className="text-[12px] text-[#4db6ac] hover:underline flex items-center gap-1"
            onClick={(e) => {
              e.stopPropagation()
              if (onNavigateToReply) onNavigateToReply(reply.id)
              else window.location.href = `/reply/${reply.id}`
            }}
          >
            <i className="fa-regular fa-comment text-[11px]" />
            {t('feed.reply_count', { count: (reply as any).reply_count || reply.children?.length || 0 })}
          </button>
        </div>
      ) : null}
    </div>
  )
}