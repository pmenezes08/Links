import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import {
  DEFAULT_NEAR_BOTTOM_PX,
  isNearBottom,
  scrollElementToBottomProgrammatic,
  shouldShowScrollDownAfterOpen,
} from './scrollPin'
import { OPEN_PIN_MAX_MS, resolveOpenPinLockMs } from './threadReveal'

/**
 * Hook to detect mobile device
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => {
      const ua = navigator.userAgent || ''
      const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
                            (navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && /MacIntel/.test(navigator.platform))
      setIsMobile(Boolean(isMobileDevice))
    }
    checkMobile()
  }, [])

  return isMobile
}

interface UseTouchDismissOptions {
  showKeyboard: boolean
  composerRef: React.RefObject<HTMLDivElement | null>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

/**
 * Hook for touch-to-dismiss keyboard on mobile
 */
export function useTouchDismiss({ showKeyboard, composerRef, textareaRef }: UseTouchDismissOptions) {
  const touchDismissRef = useRef<{ 
    active: boolean
    x: number
    y: number
    pointerId: number | null 
  }>({
    active: false,
    x: 0,
    y: 0,
    pointerId: null,
  })

  const handleContentPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!showKeyboard) {
        touchDismissRef.current.active = false
        return
      }
      if (composerRef.current && composerRef.current.contains(event.target as Node)) {
        touchDismissRef.current.active = false
        return
      }
      const isTouchLike = event.pointerType === 'touch' || event.pointerType === 'pen'
      if (!isTouchLike) {
        touchDismissRef.current.active = false
        return
      }
      touchDismissRef.current = {
        active: true,
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId ?? null,
      }
    },
    [showKeyboard, composerRef]
  )

  const handleContentPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = touchDismissRef.current
    if (!start.active) return
    if (start.pointerId !== null && event.pointerId !== start.pointerId) return
    touchDismissRef.current.active = false
    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y
    if (Math.hypot(deltaX, deltaY) > 10) return
    textareaRef.current?.blur()
  }, [textareaRef])

  const handleContentPointerCancel = useCallback(() => {
    touchDismissRef.current.active = false
  }, [])

  const handleScroll = useCallback(() => {
    if (touchDismissRef.current.active) {
      touchDismissRef.current.active = false
    }
  }, [])

  return {
    handleContentPointerDown,
    handleContentPointerUp,
    handleContentPointerCancel,
    handleScroll,
    touchDismissRef,
  }
}

export interface ChatThreadScrollMessage {
  id: number | string
  clientKey?: string | number
}

interface UseChatThreadScrollOptions {
  listRef: React.RefObject<HTMLDivElement | null>
  /** Conversation id (DM username or group id string) — resets pin state when it changes. */
  threadKey: string | undefined
  messages: ChatThreadScrollMessage[]
  /** Composer + keyboard + gap inset in px — list paddingBottom should match this. */
  bottomInsetPx?: number
  /** Debounce scroll-down FAB after thread open (ms). */
  openFabDebounceMs?: number
  /** When true (cache hit), reveal list immediately after first bottom pin. */
  fastOpen?: boolean
}


function readOpenPinLockMs(): number {
  if (typeof window === 'undefined') return OPEN_PIN_MAX_MS
  try {
    return resolveOpenPinLockMs(Capacitor.getPlatform())
  } catch {
    return OPEN_PIN_MAX_MS
  }
}

/**
 * Stable scroll-to-bottom for chat threads (DM + group).
 */
export function useChatThreadScroll({
  listRef,
  threadKey,
  messages,
  bottomInsetPx = 0,
  openFabDebounceMs = 300,
  fastOpen = false,
}: UseChatThreadScrollOptions) {
  const userHasScrolledRef = useRef(false)
  const lastVisibleMsgKeyRef = useRef<string | number | null>(null)
  const initialPinActiveRef = useRef(false)
  const messageStackRef = useRef<HTMLDivElement>(null)
  const lastMessageRef = useRef<HTMLDivElement | null>(null)
  const threadOpenedAtRef = useRef(0)
  const settleGenerationRef = useRef<number | null>(null)
  const lastBottomInsetRef = useRef(bottomInsetPx)
  const openPinDeadlineRef = useRef(0)
  const fastOpenRef = useRef(fastOpen)
  fastOpenRef.current = fastOpen
  const programmaticScrollRef = useRef(false)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [listRevealReady, setListRevealReady] = useState(false)
  const [pendingNewCount, setPendingNewCount] = useState(0)
  const prevMessageCountRef = useRef(0)
  const messagesLengthRef = useRef(messages.length)
  messagesLengthRef.current = messages.length

  const tryRevealList = useCallback(() => {
    setListRevealReady(true)
  }, [])

  const runProgrammaticScroll = useCallback(
    (behavior: ScrollBehavior) => {
      const el = listRef.current
      if (!el) return
      scrollElementToBottomProgrammatic(el, behavior, active => {
        programmaticScrollRef.current = active
      })
    },
    [listRef],
  )

  const scrollListToBottom = useCallback(
    (behavior: ScrollBehavior) => {
      runProgrammaticScroll(behavior)
    },
    [runProgrammaticScroll],
  )

  const scrollToBottom = useCallback(() => {
    scrollListToBottom('auto')
  }, [scrollListToBottom])

  const clearPendingNew = useCallback(() => {
    setPendingNewCount(0)
  }, [])

  const ensurePinnedToBottom = useCallback(() => {
    userHasScrolledRef.current = false
    scrollListToBottom('auto')
    setShowScrollDown(false)
    clearPendingNew()
  }, [scrollListToBottom, clearPendingNew])

  const scrollToBottomIfAppropriate = useCallback(() => {
    const el = listRef.current
    if (!el) {
      scrollToBottom()
      return
    }
    if (isNearBottom(el, DEFAULT_NEAR_BOTTOM_PX) || !userHasScrolledRef.current) {
      scrollToBottom()
    }
  }, [scrollToBottom, listRef])

  const notifyMessagesSettled = useCallback(
    (generation: number) => {
      settleGenerationRef.current = generation
      if (!userHasScrolledRef.current || initialPinActiveRef.current) {
        ensurePinnedToBottom()
        tryRevealList()
      }
    },
    [ensurePinnedToBottom, tryRevealList],
  )

  const maybeShowScrollDown = useCallback(
    (nearBottom: boolean) => {
      if (initialPinActiveRef.current || programmaticScrollRef.current) {
        return
      }
      if (nearBottom) {
        setShowScrollDown(false)
        return
      }
      if (!shouldShowScrollDownAfterOpen(threadOpenedAtRef.current, Date.now(), openFabDebounceMs)) {
        return
      }
      setShowScrollDown(true)
    },
    [openFabDebounceMs],
  )

  const setLastMessageNode = useCallback((node: HTMLDivElement | null) => {
    lastMessageRef.current = node
  }, [])

  useLayoutEffect(() => {
    if (!threadKey) return
    const openPinLockMs = readOpenPinLockMs()
    lastVisibleMsgKeyRef.current = null
    userHasScrolledRef.current = false
    initialPinActiveRef.current = true
    programmaticScrollRef.current = false
    threadOpenedAtRef.current = Date.now()
    openPinDeadlineRef.current = Date.now() + openPinLockMs
    setShowScrollDown(false)
    setListRevealReady(false)
    setPendingNewCount(0)
    prevMessageCountRef.current = 0

    const revealTimer = window.setTimeout(() => {
      setListRevealReady(true)
    }, openPinLockMs + 50)

    const pinUnlockTimer = window.setTimeout(() => {
      initialPinActiveRef.current = false
    }, openPinLockMs + 50)

    return () => {
      window.clearTimeout(revealTimer)
      window.clearTimeout(pinUnlockTimer)
    }
  }, [threadKey])

  useLayoutEffect(() => {
    if (!threadKey) return
    if (messages.length === 0) {
      setListRevealReady(true)
    } else if (fastOpen) {
      setListRevealReady(true)
    }
  }, [threadKey, messages.length, fastOpen])

  const messageTailKey = useMemo(() => {
    if (messages.length === 0) return null
    const last = messages[messages.length - 1]
    return last.clientKey ?? last.id
  }, [messages])

  useLayoutEffect(() => {
    if (Math.abs(lastBottomInsetRef.current - bottomInsetPx) < 1) return
    lastBottomInsetRef.current = bottomInsetPx
    const el = listRef.current
    if (!el) return
    const mayPin =
      initialPinActiveRef.current ||
      !userHasScrolledRef.current ||
      isNearBottom(el, DEFAULT_NEAR_BOTTOM_PX)
    if (!mayPin) return
    scrollListToBottom('auto')
    if (messages.length > 0) tryRevealList()
  }, [bottomInsetPx, listRef, scrollListToBottom, messages.length, tryRevealList])

  useLayoutEffect(() => {
    if (messages.length === 0 || messageTailKey == null) return
    const el = listRef.current
    if (!el) return
    const prevCount = prevMessageCountRef.current
    if (messages.length > prevCount && userHasScrolledRef.current && messageTailKey !== lastVisibleMsgKeyRef.current) {
      setPendingNewCount(c => c + (messages.length - prevCount))
    }
    prevMessageCountRef.current = messages.length

    if (messageTailKey === lastVisibleMsgKeyRef.current) return
    lastVisibleMsgKeyRef.current = messageTailKey
    const nearBottom = isNearBottom(el, DEFAULT_NEAR_BOTTOM_PX)
    if (initialPinActiveRef.current || nearBottom || !userHasScrolledRef.current) {
      scrollListToBottom('auto')
      setShowScrollDown(false)
      clearPendingNew()
      tryRevealList()
    } else {
      maybeShowScrollDown(false)
    }
  }, [messageTailKey, messages.length, scrollListToBottom, listRef, maybeShowScrollDown, tryRevealList, clearPendingNew])

  useLayoutEffect(() => {
    if (settleGenerationRef.current == null) return
    const el = listRef.current
    if (!el) return
    if (userHasScrolledRef.current && !initialPinActiveRef.current) return
    ensurePinnedToBottom()
    tryRevealList()
    settleGenerationRef.current = null
  }, [messages.length, messageTailKey, ensurePinnedToBottom, listRef, tryRevealList])

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || typeof ResizeObserver === 'undefined') return

    const onResize = () => {
      if (userHasScrolledRef.current && !initialPinActiveRef.current) return
      scrollElementToBottomProgrammatic(list, 'auto', active => {
        programmaticScrollRef.current = active
      })
    }

    const observer = new ResizeObserver(onResize)
    observer.observe(list)
    const tail = lastMessageRef.current
    if (tail) observer.observe(tail)
    return () => {
      observer.disconnect()
    }
  }, [threadKey, messages.length, messageTailKey, listRef])

  const cancelInitialPin = useCallback(() => {
    initialPinActiveRef.current = false
  }, [])

  const listOpening = !listRevealReady

  return {
    messageStackRef,
    lastMessageRef: setLastMessageNode,
    scrollListToBottom,
    scrollToBottom,
    scrollToBottomIfAppropriate,
    ensurePinnedToBottom,
    notifyMessagesSettled,
    userHasScrolledRef,
    initialPinActiveRef,
    programmaticScrollRef,
    showScrollDown,
    setShowScrollDown,
    cancelInitialPin,
    listRevealReady,
    listOpening,
    pendingNewCount,
    clearPendingNew,
  }
}
