import { describe, expect, it, vi } from 'vitest'
import { isNearBottom, maxScrollTop, scrollElementToBottom, shouldShowScrollDownAfterOpen } from './scrollPin'

describe('scrollPin', () => {
  it('isNearBottom when within threshold', () => {
    const el = {
      scrollHeight: 1000,
      scrollTop: 860,
      clientHeight: 100,
    } as HTMLElement
    expect(isNearBottom(el, 50)).toBe(true)
    expect(isNearBottom(el, 40)).toBe(false)
  })

  it('shouldShowScrollDownAfterOpen respects debounce window', () => {
    const opened = 1000
    expect(shouldShowScrollDownAfterOpen(opened, 1200, 300)).toBe(false)
    expect(shouldShowScrollDownAfterOpen(opened, 1301, 300)).toBe(true)
  })

  it('maxScrollTop is scrollHeight minus clientHeight, floored at zero', () => {
    expect(maxScrollTop({ scrollHeight: 1000, clientHeight: 100 })).toBe(900)
    expect(maxScrollTop({ scrollHeight: 50, clientHeight: 100 })).toBe(0)
  })

  it('scrollElementToBottom sets scrollTop to max scroll', () => {
    const el = {
      scrollHeight: 1200,
      clientHeight: 400,
      scrollTop: 0,
      scrollTo: vi.fn(),
      querySelector: () => null,
    } as unknown as HTMLElement
    scrollElementToBottom(el, 'auto')
    expect(el.scrollTop).toBe(800)
  })
})
