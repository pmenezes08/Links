import { describe, expect, it } from 'vitest'

import { normalizeResumeStage, shouldShowResumeWelcome } from './OnboardingChat'

const emptyCollected = {
  firstName: '',
  lastName: '',
  role: '',
  company: '',
  city: '',
  country: '',
  linkedin: '',
  bio: '',
  professionalBio: '',
  professionalAssociations: '',
  professionalStrengths: '',
  talkAllDay: '',
  recommend: '',
  reachOut: '',
  journey: '',
  personalSectionComplete: false,
  professionalSectionComplete: false,
  profileSectionOrder: [],
}

describe('OnboardingChat resume handling', () => {
  it('opens intro-profile deferrals at the normal welcome stage', () => {
    expect(normalizeResumeStage('intro_profile_later', emptyCollected)).toBe('welcome')
  })

  it('does not show the saved-progress message for intro-profile deferrals', () => {
    expect(shouldShowResumeWelcome({ stage: 'intro_profile_later' })).toBe(false)
  })

  it('still shows the saved-progress message for real in-chat deferrals', () => {
    expect(shouldShowResumeWelcome({ stage: 'section_picker' })).toBe(true)
  })
})
