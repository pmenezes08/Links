import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveScrollPosition,
  getScrollPosition,
  clearScrollPosition,
  __resetScrollMemoryForTests,
} from './scrollRestoration'

describe('scrollRestoration', () => {
  beforeEach(() => {
    __resetScrollMemoryForTests()
    try { sessionStorage.clear() } catch { /* ignore */ }
  })

  it('saves and restores a position by key', () => {
    saveScrollPosition('k1', 420)
    expect(getScrollPosition('k1')).toBe(420)
  })

  it('returns null for an unknown key', () => {
    expect(getScrollPosition('nope')).toBeNull()
  })

  it('ignores empty/missing keys and invalid offsets', () => {
    saveScrollPosition('', 100)
    saveScrollPosition(undefined, 100)
    saveScrollPosition(null, 100)
    saveScrollPosition('k', -5)
    saveScrollPosition('k', Number.NaN)
    expect(getScrollPosition('')).toBeNull()
    expect(getScrollPosition('k')).toBeNull()
  })

  it('clears a saved position', () => {
    saveScrollPosition('k', 50)
    clearScrollPosition('k')
    expect(getScrollPosition('k')).toBeNull()
  })

  it('falls back to sessionStorage when memory is cold (simulated reload)', () => {
    saveScrollPosition('k', 77)
    __resetScrollMemoryForTests() // memory gone, sessionStorage kept
    expect(getScrollPosition('k')).toBe(77)
  })

  it('bounds memory and evicts the oldest from both tiers', () => {
    for (let i = 0; i < 60; i++) saveScrollPosition('key' + i, i)
    __resetScrollMemoryForTests()
    // 60 saved, cap 50 -> key0..key9 evicted from memory AND sessionStorage.
    expect(getScrollPosition('key0')).toBeNull()
    expect(getScrollPosition('key9')).toBeNull()
    expect(getScrollPosition('key10')).toBe(10)
    expect(getScrollPosition('key59')).toBe(59)
  })
})
