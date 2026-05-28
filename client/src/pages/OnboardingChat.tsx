import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import { FixedComposerShell } from '../components/FixedComposerShell'
import BrandLogo from '../components/BrandLogo'
import { useTranslation } from 'react-i18next'
import { useFixedComposerKeyboard } from '../hooks/useFixedComposerKeyboard'
import {
  b2bNetworkSizeLabel,
  b2bNetworkSizeOptions,
  b2bTierGuidanceText,
  getPersonalSectionSteps,
  getProfessionalSectionSteps,
  getTourSteps,
  isEnterpriseSize,
  oc,
  ocOpt,
  onboardingGreeting,
  pbFieldLabel,
  profileSummaryBlock,
  reactionMessage,
  validateLinkedInProfileUrl,
} from '../i18n/onboardingChatHelpers'

type Stage =
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

type PbFieldKey = 'city' | 'country' | 'role' | 'company'
type ProfileSection = 'personal' | 'professional'

type WorkHistoryRow = {
  title: string
  company: string
  location: string
  start: string
  end: string
  description: string
}

interface ChatMessage {
  from: 'steve' | 'user'
  text: string
  options?: { label: string; value: string; icon?: string }[]
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

interface EnrichmentCard {
  id: string
  section: string
  label: string
  detail: string
  field: string
  status?: 'pending' | 'accepted' | 'dismissed'
}

type B2BTierCode = 'free' | 'paid_l1' | 'paid_l2' | 'paid_l3' | 'enterprise'

interface CommunityTierHint {
  label: string
  min_members?: number | null
  max_members?: number | null
  price_eur_monthly?: number | string | null
  pricing?: string | null
}

interface OnboardingTierHints {
  communities_max?: number | null
  members_per_owned_community?: number | null
  free_community_media_gb?: number | string | null
  can_use_steve?: boolean
  community_tiers?: Partial<Record<B2BTierCode, CommunityTierHint>>
}

interface Collected {
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
  /** B2B onboarding — persisted in Firestore for resume */
  b2bNetworkSize?: string
  b2bOrgTypeHint?: string
  b2bParentName?: string
}

interface OnboardingChatProps {
  firstName: string
  lastName: string
  username: string
  displayName: string
  communityName?: string | null
  hasCommunity: boolean
  existingProfilePic: string
  mode?: 'fresh' | 'profile_builder'
  onComplete: () => void
  onCreateCommunity: () => void
  onGoToCommunity: () => void
  onExit: () => void
}

const USER_FACING_STEPS = 8
const SALES_EMAIL = 'sales@c-point.co'

function stageProgress(stage: Stage): number {
  const stepMap: Record<Stage, number> = {
    intent_fork: 0,
    b2b_value: 0,
    b2b_network_size: 0,
    b2b_tier_guidance: 0,
    b2b_org_type: 0,
    b2b_parent_name: 0,
    b2b_sub_names: 0,
    welcome: 0,
    profile_builder_summary: 0,
    pb_confirm_field: 0,
    pb_edit_field: 0,
    name: 1,
    location: 2,
    location_confirm: 2,
    location_city: 2,
    photo: 3,
    section_picker: 3,
    personal_section_intro: 3,
    talk_all_day: 4,
    reach_out: 4,
    journey: 5,
    recommend: 5,
    optional_social: 5,
    personal_bio_review: 6,
    professional_section_intro: 6,
    cv_upload: 6,
    cv_review: 6,
    professional: 6,
    professional_confirm: 6,
    fix_role: 6,
    fix_company: 6,
    professional_associations: 7,
    professional_strengths: 7,
    linkedin: 7,
    professional_bio_review: 8,
    profile_review: 8,
    manual_bio_edit: 8,
    gibberish_check: 0,
    enriching: 8,
    review: 8,
    complete: 8,
  }
  const step = stepMap[stage] ?? 0
  return Math.round((step / USER_FACING_STEPS) * 100)
}

function firstUnansweredStageForSection(section: ProfileSection, c: Collected): Stage {
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

function sectionHasStarted(section: ProfileSection, c: Collected): boolean {
  if (section === 'personal') {
    return !!(c.talkAllDay?.trim() || c.reachOut?.trim() || c.journey?.trim() || c.recommend?.trim() || c.bio?.trim())
  }
  return !!(c.role?.trim() || c.professionalAssociations?.trim() || c.professionalStrengths?.trim() || c.linkedinDone || c.professionalBio?.trim())
}

function startOrResumeSection(section: ProfileSection, c: Collected): Stage {
  if (section === 'personal') {
    if (c.personalSectionComplete) return c.professionalSectionComplete ? 'profile_review' : 'section_picker'
    return sectionHasStarted('personal', c) ? firstUnansweredStageForSection('personal', c) : 'personal_section_intro'
  }
  if (c.professionalSectionComplete) return c.personalSectionComplete ? 'profile_review' : 'section_picker'
  return sectionHasStarted('professional', c) ? firstUnansweredStageForSection('professional', c) : 'professional_section_intro'
}

function nextIncompleteProfileStage(c: Collected): Stage {
  if (!c.personalSectionComplete && !c.professionalSectionComplete) return 'section_picker'
  if (c.personalSectionComplete && !c.professionalSectionComplete) return startOrResumeSection('professional', c)
  if (c.professionalSectionComplete && !c.personalSectionComplete) return startOrResumeSection('personal', c)
  return 'profile_review'
}

function nextSectionAfterCompletion(c: Collected): Stage {
  return nextIncompleteProfileStage(c)
}

function normalizeResumeStage(savedStage: Stage, c: Collected): Stage {
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
  return savedStage || 'section_picker'
}

const STAGES_REQUIRING_VALIDATION: Stage[] = [
  'talk_all_day', 'reach_out', 'professional', 'professional_associations', 'professional_strengths', 'linkedin', 'recommend', 'journey', 'pb_edit_field',
]

const PB_FIELD_ORDER: PbFieldKey[] = ['city', 'country', 'role', 'company']

function buildProfileBuilderConfirmQueue(c: Collected): PbFieldKey[] {
  return PB_FIELD_ORDER.filter(k => {
    const v = c[k]
    return typeof v === 'string' && v.trim().length > 0
  })
}

/** Map free-text org description to API parent_type (bootstrap normalizes free tier). */
function mapOrgHintToParentType(hint: string): string {
  const h = hint.toLowerCase()
  if (/\b(gym|fitness|studio|crossfit|yoga|pilates)\b/.test(h)) return 'gym'
  if (/\b(university|college|alumni|school|campus|faculty|student)\b/.test(h)) return 'university'
  return 'general'
}

/** Parse optional personal social URLs for Firestore onboardingIdentity.socialProvidedLinks. */
function parseSocialUrlsFromInput(raw: string): { platform: string; url: string }[] {
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

function looksLikeMeaninglessInput(val: string): boolean {
  const trimmed = val.trim()
  if (trimmed.length < 3) return true
  if (/^(.)\1{2,}$/i.test(trimmed)) return true
  const words = trimmed.split(/\s+/)
  const hasVowelWord = words.some(w => /[aeiouAEIOU]/.test(w) && w.length > 1)
  if (!hasVowelWord && trimmed.length < 8) return true
  if (/^[^a-zA-Z0-9\s]*$/.test(trimmed)) return true
  const consonantRun = trimmed.replace(/[^a-zA-Z]/g, '')
  if (consonantRun.length >= 4 && !/[aeiouAEIOU]/.test(consonantRun)) return true
  return false
}

export default function OnboardingChat({
  firstName: initFirst,
  lastName: initLast,
  username,
  communityName,
  hasCommunity,
  existingProfilePic,
  onComplete,
  onCreateCommunity,
  onGoToCommunity: _onGoToCommunity,
  onExit,
  mode = 'fresh',
}: OnboardingChatProps) {
  const { t } = useTranslation()
  const tourSteps = useMemo(() => getTourSteps(t), [t])
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

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cvFileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const onboardingIntentRef = useRef<'b2b' | 'b2c' | null>(null)
  const b2bOrgRef = useRef('')
  const b2bParentRef = useRef('')
  const tierHintsRef = useRef<OnboardingTierHints | null>(null)
  const composerRef = useRef<HTMLDivElement | null>(null)
  const composerCardRef = useRef<HTMLDivElement | null>(null)
  const defaultComposerPadding = 72
  const [composerHeight, setComposerHeight] = useState(defaultComposerPadding)

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'instant' }), 100)
  }, [])

  const { keyboardLift, safeBottomPx } = useFixedComposerKeyboard({ onLayoutNudge: scrollToBottom })

  const addSteveMessage = useCallback((text: string, opts?: Partial<ChatMessage>) => {
    setIsTyping(true)
    setTimeout(() => {
      setIsTyping(false)
      setMessages(prev => [...prev, { from: 'steve', text, ...opts }])
      scrollToBottom()
    }, 600 + Math.random() * 400)
  }, [scrollToBottom])

  const addUserMessage = useCallback((text: string) => {
    setMessages(prev => [...prev, { from: 'user', text }])
    scrollToBottom()
  }, [scrollToBottom])

  const saveField = useCallback(async (field: string, value: string) => {
    try {
      await fetch('/api/onboarding/save_field', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value }),
      })
    } catch {}
  }, [])

  const saveState = useCallback(async (s: Stage, c: Collected) => {
    try {
      const body: Record<string, unknown> = {
        stage: s,
        collected: c,
        onboarding_auto_open_suppressed: false,
      }
      if (onboardingIntentRef.current) body.onboarding_intent = onboardingIntentRef.current
      await fetch('/api/onboarding/state', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {}
  }, [])

  // ── Initialize: load saved state or start fresh ──
  useEffect(() => {
    if (initialized) return
    setInitialized(true)
    ;(async () => {
      try {
        const tr = await fetch('/api/onboarding/tier_hints', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const tj = await tr.json().catch(() => null)
        if (tj?.success && tj.hints) {
          tierHintsRef.current = tj.hints as OnboardingTierHints
          setTierHints(tj.hints as OnboardingTierHints)
        }
      } catch {}
      if (mode === 'profile_builder') {
        profileBuilderPostPbRef.current = { skipLocation: false, skipProfessional: false }
        try {
          const pr = await fetch('/api/profile_me', { credentials: 'include', headers: { Accept: 'application/json' } })
          const pj = await pr.json().catch(() => null)
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
              personalSectionComplete: false,
              professionalSectionComplete: false,
              activeProfileSection: undefined,
              profileSectionOrder: [],
            }
            originalPublicBioRef.current = next.bio
            originalProfessionalBioRef.current = next.professionalBio
            setCollected(next)
            startStage('welcome', next)
            setBooting(false)
            return
          }
        } catch {}
        originalPublicBioRef.current = ''
        originalProfessionalBioRef.current = ''
        startStage('welcome', collected)
        setBooting(false)
        return
      }
      try {
        const r = await fetch('/api/onboarding/state', { credentials: 'include' })
        const j = await r.json().catch(() => null)
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
          const resumeStage = normalizeResumeStage(saved.stage as Stage, savedCollected)
          setStage(resumeStage)
          if (!saved.resume_welcome_shown) {
            setMessages([{ from: 'steve', text: oc(t, 'messages.resume_welcome') }])
            try {
              await fetch('/api/onboarding/state', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  stage: resumeStage,
                  collected: savedCollected,
                  resume_welcome_shown: true,
                  onboarding_auto_open_suppressed: false,
                  onboarding_intent: onboardingIntentRef.current || undefined,
                }),
              })
            } catch {}
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
      case 'b2b_value': {
        addSteveMessage(oc(t, 'messages.b2b_value'), {
          options: [ocOpt(t, 'continue', 'b2b_value_continue')],
        })
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
      case 'b2b_org_type': {
        addSteveMessage(oc(t, 'copy.org_type_prompt'), {
          inputType: 'text',
          inputPlaceholder: oc(t, 'placeholders.org_type'),
        })
        break
      }
      case 'b2b_parent_name': {
        addSteveMessage(oc(t, 'messages.b2b_parent_name'), {
          inputType: 'text',
          inputPlaceholder: oc(t, 'placeholders.network_name'),
        })
        break
      }
      case 'b2b_sub_names': {
        addSteveMessage(oc(t, 'messages.b2b_sub_names'), {
          inputType: 'text',
          inputPlaceholder: oc(t, 'placeholders.sub_communities'),
          options: [ocOpt(t, 'skip_sub_communities', 'b2b_skip_subs')],
        })
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
            ? [ocOpt(t, 'lets_go', 'start', '🚀')]
            : [ocOpt(t, 'lets_go', 'start'), ocOpt(t, 'finish_later', 'open_defer_modal')]
        addSteveMessage(welcomeText, { options: welcomeOpts })
        break
      }
      case 'profile_builder_summary': {
        const summary = profileSummaryBlock(t, data)
        addSteveMessage(oc(t, 'messages.pb_summary', { summary }), {
          options: [ocOpt(t, 'pb_continue', 'pb_summary_continue', '➡️')],
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
            ocOpt(t, 'yes', 'pb_confirm_yes', '✅'),
            ocOpt(t, 'update', 'pb_confirm_update', '✏️'),
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
                ocOpt(t, 'thats_correct', 'confirm_name', '✅'),
                ocOpt(t, 'let_me_fix', 'edit_name', '✏️'),
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
      case 'location':
        addSteveMessage(oc(t, 'messages.location_ask'), {
          inputType: 'text',
          inputPlaceholder: oc(t, 'placeholders.location'),
        })
        break
      case 'location_confirm': {
        const city = data?.city || collected.city || ''
        const country = data?.country || collected.country || ''
        if (city && country) {
          addSteveMessage(oc(t, 'messages.location_confirm', { city, country }), {
            options: [
              {
                label: oc(t, 'options.yes_location', { city, country }),
                value: 'confirm_location',
                icon: '✅',
              },
              ocOpt(t, 'no_correct_location', 'edit_location', '✏️'),
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
          options: [ocOpt(t, 'skip_city', 'skip_city', '⏭️')],
        })
        break
      }
      case 'photo':
        addSteveMessage(oc(t, 'messages.photo_ask'), {
          photoUpload: true,
          options: [ocOpt(t, 'skip_photo', 'skip_photo')],
        })
        break
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
      case 'talk_all_day':
        addSteveMessage(oc(t, 'messages.talk_all_day'), {
          inputType: 'text',
          inputPlaceholder: oc(t, 'placeholders.type_answer'),
          options: stageHistory.current.length > 1 ? [ocOpt(t, 'go_back', 'go_back', '↩️')] : undefined,
        })
        break
      case 'reach_out':
        addSteveMessage(oc(t, 'messages.reach_out'), {
          inputType: 'text',
          inputPlaceholder: oc(t, 'placeholders.type_answer'),
          options: stageHistory.current.length > 1 ? [ocOpt(t, 'go_back', 'go_back', '↩️')] : undefined,
        })
        break
      case 'professional':
        addSteveMessage(oc(t, 'messages.professional_ask'), {
          inputType: 'text',
          inputPlaceholder: oc(t, 'placeholders.professional'),
          options: stageHistory.current.length > 1 ? [ocOpt(t, 'go_back', 'go_back', '↩️')] : undefined,
        })
        break
      case 'professional_confirm': {
        const role = data?.role || collected.role || ''
        const company = data?.company || collected.company || ''
        if (role && company) {
          addSteveMessage(oc(t, 'messages.professional_confirm_both', { role, company }), {
            options: [
              ocOpt(t, 'yes_professional_correct', 'confirm_professional', '✅'),
              ocOpt(t, 'fix_role', 'edit_role_only', '✏️'),
              ocOpt(t, 'fix_company', 'edit_company_only', '✏️'),
              ocOpt(t, 'fix_both', 'edit_professional', '✏️'),
            ],
          })
        } else if (role) {
          addSteveMessage(oc(t, 'messages.professional_confirm_role', { role }), {
            options: [
              ocOpt(t, 'yes_professional_correct', 'confirm_professional', '✅'),
              ocOpt(t, 'add_company', 'edit_company_only', '✏️'),
              ocOpt(t, 'fix_role', 'edit_role_only', '✏️'),
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
            ocOpt(t, 'import_cv', 'start_cv_upload', '📄'),
            ocOpt(t, 'start_professional_section', 'start_professional_section'),
            ocOpt(t, 'finish_later', 'open_defer_modal'),
          ],
        })
        break
      case 'cv_upload':
        addSteveMessage(oc(t, 'messages.cv_upload'), {
          cvUpload: true,
          options: [
            ocOpt(t, 'type_manually', 'cv_skip_to_manual', '✏️'),
            ocOpt(t, 'go_back', 'go_back', '↩️'),
          ],
        })
        break
      case 'cv_review':
        break
      case 'professional_associations':
        addSteveMessage(oc(t, 'messages.professional_associations'), {
          inputType: 'text',
          inputPlaceholder: oc(t, 'placeholders.associations'),
          options: stageHistory.current.length > 1 ? [ocOpt(t, 'go_back', 'go_back', '↩️')] : undefined,
        })
        break
      case 'professional_strengths':
        addSteveMessage(oc(t, 'messages.professional_strengths'), {
          inputType: 'text',
          inputPlaceholder: oc(t, 'placeholders.strengths'),
          options: stageHistory.current.length > 1 ? [ocOpt(t, 'go_back', 'go_back', '↩️')] : undefined,
        })
        break
      case 'linkedin': {
        const lnOpts: ChatMessage['options'] = [ocOpt(t, 'skip', 'skip_linkedin', '⏭️')]
        if (stageHistory.current.length > 1) lnOpts.push(ocOpt(t, 'go_back', 'go_back', '↩️'))
        addSteveMessage(oc(t, 'messages.linkedin_ask'), {
          inputType: 'url',
          inputPlaceholder: oc(t, 'placeholders.linkedin'),
          options: lnOpts,
        })
        break
      }
      case 'recommend': {
        const recOpts: ChatMessage['options'] = [ocOpt(t, 'skip', 'skip_recommend', '⏭️')]
        if (stageHistory.current.length > 1) recOpts.push(ocOpt(t, 'go_back', 'go_back', '↩️'))
        addSteveMessage(oc(t, 'messages.recommend'), {
          inputType: 'text',
          inputPlaceholder: oc(t, 'placeholders.recommend'),
          options: recOpts,
        })
        break
      }
      case 'optional_social': {
        const soOpts: ChatMessage['options'] = [ocOpt(t, 'skip', 'skip_optional_social', '⏭️')]
        if (stageHistory.current.length > 1) soOpts.push(ocOpt(t, 'go_back', 'go_back', '↩️'))
        addSteveMessage(oc(t, 'messages.optional_social'), {
          inputType: 'textarea',
          inputPlaceholder: oc(t, 'placeholders.social_urls'),
          options: soOpts,
        })
        break
      }
      case 'journey':
        addSteveMessage(oc(t, 'messages.journey'), {
          inputType: 'textarea',
          inputPlaceholder: oc(t, 'placeholders.journey'),
          options: (() => {
            const opts: ChatMessage['options'] = [ocOpt(t, 'skip', 'skip_journey', '⏭️')]
            if (stageHistory.current.length > 1) opts.push(ocOpt(t, 'go_back', 'go_back', '↩️'))
            return opts
          })(),
        })
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
      const r = await fetch('/api/onboarding/bootstrap_communities', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_name: parentName,
          parent_type: parentType,
          child_names: childNames,
        }),
      })
      const j = await r.json().catch(() => null)
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
    addSteveMessage(oc(t, 'messages.complete'), {
      options: [
        ocOpt(t, 'add_edit_profile', 'edit_profile'),
        ocOpt(t, 'show_me_around', 'start_tour'),
        ocOpt(t, 'go_dashboard', 'go_feed'),
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
      const r = await fetch('/api/onboarding/compose_bio', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
              ? (mode === 'profile_builder'
                  ? (originalProfessionalBioRef.current || '').trim()
                  : (c.professionalBio || '').trim())
              : (mode === 'profile_builder'
                  ? (originalPublicBioRef.current || '').trim()
                  : (c.bio || '').trim()),
          reuse_company_intel: reuseIntel,
        }),
      })
      const j = await r.json().catch(() => null)
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
    try {
      await fetch('/api/onboarding/state', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: 'complete',
          collected,
          acceptedEnrichment: accepted.map(c => c.id),
        }),
      })
    } catch {}
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
      const r = await fetch('/api/onboarding/defer_profile', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          stage,
          collected,
          messages: serializable,
          onboarding_auto_open_suppressed: true,
        }),
      })
      const j = await r.json().catch(() => null)
      if (r.ok && j?.success) {
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

  async function handleOptionClick(value: string) {
    switch (value) {
      case 'intent_b2c': {
        addUserMessage(oc(t, 'user_echo.intent_b2c'))
        onboardingIntentRef.current = 'b2c'
        advanceTo('name', collected)
        break
      }
      case 'intent_b2b': {
        addUserMessage(oc(t, 'user_echo.intent_b2b'))
        onboardingIntentRef.current = 'b2b'
        advanceTo('b2b_network_size', collected)
        break
      }
      case 'b2b_value_continue': {
        addUserMessage(oc(t, 'user_echo.continue'))
        advanceTo('b2b_network_size', collected)
        break
      }
      case 'b2b_skip_subs': {
        addUserMessage(oc(t, 'user_echo.skip_subs'))
        await runB2bBootstrap([], collected)
        break
      }
      case 'open_defer_modal':
      case 'defer_profile_72': {
        setShowDeferConfirm(true)
        break
      }
      case 'b2b_size_free':
      case 'b2b_size_paid_l1':
      case 'b2b_size_paid_l2':
      case 'b2b_size_paid_l3':
      case 'b2b_size_enterprise': {
        addUserMessage(b2bNetworkSizeLabel(t, value, tierHintsRef.current || tierHints))
        const newCollected = { ...collected, b2bNetworkSize: value }
        setCollected(newCollected)
        advanceTo('b2b_tier_guidance', newCollected)
        break
      }
      case 'b2b_tier_continue': {
        addUserMessage(oc(t, 'user_echo.continue_network'))
        advanceTo('b2b_parent_name', collected)
        break
      }
      case 'contact_sales_enterprise': {
        addUserMessage(oc(t, 'user_echo.contact_sales'))
        window.location.href = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(oc(t, 'sales.email_subject'))}`
        addSteveMessage(oc(t, 'messages.sales_email_opened'), {
          options: [ocOpt(t, 'continue_creating_network', 'b2b_tier_continue')],
        })
        break
      }
      case 'start':
        addUserMessage(oc(t, 'user_echo.lets_go'))
        if (mode === 'profile_builder') {
          advanceTo('profile_builder_summary')
        } else {
          advanceTo('name')
        }
        break
      case 'pb_summary_continue': {
        addUserMessage(oc(t, 'user_echo.continue'))
        const q = buildProfileBuilderConfirmQueue(collected)
        pbConfirmQueueRef.current = q
        if (q.length === 0) {
          finishProfileBuilderQueueAndGoName(collected)
        } else {
          advanceTo('pb_confirm_field')
        }
        break
      }
      case 'pb_confirm_yes': {
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
        break
      }
      case 'pb_confirm_update': {
        addUserMessage(oc(t, 'user_echo.update'))
        const head = pbConfirmQueueRef.current[0]
        if (!head) {
          finishProfileBuilderQueueAndGoName(collected)
          break
        }
        pbEditFieldRef.current = head
        setStage('pb_edit_field')
        saveState('pb_edit_field', collected)
        startStage('pb_edit_field', collected)
        break
      }
      case 'confirm_name': {
        addUserMessage(oc(t, 'user_echo.thats_correct'))
        const displayName = `${collected.firstName} ${collected.lastName}`.trim()
        if (displayName) saveField('display_name', displayName)
        if (mode === 'profile_builder' && profileBuilderPostPbRef.current.skipLocation) {
          advanceTo('photo')
        } else {
          advanceTo('location')
        }
        break
      }
      case 'edit_name':
        addUserMessage(oc(t, 'user_echo.let_me_fix'))
        addSteveMessage(oc(t, 'messages.edit_name'), {
          inputType: 'text',
          inputPlaceholder: oc(t, 'placeholders.first_last'),
        })
        break
      case 'confirm_location': {
        addUserMessage(oc(t, 'user_echo.yes_location', { city: collected.city, country: collected.country }))
        await saveField('city', collected.city)
        await saveField('country', collected.country)
        advanceTo('photo')
        break
      }
      case 'edit_location':
        addUserMessage(oc(t, 'user_echo.let_me_correct'))
        addSteveMessage(oc(t, 'messages.edit_location'), {
          inputType: 'text',
          inputPlaceholder: oc(t, 'placeholders.location'),
        })
        setStage('location')
        break
      case 'confirm_professional': {
        const profLabel = collected.company
          ? `${collected.role} at ${collected.company}`
          : collected.role
        addUserMessage(oc(t, 'user_echo.yes_professional', { label: profLabel }))
        await saveField('role', collected.role)
        if (collected.company) await saveField('company', collected.company)
        advanceTo('professional_associations')
        break
      }
      case 'edit_professional':
        addUserMessage(oc(t, 'user_echo.let_me_fix_both'))
        addSteveMessage(oc(t, 'messages.edit_professional'), {
          inputType: 'text',
          inputPlaceholder: oc(t, 'placeholders.professional'),
        })
        setStage('professional')
        break
      case 'edit_role_only':
        addUserMessage(oc(t, 'user_echo.fix_role'))
        addSteveMessage(oc(t, 'messages.edit_role'), {
          inputType: 'text',
          inputPlaceholder: oc(t, 'placeholders.role_title'),
        })
        setStage('fix_role')
        break
      case 'edit_company_only':
        addUserMessage(collected.company ? oc(t, 'user_echo.fix_company') : oc(t, 'user_echo.add_company'))
        addSteveMessage(oc(t, 'messages.edit_company'), {
          inputType: 'text',
          inputPlaceholder: oc(t, 'placeholders.company'),
        })
        setStage('fix_company')
        break
      case 'skip_city': {
        addUserMessage(oc(t, 'user_echo.skip_country'))
        await saveField('country', collected.country)
        advanceTo('photo')
        break
      }
      case 'go_back': {
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
        break
      }
      case 'gibberish_skip': {
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
        break
      }
      case 'gibberish_retry': {
        addUserMessage(oc(t, 'user_echo.let_me_try'))
        const retryStage = gibberishReturnStage.current
        gibberishReturnStage.current = null
        if (retryStage) {
          startStage(retryStage)
          setStage(retryStage)
        }
        break
      }
      case 'skip_photo':
        addUserMessage(oc(t, 'user_echo.skip_photo'))
        addSteveMessage(oc(t, 'messages.skip_photo'))
        setTimeout(() => advanceTo('section_picker'), 600)
        break
      case 'choose_personal_section': {
        addUserMessage(oc(t, 'user_echo.personal_section'))
        const order = collected.profileSectionOrder?.includes('personal')
          ? collected.profileSectionOrder
          : [...(collected.profileSectionOrder || []), 'personal' as ProfileSection]
        const newCollected = { ...collected, activeProfileSection: 'personal' as ProfileSection, profileSectionOrder: order }
        setCollected(newCollected)
        advanceTo(startOrResumeSection('personal', newCollected), newCollected)
        break
      }
      case 'choose_professional_section': {
        addUserMessage(oc(t, 'user_echo.professional_section'))
        const order = collected.profileSectionOrder?.includes('professional')
          ? collected.profileSectionOrder
          : [...(collected.profileSectionOrder || []), 'professional' as ProfileSection]
        const newCollected = { ...collected, activeProfileSection: 'professional' as ProfileSection, profileSectionOrder: order }
        setCollected(newCollected)
        advanceTo(startOrResumeSection('professional', newCollected), newCollected)
        break
      }
      case 'finish_sections_review':
        addUserMessage(oc(t, 'user_echo.review_profile'))
        advanceTo('profile_review')
        break
      case 'start_cv_upload':
        addUserMessage(oc(t, 'user_echo.import_cv'))
        advanceTo('cv_upload', collected)
        break
      case 'cv_skip_to_manual':
        addUserMessage(oc(t, 'user_echo.type_manually'))
        advanceTo('professional', { ...collected, workHistory: undefined, currentRoleStartYm: '' })
        break
      case 'confirm_cv_import': {
        addUserMessage(oc(t, 'user_echo.cv_confirm'))
        ;(async () => {
          const c = collected
          try {
            const r = await fetch('/api/onboarding/apply_professional_structured', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                role: c.role || '',
                company: c.company || '',
                current_role_start_ym: c.currentRoleStartYm || '',
                work_history: c.workHistory || [],
                professional_about: (c.professionalBio || '').trim(),
              }),
            })
            const j = await r.json().catch(() => null)
            if (r.ok && j?.success) {
              if (c.role?.trim()) await saveField('role', c.role)
              if (c.company?.trim()) await saveField('company', c.company)
              advanceTo('professional_confirm', c)
            } else {
              addSteveMessage((j?.error as string) || oc(t, 'errors.cv_save'), {
                options: [
                  ocOpt(t, 'try_again', 'confirm_cv_import', '↻'),
                  ocOpt(t, 'type_manually_short', 'reject_cv_import', '✏️'),
                ],
              })
            }
          } catch {
            addSteveMessage(oc(t, 'errors.cv_save_network'), {
              options: [
                ocOpt(t, 'try_again', 'confirm_cv_import', '↻'),
                ocOpt(t, 'type_manually_short', 'reject_cv_import', '✏️'),
              ],
            })
          }
        })()
        break
      }
      case 'reject_cv_import': {
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
        break
      }
      case 'cv_retry_pick': {
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
            ocOpt(t, 'type_manually', 'cv_skip_to_manual', '✏️'),
            ocOpt(t, 'go_back', 'go_back', '↩️'),
          ],
        })
        break
      }
      case 'start_personal_section':
        addUserMessage(oc(t, 'user_echo.start_personal'))
        advanceTo('talk_all_day')
        break
      case 'start_professional_section':
        addUserMessage(oc(t, 'user_echo.start_professional'))
        advanceTo('professional')
        break
      case 'skip_optional_social':
        addUserMessage(oc(t, 'user_echo.skip'))
        advanceTo('personal_bio_review')
        break
      case 'skip_linkedin':
        addUserMessage(oc(t, 'user_echo.skip'))
        {
          const newCollected = { ...collected, linkedin: '', linkedinDone: true }
          setCollected(newCollected)
          advanceTo('professional_bio_review', newCollected)
        }
        break
      case 'skip_journey':
        addUserMessage(oc(t, 'user_echo.skip'))
        advanceTo('recommend')
        break
      case 'skip_recommend':
        addUserMessage(oc(t, 'user_echo.skip'))
        advanceTo('optional_social')
        break
      case 'use_bio': {
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
          setTimeout(
            () => advanceTo(nextSectionAfterCompletion(newCollected), newCollected),
            800,
          )
        }
        break
      }
      case 'bio_more_natural':
      case 'bio_shorter':
      case 'bio_more_professional': {
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
        break
      }
      case 'edit_bio': {
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
        break
      }
      case 'redo_bio':
        lastComposedCompanyIntelRef.current = ''
        setCollected(prev => ({ ...prev, companyIntel: '' }))
        addUserMessage(oc(t, 'user_echo.start_fresh'))
        addSteveMessage(oc(t, 'messages.redo_bio'), {
          inputType: 'textarea',
          inputPlaceholder: oc(t, 'placeholders.write_bio'),
        })
        setStage('manual_bio_edit')
        saveState('manual_bio_edit', collected)
        break
      case 'finish_profile_review':
        addUserMessage(oc(t, 'user_echo.looks_good'))
        addSteveMessage(oc(t, 'messages.profile_sections_set'))
        setTimeout(() => advanceToComplete(), 800)
        break
      case 'start_tour':
        addUserMessage(oc(t, 'user_echo.show_around'))
        await completeOnboarding()
        setTourStep(0)
        break
      case 'go_feed':
        await completeOnboarding()
        onComplete()
        break
      case 'edit_profile':
        addUserMessage(oc(t, 'user_echo.add_edit_profile'))
        await completeOnboarding()
        window.location.href = '/profile'
        break
      case 'create_community':
        await completeOnboarding()
        onCreateCommunity()
        break
    }
  }

  async function completeOnboarding() {
    try {
      await fetch('/api/onboarding/complete', { method: 'POST', credentials: 'include' })
    } catch {}
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
          ocOpt(t, 'yes_skip', 'gibberish_skip', '⏭️'),
          ocOpt(t, 'no_try_again', 'gibberish_retry', '✏️'),
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
            const r = await fetch('/api/onboarding/resolve_location', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ city: val }),
            })
            const j = await r.json().catch(() => null)
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
          const r = await fetch('/api/onboarding/resolve_role', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: val }),
          })
          const j = await r.json().catch(() => null)
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
            options: [ocOpt(t, 'skip', 'skip_linkedin', '⏭️')],
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
          try {
            await fetch('/api/onboarding/social_links', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ socialProvidedLinks: links }),
            })
          } catch {}
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
        setTimeout(
          () => advanceTo(nextSectionAfterCompletion(newCollected), newCollected),
          800,
        )
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

  function detectOffScript(currentStage: Stage, input: string): boolean {
    if (currentStage === 'b2b_network_size' || currentStage === 'b2b_tier_guidance' || currentStage === 'b2b_org_type' || currentStage === 'b2b_parent_name' || currentStage === 'b2b_sub_names' || currentStage === 'manual_bio_edit') {
      return false
    }
    const lower = input.toLowerCase()
    if (currentStage === 'name') {
      return lower.length > 60 || lower.includes('?') || /^(hey|hi|hello|what|how|can|tell|who)/.test(lower)
    }
    if (currentStage === 'professional') {
      return lower.length > 150 || (lower.includes('?') && !lower.includes('at'))
    }
    if (currentStage === 'location') {
      return lower.length > 80 || (/^(hey|what|how|can|tell|who)/.test(lower) && lower.includes('?'))
    }
    if (currentStage === 'linkedin') {
      if (lower.includes('linkedin.com') || lower.includes('skip')) return false
      return lower.includes('?') || /^(hey|what|how|can|tell)/.test(lower)
    }
    if (currentStage === 'optional_social') {
      if (/instagram\.|tiktok\.|snapchat\.|facebook\.|fb\.com/i.test(lower) || lower.includes('skip')) return false
      return lower.includes('?') || /^(hey|what|how|can|tell)/.test(lower)
    }
    return false
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
      const r = await fetch('/api/onboarding/redirect', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          stage,
          currentQuestion: questionMap[stage] || '',
        }),
      })
      const j = await r.json().catch(() => null)
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
      const fd = new FormData()
      fd.append('profile_picture', picFile)
      const r = await fetch('/upload_profile_picture', { method: 'POST', credentials: 'include', body: fd })
      const j = await r.json().catch(() => null)
      if (r.ok && j?.success) {
        addUserMessage(oc(t, 'user_echo.photo_uploaded'))
        addSteveMessage(oc(t, 'messages.photo_great'))
        setPicFile(null)
        setTimeout(() => advanceTo('section_picker'), 600)
      } else {
        addSteveMessage(j?.error || oc(t, 'errors.photo_upload'), {
          photoUpload: true,
          options: [ocOpt(t, 'skip_photo', 'skip_photo', '⏭️')],
        })
      }
    } catch {
      addSteveMessage(oc(t, 'errors.photo_network'), {
        photoUpload: true,
        options: [ocOpt(t, 'skip_photo', 'skip_photo', '⏭️')],
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
      const fd = new FormData()
      fd.append('file', cvFile)
      const r = await fetch('/api/onboarding/parse_cv?persist=1', { method: 'POST', credentials: 'include', body: fd })
      const j = await r.json().catch(() => null)
      setIsTyping(false)
      if (r.ok && j?.success) {
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
        const roleLine = newCollected.role?.trim() || '—'
        const compLine = newCollected.company?.trim() || '—'
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
              ocOpt(t, 'confirm_cv', 'confirm_cv_import', '✅'),
              ocOpt(t, 'type_instead', 'reject_cv_import', '✏️'),
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
            ocOpt(t, 'try_another_file', 'cv_retry_pick', '↻'),
            ocOpt(t, 'type_manually', 'cv_skip_to_manual', '✏️'),
            ocOpt(t, 'go_back', 'go_back', '↩️'),
          ],
        })
      }
    } catch {
      setIsTyping(false)
      addSteveMessage(oc(t, 'errors.cv_network'), {
        cvUpload: true,
        options: [
          ocOpt(t, 'try_again', 'cv_retry_pick', '↻'),
          ocOpt(t, 'type_manually_short', 'cv_skip_to_manual', '✏️'),
        ],
      })
    } finally {
      setCvUploading(false)
    }
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, isTyping, scrollToBottom])

  const lastSteveMsg = [...messages].reverse().find(m => m.from === 'steve')
  const showCvUpload = Boolean(lastSteveMsg?.cvUpload && stage === 'cv_upload')
  const showInput =
    Boolean(lastSteveMsg?.inputType) &&
    stage !== 'enriching' &&
    stage !== 'review' &&
    stage !== 'complete' &&
    !composingBio &&
    !showCvUpload
  const showPhotoUpload = lastSteveMsg?.photoUpload && stage === 'photo'
  const showComposer = showInput || showPhotoUpload || showCvUpload
  const bottomChromeInset = keyboardLift > 0 ? keyboardLift : safeBottomPx
  const effectiveComposerHeight = showComposer ? composerHeight : 24
  const listPaddingBottom = `${bottomChromeInset + effectiveComposerHeight + 8}px`

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return
    const node = composerCardRef.current
    if (!node) return

    const updateHeight = () => {
      const height = node.getBoundingClientRect().height
      if (!height) return
      setComposerHeight(prev => (Math.abs(prev - height) < 1 ? prev : height))
    }

    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(node)

    return () => {
      observer.disconnect()
    }
  }, [showComposer, showInput, showPhotoUpload, showCvUpload])

  if (booting) {
    return (
      <div className="fixed inset-0 z-[1200] bg-black flex items-center justify-center px-6" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex flex-col items-center gap-4 text-center">
          <BrandLogo className="w-14 h-14 rounded-2xl object-contain" />
          <div className="w-8 h-8 rounded-full border-2 border-white/15 border-t-[#4db6ac] animate-spin" />
          <div className="text-sm text-white/65">{oc(t, 'ui.booting')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[1200] bg-black flex flex-col" style={{ height: '100dvh' }}>
      {/* Header with logo */}
      <div className="shrink-0 border-b border-white/10 bg-black/95 backdrop-blur-sm">
        <div className="max-w-lg mx-auto px-4 pb-2 flex flex-col items-center" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}>
          <div className="flex items-center gap-2 mb-2">
            <BrandLogo className="w-8 h-8 rounded-lg object-contain" />
          </div>
          <div className="w-full flex items-center gap-3 pb-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#4db6ac] to-[#2a7a72] flex items-center justify-center text-[10px] font-bold text-black shrink-0">
              S
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-white">{oc(t, 'ui.steve')}</div>
            </div>
            <button
              type="button"
              onClick={() => setShowDeferConfirm(true)}
              className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-medium text-white/60 hover:text-white hover:border-white/20 transition"
            >
              {oc(t, 'ui.exit_for_now')}
            </button>
            <div className="text-[10px] text-white/30">
              {oc(t, 'ui.step_of', {
                current: Math.min(Math.ceil(stageProgress(stage) / (100 / USER_FACING_STEPS)), USER_FACING_STEPS),
                total: USER_FACING_STEPS,
              })}
            </div>
          </div>
        </div>
        {/* Progress bar */}
        <div className="h-0.5 bg-white/5">
          <div
            className="h-full bg-[#4db6ac] transition-all duration-700 ease-out"
            style={{ width: `${stageProgress(stage)}%` }}
          />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ paddingBottom: listPaddingBottom }}>
        <div className="max-w-lg mx-auto space-y-3">
          {messages.map((msg, i) => (
            <div key={i}>
              {msg.from === 'steve' ? (
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#4db6ac] to-[#2a7a72] flex items-center justify-center text-[10px] font-bold text-black shrink-0 mt-0.5">
                    S
                  </div>
                  <div className="max-w-[85%] space-y-2">
                    <div className="bg-white/[0.06] border border-white/[0.08] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-[13px] text-white/90 leading-relaxed whitespace-pre-line">
                      {msg.text}
                    </div>
                    {msg.sectionCard && (
                      <div className="rounded-2xl border border-[#4db6ac]/30 bg-[#4db6ac]/[0.06] px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#4db6ac]">
                          {msg.sectionCard.title}
                        </div>
                        <div className="mt-1 text-xs leading-relaxed text-white/70">
                          {msg.sectionCard.subtitle}
                        </div>
                        <div className="mt-3 grid gap-2">
                          {msg.sectionCard.steps.map((step, idx) => (
                            <div
                              key={step}
                              className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[12px] text-white/60"
                            >
                              {idx + 1}. {step}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {msg.sectionPicker && (
                      <div className="grid gap-2 rounded-2xl border border-[#4db6ac]/25 bg-[#4db6ac]/[0.05] px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#4db6ac]">
                          {oc(t, 'ui.choose_next_section')}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => handleOptionClick('choose_personal_section')}
                            className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-left transition hover:border-[#4db6ac]/35 hover:bg-[#4db6ac]/10"
                          >
                            <div className="text-[12px] font-semibold text-white">{oc(t, 'ui.personal_identity')}</div>
                            <div className="mt-1 text-[11px] text-white/55">
                              {oc(t, 'ui.personal_card_meta', { status: msg.sectionPicker.personalStatus })}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOptionClick('choose_professional_section')}
                            className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-left transition hover:border-[#4db6ac]/35 hover:bg-[#4db6ac]/10"
                          >
                            <div className="text-[12px] font-semibold text-white">{oc(t, 'ui.professional_identity')}</div>
                            <div className="mt-1 text-[11px] text-white/55">
                              {oc(t, 'ui.professional_card_meta', { status: msg.sectionPicker.professionalStatus })}
                            </div>
                          </button>
                        </div>
                      </div>
                    )}
                    {/* Quick reply buttons */}
                    {msg.options && i === messages.length - 1 && stage !== 'complete' && (
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        {msg.options.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => handleOptionClick(opt.value)}
                            className="rounded-xl border border-[#4db6ac]/35 bg-black/25 px-4 py-2.5 text-left text-[12px] font-semibold text-[#d5fffb] transition-colors hover:bg-[#4db6ac]/10"
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Complete stage options persist */}
                    {msg.options && stage === 'complete' && i === messages.length - 1 && (
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        {msg.options.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => handleOptionClick(opt.value)}
                            className="rounded-xl border border-[#4db6ac]/35 bg-black/25 px-4 py-2.5 text-left text-[12px] font-semibold text-[#d5fffb] transition-colors hover:bg-[#4db6ac]/10"
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Composed bio preview with action buttons */}
                    {msg.composedBio && i === messages.length - 1 && (stage === 'personal_bio_review' || stage === 'professional_bio_review') && !composingBio && (
                      <div className="space-y-2 mt-1">
                        <div className="rounded-xl border border-[#4db6ac]/20 bg-[#4db6ac]/5 px-3.5 py-3">
                          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#4db6ac]">
                            {msg.composedBioKind === 'professional'
                              ? oc(t, 'ui.professional_bio_label')
                              : oc(t, 'ui.personal_bio_label')}
                          </div>
                          <div className="text-[13px] text-white/90 leading-relaxed italic">"{msg.composedBio}"</div>
                        </div>
                        {msg.composedBioKind === 'professional' && msg.composedCompanyIntel ? (
                          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">
                              {oc(t, 'ui.company_intel')}
                            </div>
                            <div className="text-[13px] text-white/90 leading-relaxed italic">"{msg.composedCompanyIntel}"</div>
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => handleOptionClick('use_bio')} className="px-3.5 py-2 rounded-xl border border-[#4db6ac]/30 bg-[#4db6ac]/10 text-[12px] font-medium text-[#4db6ac] hover:bg-[#4db6ac]/20 transition-colors">
                            {oc(t, 'options.use_this')}
                          </button>
                          <button onClick={() => handleOptionClick('bio_more_natural')} className="px-3.5 py-2 rounded-xl border border-white/10 bg-white/5 text-[12px] font-medium text-white/60 hover:bg-white/10 transition-colors">
                            {oc(t, 'options.more_natural')}
                          </button>
                          <button onClick={() => handleOptionClick('bio_shorter')} className="px-3.5 py-2 rounded-xl border border-white/10 bg-white/5 text-[12px] font-medium text-white/60 hover:bg-white/10 transition-colors">
                            {oc(t, 'options.shorter')}
                          </button>
                          <button onClick={() => handleOptionClick('bio_more_professional')} className="px-3.5 py-2 rounded-xl border border-white/10 bg-white/5 text-[12px] font-medium text-white/60 hover:bg-white/10 transition-colors">
                            {oc(t, 'options.more_professional')}
                          </button>
                          <button onClick={() => handleOptionClick('edit_bio')} className="px-3.5 py-2 rounded-xl border border-white/10 bg-white/5 text-[12px] font-medium text-white/60 hover:bg-white/10 transition-colors">
                            {oc(t, 'options.edit')}
                          </button>
                          <button onClick={() => handleOptionClick('redo_bio')} className="px-3.5 py-2 rounded-xl border border-white/10 bg-white/5 text-[12px] font-medium text-white/60 hover:bg-white/10 transition-colors">
                            {oc(t, 'options.start_fresh')}
                          </button>
                        </div>
                      </div>
                    )}
                    {msg.profileReview && i === messages.length - 1 && (
                      <div className="space-y-2 mt-1">
                        <div className="rounded-xl border border-[#4db6ac]/20 bg-[#4db6ac]/5 px-3.5 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#4db6ac]">
                            {oc(t, 'ui.personal_bio_label')}
                          </div>
                          <div className="mt-2 text-[13px] leading-relaxed text-white/90">
                            {msg.profileReview.personalBio || oc(t, 'ui.not_added_yet')}
                          </div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">
                            {oc(t, 'ui.professional_bio_label')}
                          </div>
                          <div className="mt-2 text-[13px] leading-relaxed text-white/90">
                            {msg.profileReview.professionalBio || oc(t, 'ui.not_added_yet')}
                          </div>
                          <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[12px] text-white/65">
                            {oc(t, 'ui.linkedin_row', {
                              status: msg.profileReview.linkedinAdded ? oc(t, 'ui.added') : oc(t, 'ui.not_added'),
                            })}
                          </div>
                          <div className="mt-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[12px] text-white/65">
                            {oc(t, 'ui.company_intel_row', {
                              status: msg.profileReview.companyIntelAdded ? oc(t, 'ui.added') : oc(t, 'ui.not_added'),
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Enrichment review cards */}
                    {msg.cards && stage === 'review' && (
                      <div className="space-y-2 mt-1">
                        {enrichmentCards.map(card => (
                          <div
                            key={card.id}
                            className={`rounded-xl border px-3.5 py-3 transition-all ${
                              card.status === 'accepted'
                                ? 'border-[#4db6ac]/40 bg-[#4db6ac]/10'
                                : card.status === 'dismissed'
                                ? 'border-white/5 bg-white/[0.02] opacity-50'
                                : 'border-white/10 bg-white/[0.04]'
                            }`}
                          >
                            <div className="text-[11px] text-white/40 uppercase tracking-wider mb-1">{card.label}</div>
                            <div className="text-[13px] text-white/80 leading-relaxed">{card.detail}</div>
                            {card.status === 'pending' && (
                              <div className="flex gap-2 mt-2">
                                <button
                                  onClick={() => handleCardAction(card.id, 'accepted')}
                                  className="px-3 py-1.5 rounded-lg bg-[#4db6ac]/15 border border-[#4db6ac]/30 text-[11px] font-medium text-[#4db6ac]"
                                >
                                  ✅ {oc(t, 'options.accept')}
                                </button>
                                <button
                                  onClick={() => handleCardAction(card.id, 'dismissed')}
                                  className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] font-medium text-white/50"
                                >
                                  ❌ {oc(t, 'options.dismiss')}
                                </button>
                              </div>
                            )}
                            {card.status === 'accepted' && (
                              <div className="text-[10px] text-[#4db6ac]/70 mt-1.5">✅ {oc(t, 'ui.added_to_profile')}</div>
                            )}
                            {card.status === 'dismissed' && (
                              <div className="text-[10px] text-white/30 mt-1.5">{oc(t, 'ui.dismissed')}</div>
                            )}
                          </div>
                        ))}
                        {allCardsReviewed() && (
                          <button
                            onClick={handleFinishReview}
                            className="w-full mt-2 px-4 py-3 rounded-xl bg-[#4db6ac] text-black text-sm font-semibold hover:brightness-110 transition"
                          >
                            {oc(t, 'ui.continue_btn')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex justify-end">
                  <div className="max-w-[80%] bg-[#4db6ac]/20 border border-[#4db6ac]/20 rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-[13px] text-white/90 leading-relaxed">
                    {msg.text}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Typing indicator */}
          {(isTyping || enriching) && (
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#4db6ac] to-[#2a7a72] flex items-center justify-center text-[10px] font-bold text-black shrink-0 mt-0.5">
                S
              </div>
              <div className="bg-white/[0.06] border border-white/[0.08] rounded-2xl rounded-tl-sm px-4 py-3">
                {bioDraftingKind && (
                  <div className="mb-2 text-[12px] font-medium text-white/75">
                    {oc(t, 'ui.drafting_bio', {
                      kind:
                        bioDraftingKind === 'professional'
                          ? oc(t, 'ui.bio_kind_professional')
                          : oc(t, 'ui.bio_kind_personal'),
                    })}
                  </div>
                )}
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
              {/* enriching indicator hidden as feature is now admin-only */}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Composer — portaled for Android keyboard lift (matches ChatThread) */}
      {showComposer && (
        <FixedComposerShell
          keyboardLift={keyboardLift}
          safeBottomPx={safeBottomPx}
          shellRef={composerRef}
          className="fixed left-0 right-0 z-[1201]"
          spacerBackground="#000"
        >
          <div
            ref={composerCardRef}
            className="shrink-0 border-t border-white/10 bg-black/95 px-4 py-3"
          >
            {showPhotoUpload && (
              <div className="max-w-lg mx-auto">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <div className="flex items-center gap-3">
                  {picPreview ? (
                    <img src={picPreview} alt={oc(t, 'ui.preview_alt')} className="w-14 h-14 rounded-full object-cover border-2 border-[#4db6ac]/40" />
                  ) : (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="w-14 h-14 rounded-full border-2 border-dashed border-white/20 flex items-center justify-center cursor-pointer hover:border-[#4db6ac]/50 transition"
                    >
                      <i className="fa-solid fa-camera text-white/30" />
                    </div>
                  )}
                  <div className="flex-1">
                    {!picFile ? (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-4 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white/70 hover:bg-white/[0.1] transition w-full"
                      >
                        {oc(t, 'ui.choose_photo')}
                      </button>
                    ) : (
                      <button
                        onClick={handlePhotoUpload}
                        disabled={uploadingPic}
                        className="px-4 py-2.5 rounded-xl bg-[#4db6ac] text-black text-sm font-semibold hover:brightness-110 transition w-full disabled:opacity-50"
                      >
                        {uploadingPic ? oc(t, 'ui.uploading') : oc(t, 'ui.upload_photo')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {showCvUpload && (
              <div className="max-w-lg mx-auto">
                <input
                  ref={cvFileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={handleCvFileSelect}
                  className="hidden"
                />
                <div className="flex items-center gap-3">
                  <div
                    onClick={() => !cvUploading && cvFileInputRef.current?.click()}
                    className="w-14 h-14 rounded-xl border-2 border-dashed border-white/20 flex items-center justify-center cursor-pointer hover:border-[#4db6ac]/50 transition shrink-0"
                    role="presentation"
                  >
                    <i className="fa-solid fa-file-pdf text-white/35 text-lg" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-white/50 truncate mb-1.5">
                      {cvFile ? cvFile.name : oc(t, 'ui.no_file')}
                    </div>
                    {!cvFile ? (
                      <button
                        type="button"
                        onClick={() => cvFileInputRef.current?.click()}
                        disabled={cvUploading}
                        className="px-4 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white/70 hover:bg-white/[0.1] transition w-full disabled:opacity-50"
                      >
                        {oc(t, 'ui.choose_pdf')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleCvParseUpload}
                        disabled={cvUploading}
                        className="px-4 py-2.5 rounded-xl bg-[#4db6ac] text-black text-sm font-semibold hover:brightness-110 transition w-full disabled:opacity-50"
                      >
                        {cvUploading ? oc(t, 'ui.reading_cv') : oc(t, 'ui.upload_extract')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {showInput && (
              <div className="max-w-lg mx-auto flex gap-2">
                {lastSteveMsg?.inputType === 'textarea' ? (
                  <textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSubmit()
                      }
                    }}
                    placeholder={lastSteveMsg.inputPlaceholder || oc(t, 'placeholders.type_here')}
                    rows={3}
                    className="flex-1 px-3.5 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] text-sm text-white placeholder-white/30 focus:border-[#4db6ac]/50 focus:outline-none resize-none"
                  />
                ) : (
                  <input
                    ref={inputRef}
                    type={lastSteveMsg?.inputType === 'url' ? 'url' : 'text'}
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleSubmit()
                      }
                    }}
                    placeholder={lastSteveMsg?.inputPlaceholder || oc(t, 'placeholders.type_here')}
                    className="flex-1 px-3.5 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] text-sm text-white placeholder-white/30 focus:border-[#4db6ac]/50 focus:outline-none"
                    autoFocus
                  />
                )}
                <button
                  onClick={handleSubmit}
                  disabled={!inputValue.trim()}
                  className="px-4 py-2.5 rounded-xl bg-[#4db6ac] text-black font-semibold text-sm hover:brightness-110 transition disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                >
                  <i className="fa-solid fa-paper-plane" />
                </button>
              </div>
            )}
          </div>
        </FixedComposerShell>
      )}

      {showDeferConfirm && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="w-full max-w-sm rounded-3xl border border-[#4db6ac]/25 bg-[#0d1214] p-5 shadow-[0_24px_80px_rgba(77,182,172,0.16)]">
            <div className="text-lg font-semibold text-white">{oc(t, 'ui.need_more_time')}</div>
            <div className="mt-3 text-sm leading-relaxed text-white/70">{oc(t, 'ui.defer_body')}</div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  setDeferError('')
                  setShowDeferConfirm(false)
                }}
                className="flex-1 rounded-xl border border-[#4db6ac]/30 bg-[#4db6ac]/10 px-4 py-2.5 text-sm font-semibold text-[#d5fffb] transition hover:bg-[#4db6ac]/15"
              >
                {oc(t, 'ui.keep_going')}
              </button>
              <button
                type="button"
                onClick={finishLater}
                disabled={deferringProfile}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/75 transition hover:bg-white/10 disabled:opacity-50"
              >
                {deferringProfile ? oc(t, 'ui.saving') : oc(t, 'ui.finish_later_btn')}
              </button>
            </div>
            {deferError && (
              <div className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-100">
                {deferError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Platform tour modal */}
      {tourStep !== null && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center px-4" onClick={() => setTourStep(null)}>
          <div className="w-full max-w-sm bg-[#111] border border-white/10 rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#4db6ac]/10 border border-[#4db6ac]/20 flex items-center justify-center mb-4">
                <i className={`${tourSteps[tourStep].icon} text-2xl text-[#4db6ac]`} />
              </div>
              <div className="text-base font-semibold text-white mb-1.5">{tourSteps[tourStep].title}</div>
              <div className="text-sm text-white/60 leading-relaxed">{tourSteps[tourStep].description}</div>
            </div>
            {/* Dot indicators */}
            <div className="flex justify-center gap-1.5 pb-3">
              {tourSteps.map((_, i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${i === tourStep ? 'bg-[#4db6ac]' : 'bg-white/20'}`}
                />
              ))}
            </div>
            {/* Navigation */}
            <div className="px-6 pb-5 flex items-center justify-between">
              <button
                onClick={() => setTourStep(tourStep > 0 ? tourStep - 1 : null)}
                className="px-4 py-2 rounded-lg text-xs font-medium text-white/50 hover:text-white/80 transition-colors"
              >
                {tourStep > 0 ? oc(t, 'ui.tour_back') : oc(t, 'ui.tour_skip')}
              </button>
              <div className="text-[10px] text-white/30">
                {oc(t, 'ui.tour_counter', { current: tourStep + 1, total: tourSteps.length })}
              </div>
              <button
                onClick={async () => {
                  if (tourStep < tourSteps.length - 1) {
                    setTourStep(tourStep + 1)
                  } else {
                    setTourStep(null)
                    await completeOnboarding()
                    onComplete()
                  }
                }}
                className="px-4 py-2 rounded-lg bg-[#4db6ac] text-black text-xs font-semibold hover:brightness-110 transition"
              >
                {tourStep < tourSteps.length - 1 ? oc(t, 'ui.tour_next') : oc(t, 'ui.tour_done')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
