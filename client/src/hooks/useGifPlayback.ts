import { useEffect, useRef, useState } from 'react'
import { getGifInfo } from '../utils/gifControl'

export function useGifPlayback(src?: string | null) {
  const [stillSrc, setStillSrc] = useState<string | null>(null)
  const [isFrozen, setIsFrozen] = useState(false)
  const loopDurationRef = useRef<number>(0)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    setIsFrozen(false)
    setStillSrc(null)
    loopDurationRef.current = 0

    if (!src || !src.toLowerCase().endsWith('.gif')) {
      return
    }

    let cancelled = false

    getGifInfo(src)
      .then(info => {
        if (cancelled) return
        setStillSrc(info.stillDataUrl)
        loopDurationRef.current = info.loopDurationMs
        if (timerRef.current) {
          window.clearTimeout(timerRef.current)
        }
        timerRef.current = window.setTimeout(() => {
          setIsFrozen(true)
        }, Math.max(info.loopDurationMs, 1500) * 3)
      })
      .catch(() => {
        // Ignore parsing failures; GIF will continue playing
      })

    return () => {
      cancelled = true
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [src])

  const replay = () => {
    if (!loopDurationRef.current) return
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
    }
    setIsFrozen(false)
    timerRef.current = window.setTimeout(() => {
      setIsFrozen(true)
    }, Math.max(loopDurationRef.current, 1500) * 3)
  }

  return {
    isFrozen,
    stillSrc,
    replay,
    canReplay: Boolean(loopDurationRef.current),
  }
}
