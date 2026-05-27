import { useRef, useState, useEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { PAGE_TRANSITION_MS, TAB_CROSSFADE_MS, CPOINT_EASE_OUT, REDUCED_MOTION_FADE_MS } from '../design/motion'
import { isPremiumDashboardPath, isAboutCPointPath } from './DashboardBottomNav'

const TRANSITIONS_ENABLED = import.meta.env.VITE_PAGE_TRANSITIONS === 'true'

type TransitionType = 'push' | 'pop' | 'tab' | 'none'

function isDashboardTab(path: string) {
  return isPremiumDashboardPath(path) || path === '/feed' || isAboutCPointPath(path)
}

function detectTransitionType(prev: string, next: string): TransitionType {
  if (!TRANSITIONS_ENABLED) return 'none'
  if (prev === next) return 'none'
  if (isDashboardTab(prev) && isDashboardTab(next)) return 'tab'
  return 'push'
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface PageTransitionStackProps {
  children: ReactNode
}

/**
 * Wraps route content and applies CSS transitions between navigations.
 * Only active when VITE_PAGE_TRANSITIONS=true.
 * When disabled, renders children directly with no wrapper overhead.
 */
export default function PageTransitionStack({ children }: PageTransitionStackProps) {
  const location = useLocation()
  const prevPathRef = useRef(location.pathname)
  const [transitioning, setTransitioning] = useState(false)
  const [transitionType, setTransitionType] = useState<TransitionType>('none')
  const [outgoing, setOutgoing] = useState<ReactNode>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const childRef = useRef<ReactNode>(children)

  useEffect(() => {
    childRef.current = children
  })

  useEffect(() => {
    const prev = prevPathRef.current
    prevPathRef.current = location.pathname
    const type = detectTransitionType(prev, location.pathname)
    if (type === 'none') return

    setOutgoing(childRef.current)
    setTransitionType(type)
    setTransitioning(true)

    const duration = prefersReducedMotion()
      ? REDUCED_MOTION_FADE_MS
      : type === 'tab'
        ? TAB_CROSSFADE_MS
        : PAGE_TRANSITION_MS

    const timer = setTimeout(() => {
      setTransitioning(false)
      setOutgoing(null)
    }, duration)

    return () => clearTimeout(timer)
  }, [location.pathname])

  if (!TRANSITIONS_ENABLED) {
    return <>{children}</>
  }

  const reduced = prefersReducedMotion()
  const duration = transitionType === 'tab' ? TAB_CROSSFADE_MS : PAGE_TRANSITION_MS
  const durationMs = reduced ? REDUCED_MOTION_FADE_MS : duration

  return (
    <div ref={containerRef} className="page-transition-container" style={{ position: 'relative', overflow: 'hidden' }}>
      {transitioning && outgoing && (
        <div
          className="page-transition-outgoing"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            animation: reduced
              ? `ptFadeOut ${durationMs}ms linear forwards`
              : transitionType === 'tab'
                ? `ptFadeOut ${durationMs}ms ${CPOINT_EASE_OUT} forwards`
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
                : `ptSlideInRight ${durationMs}ms ${CPOINT_EASE_OUT} forwards`
            : 'none',
        }}
      >
        {children}
      </div>
    </div>
  )
}
