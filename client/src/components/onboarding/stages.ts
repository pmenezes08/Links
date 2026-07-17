/**
 * Declarative stage config for the onboarding chat wizard.
 *
 * Simple ask -> collect -> advance stages are plain data ('prompt'):
 * a Steve message key, optional input affordance, and quick replies.
 * Stages with branching, async work, or interpolated copy stay 'custom'
 * and keep their named handlers in `useOnboardingChatFlow`'s `startStage`.
 *
 * The Record is keyed by every `Stage` member, so adding a stage without
 * deciding prompt-vs-custom is a compile error.
 */

import type { TFunction } from 'i18next'
import { oc, ocOpt } from '../../i18n/onboardingChatHelpers'
import type { ChatMessage, Stage } from './types'

export type PromptStageConfig = {
  kind: 'prompt'
  /** onboarding_chat catalog key for the Steve message (oc()). */
  messageKey: string
  inputType?: 'text' | 'url' | 'textarea'
  /** onboarding_chat catalog key for the input placeholder (oc()). */
  placeholderKey?: string
  /** Fixed quick replies: [optionKey, value] pairs for ocOpt(). */
  staticOptions?: [string, string][]
  /** Leading skip reply: [optionKey, value] pair for ocOpt(). */
  skipOption?: [string, string]
  /** Append a go_back reply when there is stage history to return to. */
  goBackWhenHistory?: boolean
  photoUpload?: boolean
  cvUpload?: boolean
}

export type StageConfig = PromptStageConfig | { kind: 'custom' }

const custom = { kind: 'custom' } as const

export const ONBOARDING_STAGE_CONFIG: Record<Stage, StageConfig> = {
  intent_fork: custom,
  b2b_value: {
    kind: 'prompt',
    messageKey: 'messages.b2b_value',
    staticOptions: [['continue', 'b2b_value_continue']],
  },
  b2b_network_size: custom,
  b2b_tier_guidance: custom,
  b2b_org_type: {
    kind: 'prompt',
    messageKey: 'copy.org_type_prompt',
    inputType: 'text',
    placeholderKey: 'placeholders.org_type',
  },
  b2b_parent_name: {
    kind: 'prompt',
    messageKey: 'messages.b2b_parent_name',
    inputType: 'text',
    placeholderKey: 'placeholders.network_name',
  },
  b2b_sub_names: {
    kind: 'prompt',
    messageKey: 'messages.b2b_sub_names',
    inputType: 'text',
    placeholderKey: 'placeholders.sub_communities',
    staticOptions: [['skip_sub_communities', 'b2b_skip_subs']],
  },
  welcome: custom,
  profile_builder_summary: custom,
  pb_confirm_field: custom,
  pb_edit_field: custom,
  name: custom,
  location: {
    kind: 'prompt',
    messageKey: 'messages.location_ask',
    inputType: 'text',
    placeholderKey: 'placeholders.location',
  },
  location_confirm: custom,
  location_city: custom,
  photo: {
    kind: 'prompt',
    messageKey: 'messages.photo_ask',
    photoUpload: true,
    staticOptions: [['skip_photo', 'skip_photo']],
  },
  community_fork: custom,
  section_picker: custom,
  personal_section_intro: custom,
  talk_all_day: {
    kind: 'prompt',
    messageKey: 'messages.talk_all_day',
    inputType: 'text',
    placeholderKey: 'placeholders.type_answer',
    goBackWhenHistory: true,
  },
  reach_out: {
    kind: 'prompt',
    messageKey: 'messages.reach_out',
    inputType: 'text',
    placeholderKey: 'placeholders.type_answer',
    goBackWhenHistory: true,
  },
  personal_bio_review: custom,
  professional_section_intro: custom,
  cv_upload: {
    kind: 'prompt',
    messageKey: 'messages.cv_upload',
    cvUpload: true,
    staticOptions: [
      ['type_manually', 'cv_skip_to_manual'],
      ['go_back', 'go_back'],
    ],
  },
  cv_review: custom,
  professional: {
    kind: 'prompt',
    messageKey: 'messages.professional_ask',
    inputType: 'text',
    placeholderKey: 'placeholders.professional',
    goBackWhenHistory: true,
  },
  professional_confirm: custom,
  fix_role: custom,
  fix_company: custom,
  // Express path: associations + strengths season the composed bio and
  // persist verbatim into steve_user_profiles.onboardingIdentity (via
  // the state save), but never into MySQL columns. Skipping jumps both,
  // straight to LinkedIn, so the professional section is two real
  // interactions.
  professional_associations: {
    kind: 'prompt',
    messageKey: 'messages.professional_associations',
    inputType: 'text',
    placeholderKey: 'placeholders.associations',
    skipOption: ['skip', 'skip_professional_associations'],
    goBackWhenHistory: true,
  },
  professional_strengths: {
    kind: 'prompt',
    messageKey: 'messages.professional_strengths',
    inputType: 'text',
    placeholderKey: 'placeholders.strengths',
    skipOption: ['skip', 'skip_professional_strengths'],
    goBackWhenHistory: true,
  },
  linkedin: {
    kind: 'prompt',
    messageKey: 'messages.linkedin_ask',
    inputType: 'url',
    placeholderKey: 'placeholders.linkedin',
    skipOption: ['skip', 'skip_linkedin'],
    goBackWhenHistory: true,
  },
  professional_bio_review: custom,
  profile_review: custom,
  recommend: {
    kind: 'prompt',
    messageKey: 'messages.recommend',
    inputType: 'text',
    placeholderKey: 'placeholders.recommend',
    skipOption: ['skip', 'skip_recommend'],
    goBackWhenHistory: true,
  },
  optional_social: {
    kind: 'prompt',
    messageKey: 'messages.optional_social',
    inputType: 'textarea',
    placeholderKey: 'placeholders.social_urls',
    skipOption: ['skip', 'skip_optional_social'],
    goBackWhenHistory: true,
  },
  journey: {
    kind: 'prompt',
    messageKey: 'messages.journey',
    inputType: 'textarea',
    placeholderKey: 'placeholders.journey',
    skipOption: ['skip', 'skip_journey'],
    goBackWhenHistory: true,
  },
  manual_bio_edit: custom,
  // Vestigial Stage member — never entered via startStage (gibberish
  // handling runs inline in handleSubmit); kept as a custom no-op.
  gibberish_check: custom,
  enriching: custom,
  review: custom,
  complete: custom,
}

/**
 * Quick replies for a prompt stage. Mirrors the original switch exactly:
 * static lists pass through; skip leads; go_back appends only when there
 * is history; an empty list collapses to `undefined` (no options key
 * behavior in the bubble).
 */
export function promptStageOptions(
  t: TFunction,
  cfg: PromptStageConfig,
  hasHistory: boolean,
): ChatMessage['options'] | undefined {
  if (cfg.staticOptions) {
    return cfg.staticOptions.map(([key, value]) => ocOpt(t, key, value))
  }
  const opts: NonNullable<ChatMessage['options']> = []
  if (cfg.skipOption) opts.push(ocOpt(t, cfg.skipOption[0], cfg.skipOption[1]))
  if (cfg.goBackWhenHistory && hasHistory) opts.push(ocOpt(t, 'go_back', 'go_back'))
  return opts.length > 0 ? opts : undefined
}

/** Message payload extras for a prompt stage (input + upload affordances). */
export function promptStageMessageOpts(
  t: TFunction,
  cfg: PromptStageConfig,
  hasHistory: boolean,
): Partial<ChatMessage> {
  const opts: Partial<ChatMessage> = {}
  if (cfg.inputType) opts.inputType = cfg.inputType
  if (cfg.placeholderKey) opts.inputPlaceholder = oc(t, cfg.placeholderKey)
  if (cfg.photoUpload) opts.photoUpload = true
  if (cfg.cvUpload) opts.cvUpload = true
  const options = promptStageOptions(t, cfg, hasHistory)
  if (options) opts.options = options
  return opts
}
