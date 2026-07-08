// Honest onboarding progress. The previous single "Step X of 8" map parked
// every B2B stage at step 0 (the bar sat still for ~6 turns) and could move
// BACKWARDS (professional-first hit 100% at its bio review, then dropped to
// 37.5% at section_picker). This module gives the B2B network-setup fork its
// own short track and derives main-track positions from section-completion
// flags so the bar is monotonic regardless of which section runs first.

export type ProgressTrack = 'main' | 'b2b'

export type ProgressFlags = {
  personalSectionComplete?: boolean
  professionalSectionComplete?: boolean
}

export type OnboardingProgressPoint = {
  track: ProgressTrack
  current: number
  total: number
}

const B2B_TOTAL = 4
const MAIN_TOTAL = 8

// Non-decreasing along the B2B flow (value → size → tier → org/parent → subs).
const B2B_STEPS: Record<string, number> = {
  b2b_value: 1,
  b2b_network_size: 2,
  b2b_tier_guidance: 2,
  b2b_org_type: 3,
  b2b_parent_name: 3,
  b2b_sub_names: 4,
}

const PERSONAL_CORE = new Set([
  'personal_section_intro',
  'talk_all_day',
  'reach_out',
  'journey',
  'recommend',
  'optional_social',
])

const PROFESSIONAL_CORE = new Set([
  'professional_section_intro',
  'cv_upload',
  'cv_review',
  'professional',
  'professional_confirm',
  'fix_role',
  'fix_company',
])

const PROFESSIONAL_TAIL = new Set([
  'professional_associations',
  'professional_strengths',
  'linkedin',
])

export function onboardingProgress(stage: string, flags: ProgressFlags): OnboardingProgressPoint {
  const b2bStep = B2B_STEPS[stage]
  if (b2bStep !== undefined) {
    return { track: 'b2b', current: b2bStep, total: B2B_TOTAL }
  }

  const personalDone = !!flags.personalSectionComplete
  const professionalDone = !!flags.professionalSectionComplete
  const completedSections = (personalDone ? 1 : 0) + (professionalDone ? 1 : 0)

  let step = 1 // welcome / intent_fork / name / pb_* never show 0
  if (stage === 'location' || stage === 'location_confirm' || stage === 'location_city') {
    step = 2
  } else if (stage === 'photo') {
    step = 3
  } else if (stage === 'section_picker') {
    // 3 before any section, 5 after the first, 7 after both.
    step = 3 + 2 * completedSections
  } else if (PERSONAL_CORE.has(stage)) {
    // The section runs at 4-5 when it's the first one, 6-7 when the other
    // section already finished.
    step = professionalDone ? 6 : 4
  } else if (stage === 'personal_bio_review') {
    step = professionalDone ? 7 : 5
  } else if (PROFESSIONAL_CORE.has(stage)) {
    step = personalDone ? 6 : 4
  } else if (PROFESSIONAL_TAIL.has(stage) || stage === 'professional_bio_review') {
    step = personalDone ? 7 : 5
  } else if (stage === 'manual_bio_edit') {
    // Editing a bio inside whichever section is running: 5 for the first
    // section, 7 once one section is already complete.
    step = completedSections > 0 ? 7 : 5
  } else if (
    stage === 'profile_review' ||
    stage === 'enriching' ||
    stage === 'review' ||
    stage === 'complete'
  ) {
    step = MAIN_TOTAL
  }

  return { track: 'main', current: Math.min(step, MAIN_TOTAL), total: MAIN_TOTAL }
}
