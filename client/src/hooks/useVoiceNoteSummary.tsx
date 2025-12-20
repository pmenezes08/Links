/**
 * Hook for managing voice note AI summary preferences
 * Premium users only - provides UI toggle and state management
 */

import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'voice_note_summary_preference'

export function useVoiceNoteSummary(isPremium: boolean) {
  // Load preference from localStorage
  const [includeSummary, setIncludeSummary] = useState(() => {
    if (!isPremium) return false
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored === 'true'
    } catch {
      return false
    }
  })

  // Save preference when it changes
  useEffect(() => {
    if (isPremium) {
      try {
        localStorage.setItem(STORAGE_KEY, String(includeSummary))
      } catch {}
    }
  }, [includeSummary, isPremium])

  // Reset if user is not premium
  useEffect(() => {
    if (!isPremium && includeSummary) {
      setIncludeSummary(false)
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
