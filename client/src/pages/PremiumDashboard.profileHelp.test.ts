import { describe, expect, it } from 'vitest'

import { shouldShowProfileHelpCard } from './PremiumDashboard'

describe('PremiumDashboard profile help card visibility', () => {
  it('hides the card when effective personal and professional sections are complete', () => {
    expect(
      shouldShowProfileHelpCard({
        onboardingComplete: false,
        requiresOnboardingResume: true,
        onboardingProgress: {
          personalSectionComplete: false,
          professionalSectionComplete: false,
          personalSectionCompleteEffective: true,
          professionalSectionCompleteEffective: true,
        },
      }),
    ).toBe(false)
  })

  it('shows the card when a section is effectively incomplete', () => {
    expect(
      shouldShowProfileHelpCard({
        onboardingComplete: false,
        onboardingProgress: {
          personalSectionCompleteEffective: true,
          professionalSectionCompleteEffective: false,
        },
      }),
    ).toBe(true)
  })
})
