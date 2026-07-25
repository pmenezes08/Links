import { useCallback, useEffect, useRef } from 'react'
import { CPOINT_EASE_OUT } from '../design/motion'

/** Touch must start within this many px of the left edge to arm the gesture.
 * Narrow on purpose: message bubbles own rightward drags (SwipeToReply), so
 * only an edge-anchored pull may mean "go back". */
const EDGE_ACTIVATION_PX = 26
/** Horizontal travel before we decide this is a back-swipe and not a scroll. */
const DIRECTION_LOCK_PX = 10
/** Past this fraction of the viewport, releasing commits the navigation. */
const COMMIT_FRACTION = 0.28
const COMMIT_MIN_PX = 72
/** A quick flick commits even when short. */
const COMMIT_VELOCITY_PX_PER_MS = 0.45
const SETTLE_MS = 220
const COMMIT_MS = 180

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Interactive controls keep their own gestures — never hijack a touch that
 * starts on one (mirrors `touchDismissTargetIsInteractive` in hooks.ts). */
function targetIsInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return !!target.closest('button, a, input, textarea, select, [role="button"], [contenteditable="true"]')
}

/** The composer is portaled to <body>, so it must be translated alongside the
 * page or it would sit still while the thread slides away. */
function composerEl(): HTMLElement | null {
  try {
    return document.querySelector<HTMLElement>('.chat-composer-smooth')
  } catch {
    return null
  }
}

const UNDERLAY_ID = 'chat-edge-swipe-underlay'
const UNDERLAY_MAX_DIM = 0.22

/** iOS-style underlay behind the dragged card: the app surface with a scrim
 * that lightens as the pull progresses. Without it the reveal is a bare
 * blank strip and the gesture reads as the app breaking. */
function ensureUnderlay(): HTMLElement {
  let el = document.getElementById(UNDERLAY_ID) as HTMLElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = UNDERLAY_ID
    el.style.position = 'fixed'
    el.style.inset = '0'
    el.style.zIndex = '40'
    el.style.pointerEvents = 'none'
    el.style.background = 'var(--c-bg-app, #000)'
    const scrim = document.createElement('div')
    scrim.style.position = 'absolute'
    scrim.style.inset = '0'
    scrim.style.background = '#000'
    scrim.style.opacity = String(UNDERLAY_MAX_DIM)
    el.appendChild(scrim)
    document.body.appendChild(el)
  }
  return el
}

function setUnderlayProgress(progress: number, transitionMs: number) {
  const el = document.getElementById(UNDERLAY_ID)
  const scrim = el?.firstElementChild as HTMLElement | undefined
  if (!scrim) return
  scrim.style.transition = transitionMs > 0 ? `opacity ${transitionMs}ms ${CPOINT_EASE_OUT}` : ''
  scrim.style.opacity = String(UNDERLAY_MAX_DIM * (1 - Math.min(1, Math.max(0, progress))))
}

function removeUnderlay() {
  document.getElementById(UNDERLAY_ID)?.remove()
}

function applyOffset(page: HTMLElement | null, x: number, transitionMs: number) {
  const composer = composerEl()
  const transition = transitionMs > 0 ? `transform ${transitionMs}ms ${CPOINT_EASE_OUT}` : ''
  if (page) {
    page.style.transition = transition
    page.style.transform = x === 0 ? '' : `translate3d(${x}px, 0, 0)`
    // Card depth: shadow on the leading edge while off home position.
    page.style.boxShadow = x === 0 ? '' : '-16px 0 32px rgba(0, 0, 0, 0.35)'
  }
  if (composer) {
    // Web centres the composer with `left-1/2 -translate-x-1/2`; preserve it.
    const centred = composer.classList.contains('left-1/2')
    composer.style.transition = transition
    if (x === 0) composer.style.transform = ''
    else composer.style.transform = centred ? `translateX(calc(-50% + ${x}px))` : `translate3d(${x}px, 0, 0)`
  }
}

function clearOffset(page: HTMLElement | null) {
  const composer = composerEl()
  if (page) {
    page.style.transition = ''
    page.style.transform = ''
    page.style.willChange = ''
    page.style.boxShadow = ''
    page.style.zIndex = ''
  }
  if (composer) {
    composer.style.transition = ''
    composer.style.transform = ''
    composer.style.willChange = ''
  }
  removeUnderlay()
}

export type EdgeSwipeBackOptions = {
  /** Where the gesture takes the user. */
  onBack: () => void
  /** Turn off while a modal, selection mode or media viewer owns the screen. */
  enabled?: boolean
}

/**
 * iOS/X-style edge-swipe-back for the chat thread surfaces.
 *
 * Attach the returned ref to the page's root element. A touch starting at the
 * left edge and dragged right pulls the thread (and its portaled composer)
 * across; releasing past the threshold calls `onBack`, otherwise it springs
 * home.
 *
 * The gesture is claimed in the **capture** phase so descendant handlers —
 * `SwipeToReply` (which also reads rightward drags), `LongPressActionable`,
 * and the touch-dismiss tracker — never arm for the same touch. Transforms are
 * written imperatively and removed on settle, so at rest the DOM is exactly as
 * it was: no lingering transform to create a containing block for the fixed
 * header or shift the inverted list's inset math.
 */
export function useEdgeSwipeBack({ onBack, enabled = true }: EdgeSwipeBackOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  const stateRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    lastX: number
    lastT: number
    velocity: number
    locked: boolean
    dragging: boolean
  } | null>(null)

  const finish = useCallback((commit: boolean) => {
    const page = containerRef.current
    const state = stateRef.current
    stateRef.current = null
    if (!state) return
    if (!state.dragging) {
      clearOffset(page)
      return
    }
    if (commit) {
      const width = window.innerWidth || 400
      applyOffset(page, width, prefersReducedMotion() ? 0 : COMMIT_MS)
      setUnderlayProgress(1, prefersReducedMotion() ? 0 : COMMIT_MS)
      window.setTimeout(() => {
        clearOffset(page)
        onBackRef.current()
      }, prefersReducedMotion() ? 0 : COMMIT_MS)
      return
    }
    applyOffset(page, 0, prefersReducedMotion() ? 0 : SETTLE_MS)
    setUnderlayProgress(0, prefersReducedMotion() ? 0 : SETTLE_MS)
    window.setTimeout(() => clearOffset(page), prefersReducedMotion() ? 0 : SETTLE_MS)
  }, [])

  useEffect(() => {
    const node = containerRef.current
    if (!node || !enabled) return

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' || !event.isPrimary) return
      if (event.clientX > EDGE_ACTIVATION_PX) return
      if (targetIsInteractive(event.target)) return
      stateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastT: event.timeStamp,
        velocity: 0,
        locked: false,
        dragging: false,
      }
      // Own the touch: bubble drags and long-press must not also react.
      event.stopPropagation()
    }

    const onPointerMove = (event: PointerEvent) => {
      const state = stateRef.current
      if (!state || state.pointerId !== event.pointerId) return
      const dx = event.clientX - state.startX
      const dy = event.clientY - state.startY

      if (!state.locked) {
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > DIRECTION_LOCK_PX) {
          // Vertical intent — hand the touch back to the scroller.
          stateRef.current = null
          return
        }
        if (dx < DIRECTION_LOCK_PX) return
        state.locked = true
        state.dragging = true
        const page = containerRef.current
        if (page) {
          page.style.willChange = 'transform'
          // Lift the card above the underlay for the duration of the drag.
          page.style.zIndex = '50'
        }
        const composer = composerEl()
        if (composer) composer.style.willChange = 'transform'
        if (!prefersReducedMotion()) ensureUnderlay()
      }

      const dt = Math.max(1, event.timeStamp - state.lastT)
      state.velocity = (event.clientX - state.lastX) / dt
      state.lastX = event.clientX
      state.lastT = event.timeStamp

      event.stopPropagation()
      if (event.cancelable) event.preventDefault()
      if (!prefersReducedMotion()) {
        // Rubber-band past the viewport so the pull always feels attached.
        const width = window.innerWidth || 400
        applyOffset(containerRef.current, Math.min(dx, width), 0)
        // Undim the surface below as the pull progresses (iOS parallax cue).
        setUnderlayProgress(dx / width, 0)
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      const state = stateRef.current
      if (!state || state.pointerId !== event.pointerId) return
      const dx = event.clientX - state.startX
      const width = window.innerWidth || 400
      const threshold = Math.max(COMMIT_MIN_PX, width * COMMIT_FRACTION)
      const commit = state.dragging && (dx > threshold || state.velocity > COMMIT_VELOCITY_PX_PER_MS)
      if (state.dragging) event.stopPropagation()
      finish(commit)
    }

    const onPointerCancel = (event: PointerEvent) => {
      const state = stateRef.current
      if (!state || state.pointerId !== event.pointerId) return
      finish(false)
    }

    const opts = { capture: true } as const
    node.addEventListener('pointerdown', onPointerDown, opts)
    node.addEventListener('pointermove', onPointerMove, { capture: true, passive: false })
    node.addEventListener('pointerup', onPointerUp, opts)
    node.addEventListener('pointercancel', onPointerCancel, opts)
    return () => {
      node.removeEventListener('pointerdown', onPointerDown, opts)
      node.removeEventListener('pointermove', onPointerMove, { capture: true } as any)
      node.removeEventListener('pointerup', onPointerUp, opts)
      node.removeEventListener('pointercancel', onPointerCancel, opts)
      stateRef.current = null
      clearOffset(containerRef.current)
    }
  }, [enabled, finish])

  return containerRef
}
