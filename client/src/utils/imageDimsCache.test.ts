import { describe, it, expect, beforeEach } from 'vitest'
import { getImageDims, recordImageDims, __resetImageDimsCacheForTest } from './imageDimsCache'

beforeEach(() => {
  localStorage.clear()
  __resetImageDimsCacheForTest()
})

describe('imageDimsCache', () => {
  it('returns null for an unseen image', () => {
    expect(getImageDims('https://x/a.jpg')).toBeNull()
  })

  it('records and returns dimensions, ignoring the query string', () => {
    recordImageDims('https://x/a.jpg?cb=1', 800, 600)
    expect(getImageDims('https://x/a.jpg?cb=2')).toEqual([800, 600])
  })

  it('ignores zero/invalid dimensions', () => {
    recordImageDims('https://x/b.jpg', 0, 600)
    expect(getImageDims('https://x/b.jpg')).toBeNull()
  })

  it('first writer wins — does not overwrite an existing entry', () => {
    recordImageDims('https://x/c.jpg', 100, 100)
    recordImageDims('https://x/c.jpg', 999, 999)
    expect(getImageDims('https://x/c.jpg')).toEqual([100, 100])
  })

  it('persists across an in-memory reset (a later session reload from localStorage)', () => {
    recordImageDims('https://x/d.jpg', 640, 480)
    __resetImageDimsCacheForTest()
    expect(getImageDims('https://x/d.jpg')).toEqual([640, 480])
  })
})
