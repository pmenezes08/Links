import { describe, expect, it, beforeEach } from 'vitest'
import {
  MESSAGE_IMAGE_DEFAULT_ASPECT_RATIO,
  clampMessageImageAspectRatio,
  clearMessageImageAspectCache,
  messageImageCacheKey,
  readCachedMessageImageAspectRatio,
  writeCachedMessageImageAspectRatio,
} from './messageImageAspect'

describe('messageImageAspect', () => {
  beforeEach(() => {
    clearMessageImageAspectCache()
  })

  it('messageImageCacheKey strips query and lowercases', () => {
    expect(messageImageCacheKey('/uploads/Photo.JPG?v=2')).toBe('/uploads/photo.jpg')
  })

  it('clampMessageImageAspectRatio clamps extreme ratios', () => {
    expect(clampMessageImageAspectRatio(100, 400)).toBe(0.45)
    expect(clampMessageImageAspectRatio(800, 100)).toBe(2.2)
    expect(clampMessageImageAspectRatio(300, 400)).toBeCloseTo(0.75)
  })

  it('write/read round-trip per normalized src', () => {
    const src = '/uploads/a.jpg'
    writeCachedMessageImageAspectRatio(src, 1080, 1920)
    expect(readCachedMessageImageAspectRatio(src)).toBeCloseTo(1080 / 1920)
    expect(readCachedMessageImageAspectRatio('/uploads/A.JPG')).toBeCloseTo(1080 / 1920)
  })

  it('defaults to portrait phone ratio when dimensions invalid', () => {
    expect(clampMessageImageAspectRatio(0, 0)).toBe(MESSAGE_IMAGE_DEFAULT_ASPECT_RATIO)
  })
})

describe('MessageImage aspect reservation (source contract)', () => {
  it('MessageImage.tsx reserves box with aspectRatio before load', async () => {
    const { readFileSync } = await import('node:fs')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
    const src = readFileSync(join(repoRoot, 'client', 'src', 'components', 'MessageImage.tsx'), 'utf8')
    expect(src).toMatch(/aspectRatio:\s*`\$\{aspectRatio\}`/)
    expect(src).toMatch(/probeMessageImageAspectRatio/)
    expect(src).toMatch(/readCachedMessageImageAspectRatio/)
  })
})
