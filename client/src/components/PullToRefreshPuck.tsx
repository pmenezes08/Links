import { PAGE_TRANSITION_MS, CPOINT_EASE_OUT, REDUCED_MOTION_FADE_MS } from '../design/motion'

const PUCK_SIZE = 40
const SETTLE_Y = 60

type PullToRefreshPuckProps = {
  /** Current drag distance in px (0 = hidden, clamped to 80 by caller). */
  dragY: number
  /** True while the refresh fetch is in flight. */
  refreshing: boolean
  /** True when the puck is springing back after release. */
  settling: boolean
}

const prefersReducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function PullToRefreshPuck({ dragY, refreshing, settling }: PullToRefreshPuckProps) {
  const visible = dragY > 0 || refreshing

  if (!visible) return null

  const translateY = refreshing ? SETTLE_Y : dragY
  const progress = Math.min(dragY / SETTLE_Y, 1)

  const transitionValue =
    settling || refreshing
      ? prefersReducedMotion
        ? `opacity ${REDUCED_MOTION_FADE_MS}ms ease`
        : `transform ${PAGE_TRANSITION_MS}ms ${CPOINT_EASE_OUT}, opacity ${PAGE_TRANSITION_MS}ms ${CPOINT_EASE_OUT}`
      : 'none'

  const puckStyle: React.CSSProperties = prefersReducedMotion
    ? { opacity: visible ? 1 : 0, transition: transitionValue }
    : { transform: `translateY(${translateY}px)`, opacity: 1, transition: transitionValue }

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center"
      style={puckStyle}
    >
      <div
        className="flex items-center justify-center rounded-full border border-white/10"
        style={{
          width: PUCK_SIZE,
          height: PUCK_SIZE,
          background: 'rgba(12, 12, 16, 0.72)',
          backdropFilter: 'blur(32px) saturate(140%)',
          WebkitBackdropFilter: 'blur(32px) saturate(140%)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        }}
      >
        <svg
          width={20}
          height={20}
          viewBox="0 0 20 20"
          className={refreshing ? 'animate-spin' : ''}
          style={
            !refreshing
              ? { transform: `rotate(${progress * 270}deg)`, transition: 'none' }
              : undefined
          }
        >
          <circle
            cx={10}
            cy={10}
            r={8}
            fill="none"
            stroke="rgba(0, 206, 200, 0.25)"
            strokeWidth={2}
          />
          <circle
            cx={10}
            cy={10}
            r={8}
            fill="none"
            stroke="#00CEC8"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={50.26}
            strokeDashoffset={refreshing ? 12.57 : 50.26 - progress * 37.7}
          />
        </svg>
      </div>
    </div>
  )
}
