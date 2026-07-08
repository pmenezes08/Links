import { describe, expect, it } from 'vitest'

import { onboardingProgress, type ProgressFlags } from './onboardingProgress'

function run(stages: string[], flagsAt: (stage: string) => ProgressFlags) {
  return stages.map(stage => onboardingProgress(stage, flagsAt(stage)))
}

function assertMonotonic(points: { current: number; total: number }[]) {
  for (let i = 1; i < points.length; i++) {
    expect(points[i].current).toBeGreaterThanOrEqual(points[i - 1].current)
  }
}

describe('onboardingProgress — main track', () => {
  it('never returns 0 and caps at the total', () => {
    for (const stage of ['welcome', 'intent_fork', 'name', 'gibberish_check', 'complete']) {
      const p = onboardingProgress(stage, {})
      expect(p.current).toBeGreaterThanOrEqual(1)
      expect(p.current).toBeLessThanOrEqual(p.total)
    }
  })

  it('is monotonic for a personal-first run', () => {
    const none: ProgressFlags = {}
    const personalDone: ProgressFlags = { personalSectionComplete: true }
    const sequence: [string, ProgressFlags][] = [
      ['name', none],
      ['location', none],
      ['photo', none],
      ['section_picker', none],           // 3
      ['personal_section_intro', none],   // 4
      ['talk_all_day', none],
      ['journey', none],
      ['personal_bio_review', none],      // 5
      ['section_picker', personalDone],   // 5
      ['professional_section_intro', personalDone], // 6
      ['professional', personalDone],
      ['linkedin', personalDone],         // 7
      ['professional_bio_review', personalDone],
      ['profile_review', { personalSectionComplete: true, professionalSectionComplete: true }], // 8
      ['complete', { personalSectionComplete: true, professionalSectionComplete: true }],
    ]
    const points = sequence.map(([stage, flags]) => onboardingProgress(stage, flags))
    assertMonotonic(points)
    expect(points[points.length - 1].current).toBe(8)
  })

  it('is monotonic for a professional-first run (the old map dropped from 100% to 37.5% here)', () => {
    const none: ProgressFlags = {}
    const professionalDone: ProgressFlags = { professionalSectionComplete: true }
    const sequence: [string, ProgressFlags][] = [
      ['name', none],
      ['location', none],
      ['photo', none],
      ['section_picker', none],                        // 3
      ['professional_section_intro', none],            // 4
      ['professional', none],
      ['professional_associations', none],             // 5
      ['linkedin', none],
      ['professional_bio_review', none],               // 5
      ['section_picker', professionalDone],            // 5
      ['personal_section_intro', professionalDone],    // 6
      ['talk_all_day', professionalDone],
      ['personal_bio_review', professionalDone],       // 7
      ['profile_review', { personalSectionComplete: true, professionalSectionComplete: true }], // 8
    ]
    const points = sequence.map(([stage, flags]) => onboardingProgress(stage, flags))
    assertMonotonic(points)
  })

  it('section_picker reflects completed sections: 3 / 5 / 7', () => {
    expect(onboardingProgress('section_picker', {}).current).toBe(3)
    expect(onboardingProgress('section_picker', { personalSectionComplete: true }).current).toBe(5)
    expect(
      onboardingProgress('section_picker', {
        personalSectionComplete: true,
        professionalSectionComplete: true,
      }).current,
    ).toBe(7)
  })
})

describe('onboardingProgress — B2B track', () => {
  it('gives the network-setup fork its own 4-step track', () => {
    const stages = ['b2b_value', 'b2b_network_size', 'b2b_tier_guidance', 'b2b_org_type', 'b2b_parent_name', 'b2b_sub_names']
    const points = run(stages, () => ({}))
    for (const p of points) {
      expect(p.track).toBe('b2b')
      expect(p.total).toBe(4)
      expect(p.current).toBeGreaterThanOrEqual(1)
    }
    assertMonotonic(points)
    expect(points[0].current).toBe(1)
    expect(points[points.length - 1].current).toBe(4)
  })

  it('returns to the main track after bootstrap', () => {
    expect(onboardingProgress('name', {}).track).toBe('main')
  })
})
