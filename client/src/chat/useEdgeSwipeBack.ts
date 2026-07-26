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
/** A leftward flick cancels even when past the distance threshold (iOS). */
const CANCEL_VELOCITY_PX_PER_MS = -0.25
/** Spring-home duration scales with remaining distance inside these bounds. */
const SETTLE_MIN_MS = 120
const SETTLE_MAX_MS = 260
/** Commit exit slide duration, matched to release velocity inside these bounds. */
const EXIT_MIN_MS = 120
const EXIT_MAX_MS = 260
/** Slowest velocity used when deriving the exit duration from a gentle release. */
const EXIT_FLOOR_VELOCITY = 0.9
const DRAG_SHADOW = '-16px 0 32px rgba(0, 0, 0, 0.35)'
/** Message rows whose bottom sits further above the viewport than this are
 * dropped from the exit clone — cloning a 300-row thread in the release frame
 * is what used to hitch the commit. */
const PRUNE_ABOVE_BUFFER_PX = 100

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

const UNDERLAY_ID = 'chat-edge-swipe-underlay'
const EXIT_OVERLAY_ID = 'chat-edge-swipe-exit'

/** The composer is portaled to <body>, so it must be translated alongside the
 * page or it would sit still while the thread slides away. The exit overlay's
 * clone keeps the same class — skip it, only the live composer counts. */
function composerEl(): HTMLElement | null {
  try {
    const candidates = document.querySelectorAll<HTMLElement>('.chat-composer-smooth')
    for (const el of candidates) {
      if (!el.closest(`#${EXIT_OVERLAY_ID}`)) return el
    }
    return null
  } catch {
    return null
  }
}
const UNDERLAY_MAX_DIM = 0.22

/** True while a committed exit clone is animating off-screen. The unmount
 * cleanup must leave the underlay alone during that window — the exit
 * finalizer owns it — otherwise the scrim pops out the moment the thread
 * unmounts and the undim fade never plays. */
let exitInFlight = false

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
    // Its opacity is driven per-frame during the drag — keep it composite-only.
    scrim.style.willChange = 'opacity'
    el.appendChild(scrim)
    document.body.appendChild(el)
  }
  return el
}

function underlayScrim(): HTMLElement | null {
  return (document.getElementById(UNDERLAY_ID)?.firstElementChild as HTMLElement | undefined) ?? null
}

function setScrimProgress(scrim: HTMLElement | null, progress: number, transitionMs: number) {
  if (!scrim) return
  const transition = transitionMs > 0 ? `opacity ${transitionMs}ms ${CPOINT_EASE_OUT}` : ''
  if (scrim.style.transition !== transition) scrim.style.transition = transition
  scrim.style.opacity = String(UNDERLAY_MAX_DIM * (1 - Math.min(1, Math.max(0, progress))))
}

function removeUnderlay() {
  document.getElementById(UNDERLAY_ID)?.remove()
}

function removeExitOverlay() {
  document.getElementById(EXIT_OVERLAY_ID)?.remove()
  exitInFlight = false
}

function composerTransform(centred: boolean, x: number): string {
  if (x === 0) return ''
  return centred ? `translateX(calc(-50% + ${x}px))` : `translate3d(${x}px, 0, 0)`
}

/** Restore the live page + composer to their untouched resting state. */
function clearNodeStyles(page: HTMLElement | null, composer: HTMLElement | null) {
  if (page) {
    page.style.transition = ''
    page.style.transform = ''
    page.style.willChange = ''
    page.style.boxShadow = ''
    page.style.zIndex = ''
    page.style.userSelect = ''
    ;(page.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = ''
  }
  if (composer) {
    composer.style.transition = ''
    composer.style.transform = ''
    composer.style.willChange = ''
  }
}

/**
 * Build the exit overlay: static visual clones of the page card and the
 * portaled composer, frozen at the release position, that slide the rest of
 * the way off-screen ABOVE the destination page. This is what lets the commit
 * navigate synchronously (the founder-ratified invariant: the real page must
 * never be left translated over a backdrop) while the user still sees the
 * card finish its slide like a native pop.
 */
function buildExitOverlay(page: HTMLElement, composer: HTMLElement | null): {
  overlay: HTMLElement
  pageClone: HTMLElement
  composerClone: HTMLElement | null
} | null {
  try {
    removeExitOverlay()
    const overlay = document.createElement('div')
    overlay.id = EXIT_OVERLAY_ID
    overlay.style.position = 'fixed'
    overlay.style.inset = '0'
    overlay.style.zIndex = '2000'
    overlay.style.pointerEvents = 'none'
    overlay.setAttribute('aria-hidden', 'true')

    // Batched rect reads over the LIVE rows first (layout is clean here — the
    // drag only wrote transforms), so the clone can shed the off-screen tail
    // of the thread before it is appended and painted. Column-reverse anchors
    // content to the visual bottom, so dropping rows that sit entirely above
    // the viewport shifts nothing that is visible and keeps the scrollTop
    // mirroring below byte-for-byte correct.
    const liveRows = page.querySelectorAll('[data-message-id]')
    const prunedIdx: number[] = []
    liveRows.forEach((row, i) => {
      if (row.getBoundingClientRect().bottom < -PRUNE_ABOVE_BUFFER_PX) prunedIdx.push(i)
    })

    const pageClone = page.cloneNode(true) as HTMLElement
    const composerClone = composer ? (composer.cloneNode(true) as HTMLElement) : null
    if (prunedIdx.length) {
      const cloneRows = pageClone.querySelectorAll('[data-message-id]')
      for (const i of prunedIdx) cloneRows[i]?.remove()
    }

    // The clones are throwaway pixels: strip ids so nothing can query into
    // them, disarm media so nothing refetches mid-slide (a cloned <video>
    // re-runs resource selection from scratch — it would issue network
    // requests and still paint black), and mirror live-only state cloneNode
    // misses (scroll offsets of the message list, typed composer text).
    const cleanup = (clone: HTMLElement) => {
      clone.removeAttribute('id')
      clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'))
      clone.querySelectorAll('video, audio').forEach(el => {
        el.removeAttribute('autoplay')
        el.removeAttribute('src')
        el.setAttribute('preload', 'none')
        el.querySelectorAll('source').forEach(source => source.remove())
      })
    }
    cleanup(pageClone)
    if (composerClone) cleanup(composerClone)

    const origAreas = (composer ?? page).querySelectorAll('textarea')
    const cloneAreas = (composerClone ?? pageClone).querySelectorAll('textarea')
    origAreas.forEach((area, i) => {
      const target = cloneAreas[i]
      if (target) target.value = area.value
    })

    overlay.appendChild(pageClone)
    if (composerClone) overlay.appendChild(composerClone)
    document.body.appendChild(overlay)

    // Scroll offsets only apply once the clone is in the DOM.
    const origScrollers = page.querySelectorAll('.chat-list-inset')
    const cloneScrollers = pageClone.querySelectorAll('.chat-list-inset')
    origScrollers.forEach((scroller, i) => {
      const target = cloneScrollers[i]
      if (target) target.scrollTop = scroller.scrollTop
    })

    return { overlay, pageClone, composerClone }
  } catch {
    removeExitOverlay()
    return null
  }
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
 * home. The card can be caught mid-spring and re-dragged.
 *
 * Motion contract (all of these are deliberate — do not regress):
 * - The gesture is claimed in the **capture** phase so descendant handlers —
 *   `SwipeToReply` (which also reads rightward drags), `LongPressActionable`,
 *   and the touch-dismiss tracker — never arm for the same touch.
 * - A non-passive capture `touchmove` listener preventDefaults
 *   horizontal-leaning frames while the gesture is armed. `preventDefault` on
 *   POINTER moves cannot stop native scrolling, so without this WebKit claims
 *   the pan mid-drag and fires `pointercancel` — the card would spring back
 *   under the user's finger. Vertical-leaning frames are never prevented, so
 *   list scrolling stays fully native.
 * - Style writes are rAF-batched, one transform per frame; expensive one-time
 *   work happens off the hot path: layer promotion at arm (so rasterization
 *   overlaps the 10px lock travel), underlay creation and composer lookup at
 *   direction-lock, the shadow one frame later — never per-move.
 * - **Commit navigates synchronously on release** (founder-ratified: an exit
 *   animation on the LIVE page followed by a deferred navigate once stranded
 *   the page translated off-screen over a bare backdrop). The exit slide the
 *   user sees is a static clone in a self-removing overlay ABOVE the freshly
 *   painted destination; the real page is never left translated.
 * - Transforms are removed on settle, so at rest the DOM is exactly as it
 *   was: no lingering transform to create a containing block for the fixed
 *   header or shift the inverted list's inset math.
 */
export function useEdgeSwipeBack({ onBack, enabled = true }: EdgeSwipeBackOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  const stateRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    /** Offset already on the card when the gesture armed (mid-settle catch). */
    baseX: number
    lastX: number
    lastT: number
    velocity: number
    locked: boolean
    dragging: boolean
    /** Cached at lock so per-frame writes touch no DOM queries. */
    composer: HTMLElement | null
    composerCentred: boolean
    scrim: HTMLElement | null
    width: number
    reduced: boolean
    /** Last offset applied to the card (source of truth on release). */
    x: number
  } | null>(null)
  const rafRef = useRef(0)
  const settleRef = useRef<{ timer: number; fromX: number } | null>(null)

  const applyFrame = useCallback((x: number) => {
    const state = stateRef.current
    const page = containerRef.current
    if (!state || !page) return
    state.x = x
    page.style.transform = x === 0 ? '' : `translate3d(${x}px, 0, 0)`
    if (state.composer) state.composer.style.transform = composerTransform(state.composerCentred, x)
    if (state.scrim) setScrimProgress(state.scrim, x / state.width, 0)
  }, [])

  const scheduleFrame = useCallback(() => {
    if (rafRef.current) return
    const run = () => {
      rafRef.current = 0
      const state = stateRef.current
      if (!state || !state.dragging) return
      const target = Math.min(Math.max(state.baseX + (state.lastX - state.startX), 0), state.width)
      applyFrame(target)
    }
    if (typeof requestAnimationFrame === 'function') {
      rafRef.current = requestAnimationFrame(run)
    } else {
      run()
    }
  }, [applyFrame])

  /** One-time drag setup: layer promotion, depth shadow, underlay, caches. */
  const beginDrag = useCallback((baseX: number) => {
    const state = stateRef.current
    const page = containerRef.current
    if (!state || !page) return
    state.locked = true
    state.dragging = true
    state.baseX = baseX
    state.width = window.innerWidth || 400
    page.style.transition = ''
    page.style.willChange = 'transform'
    // Lift the card above the underlay for the duration of the drag.
    page.style.zIndex = '50'
    page.style.userSelect = 'none'
    ;(page.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = 'none'
    // The 32px blur is invisible at 10px of travel — defer it off the lock
    // frame, which already pays for underlay creation and the first transform.
    const scheduleShadow = () => {
      if (stateRef.current?.dragging && containerRef.current) {
        containerRef.current.style.boxShadow = DRAG_SHADOW
      }
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(scheduleShadow)
    else scheduleShadow()
    const composer = composerEl()
    state.composer = composer
    state.composerCentred = !!composer?.classList.contains('left-1/2')
    if (composer) {
      composer.style.transition = ''
      composer.style.willChange = 'transform'
    }
    state.reduced = prefersReducedMotion()
    if (!state.reduced) {
      ensureUnderlay()
      state.scrim = underlayScrim()
    }
  }, [])

  const clearSettle = useCallback(() => {
    if (settleRef.current) {
      window.clearTimeout(settleRef.current.timer)
      settleRef.current = null
    }
  }, [])

  /** Committed release: clone the card, navigate NOW, slide the clone off. */
  const commitExit = useCallback((releaseX: number, velocity: number) => {
    const page = containerRef.current
    const state = stateRef.current
    stateRef.current = null
    if (!page || !state) return
    const width = state.width
    const remaining = Math.max(0, width - releaseX)
    const reduced = state.reduced
    const composer = state.composer

    if (reduced || remaining < 2) {
      clearNodeStyles(page, composer)
      removeUnderlay()
      onBackRef.current()
      return
    }

    // Keyboard starts hiding with the transition, like a native pop.
    try {
      ;(document.activeElement as HTMLElement | null)?.blur?.()
    } catch { /* no-op */ }

    const built = buildExitOverlay(page, composer)
    // Underlay must stop hiding the destination: keep only the scrim so the
    // undim fade finishes over the real Messages page.
    const underlay = document.getElementById(UNDERLAY_ID)
    if (underlay) underlay.style.background = 'transparent'

    if (!built) {
      clearNodeStyles(page, composer)
      removeUnderlay()
      onBackRef.current()
      return
    }
    exitInFlight = true

    // Navigate synchronously — destination paints from its device cache
    // beneath the overlay. The real page unmounts here.
    onBackRef.current()
    // Defensive: if anything kept the live page mounted, leave it at rest,
    // never translated. (removeUnderlay stays with the exit finalizer.)
    clearNodeStyles(page, composer)

    const { overlay, pageClone, composerClone } = built
    const duration = Math.min(
      EXIT_MAX_MS,
      Math.max(EXIT_MIN_MS, remaining / Math.max(velocity, EXIT_FLOOR_VELOCITY)),
    )
    // Freeze the start frame, then transition the remainder of the slide.
    pageClone.style.transform = `translate3d(${releaseX}px, 0, 0)`
    if (composerClone) composerClone.style.transform = composerTransform(state.composerCentred, releaseX)
    void overlay.offsetWidth
    const transition = `transform ${duration}ms ${CPOINT_EASE_OUT}`
    pageClone.style.transition = transition
    pageClone.style.transform = `translate3d(${width}px, 0, 0)`
    if (composerClone) {
      composerClone.style.transition = transition
      composerClone.style.transform = composerTransform(state.composerCentred, width)
    }
    setScrimProgress(underlayScrim(), 1, duration)

    let finalized = false
    const finalize = () => {
      if (finalized) return
      finalized = true
      removeExitOverlay()
      removeUnderlay()
    }
    pageClone.addEventListener('transitionend', finalize)
    // The destination's first render can stall the transition's first frame;
    // arm the precise fallback only once the slide actually starts, with a
    // generous commit-time backstop so the overlay can never strand.
    pageClone.addEventListener(
      'transitionstart',
      () => window.setTimeout(finalize, duration + 80),
      { once: true },
    )
    window.setTimeout(finalize, duration + 700)
  }, [])

  /** Cancelled release: spring home with distance-scaled duration. */
  const springHome = useCallback(() => {
    const page = containerRef.current
    const state = stateRef.current
    stateRef.current = null
    if (!page || !state) return
    const fromX = state.x
    const reduced = state.reduced
    const duration = reduced ? 0 : Math.min(SETTLE_MAX_MS, Math.max(SETTLE_MIN_MS, fromX * 0.6))
    const composer = state.composer
    const transition = duration > 0 ? `transform ${duration}ms ${CPOINT_EASE_OUT}` : ''
    page.style.transition = transition
    page.style.transform = ''
    if (composer) {
      composer.style.transition = transition
      composer.style.transform = ''
    }
    setScrimProgress(state.scrim, 0, duration)
    clearSettle()
    const timer = window.setTimeout(() => {
      settleRef.current = null
      clearNodeStyles(containerRef.current, composer)
      removeUnderlay()
    }, duration)
    settleRef.current = { timer, fromX }
  }, [clearSettle])

  const finish = useCallback((commit: boolean) => {
    const state = stateRef.current
    if (!state) return
    if (rafRef.current && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    if (!state.dragging) {
      stateRef.current = null
      const page = containerRef.current
      if (page && !settleRef.current) clearNodeStyles(page, null)
      return
    }
    // Land the final pointer position before deciding — the last rAF may not
    // have run yet.
    applyFrame(Math.min(Math.max(state.baseX + (state.lastX - state.startX), 0), state.width))
    if (commit) commitExit(state.x, state.velocity)
    else springHome()
  }, [applyFrame, commitExit, springHome])

  useEffect(() => {
    const node = containerRef.current
    if (!node || !enabled) return

    // preventDefault on pointermove cannot stop native scrolling — only a
    // non-passive touchmove can. Horizontal-leaning frames are prevented so
    // WebKit never claims the pan out from under a locked drag (that claim
    // fires pointercancel and snaps the card back mid-gesture). Vertical
    // frames pass through so list scrolling stays native. The listener is
    // attached only while a gesture is armed: a permanently attached
    // non-passive touchmove would make every scroll-start on the thread wait
    // on the main thread, for users who never touch the edge.
    const onTouchMove = (event: TouchEvent) => {
      const state = stateRef.current
      if (!state || !event.cancelable) return
      const touch = event.touches[0]
      if (!touch) return
      if (state.locked) {
        event.preventDefault()
        return
      }
      const dx = touch.clientX - state.startX
      const dy = Math.abs(touch.clientY - state.startY)
      if (dx > dy) event.preventDefault()
    }
    let touchMoveAttached = false
    const attachTouchMove = () => {
      if (touchMoveAttached) return
      touchMoveAttached = true
      node.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
    }
    const detachTouchMove = () => {
      if (!touchMoveAttached) return
      touchMoveAttached = false
      node.removeEventListener('touchmove', onTouchMove, { capture: true } as EventListenerOptions)
    }

    /** Current translate of the page while a settle transition is running. */
    const settlingCardX = (): number => {
      const page = containerRef.current
      if (!page || !settleRef.current) return 0
      try {
        const raw = getComputedStyle(page).transform
        if (!raw || raw === 'none') return 0
        const matrix = raw.match(/matrix(?:3d)?\(([^)]+)\)/)
        if (!matrix) return 0
        const parts = matrix[1].split(',').map(v => parseFloat(v))
        return (parts.length === 16 ? parts[12] : parts[4]) || 0
      } catch {
        return 0
      }
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' || !event.isPrimary) return
      // A stale exit overlay must never survive into a new gesture.
      if (!exitInFlight) removeExitOverlay()
      const settling = settleRef.current !== null
      if (!settling && event.clientX > EDGE_ACTIVATION_PX) return
      if (!settling && targetIsInteractive(event.target)) return
      stateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        baseX: 0,
        lastX: event.clientX,
        lastT: event.timeStamp,
        velocity: 0,
        locked: false,
        dragging: false,
        composer: null,
        composerCentred: false,
        scrim: null,
        width: window.innerWidth || 400,
        reduced: false,
        x: 0,
      }
      // Only armed touches pay for the blocking listener — at rest nothing
      // non-passive sits on the list's scroll path.
      attachTouchMove()
      // Pre-promote the card's layer while the finger travels the 10px lock
      // distance, so rasterization is done before the first drag frame.
      node.style.willChange = 'transform'
      if (settling) {
        // Catch the card mid-spring: freeze it where it is and keep dragging.
        const caughtX = settlingCardX()
        clearSettle()
        beginDrag(caughtX)
        applyFrame(Math.min(Math.max(caughtX, 0), stateRef.current.width))
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
          // Vertical intent — hand the touch back to the scroller (and undo
          // the speculative layer promotion; this branch is unreachable for a
          // mid-settle catch, which arms already locked).
          node.style.willChange = ''
          stateRef.current = null
          detachTouchMove()
          return
        }
        if (dx < DIRECTION_LOCK_PX) return
        beginDrag(0)
      }

      // Velocity as a time-aware exponential moving average — a single noisy
      // release frame must not decide commit-vs-cancel.
      const dt = Math.max(1, event.timeStamp - state.lastT)
      const instant = (event.clientX - state.lastX) / dt
      const alpha = 1 - Math.exp(-dt / 50)
      state.velocity = state.velocity + (instant - state.velocity) * alpha
      state.lastX = event.clientX
      state.lastT = event.timeStamp

      event.stopPropagation()
      if (!state.reduced) scheduleFrame()
    }

    const onPointerUp = (event: PointerEvent) => {
      const state = stateRef.current
      if (!state || state.pointerId !== event.pointerId) return
      detachTouchMove()
      const x = Math.min(Math.max(state.baseX + (event.clientX - state.startX), 0), state.width)
      const threshold = Math.max(COMMIT_MIN_PX, state.width * COMMIT_FRACTION)
      const flickCancel = state.velocity < CANCEL_VELOCITY_PX_PER_MS
      const flickCommit = state.velocity > COMMIT_VELOCITY_PX_PER_MS
      const commit = state.dragging && !flickCancel && (flickCommit || x > threshold)
      if (state.dragging) event.stopPropagation()
      state.lastX = event.clientX
      finish(commit)
    }

    const onPointerCancel = (event: PointerEvent) => {
      const state = stateRef.current
      if (!state || state.pointerId !== event.pointerId) return
      detachTouchMove()
      finish(false)
    }

    const opts = { capture: true } as const
    node.addEventListener('pointerdown', onPointerDown, opts)
    node.addEventListener('pointermove', onPointerMove, opts)
    node.addEventListener('pointerup', onPointerUp, opts)
    node.addEventListener('pointercancel', onPointerCancel, opts)
    return () => {
      node.removeEventListener('pointerdown', onPointerDown, opts)
      node.removeEventListener('pointermove', onPointerMove, opts)
      node.removeEventListener('pointerup', onPointerUp, opts)
      node.removeEventListener('pointercancel', onPointerCancel, opts)
      detachTouchMove()
      if (rafRef.current && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      const composer = stateRef.current?.composer ?? null
      stateRef.current = null
      clearSettle()
      clearNodeStyles(node, composer ?? composerEl())
      // During a committed exit the finalizer owns the underlay — removing it
      // here would pop the scrim out mid-slide (this cleanup runs the moment
      // the thread unmounts after onBack()).
      if (!exitInFlight) removeUnderlay()
    }
  }, [enabled, finish, beginDrag, applyFrame, clearSettle, scheduleFrame])

  return containerRef
}
