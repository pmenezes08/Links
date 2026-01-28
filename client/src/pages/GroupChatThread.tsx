import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import Avatar from '../components/Avatar'

type Message = {
  id: number
  sender: string
  text: string | null
  image: string | null
  created_at: string
  profile_picture: string | null
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
}

export default function GroupChatThread() {
  const { group_id } = useParams()
  const navigate = useNavigate()
  const [group, setGroup] = useState<GroupInfo | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const lastMessageIdRef = useRef<number>(0)

  // Check if mobile
  const isMobile = typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

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

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const focusTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
  }, [])

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
        const newMessages = data.messages as Message[]
        const newMaxId = newMessages.length > 0 ? Math.max(...newMessages.map(m => m.id)) : 0
        const hasNewMessages = newMaxId > lastMessageIdRef.current

        setMessages(newMessages)
        lastMessageIdRef.current = newMaxId

        if (hasNewMessages && !silent) {
          setTimeout(scrollToBottom, 100)
        }
      }
    } catch (err) {
      console.error('Error loading messages:', err)
      if (!silent) setError('Failed to load messages')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [group_id, scrollToBottom])

  useEffect(() => {
    loadGroup()
    loadMessages()

    pollingRef.current = setInterval(() => {
      loadMessages(true)
    }, 3000)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [loadGroup, loadMessages])

  const handleSend = async () => {
    const text = draft.trim()
    if (!text || sending) return

    setSending(true)
    setDraft('')

    try {
      const response = await fetch(`/api/group_chat/${group_id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: text }),
      })
      const data = await response.json()

      if (data.success) {
        setMessages(prev => [...prev, data.message])
        lastMessageIdRef.current = data.message.id
        setTimeout(scrollToBottom, 100)
      } else {
        setDraft(text)
        console.error('Failed to send:', data.error)
      }
    } catch (err) {
      setDraft(text)
      console.error('Error sending message:', err)
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }

  const handlePhotoSelect = () => {
    setShowAttachMenu(false)
    fileInputRef.current?.click()
  }

  const handleCameraOpen = () => {
    setShowAttachMenu(false)
    cameraInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingImage(true)
    try {
      const formData = new FormData()
      formData.append('image', file)

      const uploadResponse = await fetch('/api/upload_chat_image', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      const uploadData = await uploadResponse.json()

      if (uploadData.success && uploadData.image_path) {
        // Send the image as a message
        const response = await fetch(`/api/group_chat/${group_id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ image: uploadData.image_path }),
        })
        const data = await response.json()

        if (data.success) {
          setMessages(prev => [...prev, data.message])
          lastMessageIdRef.current = data.message.id
          setTimeout(scrollToBottom, 100)
        }
      }
    } catch (err) {
      console.error('Error uploading image:', err)
    } finally {
      setUploadingImage(false)
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (cameraInputRef.current) cameraInputRef.current.value = ''
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

  if (loading && !group) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-[#9fb0b5]">
          <i className="fa-solid fa-spinner fa-spin mr-2" />
          Loading...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
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
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <div
        className="fixed left-0 right-0 h-14 bg-black/95 backdrop-blur border-b border-white/10 z-40 flex items-center px-3 gap-3"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))' }}
      >
        <button
          onClick={() => navigate('/user_chat')}
          className="p-2 rounded-full hover:bg-white/5"
          aria-label="Back"
        >
          <i className="fa-solid fa-arrow-left" />
        </button>

        <button
          onClick={() => setShowMembers(true)}
          className="flex-1 min-w-0 flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center">
            <i className="fa-solid fa-users text-[#4db6ac]" />
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="font-semibold truncate">{group?.name}</div>
            <div className="text-xs text-[#9fb0b5] truncate">
              {group?.members.length} members
            </div>
          </div>
        </button>

        <button
          onClick={() => setShowMembers(true)}
          className="p-2 rounded-full hover:bg-white/5"
          aria-label="Group info"
        >
          <i className="fa-solid fa-ellipsis-vertical" />
        </button>
      </div>

      {/* Messages Container */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-3"
        style={{
          paddingTop: 'calc(var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px))) + 56px + 16px)',
          paddingBottom: listPaddingBottom,
        }}
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#9fb0b5]">
            <i className="fa-solid fa-comments text-4xl mb-3 opacity-50" />
            <div className="text-sm">No messages yet</div>
            <div className="text-xs mt-1">Send a message to start the conversation</div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg, idx) => {
              const showAvatar = idx === 0 || messages[idx - 1].sender !== msg.sender

              return (
                <div key={msg.id} className={`flex gap-2 ${showAvatar ? 'mt-4' : 'mt-1'}`}>
                  <div className="w-8 flex-shrink-0">
                    {showAvatar && (
                      <Avatar
                        username={msg.sender}
                        url={msg.profile_picture || undefined}
                        size={32}
                        linkToProfile
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    {showAvatar && (
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-sm font-medium text-white/90">{msg.sender}</span>
                        <span className="text-xs text-[#9fb0b5]">{formatTime(msg.created_at)}</span>
                      </div>
                    )}
                    {msg.text && (
                      <div className="text-[14px] text-white/90 whitespace-pre-wrap break-words">
                        {msg.text}
                      </div>
                    )}
                    {msg.image && (
                      <img
                        src={msg.image.startsWith('http') ? msg.image : `/uploads/${msg.image}`}
                        alt="Shared image"
                        className="mt-2 max-w-[280px] rounded-lg border border-white/10"
                      />
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ====== COMPOSER - FIXED AT BOTTOM - Matching ChatThread exactly ====== */}
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
              </div>
            </>
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

            {/* Uploading indicator */}
            {uploadingImage && (
              <div className="flex items-center gap-1.5 flex-shrink-0 pr-2">
                <i className="fa-solid fa-spinner fa-spin text-[#4db6ac]" />
                <span className="text-[#4db6ac] text-xs">Uploading...</span>
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
              <textarea
                ref={textareaRef}
                rows={1}
                className="flex-1 bg-transparent px-3 sm:px-3.5 py-2 text-[15px] text-white placeholder-white/50 outline-none resize-none max-h-24 min-h-[38px]"
                placeholder="Message"
                value={draft}
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
                onChange={(e) => {
                  setDraft(e.target.value)
                }}
              />
            </div>

            {/* Send button */}
            <button
              className={`w-10 h-10 flex-shrink-0 rounded-[14px] flex items-center justify-center ${
                sending
                  ? 'bg-gray-600 text-gray-300'
                  : draft.trim()
                    ? 'bg-[#4db6ac] text-black'
                    : 'bg-white/12 text-white/70'
              } active:scale-95`}
              onPointerDown={(e) => {
                if (!draft.trim() || sending) return
                e.preventDefault()
                e.stopPropagation()
                handleSend()
              }}
              onClick={(e) => {
                if (!draft.trim() || sending) return
                e.preventDefault()
                e.stopPropagation()
                handleSend()
              }}
              disabled={sending || !draft.trim()}
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

      {/* Members Modal */}
      {showMembers && group && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center"
          onClick={() => setShowMembers(false)}
        >
          <div
            className="w-full sm:max-w-md bg-[#1a1a1a] rounded-t-2xl sm:rounded-2xl border border-white/10 max-h-[80vh] overflow-hidden"
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
    </div>
  )
}
