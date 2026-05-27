import { useEffect, useRef, useState, type RefObject } from 'react'

export type PullToRefreshHint = 'idle' | 'ready' | 'refreshing'

export interface UseTouchPullToRefreshOptions {
  scrollRef: RefObject<HTMLElement | null>
  onRefresh: () => void | Promise<void>
  thresholdPx?: number
  minIntervalMs?: number
  enabled?: boolean
}

/** Touch pull-to-refresh for a scroll container (Messages inbox, feeds). */
export function useTouchPullToRefresh({
  scrollRef,
  onRefresh,
  thresholdPx = 64,
  minIntervalMs = 1500,
  enabled = true,
}: UseTouchPullToRefreshOptions) {
  const [pullPx, setPullPx] = useState(0)
  const [hint, setHint] = useState<PullToRefreshHint>('idle')
  const refreshInFlightRef = useRef(false)
  const lastRefreshRef = useRef(0)
  const startYRef = useRef(0)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const el = scrollRef.current
    if (!el) return

    const runRefresh = async () => {
      const now = Date.now()
      if (refreshInFlightRef.current || now - lastRefreshRef.current < minIntervalMs) return
      refreshInFlightRef.current = true
      lastRefreshRef.current = now
      setHint('refreshing')
      try {
        await onRefreshRef.current()
      } finally {
        refreshInFlightRef.current = false
        setPullPx(0)
        setHint('idle')
      }
    }

    const onTouchStart = (ev: TouchEvent) => {
      startYRef.current = ev.touches?.[0]?.clientY ?? 0
      setPullPx(0)
      if (!refreshInFlightRef.current) setHint('idle')
    }

    const onTouchMove = (ev: TouchEvent) => {
      if (refreshInFlightRef.current) return
      const scrollTop = el.scrollTop
      const dy = (ev.touches?.[0]?.clientY ?? 0) - startYRef.current
      if (scrollTop <= 0 && dy > 0) {
        const px = Math.min(100, Math.max(0, dy * 0.5))
        setPullPx(px)
        setHint(px > 8 ? 'ready' : 'idle')
        if (px >= thresholdPx) void runRefresh()
      } else {
        setPullPx(0)
        if (!refreshInFlightRef.current) setHint('idle')
      }
    }

    const onTouchEnd = () => {
      setPullPx(0)
      if (!refreshInFlightRef.current) setHint('idle')
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [enabled, scrollRef, thresholdPx, minIntervalMs])

  return { pullPx, hint }
}
