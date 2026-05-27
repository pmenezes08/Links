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

  useLayoutEffect(() => {
    const prevPath = prevPathRef.current
    const nextPath = location.pathname
    if (prevPath === nextPath) {
      snapshotRef.current = { path: nextPath, content: children }
      return
    }

    const type = detectTransitionType(prevPath, nextPath, navigationType, TRANSITIONS_ENABLED)
    prevPathRef.current = nextPath

    if (type === 'none') {
      snapshotRef.current = { path: nextPath, content: children }
      queueMicrotask(() => onTransitionEnd?.())
      return
    }

    setOutgoing(snapshotRef.current.content)
    setTransitionType(type)
    setTransitioning(true)
    snapshotRef.current = { path: nextPath, content: children }

    if (typeof document !== 'undefined') {
      document.documentElement.classList.add('page-transition-active')
    }

    const duration = prefersReducedMotion()
      ? REDUCED_MOTION_FADE_MS
      : type === 'tab'
        ? TAB_CROSSFADE_MS
        : PAGE_TRANSITION_MS

    const timer = window.setTimeout(() => {
      setTransitioning(false)
      setOutgoing(null)
      if (typeof document !== 'undefined') {
        document.documentElement.classList.remove('page-transition-active')
      }
      onTransitionEnd?.()
    }, duration)

    return () => window.clearTimeout(timer)
  }, [location.pathname, navigationType, children, onTransitionEnd])

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
