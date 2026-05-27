import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readDeviceCache, readDeviceCacheStale, writeDeviceCache } from './deviceCache'

describe('deviceCache stale-while-revalidate', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-27T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('readDeviceCache deletes expired entries and returns null', () => {
    writeDeviceCache('chat:alice:bob', { messages: [{ id: 1 }] }, 60_000)
    vi.advanceTimersByTime(61_000)

    expect(readDeviceCache('chat:alice:bob')).toBe(null)
    expect(localStorage.getItem('chat:alice:bob')).toBe(null)
  })

  it('readDeviceCacheStale retains expired entries and marks expired', () => {
    writeDeviceCache('chat:alice:bob', { messages: [{ id: 1 }] }, 60_000)
    vi.advanceTimersByTime(61_000)

    const { data, expired } = readDeviceCacheStale<{ messages: Array<{ id: number }> }>('chat:alice:bob')
    expect(expired).toBe(true)
    expect(data?.messages).toEqual([{ id: 1 }])
    expect(localStorage.getItem('chat:alice:bob')).not.toBe(null)
  })

  it('readDeviceCacheStale returns fresh data with expired false', () => {
    writeDeviceCache('chat:alice:bob', { messages: [{ id: 2 }] }, 60_000)
    vi.advanceTimersByTime(30_000)

    const { data, expired } = readDeviceCacheStale<{ messages: Array<{ id: number }> }>('chat:alice:bob')
    expect(expired).toBe(false)
    expect(data?.messages).toEqual([{ id: 2 }])
  })
})
