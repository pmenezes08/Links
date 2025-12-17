import { useEffect, useRef, useState } from 'react'
import { getGifInfo } from '../utils/gifControl'

// Default duration for 3 loops if we can't determine actual GIF duration
const DEFAULT_LOOP_DURATION_MS = 2000
const NUM_LOOPS = 3

export function useGifPlayback(src?: string | null) {
  const [stillSrc, setStillSrc] = useState<string | null>(null)
  const [isFrozen, setIsFrozen] = useState(false)
  const loopDurationRef = useRef<number>(DEFAULT_LOOP_DURATION_MS)
  const timerRef = useRef<number | null>(null)
  const fallbackTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setIsFrozen(false)
    setStillSrc(null)
    loopDurationRef.current = DEFAULT_LOOP_DURATION_MS

    if (!src || !src.toLowerCase().endsWith('.gif')) {
      return
    }

    let cancelled = false

    // Clear any existing timers
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (fallbackTimerRef.current) {
      window.clearTimeout(fallbackTimerRef.current)
      fallbackTimerRef.current = null
    }

    // ALWAYS set a fallback timer to freeze after ~6 seconds (3 loops * 2s default)
    // This ensures GIF stops even if parsing fails
    fallbackTimerRef.current = window.setTimeout(() => {
      if (!cancelled) {
        setIsFrozen(true)
      }
    }, DEFAULT_LOOP_DURATION_MS * NUM_LOOPS)

    // Try to get actual GIF info for better timing and still frame
    getGifInfo(src)
      .then(info => {
        if (cancelled) return
        setStillSrc(info.stillDataUrl)
        loopDurationRef.current = info.loopDurationMs
        
        // Clear fallback timer since we have accurate info
        if (fallbackTimerRef.current) {
          window.clearTimeout(fallbackTimerRef.current)
          fallbackTimerRef.current = null
        }
        
        // Set accurate timer based on actual GIF duration
        if (timerRef.current) {
          window.clearTimeout(timerRef.current)
        }
        timerRef.current = window.setTimeout(() => {
          if (!cancelled) {
            setIsFrozen(true)
          }
        }, Math.max(info.loopDurationMs, 1500) * NUM_LOOPS)
      })
      .catch(() => {
        // Parsing failed - fallback timer will handle freezing
        // Just use a simple approach: replace with a static version after timeout
        console.log('GIF parsing failed, using fallback timer')
      })

    return () => {
      cancelled = true
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current)
        fallbackTimerRef.current = null
      }
    }
  }, [src])

  const replay = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
    }
    if (fallbackTimerRef.current) {
      window.clearTimeout(fallbackTimerRef.current)
    }
    setIsFrozen(false)
    
    const duration = loopDurationRef.current || DEFAULT_LOOP_DURATION_MS
    timerRef.current = window.setTimeout(() => {
      setIsFrozen(true)
    }, Math.max(duration, 1500) * NUM_LOOPS)
  }

  return {
    isFrozen,
    stillSrc,
    replay,
    canReplay: true, // Always allow replay
  }
}
