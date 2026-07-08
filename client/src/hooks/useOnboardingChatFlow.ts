/**
 * Orchestration hook for the onboarding chat wizard.
 *
 * Owns the stage machine, collected answers, message pacing, option-click
 * actions, submits, off-script/gibberish plumbing, uploads, and the
 * boot/resume effect — moved verbatim from `pages/OnboardingChat.tsx`.
 * The page keeps layout: FixedComposerShell wiring, padding math, splash.
 *
 * Style note (closure safety): advance calls thread `Collected` explicitly
 * (`advanceTo(next, data)`) instead of reading state, because React state
 * updates have not landed yet inside the same handler tick.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  STEVE_REPLY_DELAY_BASE_MS,
  STEVE_REPLY_DELAY_PER_CHAR_MS,
  STEVE_REPLY_DELAY_MIN_MS,
  STEVE_REPLY_DELAY_MAX_MS,
  STEVE_REPLY_DELAY_JITTER_MS,
  STEVE_REPLY_BURST_DISCOUNT,
} from '../design/motion'
import { useTranslation } from 'react-i18next'
import { detectOffScript, looksLikeMeaninglessInput } from '../components/onboarding/onboardingInputGuards'
import { onboardingProgress } from '../components/onboarding/onboardingProgress'
import {
  b2bNetworkSizeLabel,
  b2bNetworkSizeOptions,
  b2bTierGuidanceText,
  getPersonalSectionSteps,
  getProfessionalSectionSteps,
  isEnterpriseSize,
  oc,
  ocOpt,
  onboardingGreeting,
  pbFieldLabel,
  profileSummaryBlock,
  reactionMessage,
  sectionOnlyCompleteMessage,
  sectionOnlyCompleteOptions,
  validateLinkedInProfileUrl,
} from '../i18n/onboardingChatHelpers'
import type {
  ChatMessage,
  Collected,
  EnrichmentCard,
  OnboardingTierHints,
  PbFieldKey,
  ProfileSection,
  Stage,
  WorkHistoryRow,
} from '../components/onboarding/types'
import {
  buildProfileBuilderConfirmQueue,
  mapOrgHintToParentType,
  nextSectionAfterCompletion,
  normalizeResumeStage,
  parseSocialUrlsFromInput,
  shouldShowResumeWelcome,
  startOrResumeSection,
  STAGES_REQUIRING_VALIDATION,
} from '../components/onboarding/stageFlow'
import * as onboardingApi from '../components/onboarding/onboardingApi'
import { ONBOARDING_STAGE_CONFIG, promptStageMessageOpts } from '../components/onboarding/stages'

const SALES_EMAIL = 'sales@c-point.co'

export interface UseOnboardingChatFlowArgs {
  initFirst: string
  initLast: string
  username: string
  communityName?: string | null
  hasCommunity: boolean
  existingProfilePic: string
  mode: 'fresh' | 'profile_builder' | 'section_only'
  targetSection?: ProfileSection
  onComplete: () => void
  onCreateCommunity: () => void
  onExit: () => void
}

export function useOnboardingChatFlow({
  initFirst,
  initLast,
  username,
  communityName,
  hasCommunity,
  existingProfilePic,
  mode,
  targetSection,
  onComplete,
  onCreateCommunity,
  onExit,
}: UseOnboardingChatFlowArgs) {
  const { t } = useTranslation()
  const personalSectionSteps = useMemo(() => getPersonalSectionSteps(t), [t])
  const professionalSectionSteps = useMemo(() => getProfessionalSectionSteps(t), [t])
  const [stage, setStage] = useState<Stage>('welcome')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [collected, setCollected] = useState<Collected>({
    firstName: initFirst || '',
    lastName: initLast || '',
    role: '',
    company: '',
    city: '',
    country: '',
    linkedin: '',
    linkedinDone: false,
    bio: '',
    professionalBio: '',
    professionalAssociations: '',
    professionalStrengths: '',
    talkAllDay: '',
    recommend: '',
    reachOut: '',
    journey: '',
    companyIntel: '',
    personalSectionComplete: false,
    professionalSectionComplete: false,
    activeProfileSection: undefined,
    profileSectionOrder: [],
  })
  const progress = onboardingProgress(stage, collected)
  const [isTyping, setIsTyping] = useState(false)
  const [picFile, setPicFile] = useState<File | null>(null)
  const [cvFile, setCvFile] = useState<File | null>(null)
  const [cvUploading, setCvUploading] = useState(false)
  const [picPreview, setPicPreview] = useState(existingProfilePic || '')
  const [uploadingPic, setUploadingPic] = useState(false)
  const [enrichmentCards, setEnrichmentCards] = useState<EnrichmentCard[]>([])
  const enriching = false
  const [initialized, setInitialized] = useState(false)
  const [booting, setBooting] = useState(true)
  const gibberishReturnStage = useRef<Stage | null>(null)
  const pbConfirmQueueRef = useRef<PbFieldKey[]>([])
  const pbEditFieldRef = useRef<PbFieldKey | null>(null)
  const originalPublicBioRef = useRef('')
  const originalProfessionalBioRef = useRef('')
  const profileBuilderPostPbRef = useRef<{ skipLocation: boolean; skipProfessional: boolean }>({
    skipLocation: false,
    skipProfessional: false,
  })
  const stageHistory = useRef<Stage[]>([])
  const lastComposedCompanyIntelRef = useRef('')
  const [composingBio, setComposingBio] = useState(false)
  const [tourStep, setTourStep] = useState<number | null>(null)
  const [tierHints, setTierHints] = useState<OnboardingTierHints | null>(null)
  const [showDeferConfirm, setShowDeferConfirm] = useState(false)
  const [deferringProfile, setDeferringProfile] = useState(false)
  const [deferError, setDeferError] = useState('')
  const [bioDraftingKind, setBioDraftingKind] = useState<'personal' | 'professional' | null>(null)
  const isSectionOnly = mode === 'section_only'
  const sectionOnlyTarget: ProfileSection = targetSection || 'professional'

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const cvFileInputRef = useRef<HTMLInputElement>(null)
  const onboardingIntentRef = useRef<'b2b' | 'b2c' | null>(null)
  const b2bOrgRef = useRef('')
  const b2bParentRef = useRef('')
  const tierHintsRef = useRef<OnboardingTierHints | null>(null)

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'instant' }), 100)
  }, [])

  // Consecutive Steve bubbles in one uninterrupted burst pay a discounted
  // delay — people type faster mid-thought, and full price per bubble is
  // what made the old flat-delay flow drag.
  const steveBurstCountRef = useRef(0)

  const addSteveMessage = useCallback((text: string, opts?: Partial<ChatMessage>) => {
    setIsTyping(true)
    // Length-scaled pacing (constants in design/motion.ts): short acks land
    // fast, long questions read as composed. Flat-fast (250ms) felt like a
    // vending machine; flat-slow (600-1000ms) added 15-20s of dead air.
    const base = Math.min(
      STEVE_REPLY_DELAY_MAX_MS,
      Math.max(STEVE_REPLY_DELAY_MIN_MS, STEVE_REPLY_DELAY_BASE_MS + text.length * STEVE_REPLY_DELAY_PER_CHAR_MS),
    )
    const burst = steveBurstCountRef.current >= 1 ? STEVE_REPLY_BURST_DISCOUNT : 1
    steveBurstCountRef.current += 1
    setTimeout(() => {
      setIsTyping(false)
      setMessages(prev => [...prev, { from: 'steve', text, ...opts }])
      scrollToBottom()
    }, base * burst + Math.random() * STEVE_REPLY_DELAY_JITTER_MS)
  }, [scrollToBottom])

  const addUserMessage = useCallback((text: string) => {
    steveBurstCountRef.current = 0
    setMessages(prev => [...prev, { from: 'user', text }])
    scrollToBottom()
  }, [scrollToBottom])

  const saveField = useCallback(async (field: string, value: string) => {
    await onboardingApi.saveField(field, value)
  }, [])

  const saveState = useCallback(async (s: Stage, c: Collected) => {
    // Section-only sanitize (SAFETY-CRITICAL) lives in saveOnboardingState.
    await onboardingApi.saveOnboardingState(s, c, {
      isSectionOnly,
      sectionOnlyTarget,
      onboardingIntent: onboardingIntentRef.current,
    })
  }, [isSectionOnly, sectionOnlyTarget])

  // ── Initialize: load saved state or start fresh ──
  useEffect(() => {
    if (initialized) return
    setInitialized(true)
    ;(async () => {
      try {
        const tj = await onboardingApi.fetchTierHints()
        if (tj?.success && tj.hints) {
          tierHintsRef.current = tj.hints as OnboardingTierHints
          setTierHints(tj.hints as OnboardingTierHints)
        }
      } catch {}
      if (mode === 'profile_builder' || isSectionOnly) {
        profileBuilderPostPbRef.current = { skipLocation: false, skipProfessional: false }
        try {
          const pj = await onboardingApi.fetchProfileMe()
          const p = pj?.profile
          if (pj?.success && p) {
            const next: Collected = {
              firstName: (p.first_name || initFirst || '').trim(),
              lastName: (p.last_name || initLast || '').trim(),
              role: (p.professional?.role || p.role || '').trim(),
              company: (p.professional?.company || p.company || '').trim(),
              city: (p.personal?.city || p.city || '').trim(),
              country: (p.personal?.country || p.country || '').trim(),
              linkedin: (p.professional?.linkedin || p.linkedin || '').trim(),
              linkedinDone: !!(p.professional?.linkedin || p.linkedin || '').trim(),
              bio: (p.personal?.bio || p.bio || '').trim(),
              professionalBio: (p.professional?.about || p.professional_about || '').trim(),
              companyIntel: (p.professional?.company_intel || '').trim(),
              professionalAssociations: '',
              professionalStrengths: '',
              talkAllDay: '',
              recommend: '',
              reachOut: '',
              journey: '',
              personalSectionComplete: isSectionOnly && sectionOnlyTarget === 'professional',
              professionalSectionComplete: isSectionOnly && sectionOnlyTarget === 'personal',
              activeProfileSection: isSectionOnly ? sectionOnlyTarget : undefined,
              profileSectionOrder: isSectionOnly ? [sectionOnlyTarget] : [],
            }
            originalPublicBioRef.current = next.bio
            originalProfessionalBioRef.current = next.professionalBio
            setCollected(next)
            startStage(isSectionOnly ? startOrResumeSection(sectionOnlyTarget, next) : 'welcome', next)
            setBooting(false)
            return
          }
        } catch {}
        originalPublicBioRef.current = ''
        originalProfessionalBioRef.current = ''
        startStage(isSectionOnly ? startOrResumeSection(sectionOnlyTarget, collected) : 'welcome', collected)
        setBooting(false)
        return
      }
      try {
        const j = await onboardingApi.fetchOnboardingState()
        if (j?.success && j.state && j.state.stage && j.state.stage !== 'complete') {
          const saved = j.state
          const stagesAfterLinkedin = new Set([
            'professional_bio_review',
            'profile_review',
            'manual_bio_edit',
            'enriching',
            'review',
            'complete',
          ])
          if (saved.onboarding_intent === 'b2b' || saved.onboarding_intent === 'b2c') {
            onboardingIntentRef.current = saved.onboarding_intent
          }
          const rawMerged = saved.collected ? ({ ...collected, ...saved.collected } as Collected) : collected
          const savedCollected: Collected = {
            ...rawMerged,
            linkedinDone:
              !!(rawMerged.linkedinDone || (rawMerged.linkedin && rawMerged.linkedin.trim())) ||
              stagesAfterLinkedin.has(String(saved.stage)),
          }
          if (saved.collected) {
            setCollected(savedCollected)
            const sc = savedCollected
            if (sc.b2bOrgTypeHint) b2bOrgRef.current = String(sc.b2bOrgTypeHint)
            if (sc.b2bParentName) b2bParentRef.current = String(sc.b2bParentName)
          }
          const resumeStage = normalizeResumeStage(saved.stage, savedCollected)
          setStage(resumeStage)
          if (shouldShowResumeWelcome(saved)) {
            setMessages([{ from: 'steve', text: oc(t, 'messages.resume_welcome') }])
            await onboardingApi.markResumeWelcomeShown(resumeStage, savedCollected, onboardingIntentRef.current)
          }
          startStage(resumeStage, savedCollected)
          setBooting(false)
          return
        }
      } catch {}
      if (hasCommunity || communityName) {
        onboardingIntentRef.current = 'b2c'
        startStage('welcome', collected)
      } else {
        startStage('intent_fork', collected)
      }
      setBooting(false)
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startStage(s: Stage, c?: Collected) {
    const data = c || collected
    // Simple ask stages are declarative data; branching/async stages keep
    // named custom handlers in the switch below.
    const cfg = ONBOARDING_STAGE_CONFIG[s]
    if (cfg.kind === 'prompt') {
      addSteveMessage(oc(t, cfg.messageKey), promptStageMessageOpts(t, cfg, stageHistory.current.length > 1))
      return
    }
    switch (s) {
      case 'intent_fork': {
        const greeting = onboardingGreeting(t, data.firstName)
        addSteveMessage(
          oc(t, 'messages.intent_fork', {
            greeting,
            intentQuestion: oc(t, 'copy.intent_question'),
          }),
          {
            options: [
              ocOpt(t, 'intent_b2c', 'intent_b2c'),
              ocOpt(t, 'intent_b2b', 'intent_b2b'),
              ocOpt(t, 'finish_later', 'open_defer_modal'),
            ],
          },
        )
        break
      }
      case 'b2b_network_size': {
        addSteveMessage(oc(t, 'messages.b2b_network_size'), {
          options: b2bNetworkSizeOptions(t, tierHintsRef.current || tierHints),
        })
        break
      }
      case 'b2b_tier_guidance': {
        const sizeValue = data.b2bNetworkSize || ''
        const options: ChatMessage['options'] = [ocOpt(t, 'continue_creating_network', 'b2b_tier_continue')]
        if (isEnterpriseSize(sizeValue)) {
          options.push(ocOpt(t, 'contact_sales', 'contact_sales_enterprise'))
        }
        addSteveMessage(b2bTierGuidanceText(t, sizeValue, tierHintsRef.current || tierHints), { options })
        break
      }
      case 'welcome': {
        const greeting = onboardingGreeting(t, data.firstName)
        let welcomeText: string
        if (mode === 'profile_builder') {
          welcomeText = oc(t, 'messages.welcome_profile_builder', { greeting })
        } else if (communityName) {
          welcomeText = oc(t, 'messages.welcome_invited', { greeting, community: communityName })
        } else {
          welcomeText = oc(t, 'messages.welcome_default', { greeting })
        }
        const welcomeOpts: ChatMessage['options'] =
          mode === 'profile_builder' || communityName
            ? [ocOpt(t, 'lets_go', 'start')]
            : [ocOpt(t, 'lets_go', 'start'), ocOpt(t, 'finish_later', 'open_defer_modal')]
        addSteveMessage(welcomeText, { options: welcomeOpts })
        break
      }
      case 'profile_builder_summary': {
        const summary = profileSummaryBlock(t, data)
        addSteveMessage(oc(t, 'messages.pb_summary', { summary }), {
          options: [ocOpt(t, 'pb_continue', 'pb_summary_continue')],
        })
        break
      }
      case 'pb_confirm_field': {
        const queue = pbConfirmQueueRef.current
        const field = queue[0]
        if (!field) {
          finishProfileBuilderQueueAndGoName(data)
          break
        }
        const raw = (data[field] || '').trim()
        addSteveMessage(oc(t, 'messages.pb_confirm', { field: pbFieldLabel(t, field), value: raw }), {
          options: [
            ocOpt(t, 'yes', 'pb_confirm_yes'),
            ocOpt(t, 'update', 'pb_confirm_update'),
          ],
        })
        break
      }
      case 'pb_edit_field': {
        const field = pbEditFieldRef.current
        if (!field) {
          finishProfileBuilderQueueAndGoName(data)
          break
        }
        addSteveMessage(oc(t, 'messages.pb_edit', { field: pbFieldLabel(t, field) }), {
          inputType: 'text',
          inputPlaceholder: oc(t, 'placeholders.type_answer'),
        })
        break
      }
      case 'name': {
        const hasName = data.firstName && data.lastName
        if (hasName) {
          addSteveMessage(
            oc(t, 'messages.name_confirm', { firstName: data.firstName, lastName: data.lastName }),
            {
              options: [
                ocOpt(t, 'thats_correct', 'confirm_name'),
                ocOpt(t, 'let_me_fix', 'edit_name'),
              ],
            },
          )
        } else {
          addSteveMessage(oc(t, 'messages.name_ask'), {
            inputType: 'text',
            inputPlaceholder: oc(t, 'placeholders.first_last'),
          })
        }
        break
      }
      case 'location_confirm': {
        const city = data?.city || collected.city || ''
        const country = data?.country || collected.country || ''
        if (city && country) {
          addSteveMessage(oc(t, 'messages.location_confirm', { city, country }), {
            options: [
              {
                label: oc(t, 'options.yes_location', { city, country }),
                value: 'confirm_location',
              },
              ocOpt(t, 'no_correct_location', 'edit_location'),
            ],
          })
        } else {
          addSteveMessage(oc(t, 'messages.location_ask'), {
            inputType: 'text',
            inputPlaceholder: oc(t, 'placeholders.location'),
          })
          setStage('location')
        }
        break
      }
      case 'location_city': {
        const country = data?.country || collected.country || ''
        addSteveMessage(oc(t, 'messages.location_city', { country }), {
          inputType: 'text',
          inputPlaceholder: oc(t, 'placeholders.city_example'),
          options: [ocOpt(t, 'skip_city', 'skip_city')],
        })
        break
      }
      case 'section_picker': {
        const personalStatus = data.personalSectionComplete
          ? oc(t, 'status.personal_complete')
          : oc(t, 'status.personal_pending')
        const professionalStatus = data.professionalSectionComplete
          ? oc(t, 'status.professional_complete')
          : oc(t, 'status.professional_pending')
        const pickerOptions: ChatMessage['options'] =
          data.personalSectionComplete && data.professionalSectionComplete
            ? [
                ocOpt(t, 'review_profile', 'finish_sections_review'),
                ocOpt(t, 'finish_later', 'open_defer_modal'),
              ]
            : [ocOpt(t, 'finish_later', 'open_defer_modal')]
        addSteveMessage(oc(t, 'messages.section_picker'), {
          sectionPicker: { personalStatus, professionalStatus },
          options: pickerOptions,
        })
        break
      }
      case 'personal_section_intro':
        addSteveMessage(oc(t, 'messages.personal_intro'), {
          sectionCard: {
            title: oc(t, 'ui.personal_identity'),
            subtitle: oc(t, 'messages.personal_subtitle'),
            steps: personalSectionSteps,
          },
          options: [
            ocOpt(t, 'start_personal_section', 'start_personal_section'),
            ocOpt(t, 'finish_later', 'open_defer_modal'),
          ],
        })
        break
      case 'professional_confirm': {
        const role = data?.role || collected.role || ''
        const company = data?.company || collected.company || ''
        if (role && company) {
          addSteveMessage(oc(t, 'messages.professional_confirm_both', { role, company }), {
            options: [
              ocOpt(t, 'yes_professional_correct', 'confirm_professional'),
              ocOpt(t, 'fix_role', 'edit_role_only'),
              ocOpt(t, 'fix_company', 'edit_company_only'),
              ocOpt(t, 'fix_both', 'edit_professional'),
            ],
          })
        } else if (role) {
          addSteveMessage(oc(t, 'messages.professional_confirm_role', { role }), {
            options: [
              ocOpt(t, 'yes_professional_correct', 'confirm_professional'),
              ocOpt(t, 'add_company', 'edit_company_only'),
              ocOpt(t, 'fix_role', 'edit_role_only'),
            ],
          })
        } else {
          addSteveMessage(oc(t, 'messages.professional_ask_short'), {
            inputType: 'text',
            inputPlaceholder: oc(t, 'placeholders.professional'),
          })
          setStage('professional')
        }
        break
      }
      case 'professional_section_intro':
        addSteveMessage(oc(t, 'messages.professional_intro'), {
          sectionCard: {
            title: oc(t, 'ui.professional_identity'),
            subtitle: oc(t, 'messages.professional_subtitle'),
            steps: professionalSectionSteps,
          },
          options: [
            ocOpt(t, 'import_cv', 'start_cv_upload'),
            ocOpt(t, 'start_professional_section', 'start_professional_section'),
            ocOpt(t, 'finish_later', 'open_defer_modal'),
          ],
        })
        break
      case 'cv_review':
        break
      case 'personal_bio_review':
        composeBio('personal', data)
        break
      case 'professional_bio_review':
        composeBio('professional', data)
        break
      case 'profile_review':
        addSteveMessage(oc(t, 'messages.profile_review'), {
          profileReview: {
            personalBio: data.bio,
            professionalBio: data.professionalBio,
            linkedinAdded: !!data.linkedin?.trim(),
            companyIntelAdded: !!(data.companyIntel?.trim()),
          },
          options: [
            ocOpt(t, 'looks_good', 'finish_profile_review'),
            ocOpt(t, 'finish_later', 'open_defer_modal'),
          ],
        })
        break
      case 'manual_bio_edit':
        break
      case 'enriching':
        addSteveMessage(oc(t, 'messages.enriching_complete'))
        setTimeout(() => advanceToComplete(), 800)
        break
      case 'review':
        addSteveMessage(oc(t, 'messages.review_complete'))
        setTimeout(() => advanceToComplete(), 800)
        break
      case 'complete':
        showCompleteMsg()
        break
    }
  }

  function advanceTo(next: Stage, data?: Collected) {
    const c = data || collected
    const mainStages: Stage[] = [
      'name', 'location', 'photo', 'section_picker', 'personal_section_intro', 'talk_all_day',
      'reach_out', 'journey', 'recommend', 'optional_social', 'personal_bio_review',
      'professional_section_intro', 'cv_upload', 'cv_review', 'professional', 'professional_associations',
      'professional_strengths', 'linkedin', 'professional_bio_review', 'profile_review',
    ]
    if (mainStages.includes(next)) {
      const hist = stageHistory.current
      if (hist[hist.length - 1] !== next) hist.push(next)
    }
    setStage(next)
    saveState(next, c)
    startStage(next, c)
  }

  function finishProfileBuilderQueueAndGoName(c: Collected) {
    profileBuilderPostPbRef.current = {
      skipLocation: !!(c.city?.trim() && c.country?.trim()),
      skipProfessional: !!(c.role?.trim() && c.company?.trim()),
    }
    pbConfirmQueueRef.current = []
    pbEditFieldRef.current = null
    advanceTo('name', c)
  }

  function advanceToComplete() {
    setStage('complete')
    showCompleteMsg()
  }

  async function runB2bBootstrap(childNames: string[], c: Collected) {
    const parentName = (b2bParentRef.current || c.b2bParentName || '').trim()
    const orgHint = (b2bOrgRef.current || c.b2bOrgTypeHint || '').trim()
    if (!parentName) {
      addSteveMessage(oc(t, 'messages.bootstrap_need_name'), {
        inputType: 'text',
        inputPlaceholder: oc(t, 'placeholders.network_name'),
      })
      setStage('b2b_parent_name')
      saveState('b2b_parent_name', c)
      return
    }
    const parentType = mapOrgHintToParentType(orgHint)
    setIsTyping(true)
    addSteveMessage(oc(t, 'messages.bootstrap_creating'))
    try {
      const j = await onboardingApi.bootstrapCommunities(parentName, parentType, childNames)
      setIsTyping(false)
      if (j?.success) {
        addSteveMessage(oc(t, 'messages.bootstrap_success'))
        setTimeout(() => advanceTo('name', c), 600)
      } else {
        const err = (j?.error || oc(t, 'errors.bootstrap_fail')) as string
        addSteveMessage(oc(t, 'messages.bootstrap_error', { error: err }))
        setStage('b2b_parent_name')
        saveState('b2b_parent_name', c)
        startStage('b2b_parent_name', c)
      }
    } catch {
      setIsTyping(false)
      addSteveMessage(oc(t, 'messages.bootstrap_network_error'))
      setStage('b2b_parent_name')
      saveState('b2b_parent_name', c)
      startStage('b2b_parent_name', c)
    }
  }

  function showCompleteMsg() {
    if (isSectionOnly) {
      addSteveMessage(sectionOnlyCompleteMessage(t, sectionOnlyTarget === 'professional' ? 'professional' : 'personal'), {
        options: sectionOnlyCompleteOptions(t),
      })
      return
    }
    addSteveMessage(oc(t, 'messages.complete'), {
      options: [
        { ...ocOpt(t, 'go_dashboard', 'go_feed'), primary: true },
        ocOpt(t, 'show_me_around', 'start_tour'),
        ocOpt(t, 'add_edit_profile', 'edit_profile'),
        ocOpt(t, 'create_community', 'create_community'),
      ],
    })
  }

  async function composeBio(
    kind: 'personal' | 'professional',
    data?: Collected,
    style?: 'more_natural' | 'shorter' | 'more_professional',
    currentBio?: string,
  ) {
    const c = data || collected
    setComposingBio(true)
    setBioDraftingKind(kind)
    setIsTyping(true)
    try {
      const reuseIntel =
        kind === 'professional' && style && (currentBio || '').trim()
          ? lastComposedCompanyIntelRef.current
          : ''
      const j = await onboardingApi.composeBioRequest({
        kind,
        talk_all_day: c.talkAllDay,
        recommend: c.recommend,
        reach_out: c.reachOut,
        journey: c.journey,
        role: c.role,
        company: c.company,
        professional_associations: c.professionalAssociations,
        professional_strengths: c.professionalStrengths,
        city: c.city,
        country: c.country,
        style,
        current_bio: currentBio || '',
        opposite_bio: kind === 'professional' ? (c.bio || '').trim() : (c.professionalBio || '').trim(),
        existing_bio:
          kind === 'professional'
            ? ((mode === 'profile_builder' || isSectionOnly)
                ? (originalProfessionalBioRef.current || '').trim()
                : (c.professionalBio || '').trim())
            : ((mode === 'profile_builder' || isSectionOnly)
                ? (originalPublicBioRef.current || '').trim()
                : (c.bio || '').trim()),
        reuse_company_intel: reuseIntel,
      })
      const bio = j?.bio || ''
      const companyIntelRaw = (j?.company_intel || '').trim()
      setComposingBio(false)
      setBioDraftingKind(null)
      setIsTyping(false)
      if (bio) {
        if (kind === 'professional') {
          if (companyIntelRaw) {
            lastComposedCompanyIntelRef.current = companyIntelRaw
            setCollected(prev => ({ ...prev, companyIntel: companyIntelRaw }))
          } else if (!reuseIntel) {
            lastComposedCompanyIntelRef.current = ''
            setCollected(prev => ({ ...prev, companyIntel: '' }))
          }
        }
        const msgOpts: Partial<ChatMessage> = { composedBio: bio, composedBioKind: kind }
        if (kind === 'professional' && companyIntelRaw) {
          msgOpts.composedCompanyIntel = companyIntelRaw
        }
        addSteveMessage(
          kind === 'personal' ? oc(t, 'messages.bio_personal_intro') : oc(t, 'messages.bio_professional_intro'),
          msgOpts,
        )
      } else {
        addSteveMessage(oc(t, 'messages.bio_compose_fail', { kind }), {
          inputType: 'textarea',
          inputPlaceholder:
            kind === 'personal' ? oc(t, 'placeholders.bio_personal') : oc(t, 'placeholders.bio_professional'),
        })
      }
    } catch {
      setComposingBio(false)
      setBioDraftingKind(null)
      setIsTyping(false)
      addSteveMessage(oc(t, 'messages.bio_compose_error', { kind }), {
        inputType: 'textarea',
        inputPlaceholder:
          kind === 'personal' ? oc(t, 'placeholders.bio_personal') : oc(t, 'placeholders.bio_professional'),
      })
    }
  }

  function handleCardAction(cardId: string, action: 'accepted' | 'dismissed') {
    setEnrichmentCards(prev => prev.map(c => c.id === cardId ? { ...c, status: action } : c))
  }

  function allCardsReviewed(): boolean {
    return enrichmentCards.length > 0 && enrichmentCards.every(c => c.status !== 'pending')
  }

  async function handleFinishReview() {
    addUserMessage(oc(t, 'messages.enrichment_done'))
    const accepted = enrichmentCards.filter(c => c.status === 'accepted')
    if (accepted.length > 0) {
      addSteveMessage(
        t('onboarding_chat.messages.enrichment_added', {
          count: accepted.length,
          defaultValue:
            accepted.length === 1
              ? oc(t, 'messages.enrichment_added', { count: 1 })
              : oc(t, 'messages.enrichment_added_other', { count: accepted.length }),
        }),
      )
    }
    await onboardingApi.saveCompleteWithEnrichment(collected, accepted.map(c => c.id))
    setTimeout(() => advanceToComplete(), 800)
  }

  async function finishLater() {
    if (deferringProfile) return
    setDeferringProfile(true)
    setDeferError('')
    addUserMessage(oc(t, 'user_echo.finish_later'))
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 12000)
    try {
      const serializable = messages.slice(-30).map(m => ({ from: m.from, text: m.text }))
      const { ok, j } = await onboardingApi.deferProfile({ stage, collected, messages: serializable }, controller.signal)
      if (ok && j?.success) {
        addSteveMessage(oc(t, 'messages.defer_saved'))
        setShowDeferConfirm(false)
        setTimeout(() => onExit(), 800)
      } else {
        setDeferError(j?.error || oc(t, 'errors.defer_save'))
      }
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === 'AbortError'
      setDeferError(timedOut ? oc(t, 'errors.defer_timeout') : oc(t, 'errors.defer_save'))
    } finally {
      window.clearTimeout(timeoutId)
      setDeferringProfile(false)
    }
  }

  // Option-click actions: the former `handleOptionClick` switch as a
  // registry. Values that shared a `case` fallthrough share a handler;
  // unknown values no-op, matching the old switch's missing default.
  const openDeferModal = () => {
    setShowDeferConfirm(true)
  }

  const chooseB2bSize = (value: string) => {
    addUserMessage(b2bNetworkSizeLabel(t, value, tierHintsRef.current || tierHints))
    const newCollected = { ...collected, b2bNetworkSize: value }
    setCollected(newCollected)
    advanceTo('b2b_tier_guidance', newCollected)
  }

  const restyleBio = async (value: string) => {
    const lastMessage = [...messages].reverse().find(m => m.composedBio)
    const kind = lastMessage?.composedBioKind || 'personal'
    const style =
      value === 'bio_shorter'
        ? 'shorter'
        : value === 'bio_more_professional'
          ? 'more_professional'
          : 'more_natural'
    addUserMessage(
      value === 'bio_shorter'
        ? oc(t, 'user_echo.shorter')
        : value === 'bio_more_professional'
          ? oc(t, 'user_echo.more_professional')
          : oc(t, 'user_echo.more_natural'),
    )
    await composeBio(kind, collected, style, lastMessage?.composedBio || '')
  }

  const optionActions: Record<string, (value: string) => void | Promise<void>> = {
    intent_b2c: () => {
      addUserMessage(oc(t, 'user_echo.intent_b2c'))
      onboardingIntentRef.current = 'b2c'
      advanceTo('name', collected)
    },
    intent_b2b: () => {
      addUserMessage(oc(t, 'user_echo.intent_b2b'))
      onboardingIntentRef.current = 'b2b'
      advanceTo('b2b_network_size', collected)
    },
    b2b_value_continue: () => {
      addUserMessage(oc(t, 'user_echo.continue'))
      advanceTo('b2b_network_size', collected)
    },
    b2b_skip_subs: async () => {
      addUserMessage(oc(t, 'user_echo.skip_subs'))
      await runB2bBootstrap([], collected)
    },
    open_defer_modal: openDeferModal,
    defer_profile_72: openDeferModal,
    b2b_size_free: chooseB2bSize,
    b2b_size_paid_l1: chooseB2bSize,
    b2b_size_paid_l2: chooseB2bSize,
    b2b_size_paid_l3: chooseB2bSize,
    b2b_size_enterprise: chooseB2bSize,
    b2b_tier_continue: () => {
      addUserMessage(oc(t, 'user_echo.continue_network'))
      advanceTo('b2b_parent_name', collected)
    },
    contact_sales_enterprise: () => {
      addUserMessage(oc(t, 'user_echo.contact_sales'))
      window.location.href = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(oc(t, 'sales.email_subject'))}`
      addSteveMessage(oc(t, 'messages.sales_email_opened'), {
        options: [ocOpt(t, 'continue_creating_network', 'b2b_tier_continue')],
      })
    },
    start: () => {
      addUserMessage(oc(t, 'user_echo.lets_go'))
      if (mode === 'profile_builder') {
        advanceTo('profile_builder_summary')
      } else {
        advanceTo('name')
      }
    },
    pb_summary_continue: () => {
      addUserMessage(oc(t, 'user_echo.continue'))
      const q = buildProfileBuilderConfirmQueue(collected)
      pbConfirmQueueRef.current = q
      if (q.length === 0) {
        finishProfileBuilderQueueAndGoName(collected)
      } else {
        advanceTo('pb_confirm_field')
      }
    },
    pb_confirm_yes: () => {
      addUserMessage(oc(t, 'user_echo.yes'))
      const rest = pbConfirmQueueRef.current.slice(1)
      pbConfirmQueueRef.current = rest
      if (rest.length === 0) {
        finishProfileBuilderQueueAndGoName(collected)
      } else {
        setStage('pb_confirm_field')
        saveState('pb_confirm_field', collected)
        startStage('pb_confirm_field', collected)
      }
    },
    pb_confirm_update: () => {
      addUserMessage(oc(t, 'user_echo.update'))
      const head = pbConfirmQueueRef.current[0]
      if (!head) {
        finishProfileBuilderQueueAndGoName(collected)
        return
      }
      pbEditFieldRef.current = head
      setStage('pb_edit_field')
      saveState('pb_edit_field', collected)
      startStage('pb_edit_field', collected)
    },
    confirm_name: () => {
      addUserMessage(oc(t, 'user_echo.thats_correct'))
      const displayName = `${collected.firstName} ${collected.lastName}`.trim()
      if (displayName) saveField('display_name', displayName)
      if (mode === 'profile_builder' && profileBuilderPostPbRef.current.skipLocation) {
        advanceTo('photo')
      } else {
        advanceTo('location')
      }
    },
    edit_name: () => {
      addUserMessage(oc(t, 'user_echo.let_me_fix'))
      addSteveMessage(oc(t, 'messages.edit_name'), {
        inputType: 'text',
        inputPlaceholder: oc(t, 'placeholders.first_last'),
      })
    },
    confirm_location: async () => {
      addUserMessage(oc(t, 'user_echo.yes_location', { city: collected.city, country: collected.country }))
      await saveField('city', collected.city)
      await saveField('country', collected.country)
      advanceTo('photo')
    },
    edit_location: () => {
      addUserMessage(oc(t, 'user_echo.let_me_correct'))
      addSteveMessage(oc(t, 'messages.edit_location'), {
        inputType: 'text',
        inputPlaceholder: oc(t, 'placeholders.location'),
      })
      setStage('location')
    },
    confirm_professional: async () => {
      const profLabel = collected.company
        ? `${collected.role} at ${collected.company}`
        : collected.role
      addUserMessage(oc(t, 'user_echo.yes_professional', { label: profLabel }))
      await saveField('role', collected.role)
      if (collected.company) await saveField('company', collected.company)
      advanceTo('professional_associations')
    },
    edit_professional: () => {
      addUserMessage(oc(t, 'user_echo.let_me_fix_both'))
      addSteveMessage(oc(t, 'messages.edit_professional'), {
        inputType: 'text',
        inputPlaceholder: oc(t, 'placeholders.professional'),
      })
      setStage('professional')
    },
    edit_role_only: () => {
      addUserMessage(oc(t, 'user_echo.fix_role'))
      addSteveMessage(oc(t, 'messages.edit_role'), {
        inputType: 'text',
        inputPlaceholder: oc(t, 'placeholders.role_title'),
      })
      setStage('fix_role')
    },
    edit_company_only: () => {
      addUserMessage(collected.company ? oc(t, 'user_echo.fix_company') : oc(t, 'user_echo.add_company'))
      addSteveMessage(oc(t, 'messages.edit_company'), {
        inputType: 'text',
        inputPlaceholder: oc(t, 'placeholders.company'),
      })
      setStage('fix_company')
    },
    skip_city: async () => {
      addUserMessage(oc(t, 'user_echo.skip_country'))
      await saveField('country', collected.country)
      advanceTo('photo')
    },
    go_back: () => {
      addUserMessage(oc(t, 'user_echo.go_back'))
      const hist = stageHistory.current
      if (hist.length >= 2) {
        hist.pop()
        const prev = hist[hist.length - 1]
        addSteveMessage(oc(t, 'messages.go_back_ok'))
        setTimeout(() => {
          setStage(prev)
          startStage(prev)
        }, 400)
      } else {
        addSteveMessage(oc(t, 'messages.go_back_start'))
      }
    },
    gibberish_skip: () => {
      addUserMessage(oc(t, 'user_echo.yes_skip'))
      const skipMap: Partial<Record<Stage, Stage>> = {
        talk_all_day: 'reach_out',
        reach_out: 'journey',
        journey: 'recommend',
        recommend: 'optional_social',
        optional_social: 'personal_bio_review',
        professional: 'professional_associations',
        professional_associations: 'professional_strengths',
        professional_strengths: 'linkedin',
        linkedin: 'professional_bio_review',
      }
      const returnStage = gibberishReturnStage.current
      gibberishReturnStage.current = null
      const nextStage = (returnStage && skipMap[returnStage]) || 'photo'
      addSteveMessage(oc(t, 'messages.gibberish_skip'))
      setTimeout(() => advanceTo(nextStage), 600)
    },
    gibberish_retry: () => {
      addUserMessage(oc(t, 'user_echo.let_me_try'))
      const retryStage = gibberishReturnStage.current
      gibberishReturnStage.current = null
      if (retryStage) {
        startStage(retryStage)
        setStage(retryStage)
      }
    },
    skip_photo: () => {
      addUserMessage(oc(t, 'user_echo.skip_photo'))
      addSteveMessage(oc(t, 'messages.skip_photo'))
      setTimeout(() => advanceTo('section_picker'), 600)
    },
    choose_personal_section: () => {
      addUserMessage(oc(t, 'user_echo.personal_section'))
      const order = collected.profileSectionOrder?.includes('personal')
        ? collected.profileSectionOrder
        : [...(collected.profileSectionOrder || []), 'personal' as ProfileSection]
      const newCollected = { ...collected, activeProfileSection: 'personal' as ProfileSection, profileSectionOrder: order }
      setCollected(newCollected)
      advanceTo(startOrResumeSection('personal', newCollected), newCollected)
    },
    choose_professional_section: () => {
      addUserMessage(oc(t, 'user_echo.professional_section'))
      const order = collected.profileSectionOrder?.includes('professional')
        ? collected.profileSectionOrder
        : [...(collected.profileSectionOrder || []), 'professional' as ProfileSection]
      const newCollected = { ...collected, activeProfileSection: 'professional' as ProfileSection, profileSectionOrder: order }
      setCollected(newCollected)
      advanceTo(startOrResumeSection('professional', newCollected), newCollected)
    },
    finish_sections_review: () => {
      addUserMessage(oc(t, 'user_echo.review_profile'))
      advanceTo('profile_review')
    },
    start_cv_upload: () => {
      addUserMessage(oc(t, 'user_echo.import_cv'))
      advanceTo('cv_upload', collected)
    },
    cv_skip_to_manual: () => {
      addUserMessage(oc(t, 'user_echo.type_manually'))
      advanceTo('professional', { ...collected, workHistory: undefined, currentRoleStartYm: '' })
    },
    confirm_cv_import: () => {
      addUserMessage(oc(t, 'user_echo.cv_confirm'))
      ;(async () => {
        const c = collected
        try {
          const { ok, j } = await onboardingApi.applyProfessionalStructured(c)
          if (ok && j?.success) {
            if (c.role?.trim()) await saveField('role', c.role)
            if (c.company?.trim()) await saveField('company', c.company)
            advanceTo('professional_confirm', c)
          } else {
            addSteveMessage((j?.error as string) || oc(t, 'errors.cv_save'), {
              options: [
                ocOpt(t, 'try_again', 'confirm_cv_import'),
                ocOpt(t, 'type_manually_short', 'reject_cv_import'),
              ],
            })
          }
        } catch {
          addSteveMessage(oc(t, 'errors.cv_save_network'), {
            options: [
              ocOpt(t, 'try_again', 'confirm_cv_import'),
              ocOpt(t, 'type_manually_short', 'reject_cv_import'),
            ],
          })
        }
      })()
    },
    reject_cv_import: () => {
      addUserMessage(oc(t, 'user_echo.type_instead'))
      const reset: Collected = {
        ...collected,
        role: '',
        company: '',
        currentRoleStartYm: '',
        workHistory: undefined,
        professionalBio: '',
      }
      setCollected(reset)
      advanceTo('professional', reset)
    },
    cv_retry_pick: () => {
      addUserMessage(oc(t, 'user_echo.pick_another'))
      setCvFile(null)
      try {
        if (cvFileInputRef.current) cvFileInputRef.current.value = ''
      } catch {}
      setStage('cv_upload')
      saveState('cv_upload', collected)
      addSteveMessage(oc(t, 'messages.cv_upload'), {
        cvUpload: true,
        options: [
          ocOpt(t, 'type_manually', 'cv_skip_to_manual'),
          ocOpt(t, 'go_back', 'go_back'),
        ],
      })
    },
    start_personal_section: () => {
      addUserMessage(oc(t, 'user_echo.start_personal'))
      advanceTo('talk_all_day')
    },
    start_professional_section: () => {
      addUserMessage(oc(t, 'user_echo.start_professional'))
      advanceTo('professional')
    },
    skip_optional_social: () => {
      addUserMessage(oc(t, 'user_echo.skip'))
      advanceTo('personal_bio_review')
    },
    skip_linkedin: () => {
      addUserMessage(oc(t, 'user_echo.skip'))
      const newCollected = { ...collected, linkedin: '', linkedinDone: true }
      setCollected(newCollected)
      advanceTo('professional_bio_review', newCollected)
    },
    skip_journey: () => {
      addUserMessage(oc(t, 'user_echo.skip'))
      advanceTo('recommend')
    },
    skip_professional_associations: () => {
      // Skipping the first "extras" question skips its sibling too —
      // one decision, not two.
      addUserMessage(oc(t, 'user_echo.skip'))
      advanceTo('linkedin')
    },
    skip_professional_strengths: () => {
      addUserMessage(oc(t, 'user_echo.skip'))
      advanceTo('linkedin')
    },
    skip_recommend: () => {
      addUserMessage(oc(t, 'user_echo.skip'))
      advanceTo('optional_social')
    },
    use_bio: async () => {
      const lastMessage = [...messages].reverse().find(m => m.composedBio)
      const lastComposed = lastMessage?.composedBio || ''
      const kind = lastMessage?.composedBioKind || 'personal'
      const intel =
        kind === 'professional'
          ? ((lastMessage?.composedCompanyIntel || lastComposedCompanyIntelRef.current || '').trim())
          : ''
      if (lastComposed) {
        addUserMessage(oc(t, 'user_echo.use_this'))
        const newCollected =
          kind === 'professional'
            ? {
                ...collected,
                professionalBio: lastComposed,
                companyIntel: intel || collected.companyIntel,
                professionalSectionComplete: true,
                linkedinDone: true,
              }
            : { ...collected, bio: lastComposed, personalSectionComplete: true }
        setCollected(newCollected)
        await saveField(kind === 'professional' ? 'professional_about' : 'bio', lastComposed)
        if (kind === 'professional' && intel) {
          await saveField('professional_company_intel', intel)
        }
        addSteveMessage(
          kind === 'professional' ? oc(t, 'messages.bio_saved_professional') : oc(t, 'messages.bio_saved_personal'),
        )
        setTimeout(() => {
          if (isSectionOnly) {
            advanceToComplete()
          } else {
            advanceTo(nextSectionAfterCompletion(newCollected), newCollected)
          }
        }, 800)
      }
    },
    bio_more_natural: restyleBio,
    bio_shorter: restyleBio,
    bio_more_professional: restyleBio,
    edit_bio: () => {
      const lastMessage = [...messages].reverse().find(m => m.composedBio)
      const bioToEdit = lastMessage?.composedBio || ''
      addUserMessage(oc(t, 'user_echo.let_me_edit'))
      setInputValue(bioToEdit)
      addSteveMessage(oc(t, 'messages.manual_bio_edit'), {
        inputType: 'textarea',
        inputPlaceholder: oc(t, 'placeholders.edit_bio'),
      })
      setStage('manual_bio_edit')
      saveState('manual_bio_edit', collected)
    },
    redo_bio: () => {
      lastComposedCompanyIntelRef.current = ''
      setCollected(prev => ({ ...prev, companyIntel: '' }))
      addUserMessage(oc(t, 'user_echo.start_fresh'))
      addSteveMessage(oc(t, 'messages.redo_bio'), {
        inputType: 'textarea',
        inputPlaceholder: oc(t, 'placeholders.write_bio'),
      })
      setStage('manual_bio_edit')
      saveState('manual_bio_edit', collected)
    },
    finish_profile_review: () => {
      addUserMessage(oc(t, 'user_echo.looks_good'))
      addSteveMessage(oc(t, 'messages.profile_sections_set'))
      setTimeout(() => advanceToComplete(), 800)
    },
    start_tour: async () => {
      addUserMessage(oc(t, 'user_echo.show_around'))
      await completeOnboarding()
      setTourStep(0)
    },
    go_feed: async () => {
      if (!isSectionOnly) {
        await completeOnboarding()
      }
      onComplete()
    },
    edit_profile: async () => {
      addUserMessage(oc(t, 'user_echo.add_edit_profile'))
      if (!isSectionOnly) {
        await completeOnboarding()
      }
      window.location.href = '/profile'
    },
    create_community: async () => {
      await completeOnboarding()
      onCreateCommunity()
    },
  }

  async function handleOptionClick(value: string) {
    const action = optionActions[value]
    if (action) await action(value)
  }

  async function completeOnboarding() {
    await onboardingApi.completeOnboardingRequest()
    try { localStorage.setItem(`onboarding_done:${username}`, '1') } catch {}
  }

  async function handleSubmit() {
    const val = inputValue.trim()
    if (!val) return
    addUserMessage(val)
    setInputValue('')

    const isOffScript = detectOffScript(stage, val)
    if (isOffScript) {
      await handleOffScript(val)
      return
    }

    if (STAGES_REQUIRING_VALIDATION.includes(stage) && looksLikeMeaninglessInput(val)) {
      gibberishReturnStage.current = stage
      addSteveMessage(oc(t, 'messages.gibberish'), {
        options: [
          ocOpt(t, 'yes_skip', 'gibberish_skip'),
          ocOpt(t, 'no_try_again', 'gibberish_retry'),
        ],
      })
      return
    }

    switch (stage) {
      case 'name': {
        const parts = val.split(/\s+/)
        const first = parts[0] || ''
        const last = parts.slice(1).join(' ') || ''
        if (!first) {
          addSteveMessage(oc(t, 'messages.name_need_first'), {
            inputType: 'text',
            inputPlaceholder: oc(t, 'placeholders.first_last'),
          })
          return
        }
        const newCollected = { ...collected, firstName: first, lastName: last }
        setCollected(newCollected)
        await saveField('first_name', first)
        if (last) await saveField('last_name', last)
        const displayName = `${first} ${last}`.trim()
        await saveField('display_name', displayName)
        if (mode === 'profile_builder' && profileBuilderPostPbRef.current.skipLocation) {
          advanceTo('photo', newCollected)
        } else {
          advanceTo('location', newCollected)
        }
        break
      }
      case 'location': {
        const locParts = val.split(',').map(s => s.trim())
        const city = locParts[0] || val
        const country = locParts[1] || ''
        if (city && country) {
          const newCollected = { ...collected, city, country }
          setCollected(newCollected)
          advanceTo('location_confirm', newCollected)
        } else {
          setIsTyping(true)
          try {
            const j = await onboardingApi.resolveLocation(val)
            setIsTyping(false)
            const locType = j?.type || 'unrecognized'
            if (locType === 'country_only') {
              const newCollected = { ...collected, city: '', country: j?.country || val }
              setCollected(newCollected)
              advanceTo('location_city', newCollected)
            } else if (locType === 'city_and_country' && j?.city && j?.country) {
              const newCollected = { ...collected, city: j.city, country: j.country }
              setCollected(newCollected)
              advanceTo('location_confirm', newCollected)
            } else {
              addSteveMessage(oc(t, 'messages.location_fail'))
              setTimeout(() => advanceTo('photo'), 800)
            }
          } catch {
            setIsTyping(false)
            addSteveMessage(oc(t, 'messages.location_fail'))
            setTimeout(() => advanceTo('photo'), 800)
          }
        }
        break
      }
      case 'location_city': {
        const newCollected = { ...collected, city: val }
        setCollected(newCollected)
        advanceTo('location_confirm', newCollected)
        break
      }
      case 'talk_all_day': {
        const newCollected = { ...collected, talkAllDay: val }
        setCollected(newCollected)
        addSteveMessage(reactionMessage(t))
        setTimeout(() => advanceTo('reach_out', newCollected), 600)
        break
      }
      case 'reach_out': {
        const newCollected = { ...collected, reachOut: val }
        setCollected(newCollected)
        advanceTo('journey', newCollected)
        break
      }
      case 'pb_edit_field': {
        const field = pbEditFieldRef.current
        if (!field) break
        const newCollected: Collected = { ...collected, [field]: val }
        setCollected(newCollected)
        await saveField(field, val)
        const rest = pbConfirmQueueRef.current.slice(1)
        pbConfirmQueueRef.current = rest
        pbEditFieldRef.current = null
        if (rest.length === 0) {
          finishProfileBuilderQueueAndGoName(newCollected)
        } else {
          setStage('pb_confirm_field')
          saveState('pb_confirm_field', newCollected)
          startStage('pb_confirm_field', newCollected)
        }
        break
      }
      case 'professional': {
        setIsTyping(true)
        try {
          const j = await onboardingApi.resolveRole(val)
          setIsTyping(false)
          const role = j?.role || val
          const company = j?.company || ''
          const newCollected = { ...collected, role, company }
          setCollected(newCollected)
          advanceTo('professional_confirm', newCollected)
        } catch {
          setIsTyping(false)
          const newCollected = { ...collected, role: val, company: '' }
          setCollected(newCollected)
          advanceTo('professional_confirm', newCollected)
        }
        break
      }
      case 'fix_role': {
        const newCollected = { ...collected, role: val }
        setCollected(newCollected)
        advanceTo('professional_confirm', newCollected)
        break
      }
      case 'fix_company': {
        const newCollected = { ...collected, company: val }
        setCollected(newCollected)
        advanceTo('professional_confirm', newCollected)
        break
      }
      case 'professional_associations': {
        const newCollected = { ...collected, professionalAssociations: val }
        setCollected(newCollected)
        advanceTo('professional_strengths', newCollected)
        break
      }
      case 'professional_strengths': {
        const newCollected = { ...collected, professionalStrengths: val }
        setCollected(newCollected)
        advanceTo('linkedin', newCollected)
        break
      }
      case 'linkedin': {
        const parsed = validateLinkedInProfileUrl(t, val)
        if (!parsed.ok) {
          addSteveMessage(parsed.error || oc(t, 'validation.linkedin_fallback'), {
            inputType: 'url',
            inputPlaceholder: oc(t, 'placeholders.linkedin'),
            options: [ocOpt(t, 'skip', 'skip_linkedin')],
          })
          return
        }
        const newCollected = { ...collected, linkedin: parsed.url || val, linkedinDone: true }
        setCollected(newCollected)
        await saveField('linkedin', parsed.url || val)
        addSteveMessage(oc(t, 'messages.linkedin_saved'))
        setTimeout(() => advanceTo('professional_bio_review', newCollected), 600)
        break
      }
      case 'recommend': {
        const newCollected = { ...collected, recommend: val }
        setCollected(newCollected)
        addSteveMessage(oc(t, 'messages.recommend_ok'))
        setTimeout(() => advanceTo('optional_social', newCollected), 600)
        break
      }
      case 'optional_social': {
        const links = parseSocialUrlsFromInput(val)
        if (links.length > 0) {
          await onboardingApi.saveSocialLinks(links)
          addSteveMessage(oc(t, 'messages.social_saved'))
        } else {
          addSteveMessage(oc(t, 'messages.social_skip'))
        }
        setTimeout(() => advanceTo('personal_bio_review', collected), 600)
        break
      }
      case 'journey': {
        const newCollected = { ...collected, journey: val }
        setCollected(newCollected)
        addSteveMessage(oc(t, 'messages.journey_thanks'))
        setTimeout(() => advanceTo('recommend', newCollected), 800)
        break
      }
      case 'manual_bio_edit': {
        const lastKind = [...messages].reverse().find(m => m.composedBio)?.composedBioKind || 'personal'
        const intel = lastComposedCompanyIntelRef.current.trim()
        const newCollected =
          lastKind === 'professional'
            ? {
                ...collected,
                professionalBio: val,
                companyIntel: intel || collected.companyIntel,
                professionalSectionComplete: true,
                linkedinDone: true,
              }
            : { ...collected, bio: val, personalSectionComplete: true }
        setCollected(newCollected)
        await saveField(lastKind === 'professional' ? 'professional_about' : 'bio', val)
        if (lastKind === 'professional' && intel) {
          await saveField('professional_company_intel', intel)
        }
        addSteveMessage(
          lastKind === 'professional' ? oc(t, 'messages.bio_saved_professional') : oc(t, 'messages.bio_saved_personal'),
        )
        setTimeout(() => {
          if (isSectionOnly) {
            advanceToComplete()
          } else {
            advanceTo(nextSectionAfterCompletion(newCollected), newCollected)
          }
        }, 800)
        break
      }
      case 'b2b_org_type': {
        const newCollected = { ...collected, b2bOrgTypeHint: val }
        b2bOrgRef.current = val
        setCollected(newCollected)
        await runB2bBootstrap([], newCollected)
        break
      }
      case 'b2b_parent_name': {
        const newCollected = { ...collected, b2bParentName: val }
        b2bParentRef.current = val
        setCollected(newCollected)
        advanceTo('b2b_org_type', newCollected)
        break
      }
      case 'b2b_sub_names': {
        const parts = val.split(',').map(s => s.trim()).filter(Boolean)
        await runB2bBootstrap(parts, collected)
        break
      }
      default:
        break
    }
  }

  async function handleOffScript(userMsg: string) {
    setIsTyping(true)
    try {
      const questionMap: Record<string, string> = {
        name: oc(t, 'off_script_questions.name'),
        location: oc(t, 'off_script_questions.location'),
        professional: oc(t, 'off_script_questions.professional'),
        linkedin: oc(t, 'off_script_questions.linkedin'),
        optional_social: oc(t, 'off_script_questions.optional_social'),
        journey: oc(t, 'off_script_questions.journey'),
        talk_all_day: oc(t, 'off_script_questions.talk_all_day'),
        recommend: oc(t, 'off_script_questions.recommend'),
        reach_out: oc(t, 'off_script_questions.reach_out'),
        pb_edit_field: oc(t, 'off_script_questions.pb_edit_field'),
        b2b_network_size: oc(t, 'off_script_questions.b2b_network_size'),
        b2b_tier_guidance: oc(t, 'off_script_questions.b2b_tier_guidance'),
        b2b_org_type: oc(t, 'copy.org_type_prompt'),
        b2b_parent_name: oc(t, 'off_script_questions.b2b_parent_name'),
        b2b_sub_names: oc(t, 'off_script_questions.b2b_sub_names'),
        cv_upload: oc(t, 'off_script_questions.cv_upload'),
        cv_review: oc(t, 'off_script_questions.cv_review'),
      }
      const j = await onboardingApi.redirectOffScript(userMsg, stage, questionMap[stage] || '')
      setIsTyping(false)
      const redirectMsg = j?.message || oc(t, 'messages.off_script_fallback')
      setMessages(prev => [...prev, { from: 'steve', text: redirectMsg }])
      scrollToBottom()
    } catch {
      setIsTyping(false)
      setMessages(prev => [...prev, { from: 'steve', text: oc(t, 'messages.off_script_error') }])
      scrollToBottom()
    }
  }

  async function handlePhotoUpload() {
    if (!picFile) return
    setUploadingPic(true)
    try {
      const { ok, j } = await onboardingApi.uploadProfilePicture(picFile)
      if (ok && j?.success) {
        addUserMessage(oc(t, 'user_echo.photo_uploaded'))
        addSteveMessage(oc(t, 'messages.photo_great'))
        setPicFile(null)
        setTimeout(() => advanceTo('section_picker'), 600)
      } else {
        addSteveMessage(j?.error || oc(t, 'errors.photo_upload'), {
          photoUpload: true,
          options: [ocOpt(t, 'skip_photo', 'skip_photo')],
        })
      }
    } catch {
      addSteveMessage(oc(t, 'errors.photo_network'), {
        photoUpload: true,
        options: [ocOpt(t, 'skip_photo', 'skip_photo')],
      })
    } finally {
      setUploadingPic(false)
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) {
      setPicFile(f)
      try {
        setPicPreview(URL.createObjectURL(f))
      } catch {
        /* ignore */
      }
    }
  }

  function handleCvFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) setCvFile(f)
  }

  async function handleCvParseUpload() {
    if (!cvFile) return
    setCvUploading(true)
    setIsTyping(true)
    addSteveMessage(oc(t, 'messages.reading_cv'))
    try {
      const { ok, j } = await onboardingApi.parseCvUpload(cvFile)
      setIsTyping(false)
      if (ok && j?.success) {
        const wh: WorkHistoryRow[] = Array.isArray(j.work_history)
          ? j.work_history.map((row: Record<string, unknown>) => ({
              title: String(row.title ?? ''),
              company: String(row.company ?? ''),
              location: String(row.location ?? ''),
              start: String(row.start ?? ''),
              end: String(row.end ?? ''),
              description: String(row.description ?? ''),
            }))
          : []
        const roleDesc = String(j.current_role_description || '').trim()
        const newCollected: Collected = {
          ...collected,
          role: String(j.role || ''),
          company: String(j.company || ''),
          currentRoleStartYm: String(j.current_role_start_ym || ''),
          workHistory: wh,
          professionalBio: roleDesc || collected.professionalBio || '',
        }
        setCollected(newCollected)
        setCvFile(null)
        try {
          if (cvFileInputRef.current) cvFileInputRef.current.value = ''
        } catch {}
        const priorN = wh.length
        const startLine = newCollected.currentRoleStartYm
          ? oc(t, 'messages.cv_started', { ym: newCollected.currentRoleStartYm })
          : ''
        const roleLine = newCollected.role?.trim() || '\u2014'
        const compLine = newCollected.company?.trim() || '\u2014'
        addSteveMessage(
          oc(t, 'messages.cv_extract', {
            role: roleLine,
            company: compLine,
            startLine,
            priorCount: priorN,
            storageNote: j.cv_stored ? oc(t, 'messages.cv_stored') : oc(t, 'messages.cv_not_stored'),
          }),
          {
            options: [
              ocOpt(t, 'confirm_cv', 'confirm_cv_import'),
              ocOpt(t, 'type_instead', 'reject_cv_import'),
            ],
          },
        )
        setStage('cv_review')
        saveState('cv_review', newCollected)
      } else {
        const err = (j?.error as string) || oc(t, 'errors.cv_read')
        addSteveMessage(err, {
          cvUpload: true,
          options: [
            ocOpt(t, 'try_another_file', 'cv_retry_pick'),
            ocOpt(t, 'type_manually', 'cv_skip_to_manual'),
            ocOpt(t, 'go_back', 'go_back'),
          ],
        })
      }
    } catch {
      setIsTyping(false)
      addSteveMessage(oc(t, 'errors.cv_network'), {
        cvUpload: true,
        options: [
          ocOpt(t, 'try_again', 'cv_retry_pick'),
          ocOpt(t, 'type_manually_short', 'cv_skip_to_manual'),
        ],
      })
    } finally {
      setCvUploading(false)
    }
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, isTyping, scrollToBottom])

  return {
    // flow state
    progress,
    stage,
    messages,
    inputValue,
    setInputValue,
    isTyping,
    enriching,
    composingBio,
    bioDraftingKind,
    enrichmentCards,
    allCardsReviewed,
    booting,
    // uploads
    picFile,
    picPreview,
    uploadingPic,
    cvFile,
    cvUploading,
    cvFileInputRef,
    // tour + defer
    tourStep,
    setTourStep,
    showDeferConfirm,
    setShowDeferConfirm,
    deferringProfile,
    deferError,
    setDeferError,
    // scroll anchor
    messagesEndRef,
    scrollToBottom,
    // handlers
    handleOptionClick,
    handleSubmit,
    handleCardAction,
    handleFinishReview,
    finishLater,
    handleFileSelect,
    handlePhotoUpload,
    handleCvFileSelect,
    handleCvParseUpload,
    completeOnboarding,
  }
}
