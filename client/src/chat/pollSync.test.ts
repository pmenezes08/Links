import { describe, it, expect } from 'vitest'
import { shouldDeltaPoll } from './pollSync'

const EVERY_N = 6

describe('shouldDeltaPoll', () => {
  it('forces a FULL sync on the first poll after open (didFullSync=false)', () => {
    // No matter the last id or tick, the first poll must be full so reactions/edits
    // on already-loaded rows reconcile immediately.
    expect(shouldDeltaPoll(false, 100, 1, EVERY_N)).toBe(false)
    expect(shouldDeltaPoll(false, 100, 5, EVERY_N)).toBe(false)
  })

  it('uses a delta only after the first full sync, with a known last id, off the periodic tick', () => {
    expect(shouldDeltaPoll(true, 100, 1, EVERY_N)).toBe(true)
    expect(shouldDeltaPoll(true, 100, 5, EVERY_N)).toBe(true)
  })

  it('forces a FULL sync on the periodic tick (every Nth poll)', () => {
    expect(shouldDeltaPoll(true, 100, 6, EVERY_N)).toBe(false)
    expect(shouldDeltaPoll(true, 100, 12, EVERY_N)).toBe(false)
  })

  it('forces a FULL sync when there is no known last id (empty thread)', () => {
    expect(shouldDeltaPoll(true, 0, 1, EVERY_N)).toBe(false)
  })
})
