/**
 * Pure stage/section flow helpers for the onboarding chat wizard.
 *
 * Moved verbatim out of `pages/OnboardingChat.tsx`. Everything here is
 * side-effect free: given a saved stage and the collected answers, decide
 * where the flow should be. `OnboardingChat.resume.test.tsx` exercises the
 * resume helpers through the page's re-exports.
 */

import type { Collected, PbFieldKey, ProfileSection, Stage } from './types'

export function firstUnansweredStageForSection(section: ProfileSection, c: Collected): Stage {
  if (section === 'personal') {
    if (!c.talkAllDay?.trim()) return 'talk_all_day'
    if (!c.reachOut?.trim()) return 'reach_out'
    if (!c.journey?.trim()) return 'journey'
    if (!c.recommend?.trim()) return 'recommend'
    if (!c.bio?.trim()) return 'optional_social'
    return 'personal_bio_review'
  }
  if (!c.role?.trim()) return 'professional'
  if (!c.professionalAssociations?.trim()) return 'professional_associations'
  if (!c.professionalStrengths?.trim()) return 'professional_strengths'
  return 'professional_bio_review'
}

export function sectionHasStarted(section: ProfileSection, c: Collected): boolean {
  if (section === 'personal') {
    return !!(c.talkAllDay?.trim() || c.reachOut?.trim() || c.journey?.trim() || c.recommend?.trim() || c.bio?.trim())
  }
  return !!(c.role?.trim() || c.professionalAssociations?.trim() || c.professionalStrengths?.trim() || c.linkedinDone || c.professionalBio?.trim())
}

export function startOrResumeSection(section: ProfileSection, c: Collected): Stage {
  if (section === 'personal') {
    if (c.personalSectionComplete) return c.professionalSectionComplete ? 'profile_review' : 'section_picker'
    return sectionHasStarted('personal', c) ? firstUnansweredStageForSection('personal', c) : 'personal_section_intro'
  }
  if (c.professionalSectionComplete) return c.personalSectionComplete ? 'profile_review' : 'section_picker'
  return sectionHasStarted('professional', c) ? firstUnansweredStageForSection('professional', c) : 'professional_section_intro'
}

export function nextIncompleteProfileStage(c: Collected): Stage {
  if (!c.personalSectionComplete && !c.professionalSectionComplete) return 'section_picker'
  if (c.personalSectionComplete && !c.professionalSectionComplete) return startOrResumeSection('professional', c)
  if (c.professionalSectionComplete && !c.personalSectionComplete) return startOrResumeSection('personal', c)
  return 'profile_review'
}

export function nextSectionAfterCompletion(c: Collected): Stage {
  return nextIncompleteProfileStage(c)
}

export function isIntroProfileDeferredStage(savedStage: unknown): boolean {
  return String(savedStage || '') === 'intro_profile_later'
}

export function shouldShowResumeWelcome(saved: { stage?: unknown; resume_welcome_shown?: unknown }): boolean {
  return !isIntroProfileDeferredStage(saved.stage) && !saved.resume_welcome_shown
}

export function normalizeResumeStage(savedStage: Stage | string, c: Collected): Stage {
  if (isIntroProfileDeferredStage(savedStage)) return 'welcome'
  if (savedStage === 'complete') return 'complete'
  if (savedStage === 'personal_section_intro' || savedStage === 'professional_section_intro') return savedStage
  if (savedStage === 'talk_all_day' || savedStage === 'reach_out' || savedStage === 'journey' || savedStage === 'recommend' || savedStage === 'optional_social' || savedStage === 'personal_bio_review') {
    return c.personalSectionComplete ? nextIncompleteProfileStage(c) : firstUnansweredStageForSection('personal', c)
  }
  if (savedStage === 'professional' || savedStage === 'professional_confirm' || savedStage === 'fix_role' || savedStage === 'fix_company' || savedStage === 'professional_associations' || savedStage === 'professional_strengths' || savedStage === 'linkedin' || savedStage === 'professional_bio_review' || savedStage === 'cv_upload' || savedStage === 'cv_review') {
    return c.professionalSectionComplete ? nextIncompleteProfileStage(c) : firstUnansweredStageForSection('professional', c)
  }
  if (savedStage === 'section_picker') {
    return nextIncompleteProfileStage(c)
  }
  if (savedStage === 'profile_review') {
    return c.personalSectionComplete && c.professionalSectionComplete ? 'profile_review' : nextIncompleteProfileStage(c)
  }
  return (savedStage as Stage) || 'section_picker'
}

export const STAGES_REQUIRING_VALIDATION: Stage[] = [
  'talk_all_day', 'reach_out', 'professional', 'professional_associations', 'professional_strengths', 'linkedin', 'recommend', 'journey', 'pb_edit_field',
]

export const PB_FIELD_ORDER: PbFieldKey[] = ['city', 'country', 'role', 'company']

export function buildProfileBuilderConfirmQueue(c: Collected): PbFieldKey[] {
  return PB_FIELD_ORDER.filter(k => {
    const v = c[k]
    return typeof v === 'string' && v.trim().length > 0
  })
}

/** Map free-text org description to API parent_type (bootstrap normalizes free tier). */
export function mapOrgHintToParentType(hint: string): string {
  const h = hint.toLowerCase()
  if (/\b(gym|fitness|studio|crossfit|yoga|pilates)\b/.test(h)) return 'gym'
  if (/\b(university|college|alumni|school|campus|faculty|student)\b/.test(h)) return 'university'
  return 'general'
}

/** Parse optional personal social URLs for Firestore onboardingIdentity.socialProvidedLinks. */
export function parseSocialUrlsFromInput(raw: string): { platform: string; url: string }[] {
  const out: { platform: string; url: string }[] = []
  for (const line of raw.split(/\n/).map(l => l.trim()).filter(Boolean)) {
    try {
      const u = new URL(line.startsWith('http') ? line : `https://${line}`)
      const host = u.hostname.toLowerCase()
      let platform = ''
      if (host.includes('instagram')) platform = 'Instagram'
      else if (host.includes('tiktok')) platform = 'TikTok'
      else if (host === 'x.com' || host.endsWith('.x.com') || host.includes('twitter')) platform = 'X'
      else continue
      out.push({ platform, url: u.toString() })
    } catch {
      continue
    }
  }
  return out
}
