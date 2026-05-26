import { describe, expect, it } from 'vitest'
import { resolveCommunityBackgroundUrl } from './communityBackgroundUrl'

describe('resolveCommunityBackgroundUrl', () => {
  it('returns empty string for blank paths', () => {
    expect(resolveCommunityBackgroundUrl(null)).toBe('')
    expect(resolveCommunityBackgroundUrl(undefined)).toBe('')
    expect(resolveCommunityBackgroundUrl('')).toBe('')
    expect(resolveCommunityBackgroundUrl('   ')).toBe('')
  })

  it('passes through absolute http(s) URLs', () => {
    expect(resolveCommunityBackgroundUrl('https://cdn.example.com/bg.jpg')).toBe(
      'https://cdn.example.com/bg.jpg',
    )
    expect(resolveCommunityBackgroundUrl('http://cdn.example.com/bg.jpg')).toBe(
      'http://cdn.example.com/bg.jpg',
    )
  })

  it('normalizes uploads paths', () => {
    expect(resolveCommunityBackgroundUrl('/uploads/foo.jpg')).toBe('/uploads/foo.jpg')
    expect(resolveCommunityBackgroundUrl('uploads/foo.jpg')).toBe('/uploads/foo.jpg')
  })

  it('normalizes static paths', () => {
    expect(resolveCommunityBackgroundUrl('/static/community_backgrounds/foo.jpg')).toBe(
      '/static/community_backgrounds/foo.jpg',
    )
    expect(resolveCommunityBackgroundUrl('static/community_backgrounds/foo.jpg')).toBe(
      '/static/community_backgrounds/foo.jpg',
    )
  })

  it('maps filename-only paths to static community backgrounds', () => {
    expect(resolveCommunityBackgroundUrl('mountains.jpg')).toBe(
      '/static/community_backgrounds/mountains.jpg',
    )
    expect(resolveCommunityBackgroundUrl('nested/path/beach.png')).toBe(
      '/static/community_backgrounds/beach.png',
    )
  })
})
