import { describe, it, expect } from 'vitest'
import {
  PAGE_TRANSITION_MS,
  TAB_CROSSFADE_MS,
  CPOINT_EASE_OUT,
  REDUCED_MOTION_FADE_MS,
} from '../design/motion'
import { detectTransitionType, isDashboardTabPath, isPilotRoute } from '../components/pageTransitionUtils'

describe('motion tokens', () => {
  it('matches DESIGN.md values', () => {
    expect(PAGE_TRANSITION_MS).toBe(250)
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
  })
})

describe('isPilotRoute', () => {
  it('recognises pilot stack routes', () => {
    expect(isPilotRoute('/premium_dashboard')).toBe(true)
    expect(isPilotRoute('/community_feed_react/5')).toBe(true)
    expect(isPilotRoute('/post/99')).toBe(true)
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
