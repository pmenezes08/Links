import { describe, it, expect } from 'vitest'
import {
  PAGE_TRANSITION_MS,
  TAB_CROSSFADE_MS,
  CPOINT_EASE_OUT,
  REDUCED_MOTION_FADE_MS,
} from '../design/motion'
import {
  detectTransitionType,
  isDashboardTabPath,
  isDeepDrillDownRoute,
  isPilotRoute,
} from '../components/pageTransitionUtils'

describe('motion tokens', () => {
  it('matches DESIGN.md values', () => {
    expect(PAGE_TRANSITION_MS).toBe(340)
    expect(TAB_CROSSFADE_MS).toBe(120)
    expect(REDUCED_MOTION_FADE_MS).toBe(80)
    expect(CPOINT_EASE_OUT).toBe('cubic-bezier(0.32, 0.72, 0, 1)')
  })
})

describe('detectTransitionType', () => {
  it('returns none when transitions disabled', () => {
    expect(detectTransitionType('/premium_dashboard', '/feed', 'PUSH', false)).toBe('none')
  })

  it('returns none for same path', () => {
    expect(detectTransitionType('/feed', '/feed', 'PUSH', true)).toBe('none')
  })

  it('returns tab for dashboard tab switches', () => {
    expect(detectTransitionType('/premium_dashboard', '/feed', 'PUSH', true)).toBe('tab')
    expect(detectTransitionType('/feed', '/about_cpoint', 'PUSH', true)).toBe('tab')
  })

  it('returns pop for POP navigation type', () => {
    expect(detectTransitionType('/community_feed_react/1', '/premium_dashboard', 'POP', true)).toBe('pop')
  })

  it('returns none when leaving pilot stack for non-pilot route', () => {
    expect(detectTransitionType('/premium_dashboard', '/user_chat', 'PUSH', true)).toBe('none')
  })

  it('returns push between pilot drill-down routes', () => {
    expect(detectTransitionType('/premium_dashboard', '/community_feed_react/1', 'PUSH', true)).toBe('push')
    expect(detectTransitionType('/community_feed_react/1', '/post/42', 'PUSH', true)).toBe('push')
    expect(detectTransitionType('/community_feed_react/1', '/steve/profile-builder/professional', 'PUSH', true)).toBe('push')
  })

  // Multi-step pop: a back-tap from a deep drill-down route may jump several
  // history levels (e.g. Post → Tab, skipping the Community feed). These
  // should still animate as `pop` rather than snap.
  it('returns pop for Post → Dashboard (POP)', () => {
    expect(detectTransitionType('/post/42', '/premium_dashboard', 'POP', true)).toBe('pop')
  })

  it('returns pop for Post → Communities (POP)', () => {
    expect(detectTransitionType('/post/42', '/communities', 'POP', true)).toBe('pop')
  })

  it('returns pop for Reply → Community feed (POP)', () => {
    expect(detectTransitionType('/reply/5', '/community_feed_react/1', 'POP', true)).toBe('pop')
  })

  it('returns pop for Community feed → Dashboard (POP)', () => {
    expect(detectTransitionType('/community_feed_react/1', '/premium_dashboard', 'POP', true)).toBe('pop')
  })

  it('returns pop for scoped Steve profile builder → Community feed (POP)', () => {
    expect(detectTransitionType('/steve/profile-builder/professional', '/community_feed_react/1', 'POP', true)).toBe('pop')
  })

  // Programmatic jump (PUSH) from a drill-down to a tab root is not a true
  // forward navigation — keep it non-pop and don't push-slide it.
  it('does not push-slide a programmatic Post → Dashboard (PUSH)', () => {
    const result = detectTransitionType('/post/42', '/premium_dashboard', 'PUSH', true)
    expect(['tab', 'none']).toContain(result)
    expect(result).not.toBe('pop')
  })

  // Chat threads are explicitly excluded from the pilot motion scope; the
  // multi-step pop branch must not affect them.
  it('preserves existing none for ChatThread → Dashboard (POP)', () => {
    expect(detectTransitionType('/user_chat/chat/somebody', '/premium_dashboard', 'POP', true)).toBe('none')
  })
})

describe('isDeepDrillDownRoute', () => {
  it('recognises post, community feed, group feed, reply, and group reply routes', () => {
    expect(isDeepDrillDownRoute('/post/42')).toBe(true)
    expect(isDeepDrillDownRoute('/community_feed_react/1')).toBe(true)
    expect(isDeepDrillDownRoute('/group_feed_react/9')).toBe(true)
    expect(isDeepDrillDownRoute('/reply/5')).toBe(true)
    expect(isDeepDrillDownRoute('/group_reply/5')).toBe(true)
    expect(isDeepDrillDownRoute('/community/my-slug/feed')).toBe(true)
    expect(isDeepDrillDownRoute('/steve/profile-builder/professional')).toBe(true)
  })

  it('excludes tab roots and chat threads', () => {
    expect(isDeepDrillDownRoute('/premium_dashboard')).toBe(false)
    expect(isDeepDrillDownRoute('/feed')).toBe(false)
    expect(isDeepDrillDownRoute('/communities')).toBe(false)
    expect(isDeepDrillDownRoute('/user_chat')).toBe(false)
    expect(isDeepDrillDownRoute('/user_chat/chat/somebody')).toBe(false)
  })
})

describe('isPilotRoute', () => {
  it('recognises pilot stack routes', () => {
    expect(isPilotRoute('/premium_dashboard')).toBe(true)
    expect(isPilotRoute('/community_feed_react/5')).toBe(true)
    expect(isPilotRoute('/post/99')).toBe(true)
    expect(isPilotRoute('/steve/profile-builder/professional')).toBe(true)
    expect(isPilotRoute('/user_chat')).toBe(false)
  })
})

describe('isDashboardTabPath', () => {
  it('recognises pilot tab roots', () => {
    expect(isDashboardTabPath('/premium_dashboard')).toBe(true)
    expect(isDashboardTabPath('/feed')).toBe(true)
    expect(isDashboardTabPath('/about_cpoint')).toBe(true)
    expect(isDashboardTabPath('/community_feed_react/1')).toBe(false)
  })
})

describe('PageTransitionStack module', () => {
  it('exports default component', async () => {
    const mod = await import('./PageTransitionStack')
    expect(typeof mod.default).toBe('function')
  })
})
