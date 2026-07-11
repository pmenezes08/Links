import { describe, it, expect } from 'vitest'
import { pollIsHot, shouldDeltaPoll } from './pollSync'

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

describe('pollIsHot', () => {
  const WINDOW = 60_000
  const NOW = 1_000_000

  it('is hot while the peer is typing, regardless of message activity', () => {
    expect(pollIsHot(NOW, 0, true, WINDOW)).toBe(true)
  })

  it('is hot within the activity window after a send/receive', () => {
    expect(pollIsHot(NOW, NOW - 1_000, false, WINDOW)).toBe(true)
    expect(pollIsHot(NOW, NOW - (WINDOW - 1), false, WINDOW)).toBe(true)
  })

  it('cools down once the window elapses', () => {
    expect(pollIsHot(NOW, NOW - WINDOW, false, WINDOW)).toBe(false)
    expect(pollIsHot(NOW, NOW - WINDOW * 5, false, WINDOW)).toBe(false)
  })

  it('is idle with no recorded activity at all', () => {
    expect(pollIsHot(NOW, 0, false, WINDOW)).toBe(false)
  })
})
