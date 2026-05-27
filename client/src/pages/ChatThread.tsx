import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { useEntitlements } from '../hooks/useEntitlements'
import {
  buildClientPremiumRequiredError,
  shouldClientBlockSteveIntent,
} from '../utils/steveClientGate'
import { useAudioRecorder } from '../components/useAudioRecorder'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useHeader } from '../contexts/HeaderContext'
import { useBadges } from '../contexts/BadgeContext'
import { useUserProfile } from '../contexts/UserProfileContext'
import { useEntitlementsHandler } from '../contexts/EntitlementsContext'
import { isEntitlementsError } from '../utils/entitlementsError'
import Avatar from '../components/Avatar'
import ZoomableImage from '../components/ZoomableImage'
// Encryption removed — not in use
import GifPicker from '../components/GifPicker'
import type { GifSelection } from '../components/GifPicker'
import { gifSelectionToFile } from '../utils/gif'
import { requestTranslateSummary } from '../utils/translateSummary'
import { readDeviceCache, writeDeviceCache, clearDeviceCache } from '../utils/deviceCache'
import {
  threadsListCacheKey,
  dmConversationOfflineKey,
  dmUserIdKeyvalKey,
  chatMessagesDeviceCacheKey,
  chatProfileDeviceCacheKey,
} from '../utils/chatThreadsCache'
import { sendImageMessage, sendVideoMessage, sendMultiMediaMessage, sendDocumentMessage, SENDING_MEDIA_LABEL, type UploadProgress } from '../chat/mediaSenders'
import type { ChatMessage } from '../types/chat'

// Import utilities and components from chat module
import {
  parseMessageTime,
  ensureNormalizedTime,
  getMessageTimestamp,
  readMessageMeta,
  writeMessageMeta,
  formatDateLabel,
  getDateKey,
  normalizeMediaPath,
  setMessageReaction,
  getAllMessageReactions,
  CHAT_CACHE_TTL_MS,
  CHAT_CACHE_VERSION,
  MessageBubble,
  useChatThreadChrome,
  ChatSelectionBar,
  NewMessagesChip,
  SwipeToReply,
  useResumeOutboxDrain,
  chatHapticSend,
  ChatAttachMenuRow,
  useDmMessagePoll,
  ChatMediaPreviewModal,
  ChatMediaViewerModal,
  ChatComposerPortal,
  ChatComposerCard,
  ChatVirtualMessageList,
} from '../chat'
import { NativeIconButton } from '../components/NativeIconButton'
import { mentionsSteve } from '../utils/steveClientGate'
import SteveTypingIndicator from '../components/chat/SteveTypingIndicator'
import { cacheMessages, getCachedMessages, cacheKeyVal, getCachedKeyVal, addToOutbox, removeFromOutbox, updateOutboxStatus, getOutboxEntries } from '../utils/offlineDb'
import { useNativeStatusBar } from '../hooks/useNativeStatusBar'
import { useAndroidBackButton } from '../hooks/useAndroidBackButton'
import { Style } from '@capacitor/status-bar'
import {
  takePendingShareFilesOnce,
  takePendingShareUrlsOnce,
  releaseShareHandoffKey,
  releaseShareUrlHandoffKey,
} from '../services/shareImportStore'

type Message = ChatMessage

export default function ChatThread(){
  const { t } = useTranslation()
  const { setTitle } = useHeader()
  const { refreshBadges } = useBadges()
  const { profile: myProfile } = useUserProfile()
  const entitlementsHandler = useEntitlementsHandler()
  const { username } = useParams()
  const { entitlements, enforcement_enabled, loading: entitlementsLoading } = useEntitlements()
  const isSteveDm = (username || '').toLowerCase() === 'steve'
  const tryBlockSteveIntentSend = useCallback(
    (text: string) => {
      if (
        !shouldClientBlockSteveIntent({
          enforcement_enabled,
          loading: entitlementsLoading,
          entitlements,
          isSteveDm,
          text,
        })
      ) {
        return false
      }
      entitlementsHandler.showError(buildClientPremiumRequiredError())
      return true
    },
    [enforcement_enabled, entitlementsLoading, entitlements, isSteveDm, entitlementsHandler],
  )
  const viewer = (myProfile as { username?: string } | null)?.username
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const profilePath = username ? `/profile/${encodeURIComponent(username)}` : null
  const mentionToProfile = useCallback((u: string) => {
    navigate(`/profile/${encodeURIComponent(u)}`)
  }, [navigate])
  
  
  
  // Hide the main header - we use our own header in this page
  useEffect(() => { setTitle('') }, [setTitle])
  
  // Scroll state managed by useChatThreadScroll (threadKey = username)

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      const ua = navigator.userAgent || ''
      const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
                            (navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && /MacIntel/.test(navigator.platform))
      setIsMobile(Boolean(isMobileDevice))
    }
    checkMobile()
  }, [])


  const [otherUserId, setOtherUserId] = useState<number|''>('')
  const [messages, setMessages] = useState<Message[]>([])
  const [steveIsTyping, setSteveIsTyping] = useState(false)
  const [editingId, setEditingId] = useState<number|string| null>(null)
  const [editText, setEditText] = useState('')
  const [editingSaving, setEditingSaving] = useState(false)
  const [editingSummaryId, setEditingSummaryId] = useState<number|string|null>(null)
  const [editSummaryText, setEditSummaryText] = useState('')
  const [dmTranslations, setDmTranslations] = useState<Record<string|number, string>>({})
  const [dmTranslatingId, setDmTranslatingId] = useState<number|string|null>(null)
  const [dmLangPickerId, setDmLangPickerId] = useState<number|string|null>(null)
  const [dmLangPickerSummary, setDmLangPickerSummary] = useState('')
  const dmTranslateLanguages = [
    { code: 'pt', name: 'Portuguese (PT)', flag: '🇵🇹' },
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'fr', name: 'French', flag: '🇫🇷' },
    { code: 'de', name: 'German', flag: '🇩🇪' },
    { code: 'es', name: 'Spanish', flag: '🇪🇸' },
    { code: 'it', name: 'Italian', flag: '🇮🇹' },
  ]
  const [selectedMessages, setSelectedMessages] = useState<Set<number|string>>(new Set())
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
  const draftRef = useRef('')
  const [draftDisplay, setDraftDisplay] = useState('')
  const [replyTo, setReplyTo] = useState<{ text:string; sender?:string; image_path?:string; video_path?:string; audio_path?:string; audio_summary?:string }|null>(null)
  const [sending, setSendingState] = useState(false)
  const listRef = useRef<HTMLDivElement|null>(null)
  const loadOlderRef = useRef<(() => void) | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement|null>(null)
  const storageKey = useMemo(() => `chat_meta_${username || ''}`, [username])
  const chatCacheKey = useMemo(
    () => (username && viewer ? chatMessagesDeviceCacheKey(viewer, username) : null),
    [username, viewer],
  )
  const profileCacheKey = useMemo(
    () => (username && viewer ? chatProfileDeviceCacheKey(viewer, username) : null),
    [username, viewer],
  )
  const dmOfflineKey = useMemo(
    () => (username && viewer ? dmConversationOfflineKey(viewer, username) : null),
    [username, viewer],
  )
  const metaRef = useRef<Record<string, { reaction?: string; replySnippet?: string }>>({})
  const [otherProfile, setOtherProfile] = useState<{ display_name:string; profile_picture?:string|null }|null>(null)
  const [, setTyping] = useState(false) // keep setter for API calls; UI label removed
  const typingTimer = useRef<any>(null)
  const isTypingRef = useRef(false) // Track if we've already sent typing indicator
  const pollInFlight = useRef(false)
  const sendingLockRef = useRef(false)
  const justSentRef = useRef(false)
  // Optimize polling - track poll count for debouncing auxiliary calls
  const pollCountRef = useRef(0)
  const threadGenerationRef = useRef(0)
  const cachePaintedGenRef = useRef<number | null>(null)
  const cacheSnapshotRef = useRef<{ count: number; tailId: string | number | undefined } | null>(null)
  const resolvedPeerRef = useRef<{ username: string; userId: number } | null>(null)
  // Track last known message ID for faster incremental polling
  const lastKnownMessageIdRef = useRef<number>(0)
  // Backward pagination (load older messages on scroll up)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const loadingOlderRef = useRef(false)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [gifPickerOpen, setGifPickerOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement|null>(null)
  const cameraInputRef = useRef<HTMLInputElement|null>(null)
  const audioInputRef = useRef<HTMLInputElement|null>(null)
  const videoInputRef = useRef<HTMLInputElement|null>(null)
  const documentInputRef = useRef<HTMLInputElement|null>(null)
  const { recording, recordMs, preview: recordingPreview, start: startVoiceRecording, stop: stopVoiceRecording, clearPreview: cancelRecordingPreview, level, stopAndGetBlob } = useAudioRecorder() as any
  
  // Format milliseconds as MM:SS
  const formatRecordingTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }
  
  // State for inline preview audio playback
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const setSending = useCallback((value: boolean) => {
    sendingLockRef.current = value
    setSendingState(value)
  }, [])
  const [previewImage, setPreviewImage] = useState<string|null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [showMicPermissionModal, setShowMicPermissionModal] = useState(false)
  const [showPermissionGuide, setShowPermissionGuide] = useState(false)
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const [showBlockModal, setShowBlockModal] = useState(false)
  const [blockReason, setBlockReason] = useState('')
  const [blockSubmitting, setBlockSubmitting] = useState(false)
  const [reminderVaultOpen, setReminderVaultOpen] = useState(false)
  const [reminderRows, setReminderRows] = useState<Array<{ id: number; reminder_text: string; fire_at_utc: string; tz_label: string }>>([])
  const [reminderVaultLoading, setReminderVaultLoading] = useState(false)
  const [reminderVaultError, setReminderVaultError] = useState<string | null>(null)
  const [editingVaultId, setEditingVaultId] = useState<number | null>(null)
  const [editVaultText, setEditVaultText] = useState('')
  const [editVaultIso, setEditVaultIso] = useState('')
  const [vaultDeletingId, setVaultDeletingId] = useState<number | null>(null)
  const lastFetchTime = useRef<number>(0)
  const [pastedImage, setPastedImage] = useState<File | null>(null)
  const [videoUploadProgress, setVideoUploadProgress] = useState<UploadProgress | null>(null)
  const [pendingMedia, setPendingMedia] = useState<Array<{ file: File; previewUrl: string; type: 'image' | 'video' | 'audio' }>>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [viewingMedia, setViewingMedia] = useState<{ urls: string[]; index: number } | null>(null)
  const pendingDeletions = useRef<Set<number|string>>(new Set())
  const headerMenuRef = useRef<HTMLDivElement | null>(null)
  // Bridge between temp ids and server ids to avoid flicker and keep stable keys
  const idBridgeRef = useRef<{ tempToServer: Map<string, string|number>; serverToTemp: Map<string|number, string> }>({
    tempToServer: new Map(),
    serverToTemp: new Map(),
  })
  // Track recently sent optimistic messages to prevent poll from removing them
  const recentOptimisticRef = useRef<Map<string, { message: Message; timestamp: number }>>(new Map())
  // Pause polling briefly after sending to avoid race condition with server confirmation
  const skipNextPollsUntil = useRef<number>(0)
  // Draft persistence - save timeout for debounced auto-save
  const draftSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const shareAttachDoneRef = useRef(false)
  const composerRef = useRef<HTMLDivElement | null>(null)

  useNativeStatusBar(Style.Dark)
  useResumeOutboxDrain()

  useAndroidBackButton({
    textareaRef,
    onExitSelection: () => {
      if (!isMultiSelectMode) return false
      setIsMultiSelectMode(false)
      setSelectedMessages(new Set())
      return true
    },
    onNavigateBack: () => navigate(-1),
  })

  // Peer-scoped ref reset when switching DM threads (cache hydrate runs after processRawMessages is defined)
  useEffect(() => {
    if (!username) return
    threadGenerationRef.current += 1
    resolvedPeerRef.current = null
    lastKnownMessageIdRef.current = 0
    pollCountRef.current = 0
    idBridgeRef.current.tempToServer.clear()
    idBridgeRef.current.serverToTemp.clear()
    recentOptimisticRef.current.clear()
    pendingDeletions.current.clear()
    shareAttachDoneRef.current = false
    setSteveIsTyping(false)
    setMessages([])
    setHasMoreMessages(false)
    setOtherUserId('')
    cachePaintedGenRef.current = null
    cacheSnapshotRef.current = null
  }, [username])

  const loadReminderVault = useCallback(async () => {
    setReminderVaultLoading(true)
    setReminderVaultError(null)
    try {
      const r = await fetch('/api/me/steve/reminders', { credentials: 'include' })
      const d = await r.json()
      if (!r.ok) {
        setReminderVaultError(typeof d?.error === 'string' ? d.error : t('chat.reminder_load_failed'))
        setReminderRows([])
        return
      }
      setReminderRows(Array.isArray(d.reminders) ? d.reminders : [])
    } catch {
      setReminderVaultError(t('chat.reminder_network_error'))
      setReminderRows([])
    } finally {
      setReminderVaultLoading(false)
    }
  }, [])

  useEffect(() => {
    if (reminderVaultOpen) void loadReminderVault()
  }, [reminderVaultOpen, loadReminderVault])

  useEffect(() => {
    if (!headerMenuOpen) return
    const handleDocumentClick = (event: globalThis.PointerEvent) => {
      if (!headerMenuRef.current) return
      if (!headerMenuRef.current.contains(event.target as Node)) {
        setHeaderMenuOpen(false)
      }
    }
    const handleDocumentKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHeaderMenuOpen(false)
      }
    }
    const captureOptions: AddEventListenerOptions = { capture: true }
    document.addEventListener('pointerdown', handleDocumentClick, captureOptions)
    document.addEventListener('keydown', handleDocumentKey)
    return () => {
      document.removeEventListener('pointerdown', handleDocumentClick, captureOptions)
      document.removeEventListener('keydown', handleDocumentKey)
    }
  }, [headerMenuOpen])

  // Mic always enabled for audio messages
  const MIC_ENABLED = true

  const chrome = useChatThreadChrome({
    isMobile,
    textareaRef,
    composerRef,
    listRef,
    threadKey: username,
    messages,
    hasMoreMessages,
    loadingOlderRef,
    onLoadOlder: () => loadOlderRef.current?.(),
    loadOlderEnabled: Boolean(otherUserId),
    surfaceKey: 'dm',
  })

  const {
    messageStackRef,
    scrollToBottom,
    scrollToBottomSmooth,
    ensurePinnedToBottom,
    notifyMessagesSettled,
    showScrollDown,
    lastMessageRef,
    pendingNewCount,
    clearPendingNew,
    composerCardRef,
    keyboardLift,
    displayKeyboardLift,
    safeBottomPx,
    isWeb,
    androidKeyboardOpen,
    listPaddingBottom,
    listScrollPaddingBottom,
    scrollButtonBottom,
    insetMotionIdle,
    handleContentPointerDown,
    handleContentPointerUp,
    handleContentPointerCancel,
    noteComposerFocus,
    handleListScroll,
  } = chrome

  const notifyMessagesSettledRef = useRef(notifyMessagesSettled)
  notifyMessagesSettledRef.current = notifyMessagesSettled

  const mergeHydratedMessages = useCallback((processed: Message[], prev: Message[]) => {
    const serverIds = new Set(processed.map(m => String(m.id)))
    const keptOptimistic = prev.filter(m => m.isOptimistic && !serverIds.has(String(m.id)))
    const keptKeys = new Set(keptOptimistic.map(m => m.clientKey || String(m.id)))
    recentOptimisticRef.current.forEach(entry => {
      const key = entry.message.clientKey || String(entry.message.id)
      if (!serverIds.has(String(entry.message.id)) && !keptKeys.has(key)) {
        keptOptimistic.push(entry.message)
        keptKeys.add(key)
      }
    })
    if (keptOptimistic.length === 0) return processed
    return [...processed, ...keptOptimistic]
  }, [])

  const focusTextarea = useCallback(() => {
    if (MIC_ENABLED && recording) return
    const el = textareaRef.current
    if (!el) return
    noteComposerFocus()
    try {
      el.focus({ preventScroll: true })
    } catch {
      el.focus()
    }
    requestAnimationFrame(() => {
      const length = el.value.length
      try {
        el.setSelectionRange(length, length)
      } catch {
        // iOS can reject selection updates during focus transitions.
      }
    })
  }, [recording, noteComposerFocus])
  
  // Cleanup preview audio when recording preview changes
  useEffect(() => {
    // When preview is cleared, stop and cleanup audio
    if (!recordingPreview) {
      const audio = previewAudioRef.current
      if (audio) {
        audio.pause()
        audio.src = ''
        previewAudioRef.current = null
      }
      setPreviewPlaying(false)
    }
  }, [recordingPreview])
  
  async function commitEdit(){
    if (!editingId) return
    const newBody = editText.trim()
    if (!newBody) { alert(t('chat.message_empty')); return }
    const prev = messages
    setEditingSaving(true)
    // Optimistically update - clear encryption flags since server will store as plain text
    setMessages(list => list.map(m => m.id===editingId ? ({ 
      ...m, 
      text: newBody, 
      edited_at: new Date().toISOString(),
      is_encrypted: false,
      encrypted_body: undefined,
      encrypted_body_for_sender: undefined,
      decryption_error: false
    }) : m))
    try{
      const res = await fetch('/api/chat/edit_message', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ message_id: editingId, text: newBody }) })
      const j = await res.json().catch(()=>null)
      if (!j?.success){
        alert(j?.error || t('chat.edit_failed'))
        setMessages(prev)
      } else {
        setEditingId(null); setEditText('')
      }
    }catch(err){
      alert(t('chat.edit_network_error'))
      setMessages(prev)
    } finally { setEditingSaving(false) }
  }

  // Encryption is initialized globally in App.tsx - no need for per-chat init

  // Helper to process raw messages (decrypt, parse replies, add metadata)
  const processRawMessages = useCallback((rawMessages: any[]): Message[] => {
    const decryptedMessages = rawMessages
    
    // Load all reactions from ID-based storage (more reliable than time-based)
    const storedReactions = username ? getAllMessageReactions(username) : {}
    
    return decryptedMessages.map((m: any) => {
      // Parse reply information from message text
      let messageText = m.text
      let replySnippet: string | undefined
      let storyReply: { id: string; mediaType: string; mediaPath: string } | undefined
      
      // Check for story reply format: [STORY_REPLY:id:emoji:mediaPath]
      const storyReplyMatch = messageText.match(/^\[STORY_REPLY:([^:]+):([^:]+):([^\]]*)\][\r\n\s]*(.*)$/s)
      if (storyReplyMatch) {
        storyReply = {
          id: storyReplyMatch[1],
          mediaType: storyReplyMatch[2],
          mediaPath: storyReplyMatch[3]
        }
        messageText = storyReplyMatch[4]
      } else {
        // Check for regular reply format
        const replyMatch = messageText.match(/^\[REPLY:([^:]+):([^\]]+)\][\r\n\s]*(.*)$/s)
        if (replyMatch) {
          replySnippet = replyMatch[2]
          messageText = replyMatch[3]
        }
      }

      // Normalize media_paths for multi-media DMs (handles stringified JSON from MySQL,
      // missing field from prior Firestore formatter, or single image_path fallback).
      // This ensures persistence on reload/cache (fixes the multi-media bug).
      let mediaPaths = m.media_paths
      if (typeof mediaPaths === 'string' && mediaPaths) {
        try {
          mediaPaths = JSON.parse(mediaPaths)
        } catch (e) {
          mediaPaths = null
        }
      }
      if (!Array.isArray(mediaPaths)) {
        mediaPaths = m.image_path ? [m.image_path] : []
      }

      const normalizedTime = ensureNormalizedTime(m.time)
      const meta = readMessageMeta(metaRef.current, normalizedTime, messageText, Boolean(m.sent))
      
      // Prioritize server-side reaction, then localStorage, then legacy time-based
      const serverReaction = m.reaction || null
      const idBasedReaction = m.id ? storedReactions[String(m.id)] : undefined
      
      return {
        ...m,
        text: messageText,
        time: normalizedTime,
        video_path: m.video_path,
        media_paths: mediaPaths,
        reaction: serverReaction || idBasedReaction || meta.reaction,
        replySnippet: replySnippet || meta.replySnippet,
        storyReply,
        isOptimistic: false,
        edited_at: m.edited_at || null,
      }
    })
  }, [username])

  // Sync hydrate on thread switch — device cache first, then IndexedDB fallback (no blank flash)
  useEffect(() => {
    if (!username) return
    const gen = threadGenerationRef.current

    const cachedProfile = profileCacheKey
      ? readDeviceCache<{ display_name: string; profile_picture?: string | null }>(profileCacheKey, CHAT_CACHE_VERSION)
      : null
    setOtherProfile(cachedProfile)

    const cachedChat = chatCacheKey
      ? readDeviceCache<{ messages: any[]; otherUserId: number }>(chatCacheKey, CHAT_CACHE_VERSION)
      : null

    if (cachedChat?.messages?.length && cachedChat.otherUserId) {
      resolvedPeerRef.current = { username, userId: cachedChat.otherUserId }
      setOtherUserId(cachedChat.otherUserId)
      const processed = processRawMessages(cachedChat.messages)
      setMessages(prev => mergeHydratedMessages(processed, prev))
      cachePaintedGenRef.current = gen
      cacheSnapshotRef.current = {
        count: processed.length,
        tailId: processed[processed.length - 1]?.id,
      }
      notifyMessagesSettledRef.current(gen)
      return
    }

    setOtherUserId('')
    setMessages([])

    if (dmOfflineKey && viewer) {
      Promise.all([
        getCachedMessages(dmOfflineKey),
        getCachedKeyVal<number>(dmUserIdKeyvalKey(viewer, username)),
      ]).then(([idbMsgs, idbUserId]) => {
        if (gen !== threadGenerationRef.current) return
        if (idbUserId) {
          resolvedPeerRef.current = { username, userId: idbUserId }
          setOtherUserId(idbUserId)
        }
        if (idbMsgs?.length) {
          const processed = processRawMessages(idbMsgs)
          setMessages(prev => mergeHydratedMessages(processed, prev))
          cachePaintedGenRef.current = gen
          cacheSnapshotRef.current = {
            count: processed.length,
            tailId: processed[processed.length - 1]?.id,
          }
          notifyMessagesSettledRef.current(gen)
        }
      }).catch(() => {})
    }
  }, [username, chatCacheKey, profileCacheKey, dmOfflineKey, viewer, processRawMessages, mergeHydratedMessages])

  // Restore draft when entering chat (only if there's an actual saved draft)
  // Added extra protection for iOS navigation - clear any stale content first.
  // Runs in useLayoutEffect so the textarea auto-height (and resulting
  // composer card height) is committed in the same paint as the chat shell.
  // Without this, the post-paint adjustment grows `listPaddingBottom` and
  // visibly shifts the inverted message list upward by a few pixels on open.
  useLayoutEffect(() => {
    if (!username || !textareaRef.current) return
    
    // Force clear any stale content before checking for saved draft (fixes iOS navigation issue)
    if (textareaRef.current.value) {
      textareaRef.current.value = ''
    }
    
    const draftKey = viewer && username ? `chat-draft:dm:${viewer}:${username}` : `chat-draft:dm:${username}`
    const savedDraft = readDeviceCache<string>(draftKey)
    if (savedDraft && savedDraft.trim()) {
      textareaRef.current.value = savedDraft
      draftRef.current = savedDraft
      setDraftDisplay(savedDraft)
      adjustTextareaHeight()
    } else {
      draftRef.current = ''
      setDraftDisplay('')
      adjustTextareaHeight()
    }
  }, [username, viewer])

  // Steve DM: optional ?prefill= from About C-Point (after draft restore; overwrites draft for this navigation).
  const prefillParam = searchParams.get('prefill')
  useEffect(() => {
    if (!isSteveDm || !username || !prefillParam?.trim()) return
    const ta = textareaRef.current
    if (!ta) return
    const text = prefillParam.trim()
    ta.value = text
    draftRef.current = text
    setDraftDisplay(text)
    adjustTextareaHeight()
    setSearchParams(
      (p) => {
        const n = new URLSearchParams(p)
        n.delete('prefill')
        return n
      },
      { replace: true },
    )
  }, [username, isSteveDm, prefillParam, setSearchParams])

  // Deep link ?reply=1 — focus composer on mount
  const replyParam = searchParams.get('reply')
  useEffect(() => {
    if (replyParam !== '1' || !username) return
    focusTextarea()
    setSearchParams(
      p => {
        const n = new URLSearchParams(p)
        n.delete('reply')
        return n
      },
      { replace: true },
    )
  }, [username, replyParam, setSearchParams, focusTextarea])

  // Share handoff must run *after* draft restore above
  const shareAttach = searchParams.get('share')
  useEffect(() => {
    if (shareAttach !== '1' || !username) return
    const handoffKey = viewer ? `dm:${viewer}:${username}:share` : `dm:${username}:share`
    if (shareAttachDoneRef.current) return
    const files = takePendingShareFilesOnce(handoffKey)
    const urls = takePendingShareUrlsOnce(handoffKey)
    if (!files?.length && !urls?.length) return
    shareAttachDoneRef.current = true
    if (files?.length) {
      const newMedia = files.map(file => {
        const t = file.type.startsWith('video/')
          ? 'video'
          : file.type.startsWith('audio/')
            ? 'audio'
            : 'image'
        return {
          file,
          previewUrl: URL.createObjectURL(file),
          type: t as 'image' | 'video' | 'audio',
        }
      })
      setPendingMedia(prev => [...prev, ...newMedia])
      setPreviewIndex(0)
    }
    if (urls?.length) {
      const text = urls.join('\n\n')
      const ta = textareaRef.current
      if (ta) {
        const merged = ta.value.trim() ? `${text}\n\n${ta.value}` : text
        ta.value = merged
        draftRef.current = merged
        setDraftDisplay(merged)
      } else {
        draftRef.current = text
        setDraftDisplay(text)
      }
    }
    setSearchParams(
      p => {
        const n = new URLSearchParams(p)
        n.delete('share')
        return n
      },
      { replace: true }
    )
  }, [username, shareAttach, setSearchParams, viewer])

  useEffect(() => {
    if (shareAttach === '1') return
    if (username) {
      const k = viewer ? `dm:${viewer}:${username}:share` : `dm:${username}:share`
      releaseShareHandoffKey(k)
      releaseShareUrlHandoffKey(k)
    }
  }, [shareAttach, username, viewer])

  // Save draft when leaving chat (cleanup)
  useEffect(() => {
    return () => {
      if (draftSaveTimeoutRef.current) {
        clearTimeout(draftSaveTimeoutRef.current)
      }
      const currentText = textareaRef.current?.value || draftRef.current
      if (currentText?.trim() && username) {
        const dk = viewer ? `chat-draft:dm:${viewer}:${username}` : `chat-draft:dm:${username}`
        writeDeviceCache(dk, currentText)
      }
    }
  }, [username, viewer])

  // Initial load of messages and other user info (fresh fetch)
  useEffect(() => {
    if (!username) return
    // Skip network fetches when offline — navigator.onLine is synchronous and reliable on first render
    if (!navigator.onLine) return
    const gen = threadGenerationRef.current
    
    // Helper to fetch messages and profile once we have user ID
    const fetchMessagesAndProfile = (userId: number) => {
      const gen = threadGenerationRef.current
      const fetchUsername = username
      resolvedPeerRef.current = { username: fetchUsername, userId }
      // Load fresh messages
      const fd = new URLSearchParams({ other_user_id: String(userId) })
      fetch('/get_messages', { 
        method:'POST', 
        credentials:'include', 
        headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, 
        body: fd 
      })
      .then(r=>r.json())
      .then((msgResponse) => {
        if (gen !== threadGenerationRef.current) return
        setSteveIsTyping(Boolean(msgResponse?.steve_is_typing))
        if (msgResponse?.success && Array.isArray(msgResponse.messages)) {
          const processedMessages = processRawMessages(msgResponse.messages)
          if (gen !== threadGenerationRef.current) return
          const fromCache = cachePaintedGenRef.current === gen
          const snap = cacheSnapshotRef.current
          const unchangedFromCache =
            fromCache &&
            snap != null &&
            processedMessages.length === snap.count &&
            String(processedMessages[processedMessages.length - 1]?.id) === String(snap.tailId)

          setMessages(prev => {
            const serverIds = new Set(processedMessages.map(m => String(m.id)))
            // Keep optimistic messages from state
            const keptOptimistic = prev.filter(m => m.isOptimistic && !serverIds.has(String(m.id)))
            // Also keep optimistic messages from recentOptimisticRef (handles race with new chats)
            const keptKeys = new Set(keptOptimistic.map(m => m.clientKey || String(m.id)))
            recentOptimisticRef.current.forEach((entry) => {
              const key = entry.message.clientKey || String(entry.message.id)
              if (!serverIds.has(String(entry.message.id)) && !keptKeys.has(key)) {
                keptOptimistic.push(entry.message)
                keptKeys.add(key)
              }
            })
            if (unchangedFromCache) return prev
            if (keptOptimistic.length === 0) return processedMessages
            return [...processedMessages, ...keptOptimistic]
          })
          if (!unchangedFromCache) {
            notifyMessagesSettledRef.current(gen)
          }
          setHasMoreMessages(!!msgResponse.has_more)
          lastFetchTime.current = Date.now()

          let maxServerId = 0
          for (const m of msgResponse.messages) {
            const mid = typeof m.id === 'number' ? m.id : parseInt(String(m.id), 10)
            if (!Number.isNaN(mid) && mid > maxServerId) maxServerId = mid
          }
          if (maxServerId > 0 && gen === threadGenerationRef.current) {
            lastKnownMessageIdRef.current = maxServerId
          }
          
          // Cache the messages for next time
          if (chatCacheKey && gen === threadGenerationRef.current) {
            writeDeviceCache(chatCacheKey, { 
              messages: msgResponse.messages, 
              otherUserId: userId 
            }, CHAT_CACHE_TTL_MS, CHAT_CACHE_VERSION)
          }
          if (fetchUsername && viewer && dmOfflineKey && gen === threadGenerationRef.current) {
            cacheMessages(dmOfflineKey, msgResponse.messages)
            cacheKeyVal(dmUserIdKeyvalKey(viewer, fetchUsername), userId)
          }
          
          // Clear the chat threads cache so Messages list shows updated unread counts
          if (viewer) clearDeviceCache(threadsListCacheKey(viewer))
          
          if (!unchangedFromCache) {
            refreshBadges()
          }
        }
      }).catch(()=>{})
      
      // Load user profile (in parallel)
      fetch(`/api/get_user_profile_brief?username=${encodeURIComponent(fetchUsername)}`, { credentials:'include', headers: { 'Accept': 'application/json' } })
        .then(r => r.json())
        .then(profileResponse => {
          if (gen !== threadGenerationRef.current) return
          if (profileResponse?.success) {
            const profile = { 
              display_name: profileResponse.display_name, 
              profile_picture: profileResponse.profile_picture || null,
            }
            setOtherProfile(profile)
            if (profileCacheKey) {
              writeDeviceCache(profileCacheKey, profile, CHAT_CACHE_TTL_MS, CHAT_CACHE_VERSION)
            }
          }
        })
        .catch(()=>{})
    }
    
    // Check if we have cached user ID - skip the lookup API call if so
    const cached = chatCacheKey ? readDeviceCache<{ messages: any[]; otherUserId: number }>(chatCacheKey, CHAT_CACHE_VERSION) : null
    if (cached?.otherUserId) {
      // Use cached user ID immediately, fetch messages in parallel
      resolvedPeerRef.current = { username, userId: cached.otherUserId }
      setOtherUserId(cached.otherUserId)
      fetchMessagesAndProfile(cached.otherUserId)
    } else {
      // No cache - need to look up user ID first
      fetch('/api/get_user_id_by_username', { 
        method:'POST', 
        credentials:'include', 
        headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, 
        body: new URLSearchParams({ username }) 
      })
      .then(r=>r.json())
      .then(j=>{
        if (j?.success && j.user_id){
          if (threadGenerationRef.current !== gen) return
          resolvedPeerRef.current = { username, userId: j.user_id }
          setOtherUserId(j.user_id)
          fetchMessagesAndProfile(j.user_id)
        }
      }).catch(()=>{})
    }
  }, [username, chatCacheKey, profileCacheKey, processRawMessages, viewer, dmOfflineKey, refreshBadges])

  // Hydrate pending/failed outbox entries so they survive app restarts
  useEffect(() => {
    if (!username) return
    getOutboxEntries().then(entries => {
      const myEntries = entries.filter(e => e.type === 'dm' && e.recipient === String(otherUserId || '') && (e.status === 'pending' || e.status === 'failed'))
      if (!myEntries.length) return
      setMessages(prev => {
        const existingKeys = new Set(prev.map(m => m.clientKey).filter(Boolean))
        const toAdd: Message[] = myEntries
          .filter(e => !existingKeys.has(e.clientKey))
          .map(e => ({
            id: e.clientKey,
            text: e.content.replace(/^\[REPLY:[^\]]*\]\n/, ''),
            sent: true,
            time: new Date(e.createdAt).toISOString(),
            isOptimistic: true,
            sendFailed: e.status === 'failed',
            _originalMessage: e.content,
            clientKey: e.clientKey,
            is_encrypted: false,
            signal_protocol: false,
          }))
        return toAdd.length ? [...prev, ...toAdd] : prev
      })
    }).catch(() => {})
  }, [username, otherUserId])

  // Re-fetch messages when outbox drainer completes
  useEffect(() => {
    const handler = () => {
      if (!otherUserId) return
      const fd = new URLSearchParams({ other_user_id: String(otherUserId) })
      fetch('/get_messages', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: fd })
        .then(r => r.json())
        .then(j => {
          setSteveIsTyping(Boolean(j?.steve_is_typing))
          if (j?.success && Array.isArray(j.messages)) {
            const processed = processRawMessages(j.messages)
            setMessages(prev => {
              const pendingMsgs = prev.filter(m => m.isOptimistic)
              const serverIds = new Set(processed.map(m => m.id))
              const unresolvedPending = pendingMsgs.filter(m => !serverIds.has(m.id))
              return [...processed, ...unresolvedPending]
            })
          }
        })
        .catch(() => {})
    }
    window.addEventListener('outbox-drained', handler)
    return () => window.removeEventListener('outbox-drained', handler)
  }, [otherUserId, processRawMessages])

  // Load older messages when user scrolls to top
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlderRef.current || !hasMoreMessages || !otherUserId) return
    loadingOlderRef.current = true
    setLoadingOlder(true)
    try {
      const oldestId = messages.length > 0 ? Math.min(...messages.map(m => typeof m.id === 'number' ? m.id : 0)) : 0
      if (oldestId <= 0) { loadingOlderRef.current = false; setLoadingOlder(false); return }
      const fd = new URLSearchParams({ other_user_id: String(otherUserId), before_id: String(oldestId) })
      const r = await fetch('/get_messages', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: fd })
      const j = await r.json()
      setSteveIsTyping(Boolean(j?.steve_is_typing))
      if (j?.success && Array.isArray(j.messages) && j.messages.length > 0) {
        const processed = processRawMessages(j.messages)
        setMessages(prev => [...processed, ...prev])
        setHasMoreMessages(!!j.has_more)
        // Inverted list invariant: column-reverse anchors layout at the
        // visual bottom, so prepending older content preserves the user's
        // visual position automatically. Do NOT touch scrollTop here.
        // See .cursor/rules/chat-surfaces.mdc.
      } else {
        setHasMoreMessages(false)
      }
    } catch (err) {
      console.error('Failed to load older messages:', err)
    }
    loadingOlderRef.current = false
    setLoadingOlder(false)
  }, [hasMoreMessages, otherUserId, messages])

  loadOlderRef.current = loadOlderMessages

  // Load metadata from localStorage
  useEffect(() => {
    try{ 
      const raw = localStorage.getItem(storageKey)
      if (raw) metaRef.current = JSON.parse(raw) || {} 
    }catch{}
  }, [storageKey])

  useDmMessagePoll<Message>({
    username,
    otherUserId,
    dmOfflineKey,
    threadGenerationRef,
    resolvedPeerRef,
    lastKnownMessageIdRef,
    skipNextPollsUntil,
    pollInFlightRef: pollInFlight,
    pollCountRef,
    idBridgeRef,
    recentOptimisticRef,
    pendingDeletions,
    metaRef,
    setMessages,
    setSteveIsTyping,
    setTyping,
  })

  function adjustTextareaHeight(){
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const maxPx = 160
    ta.style.height = Math.min(ta.scrollHeight, maxPx) + 'px'
  }
  
  useLayoutEffect(() => { adjustTextareaHeight() }, [])

  async function send(){
    const messageText = (textareaRef.current?.value || '').trim()
    if (!messageText || sendingLockRef.current) return

    if (tryBlockSteveIntentSend(messageText)) return

    chatHapticSend()

    const steveIntentSend = isSteveDm || mentionsSteve(messageText)
    if (steveIntentSend) {
      setSteveIsTyping(true)
    }

    sendingLockRef.current = true
    justSentRef.current = true
    setTimeout(() => { justSentRef.current = false }, 400)
    
    let resolvedUserId = otherUserId
    if (!resolvedUserId) {
      try {
        const r = await fetch('/api/get_user_id_by_username', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: username || '' }) })
        const j = await r.json()
        if (j?.success && j.user_id) { resolvedUserId = j.user_id; setOtherUserId(j.user_id) } else { sendingLockRef.current = false; return }
      } catch { sendingLockRef.current = false; return }
    }
    
    const replySnapshot = replyTo

    // Cancel any pending draft save timer FIRST to prevent race condition
    if (draftSaveTimeoutRef.current) {
      clearTimeout(draftSaveTimeoutRef.current)
      draftSaveTimeoutRef.current = null
    }

    // Clear composer and remove persisted draft
    if (textareaRef.current) {
      textareaRef.current.value = ''
    }
    draftRef.current = ''
    setDraftDisplay('')
    adjustTextareaHeight()

    // Clear the saved draft from device cache when message is sent
    if (username) {
      const dk = viewer ? `chat-draft:dm:${viewer}:${username}` : `chat-draft:dm:${username}`
      clearDeviceCache(dk)
    }

    if (replySnapshot) {
      setReplyTo(null)
    }
    
    skipNextPollsUntil.current = Date.now() + 800
    const now = new Date().toISOString()
    const tempId = `temp_${Date.now()}_${Math.random()}`
    
    let replySnippet: string | undefined
    if (replySnapshot) {
      if (replySnapshot.image_path) {
        const caption = replySnapshot.text || 'Photo'
        replySnippet = `📷|${replySnapshot.image_path}|${caption.slice(0,60)}`
      } else if (replySnapshot.video_path) {
        const caption = replySnapshot.text || 'Video'
        replySnippet = `🎥|${replySnapshot.video_path}|${caption.slice(0,60)}`
      } else if (replySnapshot.audio_path) {
        const summarySnippet = replySnapshot.audio_summary ? replySnapshot.audio_summary.slice(0, 80) : ''
        replySnippet = summarySnippet ? `🎤|${summarySnippet}` : '🎤|Voice message'
      } else {
        replySnippet = replySnapshot.text.length > 90 ? replySnapshot.text.slice(0,90) + '…' : replySnapshot.text
      }
    }
    const replySender = replySnapshot?.sender
    
    let formattedMessage = messageText
    if (replySnapshot) {
      formattedMessage = `[REPLY:${replySender}:${replySnippet}]\n${messageText}`
    }
    
    const optimisticMessage: Message = { 
      id: tempId, 
      text: messageText, 
      sent: true, 
      time: now, 
      replySnippet,
      isOptimistic: true,
      sendFailed: false,
      _originalMessage: formattedMessage,
      is_encrypted: false,
      signal_protocol: false,
    }
    
    const optimisticWithKey = { ...optimisticMessage, clientKey: tempId }
    setMessages(prev => [...prev, optimisticWithKey])
    
    recentOptimisticRef.current.set(tempId, {
      message: optimisticWithKey,
      timestamp: Date.now()
    })
    
    requestAnimationFrame(ensurePinnedToBottom)
    
    if (replySnippet){
      writeMessageMeta(metaRef.current, now, messageText, true, { replySnippet })
      try{ localStorage.setItem(storageKey, JSON.stringify(metaRef.current)) }catch{}
    }

    let outboxId = -1
    try {
      outboxId = await addToOutbox({
        type: 'dm',
        recipient: String(resolvedUserId || otherUserId),
        content: formattedMessage,
        clientKey: tempId,
        createdAt: Date.now(),
        status: 'pending',
        retries: 0,
      })
    } catch { /* IndexedDB unavailable */ }

    const markFailed = (key: string) => {
      try {
        recentOptimisticRef.current.delete(key)
      } catch {
        /* ignore */
      }
      setMessages(prev => prev.map(m =>
        (m.clientKey || m.id) === key ? { ...m, sendFailed: true, isOptimistic: true } : m
      ))
      if (outboxId >= 0) updateOutboxStatus(outboxId, 'failed').catch(() => {})
    }

    if (!navigator.onLine) {
      markFailed(tempId)
      sendingLockRef.current = false
      return
    }

    const sendTimeout = setTimeout(() => markFailed(tempId), 10000)
    
    const fd = new URLSearchParams({ recipient_id: String(resolvedUserId || otherUserId) })
    fd.append('message', formattedMessage)
    fd.append('client_key', tempId)
    
    fetch('/send_message', { 
      method:'POST', 
      credentials:'include', 
      headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, 
      body: fd 
    })
      .then(r => r.json())
      .then(j => {
        clearTimeout(sendTimeout)
        if (j?.entitlements_error && isEntitlementsError(j.entitlements_error)) {
          entitlementsHandler.showError(j.entitlements_error)
          setSteveIsTyping(false)
        } else if (j?.steve_is_typing) {
          setSteveIsTyping(true)
        }
        if (j?.success) {
          if (outboxId >= 0) removeFromOutbox(outboxId).catch(() => {})

          fetch('/api/typing', { 
            method:'POST', 
            credentials:'include', 
            headers:{ 'Content-Type':'application/json' }, 
            body: JSON.stringify({ peer: username, is_typing: false }) 
          }).catch(()=>{})
          
          if (j.message_id) {
            idBridgeRef.current.tempToServer.set(tempId, j.message_id)
            idBridgeRef.current.serverToTemp.set(j.message_id, tempId)
            
            setMessages(prev => {
              const serverId = j.message_id
              let foundOriginal = false
              const updated = prev.map(m => {
                if ((m.clientKey || m.id) === tempId) {
                  foundOriginal = true
                  return {
                    ...m,
                    id: serverId,
                    isOptimistic: false,
                    sendFailed: false,
                    time: m.time ?? ensureNormalizedTime(j.time || m.time),
                    clientKey: tempId,
                  }
                }
                return m
              })
              if (foundOriginal) {
                return updated.filter(m => m.id !== serverId || (m.clientKey || m.id) === tempId)
              }
              return updated
            })
            
            setTimeout(() => recentOptimisticRef.current.delete(tempId), 1000)
          } else {
            // Defensive: server acked success without a message_id (legacy dedup path).
            // Promote the optimistic bubble out of "sending" so it doesn't stay stuck forever.
            // A subsequent poll will reconcile the real server id via text/time match.
            setMessages(prev => prev.map(m =>
              (m.clientKey || m.id) === tempId
                ? { ...m, isOptimistic: false, sendFailed: false }
                : m
            ))
            setTimeout(() => recentOptimisticRef.current.delete(tempId), 1000)
          }
        } else {
          markFailed(tempId)
        }
      })
      .catch(() => {
        clearTimeout(sendTimeout)
        markFailed(tempId)
      })
      .finally(() => {
        sendingLockRef.current = false
      })
  }

  function retryFailedMessage(clientKey: string) {
    const msg = messages.find(m => (m.clientKey || m.id) === clientKey)
    if (!msg) return
    const originalMessage = msg._originalMessage || msg.text || ''
    if (tryBlockSteveIntentSend(originalMessage)) return
    const resolvedId = otherUserId
    if (!resolvedId) return

    setMessages(prev => prev.map(m =>
      (m.clientKey || m.id) === clientKey ? { ...m, sendFailed: false, isOptimistic: true } : m
    ))

    const markRetryFailed = () => {
      setMessages(prev => prev.map(m =>
        (m.clientKey || m.id) === clientKey ? { ...m, sendFailed: true } : m
      ))
      getOutboxEntries().then(entries => {
        const e = entries.find(x => x.clientKey === clientKey)
        if (e?.id != null) updateOutboxStatus(e.id, 'failed', (e.retries || 0) + 1).catch(() => {})
      }).catch(() => {})
    }

    const retryTimeout = setTimeout(markRetryFailed, 10000)

    const fd = new URLSearchParams({ recipient_id: String(resolvedId) })
    fd.append('message', originalMessage)
    fd.append('client_key', clientKey)

    fetch('/send_message', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: fd
    })
      .then(r => r.json())
      .then(j => {
        clearTimeout(retryTimeout)
        if (j?.entitlements_error && isEntitlementsError(j.entitlements_error)) {
          entitlementsHandler.showError(j.entitlements_error)
          setSteveIsTyping(false)
        }
        if (j?.success && j.message_id) {
          getOutboxEntries().then(entries => {
            const e = entries.find(x => x.clientKey === clientKey)
            if (e?.id != null) removeFromOutbox(e.id).catch(() => {})
          }).catch(() => {})

          idBridgeRef.current.tempToServer.set(clientKey, j.message_id)
          idBridgeRef.current.serverToTemp.set(j.message_id, clientKey)
          setMessages(prev => {
            let found = false
            const updated = prev.map(m => {
              if ((m.clientKey || m.id) === clientKey) {
                found = true
                return { ...m, id: j.message_id, isOptimistic: false, sendFailed: false, clientKey }
              }
              return m
            })
            if (!found) return prev
            return updated.filter(m => m.id !== j.message_id || (m.clientKey || m.id) === clientKey)
          })
          setTimeout(() => recentOptimisticRef.current.delete(clientKey), 1000)
        } else {
          clearTimeout(retryTimeout)
          markRetryFailed()
        }
      })
      .catch(() => {
        clearTimeout(retryTimeout)
        markRetryFailed()
      })
  }

  function handlePhotoSelect() {
    setShowAttachMenu(false)
    fileInputRef.current?.click()
  }

  function handleCameraOpen() {
    setShowAttachMenu(false)
    cameraInputRef.current?.click()
  }

  function handleVideoSelect() {
    setShowAttachMenu(false)
    videoInputRef.current?.click()
  }

  function handleDocumentSelect() {
    setShowAttachMenu(false)
    documentInputRef.current?.click()
  }

  function handleDocumentChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const uploadPauseMs = Math.min(60_000, Math.max(15_000, 10_000 + Math.floor(file.size / (512 * 1024)) * 1000))
    skipNextPollsUntil.current = Date.now() + uploadPauseMs
    void sendDocumentMessage({
      file,
      otherUserId,
      setMessages,
      scrollToBottom,
      recentOptimisticRef,
      idBridgeRef,
      setSending,
      notifyError: msg => alert(msg),
    })
    if (documentInputRef.current) documentInputRef.current.value = ''
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    if (!files || files.length === 0) return
    const newMedia: Array<{ file: File; previewUrl: string; type: 'image' | 'video' | 'audio' }> = []
    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        newMedia.push({ file, previewUrl: URL.createObjectURL(file), type: 'image' })
      } else if (file.type.startsWith('video/')) {
        newMedia.push({ file, previewUrl: URL.createObjectURL(file), type: 'video' })
      } else if (file.type.startsWith('audio/')) {
        newMedia.push({ file, previewUrl: URL.createObjectURL(file), type: 'audio' })
      }
    })
    if (newMedia.length > 0) {
      setPendingMedia(prev => [...prev, ...newMedia])
      setPreviewIndex(0)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (cameraInputRef.current) cameraInputRef.current.value = ''
  }

  function handleVideoFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    if (!files || files.length === 0) return
    const newMedia: Array<{ file: File; previewUrl: string; type: 'image' | 'video' | 'audio' }> = []
    Array.from(files).forEach(file => {
      if (file.type.startsWith('video/') || file.type.startsWith('image/')) {
        newMedia.push({ file, previewUrl: URL.createObjectURL(file), type: file.type.startsWith('video/') ? 'video' : 'image' })
      } else if (file.type.startsWith('audio/')) {
        newMedia.push({ file, previewUrl: URL.createObjectURL(file), type: 'audio' })
      }
    })
    if (newMedia.length > 0) {
      setPendingMedia(prev => [...prev, ...newMedia])
      setPreviewIndex(0)
    }
    if (videoInputRef.current) videoInputRef.current.value = ''
  }

  function removeMediaFromPreview(index: number) {
    setPendingMedia(prev => {
      const item = prev[index]
      if (item?.previewUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(item.previewUrl) } catch {}
      }
      const newMedia = prev.filter((_, i) => i !== index)
      if (previewIndex >= newMedia.length && newMedia.length > 0) {
        setPreviewIndex(newMedia.length - 1)
      }
      return newMedia
    })
  }

  async function confirmSendMedia() {
    if (pendingMedia.length === 0 || !otherUserId) return
    if (tryBlockSteveIntentSend('')) return
    const mediaToSend = [...pendingMedia]
    const audios = mediaToSend.filter(i => i.type === 'audio')
    const imagesAndVideos = mediaToSend.filter(i => i.type === 'image' || i.type === 'video')

    const revokeAll = () => {
      mediaToSend.forEach(item => {
        if (item.previewUrl.startsWith('blob:')) {
          try { URL.revokeObjectURL(item.previewUrl) } catch {}
        }
      })
    }

    if (imagesAndVideos.length === 0 && audios.length > 0) {
      setPendingMedia([])
      setPreviewIndex(0)
      revokeAll()
      for (const item of audios) {
        await uploadSharedAudioFile(item.file)
      }
      return
    }

    if (mediaToSend.length === 1) {
      setPendingMedia([])
      setPreviewIndex(0)
      const item = mediaToSend[0]
      if (item.type === 'image') {
        handleImageFile(item.file, 'photo')
      } else if (item.type === 'video') {
        handleVideoFile(item.file)
      } else {
        await uploadSharedAudioFile(item.file)
      }
      if (item.previewUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(item.previewUrl) } catch {}
      }
      return
    }

    setPendingMedia([])
    setPreviewIndex(0)
    revokeAll()

    for (const item of audios) {
      await uploadSharedAudioFile(item.file)
    }

    if (imagesAndVideos.length === 0) return

    void sendMultiMediaMessage({
      files: imagesAndVideos.map(item => ({ file: item.file, type: item.type as 'image' | 'video' })),
      otherUserId,
      username,
      setMessages,
      scrollToBottom,
      recentOptimisticRef,
      idBridgeRef,
      setSending,
      lockComposer: false,
      onProgress: (progress) => {
        setVideoUploadProgress(progress)
        if (progress.stage === 'done' || progress.stage === 'error') {
          setTimeout(() => setVideoUploadProgress(null), 2000)
        }
      },
    })
  }

  function cancelMediaPreview() {
    pendingMedia.forEach(item => {
      if (item.previewUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(item.previewUrl) } catch {}
      }
    })
    setPendingMedia([])
    setPreviewIndex(0)
  }

  async function handleGifSelection(gif: GifSelection) {
    if (!otherUserId) return
    if (tryBlockSteveIntentSend('')) return
    try {
      const file = await gifSelectionToFile(gif, 'chat-gif')
      handleImageFile(file, 'gif')
    } catch (err) {
      console.error('Failed to prepare GIF for chat', err)
      alert(t('chat.attach_gif_failed'))
    }
  }

  function handleImageFile(file: File, kind: 'photo' | 'gif' = 'photo', cleanup?: () => void) {
    if (tryBlockSteveIntentSend('')) return
    sendImageMessage({
      file,
      kind,
      otherUserId,
      username,
      setMessages,
      scrollToBottom,
      recentOptimisticRef,
      idBridgeRef,
      setSending,
      setPastedImage,
      cleanup,
    })
  }

  function handleVideoFile(file: File, cleanup?: () => void) {
    if (tryBlockSteveIntentSend('')) return
    sendVideoMessage({
      file,
      otherUserId,
      username,
      setMessages,
      scrollToBottom,
      recentOptimisticRef,
      idBridgeRef,
      setSending,
      cleanup,
      onProgress: (progress) => {
        setVideoUploadProgress(progress)
        // Clear progress after completion or error
        if (progress.stage === 'done' || progress.stage === 'error') {
          setTimeout(() => setVideoUploadProgress(null), 2000)
        }
      },
    })
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    // Helper to show image preview and dismiss keyboard
    const showImagePreview = (file: File) => {
      // Create blob URL immediately (before any async operations that might clear clipboard)
      const blobUrl = URL.createObjectURL(file)
      
      // Blur the textarea to dismiss the keyboard on mobile
      if (textareaRef.current) {
        textareaRef.current.blur()
      }
      // Also try to blur the active element
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
      
      // Set both states together - previewImage triggers the modal
      setPastedImage(file)
      setPreviewImage(blobUrl)
    }
    
    // Try the modern Clipboard API first (works on native apps and desktop)
    if (navigator.clipboard && navigator.clipboard.read) {
      try {
        const clipboardItems = await navigator.clipboard.read()

        for (const clipboardItem of clipboardItems) {
          for (const type of clipboardItem.types) {
            if (type.startsWith('image/')) {
              event.preventDefault()
              const blob = await clipboardItem.getType(type)
              const file = new File([blob], `pasted-image.${type.split('/')[1]}`, { type })
              showImagePreview(file)
              return
            }
          }
        }
      } catch {
        // Fall back to legacy method
      }
    }

    // Fallback to legacy clipboardData method (limited support)
    const items = event.clipboardData?.items
    if (!items) return

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.indexOf('image') !== -1) {
        event.preventDefault()
        const file = item.getAsFile()
        if (file) {
          showImagePreview(file)
        }
        break
      }
    }
  }

  async function uploadSharedAudioFile(file: File) {
    if (!otherUserId) return
    if (tryBlockSteveIntentSend('')) return
    setSending(true)
    skipNextPollsUntil.current = Date.now() + 5000
    const tempId = `temp_audio_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const url = URL.createObjectURL(file)
    let durationSeconds = ''
    try {
      const d = await new Promise<number>(resolve => {
        const a = new Audio()
        a.preload = 'metadata'
        a.src = url
        a.onloadedmetadata = () => {
          const sec = Math.round(a.duration || 0)
          a.remove()
          resolve(sec)
        }
        a.onerror = () => {
          a.remove()
          resolve(0)
        }
        setTimeout(() => resolve(0), 6000)
      })
      if (d > 0) durationSeconds = String(d)
    } catch {
      durationSeconds = ''
    }
    try {
      const now = new Date().toISOString()
      const optimistic: Message = {
        id: tempId,
        text: '🎤 Voice message',
        audio_path: url,
        sent: true,
        time: now,
        isOptimistic: true,
        clientKey: tempId,
      }
      setMessages(prev => [...prev, optimistic])
      recentOptimisticRef.current.set(tempId, { message: optimistic, timestamp: Date.now() })
      setTimeout(scrollToBottom, 50)
      const fd = new FormData()
      fd.append('recipient_id', String(otherUserId))
      if (durationSeconds) fd.append('duration_seconds', durationSeconds)
      fd.append('audio', file, file.name || 'audio.m4a')
      const r = await fetch('/send_audio_message', { method: 'POST', credentials: 'include', body: fd })
      const j = await r.json().catch(() => null)
      if (!j?.success) {
        setMessages(prev => prev.filter(m => (m.clientKey || m.id) !== tempId))
        recentOptimisticRef.current.delete(tempId)
        URL.revokeObjectURL(url)
        alert(j?.error || t('chat.failed_send_audio'))
      } else if (j.message_id) {
        idBridgeRef.current.tempToServer.set(tempId, j.message_id)
        idBridgeRef.current.serverToTemp.set(j.message_id, tempId)
        setMessages(prev => {
          const serverId = j.message_id
          const updated = prev.map(m => {
            if ((m.clientKey || m.id) === tempId) {
              return {
                ...m,
                id: serverId,
                audio_path: j.audio_path || m.audio_path,
                audio_summary: j.audio_summary || m.audio_summary || null,
                isOptimistic: false,
                clientKey: tempId,
              }
            }
            return m
          })
          return updated.filter(m => m.id !== serverId || (m.clientKey || m.id) === tempId)
        })
        setTimeout(() => recentOptimisticRef.current.delete(tempId), 1000)
        setTimeout(() => URL.revokeObjectURL(url), 100)
      }
    } catch (error) {
      console.error('Failed to send shared audio', error)
      setMessages(prev => prev.filter(m => (m.clientKey || m.id) !== tempId))
      recentOptimisticRef.current.delete(tempId)
      alert(t('chat.failed_send_audio'))
    } finally {
      setSending(false)
    }
  }

  async function uploadAudioBlob(blob: Blob){
    if (!otherUserId) return
    
    // Don't send if blob is empty (cancelled recording)
    if (!blob || blob.size === 0) {
      return
    }

    if (tryBlockSteveIntentSend('')) return
    
    setSending(true)
    // Pause polling longer for audio uploads (they take more time than text)
    skipNextPollsUntil.current = Date.now() + 5000
    const tempId = `temp_audio_${Date.now()}_${Math.random().toString(36).slice(2)}`
    try{
      const url = URL.createObjectURL(blob)
      const now = new Date().toISOString()
      const optimistic: Message = { id: tempId, text: '🎤 Voice message', audio_path: url, sent: true, time: now, isOptimistic: true, clientKey: tempId }
      setMessages(prev => [...prev, optimistic])
      
      // Register in recent optimistic to prevent poll from removing it
      recentOptimisticRef.current.set(tempId, { message: optimistic, timestamp: Date.now() })
      
      setTimeout(scrollToBottom, 50)
      const fd = new FormData()
      fd.append('recipient_id', String(otherUserId))
      fd.append('duration_seconds', String(Math.round(recordMs/1000)))
      fd.append('audio', blob, 'voice.webm')
      const r = await fetch('/send_audio_message', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (!j?.success){
        setMessages(prev => prev.filter(m => (m.clientKey || m.id) !== tempId))
        recentOptimisticRef.current.delete(tempId)
        URL.revokeObjectURL(url)
        alert(j?.error || t('chat.failed_send_audio'))
      } else {
        // Update optimistic message with server data and remove duplicates
        if (j.message_id) {
          idBridgeRef.current.tempToServer.set(tempId, j.message_id)
          idBridgeRef.current.serverToTemp.set(j.message_id, tempId)
          setMessages(prev => {
            const serverId = j.message_id
            const updated = prev.map(m => {
              if ((m.clientKey || m.id) === tempId) {
                return {
                  ...m,
                  id: serverId,
                  audio_path: j.audio_path || m.audio_path,
                  audio_summary: j.audio_summary || m.audio_summary || null,
                  isOptimistic: false,
                  clientKey: tempId,
                }
              }
              return m
            })
            // Filter out poll-added duplicates
            return updated.filter(m => m.id !== serverId || (m.clientKey || m.id) === tempId)
          })
          // Clean up ref
          setTimeout(() => recentOptimisticRef.current.delete(tempId), 1000)
        }
        // Revoke blob URL after successful upload
        setTimeout(() => URL.revokeObjectURL(url), 100)
      }
    }catch(error){
      console.error('Failed to send audio', error)
      setMessages(prev => prev.filter(m => (m.clientKey || m.id) !== tempId))
      recentOptimisticRef.current.delete(tempId)
      alert(t('chat.failed_send_audio'))
    }finally{
      setSending(false)
    }
  }

  // startVisualizer removed; shared recorder handles visualizer internally

  // resetRecordingState utility not used currently (native fallback disabled)

  // Note: native audio capture fallback removed; using shared recorder
  
  
  function sendRecordingPreview(){
    if (!recordingPreview) return
    uploadAudioBlobWithDuration(recordingPreview.blob, (recordingPreview as any).duration || Math.round((recordMs||0)/1000))
    // CRITICAL iOS FIX: Add small delay before cleanup to ensure blob is sent
    setTimeout(() => {
      cancelRecordingPreview()
      setPreviewPlaying(false)
    }, 100)
  }
  
  // Send voice message directly while recording (WhatsApp-style)
  async function sendVoiceDirectly() {
    if (!recording) return
    try {
      const result = await stopAndGetBlob()
      if (result && result.blob && result.blob.size > 0) {
        uploadAudioBlobWithDuration(result.blob, result.duration)
        // Clean up the URL after a delay
        setTimeout(() => {
          try { URL.revokeObjectURL(result.url) } catch {}
        }, 1000)
      }
    } catch (err) {
      console.error('Failed to send voice directly:', err)
    }
  }
  
  // Toggle preview audio playback
  async function togglePreviewPlayback() {
    if (!recordingPreview?.url) return
    
    // Get or create audio element
    let audio = previewAudioRef.current
    
    if (previewPlaying && audio) {
      audio.pause()
      setPreviewPlaying(false)
      return
    }
    
    try {
      // For iOS: create a fresh audio element each time to avoid caching issues
      if (!audio) {
        audio = new Audio()
        audio.setAttribute('playsinline', 'true')
        audio.setAttribute('webkit-playsinline', 'true')
        audio.preload = 'auto'
        audio.onended = () => setPreviewPlaying(false)
        audio.onpause = () => setPreviewPlaying(false)
        audio.onplay = () => setPreviewPlaying(true)
        previewAudioRef.current = audio
      }
      
      // Set source if different
      if (audio.src !== recordingPreview.url) {
        audio.src = recordingPreview.url
        audio.load()
        // Wait for iOS to load
        await new Promise(resolve => setTimeout(resolve, 150))
      }
      
      await audio.play()
      setPreviewPlaying(true)
    } catch (e) {
      console.log('Preview play error:', e)
      setPreviewPlaying(false)
    }
  }
  
  async function uploadAudioBlobWithDuration(blob: Blob, durationSeconds: number){
    if (!otherUserId) return
    
    // Don't send if blob is empty (cancelled recording)
    if (!blob || blob.size === 0) {
      return
    }

    if (tryBlockSteveIntentSend('')) return
    
    setSending(true)
    // Pause polling for audio uploads
    skipNextPollsUntil.current = Date.now() + 5000
    const tempId = `temp_audio_${Date.now()}_${Math.random().toString(36).slice(2)}`
    try{
      const url = URL.createObjectURL(blob)
      const now = new Date().toISOString()
      const optimistic: Message = { 
        id: tempId, 
        text: '🎤 Voice message', 
        audio_path: url, 
        sent: true, 
        time: now, 
        isOptimistic: true, 
        clientKey: tempId, 
        audio_duration_seconds: durationSeconds
      }
      setMessages(prev => [...prev, optimistic])
      
      // Register in recent optimistic to prevent poll from removing it
      recentOptimisticRef.current.set(tempId, { message: optimistic, timestamp: Date.now() })
      
      setTimeout(scrollToBottom, 50)
      const fd = new FormData()
      fd.append('recipient_id', String(otherUserId))
      fd.append('duration_seconds', String(durationSeconds))
      
      // Determine file extension based on blob type
      let filename = 'voice.webm'
      if (blob.type.includes('mp4')) {
        filename = 'voice.mp4'
      } else if (blob.type.includes('wav')) {
        filename = 'voice.wav'
      } else if (blob.type.includes('ogg')) {
        filename = 'voice.ogg'
      }
      
      fd.append('audio', blob, filename)
      const r = await fetch('/send_audio_message', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (!j?.success){
        setMessages(prev => prev.filter(m => (m.clientKey || m.id) !== tempId))
        recentOptimisticRef.current.delete(tempId)
        URL.revokeObjectURL(url)
        alert(j?.error || t('chat.failed_send_audio'))
      } else {
        // Update optimistic message with server data and remove duplicates
        if (j.message_id) {
          idBridgeRef.current.tempToServer.set(tempId, j.message_id)
          idBridgeRef.current.serverToTemp.set(j.message_id, tempId)
          setMessages(prev => {
            const serverId = j.message_id
            const updated = prev.map(m => {
              if ((m.clientKey || m.id) === tempId) {
                return {
                  ...m,
                  id: serverId,
                  audio_path: j.audio_path || m.audio_path,
                  audio_summary: j.audio_summary || m.audio_summary || null,
                  audio_duration_seconds: durationSeconds,
                  isOptimistic: false,
                  clientKey: tempId,
                }
              }
              return m
            })
            // Filter out poll-added duplicates
            return updated.filter(m => m.id !== serverId || (m.clientKey || m.id) === tempId)
          })
          // Clean up ref
          setTimeout(() => recentOptimisticRef.current.delete(tempId), 1000)
        }
        // Revoke blob URL after successful upload
        setTimeout(() => URL.revokeObjectURL(url), 100)
      }
    }catch(error){
      console.error('Failed to send voice message', error)
      setMessages(prev => prev.filter(m => (m.clientKey || m.id) !== tempId))
      recentOptimisticRef.current.delete(tempId)
      const message = error instanceof Error ? error.message : String(error)
      alert(t('chat.failed_send_voice', { message }))
    } finally {
      setSending(false)
    }
  }
  
  // cancelRecordingPreview comes from shared hook

  function handleAudioFileChange(event: React.ChangeEvent<HTMLInputElement>){
    const file = event.target.files?.[0]
    if (!file) return
    uploadAudioBlob(file)
    event.target.value = ''
  }

  async function checkMicrophonePermission() {
    // Check if we've already granted permission before (stored locally)
    const hasGrantedBefore = localStorage.getItem('mic_permission_granted') === 'true'
    
    if (hasGrantedBefore) {
      // Permission was granted before, start recording directly
      startVoiceRecording()
      return
    }
    
    try {
      // Check current permission state via browser API
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName })
      
      if (permissionStatus.state === 'granted') {
        // Permission already granted, save it and start recording
        localStorage.setItem('mic_permission_granted', 'true')
        startVoiceRecording()
      } else if (permissionStatus.state === 'denied') {
        // Permission denied, show help modal
        setShowPermissionGuide(true)
      } else {
        // Permission not yet requested, show pre-permission modal
        setShowMicPermissionModal(true)
      }
    } catch {
      // Fallback for browsers that don't support permissions API (like iOS Safari)
      // Just try to start recording - browser will show its own permission dialog
      startVoiceRecording()
    }
  }

  function requestMicrophoneAccess() {
    setShowMicPermissionModal(false)
    // Start recording which will trigger the browser's permission dialog
    // Save that user has initiated mic access (will be confirmed on successful recording)
    localStorage.setItem('mic_permission_granted', 'true')
    startVoiceRecording()
  }

  function handleDeleteMessage(messageId: number | string, messageData: Message) {
    // Show confirmation dialog
    if (!confirm(t('chat.delete_message_confirm'))) {
      return
    }

    /** Positive numeric server id only — temp_… and negative ids are client-only (failed / unsent). */
    const hasPersistedServerId =
      (typeof messageId === 'number' && messageId > 0) ||
      (typeof messageId === 'string' && /^\d+$/.test(messageId) && Number(messageId) > 0)

    if (!hasPersistedServerId) {
      pendingDeletions.current.add(messageId)
      setMessages(prev => prev.filter(x => x.id !== messageId))
      const ck =
        (messageData as { clientKey?: string }).clientKey ||
        (typeof messageId === 'string' && messageId.startsWith('temp_') ? messageId : undefined)
      if (ck) {
        try {
          recentOptimisticRef.current.delete(ck)
        } catch {
          /* ignore */
        }
        getOutboxEntries()
          .then(entries => {
            const e = entries.find(x => x.clientKey === ck && x.type === 'dm')
            if (e?.id != null) removeFromOutbox(e.id).catch(() => {})
          })
          .catch(() => {})
      }
      setTimeout(() => pendingDeletions.current.delete(messageId), 5000)
      return
    }
    
    // Add to pending deletions
    pendingDeletions.current.add(messageId)
    
    // Optimistically remove the message
    setMessages(prev => prev.filter(x => x.id !== messageId))
    
    // Send delete request
    const fd = new URLSearchParams({ message_id: String(messageId) })
    
    fetch('/delete_message', { 
      method:'POST', 
      credentials:'include', 
      headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, 
      body: fd 
    })
    .then(r=>r.json())
    .then(j=>{ 
      if (!j?.success) { 
        // Remove from pending deletions
        pendingDeletions.current.delete(messageId)
        
        // Restore the message if deletion failed
        setMessages(prev => {
          // Check if message still exists (might have been re-added by polling)
          if (prev.some(x => x.id === messageId)) {
            return prev
          }
          // Re-add the message in the correct position
          const newMessages = [...prev, messageData]
          return newMessages.sort((a, b) => {
            const aId = typeof a.id === 'number' ? a.id : parseInt(String(a.id)) || 0
            const bId = typeof b.id === 'number' ? b.id : parseInt(String(b.id)) || 0
            if (aId > 0 && bId > 0) return aId - bId
            if (aId > 0) return -1
            if (bId > 0) return 1
            return (getMessageTimestamp(a.time) ?? Date.now()) - (getMessageTimestamp(b.time) ?? Date.now())
          })
        })
        
        // Show error
        if (j?.error) {
          alert(j.error === t('chat.premium_required_delete') 
            ? t('chat.premium_required_delete') 
            : `Failed to delete message: ${j.error}`)
        } else {
          alert(t('chat.failed_delete_message'))
        }
      } else {
        // Success - keep in pending deletions for a while to prevent re-appearing
        setTimeout(() => {
          pendingDeletions.current.delete(messageId)
        }, 5000)
      }
    })
    .catch(()=>{
      // Network error
      pendingDeletions.current.delete(messageId)
      
      // Restore the message
      setMessages(prev => {
        if (prev.some(x => x.id === messageId)) {
          return prev
        }
        const newMessages = [...prev, messageData]
        return newMessages.sort((a, b) => {
          const aId = typeof a.id === 'number' ? a.id : parseInt(String(a.id)) || 0
          const bId = typeof b.id === 'number' ? b.id : parseInt(String(b.id)) || 0
          if (aId > 0 && bId > 0) return aId - bId
          if (aId > 0) return -1
          if (bId > 0) return 1
          return (getMessageTimestamp(a.time) ?? Date.now()) - (getMessageTimestamp(b.time) ?? Date.now())
        })
      })
      
      alert(t('chat.delete_network_error'))
    })
  }

  async function handleRemoveDmMediaItem(messageId: number | string, mediaUrl: string) {
    const hasPersistedServerId =
      (typeof messageId === 'number' && messageId > 0) ||
      (typeof messageId === 'string' && /^\d+$/.test(messageId) && Number(messageId) > 0)
    if (!hasPersistedServerId) return
    if (!confirm(t('chat.remove_attachment_confirm'))) return
    try {
      const res = await fetch('/api/chat/dm/remove_message_media', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: messageId, media_url: mediaUrl }),
      })
      const j = await res.json().catch(() => null)
      if (!j?.success) {
        alert(j?.error || t('chat.failed_remove_attachment'))
        return
      }
      if (j.deleted_message) {
        setMessages(prev => prev.filter(x => x.id !== messageId))
        return
      }
      const mp = (j.media_paths as string[] | undefined) || []
      const pickFirst = (re: RegExp) => mp.find(p => re.test(p.split('?')[0].toLowerCase()))
      const firstImg = pickFirst(/\.(png|jpg|jpeg|gif|webp)$/i)
      const firstVid = pickFirst(/\.(mp4|mov|webm|m4v|avi)$/i)
      setMessages(prev =>
        prev.map(x => {
          if (x.id !== messageId) return x
          return {
            ...x,
            media_paths: mp.length ? mp : undefined,
            image_path: firstImg ?? undefined,
            video_path: firstVid ?? undefined,
          }
        })
      )
    } catch {
      alert(t('chat.remove_attachment_network_error'))
    }
  }

  // Toggle message selection in multi-select mode
  function toggleMessageSelection(messageId: number | string) {
    setSelectedMessages(prev => {
      const next = new Set(prev)
      if (next.has(messageId)) {
        next.delete(messageId)
      } else {
        next.add(messageId)
      }
      return next
    })
  }

  // Enter multi-select mode (triggered by long press on any message)
  function enterMultiSelectMode(firstMessageId?: number | string) {
    setIsMultiSelectMode(true)
    if (firstMessageId !== undefined) {
      setSelectedMessages(new Set([firstMessageId]))
    }
  }

  // Exit multi-select mode
  function exitMultiSelectMode() {
    setIsMultiSelectMode(false)
    setSelectedMessages(new Set())
  }

  // Delete all selected messages
  async function deleteSelectedMessages() {
    if (selectedMessages.size === 0) return
    
    const count = selectedMessages.size
    if (!confirm(t('chat.delete_messages_confirm', { count }))) {
      return
    }

    // Get message data before deleting
    const messagesToDelete = messages.filter(m => selectedMessages.has(m.id))
    
    // Add all to pending deletions
    selectedMessages.forEach(id => pendingDeletions.current.add(id))
    
    // Optimistically remove all selected messages
    setMessages(prev => prev.filter(m => !selectedMessages.has(m.id)))
    
    // Exit multi-select mode
    exitMultiSelectMode()
    
    // Delete each message
    for (const msg of messagesToDelete) {
      try {
        const fd = new URLSearchParams({ message_id: String(msg.id) })
        const res = await fetch('/delete_message', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: fd
        })
        const j = await res.json()
        
        if (j?.success) {
          setTimeout(() => {
            pendingDeletions.current.delete(msg.id)
          }, 5000)
        } else {
          pendingDeletions.current.delete(msg.id)
          // Don't restore individual messages, just log the error
          console.error('Failed to delete message:', msg.id, j?.error)
        }
      } catch {
        pendingDeletions.current.delete(msg.id)
        console.error('Network error deleting message:', msg.id)
      }
    }
  }

  // Block user function
  async function handleBlockUser() {
    if (!username) return
    setBlockSubmitting(true)
    try {
      const res = await fetch('/api/block_user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          blocked_username: username,
          reason: blockReason,
          also_report: !!blockReason
        })
      })
      const j = await res.json().catch(() => null)
      if (j?.success) {
        alert(t('feed.user_blocked', { username }))
        setShowBlockModal(false)
        setBlockReason('')
        navigate('/user_chat')
      } else {
        alert(j?.error || t('feed.block_user_failed'))
      }
    } catch {
      alert(t('feed.block_user_network_failed'))
    } finally {
      setBlockSubmitting(false)
    }
  }

  return (
    <>
    {/* Main container with overflow:hidden */}
    <div 
      className="glass-page text-white chat-thread-bg"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header - fixed at top with safe area, full viewport width */}
      <div 
        className="flex-shrink-0 border-b border-[#262f30]"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          width: '100vw',
          zIndex: 1001,
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
          background: '#000',
        }}
      >
        <div className="h-12 flex items-center gap-2 px-3">
          <button 
            className="p-2 rounded-full hover:bg-white/10 transition-colors" 
            onClick={()=> navigate('/user_chat')} 
            aria-label={t('chat.back_to_messages')}
          >
            <i className="fa-solid fa-arrow-left text-white" />
          </button>
            <Avatar 
              key={`${username || ''}:${otherProfile?.profile_picture || ''}`}
              username={username || ''} 
              url={otherProfile?.profile_picture || undefined} 
              size={36}
              linkToProfile
              displayName={otherProfile?.display_name}
              loading="eager"
            />
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate text-white text-sm">
              {otherProfile?.display_name || username || 'Chat'}
            </div>
            {/* Online/typing label removed as requested */}
          </div>
          <button 
            type="button"
            className="p-2 rounded-full hover:bg-white/10 transition-colors" 
            aria-label={t('chat.more_options')}
            aria-haspopup="true"
            aria-expanded={headerMenuOpen}
            onMouseDown={(event)=> event.stopPropagation()}
            onClick={(event)=> {
              event.stopPropagation()
              setHeaderMenuOpen(prev => !prev)
            }}
          >
            <i className="fa-solid fa-ellipsis-vertical text-white/70" />
          </button>
          {headerMenuOpen && (
            <div
              ref={headerMenuRef}
              className="absolute right-3 top-full mt-2 z-[10020] w-48"
              onMouseDown={(event)=> event.stopPropagation()}
              onClick={(event)=> event.stopPropagation()}
            >
              <div className="rounded-xl border border-white/10 bg-[#111111] shadow-lg shadow-black/40 py-1">
                <Link
                  to={profilePath || '/profile'}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/10 transition-colors"
                  onClick={() => setHeaderMenuOpen(false)}
                >
                  <i className="fa-solid fa-user text-xs text-[#4db6ac]" />
                  <span>{t('chat.view_profile')}</span>
                </Link>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/10 transition-colors"
                  onClick={() => {
                    setHeaderMenuOpen(false)
                    navigate(`/chat/${username}/media`)
                  }}
                >
                  <i className="fa-solid fa-photo-film text-xs text-[#4db6ac]" />
                  <span>{t('chat.view_media')}</span>
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/10 transition-colors"
                  onClick={() => {
                    setHeaderMenuOpen(false)
                    navigate(`/chat/${username}/documents`)
                  }}
                >
                  <i className="fa-solid fa-file-pdf text-xs text-[#4db6ac]" />
                  <span>{t('chat.view_documents')}</span>
                </button>
                {isSteveDm && (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/10 transition-colors"
                    onClick={() => {
                      setHeaderMenuOpen(false)
                      setReminderVaultOpen(true)
                      setEditingVaultId(null)
                    }}
                  >
                    <i className="fa-solid fa-clock text-xs text-[#4db6ac]" aria-hidden />
                    <span>{t('chat.reminder_vault')}</span>
                  </button>
                )}
                {(username || '').toLowerCase() === 'steve' && (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/10 transition-colors"
                    onClick={() => {
                      setHeaderMenuOpen(false)
                      if (!confirm(t('chat.reset_steve_confirm'))) return
                      fetch('/api/steve/reset_dm_context', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ other_username: username })
                      })
                        .then(r => r.json())
                        .then(d => {
                          if (d?.success) {
                            alert(t('chat.reset_steve_success'))
                          } else {
                            alert(d?.error || t('chat.reset_steve_failed'))
                          }
                        })
                        .catch(() => alert(t('chat.reset_steve_context_failed')))
                    }}
                  >
                    <i className="fa-solid fa-rotate text-xs text-[#4db6ac]" />
                    <span>{t('chat.reset_steve')}</span>
                  </button>
                )}
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-white/10 transition-colors"
                  onClick={() => {
                    setHeaderMenuOpen(false)
                    setShowBlockModal(true)
                  }}
                >
                  <i className="fa-solid fa-ban text-xs" />
                  <span>{t('chat.block_user')}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Content area - with top padding for fixed header */}
      <div 
        className="flex-1 flex flex-col min-h-0 px-0"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 48px)',
          ...(androidKeyboardOpen ? {
            maxHeight: `${(window.visualViewport?.height ?? window.innerHeight)}px`,
          } : {}),
        }}
      >
        <div className="mx-auto flex max-w-3xl w-full flex-1 flex-col min-h-0">
      
      {/* ====== MESSAGES LIST - SCROLLABLE (inverted: column-reverse) ====== */}
      <div
        ref={listRef}
        className={`flex-1 overflow-y-auto overflow-x-hidden text-white px-2.5 sm:px-3 chat-list-inset${insetMotionIdle ? ' chat-list-idle-smooth' : ''}`}
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehaviorY: 'auto',
          paddingBottom: listPaddingBottom,
          scrollPaddingBottom: listScrollPaddingBottom,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column-reverse',
        } as CSSProperties}
        onPointerDown={handleContentPointerDown}
        onPointerUp={handleContentPointerUp}
        onPointerCancel={handleContentPointerCancel}
        onScroll={handleListScroll}
      >
        {/* DOM order under column-reverse: first = visual bottom, last = visual top. */}
        <ChatVirtualMessageList
          messages={messages}
          messageStackRef={messageStackRef}
          lastMessageRef={lastMessageRef}
          listRef={listRef}
          className="space-y-[9px]"
          itemKey={(m, idx) => m.clientKey ?? m.id ?? idx}
          footer={
            steveIsTyping ? (
              <div className="min-h-[36px]">
                <SteveTypingIndicator active={steveIsTyping} />
              </div>
            ) : undefined
          }
          renderItem={(m, index) => {
          const messageDate = getDateKey(m.time)
          const prevMessageDate = index > 0 ? getDateKey(messages[index - 1].time) : null
          const showDateSeparator = messageDate !== prevMessageDate
          
          return (
            <>
              {showDateSeparator && (
                <div className="flex justify-center my-3">
                  <div className="liquid-glass-chip px-3 py-1 text-xs text-white/80 border">
                    {formatDateLabel(m.time)}
                  </div>
                </div>
              )}
              
              <div 
                data-message-date={m.time}
                className={`flex items-center gap-2 ${isMultiSelectMode ? 'py-1' : ''}`}
                onClick={isMultiSelectMode ? () => toggleMessageSelection(m.id) : undefined}
              >
                {isMultiSelectMode && (
                  <button
                    className={`w-6 h-6 flex-shrink-0 rounded-full flex items-center justify-center border-2 transition-all ${
                      selectedMessages.has(m.id)
                        ? 'bg-[#4db6ac] border-[#4db6ac]'
                        : 'bg-transparent border-white/40'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleMessageSelection(m.id)
                    }}
                  >
                    {selectedMessages.has(m.id) && (
                      <i className="fa-solid fa-check text-white text-xs" />
                    )}
                  </button>
                )}
                <SwipeToReply
                  className="flex-1 min-w-0"
                  disabled={isMultiSelectMode || editingId === m.id}
                  onReply={() => {
                    setReplyTo({
                      text: m.text,
                      sender: m.sent ? 'You' : (otherProfile?.display_name || username || 'User'),
                      image_path: m.image_path,
                      video_path: m.video_path,
                      audio_path: m.audio_path,
                      audio_summary: m.audio_summary || undefined,
                    })
                    focusTextarea()
                  }}
                >
                <MessageBubble
                  message={m}
                  isEditing={editingId === m.id}
                  editText={editText}
                  editingSaving={editingSaving}
                  otherDisplayName={otherProfile?.display_name || username || 'User'}
                  onDelete={isMultiSelectMode ? () => {} : () => handleDeleteMessage(m.id, m)}
                  onReact={(emoji) => {
                    setMessages(msgs => msgs.map(x => x.id === m.id ? { ...x, reaction: emoji } : x))
                    // Save using ID-based storage (primary, more reliable)
                    if (username && m.id) {
                      setMessageReaction(username, m.id, emoji)
                    }
                    // Also save to legacy time-based storage for backwards compatibility
                    writeMessageMeta(metaRef.current, m.time, m.text, Boolean(m.sent), { reaction: emoji })
                    try { localStorage.setItem(storageKey, JSON.stringify(metaRef.current)) } catch {}
                    // Notify the other user about the reaction
                    if (m.id && !String(m.id).startsWith('temp_')) {
                      fetch('/api/chat/react_to_message', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message_id: m.id, emoji })
                      }).catch(() => {})
                    }
                  }}
                  onReply={() => {
                    setReplyTo({
                      text: m.text,
                      sender: m.sent ? 'You' : (otherProfile?.display_name || username || 'User'),
                      image_path: m.image_path,
                      video_path: m.video_path,
                      audio_path: m.audio_path,
                      audio_summary: m.audio_summary || undefined,
                    })
                    focusTextarea()
                  }}
                  onCopy={() => {
                    try {
                      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                        void navigator.clipboard.writeText(m.text)
                      }
                    } catch {}
                  }}
                  onEdit={m.sent ? () => {
                    const dt = parseMessageTime(m.time)
                    if (dt && (Date.now() - dt.getTime()) > 5 * 60 * 1000) return
                    setEditingId(m.id)
                    setEditText(m.text)
                  } : undefined}
                  onSelect={isMultiSelectMode ? undefined : () => enterMultiSelectMode(m.id)}
                  onRemoveMediaItem={
                    isMultiSelectMode
                      ? undefined
                      : (mediaUrl: string) => {
                          void handleRemoveDmMediaItem(m.id, mediaUrl)
                        }
                  }
                  onEditTextChange={setEditText}
                  onCommitEdit={commitEdit}
                  onCancelEdit={() => {
                    setEditingId(null)
                    setEditText('')
                  }}
                  onImageClick={(imagePath) => setPreviewImage(imagePath)}
                  onMediaGroupClick={(urls, index) => setViewingMedia({ urls, index })}
                  onEditSummary={(msgId, currentSummary) => {
                    setEditingSummaryId(msgId)
                    setEditSummaryText(currentSummary)
                  }}
                  translatedSummaries={dmTranslations}
                  translatingId={dmTranslatingId}
                  onTranslateSummary={(msgId, summary, langCode) => {
                    if (langCode === 'reset') {
                      setDmTranslations(prev => { const n = { ...prev }; delete n[msgId]; return n })
                    } else if (langCode === 'pick') {
                      setDmLangPickerId(msgId)
                      setDmLangPickerSummary(summary)
                    }
                  }}
                  onStoryReplyClick={async (storyId) => {
                    // Fetch the story to get its community_id, then navigate
                    try {
                      // Ensure storyId is clean (no trailing whitespace or special chars)
                      const cleanStoryId = String(storyId).trim()
                      console.log('🎬 Fetching story:', cleanStoryId, 'raw:', storyId)
                      
                      if (!cleanStoryId || cleanStoryId === 'undefined' || cleanStoryId === 'null') {
                        console.error('Invalid story ID:', storyId)
                        alert(t('chat.story_invalid'))
                        return
                      }
                      
                      const res = await fetch(`/api/story/${cleanStoryId}`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
                      console.log('🎬 Story response status:', res.status)
                      
                      if (!res.ok) {
                        if (res.status === 404) {
                          alert(t('chat.story_unavailable'))
                          return
                        }
                        console.error('HTTP error:', res.status)
                        alert(t('chat.story_load_failed'))
                        return
                      }
                      
                      const json = await res.json()
                      console.log('🎬 Story response:', json)
                      
                      if (json?.success && json.story?.community_id) {
                        // Navigate to community feed with the story ID to open
                        navigate(`/community_feed_react/${json.story.community_id}`, { state: { openStoryId: Number(cleanStoryId) } })
                      } else if (json?.error === 'Story not found' || json?.error === 'Story expired') {
                        // Story might have expired
                        alert(t('chat.story_unavailable'))
                      } else {
                        console.error('Failed to get story details:', json)
                        alert(t('chat.story_load_failed'))
                      }
                    } catch (err) {
                      console.error('Failed to fetch story:', err)
                      alert(t('chat.story_load_failed'))
                    }
                  }}
                  otherUsername={username}
                  onMentionClick={mentionToProfile}
                  linkPreviewReady={true}
                  onRetry={m.clientKey ? () => retryFailedMessage(String(m.clientKey)) : undefined}
                />
                </SwipeToReply>
              </div>
            </>
          )
        }}
        />

        {/* Load older spinner / button — visually at the top of the inverted list. */}
        {loadingOlder && (
          <div className="flex justify-center py-3">
            <i className="fa-solid fa-spinner fa-spin text-[#4db6ac] text-sm" />
          </div>
        )}
        {hasMoreMessages && !loadingOlder && (
          <div className="flex justify-center py-2">
            <button onClick={loadOlderMessages} className="text-xs text-[#4db6ac] hover:text-[#4db6ac]/80">
              Load older messages
            </button>
          </div>
        )}
        {messages.length === 0 && !navigator.onLine && (
          <div className="flex flex-col items-center justify-center py-20 text-[#9fb0b5]">
            <i className="fa-solid fa-wifi-slash text-3xl mb-3 opacity-50" />
            <div className="text-sm">{t('chat.offline_unavailable')}</div>
            <div className="text-xs mt-1 opacity-70">{t('chat.offline_go_online')}</div>
          </div>
        )}

      </div>
      </div>
    </div>
    </div>
    {/* End of main container - compositor and scroll button rendered outside to avoid overflow:hidden clipping */}

    {/* New messages chip — above composer when scrolled up */}
    {pendingNewCount > 0 && !isMultiSelectMode && (
      <NewMessagesChip
        count={pendingNewCount}
        bottom={scrollButtonBottom}
        onClick={() => {
          scrollToBottomSmooth()
          clearPendingNew()
        }}
      />
    )}

    {/* Scroll to bottom button - positioned above composer */}
    {showScrollDown && !isMultiSelectMode && (
      <button
        className="fixed z-50 w-10 h-10 rounded-full bg-[#4db6ac] text-black shadow-lg border border-[#4db6ac] hover:brightness-110 flex items-center justify-center"
        style={{ 
          bottom: scrollButtonBottom,
          right: '22px'
        }}
        onClick={() => { scrollToBottomSmooth() }}
        aria-label={t('chat.scroll_latest')}
      >
        <i className="fa-solid fa-arrow-down" />
      </button>
    )}

    {/* Multi-select action bar */}
    {isMultiSelectMode && (
      <ChatSelectionBar
        selectedCount={selectedMessages.size}
        onCancel={exitMultiSelectMode}
        onDelete={deleteSelectedMessages}
        deleteDisabled={selectedMessages.size === 0}
      />
    )}

    {/* ====== COMPOSER - FIXED AT BOTTOM (portaled for keyboard lift) ====== */}
    <ChatComposerPortal
      visible={!isMultiSelectMode && pendingMedia.length === 0}
      composerRef={composerRef}
      displayKeyboardLift={displayKeyboardLift}
      isWeb={isWeb}
    >
      <ChatComposerCard composerCardRef={composerCardRef} isWeb={isWeb}>
          {/* Attachment menu - positioned above the entire composer */}
          {showAttachMenu && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setShowAttachMenu(false)}
                style={{ 
                  pointerEvents: 'auto',
                  touchAction: 'manipulation'
                }}
              />
              <div 
                className="absolute z-50 liquid-glass-surface border border-white/10 rounded-2xl shadow-xl overflow-hidden min-w-[190px]"
                style={{
                  touchAction: 'manipulation',
                  bottom: 'calc(100% + 8px)',
                  left: 0,
                }}
              >
                <ChatAttachMenuRow onClick={handlePhotoSelect}>
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-image text-[#4db6ac] text-sm sm:text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-white font-medium text-sm sm:text-base">{t('chat.photos')}</div>
                    <div className="text-white/60 text-[10px] sm:text-xs">{t('chat.send_from_gallery')}</div>
                  </div>
                </ChatAttachMenuRow>
                <ChatAttachMenuRow onClick={handleCameraOpen}>
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-camera text-[#4db6ac] text-sm sm:text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-white font-medium text-sm sm:text-base">{t('chat.camera')}</div>
                    <div className="text-white/60 text-[10px] sm:text-xs">{t('chat.take_photo')}</div>
                  </div>
                </ChatAttachMenuRow>
                <ChatAttachMenuRow onClick={() => { setShowAttachMenu(false); setGifPickerOpen(true) }}>
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-images text-[#4db6ac] text-sm sm:text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-white font-medium text-sm sm:text-base">GIF</div>
                    <div className="text-white/60 text-[10px] sm:text-xs">{t('chat.powered_by_giphy')}</div>
                  </div>
                </ChatAttachMenuRow>
                <ChatAttachMenuRow onClick={handleVideoSelect}>
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-video text-[#4db6ac] text-sm sm:text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-white font-medium text-sm sm:text-base">{t('chat.video')}</div>
                    <div className="text-white/60 text-[10px] sm:text-xs">{t('chat.attach_from_library')}</div>
                  </div>
                </ChatAttachMenuRow>
                <ChatAttachMenuRow onClick={handleDocumentSelect}>
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-file-pdf text-[#4db6ac] text-sm sm:text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-white font-medium text-sm sm:text-base">{t('chat.document')}</div>
                    <div className="text-white/60 text-[10px] sm:text-xs">{t('chat.send_pdf')}</div>
                  </div>
                </ChatAttachMenuRow>
              </div>
            </>
          )}

          {/* Video upload progress bar */}
          {videoUploadProgress && (
            <div className="mb-2 px-3 py-2.5 bg-white/5 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0">
                  {videoUploadProgress.stage === 'uploading' && (
                    <i className="fa-solid fa-cloud-arrow-up text-[#4db6ac] animate-bounce" />
                  )}
                  {videoUploadProgress.stage === 'done' && (
                    <i className="fa-solid fa-check-circle text-green-400" />
                  )}
                  {videoUploadProgress.stage === 'error' && (
                    <i className="fa-solid fa-exclamation-circle text-red-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white/80 truncate">
                    {videoUploadProgress.stage === 'uploading'
                      ? SENDING_MEDIA_LABEL
                      : videoUploadProgress.stage === 'done'
                        ? (videoUploadProgress.message || 'Sent!')
                        : (videoUploadProgress.message || 'Could not send')}
                  </div>
                  <div className="mt-1.5 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-300 ${
                        videoUploadProgress.stage === 'error' ? 'bg-red-400' : 'bg-[#4db6ac]'
                      }`}
                      style={{ width: `${videoUploadProgress.progress}%` }}
                    />
                  </div>
                </div>
                <div className="flex-shrink-0 text-xs text-white/50">
                  {Math.round(videoUploadProgress.progress)}%
                </div>
              </div>
            </div>
          )}

          {replyTo && (
            <div className="mb-2 flex items-stretch gap-0 bg-white/5 rounded-lg overflow-hidden">
              {/* WhatsApp-style left accent bar */}
              <div className="w-1 bg-[#4db6ac] flex-shrink-0" />
              <div className="flex-1 px-3 py-2 min-w-0 flex items-start gap-2">
                {/* Media thumbnail preview */}
                {replyTo.image_path && (
                  <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0 bg-black/30">
                    <img 
                      src={normalizeMediaPath(replyTo.image_path)} 
                      alt="Photo" 
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                {replyTo.video_path && !replyTo.image_path && (
                  <div className="w-10 h-10 rounded bg-black/30 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-video text-white/60 text-sm" />
                  </div>
                )}
                {replyTo.audio_path && !replyTo.image_path && !replyTo.video_path && (
                  <div className="w-10 h-10 rounded bg-black/30 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-microphone text-white/60 text-sm" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-[#4db6ac] font-medium truncate">
                    {replyTo.sender === 'You' ? 'You' : (otherProfile?.display_name || username || 'User')}
                  </div>
                  <div className="mt-0.5 text-[13px] text-white/70 whitespace-pre-wrap break-words leading-[1.25]">
                    {replyTo.image_path ? (
                      <><i className="fa-solid fa-camera text-[11px] text-white/50 mr-1" />{(replyTo.text || 'Photo').slice(0, 80)}</>
                    ) : replyTo.video_path ? (
                      <><i className="fa-solid fa-video text-[11px] text-white/50 mr-1" />{(replyTo.text || 'Video').slice(0, 80)}</>
                    ) : replyTo.audio_path ? (
                      <><i className="fa-solid fa-microphone text-[11px] text-white/50 mr-1" />{replyTo.audio_summary ? replyTo.audio_summary.slice(0, 80) + (replyTo.audio_summary.length > 80 ? '…' : '') : 'Voice message'}</>
                    ) : (
                      replyTo.text.length > 80 ? replyTo.text.slice(0, 80) + '…' : replyTo.text
                    )}
                  </div>
                </div>
              </div>
              <button 
                className="px-3 flex items-center justify-center text-white/40 hover:text-white/70 transition-colors flex-shrink-0" 
                onClick={()=> setReplyTo(null)}
              >
                <i className="fa-solid fa-xmark text-sm" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-2 sm:gap-2.5">
            {/* Attachment button */}
            <NativeIconButton
              size="lg"
              haptic="selection"
              preventBlur
              onClick={(e) => {
                e.stopPropagation()
                setShowAttachMenu(!showAttachMenu)
              }}
            >
              <i className={`fa-solid text-white text-base sm:text-lg transition-transform duration-200 pointer-events-none ${
                showAttachMenu ? 'fa-xmark rotate-90' : 'fa-plus'
              }`} />
            </NativeIconButton>

          {/* Hidden file inputs */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className="hidden"
          />
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*"
            capture
            onChange={handleAudioFileChange}
            className="hidden"
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/x-m4v,video/x-msvideo"
            multiple
            onChange={handleVideoFileChange}
            className="hidden"
          />
          <input
            ref={documentInputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleDocumentChange}
            className="hidden"
          />

          {/* Recording indicator - rendered OUTSIDE the input container to avoid overflow:hidden clipping */}
          {MIC_ENABLED && recording && (
            <div className="flex items-center gap-1.5 flex-shrink-0 pr-2">
              <span 
                className="inline-block w-3 h-3 bg-red-500 rounded-full animate-pulse" 
                style={{ boxShadow: '0 0 8px 2px rgba(239, 68, 68, 0.6)' }}
              />
              <span className="text-red-400 text-xs font-semibold tracking-wide">REC</span>
            </div>
          )}

          {/* Message input container */}
          <div 
            className="flex-1 flex items-center rounded-lg bg-white/8 overflow-hidden relative"
            style={{
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            {/* Recording sound bar - replaces text input during recording */}
            {MIC_ENABLED && recording && (
              <div className="flex-1 flex items-center px-3 py-2 gap-2">
                {/* Level bar */}
                <div className="flex-1 h-2 bg-white/10 rounded overflow-hidden">
                  <div className="h-full bg-[#7fe7df] transition-all" style={{ width: `${Math.max(6, Math.min(96, (level||0)*100))}%` }} />
                </div>
                
                {/* Duration display */}
                <div className="text-sm font-mono text-white tabular-nums flex-shrink-0 min-w-[45px] text-right">
                  {formatRecordingTime(recordMs || 0)}
                </div>
              </div>
            )}
            
            {/* Inline voice preview - WhatsApp style (replaces text input when preview exists) */}
            {MIC_ENABLED && !recording && recordingPreview && (
              <div className="flex-1 flex items-center px-2 py-1.5 gap-2">
                {/* Delete button */}
                <NativeIconButton
                  size="sm"
                  haptic="light"
                  preventBlur
                  variant="muted"
                  className="!rounded-full text-red-400 hover:bg-red-500/20"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    cancelRecordingPreview()
                    setPreviewPlaying(false)
                  }}
                  aria-label={t('chat.delete_recording')}
                >
                  <i className="fa-solid fa-trash text-sm pointer-events-none" />
                </NativeIconButton>
                
                {/* Play/Pause button */}
                <NativeIconButton
                  size="sm"
                  haptic="selection"
                  preventBlur
                  className="!h-9 !w-9 !rounded-full bg-[#4db6ac] text-white hover:bg-[#45a99c]"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    togglePreviewPlayback()
                  }}
                  aria-label={previewPlaying ? t('chat.pause') : t('chat.play')}
                >
                  <i className={`fa-solid ${previewPlaying ? 'fa-pause' : 'fa-play'} text-sm pointer-events-none ${!previewPlaying ? 'ml-0.5' : ''}`} />
                </NativeIconButton>
                
                {/* Waveform placeholder / duration */}
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
                    <div className="h-full bg-[#4db6ac] w-full" />
                  </div>
                  <span className="text-xs text-white/70 tabular-nums flex-shrink-0">
                    {formatRecordingTime(((recordingPreview as any).duration || 0) * 1000)}
                  </span>
                </div>
                {/* Audio element is created programmatically in togglePreviewPlayback for iOS compatibility */}
              </div>
            )}
            
            {/* Regular text input - UNCONTROLLED for reliable cursor positioning */}
            {!(MIC_ENABLED && (recording || recordingPreview)) && (
              <textarea
                ref={textareaRef}
                rows={1}
                className="flex-1 bg-transparent px-3 sm:px-3.5 py-2 text-[15px] text-white placeholder-white/50 outline-none resize-none max-h-40 min-h-[38px]"
                placeholder={t('chat.message_placeholder')}
                defaultValue=""
                autoComplete="off"
                autoCorrect="on"
                autoCapitalize="sentences"
                spellCheck="true"
                tabIndex={0}
                inputMode="text"
                enterKeyHint="send"
                style={{ 
                  touchAction: 'manipulation',
                  WebkitUserSelect: 'text',
                  userSelect: 'text',
                  pointerEvents: 'auto'
                } as CSSProperties}
                onPaste={handlePaste}
                onFocus={() => {
                  noteComposerFocus()
                }}
                onInput={(e) => {
                  const textarea = e.target as HTMLTextAreaElement
                  const val = textarea.value
                  draftRef.current = val
                  setDraftDisplay(val)
                  adjustTextareaHeight()

                  // Auto-save draft with 300ms debounce (minimal impact on performance)
                  if (draftSaveTimeoutRef.current) {
                    clearTimeout(draftSaveTimeoutRef.current)
                  }
                  draftSaveTimeoutRef.current = setTimeout(() => {
                    const current = textareaRef.current?.value
                    if (current && current.trim() && username) {
                      const dk = viewer ? `chat-draft:dm:${viewer}:${username}` : `chat-draft:dm:${username}`
                      writeDeviceCache(dk, current)
                    }
                  }, 300)

                  // Only send typing indicator once, not on every keystroke
                  if (!isTypingRef.current) {
                    isTypingRef.current = true
                    fetch('/api/typing', {
                      method:'POST',
                      credentials:'include',
                      headers:{ 'Content-Type':'application/json' },
                      body: JSON.stringify({ peer: username, is_typing: true })
                    }).catch(()=>{})
                  }

                  // Reset the stop-typing timer on each keystroke
                  if (typingTimer.current) clearTimeout(typingTimer.current)
                  typingTimer.current = setTimeout(() => {
                    isTypingRef.current = false
                    fetch('/api/typing', {
                      method:'POST',
                      credentials:'include',
                      headers:{ 'Content-Type':'application/json' },
                      body: JSON.stringify({ peer: username, is_typing: false })
                    }).catch(()=>{})
                  }, 1200)
                }}
                onKeyDown={(e) => {
                  // Send on Enter (without Shift for new line) - web only
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
              />
            )}
          </div>

          {/* Mic button - shown when not recording, no preview, and no text */}
          {MIC_ENABLED && !recording && !recordingPreview && !draftDisplay.trim() && (
            <NativeIconButton
              size="lg"
              haptic="light"
              preventBlur
              className="text-white/80"
              onClick={(e) => {
                if (justSentRef.current) return
                e.preventDefault()
                e.stopPropagation()
                void checkMicrophonePermission()
              }}
              aria-label={t('chat.start_voice')}
            >
              <i className="fa-solid fa-microphone text-base pointer-events-none" />
            </NativeIconButton>
          )}

          {/* Recording controls - WhatsApp style: Pause + Send */}
          {MIC_ENABLED && recording && (
            <>
              {/* Pause button - stops recording, goes to preview */}
              <NativeIconButton
                size="lg"
                haptic="light"
                preventBlur
                variant="muted"
                className="!bg-white/15 hover:!bg-white/25"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  void stopVoiceRecording()
                }}
                aria-label={t('chat.pause_recording')}
              >
                <i className="fa-solid fa-pause text-base pointer-events-none" />
              </NativeIconButton>
              
              {/* Send button - sends directly */}
              <NativeIconButton
                size="lg"
                haptic="medium"
                preventBlur
                className="!bg-[#4db6ac] text-white hover:!bg-[#45a99c]"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  void sendVoiceDirectly()
                }}
                aria-label={t('chat.send_voice')}
              >
                <i className="fa-solid fa-paper-plane text-base pointer-events-none" />
              </NativeIconButton>
            </>
          )}
          
          {/* Preview controls - Send button */}
          {MIC_ENABLED && !recording && recordingPreview && (
            <>
              <NativeIconButton
                size="lg"
                haptic="medium"
                preventBlur
                className="!bg-[#4db6ac] text-white hover:!bg-[#45a99c]"
                onClick={(e) => {
                  if (sending) return
                  e.preventDefault()
                  e.stopPropagation()
                  void sendRecordingPreview()
                }}
                disabled={sending}
                aria-label={t('chat.send_voice')}
              >
              {sending ? (
                <i className="fa-solid fa-spinner fa-spin text-base pointer-events-none" />
              ) : (
                <i className="fa-solid fa-paper-plane text-base pointer-events-none" />
              )}
            </NativeIconButton>
            </>
          )}
          
          {/* Normal send button - shown when not recording and no preview */}
          {!(MIC_ENABLED && (recording || recordingPreview)) && (
            <button
              className={`w-10 h-10 flex-shrink-0 rounded-[14px] flex items-center justify-center ${
                sending 
                  ? 'bg-gray-600 text-gray-300' 
                  : draftDisplay.trim()
                    ? 'bg-[#4db6ac] text-black'
                    : 'bg-white/12 text-white/70'
              } active:scale-95`}
              onPointerDown={(e) => {
                if (!draftDisplay.trim() || sending) return
                e.preventDefault()
                e.stopPropagation()
                send()
              }}
              onClick={(e) => {
                // Fallback for devices where onPointerDown doesn't fire reliably
                if (!draftDisplay.trim() || sending) return
                e.preventDefault()
                e.stopPropagation()
                send()
              }}
              disabled={sending || !draftDisplay.trim()}
              aria-label={t('chat.send')}
              style={{
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {sending ? (
                <i className="fa-solid fa-spinner fa-spin text-base pointer-events-none" />
              ) : (
                <i className="fa-solid fa-paper-plane text-base pointer-events-none" />
              )}
            </button>
          )}
        </div>
      </ChatComposerCard>
      {/* Safe area spacer — hidden when keyboard is open to avoid double spacing */}
      <div 
        className="chat-composer-spacer-smooth"
        style={{
          height: (keyboardLift > 0 || androidKeyboardOpen) ? '0px' : `${safeBottomPx}px`,
          background: '#000',
          flexShrink: 0,
        }}
      />
    </ChatComposerPortal>

      {/* Permission guide modal */}
      {showPermissionGuide && (
        <div className="fixed inset-0 bg-black/90 z-[9999] flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] rounded-2xl border border-white/20 p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-red-600/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <i className="fa-solid fa-microphone-slash text-red-400 text-2xl" />
              </div>
              <h3 className="text-white text-lg font-medium mb-2">{t('chat.microphone_access_needed')}</h3>
              <p className="text-white/70 text-sm">
                To enable voice messages, please allow microphone access in your browser settings.
              </p>
            </div>

            {/* Instructions based on device/browser */}
            <div className="space-y-4 mb-6">
              {/* Safari on iPhone */}
              <div className="bg-gray-800/50 rounded-lg p-4">
                <h4 className="text-white font-medium mb-3 flex items-center gap-2">
                  <i className="fa-brands fa-safari text-blue-400" />
                  Safari (iPhone/iPad)
                </h4>
                <ol className="text-sm text-white/80 space-y-2 list-decimal list-inside">
                  <li>Tap the <strong>AA</strong> icon in the address bar</li>
                  <li>Select <strong>"Website Settings"</strong></li>
                  <li>Tap <strong>"Microphone"</strong></li>
                  <li>Choose <strong>"Allow"</strong></li>
                  <li>Refresh this page and try again</li>
                </ol>
              </div>

              {/* Chrome on mobile */}
              <div className="bg-gray-800/50 rounded-lg p-4">
                <h4 className="text-white font-medium mb-3 flex items-center gap-2">
                  <i className="fa-brands fa-chrome text-blue-400" />
                  Chrome (Mobile)
                </h4>
                <ol className="text-sm text-white/80 space-y-2 list-decimal list-inside">
                  <li>Tap the <strong>lock icon</strong> or <strong>three dots</strong> in the address bar</li>
                  <li>Tap <strong>"Site settings"</strong> or <strong>"Permissions"</strong></li>
                  <li>Find <strong>"Microphone"</strong></li>
                  <li>Change to <strong>"Allow"</strong></li>
                  <li>Refresh this page and try again</li>
                </ol>
              </div>

              {/* General mobile */}
              <div className="bg-gray-800/50 rounded-lg p-4">
                <h4 className="text-white font-medium mb-3 flex items-center gap-2">
                  <i className="fa-solid fa-mobile-alt text-green-400" />
                  Other Mobile Browsers
                </h4>
                <ol className="text-sm text-white/80 space-y-2 list-decimal list-inside">
                  <li>Look for a <strong>microphone icon</strong> or <strong>lock icon</strong> in the address bar</li>
                  <li>Tap it and select <strong>"Allow microphone"</strong></li>
                  <li>Or go to browser <strong>Settings → Site Permissions → Microphone</strong></li>
                  <li>Refresh this page and try again</li>
                </ol>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowPermissionGuide(false)}
                className="flex-1 px-4 py-3 bg-gray-700/50 text-gray-300 border border-gray-600/50 rounded-xl hover:bg-gray-700/70 transition-colors font-medium"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setShowPermissionGuide(false)
                  // Try again after user has potentially changed settings
                  setTimeout(() => checkMicrophonePermission(), 500)
                }}
                className="flex-1 px-4 py-3 bg-[#4db6ac] text-black rounded-xl hover:bg-[#45a99c] transition-colors font-medium"
              >
                <i className="fa-solid fa-refresh mr-2" />
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Microphone permission modal */}
      {showMicPermissionModal && (
        <div className="fixed inset-0 bg-black/90 z-[9999] flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] rounded-2xl border border-white/20 p-6 max-w-sm w-full mx-4">
            {/* Header */}
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-[#4db6ac]/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <i className="fa-solid fa-microphone text-[#4db6ac] text-2xl" />
              </div>
              <h3 className="text-white text-lg font-medium mb-2">{t('chat.microphone_access')}</h3>
              <p className="text-white/70 text-sm leading-relaxed">
                To send voice messages, we need access to your microphone. 
                {isMobile ? ' Your browser will ask for permission.' : ' Click "Allow" when your browser asks for permission.'}
              </p>
            </div>

            {/* Features list */}
            <div className="mb-6 space-y-2">
              <div className="flex items-center gap-3 text-sm text-white/80">
                <i className="fa-solid fa-check text-[#4db6ac] text-xs" />
                <span>{t('chat.mic_record_voice')}</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-white/80">
                <i className="fa-solid fa-check text-[#4db6ac] text-xs" />
                <span>{t('chat.mic_preview_before_send')}</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-white/80">
                <i className="fa-solid fa-check text-[#4db6ac] text-xs" />
                <span>{t('chat.mic_audio_private')}</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowMicPermissionModal(false)}
                className="flex-1 px-4 py-3 bg-gray-700/50 text-gray-300 border border-gray-600/50 rounded-xl hover:bg-gray-700/70 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={requestMicrophoneAccess}
                className="flex-1 px-4 py-3 bg-[#4db6ac] text-black rounded-xl hover:bg-[#45a99c] transition-colors font-medium"
              >
                <i className="fa-solid fa-microphone mr-2" />
                Allow Access
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Voice message preview is now inline in the composer - no modal needed */}

      {/* Translate language picker modal */}
      {dmLangPickerId !== null && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={() => setDmLangPickerId(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative bg-[#1a1a2e] rounded-2xl border border-white/15 w-[80%] max-w-xs p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <i className="fa-solid fa-globe text-[#4db6ac]" />
              <span className="text-white font-semibold text-sm">{t('chat.translate_to')}</span>
            </div>
            <div className="space-y-1">
              {dmTranslateLanguages.map(lang => (
                <button
                  key={lang.code}
                  onClick={async () => {
                    const msgId = dmLangPickerId!
                    const summary = dmLangPickerSummary
                    setDmLangPickerId(null)
                    setDmTranslatingId(msgId)
                    try {
                      const result = await requestTranslateSummary({
                        summary,
                        targetLanguage: lang.code,
                        context: 'voice_summary',
                      })
                      if (result.ok) {
                        setDmTranslations(prev => ({ ...prev, [msgId]: result.translated }))
                      } else if (result.entitlementsError) {
                        entitlementsHandler.showError(result.entitlementsError)
                      }
                    } catch {}
                    setDmTranslatingId(null)
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-white hover:bg-white/10 rounded-lg flex items-center gap-3"
                >
                  <span className="text-lg">{lang.flag}</span>
                  <span>{lang.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Steve Reminder Vault */}
      {reminderVaultOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          onClick={() => {
            setReminderVaultOpen(false)
            setEditingVaultId(null)
          }}
        >
          <div className="absolute inset-0 bg-black/70" />
          <div
            className="relative bg-[#1a1a2e] rounded-2xl border border-white/15 w-full max-w-lg max-h-[min(560px,80vh)] shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0">
              <span className="text-white font-semibold text-sm flex items-center gap-2">
                <i className="fa-solid fa-clock text-[#4db6ac]" aria-hidden /> Reminder Vault
              </span>
              <button
                type="button"
                className="p-2 rounded-full hover:bg-white/10 text-white/70"
                aria-label={t('common.close')}
                onClick={() => {
                  setReminderVaultOpen(false)
                  setEditingVaultId(null)
                }}
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 text-sm min-h-0">
              {reminderVaultLoading && <div className="text-white/60 text-center py-6">Loading…</div>}
              {reminderVaultError && (
                <div className="text-amber-300/90 text-center py-3">{reminderVaultError}</div>
              )}
              {!reminderVaultLoading && !reminderVaultError && !reminderRows.length && (
                <div className="text-white/60 text-center py-6">
                  No scheduled reminders yet. Tell Steve something like: “Steve, remind me to call Alex Tuesday at 3pm”.
                </div>
              )}
              <ul className="space-y-3">
                {reminderRows.map((row) => (
                  <li key={row.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    {editingVaultId === row.id ? (
                      <div className="space-y-2">
                        <label className="block text-[11px] uppercase tracking-wide text-white/45">{t('chat.reminder_description')}</label>
                        <textarea
                          value={editVaultText}
                          onChange={(e) => setEditVaultText(e.target.value)}
                          rows={3}
                          className="w-full bg-white/10 border border-white/20 rounded-lg px-2 py-2 text-white text-sm resize-none focus:outline-none focus:border-[#4db6ac]"
                        />
                        <label className="block text-[11px] uppercase tracking-wide text-white/45 mt-2">{t('chat.reminder_when')}</label>
                        <input
                          type="datetime-local"
                          value={editVaultIso}
                          onChange={(e) => setEditVaultIso(e.target.value)}
                          className="w-full bg-white/10 border border-white/20 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-[#4db6ac]"
                        />
                        <div className="flex gap-2 justify-end pt-1">
                          <button
                            type="button"
                            className="px-3 py-1.5 text-xs rounded-lg bg-white/10 text-white/80 hover:bg-white/15"
                            onClick={() => setEditingVaultId(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="px-3 py-1.5 text-xs rounded-lg bg-[#4db6ac] text-black font-medium hover:brightness-110"
                            onClick={async () => {
                              try {
                                const fireIso = editVaultIso
                                  ? new Date(editVaultIso).toISOString()
                                  : undefined
                                const res = await fetch(`/api/me/steve/reminders/${row.id}`, {
                                  method: 'PATCH',
                                  credentials: 'include',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    reminder_text: editVaultText,
                                    ...(fireIso ? { fire_at_utc: fireIso } : {}),
                                  }),
                                })
                                const data = await res.json()
                                if (!res.ok || !data.success) {
                                  alert(typeof data.message === 'string' ? data.message : t('chat.reminder_could_not_save'))
                                  return
                                }
                                setEditingVaultId(null)
                                void loadReminderVault()
                              } catch {
                                alert(t('chat.reminder_could_not_save'))
                              }
                            }}
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-white/90 whitespace-pre-wrap flex-1 min-w-0">{row.reminder_text}</div>
                          <button
                            type="button"
                            className="flex-shrink-0 p-2 rounded-lg text-white/40 hover:text-rose-300 hover:bg-white/10 disabled:opacity-40"
                            title="Remove reminder"
                            aria-label={t('chat.reminder_delete_aria', { id: row.id })}
                            disabled={vaultDeletingId === row.id}
                            onClick={async () => {
                              if (!window.confirm(t('chat.reminder_remove_confirm'))) return
                              setVaultDeletingId(row.id)
                              try {
                                const res = await fetch(`/api/me/steve/reminders/${row.id}`, {
                                  method: 'DELETE',
                                  credentials: 'include',
                                  headers: { Accept: 'application/json' },
                                })
                                const data = await res.json().catch(() => ({}))
                                if (!res.ok || !data.success) {
                                  alert(typeof data.message === 'string' ? data.message : t('chat.reminder_could_not_remove'))
                                  return
                                }
                                void loadReminderVault()
                              } catch {
                                alert(t('chat.reminder_could_not_remove'))
                              } finally {
                                setVaultDeletingId(null)
                              }
                            }}
                          >
                            <i className="fa-solid fa-trash" aria-hidden />
                          </button>
                        </div>
                        <div className="text-xs text-white/45 mt-1">
                          #{row.id} · {row.fire_at_utc} UTC · tz {row.tz_label}
                        </div>
                        <button
                          type="button"
                          className="mt-2 text-xs text-[#4db6ac] hover:underline"
                          onClick={() => {
                            setEditingVaultId(row.id)
                            setEditVaultText(row.reminder_text)
                            const raw = row.fire_at_utc
                            const norm = raw.includes('T')
                              ? raw
                              : raw.replace(' ', 'T')
                            const iso = norm.endsWith('Z') || norm.includes('+') ? norm : `${norm}Z`
                            const d = new Date(iso)
                            const pad = (n: number) => String(n).padStart(2, '0')
                            const local =
                              Number.isNaN(d.getTime())
                                ? ''
                                : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
                            setEditVaultIso(local)
                          }}
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Edit Steve summary modal */}
      {editingSummaryId !== null && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={() => { setEditingSummaryId(null); setEditSummaryText('') }}>
          <div className="absolute inset-0 bg-black/70" />
          <div 
            className="relative bg-[#1a1a2e] rounded-2xl border border-white/15 w-[90%] max-w-md p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <i className="fa-solid fa-wand-magic-sparkles text-[#4db6ac]" />
              <span className="text-white font-semibold text-sm">{t('chat.edit_summary')}</span>
            </div>
            <textarea
              value={editSummaryText}
              onChange={(e) => setEditSummaryText(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-3 text-sm text-white resize-none focus:outline-none focus:border-[#4db6ac] leading-relaxed"
              rows={4}
              autoFocus
              placeholder={t('chat.edit_summary_placeholder')}
            />
            <div className="flex gap-2 mt-3 justify-end">
              <button
                onClick={() => { setEditingSummaryId(null); setEditSummaryText('') }}
                className="px-4 py-2 text-sm rounded-lg bg-white/10 text-white/70 hover:bg-white/15"
              >{t('chat.cancel')}</button>
              <button
                onClick={async () => {
                  const newSummary = editSummaryText.trim()
                  if (!newSummary || !editingSummaryId) return
                  const msgId = editingSummaryId
                  const matchMsg = (m: any) => String(m.id) === String(msgId) || String(m.clientKey) === String(msgId)
                  const oldSummary = messages.find(matchMsg)?.audio_summary || ''
                  setMessages(prev => prev.map(m => matchMsg(m) ? { ...m, audio_summary: newSummary } : m))
                  setEditingSummaryId(null)
                  setEditSummaryText('')
                  try {
                    const res = await fetch('/api/chat/update_audio_summary', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({ message_id: Number(msgId), summary: newSummary }),
                    })
                    const data = await res.json()
                    if (!data.success) {
                      setMessages(prev => prev.map(m => matchMsg(m) ? { ...m, audio_summary: oldSummary } : m))
                    }
                  } catch {
                    setMessages(prev => prev.map(m => matchMsg(m) ? { ...m, audio_summary: oldSummary } : m))
                  }
                }}
                className="px-4 py-2 text-sm rounded-lg bg-[#4db6ac] text-black font-medium hover:brightness-110"
              >{t('chat.save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Photo preview modal */}
      {previewImage && (
        <div 
          className="fixed inset-0 bg-black z-[9999] flex flex-col"
          onClick={() => setPreviewImage(null)}
        >
          {/* Header with back button */}
          <div className="h-14 flex items-center px-4 flex-shrink-0">
            <button 
              className="p-2 rounded-full hover:bg-white/10 transition-colors"
              onClick={() => setPreviewImage(null)}
                aria-label={t('chat.back_to_chat')}
            >
              <i className="fa-solid fa-arrow-left text-white text-lg" />
            </button>
            <div className="flex-1 text-center">
              <div className="text-white font-medium">{t('chat.photo')}</div>
            </div>
            <div className="w-10"></div> {/* Spacer for centering */}
          </div>

          {/* Image container with zoom */}
          <div 
            className="flex-1 flex items-center justify-center p-2 md:p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full h-full" style={{ maxHeight: 'calc(100vh - 8rem)', touchAction: 'none' }}>
              <ZoomableImage
                src={previewImage}
                alt="Photo preview"
                className="w-full h-full"
                onRequestClose={() => setPreviewImage(null)}
              />
            </div>
          </div>

          {/* Bottom action buttons */}
          <div className="flex-shrink-0 px-4 pb-4 pt-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 16px) + 16px)' }}>
            {pastedImage ? (
              /* Pasted image actions - Send/Discard */
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => {
                    // CRITICAL iOS FIX: Revoke blob URL before clearing
                    if (previewImage && previewImage.startsWith('blob:')) {
                      try {
                        URL.revokeObjectURL(previewImage)
                      } catch {}
                    }
                    setPreviewImage(null)
                    setPastedImage(null)
                  }}
                  className="flex-1 max-w-[140px] px-4 py-3 rounded-xl border border-white/20 text-white hover:bg-white/5 text-sm font-medium flex items-center justify-center gap-2"
                >
                  <i className="fa-regular fa-trash-can" />
                  Discard
                </button>
                <button
                  onClick={() => {
                    if (pastedImage) {
                      handleImageFile(pastedImage)
                      setPreviewImage(null)
                    }
                  }}
                  className="flex-1 max-w-[140px] px-4 py-3 rounded-xl bg-[#4db6ac] text-black hover:brightness-110 text-sm font-medium flex items-center justify-center gap-2"
                >
                  <i className="fa-solid fa-paper-plane" />
                  Send
                </button>
              </div>
            ) : (
              /* Regular photo view - just back button */
              <div className="flex items-center justify-center">
                <button 
                  className="px-4 py-2 border border-white/30 text-white rounded-lg hover:border-white/50 hover:bg-white/5 transition-colors text-sm flex items-center gap-2"
                  onClick={() => setPreviewImage(null)}
                >
                  <i className="fa-solid fa-arrow-left text-sm" />
                  Back to Chat
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <GifPicker
        isOpen={gifPickerOpen}
        onClose={()=> setGifPickerOpen(false)}
        onSelect={async (gif) => {
          setGifPickerOpen(false)
          await handleGifSelection(gif)
        }}
      />

      {/* Block User Modal */}
      {showBlockModal && (
        <div 
          className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur flex items-center justify-center p-4"
          onClick={(e) => e.currentTarget === e.target && !blockSubmitting && setShowBlockModal(false)}
        >
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0b0f10] p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <i className="fa-solid fa-ban text-red-400" />
              </div>
              <div className="font-semibold text-lg text-white">Block @{username}</div>
            </div>
            <p className="text-sm text-[#9fb0b5] mb-4">
              Blocking this user will:
            </p>
            <ul className="text-sm text-[#9fb0b5] mb-4 space-y-1 pl-4">
              <li>• Hide all their posts from your feed</li>
              <li>• Prevent messaging between you</li>
              <li>• Notify our moderation team</li>
              <li>• You can manage this in Settings → Privacy</li>
            </ul>
            
            <div className="mb-4">
              <label className="block text-sm text-[#9fb0b5] mb-2">Reason for blocking (optional)</label>
              <select
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-red-500/50"
                disabled={blockSubmitting}
              >
                <option value="">Select a reason...</option>
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
                Cancel
              </button>
              <button
                className="flex-1 py-2.5 rounded-lg bg-red-500 text-white font-medium hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => handleBlockUser()}
                disabled={blockSubmitting}
              >
                {blockSubmitting ? 'Blocking...' : 'Block User'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ChatMediaViewerModal
        viewer={viewingMedia}
        onClose={() => setViewingMedia(null)}
        onIndexChange={index => setViewingMedia(prev => (prev ? { ...prev, index } : null))}
      />

      <ChatMediaPreviewModal
        items={pendingMedia}
        previewIndex={previewIndex}
        onPreviewIndexChange={setPreviewIndex}
        onCancel={cancelMediaPreview}
        onRemove={removeMediaFromPreview}
        onSend={confirmSendMedia}
      />
    </>
  )
}

// AudioMessage and LongPressActionable are now imported from ../chat via MessageBubble