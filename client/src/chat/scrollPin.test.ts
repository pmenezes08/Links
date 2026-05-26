import { describe, expect, it } from 'vitest'
import { isNearBottom, shouldShowScrollDownAfterOpen } from './scrollPin'

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
})
