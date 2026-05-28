import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { PAGE_TRANSITION_MS, TAB_CROSSFADE_MS, CPOINT_EASE_OUT, REDUCED_MOTION_FADE_MS } from '../design/motion'
import { detectTransitionType } from './pageTransitionUtils'

const TRANSITIONS_ENABLED = import.meta.env.VITE_PAGE_TRANSITIONS === 'true'

type TransitionType = 'push' | 'pop' | 'tab' | 'none'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface PageTransitionStackProps {
  children: ReactNode
  /** Called when a push/pop/tab animation finishes (for deferred scroll reset). */
  onTransitionEnd?: () => void
}

/**
 * Wraps route content and applies CSS transitions between navigations.
 * Only active when VITE_PAGE_TRANSITIONS=true.
 * When disabled, renders children directly with no wrapper overhead.
 */
export default function PageTransitionStack({ children, onTransitionEnd }: PageTransitionStackProps) {
  const location = useLocation()
  const navigationType = useNavigationType()
  const prevPathRef = useRef(location.pathname)
  const snapshotRef = useRef<{ path: string; content: ReactNode }>({
    path: location.pathname,
    content: children,
  })
  const [transitioning, setTransitioning] = useState(false)
  const [transitionType, setTransitionType] = useState<TransitionType>('none')
  const [outgoing, setOutgoing] = useState<ReactNode>(null)

  // Hold the latest children + callback in refs so a mid-transition re-render
  // (e.g. async feed data arriving) cannot re-run the effect and cancel the
  // completion timer. Deps below intentionally exclude `children`/`onTransitionEnd`.
  const childrenRef = useRef(children)
  childrenRef.current = children
  const onTransitionEndRef = useRef(onTransitionEnd)
  onTransitionEndRef.current = onTransitionEnd

  // The active completion timer (fallback for animationend) lives in a ref so it
  // survives re-renders and can be cleared by the next transition or animationend.
  const timerRef = useRef<number | null>(null)

  const finishTransition = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setTransitioning(false)
    setOutgoing(null)
    if (typeof document !== 'undefined') {
      document.documentElement.classList.remove('page-transition-active')
    }
    onTransitionEndRef.current?.()
  }

  useLayoutEffect(() => {
    const prevPath = prevPathRef.current
    const nextPath = location.pathname
    if (prevPath === nextPath) {
      snapshotRef.current = { path: nextPath, content: childrenRef.current }
      return
    }

    const type = detectTransitionType(prevPath, nextPath, navigationType, TRANSITIONS_ENABLED)
    prevPathRef.current = nextPath

    // Any path change must clear a lingering transition so we can never get
    // stuck off-screen (the bug that blanked feed/DM/group-chat/post-reply).
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (type === 'none') {
      snapshotRef.current = { path: nextPath, content: childrenRef.current }
      setTransitioning(false)
      setOutgoing(null)
      if (typeof document !== 'undefined') {
        document.documentElement.classList.remove('page-transition-active')
      }
      queueMicrotask(() => onTransitionEndRef.current?.())
      return
    }

    setOutgoing(snapshotRef.current.content)
    setTransitionType(type)
    setTransitioning(true)
    snapshotRef.current = { path: nextPath, content: childrenRef.current }

    if (typeof document !== 'undefined') {
      document.documentElement.classList.add('page-transition-active')
    }

    const duration = prefersReducedMotion()
      ? REDUCED_MOTION_FADE_MS
      : type === 'tab'
        ? TAB_CROSSFADE_MS
        : PAGE_TRANSITION_MS

    // Primary completion signal is the incoming element's animationend; this
    // timer is only a fallback (extra slack) in case animationend never fires.
    timerRef.current = window.setTimeout(finishTransition, duration + 80)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, navigationType])

  useLayoutEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  if (!TRANSITIONS_ENABLED) {
    return <>{children}</>
  }

  const reduced = prefersReducedMotion()
  const duration = transitionType === 'tab' ? TAB_CROSSFADE_MS : PAGE_TRANSITION_MS
  const durationMs = reduced ? REDUCED_MOTION_FADE_MS : duration

  return (
    <div className="page-transition-container" style={{ position: 'relative', overflow: 'hidden' }}>
      {transitioning && outgoing && (
        <div
          className="page-transition-outgoing"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            pointerEvents: 'none',
            animation: reduced
              ? `ptFadeOut ${durationMs}ms linear forwards`
              : transitionType === 'tab'
                ? `ptFadeOut ${durationMs}ms ${CPOINT_EASE_OUT} forwards`
                : transitionType === 'pop'
                  ? `ptSlideOutRight ${durationMs}ms ${CPOINT_EASE_OUT} forwards`
                  : `ptSlideOutLeft ${durationMs}ms ${CPOINT_EASE_OUT} forwards`,
          }}
        >
          {outgoing}
        </div>
      )}
      <div
        className="page-transition-incoming"
        onAnimationEnd={(e) => {
          // Ignore bubbled animationend events from child page content.
          if (transitioning && e.target === e.currentTarget) finishTransition()
        }}
        style={{
          position: transitioning ? 'relative' : 'static',
          zIndex: transitioning ? 2 : 'auto',
          animation: transitioning
            ? reduced
              ? `ptFadeIn ${durationMs}ms linear forwards`
              : transitionType === 'tab'
                ? `ptFadeIn ${durationMs}ms ${CPOINT_EASE_OUT} forwards`
                : transitionType === 'pop'
                  ? `ptSlideInLeft ${durationMs}ms ${CPOINT_EASE_OUT} forwards`
                  : `ptSlideInRight ${durationMs}ms ${CPOINT_EASE_OUT} forwards`
            : 'none',
        }}
      >
        {children}
      </div>
    </div>
  )
}
