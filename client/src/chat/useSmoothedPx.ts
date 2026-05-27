import { useEffect, useRef, useState } from 'react'
import { CHAT_KEYBOARD_ANIMATION_MS, easeChatKeyboard } from './constants'

interface UseSmoothedPxOptions {
  durationMs?: number
  onTick?: () => void
  /** When true, jump to target immediately (used during thread open inset settle). */
  snap?: boolean
}

/**
 * Animate a pixel value toward `target` so composer lift and list inset stay in sync.
 */
export function useSmoothedPx(
  target: number,
  { durationMs = CHAT_KEYBOARD_ANIMATION_MS, onTick, snap = false }: UseSmoothedPxOptions = {},
) {
  const [smoothed, setSmoothed] = useState(target)
  const smoothedRef = useRef(target)
  const onTickRef = useRef(onTick)
  onTickRef.current = onTick

  useEffect(() => {
    if (typeof window === 'undefined') {
      smoothedRef.current = target
      setSmoothed(target)
      return
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (snap || reduceMotion || Math.abs(smoothedRef.current - target) < 0.5) {
      smoothedRef.current = target
      setSmoothed(target)
      if (Math.abs(smoothedRef.current - target) >= 0.5) {
        onTickRef.current?.()
      }
      return
    }

    const from = smoothedRef.current
    const start = performance.now()
    let rafId = 0

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs)
      const next = from + (target - from) * easeChatKeyboard(progress)
      smoothedRef.current = next
      setSmoothed(next)
      onTickRef.current?.()
      if (progress < 1) {
        rafId = requestAnimationFrame(tick)
      }
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [target, durationMs, snap])

  return smoothed
}
