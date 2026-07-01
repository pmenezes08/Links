import { useEffect, type RefObject } from 'react'

export interface UseHorizontalSwipeLockOptions {
  /** Selector that marks a swipeable row. Touches starting inside a match get axis-locked. */
  selector?: string
  /** Min movement (px) before the gesture axis is decided. */
  threshold?: number
  enabled?: boolean
}

/**
 * Locks horizontal swipe-to-reveal rows to the horizontal axis inside a vertical
 * scroll container. iOS WKWebView does NOT honour `touch-action` to suppress the
 * vertical scroll of a `-webkit-overflow-scrolling: touch` momentum scroller while
 * a row is swiped sideways, so a diagonal/horizontal swipe drags the page up/down.
 *
 * React's synthetic `onTouchMove` is registered passive, so `preventDefault()` there
 * is a no-op. This attaches a single delegated, NON-passive `touchmove` listener on
 * the scroll container: once a gesture that began on a `[data-swipe-row]` is judged
 * horizontal, it calls `preventDefault()` to cancel the native vertical scroll. The
 * existing per-row handlers still own the visual translate.
 */
export function useHorizontalSwipeLock(
  scrollRef: RefObject<HTMLElement | null>,
  { selector = '[data-swipe-row]', threshold = 6, enabled = true }: UseHorizontalSwipeLockOptions = {},
) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const el = scrollRef.current
    if (!el) return

    let startX = 0
    let startY = 0
    let tracking = false
    let axis: 'h' | 'v' | null = null

    const onStart = (ev: TouchEvent) => {
      const touch = ev.touches?.[0]
      if (!touch) return
      const target = ev.target as Element | null
      tracking = !!target?.closest?.(selector)
      axis = null
      startX = touch.clientX
      startY = touch.clientY
    }

    const onMove = (ev: TouchEvent) => {
      if (!tracking) return
      const touch = ev.touches?.[0]
      if (!touch) return
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      if (axis === null) {
        if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return
        axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
      }
      // Horizontal swipe → cancel the native vertical scroll so the page stays put.
      if (axis === 'h' && ev.cancelable) ev.preventDefault()
    }

    const onEnd = () => {
      tracking = false
      axis = null
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [scrollRef, selector, threshold, enabled])
}
