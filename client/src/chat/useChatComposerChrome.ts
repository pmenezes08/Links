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

/**
 * Synchronous read of the live `--sab-px` CSS variable so first-render state
 * already reflects the safe-area inset. `useSafeAreaSync` (mounted in App)
 * populates the variable in a `useLayoutEffect`, so by the time any chat
 * page mounts the value is correct on the document root.
 */
function readSafeBottomPxOnce(): number {
  if (typeof document === 'undefined') return 0
  return readCssPxVar('--sab-px')
}

/**
 * Closer to the real measured composer card height on iPhone + Android
 * native (textarea row + button row + safe-area padding). The exact value
 * matters mainly for the very first surface open in a session before
 * `cachedComposerHeightBySurface` warms; we deliberately err on the larger
 * side (≈ measured median on iPhone home-indicator devices) so the
 * placeholder almost always over-allocates rather than under-allocates the
 * inset, which keeps any post-paint settle on the safe side (shrink
 * instead of grow) and cooperates with the `chat-list-idle-smooth`
 * transition.
 */
const DEFAULT_COMPOSER_PADDING = 96
const VISUAL_VIEWPORT_KEYBOARD_THRESHOLD = 48
const NATIVE_KEYBOARD_MIN_HEIGHT = 60
const KEYBOARD_OFFSET_EPSILON = 6
export const CHAT_COMPOSER_GAP_PX = 10

/**
 * Discriminator for the chat surface using the composer. DM and group cards
 * render the same `ChatComposerCard` shell but with subtly different
 * conditional slots (group has the mention dropdown / upload banner, DM
 * has an extra audio input + slightly different gap classes), which makes
 * their measured `getBoundingClientRect().height` differ by 1–4px even in
 * the idle state. A shared cache caused opening a group right after a DM
 * (or vice versa) to seed `composerHeight` with the other surface's value
 * — ResizeObserver corrected post-paint and the inverted list visibly
 * drifted upward. Per-surface caches keep each thread surface anchored to
 * its own measured value from the first render.
 */
export type ChatComposerSurfaceKey = 'dm' | 'group'

/**
 * Per-surface cache of the last measured composer card height. Survives
 * for the lifetime of the SPA session. Keys are `ChatComposerSurfaceKey`
 * so DM and group can each remember their own measured value. The
 * matching `--chat-composer-height-${surface}` CSS var is written to
 * `document.documentElement` whenever the cache is updated, so a page
 * remounting after the React tree has been garbage-collected (e.g.
 * route change → back) still recovers the right value through
 * `readCssPxVar` before any ResizeObserver fires.
 */
const cachedComposerHeightBySurface = new Map<ChatComposerSurfaceKey, number>()

function composerCssVarName(surface: ChatComposerSurfaceKey): string {
  return `--chat-composer-height-${surface}`
}

function readInitialComposerHeight(surface: ChatComposerSurfaceKey): number {
  const cached = cachedComposerHeightBySurface.get(surface) ?? 0
  if (cached > 0) return cached
  if (typeof document !== 'undefined') {
    const cssVar = readCssPxVar(composerCssVarName(surface))
    if (cssVar > 0) {
      cachedComposerHeightBySurface.set(surface, cssVar)
      return cssVar
    }
  }
  return DEFAULT_COMPOSER_PADDING
}

function writeMeasuredComposerHeight(surface: ChatComposerSurfaceKey, height: number): void {
  cachedComposerHeightBySurface.set(surface, height)
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty(composerCssVarName(surface), `${height}px`)
  }
}

export interface UseChatComposerChromeOptions {
  isMobile: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  composerRef: RefObject<HTMLDivElement | null>
  /**
   * Which chat surface this composer belongs to. Required: the cache and
   * CSS var are keyed per-surface so DM and group don't seed each other
   * with a slightly wrong height on first render.
   */
  surfaceKey: ChatComposerSurfaceKey
  onLayoutNudge?: () => void
}

export function useChatComposerChrome({
  isMobile,
  textareaRef,
  composerRef,
  surfaceKey,
  onLayoutNudge,
}: UseChatComposerChromeOptions) {
  const onLayoutNudgeRef = useRef(onLayoutNudge)
  onLayoutNudgeRef.current = onLayoutNudge

  const [keyboardOffset, setKeyboardOffset] = useState(0)
  // Seed from the per-surface cached measured height (or
  // `--chat-composer-height-${surface}` CSS var) so the first paint already
  // reflects the real composer card size for THIS surface. Without per-
  // surface keying, DM and group seeded each other on cross-surface
  // navigation, ResizeObserver corrected post-paint, and the inverted list
  // visibly drifted upward by 1–4px.
  const [composerHeight, setComposerHeight] = useState(() => readInitialComposerHeight(surfaceKey))
  // Seed from the live CSS var so the first paint already includes the
  // bottom safe-area inset (prevents a post-paint vertical shift in the
  // inverted chat list on iOS notch devices).
  const [safeBottomPx, setSafeBottomPx] = useState(readSafeBottomPxOnce)
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

    let observer: ResizeObserver | null = null
    let rafId: number | null = null
    let observedNode: HTMLDivElement | null = null

    const measureAndCache = (node: HTMLDivElement) => {
      const height = node.getBoundingClientRect().height
      if (!height) return
      writeMeasuredComposerHeight(surfaceKey, height)
      setComposerHeight(prev => (Math.abs(prev - height) < 1 ? prev : height))
    }

    const attach = () => {
      const node = composerCardRef.current
      if (!node) {
        // The composer is portaled to document.body; on some renders its ref
        // attaches on a later microtask. Retry on the next animation frame
        // instead of leaving `composerHeight` stuck at the placeholder.
        rafId = requestAnimationFrame(attach)
        return
      }
      observedNode = node
      measureAndCache(node)
      observer = new ResizeObserver(() => {
        if (observedNode) measureAndCache(observedNode)
      })
      observer.observe(node)
    }

    attach()

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      observer?.disconnect()
    }
    // `surfaceKey` is stable per page mount (DM page always passes 'dm',
    // group always 'group'), but included to keep measureAndCache's closure
    // honest against the lint rule.
  }, [surfaceKey])

  useLayoutEffect(() => {
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

  // Android: content wrapper already clamps to visualViewport.height above the IME;
  // do not add keyboard lift again as list padding (double-counts and hides messages).
  const bottomChromeInset = androidKeyboardOpen
    ? 0
    : displayKeyboardLift > 0
      ? displayKeyboardLift
      : safeBottomPx
  const bottomInsetPx = bottomChromeInset + effectiveComposerHeight + CHAT_COMPOSER_GAP_PX
  const listPaddingBottom = `${bottomInsetPx}px`
  const listScrollPaddingBottom = listPaddingBottom
  const scrollButtonBottom = `${bottomChromeInset + effectiveComposerHeight + 12}px`
  const keyboardIsOpen = keyboardLift > 0 || androidKeyboardOpen
  /**
   * True when the keyboard system is fully at rest (closed, not animating
   * open, not in iOS smoothing tail). Thread pages toggle the
   * `chat-list-idle-smooth` CSS class on the inverted list with this flag so
   * post-paint inset settles (composer remeasure, safe-area sync, active-use
   * chrome growth) ease over the same 250ms curve as `chat-composer-spacer-
   * smooth`, while keyboard motion (JS-smoothed in `useSmoothedPx`) stays
   * tick-precise — gating the transition off whenever the keyboard is at all
   * engaged prevents the CSS interpolation from lagging behind the JS-driven
   * composer card position.
   */
  const insetMotionIdle =
    !androidKeyboardOpen &&
    keyboardLift === 0 &&
    Math.abs(displayKeyboardLift) < 0.5

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

  const dismissComposerKeyboard = useCallback(() => {
    if (textareaRef.current && document.activeElement === textareaRef.current) {
      textareaRef.current.blur()
    }
    if (Capacitor.isNativePlatform()) {
      Keyboard.hide().catch(() => {})
    }
  }, [textareaRef])

  const touchDismiss = useTouchDismiss({
    showKeyboard: keyboardIsOpen,
    composerRef,
    textareaRef,
    dismissComposerKeyboard,
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
      dismissComposerKeyboard()
    },
    [composerRef, textareaRef, touchDismiss.touchDismissRef, dismissComposerKeyboard],
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
    insetMotionIdle,
    handleContentPointerDown: touchDismiss.handleContentPointerDown,
    handleContentPointerMove: touchDismiss.handleContentPointerMove,
    handleContentPointerUp,
    handleContentPointerCancel: touchDismiss.handleContentPointerCancel,
    dismissComposerKeyboard,
    noteComposerFocus,
    touchDismissRef: touchDismiss.touchDismissRef,
  }
}
