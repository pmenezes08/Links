import { describe, expect, it } from 'vitest'
import {
  extractForegroundPushContent,
  foregroundBannerFromPushDetail,
  navigateToPushUrl,
  normalizePathForForegroundCompare,
  shouldSkipForegroundBannerDueToSameRoute,
} from './pushNotificationPayload'
import type { NavigateFunction } from 'react-router-dom'

describe('extractForegroundPushContent', () => {
  it('extracts flat Capacitor-style payload', () => {
    const r = extractForegroundPushContent({
      title: 'Message from Alex',
      body: 'Hey there',
      data: { url: '/user_chat/chat/alex' },
    })
    expect(r.title).toBe('Message from Alex')
    expect(r.body).toBe('Hey there')
    expect(r.url).toBe('/user_chat/chat/alex')
  })

  it('reads url from data strings when top-level absent', () => {
    const r = extractForegroundPushContent({
      title: '',
      body: '',
      data: {
        url: '/group_chat/42',
        title: 'Community post',
        body: 'Someone posted…',
      },
    })
    expect(r.title).toBe('Community post')
    expect(r.body).toBe('Someone posted…')
    expect(r.url).toBe('/group_chat/42')
  })

  it('handles nested notification wrapper', () => {
    const r = extractForegroundPushContent({
      notification: {
        title: 'T',
        body: 'B',
        data: { url: '/notifications' },
      },
    })
    expect(r.url).toBe('/notifications')
  })
})

describe('foregroundBannerFromPushDetail', () => {
  it('returns null when no url and no meaningful text', () => {
    expect(foregroundBannerFromPushDetail({ title: 'Notification', body: '', data: {} })).toBeNull()
  })

  it('infers chat copy from url when title is generic', () => {
    const r = foregroundBannerFromPushDetail({
      title: 'Notification',
      body: '',
      data: { url: '/user_chat/chat/sam' },
    })
    expect(r?.headline).toBe('New message')
    expect(r?.subline).toContain('sam')
    expect(r?.url).toBeDefined()
  })

  it('uses server title/body from data when present', () => {
    const r = foregroundBannerFromPushDetail({
      data: { url: '/post/1', title: 'Hello', body: 'World' },
    })
    expect(r?.headline).toBe('Hello')
    expect(r?.subline).toBe('World')
  })
})

describe('shouldSkipForegroundBannerDueToSameRoute', () => {
  it('returns true when paths match modulo trailing slash', () => {
    expect(shouldSkipForegroundBannerDueToSameRoute('/foo/bar', '/foo/bar/')).toBe(true)
    expect(
      shouldSkipForegroundBannerDueToSameRoute('/user_chat/chat/foo', '/user_chat/chat/foo'),
    ).toBe(true)
  })

  it('treats community_feed and community_feed_react as same', () => {
    expect(
      shouldSkipForegroundBannerDueToSameRoute('/community_feed_react/9', '/community_feed/9'),
    ).toBe(true)
    expect(normalizePathForForegroundCompare('/community_feed_react/9')).toBe('/community_feed/9')
  })

  it('returns false when different', () => {
    expect(shouldSkipForegroundBannerDueToSameRoute('/a', '/b')).toBe(false)
  })
})

describe('navigateToPushUrl', () => {
  it('navigates to /notifications when url missing', () => {
    const calls: string[] = []
    const nav = ((to: string) => {
      calls.push(to)
    }) as unknown as NavigateFunction
    navigateToPushUrl(nav, undefined)
    expect(calls).toEqual(['/notifications'])
  })

  it('rewrites community_feed to community_feed_react', () => {
    const calls: string[] = []
    const nav = ((to: string) => {
      calls.push(to)
    }) as unknown as NavigateFunction
    navigateToPushUrl(nav, '/community_feed/9')
    expect(calls).toEqual(['/community_feed_react/9'])
  })
})
