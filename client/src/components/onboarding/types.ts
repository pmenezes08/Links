/**
 * Shared types for the onboarding chat wizard.
 *
 * Moved verbatim out of `pages/OnboardingChat.tsx` so the stage-flow
 * helpers, API layer, hook, and render components can share them without
 * importing the page.
 */

export type Stage =
  | 'intent_fork'
  | 'b2b_value'
  | 'b2b_network_size'
  | 'b2b_tier_guidance'
  | 'b2b_org_type'
  | 'b2b_parent_name'
  | 'b2b_sub_names'
  | 'welcome'
  | 'profile_builder_summary'
  | 'pb_confirm_field'
  | 'pb_edit_field'
  | 'name'
  | 'location'
  | 'location_confirm'
  | 'location_city'
  | 'photo'
  | 'section_picker'
  | 'personal_section_intro'
  | 'talk_all_day'
  | 'reach_out'
  | 'personal_bio_review'
  | 'professional_section_intro'
  | 'cv_upload'
  | 'cv_review'
  | 'professional'
  | 'professional_confirm'
  | 'fix_role'
  | 'fix_company'
  | 'professional_associations'
  | 'professional_strengths'
  | 'linkedin'
  | 'professional_bio_review'
  | 'profile_review'
  | 'recommend'
  | 'optional_social'
  | 'journey'
  | 'manual_bio_edit'
  | 'gibberish_check'
  | 'enriching'
  | 'review'
  | 'complete'

export type PbFieldKey = 'city' | 'country' | 'role' | 'company'
export type ProfileSection = 'personal' | 'professional'

export type WorkHistoryRow = {
  title: string
  company: string
  location: string
  start: string
  end: string
  description: string
}

export interface ChatMessage {
  from: 'steve' | 'user'
  text: string
  options?: { label: string; value: string; primary?: boolean }[]
  cards?: EnrichmentCard[]
  photoUpload?: boolean
  cvUpload?: boolean
  inputType?: 'text' | 'url' | 'textarea'
  inputPlaceholder?: string
  composedBio?: string
  composedBioKind?: 'personal' | 'professional'
  composedCompanyIntel?: string
  sectionCard?: {
    title: string
    subtitle: string
    steps: string[]
  }
  profileReview?: {
    personalBio: string
    professionalBio: string
    linkedinAdded?: boolean
    companyIntelAdded?: boolean
  }
  sectionPicker?: {
    personalStatus: string
    professionalStatus: string
  }
}

export interface EnrichmentCard {
  id: string
  section: string
  label: string
  detail: string
  field: string
  status?: 'pending' | 'accepted' | 'dismissed'
}

export type B2BTierCode = 'free' | 'paid_l1' | 'paid_l2' | 'paid_l3' | 'enterprise'

export interface CommunityTierHint {
  label: string
  min_members?: number | null
  max_members?: number | null
  price_eur_monthly?: number | string | null
  pricing?: string | null
}

export interface OnboardingTierHints {
  communities_max?: number | null
  members_per_owned_community?: number | null
  free_community_media_gb?: number | string | null
  can_use_steve?: boolean
  community_tiers?: Partial<Record<B2BTierCode, CommunityTierHint>>
}

export interface Collected {
  firstName: string
  lastName: string
  role: string
  company: string
  city: string
  country: string
  linkedin: string
  /** True after user submits or skips optional LinkedIn step */
  linkedinDone?: boolean
  bio: string
  professionalBio: string
  professionalAssociations: string
  professionalStrengths: string
  talkAllDay: string
  recommend: string
  reachOut: string
  journey: string
  companyIntel?: string
  /** YYYY-MM for current role from CV / profile structured fields */
  currentRoleStartYm?: string
  /** Prior roles from CV import (maps to users.professional_work_history) */
  workHistory?: WorkHistoryRow[]
  personalSectionComplete?: boolean
  professionalSectionComplete?: boolean
  activeProfileSection?: ProfileSection
  profileSectionOrder?: ProfileSection[]
  /** B2B onboarding \u2014 persisted in Firestore for resume */
  b2bNetworkSize?: string
  b2bOrgTypeHint?: string
  b2bParentName?: string
}
