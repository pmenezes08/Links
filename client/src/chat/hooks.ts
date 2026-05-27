import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_NEAR_BOTTOM_PX,
  isNearBottom,
  scrollElementToBottom,
  shouldShowScrollDownAfterOpen,
} from './scrollPin'

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
}

const OPEN_PIN_MAX_MS = 1200
const STABLE_SCROLL_HEIGHT_FRAMES = 3

/**
 * Stable scroll-to-bottom for chat threads (DM + group).
 */
export function useChatThreadScroll({
  listRef,
  threadKey,
  messages,
  bottomInsetPx = 0,
  openFabDebounceMs = 300,
}: UseChatThreadScrollOptions) {
  const userHasScrolledRef = useRef(false)
  const lastVisibleMsgKeyRef = useRef<string | number | null>(null)
  const initialPinActiveRef = useRef(false)
  const messageStackRef = useRef<HTMLDivElement>(null)
  const lastMessageRef = useRef<HTMLDivElement | null>(null)
  const threadOpenedAtRef = useRef(0)
  const settleGenerationRef = useRef<number | null>(null)
  const lastBottomInsetRef = useRef(bottomInsetPx)
  const stableHeightFramesRef = useRef(0)
  const lastObservedScrollHeightRef = useRef(0)
  const openPinDeadlineRef = useRef(0)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [listRevealReady, setListRevealReady] = useState(false)
  const [pendingNewCount, setPendingNewCount] = useState(0)
  const prevMessageCountRef = useRef(0)
  const messagesLengthRef = useRef(messages.length)
  messagesLengthRef.current = messages.length

  const tryRevealList = useCallback(() => {
    if (messagesLengthRef.current === 0) {
      setListRevealReady(true)
      initialPinActiveRef.current = false
      return
    }
    const layoutStable = stableHeightFramesRef.current >= STABLE_SCROLL_HEIGHT_FRAMES
    const deadlinePassed = Date.now() >= openPinDeadlineRef.current
    if (layoutStable || deadlinePassed) {
      initialPinActiveRef.current = false
      setListRevealReady(true)
    }
  }, [])

  const scrollListToBottom = useCallback(
    (behavior: ScrollBehavior) => {
      const el = listRef.current
      if (!el) return
      scrollElementToBottom(el, behavior)
    },
    [listRef],
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
      if (!userHasScrolledRef.current) {
        ensurePinnedToBottom()
        tryRevealList()
      }
    },
    [ensurePinnedToBottom, tryRevealList],
  )

  const maybeShowScrollDown = useCallback(
    (nearBottom: boolean) => {
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
    lastVisibleMsgKeyRef.current = null
    userHasScrolledRef.current = false
    initialPinActiveRef.current = true
    stableHeightFramesRef.current = 0
    lastObservedScrollHeightRef.current = 0
    threadOpenedAtRef.current = Date.now()
    openPinDeadlineRef.current = Date.now() + OPEN_PIN_MAX_MS
    setShowScrollDown(false)
    setListRevealReady(false)
    setPendingNewCount(0)
    prevMessageCountRef.current = 0

    const revealTimer = window.setTimeout(() => {
      setListRevealReady(true)
      initialPinActiveRef.current = false
    }, OPEN_PIN_MAX_MS + 50)

    return () => window.clearTimeout(revealTimer)
  }, [threadKey])

  useLayoutEffect(() => {
    if (!threadKey) return
    if (messages.length === 0) {
      setListRevealReady(true)
    }
  }, [threadKey, messages.length])

  const messageTailKey = useMemo(() => {
    if (messages.length === 0) return null
    const last = messages[messages.length - 1]
    return last.clientKey ?? last.id
  }, [messages])

  const recordScrollHeightStability = useCallback((list: HTMLElement) => {
    const height = list.scrollHeight
    if (height === lastObservedScrollHeightRef.current) {
      stableHeightFramesRef.current += 1
    } else {
      stableHeightFramesRef.current = 0
      lastObservedScrollHeightRef.current = height
    }
  }, [])

  useLayoutEffect(() => {
    if (Math.abs(lastBottomInsetRef.current - bottomInsetPx) < 1) return
    lastBottomInsetRef.current = bottomInsetPx
    const el = listRef.current
    if (!el) return
    if (userHasScrolledRef.current && !isNearBottom(el, DEFAULT_NEAR_BOTTOM_PX)) return
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
    if (nearBottom || !userHasScrolledRef.current) {
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
    if (!el || userHasScrolledRef.current) return
    ensurePinnedToBottom()
    tryRevealList()
    settleGenerationRef.current = null
  }, [messages.length, messageTailKey, ensurePinnedToBottom, listRef, tryRevealList])

  useLayoutEffect(() => {
    const stack = messageStackRef.current
    if (!stack || typeof ResizeObserver === 'undefined') return

    const onResize = () => {
      if (userHasScrolledRef.current) return
      const list = listRef.current
      if (!list) return
      recordScrollHeightStability(list)
      scrollElementToBottom(list, 'auto')
      tryRevealList()
    }

    const observer = new ResizeObserver(onResize)
    observer.observe(stack)
    const tail = lastMessageRef.current
    if (tail) observer.observe(tail)
    return () => {
      observer.disconnect()
    }
  }, [threadKey, messages.length, messageTailKey, listRef, tryRevealList, recordScrollHeightStability])

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
    showScrollDown,
    setShowScrollDown,
    cancelInitialPin,
    listRevealReady,
    listOpening,
    pendingNewCount,
    clearPendingNew,
  }
}
