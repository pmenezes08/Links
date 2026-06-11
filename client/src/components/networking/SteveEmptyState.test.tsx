import { describe, expect, it } from 'vitest'
import { pickDailySuggestions, SUGGESTION_KEYS, VISIBLE_SUGGESTIONS } from './SteveEmptyState'

describe('pickDailySuggestions', () => {
  it('returns the requested count of distinct keys from the pool', () => {
    const picked = pickDailySuggestions(SUGGESTION_KEYS, VISIBLE_SUGGESTIONS, 42)
    expect(picked).toHaveLength(VISIBLE_SUGGESTIONS)
    expect(new Set(picked).size).toBe(VISIBLE_SUGGESTIONS)
    picked.forEach(key => expect(SUGGESTION_KEYS).toContain(key))
  })

  it('is deterministic for a given day', () => {
    expect(pickDailySuggestions(SUGGESTION_KEYS, 3, 7)).toEqual(pickDailySuggestions(SUGGESTION_KEYS, 3, 7))
  })

  it('rotates across days so every suggestion eventually shows', () => {
    const seen = new Set<string>()
    for (let day = 0; day < SUGGESTION_KEYS.length; day++) {
      pickDailySuggestions(SUGGESTION_KEYS, 3, day).forEach(key => seen.add(key))
    }
    expect(seen.size).toBe(SUGGESTION_KEYS.length)
  })

  it('returns the whole pool when it is not larger than the count', () => {
    expect(pickDailySuggestions(['a', 'b'], 3, 5)).toEqual(['a', 'b'])
  })
})
