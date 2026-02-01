import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import Avatar from '../components/Avatar'
import GifPicker from '../components/GifPicker'
import type { GifSelection } from '../components/GifPicker'
import { gifSelectionToFile } from '../utils/gif'
import { useAudioRecorder } from '../components/useAudioRecorder'
import LongPressActionable from '../chat/LongPressActionable'
import { formatDateLabel, getDateKey } from '../chat'
import { useUserProfile } from '../contexts/UserProfileContext'
import ZoomableImage from '../components/ZoomableImage'
import { sendGroupImageMessage, sendGroupVideoMessage } from '../chat/groupChatMediaSenders'
import type { UploadProgress } from '../chat/groupChatMediaSenders'

type Message = {
  id: number
  sender: string
  text: string | null
  image: string | null
  voice: string | null
  video?: string | null
  created_at: string
  profile_picture: string | null
  replySnippet?: string
  replySender?: string
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

export default function GroupChatThread() {
  const { group_id } = useParams()
  const navigate = useNavigate()
  const { profile: currentUserProfile } = useUserProfile()
  // Get username from profile context, with localStorage fallback
  const currentUsername = (currentUserProfile as { username?: string })?.username 
    || localStorage.getItem('current_username') 
    || ''
  const [group, setGroup] = useState<GroupInfo | null>(null)
  const [serverMessages, setServerMessages] = useState<Message[]>([])
  const [pendingMessages, setPendingMessages] = useState<(Message & { clientKey: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Combine server and pending messages for display
  const messages = [...serverMessages, ...pendingMessages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )
  // Use ref-based draft to avoid React state update issues
  const draftRef = useRef('')
  const [draftDisplay, setDraftDisplay] = useState('') // Only for UI updates (button visibility)
  const [sending, setSendingState] = useState(false)
  const sendingLockRef = useRef(false)
  
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
  const [gifPickerOpen, setGifPickerOpen] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const [reactions, setReactions] = useState<Record<number, string>>({})
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [editingSaving, setEditingSaving] = useState(false)
  const pendingDeletions = useRef<Set<number>>(new Set())
  const [steveIsTyping, setSteveIsTyping] = useState(false)
  
  // Reply state
  const [replyTo, setReplyTo] = useState<{ text: string; sender: string; image?: string; voice?: string } | null>(null)
  
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
    
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const lastMessageIdRef = useRef<number>(0)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const headerMenuRef = useRef<HTMLDivElement>(null)

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

  // Layout helpers - matching ChatThread exactly
  const safeBottom = 'env(safe-area-inset-bottom, 0px)'
  const defaultComposerPadding = 64
  const VISUAL_VIEWPORT_KEYBOARD_THRESHOLD = 48
  const NATIVE_KEYBOARD_MIN_HEIGHT = 60
  const KEYBOARD_OFFSET_EPSILON = 6
  const [composerHeight, setComposerHeight] = useState(defaultComposerPadding)
  const [safeBottomPx, setSafeBottomPx] = useState(0)
  const [viewportLift, setViewportLift] = useState(0)
  const [keyboardOffset, setKeyboardOffset] = useState(0)

  const composerRef = useRef<HTMLDivElement | null>(null)
  const composerCardRef = useRef<HTMLDivElement | null>(null)
  const keyboardOffsetRef = useRef(0)
  const viewportBaseRef = useRef<number | null>(null)

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

  // Composer height observer
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

    return () => {
      observer.disconnect()
    }
  }, [])

  // Safe bottom probe
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

  const effectiveComposerHeight = Math.max(composerHeight, defaultComposerPadding)
  const liftSource = Math.max(keyboardOffset, viewportLift)
  const keyboardLift = Math.max(0, liftSource - safeBottomPx)
  const showKeyboard = liftSource > 50
  const composerGapPx = 4

  const listPaddingBottom = showKeyboard
    ? `${effectiveComposerHeight + composerGapPx + keyboardLift}px`
    : `calc(${safeBottom} + ${effectiveComposerHeight + composerGapPx}px)`

  // Instant scroll - only used for initial load
  const scrollToBottom = useCallback(() => {
    const el = listRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [])
  
  // Always keep latest message visible - scroll instantly whenever messages change
  // Using useLayoutEffect to scroll BEFORE browser paints (prevents flicker)
  const lastVisibleMsgKeyRef = useRef<string | number | null>(null)
  
  useLayoutEffect(() => {
    if (messages.length === 0) return
    
    // Get the last message ID to detect changes
    const lastMsg = messages[messages.length - 1]
    const lastMsgKey = (lastMsg as any).clientKey || lastMsg.id
    
    // Only scroll if the last message changed (new message arrived)
    if (lastMsgKey !== lastVisibleMsgKeyRef.current) {
      lastVisibleMsgKeyRef.current = lastMsgKey
      // Instant scroll - no animation, happens before paint
      const el = listRef.current
      if (el) {
        el.scrollTop = el.scrollHeight
      }
    }
  }, [messages])
  
  // No scroll when sending messages - message just appears, older ones shift up

  const focusTextarea = useCallback(() => {
    if (MIC_ENABLED && recording) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
  }, [recording])

  // Visual viewport keyboard handling (web)
  useEffect(() => {
    if (!isMobile) return
    if (Capacitor.getPlatform() !== 'web') return
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
      const nextOffset = Math.max(0, baseHeight - currentHeight)
      const normalizedOffset = nextOffset < VISUAL_VIEWPORT_KEYBOARD_THRESHOLD ? 0 : nextOffset
      if (Math.abs(keyboardOffsetRef.current - normalizedOffset) < 5) return
      setViewportLift(prev => (Math.abs(prev - normalizedOffset) < 5 ? prev : normalizedOffset))
      keyboardOffsetRef.current = normalizedOffset
      setKeyboardOffset(normalizedOffset)
      if (normalizedOffset > 0) {
        requestAnimationFrame(scrollToBottom)
      }
    }

    const handleChange = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updateOffset)
    }

    viewport.addEventListener('resize', handleChange)
    handleChange()

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', handleChange)
    }
  }, [isMobile, scrollToBottom])

  // Native keyboard handling (Capacitor)
  useEffect(() => {
    if (Capacitor.getPlatform() === 'web') return
    let showSub: PluginListenerHandle | undefined
    let hideSub: PluginListenerHandle | undefined

    const normalizeHeight = (raw: number) => (raw < NATIVE_KEYBOARD_MIN_HEIGHT ? 0 : raw)

    const handleShow = (info: KeyboardInfo) => {
      const height = normalizeHeight(info?.keyboardHeight ?? 0)
      if (Math.abs(keyboardOffsetRef.current - height) < KEYBOARD_OFFSET_EPSILON) return
      keyboardOffsetRef.current = height
      setKeyboardOffset(height)
      requestAnimationFrame(scrollToBottom)
    }

    const handleHide = () => {
      if (Math.abs(keyboardOffsetRef.current) < KEYBOARD_OFFSET_EPSILON) return
      keyboardOffsetRef.current = 0
      setKeyboardOffset(0)
      requestAnimationFrame(scrollToBottom)
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
  }, [scrollToBottom])

  // Scroll on keyboard change
  useEffect(() => {
    if (liftSource < 0) return
    scrollToBottom()
    const t1 = setTimeout(scrollToBottom, 120)
    const t2 = setTimeout(scrollToBottom, 260)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [liftSource, scrollToBottom])

  useEffect(() => {
    const timer = setTimeout(scrollToBottom, 80)
    return () => clearTimeout(timer)
  }, [composerHeight, scrollToBottom])

  // Window resize handling
  useEffect(() => {
    let lastHeight = window.innerHeight

    const handleResize = () => {
      const newHeight = window.innerHeight
      if (newHeight !== lastHeight) {
        lastHeight = newHeight
        setTimeout(scrollToBottom, 50)
        setTimeout(scrollToBottom, 150)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [scrollToBottom])

  const loadGroup = useCallback(async () => {
    try {
      const response = await fetch(`/api/group_chat/${group_id}`, { credentials: 'include' })
      const data = await response.json()
      if (data.success) {
        setGroup(data.group)
      } else {
        setError(data.error || 'Failed to load group')
      }
    } catch (err) {
      console.error('Error loading group:', err)
      setError('Failed to load group')
    }
  }, [group_id])

  const loadMessages = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await fetch(`/api/group_chat/${group_id}/messages`, { credentials: 'include' })
      const data = await response.json()
      if (data.success) {
        const newServerMessages = (data.messages as Message[]).filter(
          m => !pendingDeletions.current.has(m.id)
        )
        const newMaxId = newServerMessages.length > 0 ? Math.max(...newServerMessages.map(m => m.id)) : 0

        // Simply set server messages - pending messages are separate, filter out pending deletions
        setServerMessages(newServerMessages)
        
        // Remove any pending messages that now exist on server (by matching text and time)
        setPendingMessages(prev => prev.filter(pending => {
          const matchesServer = newServerMessages.some(server => 
            server.text === pending.text &&
            Math.abs(new Date(server.created_at).getTime() - new Date(pending.created_at).getTime()) < 30000
          )
          return !matchesServer
        }))
        
        lastMessageIdRef.current = newMaxId
        
        // Update Steve typing indicator
        setSteveIsTyping(data.steve_is_typing === true)

        // No scroll on new messages - they just appear
      }
    } catch (err) {
      console.error('Error loading messages:', err)
      if (!silent) setError('Failed to load messages')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [group_id, scrollToBottom])

  // Update active presence (so push notifications are suppressed while viewing)
  const updatePresence = useCallback(() => {
    fetch(`/api/group_chat/${group_id}/presence`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {})  // Ignore errors - this is optional
  }, [group_id])

  useEffect(() => {
    loadGroup()
    loadMessages()
    updatePresence()  // Initial presence ping

    // Poll messages and update presence
    pollingRef.current = setInterval(() => {
      loadMessages(true)
      updatePresence()
    }, 3000)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [loadGroup, loadMessages, updatePresence])

  const handleSend = useCallback(() => {
    // Get text directly from textarea (uncontrolled)
    const text = (textareaRef.current?.value || '').trim()
    
    // Use ref for synchronous check to prevent double-sends
    if (!text || sendingLockRef.current) return

    // Lock immediately (synchronous) to prevent double-clicks
    sendingLockRef.current = true
    
    // Capture reply state before clearing
    const replySnapshot = replyTo
    
    // CLEAR COMPOSER IMMEDIATELY
    if (textareaRef.current) {
      textareaRef.current.value = ''
    }
    draftRef.current = ''
    setDraftDisplay('')
    setReplyTo(null)
    
    // Format message with reply if needed
    let formattedMessage = text
    let replySnippet: string | undefined
    if (replySnapshot) {
      if (replySnapshot.image) {
        replySnippet = `📷|${replySnapshot.image}|${(replySnapshot.text || 'Photo').slice(0, 60)}`
      } else if (replySnapshot.voice) {
        replySnippet = '🎤|Voice message'
      } else {
        replySnippet = replySnapshot.text.length > 90 ? replySnapshot.text.slice(0, 90) + '…' : replySnapshot.text
      }
      formattedMessage = `[REPLY:${replySnapshot.sender}:${replySnippet}]\n${text}`
    }
    
    // Create pending message (show clean text, not formatted)
    const now = new Date().toISOString()
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const pendingMessage: Message & { clientKey: string; replySnippet?: string; replySender?: string } = {
      id: -Date.now(),
      sender: currentUsername || 'You',
      text: text,
      image: null,
      voice: null,
      created_at: now,
      profile_picture: null,
      clientKey: tempId,
      replySnippet: replySnippet,
      replySender: replySnapshot?.sender,
    }
    
    // Add to pending messages - this is a SEPARATE state, always visible
    setPendingMessages(prev => [...prev, pendingMessage as any])

    // Send to server (with formatted message including reply)
    fetch(`/api/group_chat/${group_id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ message: formattedMessage }),
    })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          // SUCCESS: Remove from pending (server will have it on next poll)
          setPendingMessages(prev => prev.filter(m => m.clientKey !== tempId))
          lastMessageIdRef.current = Math.max(lastMessageIdRef.current, data.message.id)
          // Trigger immediate poll to get the server message
          loadMessages(true)
        } else {
          // FAILURE: Remove from pending
          setPendingMessages(prev => prev.filter(m => m.clientKey !== tempId))
          console.error('Failed to send:', data.error)
        }
      })
      .catch(err => {
        // ERROR: Remove from pending
        setPendingMessages(prev => prev.filter(m => m.clientKey !== tempId))
        console.error('Error sending message:', err)
      })
      .finally(() => {
        sendingLockRef.current = false
      })
  }, [group_id, scrollToBottom, currentUsername, loadMessages, replyTo])

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

  const handlePhotoSelect = () => {
    setShowAttachMenu(false)
    fileInputRef.current?.click()
  }

  const handleCameraOpen = () => {
    setShowAttachMenu(false)
    cameraInputRef.current?.click()
  }
  
  const handleVideoSelect = () => {
    setShowAttachMenu(false)
    videoInputRef.current?.click()
  }

  // Show image preview before sending
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    // Check if it's an image
    if (file.type.startsWith('image/')) {
      // Show preview modal
      const previewUrl = URL.createObjectURL(file)
      setPreviewImage(previewUrl)
      setPendingImageFile(file)
    }
    
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (cameraInputRef.current) cameraInputRef.current.value = ''
  }
  
  // Handle video file selection
  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !group_id) return
    
    // Send video directly (no preview for videos)
    sendGroupVideoMessage({
      file,
      groupId: group_id,
      currentUsername,
      setServerMessages,
      setPendingMessages,
      loadMessages,
      onProgress: setUploadProgress,
      onError: (msg) => alert(msg),
      onComplete: () => {
        setUploadProgress(null)
        if (videoInputRef.current) videoInputRef.current.value = ''
      },
    })
    
    if (videoInputRef.current) videoInputRef.current.value = ''
  }
  
  // Confirm and send the previewed image
  const confirmSendImage = async () => {
    if (!pendingImageFile || !group_id) return
    
    const file = pendingImageFile
    
    // Clear preview immediately
    if (previewImage?.startsWith('blob:')) {
      try { URL.revokeObjectURL(previewImage) } catch {}
    }
    setPreviewImage(null)
    setPendingImageFile(null)
    
    // Send using modular sender
    setUploadingMedia(true)
    await sendGroupImageMessage({
      file,
      kind: 'photo',
      groupId: group_id,
      currentUsername,
      setServerMessages,
      setPendingMessages,
      loadMessages,
      onProgress: setUploadProgress,
      onError: (msg) => alert(msg),
      onComplete: () => {
        setUploadingMedia(false)
        setUploadProgress(null)
      },
    })
  }
  
  // Cancel image preview
  const cancelImagePreview = () => {
    if (previewImage?.startsWith('blob:')) {
      try { URL.revokeObjectURL(previewImage) } catch {}
    }
    setPreviewImage(null)
    setPendingImageFile(null)
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
        setPendingMessages,
        loadMessages,
        onProgress: setUploadProgress,
        onError: (msg) => alert(msg),
        onComplete: () => {
          setUploadingMedia(false)
          setUploadProgress(null)
        },
      })
    } catch (err) {
      console.error('Error sending GIF:', err)
      alert('Failed to send GIF. Please try again.')
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
        const response = await fetch(`/api/group_chat/${group_id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ voice: uploadData.audio_path }),
        })
        const data = await response.json()

        if (data.success) {
          setServerMessages(prev => [...prev, data.message])
          lastMessageIdRef.current = data.message.id
        }
      }

      if (previewData.url) {
        try { URL.revokeObjectURL(previewData.url) } catch {}
      }
    } catch (err) {
      console.error('Error sending voice:', err)
    } finally {
      setSending(false)
    }
  }

  const sendRecordingPreview = async () => {
    if (!recordingPreview?.blob) return
    
    setSending(true)
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
        const response = await fetch(`/api/group_chat/${group_id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ voice: uploadData.audio_path }),
        })
        const data = await response.json()

        if (data.success) {
          setServerMessages(prev => [...prev, data.message])
          lastMessageIdRef.current = data.message.id
        }
      }

      cancelRecordingPreview()
      setPreviewPlaying(false)
    } catch (err) {
      console.error('Error sending voice:', err)
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
    if (!confirm('Are you sure you want to leave this group chat?')) return

    try {
      const response = await fetch(`/api/group_chat/${group_id}/leave`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json()

      if (data.success) {
        navigate('/user_chat')
      } else {
        alert(data.error || 'Failed to leave group')
      }
    } catch (err) {
      console.error('Error leaving group:', err)
      alert('Failed to leave group')
    }
  }

  // Load available community members for adding to group
  const loadAvailableMembers = async () => {
    setLoadingAvailable(true)
    try {
      const response = await fetch(`/api/group_chat/${group_id}/available_members`, {
        credentials: 'include',
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
      alert('Group chats are limited to 5 members. For larger groups, consider creating a community or sub-community.')
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
          alert(`Group chats are limited to ${data.max_members} members. For larger groups, consider creating a community or sub-community.`)
        } else {
          alert(data.error || 'Failed to add members')
        }
      }
    } catch (err) {
      console.error('Error adding members:', err)
      alert('Failed to add members')
    } finally {
      setAddingMembers(false)
    }
  }

  const formatTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      const now = new Date()
      const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

      if (diffDays === 0) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      } else if (diffDays === 1) {
        return 'Yesterday'
      } else if (diffDays < 7) {
        return date.toLocaleDateString([], { weekday: 'short' })
      }
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    } catch {
      return ''
    }
  }

  // Render text with @mentions highlighted in turquoise
  const renderTextWithMentions = (text: string) => {
    if (!text) return null
    
    // Pattern to match @username (letters, numbers, underscores)
    const mentionPattern = /(@\w+)/g
    const parts = text.split(mentionPattern)
    
    return parts.map((part, index) => {
      if (part.match(/^@\w+$/)) {
        // This is a mention - style it in turquoise
        return (
          <span key={index} className="text-[#4db6ac] font-medium">
            {part}
          </span>
        )
      }
      return part
    })
  }

  // Message action handlers
  const handleReaction = (messageId: number, emoji: string) => {
    setReactions(prev => {
      if (prev[messageId] === emoji) {
        // Remove reaction if same emoji
        const { [messageId]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [messageId]: emoji }
    })
  }

  const handleCopyMessage = (text: string | null) => {
    if (text) {
      navigator.clipboard.writeText(text).catch(() => {})
    }
  }

  const handleDeleteMessage = async (messageId: number, messageData: Message) => {
    if (!confirm('Are you sure you want to delete this message?')) return
    
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
        alert(data.error || 'Failed to delete message')
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
      alert('Network error. Could not delete message.')
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
    
    // Optimistically update the message
    setServerMessages(prev => prev.map(m => 
      m.id === editingId ? { ...m, text: newText } : m
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
        setEditingId(null)
        setEditText('')
      } else {
        // Restore the old text
        setServerMessages(prev => prev.map(m => 
          m.id === editingId ? { ...m, text: oldMessage.text } : m
        ))
        alert(data.error || 'Failed to edit message')
      }
    } catch (err) {
      console.error('Error editing message:', err)
      setServerMessages(prev => prev.map(m => 
        m.id === editingId ? { ...m, text: oldMessage.text } : m
      ))
      alert('Network error. Could not edit message.')
    } finally {
      setEditingSaving(false)
    }
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditText('')
  }

  if (loading && !group) {
    return (
      <div className="min-h-screen chat-thread-bg text-white flex items-center justify-center">
        <div className="text-[#9fb0b5]">
          <i className="fa-solid fa-spinner fa-spin mr-2" />
          Loading...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen chat-thread-bg text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 mb-4">{error}</div>
          <button
            onClick={() => navigate('/user_chat')}
            className="px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20"
          >
            Back to Messages
          </button>
        </div>
      </div>
    )
  }

  return (
    <div 
      className="text-white chat-thread-bg"
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
            onClick={() => navigate('/user_chat')} 
            aria-label="Back to Messages"
          >
            <i className="fa-solid fa-arrow-left text-white" />
          </button>
          <div className="w-9 h-9 rounded-full bg-[#4db6ac]/20 flex items-center justify-center">
            <i className="fa-solid fa-users text-[#4db6ac] text-sm" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate text-white text-sm">
              {group?.name || 'Group Chat'}
            </div>
            <div className="text-xs text-[#9fb0b5]">
              {group?.members.length} members
            </div>
          </div>
          <button 
            type="button"
            className="p-2 rounded-full hover:bg-white/10 transition-colors" 
            aria-label="More options"
            aria-haspopup="true"
            aria-expanded={headerMenuOpen}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              setHeaderMenuOpen(prev => !prev)
            }}
          >
            <i className="fa-solid fa-ellipsis-vertical text-white/70" />
          </button>
          {headerMenuOpen && (
            <div
              ref={headerMenuRef}
              className="absolute right-3 top-full mt-2 z-[10020] w-48"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="rounded-xl border border-white/10 bg-[#111111] shadow-lg shadow-black/40 py-1">
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/10 transition-colors"
                  onClick={() => {
                    setHeaderMenuOpen(false)
                    setShowMembers(true)
                  }}
                >
                  <i className="fa-solid fa-users text-xs text-[#4db6ac]" />
                  <span>View Members</span>
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/10 transition-colors"
                  onClick={() => {
                    setHeaderMenuOpen(false)
                    setShowAddMembers(true)
                    loadAvailableMembers()
                  }}
                >
                  <i className="fa-solid fa-user-plus text-xs text-[#4db6ac]" />
                  <span>Add Members</span>
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-white/10 transition-colors"
                  onClick={() => {
                    setHeaderMenuOpen(false)
                    handleLeave()
                  }}
                >
                  <i className="fa-solid fa-arrow-right-from-bracket text-xs" />
                  <span>Leave Group</span>
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
        }}
      >
        <div className="mx-auto flex max-w-3xl w-full flex-1 flex-col min-h-0">
          {/* Messages List */}
          <div
            ref={listRef}
            className="flex-1 space-y-[9px] overflow-y-auto overflow-x-hidden text-white px-1 sm:px-2"
            style={{
              WebkitOverflowScrolling: 'touch',
              overscrollBehaviorY: 'auto',
              paddingBottom: listPaddingBottom,
              minHeight: 0,
            } as CSSProperties}
          >
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-[#9fb0b5]">
                <i className="fa-solid fa-comments text-4xl mb-3 opacity-50" />
                <div className="text-sm">No messages yet</div>
                <div className="text-xs mt-1">Send a message to start the conversation</div>
              </div>
            ) : (
              <div className="space-y-3 py-3">
                {messages.map((msg, idx) => {
                  const msgWithKey = msg as Message & { clientKey?: string; replySnippet?: string; replySender?: string }
                  const showAvatar = idx === 0 || messages[idx - 1].sender !== msg.sender
                  const showTime = showAvatar || (idx > 0 && 
                    new Date(msg.created_at).getTime() - new Date(messages[idx-1].created_at).getTime() > 60000)
                  const messageReaction = reactions[msg.id]
                  // Check if this is a pending message (not yet confirmed by server)
                  const isPending = pendingMessages.some(p => p.clientKey === msgWithKey.clientKey)
                  const isOptimistic = isPending || msgWithKey.clientKey?.startsWith('temp_') || msg.id < 0
                  // Determine if message is sent by current user
                  // Compare case-insensitively and trim whitespace
                  const senderNormalized = (msg.sender || '').toLowerCase().trim()
                  const currentUserNormalized = (currentUsername || '').toLowerCase().trim()
                  const isSentByMe = isOptimistic || (senderNormalized !== '' && currentUserNormalized !== '' && senderNormalized === currentUserNormalized)
                  
                  // Parse reply information from message text
                  let displayText = msg.text
                  let replySnippet = msgWithKey.replySnippet
                  let replySender = msgWithKey.replySender
                  
                  if (displayText && !replySnippet) {
                    const replyMatch = displayText.match(/^\[REPLY:([^:]+):([^\]]+)\]\n(.*)$/s)
                    if (replyMatch) {
                      replySender = replyMatch[1]
                      replySnippet = replyMatch[2]
                      displayText = replyMatch[3]
                    }
                  }
                  
                  // Date separator logic - matching ChatThread
                  const messageDate = getDateKey(msg.created_at)
                  const prevMessageDate = idx > 0 ? getDateKey(messages[idx - 1].created_at) : null
                  const showDateSeparator = messageDate !== prevMessageDate

                  return (
                    <div key={msgWithKey.clientKey || msg.id}>
                      {showDateSeparator && (
                        <div className="flex justify-center my-3">
                          <div className="liquid-glass-chip px-3 py-1 text-xs text-white/80 border">
                            {formatDateLabel(msg.created_at)}
                          </div>
                        </div>
                      )}
                      <div className={`flex gap-2 ${showAvatar ? 'mt-4 first:mt-0' : 'mt-0.5'} ${isSentByMe ? 'flex-row-reverse' : ''} ${isOptimistic ? 'opacity-70' : ''}`}>
                      <div className="w-8 flex-shrink-0">
                        {showAvatar && msg.sender && !isSentByMe && (
                          <Avatar
                            username={msg.sender}
                            url={msg.profile_picture || undefined}
                            size={32}
                            linkToProfile
                          />
                        )}
                      </div>
                      <div className={`flex-1 min-w-0 ${isSentByMe ? 'flex flex-col items-end' : ''}`}>
                        {showAvatar && msg.sender && !isSentByMe && (
                          <div className="flex items-baseline gap-2 mb-0.5">
                            <span className="text-sm font-medium text-white/90">{msg.sender}</span>
                            <span className="text-[11px] text-[#9fb0b5]">{formatTime(msg.created_at)}</span>
                          </div>
                        )}
                        <div className={`flex items-end gap-2 ${isSentByMe ? 'flex-row-reverse' : ''}`}>
                          <LongPressActionable
                            onReact={(emoji) => handleReaction(msg.id, emoji)}
                            onReply={() => {
                              setReplyTo({
                                text: msg.text || '',
                                sender: isSentByMe ? 'You' : msg.sender,
                                image: msg.image || undefined,
                                voice: msg.voice || undefined,
                              })
                              focusTextarea()
                            }}
                            onCopy={() => handleCopyMessage(msg.text)}
                            onDelete={() => handleDeleteMessage(msg.id, msg)}
                            onEdit={isSentByMe && msg.text && !msg.image && !msg.voice ? () => handleStartEdit(msg.id, msg.text || '') : undefined}
                            disabled={isOptimistic || editingId === msg.id}
                          >
                            <div className={`relative ${messageReaction ? 'mb-5' : ''}`}>
                              {editingId === msg.id ? (
                                <div className="flex flex-col gap-2 max-w-[280px]">
                                  <textarea
                                    value={editText}
                                    onChange={(e) => setEditText(e.target.value)}
                                    className="w-full bg-white/10 border border-[#4db6ac] rounded-lg px-3 py-2 text-[14px] text-white resize-none focus:outline-none"
                                    rows={3}
                                    autoFocus
                                  />
                                  <div className="flex gap-2 justify-end">
                                    <button
                                      onClick={handleCancelEdit}
                                      className="px-3 py-1 text-xs text-white/60 hover:text-white"
                                      disabled={editingSaving}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      onClick={handleSaveEdit}
                                      disabled={editingSaving || !editText.trim()}
                                      className="px-3 py-1 text-xs bg-[#4db6ac] text-black rounded-lg disabled:opacity-50"
                                    >
                                      {editingSaving ? <i className="fa-solid fa-spinner fa-spin" /> : 'Save'}
                                    </button>
                                  </div>
                                </div>
                              ) : (displayText || replySnippet) && (
                                <div className={`rounded-2xl max-w-[280px] ${isSentByMe ? 'rounded-br-lg' : 'rounded-bl-lg'} ${
                                  isOptimistic 
                                    ? 'bg-[#4db6ac]/40 border border-[#4db6ac]/30' 
                                    : `liquid-glass-bubble ${isSentByMe ? 'liquid-glass-bubble--sent' : 'liquid-glass-bubble--received'}`
                                }`}>
                                  {/* Reply snippet */}
                                  {replySnippet && (
                                    <div className="px-3 pt-2 pb-1 border-b border-white/10">
                                      <div className="flex items-stretch gap-0 bg-black/20 rounded overflow-hidden">
                                        <div className="w-0.5 bg-[#4db6ac] flex-shrink-0" />
                                        <div className="px-2 py-1 min-w-0">
                                          <div className="text-[10px] text-[#4db6ac] font-medium truncate">
                                            {replySender}
                                          </div>
                                          <div className="text-[11px] text-white/60 truncate">
                                            {replySnippet.startsWith('📷|') ? (
                                              <span className="flex items-center gap-1">
                                                <i className="fa-solid fa-image text-[9px]" /> Photo
                                              </span>
                                            ) : replySnippet.startsWith('🎤|') ? (
                                              <span className="flex items-center gap-1">
                                                <i className="fa-solid fa-microphone text-[9px]" /> Voice message
                                              </span>
                                            ) : (
                                              replySnippet
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                  {displayText && (
                                    <div className="text-[14px] text-white whitespace-pre-wrap break-words px-3 py-2">
                                      {renderTextWithMentions(displayText)}
                                      {isOptimistic && (
                                        <span className="ml-2 text-[10px] text-white/60">
                                          <i className="fa-solid fa-clock text-[8px] mr-1" />
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                              {msg.image && (
                                <img
                                  src={msg.image.startsWith('http') ? msg.image : msg.image}
                                  alt="Shared image"
                                  className="mt-1 max-w-[280px] rounded-lg"
                                />
                              )}
                              {msg.video && (
                                <video
                                  src={msg.video.startsWith('http') ? msg.video : msg.video}
                                  controls
                                  playsInline
                                  className="mt-1 max-w-[280px] rounded-lg"
                                />
                              )}
                              {msg.voice && (
                                <div className="mt-1 max-w-[280px]">
                                  <audio
                                    controls
                                    className="w-full h-10"
                                    style={{ 
                                      filter: 'invert(1) hue-rotate(180deg)',
                                      borderRadius: '8px'
                                    }}
                                  >
                                    <source 
                                      src={msg.voice.startsWith('http') ? msg.voice : msg.voice} 
                                      type={msg.voice.includes('.mp4') ? 'audio/mp4' : 'audio/webm'} 
                                    />
                                  </audio>
                                </div>
                              )}
                              {/* Reaction display */}
                              {messageReaction && (
                                <div 
                                  className="absolute -bottom-5 left-0 bg-[#1a1a1a] border border-white/10 rounded-full px-1.5 py-0.5 text-sm cursor-pointer hover:bg-white/10"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleReaction(msg.id, messageReaction)
                                  }}
                                >
                                  {messageReaction}
                                </div>
                              )}
                            </div>
                          </LongPressActionable>
                          {!showAvatar && showTime && (
                            <span className="text-[10px] text-[#9fb0b5]/60 flex-shrink-0 pb-0.5">
                              {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    </div>
                  )
                })}
                {/* Steve is typing indicator */}
                {steveIsTyping && (
                  <div className="flex items-center gap-3 px-3 py-2 mb-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#4db6ac] to-[#26a69a] flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-xs font-bold">S</span>
                    </div>
                    <div className="bg-white/10 rounded-2xl rounded-bl-lg px-4 py-2">
                      <div className="flex items-center gap-1">
                        <span className="text-white/70 text-sm">Steve is typing</span>
                        <span className="flex gap-0.5">
                          <span className="w-1.5 h-1.5 bg-[#4db6ac] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1.5 h-1.5 bg-[#4db6ac] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1.5 h-1.5 bg-[#4db6ac] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} className="h-1" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ====== COMPOSER - FIXED AT BOTTOM ====== */}
      <div
        ref={composerRef}
        className="fixed left-0 right-0"
        style={{
          bottom: showKeyboard ? `${keyboardLift}px` : 0,
          zIndex: 1000,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Composer card */}
        <div
          ref={composerCardRef}
          className="relative max-w-3xl w-[calc(100%-24px)] mx-auto rounded-[16px] px-2 sm:px-2.5 py-2.5 sm:py-3"
          style={{
            background: '#0a0a0c',
            marginBottom: 0,
          }}
        >
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
                className="absolute z-50 bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-xl overflow-hidden min-w-[190px]"
                style={{
                  touchAction: 'manipulation',
                  bottom: 'calc(100% + 8px)',
                  left: 0,
                }}
              >
                <button
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2.5 sm:gap-3 hover:bg-white/5 active:bg-white/10 transition-colors text-left"
                  onClick={handlePhotoSelect}
                >
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-image text-[#4db6ac] text-sm sm:text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-white font-medium text-sm sm:text-base">Photos</div>
                    <div className="text-white/60 text-[10px] sm:text-xs">Send from gallery</div>
                  </div>
                </button>
                <button
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2.5 sm:gap-3 hover:bg-white/5 active:bg-white/10 transition-colors text-left"
                  onClick={handleCameraOpen}
                >
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-camera text-[#4db6ac] text-sm sm:text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-white font-medium text-sm sm:text-base">Camera</div>
                    <div className="text-white/60 text-[10px] sm:text-xs">Take a photo</div>
                  </div>
                </button>
                <button
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2.5 sm:gap-3 hover:bg-white/5 active:bg-white/10 transition-colors text-left"
                  onClick={handleVideoSelect}
                >
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-video text-[#4db6ac] text-sm sm:text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-white font-medium text-sm sm:text-base">Video</div>
                    <div className="text-white/60 text-[10px] sm:text-xs">Send from gallery</div>
                  </div>
                </button>
                <button
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2.5 sm:gap-3 hover:bg-white/5 active:bg-white/10 transition-colors text-left"
                  onClick={() => { setShowAttachMenu(false); setGifPickerOpen(true) }}
                >
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-images text-[#4db6ac] text-sm sm:text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-white font-medium text-sm sm:text-base">GIF</div>
                    <div className="text-white/60 text-[10px] sm:text-xs">Powered by GIPHY</div>
                  </div>
                </button>
              </div>
            </>
          )}

          {/* Reply preview */}
          {replyTo && (
            <div className="mb-2 flex items-stretch gap-0 bg-white/5 rounded-lg overflow-hidden">
              {/* Left accent bar */}
              <div className="w-1 bg-[#4db6ac] flex-shrink-0" />
              <div className="flex-1 px-3 py-2 min-w-0 flex items-center gap-2">
                {/* Media thumbnail preview */}
                {replyTo.image && (
                  <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0 bg-black/30">
                    <img 
                      src={replyTo.image.startsWith('http') ? replyTo.image : replyTo.image} 
                      alt="Photo" 
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                {replyTo.voice && !replyTo.image && (
                  <div className="w-10 h-10 rounded bg-black/30 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-microphone text-white/60 text-sm" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-[#4db6ac] font-medium truncate">
                    {replyTo.sender}
                  </div>
                  <div className="text-[13px] text-white/70 line-clamp-1 mt-0.5">
                    {replyTo.voice ? (
                      <span className="flex items-center gap-1">
                        <i className="fa-solid fa-microphone text-xs" />
                        Voice message
                      </span>
                    ) : replyTo.image && !replyTo.text ? (
                      <span className="flex items-center gap-1">
                        <i className="fa-solid fa-image text-xs" />
                        Photo
                      </span>
                    ) : (
                      replyTo.text
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="px-3 flex items-center justify-center hover:bg-white/5"
              >
                <i className="fa-solid fa-xmark text-white/40" />
              </button>
            </div>
          )}

          {/* @mention autocomplete dropdown - positioned above composer */}
          {mentionQuery !== null && filteredMentions.length > 0 && (
            <div 
              ref={mentionDropdownRef}
              className="mb-2 bg-[#1a1a2e] border border-white/20 rounded-lg shadow-xl max-h-48 overflow-y-auto"
            >
              {filteredMentions.map((member) => (
                <button
                  key={member.username}
                  className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-white/10 active:bg-white/20 text-left transition-colors"
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
                  <span className="text-white text-sm font-medium">@{member.username}</span>
                </button>
              ))}
            </div>
          )}

          {/* Message input row */}
          <div className="flex items-end gap-2">
            {/* Plus/Attachment button */}
            <button
              className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-[14px] bg-white/12 hover:bg-white/22 active:bg-white/28 active:scale-95 transition-all cursor-pointer select-none"
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setShowAttachMenu(!showAttachMenu)
              }}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setShowAttachMenu(!showAttachMenu)
              }}
              style={{
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
                WebkitUserSelect: 'none',
                userSelect: 'none',
              } as CSSProperties}
            >
              <i className={`fa-solid text-white text-base sm:text-lg transition-transform duration-200 pointer-events-none ${
                showAttachMenu ? 'fa-xmark rotate-90' : 'fa-plus'
              }`} />
            </button>

            {/* Hidden file inputs */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
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
              onChange={handleVideoChange}
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

            {/* Uploading indicator with progress */}
            {uploadingMedia && (
              <div className="flex items-center gap-1.5 flex-shrink-0 pr-2">
                <i className="fa-solid fa-spinner fa-spin text-[#4db6ac]" />
                <span className="text-[#4db6ac] text-xs">
                  {uploadProgress?.message || 'Uploading...'}
                </span>
              </div>
            )}

            {/* Message input container */}
            <div
              className="flex-1 flex items-center rounded-lg bg-white/8 overflow-hidden relative"
              style={{
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent'
              }}
              onPointerDown={focusTextarea}
            >
              {/* Recording sound bar */}
              {MIC_ENABLED && recording && (
                <div className="flex-1 flex items-center px-3 py-2 gap-2">
                  <div className="flex-1 h-2 bg-white/10 rounded overflow-hidden">
                    <div className="h-full bg-[#7fe7df] transition-all" style={{ width: `${Math.max(6, Math.min(96, (level||0)*100))}%` }} />
                  </div>
                  <div className="text-sm font-mono text-white tabular-nums flex-shrink-0 min-w-[45px] text-right">
                    {formatRecordingTime(recordMs || 0)}
                  </div>
                </div>
              )}

              {/* Voice preview - WhatsApp style */}
              {MIC_ENABLED && !recording && recordingPreview && (
                <div className="flex-1 flex items-center px-2 py-1.5 gap-2">
                  <button
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      cancelRecordingPreview()
                      setPreviewPlaying(false)
                    }}
                    className="w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center text-red-400 hover:bg-red-500/20 transition-colors active:scale-95"
                    aria-label="Delete recording"
                    style={{ touchAction: 'manipulation' }}
                  >
                    <i className="fa-solid fa-trash text-sm pointer-events-none" />
                  </button>
                  <button
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      togglePreviewPlayback()
                    }}
                    className="w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center bg-[#4db6ac] text-white hover:bg-[#45a99c] transition-colors active:scale-95"
                    aria-label={previewPlaying ? 'Pause' : 'Play'}
                    style={{ touchAction: 'manipulation' }}
                  >
                    <i className={`fa-solid ${previewPlaying ? 'fa-pause' : 'fa-play'} text-sm pointer-events-none ${!previewPlaying ? 'ml-0.5' : ''}`} />
                  </button>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
                      <div className="h-full bg-[#4db6ac] w-full" />
                    </div>
                    <span className="text-xs text-white/70 tabular-nums flex-shrink-0">
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
                  className="flex-1 bg-transparent px-3 sm:px-3.5 py-2 text-[15px] text-white placeholder-white/50 outline-none resize-none max-h-24 min-h-[38px]"
                  placeholder="Message"
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
                  onPointerDown={() => {
                    focusTextarea()
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault()
                    focusTextarea()
                  }}
                  onInput={(e) => {
                    // Track draft for button visibility only
                    const textarea = e.target as HTMLTextAreaElement
                    const val = textarea.value
                    draftRef.current = val
                    setDraftDisplay(val)
                    
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
                />
              )}
            </div>

            {/* Mic button - shown when not recording, no preview, no text, and not sending */}
            {MIC_ENABLED && !recording && !recordingPreview && !draftDisplay.trim() && !sending && (
              <button
                className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-[14px] bg-white/12 hover:bg-white/22 active:bg-white/28 active:scale-95 text-white/80 transition-all cursor-pointer select-none"
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  checkMicrophonePermission()
                }}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  checkMicrophonePermission()
                }}
                aria-label="Start voice message"
                style={{
                  touchAction: 'manipulation',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <i className="fa-solid fa-microphone text-base pointer-events-none" />
              </button>
            )}

            {/* Recording controls - Pause + Send */}
            {MIC_ENABLED && recording && (
              <>
                <button
                  className="w-10 h-10 flex-shrink-0 rounded-[14px] flex items-center justify-center bg-white/15 hover:bg-white/25 text-white transition-colors active:scale-95"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    stopVoiceRecording()
                  }}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    stopVoiceRecording()
                  }}
                  aria-label="Pause recording"
                  style={{
                    touchAction: 'manipulation',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <i className="fa-solid fa-pause text-base pointer-events-none" />
                </button>
                <button
                  className="w-10 h-10 flex-shrink-0 rounded-[14px] flex items-center justify-center bg-[#4db6ac] text-white hover:bg-[#45a99c] transition-colors active:scale-95"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    sendVoiceDirectly()
                  }}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    sendVoiceDirectly()
                  }}
                  aria-label="Send voice message"
                  style={{
                    touchAction: 'manipulation',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <i className="fa-solid fa-paper-plane text-base pointer-events-none" />
                </button>
              </>
            )}

            {/* Preview controls - Send button */}
            {MIC_ENABLED && !recording && recordingPreview && (
              <button
                className="w-10 h-10 flex-shrink-0 rounded-[14px] flex items-center justify-center bg-[#4db6ac] text-white hover:bg-[#45a99c] transition-colors active:scale-95"
                onPointerDown={(e) => {
                  if (sending) return
                  e.preventDefault()
                  e.stopPropagation()
                  sendRecordingPreview()
                }}
                onClick={(e) => {
                  if (sending) return
                  e.preventDefault()
                  e.stopPropagation()
                  sendRecordingPreview()
                }}
                disabled={sending}
                aria-label="Send voice message"
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

            {/* Normal send button - show when there's text OR when sending */}
            {!(MIC_ENABLED && (recording || recordingPreview)) && (draftDisplay.trim() || sending || !MIC_ENABLED) && (
              <button
                className={`w-10 h-10 flex-shrink-0 rounded-[14px] flex items-center justify-center ${
                  sending
                    ? 'bg-gray-600 text-gray-300 cursor-not-allowed'
                    : draftDisplay.trim()
                      ? 'bg-[#4db6ac] text-black'
                      : 'bg-white/12 text-white/70'
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
                aria-label="Send"
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
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
          onClick={() => setShowMembers(false)}
        >
          <div
            className="w-full max-w-sm bg-[#1a1a1a] rounded-2xl border border-white/10 max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <div className="font-semibold">{group.name}</div>
                <div className="text-xs text-[#9fb0b5]">{group.members.length} members</div>
              </div>
              <button
                onClick={() => setShowMembers(false)}
                className="p-2 rounded-full hover:bg-white/5"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="p-4 max-h-[50vh] overflow-y-auto">
              <div className="text-xs text-[#9fb0b5] uppercase tracking-wide mb-3">Members</div>
              <div className="space-y-2">
                {group.members.map((member) => (
                  <div
                    key={member.username}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5"
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
                        <div className="text-xs text-[#4db6ac]">Admin</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-white/10">
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

      {/* Add Members Modal */}
      {showAddMembers && group && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
          onClick={() => {
            setShowAddMembers(false)
            setSelectedNewMembers([])
            setAvailableMembers([])
            setMemberSearchQuery('')
            setExpandedCommunities(new Set())
          }}
        >
          <div
            className="w-full max-w-md bg-[#1a1a1a] rounded-2xl border border-white/10 max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-white/10 flex items-center justify-between flex-shrink-0">
              <div>
                <div className="font-semibold">Add Members</div>
                <div className="text-xs text-[#9fb0b5]">
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
                className="p-2 rounded-full hover:bg-white/5"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            {group.members.length >= 5 ? (
              <div className="p-6 text-center">
                <div className="w-16 h-16 bg-[#4db6ac]/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <i className="fa-solid fa-users text-[#4db6ac] text-2xl" />
                </div>
                <h3 className="text-white font-medium mb-2">Group is Full</h3>
                <p className="text-white/60 text-sm mb-4">
                  Group chats are limited to 5 members. For larger groups, consider creating a community or sub-community.
                </p>
                <button
                  onClick={() => {
                    setShowAddMembers(false)
                    navigate('/create-community')
                  }}
                  className="px-4 py-2 bg-[#4db6ac] text-black rounded-lg font-medium"
                >
                  Create Community
                </button>
              </div>
            ) : (
              <>
                {/* Search input */}
                <div className="p-3 border-b border-white/10 flex-shrink-0">
                  <div className="relative">
                    <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm" />
                    <input
                      type="text"
                      placeholder="Search members..."
                      value={memberSearchQuery}
                      onChange={(e) => setMemberSearchQuery(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-[#4db6ac]/50"
                    />
                    {memberSearchQuery && (
                      <button
                        onClick={() => setMemberSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                      >
                        <i className="fa-solid fa-xmark text-sm" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Selected members */}
                {selectedNewMembers.length > 0 && (
                  <div className="p-3 border-b border-white/10 flex-shrink-0">
                    <div className="text-xs text-[#9fb0b5] mb-2">Selected ({selectedNewMembers.length})</div>
                    <div className="flex flex-wrap gap-2">
                      {selectedNewMembers.map((username) => (
                        <span
                          key={username}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-[#4db6ac]/20 text-[#4db6ac] rounded-full text-sm"
                        >
                          {username}
                          <button
                            onClick={() => setSelectedNewMembers(prev => prev.filter(u => u !== username))}
                            className="hover:text-white"
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
                      <i className="fa-solid fa-spinner fa-spin text-[#4db6ac] text-2xl" />
                      <p className="text-white/50 text-sm mt-2">Loading members...</p>
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
                              <p className="text-white/50 text-sm">No members match your search</p>
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
                                className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-white/5 transition"
                              >
                                <div className="flex items-center gap-2">
                                  <i className="fa-solid fa-users text-[#4db6ac] text-sm" />
                                  <span className="font-medium text-sm">{communityName}</span>
                                  <span className="text-xs text-white/40">({members.length})</span>
                                </div>
                                <i className={`fa-solid fa-chevron-${isExpanded ? 'up' : 'down'} text-xs text-white/40`} />
                              </button>
                              
                              {/* Members list */}
                              {isExpanded && (
                                <div className="ml-2 mt-1 space-y-1">
                                  {members.map((user) => (
                                    <button
                                      key={user.username}
                                      className={`w-full flex items-center gap-3 p-2 rounded-lg transition ${
                                        selectedNewMembers.includes(user.username)
                                          ? 'bg-[#4db6ac]/20'
                                          : 'hover:bg-white/5'
                                      }`}
                                      onClick={() => {
                                        if (selectedNewMembers.includes(user.username)) {
                                          setSelectedNewMembers(prev => prev.filter(u => u !== user.username))
                                        } else {
                                          if (group.members.length + selectedNewMembers.length + 1 > 5) {
                                            alert('Group chats are limited to 5 members. For larger groups, consider creating a community.')
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
                                        <div className="text-xs text-white/50">@{user.username}</div>
                                      </div>
                                      {selectedNewMembers.includes(user.username) && (
                                        <i className="fa-solid fa-check text-[#4db6ac]" />
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
                      <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-3">
                        <i className="fa-solid fa-user-check text-white/40" />
                      </div>
                      <p className="text-white/50 text-sm">
                        No available members to add
                      </p>
                    </div>
                  )}
                </div>

                {/* Add button */}
                {selectedNewMembers.length > 0 && (
                  <div className="p-4 border-t border-white/10 flex-shrink-0">
                    <button
                      onClick={handleAddMembers}
                      disabled={addingMembers}
                      className="w-full px-4 py-3 bg-[#4db6ac] text-black rounded-lg font-medium hover:bg-[#3da89e] transition disabled:opacity-50"
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

      {/* Photo preview modal - shown before sending */}
      {previewImage && (
        <div 
          className="fixed inset-0 bg-black z-[9999] flex flex-col"
          onClick={cancelImagePreview}
        >
          {/* Header */}
          <div 
            className="flex items-center justify-between px-4 py-3 bg-black/80"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
          >
            <button
              onClick={cancelImagePreview}
              className="text-white p-2 -ml-2"
            >
              <i className="fa-solid fa-xmark text-xl" />
            </button>
            <span className="text-white font-medium">Preview</span>
            <div className="w-8" /> {/* Spacer for centering */}
          </div>

          {/* Image preview */}
          <div 
            className="flex-1 flex items-center justify-center overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full h-full" style={{ maxHeight: 'calc(100vh - 8rem)', touchAction: 'none' }}>
              <ZoomableImage
                src={previewImage}
                alt="Photo preview"
                className="w-full h-full"
                onRequestClose={cancelImagePreview}
              />
            </div>
          </div>

          {/* Send button */}
          <div 
            className="flex items-center justify-center gap-4 px-4 py-4 bg-black/80"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation()
                cancelImagePreview()
              }}
              className="px-6 py-3 bg-white/10 text-white rounded-full font-medium hover:bg-white/20 transition"
            >
              Cancel
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                confirmSendImage()
              }}
              className="px-8 py-3 bg-[#4db6ac] text-black rounded-full font-medium hover:bg-[#45a89c] transition flex items-center gap-2"
            >
              <i className="fa-solid fa-paper-plane" />
              Send
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
