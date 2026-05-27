import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_NEAR_BOTTOM_PX,
  LOAD_OLDER_TRIGGER_PX,
  distanceFromInvertedBottom,
  distanceFromInvertedTop,
  isInvertedAtBottom,
  pinInvertedToBottom,
  smoothPinInvertedToBottom,
} from './scrollPin'

describe('inverted-list scroll helpers', () => {
  it('exposes a sane near-bottom threshold and load-older trigger', () => {
    expect(DEFAULT_NEAR_BOTTOM_PX).toBeGreaterThan(0)
    expect(LOAD_OLDER_TRIGGER_PX).toBeGreaterThan(0)
  })

  it('isInvertedAtBottom is true at scrollTop=0 and within tolerance', () => {
    expect(isInvertedAtBottom({ scrollTop: 0 })).toBe(true)
    expect(isInvertedAtBottom({ scrollTop: 1 }, 2)).toBe(true)
    expect(isInvertedAtBottom({ scrollTop: 3 }, 2)).toBe(false)
  })

  it('distanceFromInvertedBottom returns scrollTop (clamped at 0)', () => {
    expect(distanceFromInvertedBottom({ scrollTop: 0 })).toBe(0)
    expect(distanceFromInvertedBottom({ scrollTop: 250 })).toBe(250)
    expect(distanceFromInvertedBottom({ scrollTop: -5 })).toBe(0)
  })

  it('distanceFromInvertedTop measures remaining scroll toward older content', () => {
    expect(
      distanceFromInvertedTop({ scrollHeight: 1000, scrollTop: 0, clientHeight: 400 }),
    ).toBe(600)
    expect(
      distanceFromInvertedTop({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 }),
    ).toBe(100)
    expect(
      distanceFromInvertedTop({ scrollHeight: 1000, scrollTop: 900, clientHeight: 400 }),
    ).toBe(0)
  })

  it('pinInvertedToBottom sets scrollTop to 0', () => {
    const el = { scrollTop: 420 } as HTMLElement
    pinInvertedToBottom(el)
    expect(el.scrollTop).toBe(0)
  })

  it('smoothPinInvertedToBottom prefers scrollTo({ top: 0, smooth }) when available', () => {
    const scrollTo = vi.fn()
    const el = { scrollTop: 800, scrollTo } as unknown as HTMLElement
    smoothPinInvertedToBottom(el)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('smoothPinInvertedToBottom falls back to scrollTop assignment when scrollTo is missing', () => {
    const el = { scrollTop: 800 } as unknown as HTMLElement
    smoothPinInvertedToBottom(el)
    expect(el.scrollTop).toBe(0)
  })
})
