import type { MediaQuality } from './types'

const QUALITY_KEY = 'cpoint.chatMediaQuality'

export function getStoredMediaQuality(): MediaQuality {
  if (typeof window === 'undefined') return 'standard'
  const value = window.localStorage.getItem(QUALITY_KEY)
  return value === 'hd' ? 'hd' : 'standard'
}

export function setStoredMediaQuality(quality: MediaQuality): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(QUALITY_KEY, quality)
}
