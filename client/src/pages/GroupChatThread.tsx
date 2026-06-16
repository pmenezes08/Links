import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import SteveTypingIndicator from '../components/chat/SteveTypingIndicator'
import Avatar from '../components/Avatar'
import GifPicker from '../components/GifPicker'
import type { GifSelection } from '../components/GifPicker'
import { gifSelectionToFile } from '../utils/gif'
import { useAudioRecorder } from '../components/useAudioRecorder'
import { GroupMessageRow } from '../chat/GroupMessageRow'
import { getDateKey, normalizeMediaPath, useChatThreadChrome, chatHapticSend, ChatAttachMenuRow, useGroupMessagePoll, ChatMediaPreviewModal, ChatMediaViewerModal, ChatSelectionBar, NewMessagesChip, useResumeOutboxDrain, ChatComposerPortal, ChatComposerCard, ChatVirtualMessageList, CHAT_CACHE_TTL_MS, CHAT_CACHE_VERSION, readStaleDeviceCache, markThreadCachePainted, isCachePaintedForGen, isUnchangedFromCacheSnapshot, hydrateThreadFromIndexedDb, stripReplyMarker } from '../chat'
import { groupChatInfoDeviceCacheKey, groupChatMessagesDeviceCacheKey } from '../utils/chatThreadsCache'
import { useAndroidBackButton } from '../hooks/useAndroidBackButton'
import { getStoredMediaQuality, setStoredMediaQuality, type MediaQuality } from '../chat/upload'
import { hapticImpactLight } from '../utils/haptics'
import { NativeIconButton } from '../components/NativeIconButton'
import {
  mergePolledGroupMessages,
  GROUP_SEND_CONFIRM_TIMEOUT_MS,
} from '../utils/groupPollMergeMessages'
import { useUserProfile } from '../contexts/UserProfileContext'
import { useEntitlementsHandler } from '../contexts/EntitlementsContext'
import { useEntitlements } from '../hooks/useEntitlements'
import { isEntitlementsError } from '../utils/entitlementsError'
import {
  buildClientPremiumRequiredError,
  shouldClientBlockSteveIntent,
} from '../utils/steveClientGate'
import { sendGroupImageMessage, sendGroupMultiMedia } from '../chat/groupChatMediaSenders'
import { comparableMediaUrl, consumeDeletedMedia, mediaDeleteScopeForGroup, type DeletedMediaItem } from '../chat/mediaDeletionEvents'
import ChatThreadSearch from '../chat/ChatThreadSearch'
import type { UploadProgress } from '../chat/groupChatMediaSenders'
import { sendGroupDocumentMessage } from '../chat/mediaSenders'
import { renderTextWithSourceLinks } from '../utils/linkUtils'
import { openExternalNativeLink } from '../utils/openExternalInApp'
import { readDeviceCache, writeDeviceCache, clearDeviceCache } from '../utils/deviceCache'
import { requestTranslateSummary } from '../utils/translateSummary'
import { cacheMessages, getCachedMessages, cacheKeyVal, getCachedKeyVal, addToOutbox, removeFromOutbox, updateOutboxStatus, getOutboxEntries } from '../utils/offlineDb'
import {
  takePendingShareFilesOnce,
  takePendingShareUrlsOnce,
  releaseShareHandoffKey,
  releaseShareUrlHandoffKey,
} from '../services/shareImportStore'
import { handleBasicProfileRequired } from '../utils/basicProfileGate'
import { isNativeMediaPlatform, pickFromLibraryNative, capturePhotoNative } from '../utils/nativeMediaPicker'

type Message = {
  id: number
  sender: string
  text: string | null
  image: string | null
  voice: string | null
  video?: string | null
  media_paths?: string[] | null  // For grouped media
  client_key?: string | null
  audio_duration_seconds?: number
  audio_summary?: string | null
  created_at: string
  profile_picture: string | null
  replySnippet?: string
  replySender?: string
  is_edited?: boolean
  reaction?: string | null
}

function removeDeletedMediaFromGroupMessages(messages: Message[], deletedItems: DeletedMediaItem[]): Message[] {
  if (!deletedItems.length) return messages
  const deletedByMessage = new Map<number, Set<string>>()
  for (const item of deletedItems) {
    const set = deletedByMessage.get(item.message_id) || new Set<string>()
    set.add(comparableMediaUrl(item.media_url))
    deletedByMessage.set(item.message_id, set)
  }
  return messages
    .map(message => {
      const deleted = deletedByMessage.get(Number(message.id))
      if (!deleted) return message
      const keep = (url?: string | null) => !!url && !deleted.has(comparableMediaUrl(url))
      const mediaPaths = (message.media_paths || []).filter(keep)
      return {
        ...message,
        media_paths: mediaPaths.length ? mediaPaths : null,
        image: keep(message.image) ? message.image : null,
        video: keep(message.video) ? message.video : null,
      }
    })
    .filter(message => {
      const hasBody = !!(message.text || '').trim()
      const hasMedia = !!message.image || !!message.video || !!message.voice || !!message.media_paths?.length
      return hasBody || hasMedia
    })
}

type Member = {
  username: string
  is_admin: boolean
  joined_at: string
  profile_picture: string | null
}

type GroupInfo = {
  id: number
  name: string
  creator: string
  created_at: string
  is_admin: boolean
  members: Member[]
  community_id?: number
  community_name?: string
}

function formatGroupThreadTime(dateStr: string) {
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    if (diffDays === 1) {
      return 'Yesterday'
    }
    if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' })
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export default function GroupChatThread() {
  const { group_id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const mentionToProfile = useCallback((username: string) => {
    navigate(`/profile/${encodeURIComponent(username)}`)
  }, [navigate])
  const openExternalArticle = useCallback((url: string) => {
    void openExternalNativeLink(url)
  }, [])
  const [searchParams, setSearchParams] = useSearchParams()
  const { profile: currentUserProfile } = useUserProfile()
  // Get username from profile context, with localStorage fallback
  const currentUsername = (currentUserProfile as { username?: string })?.username
    || localStorage.getItem('current_username')
    || ''
  const groupChatCacheKey = useMemo(
    () => (group_id && currentUsername ? groupChatMessagesDeviceCacheKey(currentUsername, group_id) : null),
    [group_id, currentUsername],
  )
  const groupInfoCacheKey = useMemo(
    () => (group_id && currentUsername ? groupChatInfoDeviceCacheKey(currentUsername, group_id) : null),
    [group_id, currentUsername],
  )
  const entitlementsHandler = useEntitlementsHandler()
  const { entitlements, enforcement_enabled, loading: entitlementsLoading } = useEntitlements()
  const tryBlockSteveIntentSend = useCallback(
    (text: string) => {
      if (
        !shouldClientBlockSteveIntent({
          enforcement_enabled,
          loading: entitlementsLoading,
          entitlements,
          isSteveDm: false,
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
  // Seed group + messages synchronously from device cache so the chat shell
  // (header + bubbles + reactions) paints on the first frame, matching DM
  // parity. No more loading-screen swap on open. The async IndexedDB +
  // network paths still reconcile in the background.
  const [group, setGroup] = useState<GroupInfo | null>(() => {
    if (typeof window === 'undefined') return null
    if (!group_id || !currentUsername) return null
    const data = readStaleDeviceCache<GroupInfo>(
      groupChatInfoDeviceCacheKey(currentUsername, group_id),
    )
    return data
  })
  const [serverMessages, setServerMessages] = useState<Message[]>(() => {
    if (typeof window === 'undefined') return []
    if (!group_id || !currentUsername) return []
    const cached = readStaleDeviceCache<Message[]>(
      groupChatMessagesDeviceCacheKey(currentUsername, group_id),
    )
    return cached?.length ? cached : []
  })
  useEffect(() => {
    if (!group_id) return
    const scope = mediaDeleteScopeForGroup(group_id)
    const apply = (items: DeletedMediaItem[]) => {
      if (items.length) setServerMessages(prev => removeDeletedMediaFromGroupMessages(prev, items))
    }
    apply(consumeDeletedMedia(scope))
    const onDeleted = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string; items?: DeletedMediaItem[] }>).detail
      if (detail?.scope === scope) apply(detail.items || [])
    }
    window.addEventListener('chat-media-deleted', onDeleted)
    return () => window.removeEventListener('chat-media-deleted', onDeleted)
  }, [group_id])
  // `loading` only gates the inline spinner inside the chat shell; we no
  // longer return a separate full-screen loading view.
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Server messages are already in chronological order from the API; just append optimistic at the end
  const messages = useMemo(() => {
    const confirmed = serverMessages.filter(m => !(m as any).isOptimistic)
    const optimistic = serverMessages.filter(m => (m as any).isOptimistic)
    return [...confirmed, ...optimistic]
  }, [serverMessages])
  // Use ref-based draft to avoid React state update issues
  const draftRef = useRef('')
  const [draftDisplay, setDraftDisplay] = useState('') // Only for UI updates (button visibility)
  const [sending, setSendingState] = useState(false)
  const sendingLockRef = useRef(false)
  const justSentRef = useRef(false)
  
  // Sync ref and state for reliable double-click prevention
  const setSending = useCallback((value: boolean) => {
    sendingLockRef.current = value
    setSendingState(value)
  }, [])
  const [showMembers, setShowMembers] = useState(false)
  const [showAddMembers, setShowAddMembers] = useState(false)
  const [availableMembers, setAvailableMembers] = useState<Array<{ username: string; display_name?: string; profile_picture?: string; community_name?: string }>>([])
  const [loadingAvailable, setLoadingAvailable] = useState(false)
  const [selectedNewMembers, setSelectedNewMembers] = useState<string[]>([])
  const [addingMembers, setAddingMembers] = useState(false)
  const [memberSearchQuery, setMemberSearchQuery] = useState('')
  const [expandedCommunities, setExpandedCommunities] = useState<Set<string>>(new Set())
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const [cancelActiveUpload, setCancelActiveUpload] = useState<(() => void) | null>(null)
  const [gifPickerOpen, setGifPickerOpen] = useState(false)
  // Multi-media preview state
  const [pendingMedia, setPendingMedia] = useState<Array<{ file: File; previewUrl: string; type: 'image' | 'video' | 'audio' }>>([])
  const [mediaQuality, setMediaQuality] = useState<MediaQuality>(() => getStoredMediaQuality())
  const [previewIndex, setPreviewIndex] = useState(0)
  const shareAttachDoneRef = useRef(false)

  useEffect(() => {
    shareAttachDoneRef.current = false
  }, [group_id])

  const [viewingMedia, setViewingMedia] = useState<{ urls: string[]; index: number; messageId?: number; senderUsername?: string } | null>(null) // For viewing sent media groups
  const videoInputRef = useRef<HTMLInputElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const [previewPlaying, setPreviewPlaying] = useState(false)
  // Paste from clipboard state
  const [pastedImage, setPastedImage] = useState<File | null>(null)
  const [pastedImagePreview, setPastedImagePreview] = useState<string | null>(null)
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const [showManageGroup, setShowManageGroup] = useState(false)
  const [renameText, setRenameText] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [stevePersonality, setStevePersonality] = useState('default')
  const [removingMember, setRemovingMember] = useState<string | null>(null)
  const [deletingMedia, setDeletingMedia] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [editingSaving, setEditingSaving] = useState(false)
  const [editingSummaryId, setEditingSummaryId] = useState<number | null>(null)
  const [editSummaryText, setEditSummaryText] = useState('')
  const [translations, setTranslations] = useState<Record<number, string>>({})
  const [translatingId, setTranslatingId] = useState<number | null>(null)
  const [showLangPicker, setShowLangPicker] = useState<number | null>(null)
  const [langPickerSummary, setLangPickerSummary] = useState('')
  const translateLanguages = [
    { code: 'pt', name: 'Portuguese (PT)', flag: '🇵🇹' },
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'fr', name: 'French', flag: '🇫🇷' },
    { code: 'de', name: 'German', flag: '🇩🇪' },
    { code: 'es', name: 'Spanish', flag: '🇪🇸' },
    { code: 'it', name: 'Italian', flag: '🇮🇹' },
  ]
  const handleTranslateSummary = async (msgId: number, summary: string, langCode: string) => {
    setShowLangPicker(null)
    setTranslatingId(msgId)
    try {
      const result = await requestTranslateSummary({
        summary,
        targetLanguage: langCode,
        context: 'voice_summary',
      })
      if (result.ok) {
        setTranslations(prev => ({ ...prev, [msgId]: result.translated }))
      } else if (result.entitlementsError) {
        entitlementsHandler.showError(result.entitlementsError)
      } else {
        console.error('Translation failed:', result.error || 'Unknown error')
      }
    } catch (err) {
      console.error('Translation request failed:', err)
    }
    setTranslatingId(null)
  }
  const pendingDeletions = useRef<Set<number>>(new Set())
  const [steveIsTyping, setSteveIsTyping] = useState(false)
  
  // Multi-select delete state
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedMessages, setSelectedMessages] = useState<Set<number>>(new Set())
  
  // Reply state
  const [replyTo, setReplyTo] = useState<{ text: string; sender: string; image?: string; video?: string; voice?: string; audio_summary?: string } | null>(null)
  
  // @mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStartPos, setMentionStartPos] = useState<number>(0)
  const mentionDropdownRef = useRef<HTMLDivElement>(null)
  
  // Filter group members for @mention autocomplete (excluding Steve and current user)
  const mentionableMembers = group?.members.filter(
    m => m.username.toLowerCase() !== 'steve' && m.username.toLowerCase() !== currentUsername.toLowerCase()
  ) || []
  
  // Filtered mentions based on query
  const filteredMentions = mentionQuery !== null
    ? mentionableMembers.filter(m => 
        m.username.toLowerCase().startsWith(mentionQuery.toLowerCase())
      )
    : []
    
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const loadOlderRef = useRef<(() => void) | null>(null)
  const composerRef = useRef<HTMLDivElement | null>(null)
  const draftSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useResumeOutboxDrain()

  useAndroidBackButton({
    textareaRef,
    onExitSelection: () => {
      if (!selectionMode) return false
      setSelectionMode(false)
      setSelectedMessages(new Set())
      return true
    },
    onNavigateBack: () => navigate(-1),
  })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const pollInFlightRef = useRef(false)
  const skipNextPollsUntil = useRef(0)
  const pollTickRef = useRef(0)
  const clientKeyServerIdRef = useRef<Map<string, number>>(new Map())
  const lastMessageIdRef = useRef<number>(0)
  const threadGenerationRef = useRef(0)
  const cachePaintedGenRef = useRef<number | null>(null)
  const cacheSnapshotRef = useRef<{ count: number; tailId: number | undefined } | null>(null)
  const activeGroupIdRef = useRef<string | undefined>(group_id)
  activeGroupIdRef.current = group_id
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const headerMenuRef = useRef<HTMLDivElement>(null)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const loadingOlderRef = useRef(false)

  // Voice recording
  const { 
    recording, 
    recordMs, 
    preview: recordingPreview, 
    start: startVoiceRecording, 
    stop: stopVoiceRecording, 
    clearPreview: cancelRecordingPreview, 
    level, 
    stopAndGetBlob 
  } = useAudioRecorder()

  // Check if mobile
  const isMobile = typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  const MIC_ENABLED = true

  const chrome = useChatThreadChrome({
    isMobile,
    textareaRef,
    composerRef,
    listRef,
    threadKey: group_id,
    messages,
    hasMoreMessages,
    loadingOlderRef,
    onLoadOlder: () => loadOlderRef.current?.(),
    surfaceKey: 'group',
  })

  const {
    messageStackRef,
    ensurePinnedToBottom,
    scrollToBottomSmooth,
    notifyMessagesSettled,
    scrollToMessage,
    showScrollDown,
    lastMessageRef,
    pendingNewCount,
    clearPendingNew,
    composerCardRef,
    displayKeyboardLift,
    safeBottomPx,
    isWeb,
    androidKeyboardOpen,
    listPaddingBottom,
    listScrollPaddingBottom,
    scrollButtonBottom,
    insetMotionIdle,
    keyboardChromeActive,
    handleContentPointerDown,
    handleContentPointerMove,
    handleContentPointerUp,
    handleContentPointerCancel,
    noteComposerFocus,
    handleListScroll,
  } = chrome

  const notifyMessagesSettledRef = useRef(notifyMessagesSettled)
  notifyMessagesSettledRef.current = notifyMessagesSettled

  const [searchOpen, setSearchOpen] = useState(false)
  const [viewingHistory, setViewingHistory] = useState(false)
  const viewingHistoryRef = useRef(false)

  const handleSearchJump = useCallback(async (messageId: number | string): Promise<boolean> => {
    if (scrollToMessage(messageId)) return true
    try {
      const res = await fetch(
        `/api/group_chat/${group_id}/messages_around?around_id=${messageId}`,
        { credentials: 'include' },
      )
      const data = await res.json()
      if (!data?.success || !Array.isArray(data.messages)) return false
      if (!data.target_found) return false
      const processed: Message[] = data.messages.map((m: any) => ({
        ...m,
        isOptimistic: false,
      }))
      setServerMessages(processed)
      setHasMoreMessages(data.has_more_before ?? false)
      viewingHistoryRef.current = true
      setViewingHistory(true)
      skipNextPollsUntil.current = Date.now() + 60_000
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)))
        if (scrollToMessage(messageId)) return true
      }
      return false
    } catch {
      return false
    }
  }, [scrollToMessage, group_id, setServerMessages, setHasMoreMessages, skipNextPollsUntil])

  // Format recording time
  const formatRecordingTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  // Close header menu when clicking outside
  useEffect(() => {
    if (!headerMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setHeaderMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [headerMenuOpen])

  // Run as useLayoutEffect so re-seeding from device cache happens before
  // the next paint when navigating between threads. Avoids a "null group +
  // empty list" flash between thread A and thread B.
  useLayoutEffect(() => {
    if (!group_id) return
    threadGenerationRef.current += 1
    pollTickRef.current = 0
    skipNextPollsUntil.current = 0
    clientKeyServerIdRef.current.clear()
    lastMessageIdRef.current = 0
    pendingDeletions.current.clear()

    const cachedGroup = readStaleDeviceCache<GroupInfo>(groupInfoCacheKey)
    const cachedMessages = readStaleDeviceCache<Message[]>(groupChatCacheKey)

    setGroup(cachedGroup ?? null)
    setServerMessages(cachedMessages?.length ? cachedMessages : [])
    setSteveIsTyping(false)
    setHasMoreMessages(false)
    setError(null)

    const gen = threadGenerationRef.current
    if (cachedMessages?.length) {
      markThreadCachePainted(cachePaintedGenRef, cacheSnapshotRef, gen, cachedMessages)
      const newMaxId = Math.max(...cachedMessages.map(m => m.id))
      if (newMaxId > 0) lastMessageIdRef.current = newMaxId
    } else {
      cachePaintedGenRef.current = null
      cacheSnapshotRef.current = null
    }
  }, [group_id, groupChatCacheKey, groupInfoCacheKey])

  const paintGroupCacheMessages = useCallback((cached: Message[], gen: number) => {
    setServerMessages(prev => {
      const optimistic = prev.filter(m => (m as Message & { isOptimistic?: boolean }).isOptimistic)
      const confirmed = cached
      if (optimistic.length === 0) return confirmed
      const confirmedIds = new Set(confirmed.map(m => m.id))
      const unconfirmed = optimistic.filter(m => !confirmedIds.has(m.id))
      return [...confirmed, ...unconfirmed]
    })
    markThreadCachePainted(cachePaintedGenRef, cacheSnapshotRef, gen, cached)
    notifyMessagesSettledRef.current(gen)
  }, [])

  // Async fallback: if device cache was empty above, try IndexedDB for
  // group info and messages. Device cache is already seeded synchronously
  // in the thread-switch useLayoutEffect, so this only fires on first
  // visit / cache miss.
  useEffect(() => {
    if (!group_id) return
    const gen = threadGenerationRef.current

    if (!group) {
      void getCachedKeyVal<GroupInfo>(`group-info:${group_id}`).then(cached => {
        if (gen !== threadGenerationRef.current) return
        if (cached) setGroup(prev => prev || cached)
      })
    }

    if (isCachePaintedForGen(cachePaintedGenRef, gen)) return

    const cachedMessages = readStaleDeviceCache<Message[]>(groupChatCacheKey)

    void hydrateThreadFromIndexedDb({
      gen,
      isGenerationCurrent: (g) => g === threadGenerationRef.current,
      fetchMessages: () => getCachedMessages(`group:${group_id}`),
      hasLocalStaleMessages: Boolean(cachedMessages?.length),
      onMessages: (cached) => {
        paintGroupCacheMessages(cached as Message[], gen)
      },
    })
  }, [group_id, group, groupChatCacheKey, paintGroupCacheMessages])

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
      const len = el.value.length
      try {
        el.setSelectionRange(len, len)
      } catch {
        // iOS can reject selection updates during focus transitions.
      }
    })
  }, [recording, noteComposerFocus])

  function adjustTextareaHeight(){
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const maxPx = 160
    ta.style.height = Math.min(ta.scrollHeight, maxPx) + 'px'
  }

  const loadGroup = useCallback(async () => {
    const gen = threadGenerationRef.current
    const fetchGroupId = group_id
    if (!navigator.onLine) {
      // Offline: load from IndexedDB
      const cached = await getCachedKeyVal<any>(`group-info:${group_id}`)
      if (gen !== threadGenerationRef.current || fetchGroupId !== activeGroupIdRef.current) return
      if (cached) setGroup(prev => prev || cached)
      return
    }
    try {
      const response = await fetch(`/api/group_chat/${group_id}`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
      const data = await response.json()
      if (gen !== threadGenerationRef.current || fetchGroupId !== activeGroupIdRef.current) return
      if (data.success) {
        setGroup(data.group)
        cacheKeyVal(`group-info:${group_id}`, data.group)
        // Mirror to device cache so the next open paints the header on the
        // first frame (matches the message-cache pattern above).
        if (groupInfoCacheKey) {
          writeDeviceCache(groupInfoCacheKey, data.group, CHAT_CACHE_TTL_MS, CHAT_CACHE_VERSION)
        }
      } else {
        setError(data.error || t('chat.failed_load_group'))
      }
    } catch (err) {
      console.error('Error loading group:', err)
      if (gen !== threadGenerationRef.current || fetchGroupId !== activeGroupIdRef.current) return
      const cached = await getCachedKeyVal<any>(`group-info:${group_id}`)
      if (cached) setGroup(prev => prev || cached)
      else setError(t('chat.failed_load_group'))
    }
  }, [group_id, groupInfoCacheKey, t])

  const loadMessages = useCallback(async (silent = false) => {
    const gen = threadGenerationRef.current
    const fetchGroupId = group_id
    if (!navigator.onLine) {
      if (!silent) {
        const cached = await getCachedMessages(`group:${group_id}`)
        if (gen !== threadGenerationRef.current || fetchGroupId !== activeGroupIdRef.current) return
        if (cached?.length) {
          setServerMessages(cached as Message[])
          notifyMessagesSettledRef.current(gen)
        }
        setLoading(false)
      }
      return
    }
    // Only show the inline spinner when the chat shell has no cached
    // content to paint yet. With a warm cache the network refresh is
    // silent (no extra render hop).
    const hasPaintedFromCache = isCachePaintedForGen(cachePaintedGenRef, gen)
    if (!silent && !hasPaintedFromCache) setLoading(true)
    try {
      const url = `/api/group_chat/${group_id}/messages?limit=50`
      const response = await fetch(url, { credentials: 'include', headers: { 'Accept': 'application/json' } })
      const data = await response.json()
      if (gen !== threadGenerationRef.current || fetchGroupId !== activeGroupIdRef.current) return
      if (data.success) {
        const newServerMessages = (data.messages as Message[]).filter(
          m => !pendingDeletions.current.has(m.id)
        )
        const typingNext = data.steve_is_typing === true
        setSteveIsTyping(prev => (prev === typingNext ? prev : typingNext))

        if (!silent) setHasMoreMessages(!!data.has_more)
        cacheMessages(`group:${group_id}`, newServerMessages)
        if (groupChatCacheKey && gen === threadGenerationRef.current) {
          writeDeviceCache(groupChatCacheKey, newServerMessages, CHAT_CACHE_TTL_MS, CHAT_CACHE_VERSION)
        }

        const snap = cacheSnapshotRef.current
        const unchangedFromCache =
          !silent &&
          isUnchangedFromCacheSnapshot(
            snap,
            isCachePaintedForGen(cachePaintedGenRef, gen),
            newServerMessages,
          )

        if (!unchangedFromCache) {
          // Reactions ride along on each message row (`msg.reaction`) —
          // no separate state map. `mergePolledGroupMessages` already
          // replaces matching rows with the new server payload, so any
          // emoji change is part of the same render as the bubble.
          setServerMessages(prev => {
            if (gen !== threadGenerationRef.current) return prev
            return mergePolledGroupMessages(prev, newServerMessages, {
              pendingDeletions: pendingDeletions.current,
              isDelta: false,
              silent,
            }) as Message[]
          })
        }

        const newMaxId = newServerMessages.length > 0 ? Math.max(...newServerMessages.map(m => m.id)) : 0
        if (newMaxId > 0 && gen === threadGenerationRef.current) {
          lastMessageIdRef.current = Math.max(lastMessageIdRef.current, newMaxId)
        }

        if (!silent && !unchangedFromCache) notifyMessagesSettledRef.current(gen)
      }
    } catch (err) {
      console.error('Error loading messages:', err)
      if (gen !== threadGenerationRef.current || fetchGroupId !== activeGroupIdRef.current) return
      if (!silent) {
        setServerMessages(prev => {
          if (!prev.length) setError(t('chat.failed_load_messages'))
          return prev
        })
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [group_id, groupChatCacheKey, t])

  const returnToLatest = useCallback(() => {
    viewingHistoryRef.current = false
    setViewingHistory(false)
    skipNextPollsUntil.current = 0
    void loadMessages(false).then(() => {
      requestAnimationFrame(() => scrollToBottomSmooth())
    })
  }, [loadMessages, scrollToBottomSmooth, skipNextPollsUntil])

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlderRef.current || !hasMoreMessages) return
    const gen = threadGenerationRef.current
    const fetchGroupId = group_id
    loadingOlderRef.current = true
    setLoadingOlder(true)
    try {
      const currentMsgs = serverMessages.filter(m => m.id > 0)
      const oldestId = currentMsgs.length > 0 ? Math.min(...currentMsgs.map(m => m.id)) : 0
      if (oldestId <= 0) { loadingOlderRef.current = false; setLoadingOlder(false); return }
      const r = await fetch(`/api/group_chat/${group_id}/messages?before_id=${oldestId}&limit=50`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
      const j = await r.json()
      if (gen !== threadGenerationRef.current || fetchGroupId !== activeGroupIdRef.current) return
      if (j?.success && Array.isArray(j.messages) && j.messages.length > 0) {
        setServerMessages(prev => {
          const older = (j.messages as Message[]).filter(m => !prev.some(p => p.id === m.id))
          return [...older, ...prev]
        })
        setHasMoreMessages(!!j.has_more)
        // Inverted list invariant: column-reverse anchors layout at the
        // visual bottom, so prepending older content preserves the user's
        // visual position automatically. Do NOT touch scrollTop here.
        // See .cursor/rules/chat-surfaces.mdc.
      } else {
        setHasMoreMessages(false)
      }
    } catch (err) {
      console.error('Failed to load older group messages:', err)
    }
    loadingOlderRef.current = false
    setLoadingOlder(false)
  }, [hasMoreMessages, group_id, serverMessages])

  loadOlderRef.current = loadOlderMessages

  useGroupMessagePoll<Message>({
    groupId: group_id,
    threadGenerationRef,
    activeGroupIdRef,
    lastMessageIdRef,
    skipNextPollsUntil,
    pollInFlightRef,
    pollTickRef,
    pendingDeletions,
    setServerMessages,
    setSteveIsTyping,
  })

  useEffect(() => {
    loadGroup()
    void loadMessages(false)
  }, [loadGroup, loadMessages])

  // Hydrate pending/failed outbox entries so they survive app restarts
  useEffect(() => {
    if (!group_id) return
    getOutboxEntries().then(entries => {
      const myEntries = entries.filter(e => e.type === 'group' && e.groupId === String(group_id) && (e.status === 'pending' || e.status === 'failed'))
      if (!myEntries.length) return
      setServerMessages(prev => {
        const existingKeys = new Set(prev.map(m => (m as any).clientKey).filter(Boolean))
        const toAdd = myEntries
          .filter(e => !existingKeys.has(e.clientKey))
          .map(e => {
            let text = e.content
            let replySnippet: string | undefined
            let replySender: string | undefined
            const replyMatch = text.match(/^\[REPLY:([^:]+):([^\]]+)\](?:\r?\n|\s)*(.*)$/s)
            if (replyMatch) {
              replySender = replyMatch[1]
              replySnippet = stripReplyMarker(replyMatch[2])
              text = replyMatch[3]
            }
            return {
              id: -e.createdAt,
              sender: currentUsername || 'You',
              text: text,
              image: null,
              video: null,
              voice: null,
              created_at: new Date(e.createdAt).toISOString(),
              profile_picture: null,
              clientKey: e.clientKey,
              isOptimistic: true,
              sendFailed: e.status === 'failed',
              replySnippet,
              replySender,
              _originalMessage: e.content,
            }
          })
        return toAdd.length ? [...prev, ...toAdd as any[]] : prev
      })
    }).catch(() => {})
  }, [group_id, currentUsername])

  // Re-fetch messages when outbox drainer completes
  useEffect(() => {
    const handler = () => { loadMessages() }
    window.addEventListener('outbox-drained', handler)
    return () => window.removeEventListener('outbox-drained', handler)
  }, [loadMessages])

  // Restore draft when entering group chat (only if there's an actual saved draft).
  // Added extra protection for iOS navigation - clear any stale content first.
  // Runs in useLayoutEffect so the textarea auto-height (and resulting
  // composer card height) is committed in the same paint as the chat shell.
  // Without this, the post-paint adjustment grows `listPaddingBottom` and
  // visibly shifts the inverted message list upward by a few pixels on open.
  useLayoutEffect(() => {
    if (!group_id || !textareaRef.current) return
    
    // Force clear any stale content before checking for saved draft (fixes iOS navigation issue)
    if (textareaRef.current.value) {
      textareaRef.current.value = ''
    }
    
    const savedDraft = readDeviceCache<string>(`chat-draft:group:${group_id}`)
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
  }, [group_id])

  // Share handoff must run *after* draft restore above, or saved/cleared draft overwrites shared links.
  const shareAttach = searchParams.get('share')
  useEffect(() => {
    if (shareAttach !== '1' || !group_id) return
    const handoffKey = `group:${group_id}:share`
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
  }, [group_id, shareAttach, setSearchParams])

  useEffect(() => {
    if (shareAttach === '1') return
    if (group_id) {
      const k = `group:${group_id}:share`
      releaseShareHandoffKey(k)
      releaseShareUrlHandoffKey(k)
    }
  }, [shareAttach, group_id])

  // Save draft when leaving group chat (cleanup)
  useEffect(() => {
    return () => {
      if (draftSaveTimeoutRef.current) {
        clearTimeout(draftSaveTimeoutRef.current)
      }
      const currentText = textareaRef.current?.value || draftRef.current
      if (currentText?.trim() && group_id) {
        writeDeviceCache(`chat-draft:group:${group_id}`, currentText)
      }
    }
  }, [group_id])

  const handleSend = useCallback(() => {
    // Get text directly from textarea (uncontrolled)
    const text = (textareaRef.current?.value || '').trim()

    // Use ref for synchronous check to prevent double-sends
    if (!text || sendingLockRef.current) return

    // Capture reply state before clearing — compute outbound payload for Steve gate
    const replySnapshot = replyTo
    let formattedMessage = text
    if (replySnapshot) {
      let replySnippet: string
      if (replySnapshot.image) {
        replySnippet = `📷|${replySnapshot.image}|${(replySnapshot.text || 'Photo').slice(0, 60)}`
      } else if (replySnapshot.video) {
        const caption = replySnapshot.text || 'Video'
        replySnippet = `🎥|${replySnapshot.video}|${caption.slice(0, 60)}`
      } else if (replySnapshot.voice) {
        const summarySnippet = replySnapshot.audio_summary ? replySnapshot.audio_summary.slice(0, 80) : ''
        replySnippet = summarySnippet ? `🎤|${summarySnippet}` : '🎤|Voice message'
      } else {
        // Collapse nesting at the source: never embed the parent's own reply
        // marker when quoting a message that was itself a reply.
        const parentText = stripReplyMarker(replySnapshot.text)
        replySnippet = parentText.length > 90 ? parentText.slice(0, 90) + '…' : parentText
      }
      formattedMessage = `[REPLY:${replySnapshot.sender}:${replySnippet}]\n${text}`
    }

    if (tryBlockSteveIntentSend(formattedMessage)) return

    chatHapticSend()

    // Lock immediately (synchronous) to prevent double-clicks
    sendingLockRef.current = true
    justSentRef.current = true
    skipNextPollsUntil.current = Date.now() + 800
    setTimeout(() => {
      justSentRef.current = false
    }, 400)

    // Cancel any pending draft save timer FIRST to prevent race condition
    if (draftSaveTimeoutRef.current) {
      clearTimeout(draftSaveTimeoutRef.current)
      draftSaveTimeoutRef.current = null
    }

    // CLEAR COMPOSER IMMEDIATELY + remove persisted draft
    if (textareaRef.current) {
      textareaRef.current.value = ''
    }
    draftRef.current = ''
    setDraftDisplay('')
    adjustTextareaHeight()

    // Clear the saved draft from device cache when message is sent
    if (group_id) {
      clearDeviceCache(`chat-draft:group:${group_id}`)
    }

    setReplyTo(null)

    let replySnippet: string | undefined
    if (replySnapshot) {
      if (replySnapshot.image) {
        replySnippet = `📷|${replySnapshot.image}|${(replySnapshot.text || 'Photo').slice(0, 60)}`
      } else if (replySnapshot.video) {
        const caption = replySnapshot.text || 'Video'
        replySnippet = `🎥|${replySnapshot.video}|${caption.slice(0, 60)}`
      } else if (replySnapshot.voice) {
        const summarySnippet = replySnapshot.audio_summary ? replySnapshot.audio_summary.slice(0, 80) : ''
        replySnippet = summarySnippet ? `🎤|${summarySnippet}` : '🎤|Voice message'
      } else {
        replySnippet = replySnapshot.text.length > 90 ? replySnapshot.text.slice(0, 90) + '…' : replySnapshot.text
      }
    }

    const now = new Date().toISOString()
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const optimisticMessage: Message & { clientKey: string; replySnippet?: string; replySender?: string; isOptimistic: boolean; sendFailed?: boolean; _originalMessage?: string } = {
      id: -Date.now(),
      sender: currentUsername || 'You',
      text: text,
      image: null,
      video: null,
      voice: null,
      created_at: now,
      profile_picture: null,
      clientKey: tempId,
      replySnippet: replySnippet,
      replySender: replySnapshot?.sender,
      isOptimistic: true,
      sendFailed: false,
      _originalMessage: formattedMessage,
    }
    
    // Add optimistic message directly to serverMessages (same pattern as DMs)
    setServerMessages(prev => [...prev, optimisticMessage as any])
    requestAnimationFrame(ensurePinnedToBottom)

    let outboxId = -1
    addToOutbox({
      type: 'group',
      recipient: '',
      groupId: String(group_id),
      content: formattedMessage,
      clientKey: tempId,
      createdAt: Date.now(),
      status: 'pending',
      retries: 0,
    }).then(id => { outboxId = id }).catch(() => {})

    const markFailed = (key: string) => {
      setServerMessages(prev => prev.map(m =>
        (m as any).clientKey === key ? { ...m, sendFailed: true, isOptimistic: true } : m
      ))
      if (outboxId >= 0) updateOutboxStatus(outboxId, 'failed').catch(() => {})
    }

    if (!navigator.onLine) {
      markFailed(tempId)
      sendingLockRef.current = false
      return
    }

    const sendTimeout = setTimeout(() => markFailed(tempId), GROUP_SEND_CONFIRM_TIMEOUT_MS)

    fetch(`/api/group_chat/${group_id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ message: formattedMessage, client_key: tempId }),
    })
      .then(response => response.json())
      .then(data => {
        clearTimeout(sendTimeout)
        if (handleBasicProfileRequired(data)) {
          markFailed(tempId)
          return
        }
        if (data?.entitlements_error && isEntitlementsError(data.entitlements_error)) {
          entitlementsHandler.showError(data.entitlements_error)
        }
        if (data.success) {
          if (outboxId >= 0) removeFromOutbox(outboxId).catch(() => {})

          setServerMessages(prev => {
            let found = false
            const updated = prev.map(m => {
              if ((m as any).clientKey === tempId) {
                found = true
                return { ...data.message, clientKey: tempId, isOptimistic: false, sendFailed: false }
              }
              return m
            })
            if (!found) return prev
            const serverId = data.message.id
            clientKeyServerIdRef.current.set(tempId, serverId)
            return updated.filter(m =>
              m.id !== serverId || (m as any).clientKey === tempId
            )
          })
          lastMessageIdRef.current = Math.max(lastMessageIdRef.current, data.message.id)
        } else {
          clearTimeout(sendTimeout)
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
  }, [group_id, currentUsername, loadMessages, replyTo, tryBlockSteveIntentSend])

  const retryFailedMessage = useCallback((clientKey: string) => {
    const msg = serverMessages.find(m => (m as any).clientKey === clientKey)
    if (!msg) return
    const originalMessage = (msg as any)._originalMessage || msg.text || ''
    if (tryBlockSteveIntentSend(originalMessage)) return
    setServerMessages(prev => prev.map(m =>
      (m as any).clientKey === clientKey ? { ...m, sendFailed: false, isOptimistic: true } : m
    ))

    const markRetryFailed = () => {
      setServerMessages(prev => prev.map(m =>
        (m as any).clientKey === clientKey ? { ...m, sendFailed: true } : m
      ))
      getOutboxEntries().then(entries => {
        const e = entries.find(x => x.clientKey === clientKey)
        if (e?.id != null) updateOutboxStatus(e.id, 'failed', (e.retries || 0) + 1).catch(() => {})
      }).catch(() => {})
    }

    const retryTimeout = setTimeout(markRetryFailed, GROUP_SEND_CONFIRM_TIMEOUT_MS)

    fetch(`/api/group_chat/${group_id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ message: originalMessage, client_key: clientKey }),
    })
      .then(r => r.json())
      .then(data => {
        clearTimeout(retryTimeout)
        if (handleBasicProfileRequired(data)) {
          markRetryFailed()
          return
        }
        if (data?.entitlements_error && isEntitlementsError(data.entitlements_error)) {
          entitlementsHandler.showError(data.entitlements_error)
        }
        if (data.success) {
          getOutboxEntries().then(entries => {
            const e = entries.find(x => x.clientKey === clientKey)
            if (e?.id != null) removeFromOutbox(e.id).catch(() => {})
          }).catch(() => {})

          setServerMessages(prev => {
            let found = false
            const updated = prev.map(m => {
              if ((m as any).clientKey === clientKey) { found = true; return { ...data.message, clientKey, isOptimistic: false, sendFailed: false } }
              return m
            })
            if (!found) return prev
            clientKeyServerIdRef.current.set(clientKey, data.message.id)
            return updated.filter(m => m.id !== data.message.id || (m as any).clientKey === clientKey)
          })
          lastMessageIdRef.current = Math.max(lastMessageIdRef.current, data.message.id)
        } else {
          clearTimeout(retryTimeout)
          markRetryFailed()
        }
      })
      .catch(() => {
        clearTimeout(retryTimeout)
        markRetryFailed()
      })
  }, [group_id, serverMessages, tryBlockSteveIntentSend, entitlementsHandler])

  // Handle @mention selection
  const handleMentionSelect = useCallback((username: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    
    const currentValue = textarea.value
    const cursorPos = textarea.selectionStart || 0
    
    // Replace the @query with @username (include space after)
    const before = currentValue.slice(0, mentionStartPos)
    const after = currentValue.slice(cursorPos)
    const newValue = `${before}@${username} ${after}`
    
    textarea.value = newValue
    draftRef.current = newValue
    setDraftDisplay(newValue)
    
    // Move cursor after the inserted mention
    const newCursorPos = mentionStartPos + username.length + 2 // @ + username + space
    textarea.setSelectionRange(newCursorPos, newCursorPos)
    
    // Clear mention state
    setMentionQuery(null)
    
    // Keep focus on textarea
    textarea.focus()
  }, [mentionStartPos])

  const handlePhotoSelect = async () => {
    setShowAttachMenu(false)
    if (isNativeMediaPlatform()) {
      const files = await pickFromLibraryNative()
      if (files && files.length) appendPendingMediaFiles(files) // null = user cancelled → do nothing
      return
    }
    fileInputRef.current?.click()
  }

  const handleCameraOpen = async () => {
    setShowAttachMenu(false)
    if (isNativeMediaPlatform()) {
      const files = await capturePhotoNative()
      if (files && files.length) appendPendingMediaFiles(files)
      return
    }
    cameraInputRef.current?.click()
  }
  
  const handleVideoSelect = () => {
    setShowAttachMenu(false)
    videoInputRef.current?.click()
  }

  const handleDocumentSelect = () => {
    setShowAttachMenu(false)
    documentInputRef.current?.click()
  }

  const handleDocumentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !group_id) return
    const optimisticId = -Date.now() - Math.floor(Math.random() * 10000)
    setSending(true)
    setServerMessages(prev => [
      ...prev,
      {
        id: optimisticId,
        sender: currentUsername || 'You',
        text: null,
        file_path: URL.createObjectURL(file),
        file_name: file.name,
        created_at: new Date().toISOString(),
        profile_picture: null,
        isOptimistic: true,
      } as any,
    ])
    requestAnimationFrame(ensurePinnedToBottom)
    try {
      const message = await sendGroupDocumentMessage({
        file,
        groupId: group_id,
        notifyError: msg => alert(msg),
      })
      if (message) {
        setServerMessages(prev =>
          prev.map(m => (m.id === optimisticId ? { ...message, isOptimistic: false } as any : m)),
        )
      }
    } catch (err) {
      setServerMessages(prev => prev.filter(m => m.id !== optimisticId))
      if (err instanceof Error && err.message === '__basic_profile_required__') return
      alert(err instanceof Error ? err.message : 'Failed to send document')
    } finally {
      setSending(false)
      if (documentInputRef.current) documentInputRef.current.value = ''
    }
  }

  // Handle multiple file selection (photos or videos)
  // Shared by the web <input> path and the native camera/library picker so both produce
  // identical pendingMedia — the upload kernel downstream is untouched.
  function appendPendingMediaFiles(files: File[]) {
    const newMedia: Array<{ file: File; previewUrl: string; type: 'image' | 'video' }> = []
    files.forEach(file => {
      if (file.type.startsWith('image/')) {
        newMedia.push({ file, previewUrl: URL.createObjectURL(file), type: 'image' })
      } else if (file.type.startsWith('video/')) {
        newMedia.push({ file, previewUrl: URL.createObjectURL(file), type: 'video' })
      }
    })
    if (newMedia.length > 0) {
      setPendingMedia(prev => [...prev, ...newMedia])
      setPreviewIndex(0)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    appendPendingMediaFiles(Array.from(files))
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (cameraInputRef.current) cameraInputRef.current.value = ''
  }
  
  // Handle video file selection (merged into handleFileChange for multi-select)
  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileChange(e)
  }
  
  // Handle paste from clipboard (images/screenshots)
  async function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const showImagePreview = (file: File) => {
      // Create blob URL immediately
      const blobUrl = URL.createObjectURL(file)
      
      // Blur the textarea to dismiss the keyboard on mobile
      if (textareaRef.current) {
        textareaRef.current.blur()
      }
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
      
      setPastedImage(file)
      setPastedImagePreview(blobUrl)
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

    // Fallback to legacy clipboardData method
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
  
  // Send pasted image
  const sendPastedImage = async () => {
    if (!pastedImage || !group_id) return
    
    // Add to pending media and send
    setUploadingMedia(true)
    await sendGroupMultiMedia({
      files: [{ file: pastedImage, type: 'image' }],
      groupId: group_id,
      currentUsername,
      setServerMessages,
      loadMessages,
      quality: mediaQuality,
      onProgress: setUploadProgress,
      onError: (msg) => alert(msg),
      onLimitReached: entitlementsHandler.showError,
      onCancelReady: (cancel) => setCancelActiveUpload(() => cancel),
      onComplete: () => {
        setUploadingMedia(false)
        setUploadProgress(null)
      }
    })
    
    // Clear pasted image
    if (pastedImagePreview) {
      try { URL.revokeObjectURL(pastedImagePreview) } catch {}
    }
    setPastedImage(null)
    setPastedImagePreview(null)
  }
  
  // Discard pasted image
  const discardPastedImage = () => {
    if (pastedImagePreview) {
      try { URL.revokeObjectURL(pastedImagePreview) } catch {}
    }
    setPastedImage(null)
    setPastedImagePreview(null)
  }
  
  // Remove a single media from pending
  const removeMediaFromPreview = (index: number) => {
    setPendingMedia(prev => {
      const item = prev[index]
      if (item?.previewUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(item.previewUrl) } catch {}
      }
      const newMedia = prev.filter((_, i) => i !== index)
      // Adjust preview index if needed
      if (previewIndex >= newMedia.length && newMedia.length > 0) {
        setPreviewIndex(newMedia.length - 1)
      }
      return newMedia
    })
  }
  
  const sendSharedGroupAudioFile = async (file: File) => {
    if (!group_id) return
    setSending(true)
    const optimisticId = -Date.now() - Math.floor(Math.random() * 10000)
    try {
      const ext = file.name.split('.').pop() || 'm4a'
      const formData = new FormData()
      formData.append('audio', file, `share.${ext}`)
      const uploadResponse = await fetch('/api/upload_voice_message', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      const uploadData = await uploadResponse.json()
      if (uploadData.success && uploadData.audio_path) {
        const optimisticMsg = {
          id: optimisticId,
          sender: currentUsername || 'You',
          text: null,
          image: null,
          voice: uploadData.audio_path,
          audio_summary: null,
          created_at: new Date().toISOString(),
          profile_picture: null,
          isOptimistic: true,
        }
        setServerMessages(prev => [...prev, optimisticMsg as any])
        requestAnimationFrame(ensurePinnedToBottom)
        const response = await fetch(`/api/group_chat/${group_id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ voice: uploadData.audio_path, client_key: `gvoice_${optimisticId}` }),
        })
        const data = await response.json()
        if (handleBasicProfileRequired(data)) {
          setServerMessages(prev => prev.filter(m => m.id !== optimisticId))
          return
        }
        if (data.success) {
          setServerMessages(prev =>
            prev.map(m => (m.id === optimisticId ? { ...data.message, isOptimistic: false } : m))
          )
          lastMessageIdRef.current = data.message.id
        } else {
          setServerMessages(prev => prev.filter(m => m.id !== optimisticId))
        }
      }
    } catch (err) {
      console.error('Error sending shared audio:', err)
      setServerMessages(prev => prev.filter(m => m.id !== optimisticId))
    } finally {
      setSending(false)
    }
  }

  // Confirm and send all pending media
  const confirmSendMedia = async () => {
    if (pendingMedia.length === 0 || !group_id) return

    const mediaToSend = [...pendingMedia]
    const audios = mediaToSend.filter(i => i.type === 'audio')
    const imagesAndVideos = mediaToSend.filter(i => i.type === 'image' || i.type === 'video')

    mediaToSend.forEach(item => {
      if (item.previewUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(item.previewUrl) } catch {}
      }
    })
    setPendingMedia([])
    setPreviewIndex(0)

    for (const item of audios) {
      await sendSharedGroupAudioFile(item.file)
    }

    if (imagesAndVideos.length === 0) return

    void sendGroupMultiMedia({
      files: imagesAndVideos.map(item => ({ file: item.file, type: item.type as 'image' | 'video' })),
      groupId: group_id,
      currentUsername,
      setServerMessages,
      loadMessages,
      quality: mediaQuality,
      onProgress: setUploadProgress,
      onError: (msg) => alert(msg),
      onLimitReached: entitlementsHandler.showError,
      onCancelReady: (cancel) => setCancelActiveUpload(() => cancel),
      onComplete: () => {
        setUploadProgress(null)
      },
    })
  }
  
  // Cancel all pending media
  const cancelMediaPreview = () => {
    pendingMedia.forEach(item => {
      if (item.previewUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(item.previewUrl) } catch {}
      }
    })
    setPendingMedia([])
    setPreviewIndex(0)
  }

  const handleMediaQualityChange = (next: MediaQuality) => {
    setMediaQuality(next)
    setStoredMediaQuality(next)
  }

  // GIF selection handler - uses modular sender
  const handleGifSelection = async (gif: GifSelection) => {
    if (!group_id) return
    
    try {
      const file = await gifSelectionToFile(gif, 'group-gif')
      
      setUploadingMedia(true)
      await sendGroupImageMessage({
        file,
        kind: 'gif',
        groupId: group_id,
        currentUsername,
        setServerMessages,
        loadMessages,
        onProgress: setUploadProgress,
        onError: (msg) => alert(msg),
        onLimitReached: entitlementsHandler.showError,
        onComplete: () => {
          setUploadingMedia(false)
          setUploadProgress(null)
        },
      })
    } catch (err) {
      console.error('Error sending GIF:', err)
      alert(t('chat.failed_send_gif'))
      setUploadingMedia(false)
      setUploadProgress(null)
    }
  }

  // Voice recording handlers
  const checkMicrophonePermission = () => {
    const hasGrantedBefore = localStorage.getItem('mic_permission_granted') === 'true'
    if (hasGrantedBefore) {
      startVoiceRecording()
      return
    }
    
    try {
      navigator.permissions?.query({ name: 'microphone' as PermissionName }).then((permissionStatus) => {
        if (permissionStatus.state === 'granted') {
          localStorage.setItem('mic_permission_granted', 'true')
          startVoiceRecording()
        } else {
          startVoiceRecording()
        }
      }).catch(() => {
        startVoiceRecording()
      })
    } catch {
      startVoiceRecording()
    }
  }

  const sendVoiceDirectly = async () => {
    if (!recording) return
    
    setSending(true)
    const optimisticId = -Date.now()
    try {
      const previewData = await stopAndGetBlob()
      if (!previewData?.blob) {
        setSending(false)
        return
      }

      const formData = new FormData()
      const ext = previewData.blob.type.includes('mp4') ? 'mp4' : 'webm'
      formData.append('audio', previewData.blob, `voice.${ext}`)

      const uploadResponse = await fetch('/api/upload_voice_message', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      const uploadData = await uploadResponse.json()

      if (uploadData.success && uploadData.audio_path) {
        const optimisticMsg = {
          id: optimisticId,
          sender: currentUsername || 'You',
          text: null,
          image: null,
          voice: uploadData.audio_path,
          audio_summary: null,
          created_at: new Date().toISOString(),
          profile_picture: null,
          isOptimistic: true,
        }
        setServerMessages(prev => [...prev, optimisticMsg as any])
        requestAnimationFrame(ensurePinnedToBottom)

        const response = await fetch(`/api/group_chat/${group_id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ voice: uploadData.audio_path, client_key: `gvoice_${optimisticId}` }),
        })
        const data = await response.json()

        if (handleBasicProfileRequired(data)) {
          setServerMessages(prev => prev.filter(m => m.id !== optimisticId))
          return
        }

        if (data.success) {
          setServerMessages(prev => prev.map(m => m.id === optimisticId ? { ...data.message, isOptimistic: false } : m))
          lastMessageIdRef.current = data.message.id
        } else {
          setServerMessages(prev => prev.filter(m => m.id !== optimisticId))
        }
      }

      if (previewData.url) {
        try { URL.revokeObjectURL(previewData.url) } catch {}
      }
    } catch (err) {
      console.error('Error sending voice:', err)
      setServerMessages(prev => prev.filter(m => m.id !== optimisticId))
    } finally {
      setSending(false)
    }
  }

  const sendRecordingPreview = async () => {
    if (!recordingPreview?.blob) return
    
    setSending(true)
    const optimisticId = -Date.now()
    try {
      const formData = new FormData()
      const ext = recordingPreview.blob.type.includes('mp4') ? 'mp4' : 'webm'
      formData.append('audio', recordingPreview.blob, `voice.${ext}`)

      const uploadResponse = await fetch('/api/upload_voice_message', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      const uploadData = await uploadResponse.json()

      if (uploadData.success && uploadData.audio_path) {
        const optimisticMsg = {
          id: optimisticId,
          sender: currentUsername || 'You',
          text: null,
          image: null,
          voice: uploadData.audio_path,
          audio_summary: null,
          created_at: new Date().toISOString(),
          profile_picture: null,
          isOptimistic: true,
        }
        setServerMessages(prev => [...prev, optimisticMsg as any])
        requestAnimationFrame(ensurePinnedToBottom)

        const response = await fetch(`/api/group_chat/${group_id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ voice: uploadData.audio_path, client_key: `gvoice_${optimisticId}` }),
        })
        const data = await response.json()

        if (handleBasicProfileRequired(data)) {
          setServerMessages(prev => prev.filter(m => m.id !== optimisticId))
          return
        }

        if (data.success) {
          setServerMessages(prev => prev.map(m => m.id === optimisticId ? { ...data.message, isOptimistic: false } : m))
          lastMessageIdRef.current = data.message.id
        } else {
          setServerMessages(prev => prev.filter(m => m.id !== optimisticId))
        }
      }

      cancelRecordingPreview()
      setPreviewPlaying(false)
    } catch (err) {
      console.error('Error sending voice:', err)
      setServerMessages(prev => prev.filter(m => m.id !== optimisticId))
    } finally {
      setSending(false)
    }
  }

  const togglePreviewPlayback = () => {
    if (!recordingPreview?.url) return

    if (previewPlaying && previewAudioRef.current) {
      previewAudioRef.current.pause()
      previewAudioRef.current = null
      setPreviewPlaying(false)
    } else {
      const audio = new Audio(recordingPreview.url)
      previewAudioRef.current = audio
      audio.onended = () => {
        setPreviewPlaying(false)
        previewAudioRef.current = null
      }
      audio.play().catch(() => {
        setPreviewPlaying(false)
        previewAudioRef.current = null
      })
      setPreviewPlaying(true)
    }
  }

  const handleLeave = async () => {
    if (!confirm(t('chat.leave_group_confirm'))) return

    try {
      const response = await fetch(`/api/group_chat/${group_id}/leave`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json()

      if (data.success) {
        navigate('/user_chat')
      } else {
        alert(data.error || t('chat.failed_leave_group'))
      }
    } catch (err) {
      console.error('Error leaving group:', err)
      alert(t('chat.failed_leave_group'))
    }
  }

  // Load available community members for adding to group
  const loadAvailableMembers = async () => {
    setLoadingAvailable(true)
    try {
      const response = await fetch(`/api/group_chat/${group_id}/available_members`, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      })
      const data = await response.json()
      
      if (data.success) {
        setAvailableMembers(data.members || [])
      }
    } catch (err) {
      console.error('Error loading available members:', err)
    } finally {
      setLoadingAvailable(false)
    }
  }

  // Add selected members to group
  const handleAddMembers = async () => {
    if (selectedNewMembers.length === 0) return
    
    // Check member limit
    const currentCount = group?.members.length || 0
    if (currentCount + selectedNewMembers.length > 5) {
      alert(t('chat.group_member_limit_hint', { max: 5 }))
      return
    }
    
    setAddingMembers(true)
    try {
      const response = await fetch(`/api/group_chat/${group_id}/add_members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ members: selectedNewMembers }),
      })
      const data = await response.json()
      
      if (data.success) {
        // Refresh group data
        loadGroup()
        setShowAddMembers(false)
        setSelectedNewMembers([])
        setAvailableMembers([])
        setMemberSearchQuery('')
        setExpandedCommunities(new Set())
      } else {
        if (data.limit_exceeded) {
          alert(t('chat.group_member_limit_hint', { max: data.max_members }))
        } else {
          alert(data.error || t('chat.failed_add_members'))
        }
      }
    } catch (err) {
      console.error('Error adding members:', err)
      alert(t('chat.failed_add_members'))
    } finally {
      setAddingMembers(false)
    }
  }

  const renderMessageText = useCallback(
    (text: string, isSent?: boolean) => renderTextWithSourceLinks(text, false, mentionToProfile, openExternalArticle, isSent),
    [mentionToProfile, openExternalArticle],
  )

  // Message action handlers
  const handleReaction = async (messageId: number, emoji: string) => {
    const target = serverMessages.find(m => m.id === messageId)
    const currentReaction = (target?.reaction ?? null) || null
    const newReaction = currentReaction === emoji ? null : emoji

    // Optimistic update: reactions live on the message row itself
    // (DM parity), so the bubble renders the new state in the same
    // frame as any subsequent server reconcile.
    setServerMessages(prev =>
      prev.map(m => (m.id === messageId ? { ...m, reaction: newReaction } : m)),
    )

    try {
      const response = await fetch(`/api/group_chat/${group_id}/message/${messageId}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reaction: newReaction || '' })
      })
      const data = await response.json()
      if (!data.success) {
        setServerMessages(prev =>
          prev.map(m => (m.id === messageId ? { ...m, reaction: currentReaction } : m)),
        )
      }
    } catch (err) {
      console.error('Failed to save reaction:', err)
      setServerMessages(prev =>
        prev.map(m => (m.id === messageId ? { ...m, reaction: currentReaction } : m)),
      )
    }
  }

  const handleCopyMessage = (text: string | null) => {
    if (text) {
      navigator.clipboard.writeText(text).catch(() => {})
    }
  }

  const handleRemoveGroupMediaItem = useCallback(
    async (messageId: number, mediaUrl: string) => {
      if (!group_id) return
      const gid = Number(group_id)
      if (!Number.isFinite(gid)) return
      if (!confirm(t('chat.remove_attachment_confirm'))) return
      try {
        const res = await fetch(`/api/group_chat/${gid}/remove_message_media`, {
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
          setServerMessages(prev => prev.filter(m => m.id !== messageId))
          return
        }
        const mp = (j.media_paths as string[]) || []
        const pickFirst = (re: RegExp) => mp.find(p => re.test(p.split('?')[0].toLowerCase()))
        const firstImg = pickFirst(/\.(png|jpg|jpeg|gif|webp)$/i)
        const firstVid = pickFirst(/\.(mp4|mov|webm|m4v|avi)$/i)
        setServerMessages(prev =>
          prev.map(m => {
            if (m.id !== messageId) return m
            return {
              ...m,
              media_paths: mp.length ? mp : null,
              image: firstImg ?? null,
              video: firstVid ?? null,
            }
          }),
        )
      } catch {
        alert(t('chat.remove_attachment_network_error'))
      }
    },
    [group_id],
  )

  const handleDeleteMessage = async (messageId: number, messageData: Message) => {
    if (!confirm(t('chat.delete_message_confirm'))) return

    /** Positive id = persisted on server; temp / negative = local failed or unsent bubble */
    const hasPersistedServerId = typeof messageId === 'number' && messageId > 0

    if (!hasPersistedServerId) {
      pendingDeletions.current.add(messageId)
      setServerMessages(prev => prev.filter(m => m.id !== messageId))
      const ck = (messageData as { clientKey?: string }).clientKey
      if (ck) {
        getOutboxEntries()
          .then(entries => {
            const e = entries.find(x => x.clientKey === ck && x.type === 'group')
            if (e?.id != null) removeFromOutbox(e.id).catch(() => {})
          })
          .catch(() => {})
      }
      setTimeout(() => pendingDeletions.current.delete(messageId), 5000)
      return
    }
    
    // Add to pending deletions to prevent re-appearing from poll
    pendingDeletions.current.add(messageId)
    
    // Optimistically remove the message
    setServerMessages(prev => prev.filter(m => m.id !== messageId))
    
    try {
      const response = await fetch(`/api/group_chat/${group_id}/message/${messageId}/delete`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json()
      
      if (data.success) {
        // Keep in pending deletions for a while to prevent re-appearing
        setTimeout(() => {
          pendingDeletions.current.delete(messageId)
        }, 5000)
      } else {
        // Restore the message if deletion failed
        pendingDeletions.current.delete(messageId)
        setServerMessages(prev => {
          if (prev.some(m => m.id === messageId)) return prev
          return [...prev, messageData].sort((a, b) => 
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          )
        })
        alert(data.error || t('chat.failed_delete_message'))
      }
    } catch (err) {
      console.error('Error deleting message:', err)
      pendingDeletions.current.delete(messageId)
      setServerMessages(prev => {
        if (prev.some(m => m.id === messageId)) return prev
        return [...prev, messageData].sort((a, b) => 
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
      })
      alert(t('chat.delete_network_error'))
    }
  }

  // Multi-select delete functions
  const enterSelectionMode = (initialMessageId?: number) => {
    setSelectionMode(true)
    if (initialMessageId !== undefined) {
      setSelectedMessages(new Set([initialMessageId]))
    } else {
      setSelectedMessages(new Set())
    }
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedMessages(new Set())
  }

  const toggleMessageSelection = (messageId: number) => {
    setSelectedMessages(prev => {
      const newSet = new Set(prev)
      if (newSet.has(messageId)) {
        newSet.delete(messageId)
      } else {
        newSet.add(messageId)
      }
      return newSet
    })
  }

  const handleBulkDelete = async () => {
    if (selectedMessages.size === 0) return
    
    const count = selectedMessages.size
    if (!confirm(t('chat.delete_messages_confirm', { count }))) return
    
    const idsToDelete = Array.from(selectedMessages)
    const serverIds = idsToDelete.filter((id): id is number => typeof id === 'number' && id > 0)

    idsToDelete.forEach(id => pendingDeletions.current.add(id))

    setServerMessages(prev => {
      const dropping = prev.filter(m => selectedMessages.has(m.id))
      for (const m of dropping) {
        if (typeof m.id === 'number' && m.id <= 0) {
          const ck = (m as { clientKey?: string }).clientKey
          if (ck) {
            getOutboxEntries()
              .then(entries => {
                const e = entries.find(x => x.clientKey === ck && x.type === 'group')
                if (e?.id != null) removeFromOutbox(e.id).catch(() => {})
              })
              .catch(() => {})
          }
        }
      }
      return prev.filter(m => !selectedMessages.has(m.id))
    })

    exitSelectionMode()

    if (serverIds.length === 0) {
      setTimeout(() => {
        idsToDelete.forEach(id => pendingDeletions.current.delete(id))
      }, 5000)
      return
    }
    
    try {
      const response = await fetch(`/api/group_chat/${group_id}/messages/bulk_delete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_ids: serverIds })
      })
      const data = await response.json()
      
      if (data.success) {
        setTimeout(() => {
          idsToDelete.forEach(id => pendingDeletions.current.delete(id))
        }, 5000)
      } else {
        idsToDelete.forEach(id => pendingDeletions.current.delete(id))
        loadMessages(true)
        alert(data.error || t('chat.failed_delete_messages'))
      }
    } catch (err) {
      console.error('Error bulk deleting messages:', err)
      idsToDelete.forEach(id => pendingDeletions.current.delete(id))
      loadMessages(true)
      alert(t('chat.delete_messages_network_error'))
    }
  }

  const handleStartEdit = (messageId: number, currentText: string) => {
    setEditingId(messageId)
    setEditText(currentText)
  }

  const handleSaveEdit = async () => {
    if (!editingId || !editText.trim()) return
    
    const newText = editText.trim()
    const oldMessage = serverMessages.find(m => m.id === editingId)
    if (!oldMessage) return
    
    setEditingSaving(true)
    
    // Optimistically update the message with edited flag
    setServerMessages(prev => prev.map(m => 
      m.id === editingId ? { ...m, text: newText, is_edited: true } : m
    ))
    
    try {
      const response = await fetch(`/api/group_chat/${group_id}/message/${editingId}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: newText }),
      })
      const data = await response.json()
      
      if (data.success) {
        // Re-apply edited state in case a poll overwrote the optimistic update
        setServerMessages(prev => prev.map(m => 
          m.id === editingId ? { ...m, text: newText, is_edited: true } : m
        ))
        setEditingId(null)
        setEditText('')
      } else {
        // Restore the old text and edited flag
        setServerMessages(prev => prev.map(m => 
          m.id === editingId ? { ...m, text: oldMessage.text, is_edited: oldMessage.is_edited } : m
        ))
        alert(data.error || t('chat.failed_edit_message'))
      }
    } catch (err) {
      console.error('Error editing message:', err)
      setServerMessages(prev => prev.map(m => 
        m.id === editingId ? { ...m, text: oldMessage.text } : m
      ))
      alert(t('chat.edit_message_network_error'))
    } finally {
      setEditingSaving(false)
    }
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditText('')
  }

  const handleSaveSummaryEdit = async (messageId: number) => {
    const newSummary = editSummaryText.trim()
    if (!newSummary) return
    
    const oldMsg = serverMessages.find(m => m.id === messageId)
    setServerMessages(prev => prev.map(m => m.id === messageId ? { ...m, audio_summary: newSummary } : m))
    setEditingSummaryId(null)
    setEditSummaryText('')
    
    try {
      const response = await fetch(`/api/group_chat/${group_id}/message/${messageId}/update_summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ summary: newSummary }),
      })
      const data = await response.json()
      if (!data.success) {
        if (oldMsg) setServerMessages(prev => prev.map(m => m.id === messageId ? { ...m, audio_summary: oldMsg.audio_summary } : m))
      }
    } catch {
      if (oldMsg) setServerMessages(prev => prev.map(m => m.id === messageId ? { ...m, audio_summary: oldMsg.audio_summary } : m))
    }
  }

  const mediaUploadBanner: UploadProgress | null =
    uploadProgress ?? (uploadingMedia ? { stage: 'uploading', progress: 0 } : null)

  if (error) {
    return (
      <div className="min-h-screen chat-thread-bg text-c-text-primary flex flex-col">
        <div className="bg-c-header-bg" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          <div className="h-12 flex items-center px-3">
            <button className="p-2 rounded-full hover:bg-c-hover-bg" onClick={() => { hapticImpactLight(); navigate('/user_chat') }} aria-label={t('common.back')}>
              <i className="fa-solid fa-arrow-left text-c-text-primary" />
            </button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-red-400 mb-4">{error}</div>
            <button
              onClick={() => navigate('/user_chat')}
              className="px-4 py-2 bg-c-active-bg rounded-lg hover:bg-white/20"
            >
              Back to Messages
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div 
      className="text-c-text-primary chat-thread-bg"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header - fixed at top with safe area */}
      <div 
        className="flex-shrink-0 border-b border-c-border bg-c-header-bg"
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
        }}
      >
        <div className="h-12 flex items-center gap-2 px-3">
          <button 
            className="p-2 rounded-full hover:bg-c-hover-bg transition-colors" 
            onClick={() => { hapticImpactLight(); navigate('/user_chat') }} 
            aria-label={t('chat.back_to_messages')}
          >
            <i className="fa-solid fa-arrow-left text-c-text-primary" />
          </button>
          <div className="w-9 h-9 rounded-full bg-cpoint-turquoise/20 flex items-center justify-center">
            <i className="fa-solid fa-users text-cpoint-turquoise text-sm" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate text-c-text-primary text-sm">
              {group?.name || 'Group Chat'}
            </div>
            <div className="text-xs text-c-text-tertiary">
              {group?.members.length} members
            </div>
          </div>
          <button
            type="button"
            className="p-2 rounded-full hover:bg-c-hover-bg transition-colors"
            aria-label="Search messages"
            onClick={() => setSearchOpen(true)}
          >
            <i className="fa-solid fa-magnifying-glass text-c-text-secondary" />
          </button>
          <button 
            type="button"
            className="p-2 rounded-full hover:bg-c-hover-bg transition-colors" 
            aria-label={t('chat.more_options')}
            aria-haspopup="true"
            aria-expanded={headerMenuOpen}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              setHeaderMenuOpen(prev => !prev)
            }}
          >
            <i className="fa-solid fa-ellipsis-vertical text-c-text-secondary" />
          </button>
          {headerMenuOpen && (
            <div
              ref={headerMenuRef}
              className="absolute right-3 top-full mt-2 z-[10020] w-48"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="rounded-xl border border-c-border bg-c-bg-surface shadow-lg shadow-black/40 py-1">
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-c-text-secondary hover:bg-c-hover-bg transition-colors"
                  onClick={() => {
                    setHeaderMenuOpen(false)
                    setShowMembers(true)
                  }}
                >
                  <i className="fa-solid fa-users text-xs text-cpoint-turquoise" />
                  <span>{t('chat.view_members')}</span>
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-c-text-secondary hover:bg-c-hover-bg transition-colors"
                  onClick={() => {
                    setHeaderMenuOpen(false)
                    navigate(`/group_chat/${group_id}/media`)
                  }}
                >
                  <i className="fa-solid fa-photo-film text-xs text-cpoint-turquoise" />
                  <span>{t('chat.view_media')}</span>
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-c-text-secondary hover:bg-c-hover-bg transition-colors"
                  onClick={() => {
                    setHeaderMenuOpen(false)
                    navigate(`/group_chat/${group_id}/documents`)
                  }}
                >
                  <i className="fa-solid fa-file-pdf text-xs text-cpoint-turquoise" />
                  <span>{t('chat.view_documents')}</span>
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-c-text-secondary hover:bg-c-hover-bg transition-colors"
                  onClick={() => {
                    setHeaderMenuOpen(false)
                    if (!confirm(t('chat.reset_steve_confirm'))) return
                    fetch(`/api/group_chat/${group_id}/steve_reset_context`, {
                      method: 'POST',
                      credentials: 'include'
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
                  <i className="fa-solid fa-rotate text-xs text-cpoint-turquoise" />
                  <span>{t('chat.reset_steve')}</span>
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-c-text-secondary hover:bg-c-hover-bg transition-colors"
                  onClick={() => {
                    setHeaderMenuOpen(false)
                    setShowAddMembers(true)
                    loadAvailableMembers()
                  }}
                >
                  <i className="fa-solid fa-user-plus text-xs text-cpoint-turquoise" />
                  <span>{t('chat.add_members_action')}</span>
                </button>
                {group?.members.find(m => m.username === currentUsername)?.is_admin && (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-c-text-secondary hover:bg-c-hover-bg transition-colors"
                    onClick={() => {
                      setHeaderMenuOpen(false)
                      setRenameText(group?.name || '')
                      setShowManageGroup(true)
                      // Load Steve personality
                      fetch(`/api/group_chat/${group_id}/steve_personality`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
                        .then(r => r.json())
                        .then(d => { if (d?.success) setStevePersonality(d.personality || 'default') })
                        .catch(() => {})
                    }}
                  >
                    <i className="fa-solid fa-gear text-xs text-cpoint-turquoise" />
                    <span>{t('chat.manage_group')}</span>
                  </button>
                )}
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-c-hover-bg transition-colors"
                  onClick={() => {
                    setHeaderMenuOpen(false)
                    handleLeave()
                  }}
                >
                  <i className="fa-solid fa-arrow-right-from-bracket text-xs" />
                  <span>{t('chat.leave_group')}</span>
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
          {/* Messages List (inverted: column-reverse) */}
          <div
            ref={listRef}
            data-preserve-scroll="true"
            className={`flex-1 overflow-y-auto overflow-x-hidden text-c-text-primary px-2.5 sm:px-3 chat-list-inset${insetMotionIdle ? ' chat-list-idle-smooth' : ''}`}
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
            onPointerMove={handleContentPointerMove}
            onPointerUp={handleContentPointerUp}
            onPointerCancel={handleContentPointerCancel}
            onScroll={handleListScroll}
          >
            {/* DOM order under column-reverse: first child = visual bottom, last child = visual top. */}
            <ChatVirtualMessageList
              messages={messages}
              messageStackRef={messageStackRef}
              lastMessageRef={lastMessageRef}
              listRef={listRef}
              className="space-y-3 py-3"
              itemKey={(msg, idx) => {
                const mk = msg as Message & { clientKey?: string }
                return mk.clientKey ?? msg.id ?? idx
              }}
              footer={
                steveIsTyping ? (
                  <div className="min-h-[36px]">
                    <SteveTypingIndicator active={steveIsTyping} />
                  </div>
                ) : undefined
              }
              renderItem={(msg, idx) => {
                  const msgWithKey = msg as Message & { clientKey?: string; replySnippet?: string; replySender?: string }
                  const showAvatar = idx === 0 || messages[idx - 1].sender !== msg.sender
                  const showTime = showAvatar || (idx > 0 &&
                    new Date(msg.created_at).getTime() - new Date(messages[idx - 1].created_at).getTime() > 60000)
                  const messageReaction = msg.reaction || undefined
                  const isOptimistic = !!(msgWithKey as any).isOptimistic || msgWithKey.clientKey?.startsWith('temp_') || msg.id < 0
                  const sendFailed = !!(msgWithKey as any).sendFailed
                  const senderNormalized = (msg.sender || '').toLowerCase().trim()
                  const currentUserNormalized = (currentUsername || '').toLowerCase().trim()
                  const isSentByMe = isOptimistic || (senderNormalized !== '' && currentUserNormalized !== '' && senderNormalized === currentUserNormalized)
                  const messageDate = getDateKey(msg.created_at)
                  const prevMessageDate = idx > 0 ? getDateKey(messages[idx - 1].created_at) : null
                  const showDateSeparator = messageDate !== prevMessageDate
                  const firstMedia = msg.media_paths?.[0] || ''
                  const isMediaImage = firstMedia.match(/\.(jpg|jpeg|png|gif|webp)$/i)
                  return (
                    <GroupMessageRow
                      msg={{
                        ...msg,
                        clientKey: msgWithKey.clientKey,
                        replySnippet: msgWithKey.replySnippet,
                        replySender: msgWithKey.replySender,
                        isOptimistic,
                        sendFailed,
                      }}
                      showAvatar={showAvatar}
                      showTime={showTime}
                      showDateSeparator={showDateSeparator}
                      messageReaction={messageReaction}
                      isSentByMe={isSentByMe}
                      isOptimistic={isOptimistic}
                      sendFailed={sendFailed}
                      clientKey={msgWithKey.clientKey}
                      selectionMode={selectionMode}
                      isSelected={selectedMessages.has(msg.id)}
                      onToggleSelect={() => toggleMessageSelection(msg.id)}
                      onReact={(emoji) => handleReaction(msg.id, emoji)}
                      onReply={() => {
                        setReplyTo({
                          text: msg.text || '',
                          sender: isSentByMe ? 'You' : msg.sender,
                          image: msg.image || (isMediaImage ? firstMedia : undefined),
                          video: msg.video || (!isMediaImage && firstMedia ? firstMedia : undefined),
                          voice: msg.voice || undefined,
                          audio_summary: msg.audio_summary || undefined,
                        })
                        focusTextarea()
                      }}
                      onCopy={() => handleCopyMessage(msg.text)}
                      onDelete={() => handleDeleteMessage(msg.id, msg)}
                      onEdit={
                        isSentByMe && msg.text && !msg.image && !msg.video && !msg.voice && !msg.media_paths?.length
                          ? () => handleStartEdit(msg.id, msg.text || '')
                          : undefined
                      }
                      onEnterSelectMode={isSentByMe ? () => enterSelectionMode(msg.id) : undefined}
                      isEditing={editingId === msg.id}
                      editText={editText}
                      onEditTextChange={setEditText}
                      onCancelEdit={handleCancelEdit}
                      onSaveEdit={handleSaveEdit}
                      editingSaving={editingSaving}
                      formatTime={formatGroupThreadTime}
                      renderMessageText={renderMessageText}
                      currentUsername={currentUsername}
                      translationForMessage={translations[msg.id]}
                      translatingThis={translatingId === msg.id}
                      onTranslatePress={() => {
                        setShowLangPicker(msg.id)
                        setLangPickerSummary(msg.audio_summary!)
                      }}
                      onClearTranslation={() =>
                        setTranslations((prev) => {
                          const n = { ...prev }
                          delete n[msg.id]
                          return n
                        })
                      }
                      canEditSummary={msg.sender === currentUsername || msg.sender === 'You'}
                      onEditSummaryPress={() => {
                        setEditingSummaryId(msg.id)
                        setEditSummaryText(msg.audio_summary || '')
                      }}
                      onOpenMediaGroup={(urls) =>
                        setViewingMedia({ urls, index: 0, messageId: msg.id, senderUsername: msg.sender })
                      }
                      onOpenImage={(path) =>
                        setViewingMedia({ urls: [path], index: 0, messageId: msg.id, senderUsername: msg.sender })
                      }
                      onOpenVideo={(path) =>
                        setViewingMedia({ urls: [path], index: 0, messageId: msg.id, senderUsername: msg.sender })
                      }
                      onRetry={
                        msgWithKey.clientKey ? () => retryFailedMessage(msgWithKey.clientKey!) : undefined
                      }
                      onRemoveMediaItem={selectionMode ? undefined : handleRemoveGroupMediaItem}
                      linkPreviewReady={true}
                    />
                  )
                }}
              />

            {/* Load older / empty state — visually at the top of the inverted list. */}
            {loadingOlder && (
              <div className="flex justify-center py-3">
                <i className="fa-solid fa-spinner fa-spin text-cpoint-turquoise text-sm" />
              </div>
            )}
            {hasMoreMessages && !loadingOlder && (
              <div className="flex justify-center py-2">
                <button onClick={loadOlderMessages} className="text-xs text-cpoint-turquoise hover:text-cpoint-turquoise/80">
                  Load older messages
                </button>
              </div>
            )}
            {messages.length === 0 && loading && (
              <div className="flex flex-col items-center justify-center py-20 text-c-text-tertiary">
                <i className="fa-solid fa-spinner fa-spin text-2xl mb-3 opacity-70" />
              </div>
            )}
            {messages.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-20 text-c-text-tertiary">
                {!navigator.onLine ? (
                  <>
                    <i className="fa-solid fa-wifi-slash text-3xl mb-3 opacity-50" />
                    <div className="text-sm">{t('chat.offline_unavailable')}</div>
                    <div className="text-xs mt-1 opacity-70">{t('chat.offline_go_online')}</div>
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-comments text-4xl mb-3 opacity-50" />
                    <div className="text-sm">{t('chat.empty_state')}</div>
                    <div className="text-xs mt-1">{t('chat.empty_group_helper')}</div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* New messages chip — above composer when scrolled up */}
      {pendingNewCount > 0 && !selectionMode && (
        <NewMessagesChip
          count={pendingNewCount}
          bottom={scrollButtonBottom}
          onClick={() => {
            scrollToBottomSmooth()
            clearPendingNew()
          }}
        />
      )}

      {/* Jump to latest (history mode) or scroll to bottom */}
      {viewingHistory && !selectionMode && (
        <button
          type="button"
          className="fixed z-50 h-10 px-4 rounded-full bg-cpoint-turquoise text-black text-sm font-medium shadow-lg hover:brightness-110 flex items-center gap-2"
          style={{
            bottom: scrollButtonBottom,
            left: '50%',
            transform: 'translateX(-50%)',
          }}
          onClick={returnToLatest}
          aria-label={t('chat.jump_to_latest', 'Jump to latest')}
        >
          <i className="fa-solid fa-arrow-down" />
          {t('chat.jump_to_latest', 'Jump to latest')}
        </button>
      )}
      {showScrollDown && !selectionMode && !viewingHistory && (
        <button
          type="button"
          className="fixed z-50 w-10 h-10 rounded-full bg-cpoint-turquoise text-black shadow-lg border border-cpoint-turquoise hover:brightness-110 flex items-center justify-center"
          style={{
            bottom: scrollButtonBottom,
            right: '22px',
          }}
          onClick={() => {
            scrollToBottomSmooth()
          }}
          aria-label={t('chat.scroll_latest')}
        >
          <i className="fa-solid fa-arrow-down" />
        </button>
      )}

      {/* ====== COMPOSER - FIXED AT BOTTOM (portaled for keyboard lift) ======
          Render guard adds `!gifPickerOpen` so the underlying composer chrome
          does not show through the GIF picker's translucent glass sheet.
          This is a one-line visibility flag — it does not touch motion,
          scroll, keyboard, or message-list rendering (per
          docs/workflow-state-wave-2.md deferred-list scope). */}
      <ChatComposerPortal
        visible={pendingMedia.length === 0 && !gifPickerOpen}
        composerRef={composerRef}
        displayKeyboardLift={displayKeyboardLift}
        isWeb={isWeb}
      >
        {selectionMode ? (
          <ChatSelectionBar
            fixed={false}
            selectedCount={selectedMessages.size}
            onCancel={exitSelectionMode}
            onDelete={handleBulkDelete}
            deleteDisabled={selectedMessages.size === 0}
          />
        ) : (
        <ChatComposerCard composerCardRef={composerCardRef} isWeb={isWeb}>
          {/* Attachment menu */}
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
                className="absolute z-50 bg-c-bg-surface border border-c-border rounded-2xl shadow-xl overflow-hidden min-w-[190px]"
                style={{
                  touchAction: 'manipulation',
                  bottom: 'calc(100% + 8px)',
                  left: 0,
                }}
              >
                <ChatAttachMenuRow onClick={handlePhotoSelect}>
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-cpoint-turquoise/20 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-image text-cpoint-turquoise text-sm sm:text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-c-text-primary font-medium text-sm sm:text-base">{t('chat.photos')}</div>
                    <div className="text-c-text-tertiary text-[10px] sm:text-xs">{t('chat.send_from_gallery')}</div>
                  </div>
                </ChatAttachMenuRow>
                <ChatAttachMenuRow onClick={handleCameraOpen}>
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-cpoint-turquoise/20 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-camera text-cpoint-turquoise text-sm sm:text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-c-text-primary font-medium text-sm sm:text-base">{t('chat.camera')}</div>
                    <div className="text-c-text-tertiary text-[10px] sm:text-xs">{t('chat.take_photo')}</div>
                  </div>
                </ChatAttachMenuRow>
                <ChatAttachMenuRow onClick={handleVideoSelect}>
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-cpoint-turquoise/20 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-video text-cpoint-turquoise text-sm sm:text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-c-text-primary font-medium text-sm sm:text-base">{t('chat.video')}</div>
                    <div className="text-c-text-tertiary text-[10px] sm:text-xs">{t('chat.send_from_gallery')}</div>
                  </div>
                </ChatAttachMenuRow>
                <ChatAttachMenuRow onClick={handleDocumentSelect}>
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-cpoint-turquoise/20 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-file-pdf text-cpoint-turquoise text-sm sm:text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-c-text-primary font-medium text-sm sm:text-base">{t('chat.document')}</div>
                    <div className="text-c-text-tertiary text-[10px] sm:text-xs">{t('chat.send_pdf')}</div>
                  </div>
                </ChatAttachMenuRow>
                <ChatAttachMenuRow onClick={() => { setShowAttachMenu(false); setGifPickerOpen(true) }}>
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-cpoint-turquoise/20 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-images text-cpoint-turquoise text-sm sm:text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-c-text-primary font-medium text-sm sm:text-base">GIF</div>
                    <div className="text-c-text-tertiary text-[10px] sm:text-xs">{t('chat.powered_by_giphy')}</div>
                  </div>
                </ChatAttachMenuRow>
              </div>
            </>
          )}

          {/* Reply preview */}
          {replyTo && (
            <div className="mb-2 flex items-stretch gap-0 bg-c-hover-bg rounded-lg overflow-hidden">
              {/* Left accent bar */}
              <div className="w-1 bg-cpoint-turquoise flex-shrink-0" />
              <div className="flex-1 px-3 py-2 min-w-0 flex items-start gap-2">
                {/* Media thumbnail preview */}
                {replyTo.image && (
                  <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0 bg-c-bg-recessed">
                    <img 
                      src={normalizeMediaPath(replyTo.image)} 
                      alt="Photo" 
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                {replyTo.video && !replyTo.image && (
                  <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0 bg-c-bg-recessed">
                    <video 
                      src={normalizeMediaPath(replyTo.video) + '#t=0.1'} 
                      className="w-full h-full object-cover"
                      muted
                    />
                  </div>
                )}
                {replyTo.voice && !replyTo.image && !replyTo.video && (
                  <div className="w-10 h-10 rounded bg-c-bg-recessed flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-microphone text-c-text-tertiary text-sm" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-cpoint-turquoise font-medium truncate">
                    {replyTo.sender}
                  </div>
                  <div className="mt-0.5 text-[13px] text-c-text-secondary whitespace-pre-wrap break-words leading-[1.25]">
                    {replyTo.voice ? (
                      <><i className="fa-solid fa-microphone text-xs mr-1" />{replyTo.audio_summary ? replyTo.audio_summary.slice(0, 80) + (replyTo.audio_summary.length > 80 ? '…' : '') : 'Voice message'}</>
                    ) : replyTo.video ? (
                      <><i className="fa-solid fa-video text-xs mr-1" />{t('chat.video')}</>
                    ) : replyTo.image && !replyTo.text ? (
                      <><i className="fa-solid fa-image text-xs mr-1" />{t('chat.photo')}</>
                    ) : (
                      replyTo.text && replyTo.text.length > 80 ? replyTo.text.slice(0, 80) + '…' : replyTo.text
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="px-3 flex items-center justify-center hover:bg-c-hover-bg"
              >
                <i className="fa-solid fa-xmark text-c-text-tertiary" />
              </button>
            </div>
          )}

          {/* @mention autocomplete dropdown - positioned above composer */}
          {mentionQuery !== null && filteredMentions.length > 0 && (
            <div 
              ref={mentionDropdownRef}
              className="mb-2 bg-c-bg-elevated border border-c-border rounded-lg shadow-xl max-h-48 overflow-y-auto"
            >
              {filteredMentions.map((member) => (
                <button
                  key={member.username}
                  className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-c-hover-bg active:bg-white/20 text-left transition-colors"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleMentionSelect(member.username)
                  }}
                >
                  <Avatar 
                    url={member.profile_picture} 
                    username={member.username} 
                    size={32} 
                  />
                  <span className="text-c-text-primary text-sm font-medium">@{member.username}</span>
                </button>
              ))}
            </div>
          )}

          {/* Media upload progress (same pattern as DM ChatThread — above composer) */}
          {mediaUploadBanner && (
            <div className="mb-2 px-3 py-2.5 bg-c-hover-bg rounded-lg">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0">
                  {mediaUploadBanner.stage === 'uploading' && (
                    <i className="fa-solid fa-cloud-arrow-up text-cpoint-turquoise animate-bounce" />
                  )}
                  {mediaUploadBanner.stage === 'done' && (
                    <i className="fa-solid fa-check-circle text-green-400" />
                  )}
                  {mediaUploadBanner.stage === 'error' && (
                    <i className="fa-solid fa-exclamation-circle text-red-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-c-text-secondary truncate">
                    {mediaUploadBanner.stage === 'uploading'
                      ? t('chat.upload_sending_media')
                      : mediaUploadBanner.stage === 'done'
                        ? (mediaUploadBanner.message || t('chat.upload_sent'))
                        : (mediaUploadBanner.message === 'Upload cancelled'
                          ? t('chat.upload_cancelled_full')
                          : (mediaUploadBanner.message || t('chat.upload_failed_short')))}
                  </div>
                  <div className="mt-1.5 h-1.5 bg-c-active-bg rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        mediaUploadBanner.stage === 'error' ? 'bg-red-400' : 'bg-cpoint-turquoise'
                      }`}
                      style={{ width: `${mediaUploadBanner.progress}%` }}
                    />
                  </div>
                </div>
                <div className="flex-shrink-0 text-xs text-c-text-tertiary">
                  {Math.round(mediaUploadBanner.progress)}%
                </div>
                {mediaUploadBanner.stage === 'uploading' && cancelActiveUpload ? (
                  <button
                    type="button"
                    onClick={cancelActiveUpload}
                    className="flex-shrink-0 w-8 h-8 rounded-full bg-white/10 text-c-text-primary hover:bg-white/20"
                    aria-label={t('chat.cancel_upload')}
                    title={t('chat.cancel_upload')}
                  >
                    <i className="fa-solid fa-xmark" />
                  </button>
                ) : null}
              </div>
            </div>
          )}

          {/* Message input row */}
          <div className="flex items-end gap-2">
            {/* Plus/Attachment button */}
            <NativeIconButton
              size="lg"
              haptic="selection"
              preventBlur
              onClick={(e) => {
                e.stopPropagation()
                setShowAttachMenu(!showAttachMenu)
              }}
            >
              <i className={`fa-solid text-c-text-primary text-base sm:text-lg transition-transform duration-200 pointer-events-none ${
                showAttachMenu ? 'fa-xmark rotate-90' : 'fa-plus'
              }`} />
            </NativeIconButton>

            {/* Hidden file inputs */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
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
              ref={videoInputRef}
              type="file"
              accept="video/*"
              multiple
              onChange={handleVideoChange}
              className="hidden"
            />
            <input
              ref={documentInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleDocumentChange}
              className="hidden"
            />

            {/* Recording indicator */}
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
              className="flex-1 flex items-center rounded-lg bg-c-composer-input overflow-hidden relative"
              style={{
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              {/* Recording sound bar */}
              {MIC_ENABLED && recording && (
                <div className="flex-1 flex items-center px-3 py-2 gap-2">
                  <div className="flex-1 h-2 bg-c-active-bg rounded overflow-hidden">
                    <div className="h-full bg-[#7fe7df] transition-all" style={{ width: `${Math.max(6, Math.min(96, (level||0)*100))}%` }} />
                  </div>
                  <div className="text-sm font-mono text-c-text-primary tabular-nums flex-shrink-0 min-w-[45px] text-right">
                    {formatRecordingTime(recordMs || 0)}
                  </div>
                </div>
              )}

              {/* Voice preview - WhatsApp style */}
              {MIC_ENABLED && !recording && recordingPreview && (
                <div className="flex-1 flex items-center px-2 py-1.5 gap-2">
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
                  <NativeIconButton
                    size="sm"
                    haptic="selection"
                    preventBlur
                    className="!h-9 !w-9 !rounded-full bg-cpoint-turquoise text-white hover:brightness-95"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      togglePreviewPlayback()
                    }}
                    aria-label={previewPlaying ? t('chat.pause') : t('chat.play')}
                  >
                    <i className={`fa-solid ${previewPlaying ? 'fa-pause' : 'fa-play'} text-sm pointer-events-none ${!previewPlaying ? 'ml-0.5' : ''}`} />
                  </NativeIconButton>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
                      <div className="h-full bg-cpoint-turquoise w-full" />
                    </div>
                    <span className="text-xs text-c-text-secondary tabular-nums flex-shrink-0">
                      {formatRecordingTime((recordingPreview.duration || 0) * 1000)}
                    </span>
                  </div>
                </div>
              )}

              {/* Regular text input - UNCONTROLLED for reliable clearing */}
              {!(MIC_ENABLED && (recording || recordingPreview)) && (
                <textarea
                  ref={textareaRef}
                  rows={1}
                  className="flex-1 bg-transparent px-3 sm:px-3.5 py-2 text-[15px] text-c-text-primary placeholder-c-text-tertiary outline-none resize-none max-h-40 min-h-[38px]"
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
                      if (current && current.trim() && group_id) {
                        writeDeviceCache(`chat-draft:group:${group_id}`, current)
                      }
                    }, 300)

                    // Detect @mention typing
                    const cursorPos = textarea.selectionStart || 0
                    const textBeforeCursor = val.slice(0, cursorPos)

                    // Find the last @ that starts a mention (preceded by space or start of text)
                    const mentionMatch = textBeforeCursor.match(/(?:^|\s)@(\w*)$/)
                    if (mentionMatch) {
                      setMentionQuery(mentionMatch[1])
                      setMentionStartPos(cursorPos - mentionMatch[1].length - 1)
                    } else {
                      setMentionQuery(null)
                    }
                  }}
                  onKeyDown={(e) => {
                    // Handle mention dropdown navigation
                    if (mentionQuery !== null && filteredMentions.length > 0) {
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        setMentionQuery(null)
                        return
                      }
                      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                        e.preventDefault()
                        // Select first match
                        handleMentionSelect(filteredMentions[0].username)
                        return
                      }
                    }
                    // Send on Enter (without Shift for new line)
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  onPaste={handlePaste}
                />
              )}
            </div>

            {/* Mic button - shown when not recording, no preview, no text, and not sending */}
            {MIC_ENABLED && !recording && !recordingPreview && !draftDisplay.trim() && !sending && (
              <NativeIconButton
                size="lg"
                haptic="light"
                preventBlur
                className="text-c-text-secondary"
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

            {/* Recording controls - Pause + Send */}
            {MIC_ENABLED && recording && (
              <>
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
                <NativeIconButton
                  size="lg"
                  haptic="medium"
                  preventBlur
                  className="!bg-cpoint-turquoise text-white hover:!brightness-95"
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
              <NativeIconButton
                size="lg"
                haptic="medium"
                preventBlur
                className="!bg-cpoint-turquoise text-white hover:!brightness-95"
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
            )}

            {/* Normal send button - show when there's text OR when sending */}
            {!(MIC_ENABLED && (recording || recordingPreview)) && (draftDisplay.trim() || sending || !MIC_ENABLED) && (
              <button
                className={`w-10 h-10 flex-shrink-0 rounded-[14px] flex items-center justify-center ${
                  sending
                    ? 'bg-gray-600 text-gray-300 cursor-not-allowed'
                    : draftDisplay.trim()
                      ? 'bg-cpoint-turquoise text-black'
                      : 'bg-white/12 text-c-text-secondary'
                } ${!sending ? 'active:scale-95' : ''}`}
                onPointerDown={(e) => {
                  if (!draftDisplay.trim() || sending) return
                  e.preventDefault()
                  e.stopPropagation()
                  handleSend()
                }}
                onClick={(e) => {
                  // Fallback for devices where onPointerDown doesn't fire reliably
                  if (!draftDisplay.trim() || sending) return
                  e.preventDefault()
                  e.stopPropagation()
                  handleSend()
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
        )}
        {/* Safe area spacer — hidden when keyboard is open to avoid double spacing */}
        <div
          className={`chat-composer-spacer-smooth bg-c-composer-bg${keyboardChromeActive ? ' chat-composer-spacer-keyboard' : ''}`}
          style={{
            height: keyboardChromeActive ? '0px' : `${safeBottomPx}px`,
            flexShrink: 0,
          }}
        />
      </ChatComposerPortal>

      {/* GIF Picker */}
      <GifPicker
        isOpen={gifPickerOpen}
        onClose={() => setGifPickerOpen(false)}
        onSelect={async (gif) => {
          setGifPickerOpen(false)
          await handleGifSelection(gif)
        }}
      />

      {/* Members Modal */}
      {showMembers && group && (
        <div
          className="fixed inset-0 bg-c-bg-overlay backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
          onClick={() => setShowMembers(false)}
        >
          <div
            className="w-full max-w-sm bg-c-bg-surface rounded-2xl border border-c-border max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-c-border flex items-center justify-between">
              <div>
                <div className="font-semibold">{group.name}</div>
                <div className="text-xs text-c-text-tertiary">{group.members.length} members</div>
              </div>
              <button
                onClick={() => setShowMembers(false)}
                className="p-2 rounded-full hover:bg-c-hover-bg"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="p-4 max-h-[50vh] overflow-y-auto">
              <div className="text-xs text-c-text-tertiary uppercase tracking-wide mb-3">{t('chat.members_section')}</div>
              <div className="space-y-2">
                {group.members.map((member) => (
                  <div
                    key={member.username}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-c-hover-bg"
                  >
                    <Avatar
                      username={member.username}
                      url={member.profile_picture || undefined}
                      size={40}
                      linkToProfile
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{member.username}</div>
                      {member.is_admin && (
                        <div className="text-xs text-cpoint-turquoise">{t('feed.admin')}</div>
                      )}
                    </div>
                    {group.members.find(m => m.username === currentUsername)?.is_admin && 
                     member.username !== currentUsername && !member.is_admin && (
                      <button
                        onClick={async () => {
                          if (removingMember) return
                          if (!confirm(t('chat.remove_member_from_group_confirm', { username: member.username }))) return
                          setRemovingMember(member.username)
                          try {
                            const r = await fetch(`/api/group_chat/${group_id}/remove_member`, {
                              method: 'POST', credentials: 'include',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ username: member.username })
                            })
                            const d = await r.json().catch(() => null)
                            if (d?.success) {
                              setGroup(prev => prev ? { ...prev, members: prev.members.filter(m => m.username !== member.username) } : prev)
                            } else { alert(d?.error || t('chat.failed_remove_from_group')) }
                          } catch { alert(t('chat.failed_remove_member')) }
                          finally { setRemovingMember(null) }
                        }}
                        disabled={removingMember === member.username}
                        className="p-2 rounded-full hover:bg-red-500/20 text-red-400/60 hover:text-red-400 transition"
                        title="Remove member"
                      >
                        <i className={`fa-solid ${removingMember === member.username ? 'fa-spinner fa-spin' : 'fa-user-minus'} text-xs`} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-c-border">
              <button
                onClick={handleLeave}
                className="w-full px-4 py-3 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition"
              >
                <i className="fa-solid fa-arrow-right-from-bracket mr-2" />
                Leave Group
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Group Modal */}
      {showManageGroup && group && (
        <div
          className="fixed inset-0 bg-c-bg-overlay backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
          onClick={() => setShowManageGroup(false)}
        >
          <div
            className="w-full max-w-sm bg-c-bg-surface rounded-2xl border border-c-border max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-c-border flex items-center justify-between">
              <div className="font-semibold">{t('chat.manage_group')}</div>
              <button onClick={() => setShowManageGroup(false)} className="p-2 rounded-full hover:bg-c-hover-bg">
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="p-4 space-y-5 max-h-[60vh] overflow-y-auto">
              {/* Rename Group */}
              <div>
                <label className="text-xs text-c-text-tertiary uppercase tracking-wide mb-2 block">{t('chat.group_name_label')}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    maxLength={100}
                    className="flex-1 bg-c-hover-bg border border-c-border rounded-lg px-3 py-2 text-sm text-c-text-primary focus:outline-none focus:border-cpoint-turquoise"
                  />
                  <button
                    onClick={async () => {
                      if (!renameText.trim() || renaming) return
                      setRenaming(true)
                      try {
                        const r = await fetch(`/api/group_chat/${group_id}/rename`, {
                          method: 'POST', credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ name: renameText.trim() })
                        })
                        const d = await r.json().catch(() => null)
                        if (d?.success) {
                          setGroup(prev => prev ? { ...prev, name: d.name } : prev)
                        } else { alert(d?.error || t('chat.failed_rename_group')) }
                      } catch { alert(t('chat.failed_rename_group')) }
                      finally { setRenaming(false) }
                    }}
                    disabled={renaming || renameText.trim() === group.name}
                    className="px-4 py-2 bg-cpoint-turquoise text-black rounded-lg font-medium text-sm hover:brightness-110 transition disabled:opacity-40"
                  >
                    {renaming ? '...' : 'Save'}
                  </button>
                </div>
              </div>

              {/* Steve Personality */}
              <div>
                <label className="text-xs text-c-text-tertiary uppercase tracking-wide mb-2 block">{t('chat.steve_ai_personality')}</label>
                <div className="flex gap-2">
                  <select
                    value={stevePersonality}
                    onChange={(e) => setStevePersonality(e.target.value)}
                    className="flex-1 bg-c-hover-bg border border-c-border rounded-lg px-3 py-2 text-sm text-c-text-primary focus:outline-none focus:border-cpoint-turquoise appearance-none"
                  >
                    <option value="default">{t('chat.personality_default')}</option>
                    <option value="professional">{t('chat.personality_professional')}</option>
                    <option value="friendly">{t('chat.personality_friendly')}</option>
                    <option value="sarcastic">{t('chat.personality_sarcastic')}</option>
                    <option value="humorous">{t('chat.personality_humorous')}</option>
                    <option value="sage">{t('chat.personality_sage')}</option>
                    <option value="empathetic">{t('chat.personality_empathetic')}</option>
                    <option value="cynic">{t('chat.personality_cynic')}</option>
                    <option value="quirky">{t('chat.personality_quirky')}</option>
                    <option value="unhinged">{t('chat.personality_unhinged')}</option>
                  </select>
                  <button
                    onClick={async () => {
                      try {
                        const r = await fetch(`/api/group_chat/${group_id}/steve_personality`, {
                          method: 'POST', credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ personality: stevePersonality })
                        })
                        const d = await r.json().catch(() => null)
                        if (d?.success) { alert(t('chat.personality_saved')) }
                        else { alert(d?.error || t('chat.failed_save_personality')) }
                      } catch { alert(t('chat.failed_save_personality')) }
                    }}
                    className="px-4 py-2 bg-cpoint-turquoise text-black rounded-lg font-medium text-sm hover:brightness-110 transition"
                  >
                    Save
                  </button>
                </div>
              </div>

              {/* Delete Group */}
              <div className="pt-3 border-t border-c-border">
                <button
                  onClick={async () => {
                    if (!confirm(t('chat.delete_group_confirm_manage'))) return
                    try {
                      const r = await fetch(`/api/group_chat/${group_id}/delete`, {
                        method: 'POST', credentials: 'include'
                      })
                      const d = await r.json().catch(() => null)
                      if (d?.success) { navigate('/messages') }
                      else { alert(d?.error || t('chat.failed_delete_group')) }
                    } catch { alert(t('chat.failed_delete_group')) }
                  }}
                  className="w-full px-4 py-3 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition text-sm font-medium"
                >
                  <i className="fa-solid fa-trash-can mr-2" />
                  Delete Group
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Members Modal */}
      {showAddMembers && group && (
        <div
          className="fixed inset-0 bg-c-bg-overlay backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
          onClick={() => {
            setShowAddMembers(false)
            setSelectedNewMembers([])
            setAvailableMembers([])
            setMemberSearchQuery('')
            setExpandedCommunities(new Set())
          }}
        >
          <div
            className="w-full max-w-md bg-c-bg-surface rounded-2xl border border-c-border max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-c-border flex items-center justify-between flex-shrink-0">
              <div>
                <div className="font-semibold">{t('chat.add_members_action')}</div>
                <div className="text-xs text-c-text-tertiary">
                  {group.members.length}/5 members
                  {group.members.length >= 5 && ' (limit reached)'}
                </div>
              </div>
              <button
                onClick={() => {
                  setShowAddMembers(false)
                  setSelectedNewMembers([])
                  setAvailableMembers([])
                  setMemberSearchQuery('')
                  setExpandedCommunities(new Set())
                }}
                className="p-2 rounded-full hover:bg-c-hover-bg"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            {group.members.length >= 5 ? (
              <div className="p-6 text-center">
                <div className="w-16 h-16 bg-cpoint-turquoise/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <i className="fa-solid fa-users text-cpoint-turquoise text-2xl" />
                </div>
                <h3 className="text-c-text-primary font-medium mb-2">{t('chat.group_full_title')}</h3>
                <p className="text-c-text-tertiary text-sm mb-4">
                  Group chats are limited to 5 members. For larger groups, consider creating a community or sub-community.
                </p>
                <button
                  onClick={() => {
                    setShowAddMembers(false)
                    navigate('/create-community')
                  }}
                  className="px-4 py-2 bg-cpoint-turquoise text-black rounded-lg font-medium"
                >
                  Create Community
                </button>
              </div>
            ) : (
              <>
                {/* Search input */}
                <div className="p-3 border-b border-c-border flex-shrink-0">
                  <div className="relative">
                    <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-c-text-tertiary text-sm" />
                    <input
                      type="text"
                      placeholder={t('chat.search_members')}
                      value={memberSearchQuery}
                      onChange={(e) => setMemberSearchQuery(e.target.value)}
                      className="w-full bg-c-hover-bg border border-c-border rounded-lg pl-9 pr-3 py-2 text-sm text-c-text-primary placeholder-c-text-tertiary focus:outline-none focus:border-cpoint-turquoise/50"
                    />
                    {memberSearchQuery && (
                      <button
                        onClick={() => setMemberSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-c-text-tertiary hover:text-c-text-primary"
                      >
                        <i className="fa-solid fa-xmark text-sm" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Selected members */}
                {selectedNewMembers.length > 0 && (
                  <div className="p-3 border-b border-c-border flex-shrink-0">
                    <div className="text-xs text-c-text-tertiary mb-2">Selected ({selectedNewMembers.length})</div>
                    <div className="flex flex-wrap gap-2">
                      {selectedNewMembers.map((username) => (
                        <span
                          key={username}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-cpoint-turquoise/20 text-cpoint-turquoise rounded-full text-sm"
                        >
                          {username}
                          <button
                            onClick={() => setSelectedNewMembers(prev => prev.filter(u => u !== username))}
                            className="hover:text-c-text-primary"
                          >
                            <i className="fa-solid fa-xmark text-xs" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Available members grouped by community */}
                <div className="flex-1 overflow-y-auto min-h-0">
                  {loadingAvailable ? (
                    <div className="p-8 text-center">
                      <i className="fa-solid fa-spinner fa-spin text-cpoint-turquoise text-2xl" />
                      <p className="text-c-text-tertiary text-sm mt-2">{t('chat.loading_members')}</p>
                    </div>
                  ) : availableMembers.length > 0 ? (
                    <div className="p-2">
                      {(() => {
                        // Group members by community
                        const membersByCommunity = new Map<string, typeof availableMembers>()
                        const searchLower = memberSearchQuery.toLowerCase()
                        
                        availableMembers.forEach((user) => {
                          // Filter by search query
                          if (searchLower && 
                              !user.username.toLowerCase().includes(searchLower) &&
                              !(user.display_name || '').toLowerCase().includes(searchLower)) {
                            return
                          }
                          
                          const community = user.community_name || 'Other'
                          if (!membersByCommunity.has(community)) {
                            membersByCommunity.set(community, [])
                          }
                          membersByCommunity.get(community)!.push(user)
                        })
                        
                        // Sort communities alphabetically
                        const sortedCommunities = Array.from(membersByCommunity.entries())
                          .sort((a, b) => a[0].localeCompare(b[0]))
                        
                        if (sortedCommunities.length === 0) {
                          return (
                            <div className="p-6 text-center">
                              <p className="text-c-text-tertiary text-sm">{t('chat.no_members_match_search')}</p>
                            </div>
                          )
                        }
                        
                        return sortedCommunities.map(([communityName, members]) => {
                          const isExpanded = expandedCommunities.has(communityName) || memberSearchQuery.length > 0
                          
                          return (
                            <div key={communityName} className="mb-2">
                              {/* Community header - collapsible */}
                              <button
                                onClick={() => {
                                  setExpandedCommunities(prev => {
                                    const next = new Set(prev)
                                    if (next.has(communityName)) {
                                      next.delete(communityName)
                                    } else {
                                      next.add(communityName)
                                    }
                                    return next
                                  })
                                }}
                                className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-c-hover-bg transition"
                              >
                                <div className="flex items-center gap-2">
                                  <i className="fa-solid fa-users text-cpoint-turquoise text-sm" />
                                  <span className="font-medium text-sm">{communityName}</span>
                                  <span className="text-xs text-c-text-tertiary">({members.length})</span>
                                </div>
                                <i className={`fa-solid fa-chevron-${isExpanded ? 'up' : 'down'} text-xs text-c-text-tertiary`} />
                              </button>
                              
                              {/* Members list */}
                              {isExpanded && (
                                <div className="ml-2 mt-1 space-y-1">
                                  {members.map((user) => (
                                    <button
                                      key={user.username}
                                      className={`w-full flex items-center gap-3 p-2 rounded-lg transition ${
                                        selectedNewMembers.includes(user.username)
                                          ? 'bg-cpoint-turquoise/20'
                                          : 'hover:bg-c-hover-bg'
                                      }`}
                                      onClick={() => {
                                        if (selectedNewMembers.includes(user.username)) {
                                          setSelectedNewMembers(prev => prev.filter(u => u !== user.username))
                                        } else {
                                          if (group.members.length + selectedNewMembers.length + 1 > 5) {
                                            alert(t('chat.group_member_limit_short', { max: 5 }))
                                            return
                                          }
                                          setSelectedNewMembers(prev => [...prev, user.username])
                                        }
                                      }}
                                    >
                                      <Avatar
                                        username={user.username}
                                        url={user.profile_picture || undefined}
                                        size={36}
                                      />
                                      <div className="flex-1 min-w-0 text-left">
                                        <div className="font-medium text-sm truncate">{user.display_name || user.username}</div>
                                        <div className="text-xs text-c-text-tertiary">@{user.username}</div>
                                      </div>
                                      {selectedNewMembers.includes(user.username) && (
                                        <i className="fa-solid fa-check text-cpoint-turquoise" />
                                      )}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })
                      })()}
                    </div>
                  ) : (
                    <div className="p-6 text-center">
                      <div className="w-12 h-12 bg-c-active-bg rounded-full flex items-center justify-center mx-auto mb-3">
                        <i className="fa-solid fa-user-check text-c-text-tertiary" />
                      </div>
                      <p className="text-c-text-tertiary text-sm">
                        No available members to add
                      </p>
                    </div>
                  )}
                </div>

                {/* Add button */}
                {selectedNewMembers.length > 0 && (
                  <div className="p-4 border-t border-c-border flex-shrink-0">
                    <button
                      onClick={handleAddMembers}
                      disabled={addingMembers}
                      className="w-full px-4 py-3 bg-cpoint-turquoise text-black rounded-lg font-medium hover:brightness-95 transition disabled:opacity-50"
                    >
                      {addingMembers ? (
                        <><i className="fa-solid fa-spinner fa-spin mr-2" />Adding...</>
                      ) : (
                        <>Add {selectedNewMembers.length} Member{selectedNewMembers.length > 1 ? 's' : ''}</>
                      )}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <ChatMediaPreviewModal
        items={pendingMedia}
        previewIndex={previewIndex}
        onPreviewIndexChange={setPreviewIndex}
        onCancel={cancelMediaPreview}
        onRemove={removeMediaFromPreview}
        quality={mediaQuality}
        onQualityChange={handleMediaQualityChange}
        onSend={confirmSendMedia}
      />

      {/* Pasted image preview modal */}
      {pastedImagePreview && (
        <div 
          className="theme-always-dark fixed inset-0 bg-black z-[9999] flex flex-col"
          onClick={discardPastedImage}
        >
          {/* Header */}
          <div 
            className="flex items-center justify-between px-4 py-3 bg-black/80"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
          >
            <button
              onClick={discardPastedImage}
              className="text-white p-2 -ml-2"
            >
              <i className="fa-solid fa-xmark text-xl" />
            </button>
            <span className="text-white font-medium">{t('chat.send_image')}</span>
            <div className="w-8" />
          </div>

          {/* Image preview */}
          <div 
            className="flex-1 flex items-center justify-center overflow-hidden p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={pastedImagePreview}
              alt="Pasted image"
              className="max-w-full max-h-full object-contain rounded-lg"
            />
          </div>

          {/* Action buttons */}
          <div 
            className="flex items-center justify-center gap-4 px-4 py-4 bg-black/80"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation()
                discardPastedImage()
              }}
              className="flex-1 max-w-[140px] px-4 py-3 rounded-xl border border-white/20 text-white hover:bg-c-hover-bg text-sm font-medium flex items-center justify-center gap-2"
            >
              <i className="fa-regular fa-trash-can" />
              Discard
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                sendPastedImage()
              }}
              className="flex-1 max-w-[140px] px-4 py-3 rounded-xl bg-cpoint-turquoise text-black hover:brightness-110 text-sm font-medium flex items-center justify-center gap-2"
            >
              <i className="fa-solid fa-paper-plane" />
              Send
            </button>
          </div>
        </div>
      )}

      {/* Translate language picker modal */}
      {showLangPicker !== null && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={() => setShowLangPicker(null)}>
          <div className="absolute inset-0 bg-c-bg-overlay" />
          <div className="relative bg-c-bg-elevated rounded-2xl border border-c-border w-[80%] max-w-xs p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <i className="fa-solid fa-globe text-cpoint-turquoise" />
              <span className="text-c-text-primary font-semibold text-sm">{t('chat.translate_to')}</span>
            </div>
            <div className="space-y-1">
              {translateLanguages.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => handleTranslateSummary(showLangPicker, langPickerSummary, lang.code)}
                  className="w-full px-3 py-2 text-left text-sm text-c-text-primary hover:bg-c-hover-bg rounded-lg flex items-center gap-3"
                >
                  <span className="text-lg">{lang.flag}</span>
                  <span>{lang.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Edit Steve summary modal */}
      {editingSummaryId !== null && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={() => { setEditingSummaryId(null); setEditSummaryText('') }}>
          <div className="absolute inset-0 bg-c-bg-overlay" />
          <div 
            className="relative bg-c-bg-elevated rounded-2xl border border-c-border w-[90%] max-w-md p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <i className="fa-solid fa-wand-magic-sparkles text-cpoint-turquoise" />
            <span className="text-c-text-primary font-semibold text-sm">{t('chat.edit_summary')}</span>
            </div>
            <textarea
              value={editSummaryText}
              onChange={(e) => setEditSummaryText(e.target.value)}
              className="w-full bg-c-active-bg border border-c-border rounded-xl px-3 py-3 text-sm text-c-text-primary resize-none focus:outline-none focus:border-cpoint-turquoise leading-relaxed"
              rows={4}
              autoFocus
              placeholder={t('chat.edit_summary_placeholder')}
            />
            <div className="flex gap-2 mt-3 justify-end">
              <button
                onClick={() => { setEditingSummaryId(null); setEditSummaryText('') }}
                className="px-4 py-2 text-sm rounded-lg bg-c-active-bg text-c-text-secondary hover:bg-white/15"
              >{t('chat.cancel')}</button>
              <button
                onClick={() => handleSaveSummaryEdit(editingSummaryId)}
                className="px-4 py-2 text-sm rounded-lg bg-cpoint-turquoise text-black font-medium hover:brightness-110"
              >{t('chat.save')}</button>
            </div>
          </div>
        </div>
      )}

      <ChatMediaViewerModal
        viewer={viewingMedia}
        onClose={() => setViewingMedia(null)}
        onIndexChange={index => setViewingMedia(prev => (prev ? { ...prev, index } : null))}
        thumbStrip="dots"
        footer={
          <div
            className="flex items-center justify-center gap-4 px-4 py-4 bg-black/80"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
          >
            {viewingMedia?.messageId &&
            (viewingMedia.senderUsername === currentUsername ||
              group?.members.find(m => m.username === currentUsername)?.is_admin) ? (
              <button
                onClick={async () => {
                  if (!viewingMedia.messageId || deletingMedia) return
                  if (!confirm(t('chat.delete_media_message_confirm'))) return
                  setDeletingMedia(true)
                  try {
                    const r = await fetch(`/api/group_chat/${group_id}/message/${viewingMedia.messageId}/delete`, {
                      method: 'POST',
                      credentials: 'include',
                    })
                    const d = await r.json().catch(() => null)
                    if (d?.success) {
                      setViewingMedia(null)
                      loadMessages(true)
                    } else {
                      alert(d?.error || t('chat.failed_delete_media'))
                    }
                  } catch {
                    alert(t('chat.failed_delete_media'))
                  } finally {
                    setDeletingMedia(false)
                  }
                }}
                disabled={deletingMedia}
                className="px-6 py-3 bg-red-500/20 text-red-400 rounded-full font-medium hover:bg-red-500/30 transition disabled:opacity-50"
              >
                <i className="fa-solid fa-trash-can mr-2" />
                {deletingMedia ? 'Deleting...' : 'Delete'}
              </button>
            ) : null}
            <button
              onClick={() => setViewingMedia(null)}
              className="px-6 py-3 bg-c-active-bg text-white rounded-full font-medium hover:bg-white/20 transition"
            >
              Close
            </button>
          </div>
        }
      />

      <ChatThreadSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onJumpToMessage={handleSearchJump}
        threadType="group"
        threadId={group_id || ''}
        currentUser={currentUsername || ''}
      />

    </div>
  )
}
