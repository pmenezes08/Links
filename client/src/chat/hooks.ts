import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import { computeKeyboardLift } from '../utils/keyboardLift'
import {
  DEFAULT_NEAR_BOTTOM_PX,
  isNearBottom,
  scrollElementToBottom,
  shouldShowScrollDownAfterOpen,
} from './scrollPin'

// Layout constants
const VISUAL_VIEWPORT_KEYBOARD_THRESHOLD = 48
const NATIVE_KEYBOARD_MIN_HEIGHT = 60
const KEYBOARD_OFFSET_EPSILON = 6
const DEFAULT_COMPOSER_PADDING = 64

interface UseKeyboardLayoutOptions {
  isMobile: boolean
  scrollToBottom: () => void
}

interface UseKeyboardLayoutReturn {
  keyboardOffset: number
  viewportLift: number
  showKeyboard: boolean
  composerHeight: number
  safeBottomPx: number
  composerCardRef: React.RefObject<HTMLDivElement | null>
  keyboardLift: number
  effectiveComposerHeight: number
}

/**
 * Hook to manage keyboard layout adjustments for chat interface
 * Handles both web visual viewport and native Capacitor keyboard events
 */
export function useKeyboardLayout({
  isMobile,
  scrollToBottom,
}: UseKeyboardLayoutOptions): UseKeyboardLayoutReturn {
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [viewportLift, setViewportLift] = useState(0)
  const [composerHeight, setComposerHeight] = useState(DEFAULT_COMPOSER_PADDING)
  const [safeBottomPx, setSafeBottomPx] = useState(0)
  
  const composerCardRef = useRef<HTMLDivElement>(null)
  const keyboardOffsetRef = useRef(0)
  const viewportBaseRef = useRef<number | null>(null)

  // Track composer card height changes
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

  // Probe safe area inset
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

  // Web visual viewport tracking
  useEffect(() => {
    if (!isMobile) return
    if (Capacitor.getPlatform() !== 'web') return
    if (typeof window === 'undefined') return
    const viewport = window.visualViewport
    if (!viewport) return
    
    let rafId: number | null = null
    
    const updateOffset = () => {
      const currentHeight = viewport.height
      // Update base height when viewport expands (keyboard closed)
      if (
        viewportBaseRef.current === null ||
        currentHeight > (viewportBaseRef.current ?? currentHeight) - 4
      ) {
        viewportBaseRef.current = currentHeight
      }
      const baseHeight = viewportBaseRef.current ?? currentHeight
      // Only use height difference, ignore offsetTop to prevent scroll-induced shifts
      const nextOffset = Math.max(0, baseHeight - currentHeight)
      const normalizedOffset = nextOffset < VISUAL_VIEWPORT_KEYBOARD_THRESHOLD ? 0 : nextOffset
      // Only update if change is significant (> 5px) to prevent micro-adjustments
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
    
    // Only listen to resize, not scroll - scroll causes periodic shifts on iOS
    viewport.addEventListener('resize', handleChange)
    handleChange()
    
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', handleChange)
    }
  }, [isMobile, scrollToBottom])

  // Native Capacitor keyboard events
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

  const effectiveComposerHeight = Math.max(composerHeight, DEFAULT_COMPOSER_PADDING)
  const liftSource = Math.max(keyboardOffset, viewportLift)
  const keyboardLift = computeKeyboardLift(liftSource)
  // Use higher threshold to prevent toggling from small viewport fluctuations
  const showKeyboard = liftSource > 50

  return {
    keyboardOffset,
    viewportLift,
    showKeyboard,
    composerHeight,
    safeBottomPx,
    composerCardRef,
    keyboardLift,
    effectiveComposerHeight,
  }
}

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

/**
 * Hook for scroll to bottom functionality
 */
export function useScrollToBottom(listRef: React.RefObject<HTMLDivElement>) {
  const scrollToBottom = useCallback(() => {
    const el = listRef.current
    if (!el) return
    
    const doScroll = () => {
      // Method 1: Set scrollTop directly
      el.scrollTop = el.scrollHeight
      
      // Method 2: Find scroll anchor and scroll into view
      const anchor = el.querySelector('.scroll-anchor')
      if (anchor) {
        anchor.scrollIntoView({ behavior: 'instant', block: 'end' })
      }
    }
    
    // Execute immediately and with delays
    doScroll()
    requestAnimationFrame(doScroll)
    setTimeout(doScroll, 50)
    setTimeout(doScroll, 100)
    setTimeout(doScroll, 200)
  }, [listRef])

  return scrollToBottom
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
const STABLE_SCROLL_HEIGHT_FRAMES = 2

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
  const threadOpenedAtRef = useRef(0)
  const settleGenerationRef = useRef<number | null>(null)
  const lastBottomInsetRef = useRef(bottomInsetPx)
  const stableHeightFramesRef = useRef(0)
  const lastObservedScrollHeightRef = useRef(0)
  const openPinDeadlineRef = useRef(0)
  const [showScrollDown, setShowScrollDown] = useState(false)
  /** Hide list until first instant bottom pin (WhatsApp-style open). */
  const [listRevealReady, setListRevealReady] = useState(false)

  const markListRevealReady = useCallback(() => {
    setListRevealReady(prev => (prev ? prev : true))
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

  const ensurePinnedToBottom = useCallback(() => {
    userHasScrolledRef.current = false
    scrollListToBottom('auto')
    setShowScrollDown(false)
  }, [scrollListToBottom])

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
      }
    },
    [ensurePinnedToBottom],
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

  useLayoutEffect(() => {
    if (Math.abs(lastBottomInsetRef.current - bottomInsetPx) < 1) return
    lastBottomInsetRef.current = bottomInsetPx
    const el = listRef.current
    if (!el) return
    if (userHasScrolledRef.current && !isNearBottom(el, DEFAULT_NEAR_BOTTOM_PX)) return
    scrollListToBottom('auto')
    if (messages.length > 0) markListRevealReady()
  }, [bottomInsetPx, listRef, scrollListToBottom, messages.length, markListRevealReady])

  useLayoutEffect(() => {
    if (messages.length === 0 || messageTailKey == null) return
    const el = listRef.current
    if (!el) return
    if (messageTailKey === lastVisibleMsgKeyRef.current) return
    lastVisibleMsgKeyRef.current = messageTailKey
    const nearBottom = isNearBottom(el, DEFAULT_NEAR_BOTTOM_PX)
    if (nearBottom || !userHasScrolledRef.current) {
      scrollListToBottom('auto')
      setShowScrollDown(false)
      markListRevealReady()
    } else {
      maybeShowScrollDown(false)
    }
  }, [messageTailKey, messages.length, scrollListToBottom, listRef, maybeShowScrollDown, markListRevealReady])

  useLayoutEffect(() => {
    if (settleGenerationRef.current == null) return
    const el = listRef.current
    if (!el || userHasScrolledRef.current) return
    ensurePinnedToBottom()
    markListRevealReady()
    settleGenerationRef.current = null
  }, [messages.length, messageTailKey, ensurePinnedToBottom, listRef, markListRevealReady])

  useLayoutEffect(() => {
    const stack = messageStackRef.current
    if (!stack || typeof ResizeObserver === 'undefined') return
    const onStackResize = () => {
      if (userHasScrolledRef.current) return
      const list = listRef.current
      if (!list) return

      const height = list.scrollHeight
      if (height === lastObservedScrollHeightRef.current) {
        stableHeightFramesRef.current += 1
      } else {
        stableHeightFramesRef.current = 0
        lastObservedScrollHeightRef.current = height
      }

      const layoutStable = stableHeightFramesRef.current >= STABLE_SCROLL_HEIGHT_FRAMES
      if (
        layoutStable ||
        (initialPinActiveRef.current && Date.now() >= openPinDeadlineRef.current)
      ) {
        initialPinActiveRef.current = false
      }

      scrollElementToBottom(list, 'auto')
      if (messages.length > 0) markListRevealReady()
    }
    const observer = new ResizeObserver(onStackResize)
    observer.observe(stack)
    return () => {
      observer.disconnect()
    }
  }, [threadKey, messages.length, listRef, markListRevealReady])

  const cancelInitialPin = useCallback(() => {
    initialPinActiveRef.current = false
  }, [])

  return {
    messageStackRef,
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
  }
}
