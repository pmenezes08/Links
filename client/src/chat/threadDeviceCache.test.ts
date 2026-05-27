import { describe, expect, it } from 'vitest'
import {
  isCachePaintedForGen,
  isUnchangedFromCacheSnapshot,
  markThreadCachePainted,
  snapshotFromMessages,
} from './threadDeviceCache'

describe('threadDeviceCache', () => {
  it('snapshotFromMessages captures count and tail id', () => {
    expect(snapshotFromMessages([{ id: 1 }, { id: 2 }])).toEqual({
      count: 2,
      tailId: 2,
    })
  })

  it('markThreadCachePainted sets gen and snapshot refs', () => {
    const genRef = { current: null as number | null }
    const snapRef = { current: null as { count: number; tailId: number | undefined } | null }
    markThreadCachePainted(genRef, snapRef, 3, [{ id: 10 }, { id: 11 }])
    expect(genRef.current).toBe(3)
    expect(snapRef.current).toEqual({ count: 2, tailId: 11 })
  })

  it('isCachePaintedForGen compares gen to painted ref', () => {
    const genRef = { current: 2 }
    expect(isCachePaintedForGen(genRef, 2)).toBe(true)
    expect(isCachePaintedForGen(genRef, 3)).toBe(false)
  })

  it('isUnchangedFromCacheSnapshot matches tail and count only when from cache', () => {
    const snap = { count: 2, tailId: 5 }
    expect(isUnchangedFromCacheSnapshot(snap, true, [{ id: 1 }, { id: 5 }])).toBe(true)
    expect(isUnchangedFromCacheSnapshot(snap, true, [{ id: 1 }, { id: 6 }])).toBe(false)
    expect(isUnchangedFromCacheSnapshot(snap, false, [{ id: 1 }, { id: 5 }])).toBe(false)
  })
})
