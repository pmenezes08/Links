import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import { useFixedComposerKeyboard } from '../hooks/useFixedComposerKeyboard'
import { computeKeyboardLift, readCssPxVar } from '../utils/keyboardLift'
import { useTouchDismiss } from './hooks'
import { useSmoothedPx } from './useSmoothedPx'

const DEFAULT_COMPOSER_PADDING = 64
const VISUAL_VIEWPORT_KEYBOARD_THRESHOLD = 48
const NATIVE_KEYBOARD_MIN_HEIGHT = 60
const KEYBOARD_OFFSET_EPSILON = 6
export const CHAT_COMPOSER_GAP_PX = 10

export interface UseChatComposerChromeOptions {
  isMobile: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  composerRef: RefObject<HTMLDivElement | null>
  onLayoutNudge?: () => void
}

export function useChatComposerChrome({
  isMobile,
  textareaRef,
  composerRef,
  onLayoutNudge,
}: UseChatComposerChromeOptions) {
  const onLayoutNudgeRef = useRef(onLayoutNudge)
  onLayoutNudgeRef.current = onLayoutNudge

  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [composerHeight, setComposerHeight] = useState(DEFAULT_COMPOSER_PADDING)
  const [safeBottomPx, setSafeBottomPx] = useState(0)
  const [viewportLift, setViewportLift] = useState(0)

  const composerCardRef = useRef<HTMLDivElement | null>(null)
  const keyboardOffsetRef = useRef(0)
  const viewportBaseRef = useRef<number | null>(null)
  const lastFocusTimeRef = useRef(0)

  useFixedComposerKeyboard({
    onLayoutNudge: () => onLayoutNudgeRef.current?.(),
  })

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

  useEffect(() => {
    if (typeof window === 'undefined') return

    const syncSafeBottom = () => {
      if (keyboardOffsetRef.current > 0) return
      const next = readCssPxVar('--sab-px')
      setSafeBottomPx(prev => {
        if (next < 1 && prev > 1) return prev
        return Math.abs(prev - next) < 1 ? prev : next
      })
    }

    syncSafeBottom()
    window.addEventListener('resize', syncSafeBottom)
    window.visualViewport?.addEventListener('resize', syncSafeBottom)

    return () => {
      window.removeEventListener('resize', syncSafeBottom)
      window.visualViewport?.removeEventListener('resize', syncSafeBottom)
    }
  }, [])

  const effectiveComposerHeight = Math.max(composerHeight, DEFAULT_COMPOSER_PADDING)
  const liftSource = Math.max(keyboardOffset, viewportLift)
  const isWeb = Capacitor.getPlatform() === 'web'
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
  const androidKeyboardOpen = isAndroid && liftSource > 0

  const androidComposerBottom = androidKeyboardOpen
    ? Math.max(
        0,
        window.innerHeight -
          ((window.visualViewport?.offsetTop ?? 0) +
            (window.visualViewport?.height ?? window.innerHeight)),
      )
    : 0
  const keyboardLift = androidKeyboardOpen ? androidComposerBottom : computeKeyboardLift(liftSource)

  const smoothedKeyboardLift = useSmoothedPx(keyboardLift, {
    onTick: () => onLayoutNudgeRef.current?.(),
  })
  /** Composer + list inset — smoothed on iOS/web; Android visualViewport already tracks IME. */
  const displayKeyboardLift = isAndroid ? keyboardLift : smoothedKeyboardLift

  const bottomChromeInset =
    displayKeyboardLift > 0 || androidKeyboardOpen ? displayKeyboardLift : safeBottomPx
  const bottomInsetPx = bottomChromeInset + effectiveComposerHeight + CHAT_COMPOSER_GAP_PX
  const listPaddingBottom = `${bottomInsetPx}px`
  const listScrollPaddingBottom = listPaddingBottom
  const scrollButtonBottom = `${bottomChromeInset + effectiveComposerHeight + 12}px`
  const keyboardIsOpen = keyboardLift > 0 || androidKeyboardOpen

  useEffect(() => {
    if (!isMobile) return
    const platform = Capacitor.getPlatform()
    if (platform !== 'web' && platform !== 'android' && platform !== 'ios') return
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
      if (normalizedOffset > 0 && document.activeElement !== textareaRef.current) return
      if (Math.abs(keyboardOffsetRef.current - normalizedOffset) < 15) return
      setViewportLift(prev => (Math.abs(prev - normalizedOffset) < 15 ? prev : normalizedOffset))
      keyboardOffsetRef.current = normalizedOffset
      setKeyboardOffset(normalizedOffset)
      if (normalizedOffset > 0) {
        requestAnimationFrame(() => onLayoutNudgeRef.current?.())
      }
    }

    const handleChange = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updateOffset)
    }

    viewport.addEventListener('resize', handleChange)
    viewport.addEventListener('scroll', handleChange)
    handleChange()

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', handleChange)
      viewport.removeEventListener('scroll', handleChange)
    }
  }, [isMobile, textareaRef])

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'ios') return
    let showSub: PluginListenerHandle | undefined
    let hideSub: PluginListenerHandle | undefined

    const normalizeHeight = (raw: number) => (raw < NATIVE_KEYBOARD_MIN_HEIGHT ? 0 : raw)

    const handleShow = (info: KeyboardInfo) => {
      const height = normalizeHeight(info?.keyboardHeight ?? 0)
      if (height === 0) return
      if (Math.abs(keyboardOffsetRef.current - height) < KEYBOARD_OFFSET_EPSILON) return
      keyboardOffsetRef.current = height
      setKeyboardOffset(height)
      requestAnimationFrame(() => onLayoutNudgeRef.current?.())
    }

    const handleHide = () => {
      if (Math.abs(keyboardOffsetRef.current) < KEYBOARD_OFFSET_EPSILON) return
      keyboardOffsetRef.current = 0
      setKeyboardOffset(0)
      requestAnimationFrame(() => onLayoutNudgeRef.current?.())
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

  const touchDismiss = useTouchDismiss({
    showKeyboard: keyboardIsOpen,
    composerRef,
    textareaRef,
  })

  const handleContentPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const start = touchDismiss.touchDismissRef.current
      if (!start.active) return
      if (start.pointerId !== null && event.pointerId !== start.pointerId) return
      touchDismiss.touchDismissRef.current.active = false
      const deltaX = event.clientX - start.x
      const deltaY = event.clientY - start.y
      if (Math.hypot(deltaX, deltaY) > 10) return
      const t = event.target as Node | null
      if (t && composerRef.current?.contains(t)) return
      if (document.activeElement === textareaRef.current) {
        if (Date.now() - lastFocusTimeRef.current < 1000) return
      }
      textareaRef.current?.blur()
    },
    [composerRef, textareaRef, touchDismiss.touchDismissRef],
  )

  const noteComposerFocus = useCallback(() => {
    lastFocusTimeRef.current = Date.now()
  }, [])

  return {
    composerRef,
    composerCardRef,
    keyboardLift,
    displayKeyboardLift,
    safeBottomPx,
    keyboardIsOpen,
    isWeb,
    androidKeyboardOpen,
    bottomInsetPx,
    listPaddingBottom,
    listScrollPaddingBottom,
    scrollButtonBottom,
    effectiveComposerHeight,
    bottomChromeInset,
    handleContentPointerDown: touchDismiss.handleContentPointerDown,
    handleContentPointerUp,
    handleContentPointerCancel: touchDismiss.handleContentPointerCancel,
    noteComposerFocus,
    touchDismissRef: touchDismiss.touchDismissRef,
  }
}
