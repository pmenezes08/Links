import { describe, expect, it } from 'vitest'
import { optimizeAvatar, optimizeImage } from './imageOptimizer'

describe('optimizeAvatar', () => {
  it('wraps media.c-point.co (R2 on our zone) in CF Image Resizing', () => {
    const src = 'https://media.c-point.co/profile_pictures/IMG_1234_20260101_120000.jpeg'
    const out = optimizeAvatar(src, 40)
    expect(out.startsWith('https://c-point.co/cdn-cgi/image/')).toBe(true)
    expect(out).toContain('width=80') // 2x for retina
    expect(out).toContain('height=80')
    expect(out).toContain('fit=cover')
    expect(out).toContain(src)
  })

  it('wraps app.c-point.co absolute URLs', () => {
    const src = 'https://app.c-point.co/uploads/profile_pictures/photo.jpg'
    const out = optimizeAvatar(src, 32)
    expect(out.startsWith('https://c-point.co/cdn-cgi/image/')).toBe(true)
    expect(out).toContain(src)
  })

  it('leaves off-zone R2 object URLs untouched (CF cannot pull cross-zone)', () => {
    const pubDev = 'https://pub-abc123.r2.dev/profile_pictures/photo.jpg'
    expect(optimizeAvatar(pubDev, 40)).toBe(pubDev)
    const s3Style = 'https://account.eu.r2.cloudflarestorage.com/bucket/photo.jpg'
    expect(optimizeAvatar(s3Style, 40)).toBe(s3Style)
  })

  it('leaves external hosts untouched', () => {
    const external = 'https://example.com/avatar.jpg'
    expect(optimizeAvatar(external, 40)).toBe(external)
  })
})

describe('optimizeImage skip rules', () => {
  it('skips blob, data, gif, svg, and already-optimized URLs', () => {
    expect(optimizeImage('blob:abc', { width: 100 })).toBe('blob:abc')
    expect(optimizeImage('data:image/png;base64,xyz', { width: 100 })).toBe(
      'data:image/png;base64,xyz',
    )
    const gif = 'https://media.c-point.co/reactions/party.gif'
    expect(optimizeImage(gif, { width: 100 })).toBe(gif)
    const svg = 'https://media.c-point.co/icons/logo.svg'
    expect(optimizeImage(svg, { width: 100 })).toBe(svg)
    const optimized = 'https://c-point.co/cdn-cgi/image/width=80/https://media.c-point.co/a.jpg'
    expect(optimizeImage(optimized, { width: 100 })).toBe(optimized)
  })

  it('returns empty string for missing input', () => {
    expect(optimizeImage(null)).toBe('')
    expect(optimizeImage(undefined)).toBe('')
  })
})
