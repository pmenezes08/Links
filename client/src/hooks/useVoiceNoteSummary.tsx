/**
 * Hook for managing voice note AI summary preferences
 * Premium users only - provides UI toggle and state management
 */

import { useState, useCallback, useEffect, useRef } from 'react'

const STORAGE_KEY = 'voice_note_summary_preference'

export function useVoiceNoteSummary(isPremium: boolean) {
  // Track if we've initialized from storage
  const hasInitialized = useRef(false)
  
  // Start with false, then load from storage once premium is confirmed
  const [includeSummary, setIncludeSummary] = useState(false)

  // Initialize from localStorage when premium status is known
  useEffect(() => {
    if (isPremium && !hasInitialized.current) {
      hasInitialized.current = true
      try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored === 'true') {
          setIncludeSummary(true)
        }
      } catch {}
    }
  }, [isPremium])

  // Save preference when it changes (only if premium)
  useEffect(() => {
    if (isPremium && hasInitialized.current) {
      try {
        localStorage.setItem(STORAGE_KEY, String(includeSummary))
      } catch {}
    }
  }, [includeSummary, isPremium])

  // Reset if user is not premium
  useEffect(() => {
    if (!isPremium && includeSummary) {
      setIncludeSummary(false)
      hasInitialized.current = false
    }
  }, [isPremium, includeSummary])

  const toggleSummary = useCallback(() => {
    if (isPremium) {
      setIncludeSummary(prev => !prev)
    }
  }, [isPremium])

  return {
    includeSummary: isPremium ? includeSummary : false,
    setIncludeSummary: isPremium ? setIncludeSummary : () => {},
    toggleSummary,
    canUseSummary: isPremium
  }
}
