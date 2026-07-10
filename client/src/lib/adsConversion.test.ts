import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  markPendingSignupConversion,
  trackPendingSignupConversion,
  trackSignupConversion,
} from './adsConversion'

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
  },
}))

describe('signup ads conversion state', () => {
  beforeEach(() => {
    localStorage.clear()
    window.gtag = vi.fn()
  })

  it('keeps a pending email signup until the authenticated username matches', () => {
    markPendingSignupConversion('NewOwner')

    trackPendingSignupConversion('someone-else')
    expect(localStorage.getItem('cpoint:ads:pending-signup-username')).toBe('newowner')

    trackPendingSignupConversion('NEWOWNER')
    expect(localStorage.getItem('cpoint:ads:pending-signup-username')).toBeNull()
  })

  it('does not report signup conversion while its Google Ads label is unset', () => {
    expect(trackSignupConversion('newowner')).toBe(false)
    expect(window.gtag).not.toHaveBeenCalled()
  })
})
