import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_NEAR_BOTTOM_PX,
  isInvertedAtBottom,
  pinInvertedToBottom,
  smoothPinInvertedToBottom,
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

/** Movement beyond this on the message list is treated as scroll, not tap. */
export const CHAT_TOUCH_DISMISS_MOVE_PX = 10

interface UseTouchDismissOptions {
  showKeyboard: boolean
  composerRef: React.RefObject<HTMLDivElement | null>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  /** Called when a scroll gesture should hide the composer keyboard. */
  dismissComposerKeyboard?: () => void
}

/**
 * Hook for touch-to-dismiss keyboard on mobile
 */
export function useTouchDismiss({
  showKeyboard,
  composerRef,
  textareaRef,
  dismissComposerKeyboard,
}: UseTouchDismissOptions) {
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

  const dismissFromGesture = useCallback(() => {
    if (dismissComposerKeyboard) {
      dismissComposerKeyboard()
      return
    }
    textareaRef.current?.blur()
  }, [dismissComposerKeyboard, textareaRef])

  const handleContentPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = touchDismissRef.current
      if (!start.active) return
      if (start.pointerId !== null && event.pointerId !== start.pointerId) return
      const deltaX = event.clientX - start.x
      const deltaY = event.clientY - start.y
      if (Math.hypot(deltaX, deltaY) <= CHAT_TOUCH_DISMISS_MOVE_PX) return
      touchDismissRef.current.active = false
      dismissFromGesture()
    },
    [dismissFromGesture],
  )

  const handleContentPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = touchDismissRef.current
      if (!start.active) return
      if (start.pointerId !== null && event.pointerId !== start.pointerId) return
      touchDismissRef.current.active = false
      const deltaX = event.clientX - start.x
      const deltaY = event.clientY - start.y
      if (Math.hypot(deltaX, deltaY) > CHAT_TOUCH_DISMISS_MOVE_PX) return
      dismissFromGesture()
    },
    [dismissFromGesture],
  )

  const handleContentPointerCancel = useCallback(() => {
    touchDismissRef.current.active = false
  }, [])

  return {
    handleContentPointerDown,
    handleContentPointerMove,
    handleContentPointerUp,
    handleContentPointerCancel,
    touchDismissRef,
  }
}

export interface ChatThreadScrollMessage {
  id: number | string
  clientKey?: string | number
}

interface UseChatThreadScrollOptions {
  listRef: React.RefObject<HTMLDivElement | null>
  /** Conversation id (DM username or group id string) — resets state when it changes. */
  threadKey: string | undefined
  messages: ChatThreadScrollMessage[]
}

/**
 * Inverted-list scroll state for chat threads (DM + group).
 *
 * The message list is rendered as `flex-direction: column-reverse`, so
 * `scrollTop = 0` IS the visual bottom (newest message above the composer).
 * No pin orchestration is required on open: the first paint already shows
 * the latest message in the correct position.
 *
 * This hook only tracks:
 * - whether the user has scrolled away from the bottom (FAB visibility),
 * - the count of new messages received while scrolled up (pending chip),
 * - imperative helpers for the post-send / FAB-tap paths.
 */
export function useChatThreadScroll({
  listRef,
  threadKey,
  messages,
}: UseChatThreadScrollOptions) {
  const userHasScrolledRef = useRef(false)
  const messageStackRef = useRef<HTMLDivElement>(null)
  const lastMessageRef = useRef<HTMLDivElement | null>(null)
  const lastSeenTailRef = useRef<string | number | null>(null)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [pendingNewCount, setPendingNewCount] = useState(0)

  const setLastMessageNode = useCallback((node: HTMLDivElement | null) => {
    lastMessageRef.current = node
  }, [])

  const ensurePinnedToBottom = useCallback(() => {
    const el = listRef.current
    if (!el) return
    pinInvertedToBottom(el)
    userHasScrolledRef.current = false
    setShowScrollDown(false)
    setPendingNewCount(0)
  }, [listRef])

  const scrollToBottom = useCallback(() => {
    ensurePinnedToBottom()
  }, [ensurePinnedToBottom])

  const scrollToBottomSmooth = useCallback(() => {
    const el = listRef.current
    if (!el) return
    smoothPinInvertedToBottom(el)
    userHasScrolledRef.current = false
    setShowScrollDown(false)
    setPendingNewCount(0)
  }, [listRef])

  const clearPendingNew = useCallback(() => {
    setPendingNewCount(0)
  }, [])

  const messageTailKey = useMemo(() => {
    if (messages.length === 0) return null
    const last = messages[messages.length - 1]
    return last.clientKey ?? last.id
  }, [messages])

  // Reset state when switching threads.
  useEffect(() => {
    if (!threadKey) return
    userHasScrolledRef.current = false
    lastSeenTailRef.current = null
    setShowScrollDown(false)
    setPendingNewCount(0)
  }, [threadKey])

  // Track new tail arrivals: increment pending count while scrolled up.
  useLayoutEffect(() => {
    if (messageTailKey == null) {
      lastSeenTailRef.current = null
      return
    }
    const prevTail = lastSeenTailRef.current
    if (prevTail === messageTailKey) return
    lastSeenTailRef.current = messageTailKey
    if (prevTail == null) return
    const el = listRef.current
    const atBottom = el ? isInvertedAtBottom(el, DEFAULT_NEAR_BOTTOM_PX) : true
    if (!atBottom && userHasScrolledRef.current) {
      setPendingNewCount(c => c + 1)
    }
  }, [messageTailKey, listRef])

  /**
   * Settle callback for the page: clears pending count when at bottom.
   * No pin work is required here — the column-reverse layout already keeps
   * the newest message anchored at the visual bottom when scrollTop == 0.
   */
  const notifyMessagesSettled = useCallback(
    (_generation: number) => {
      const el = listRef.current
      if (!el) return
      if (isInvertedAtBottom(el, DEFAULT_NEAR_BOTTOM_PX)) {
        setPendingNewCount(0)
        setShowScrollDown(false)
      }
    },
    [listRef],
  )

  const scrollToMessage = useCallback(
    (targetId: string | number): boolean => {
      const stack = messageStackRef.current
      if (!stack) return false
      const el = stack.querySelector(`[data-message-id="${targetId}"]`) as HTMLElement | null
      if (!el) return false
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.classList.add('chat-search-highlight')
      setTimeout(() => el.classList.remove('chat-search-highlight'), 2000)
      return true
    },
    [],
  )

  return {
    messageStackRef,
    lastMessageRef: setLastMessageNode,
    scrollToBottom,
    scrollToBottomSmooth,
    ensurePinnedToBottom,
    notifyMessagesSettled,
    scrollToMessage,
    userHasScrolledRef,
    showScrollDown,
    setShowScrollDown,
    pendingNewCount,
    clearPendingNew,
  }
}
