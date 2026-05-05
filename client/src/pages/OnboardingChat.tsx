import { useState, useEffect, useRef, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import * as OCopy from '../content/onboardingCopy'

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
  | 'professional'
  | 'professional_confirm'
  | 'fix_role'
  | 'fix_company'
  | 'professional_associations'
  | 'professional_strengths'
  | 'professional_bio_review'
  | 'profile_review'
  | 'recommend'
  | 'linkedin'
  | 'optional_social'
  | 'journey'
  | 'manual_bio_edit'
  | 'gibberish_check'
  | 'enriching'
  | 'review'
  | 'complete'

type PbFieldKey = 'city' | 'country' | 'role' | 'company'
type ProfileSection = 'personal' | 'professional'

interface ChatMessage {
  from: 'steve' | 'user'
  text: string
  options?: { label: string; value: string; icon?: string }[]
  cards?: EnrichmentCard[]
  photoUpload?: boolean
  inputType?: 'text' | 'url' | 'textarea'
  inputPlaceholder?: string
  composedBio?: string
  composedBioKind?: 'personal' | 'professional'
  sectionCard?: {
    title: string
    subtitle: string
    steps: string[]
    activeIndex?: number
    /** When set, step rows navigate within Personal or Professional onboarding. */
    sectionKind?: ProfileSection
  }
  profileReview?: {
    personalBio: string
    professionalBio: string
    linkedinAdded?: boolean
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

type B2BNetworkSizeValue =
  | 'b2b_size_free'
  | 'b2b_size_paid_l1'
  | 'b2b_size_paid_l2'
  | 'b2b_size_paid_l3'
  | 'b2b_size_enterprise'

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
  bio: string
  professionalBio: string
  professionalAssociations: string
  professionalStrengths: string
  talkAllDay: string
  recommend: string
  reachOut: string
  journey: string
  personalSectionComplete?: boolean
  professionalSectionComplete?: boolean
  activeProfileSection?: ProfileSection
  profileSectionOrder?: ProfileSection[]
  /** B2B onboarding — persisted in Firestore for resume */
  b2bNetworkSize?: string
  b2bOrgTypeHint?: string
  b2bParentName?: string
}

interface TourStep {
  icon: string
  title: string
  description: string
}

const TOUR_STEPS: TourStep[] = [
  { icon: 'fa-solid fa-house', title: 'Dashboard', description: 'Your home base — see your communities, notifications, and quick actions all in one place.' },
  { icon: 'fa-solid fa-user', title: 'My Profile', description: "Where others learn about you. Keep it fresh and it'll power better connections." },
  { icon: 'fa-solid fa-users', title: 'Followers', description: 'See who follows you and who you follow across your communities.' },
  { icon: 'fa-solid fa-network-wired', title: 'Networking', description: 'Discover people in your networks — Steve helps match you with relevant connections.' },
  { icon: 'fa-solid fa-cog', title: 'Account Settings', description: 'Manage your email, notifications, and privacy preferences.' },
]

const PERSONAL_SECTION_STEPS = [
  'Conversation hooks',
  'Reach-out signal',
  'Personal highlight',
  'Recommendation',
  'Public social links',
  'Personal bio draft',
]

const PROFESSIONAL_SECTION_STEPS = [
  'Role or current work',
  'Collaboration signals',
  'Strengths',
  'LinkedIn',
  'Professional bio draft',
]

/** Step outline index → stage (must stay in sync with PERSONAL_SECTION_STEPS). */
const PERSONAL_SECTION_INDEX_TO_STAGE: Stage[] = [
  'talk_all_day',
  'reach_out',
  'journey',
  'recommend',
  'optional_social',
  'personal_bio_review',
]

/** Step outline index → stage (must stay in sync with PROFESSIONAL_SECTION_STEPS). */
const PROFESSIONAL_SECTION_INDEX_TO_STAGE: Stage[] = [
  'professional',
  'professional_associations',
  'professional_strengths',
  'linkedin',
  'professional_bio_review',
]

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
const DEFAULT_COMMUNITY_TIER_HINTS: Record<B2BTierCode, CommunityTierHint> = {
  free: { label: 'Free Community', max_members: 25 },
  paid_l1: { label: 'Paid L1', min_members: 26, max_members: 75, price_eur_monthly: 25 },
  paid_l2: { label: 'Paid L2', min_members: 76, max_members: 150, price_eur_monthly: 50 },
  paid_l3: { label: 'Paid L3', min_members: 151, max_members: 250, price_eur_monthly: 80 },
  enterprise: { label: 'Enterprise', min_members: 251, pricing: 'custom' },
}

const B2B_SIZE_TO_TIER: Record<B2BNetworkSizeValue, B2BTierCode> = {
  b2b_size_free: 'free',
  b2b_size_paid_l1: 'paid_l1',
  b2b_size_paid_l2: 'paid_l2',
  b2b_size_paid_l3: 'paid_l3',
  b2b_size_enterprise: 'enterprise',
}

function formatCurrencyEur(value: number | string | null | undefined): string {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 'the published monthly price'
  return `€${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}/month`
}

function tierHintsFromState(hints?: OnboardingTierHints | null): Record<B2BTierCode, CommunityTierHint> {
  return { ...DEFAULT_COMMUNITY_TIER_HINTS, ...(hints?.community_tiers || {}) }
}

function b2bNetworkSizeOptions(hints?: OnboardingTierHints | null): ChatMessage['options'] {
  const tiers = tierHintsFromState(hints)
  return [
    { label: `Up to ${tiers.free.max_members} members`, value: 'b2b_size_free' },
    { label: `${tiers.paid_l1.min_members} to ${tiers.paid_l1.max_members} members`, value: 'b2b_size_paid_l1' },
    { label: `${tiers.paid_l2.min_members} to ${tiers.paid_l2.max_members} members`, value: 'b2b_size_paid_l2' },
    { label: `${tiers.paid_l3.min_members} to ${tiers.paid_l3.max_members} members`, value: 'b2b_size_paid_l3' },
    { label: `${tiers.enterprise.min_members}+ members`, value: 'b2b_size_enterprise' },
  ]
}

function b2bNetworkSizeLabel(value: string, hints?: OnboardingTierHints | null): string {
  return b2bNetworkSizeOptions(hints)?.find(option => option.value === value)?.label || 'Organisation network'
}

function b2bTierGuidanceText(value: string | undefined, hints?: OnboardingTierHints | null): string {
  const tierCode = B2B_SIZE_TO_TIER[value as B2BNetworkSizeValue] || 'free'
  const tiers = tierHintsFromState(hints)
  const freeCap = tiers.free.max_members || 25
  const tier = tiers[tierCode]
  if (tierCode === 'free') {
    return `That fits the Free Community tier: up to ${freeCap} members. I can create it now so you can start inviting people.`
  }
  if (tierCode === 'enterprise') {
    return `That sounds like an Enterprise network. Enterprise is custom pricing, so the best next step is to speak with the sales team.\n\nI can still create your network now on the Free Community tier, so it will support up to ${freeCap} members until an Enterprise plan is in place.`
  }
  return `That fits ${tier.label}: up to ${tier.max_members} members for ${formatCurrencyEur(tier.price_eur_monthly)}.\n\nI can still create your network now on the Free Community tier, so it will support up to ${freeCap} members until you subscribe to ${tier.label}.`
}

function isEnterpriseSize(value: string | undefined): boolean {
  return B2B_SIZE_TO_TIER[value as B2BNetworkSizeValue] === 'enterprise'
}

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
  if (!c.professionalBio?.trim()) return 'linkedin'
  return 'professional_bio_review'
}

function sectionHasStarted(section: ProfileSection, c: Collected): boolean {
  if (section === 'personal') {
    return !!(c.talkAllDay?.trim() || c.reachOut?.trim() || c.journey?.trim() || c.recommend?.trim() || c.bio?.trim())
  }
  return !!(c.role?.trim() || c.professionalAssociations?.trim() || c.professionalStrengths?.trim() || c.linkedin?.trim() || c.professionalBio?.trim())
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
  if (savedStage === 'professional' || savedStage === 'professional_confirm' || savedStage === 'fix_role' || savedStage === 'fix_company' || savedStage === 'professional_associations' || savedStage === 'professional_strengths' || savedStage === 'linkedin' || savedStage === 'professional_bio_review') {
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
  'talk_all_day', 'reach_out', 'professional', 'professional_associations', 'professional_strengths', 'recommend', 'journey', 'pb_edit_field',
]

const PB_FIELD_ORDER: PbFieldKey[] = ['city', 'country', 'role', 'company']

function buildProfileBuilderConfirmQueue(c: Collected): PbFieldKey[] {
  return PB_FIELD_ORDER.filter(k => {
    const v = c[k]
    return typeof v === 'string' && v.trim().length > 0
  })
}

function pbFieldLabel(field: PbFieldKey): string {
  switch (field) {
    case 'city':
      return 'city'
    case 'country':
      return 'country'
    case 'role':
      return 'role / title'
    case 'company':
      return 'company'
    default:
      return field
  }
}

/** Map free-text org description to API parent_type (bootstrap normalizes free tier). */
function mapOrgHintToParentType(hint: string): string {
  const h = hint.toLowerCase()
  if (/\b(gym|fitness|studio|crossfit|yoga|pilates)\b/.test(h)) return 'gym'
  if (/\b(university|college|alumni|school|campus|faculty|student)\b/.test(h)) return 'university'
  return 'general'
}

function profileSummaryBlock(c: Collected): string {
  const lines: string[] = []
  const name = `${c.firstName} ${c.lastName}`.trim()
  if (name) lines.push(`• Name: ${name}`)
  if (c.city?.trim()) lines.push(`• City: ${c.city.trim()}`)
  if (c.country?.trim()) lines.push(`• Country: ${c.country.trim()}`)
  if (c.role?.trim()) lines.push(`• Role: ${c.role.trim()}`)
  if (c.company?.trim()) lines.push(`• Company: ${c.company.trim()}`)
  if (c.bio?.trim()) {
    const t = c.bio.trim()
    lines.push(`• Personal bio: ${t.length > 220 ? `${t.slice(0, 217)}…` : t}`)
  }
  if (c.professionalBio?.trim()) {
    const t = c.professionalBio.trim()
    lines.push(`• Professional bio: ${t.length > 220 ? `${t.slice(0, 217)}…` : t}`)
  }
  if (c.linkedin?.trim()) lines.push('• LinkedIn: added')
  if (lines.length === 0) return 'Nothing is on your public profile yet — we’ll build it together.'
  return lines.join('\n')
}

function validateLinkedInProfileUrl(raw: string): { ok: boolean; url?: string; error?: string } {
  const value = raw.trim()
  if (!value) return { ok: false, error: 'Please paste your LinkedIn profile URL, or skip this step.' }
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const path = url.pathname.toLowerCase()
    if (host !== 'linkedin.com') {
      return { ok: false, error: 'Please use a LinkedIn profile URL, for example https://www.linkedin.com/in/yourname.' }
    }
    if (!path.startsWith('/in/') || path.split('/').filter(Boolean).length < 2) {
      return { ok: false, error: 'That looks like a LinkedIn page, but not a personal profile. Please use your /in/ profile URL.' }
    }
    if (['/company/', '/school/', '/jobs/', '/posts/', '/feed/', '/pulse/'].some(blocked => path.startsWith(blocked))) {
      return { ok: false, error: 'That LinkedIn URL is not a personal profile. Please use your own /in/ profile URL.' }
    }
    return { ok: true, url: url.toString() }
  } catch {
    return { ok: false, error: 'Please enter a valid LinkedIn profile URL, for example https://www.linkedin.com/in/yourname.' }
  }
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
    activeProfileSection: undefined,
    profileSectionOrder: [],
  })
  const [isTyping, setIsTyping] = useState(false)
  const [picFile, setPicFile] = useState<File | null>(null)
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
  const [composingBio, setComposingBio] = useState(false)
  const [tourStep, setTourStep] = useState<number | null>(null)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [headerLogoSrc, setHeaderLogoSrc] = useState('/api/public/logo')
  const [safeBottomPx, setSafeBottomPx] = useState(0)
  const [tierHints, setTierHints] = useState<OnboardingTierHints | null>(null)
  const [showDeferConfirm, setShowDeferConfirm] = useState(false)
  const [deferringProfile, setDeferringProfile] = useState(false)
  const [deferError, setDeferError] = useState('')
  const [bioDraftingKind, setBioDraftingKind] = useState<'personal' | 'professional' | null>(null)

  const NATIVE_KEYBOARD_MIN_HEIGHT = 60
  const KEYBOARD_OFFSET_EPSILON = 6
  const isIOS = Capacitor.getPlatform() === 'ios'

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const keyboardOffsetRef = useRef(0)
  const onboardingIntentRef = useRef<'b2b' | 'b2c' | null>(null)
  const b2bOrgRef = useRef('')
  const b2bParentRef = useRef('')
  const tierHintsRef = useRef<OnboardingTierHints | null>(null)

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const probe = document.createElement('div')
    probe.style.position = 'fixed'
    probe.style.bottom = '0'
    probe.style.left = '0'
    probe.style.width = '0'
    probe.style.height = 'env(safe-area-inset-bottom, 0px)'
    probe.style.pointerEvents = 'none'
    probe.style.opacity = '0'
    probe.style.zIndex = '-1'
    document.body.appendChild(probe)

    const updateSafeBottom = () => {
      if (keyboardOffsetRef.current > 0) return
      const rect = probe.getBoundingClientRect()
      const next = rect.height || 0
      setSafeBottomPx(prev => {
        if (next < 1 && prev > 1) return prev
        return Math.abs(prev - next) < 1 ? prev : next
      })
    }

    updateSafeBottom()
    window.addEventListener('resize', updateSafeBottom)
    return () => {
      window.removeEventListener('resize', updateSafeBottom)
      probe.remove()
    }
  }, [])

  // Native keyboard handling (Capacitor — iOS only)
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'ios') return
    let showSub: PluginListenerHandle | undefined
    let hideSub: PluginListenerHandle | undefined

    const normalizeHeight = (raw: number) => (raw < NATIVE_KEYBOARD_MIN_HEIGHT ? 0 : raw)

    const handleShow = (info: KeyboardInfo) => {
      const height = normalizeHeight(info?.keyboardHeight ?? 0)
      if (height === 0) return
      if (Math.abs(keyboardOffsetRef.current - height) < KEYBOARD_OFFSET_EPSILON) return
      keyboardOffsetRef.current = height
      setKeyboardOffset(height)
      requestAnimationFrame(scrollToBottom)
    }

    const handleHide = () => {
      if (Math.abs(keyboardOffsetRef.current) < KEYBOARD_OFFSET_EPSILON) return
      keyboardOffsetRef.current = 0
      setKeyboardOffset(0)
    }

    Keyboard.addListener('keyboardWillShow', handleShow).then(handle => {
      showSub = handle
    })
    Keyboard.addListener('keyboardWillHide', handleHide).then(handle => {
      hideSub = handle
    })

    return () => {
      showSub?.remove()
      hideSub?.remove()
    }
  }, [scrollToBottom])

  // Visual viewport keyboard handling (web + Android)
  useEffect(() => {
    if (isIOS) return
    if (typeof window === 'undefined') return
    const viewport = window.visualViewport
    if (!viewport) return

    const onResize = () => {
      const offset = window.innerHeight - viewport.height - viewport.offsetTop
      const normalized = offset > 40 ? offset : 0
      if (Math.abs(keyboardOffsetRef.current - normalized) < 10) return
      keyboardOffsetRef.current = normalized
      setKeyboardOffset(normalized)
      if (normalized > 0) requestAnimationFrame(() => scrollToBottom())
    }

    viewport.addEventListener('resize', onResize)
    viewport.addEventListener('scroll', onResize)
    return () => {
      viewport.removeEventListener('resize', onResize)
      viewport.removeEventListener('scroll', onResize)
    }
  }, [isIOS, scrollToBottom])

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
              bio: (p.personal?.bio || p.bio || '').trim(),
              professionalBio: (p.professional?.about || p.professional_about || '').trim(),
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
          if (saved.onboarding_intent === 'b2b' || saved.onboarding_intent === 'b2c') {
            onboardingIntentRef.current = saved.onboarding_intent
          }
          const savedCollected = saved.collected ? ({ ...collected, ...saved.collected } as Collected) : collected
          if (saved.collected) {
            setCollected(savedCollected)
            const sc = savedCollected
            if (sc.b2bOrgTypeHint) b2bOrgRef.current = String(sc.b2bOrgTypeHint)
            if (sc.b2bParentName) b2bParentRef.current = String(sc.b2bParentName)
          }
          const resumeStage = normalizeResumeStage(saved.stage as Stage, savedCollected)
          setStage(resumeStage)
          if (!saved.resume_welcome_shown) {
            setMessages([{ from: 'steve', text: 'Welcome back. I saved your progress, so we will pick up where you left off.' }])
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
        const greeting = data.firstName
          ? `Hey ${data.firstName}! 👋`
          : 'Hey there! 👋'
        addSteveMessage(
          `${greeting} I'm Steve. Great to meet you.\n\nI'll ask a few simple questions so your profile feels like you, and so the right people can understand who you are inside C-Point. We'll keep it light - you can change anything later.\n\n${OCopy.INTENT_QUESTION}`,
          {
            options: [
              { label: 'A private community for my personal circles', value: 'intent_b2c' },
              { label: 'A private network for my organisation', value: 'intent_b2b' },
              { label: 'Finish later', value: 'open_defer_modal' },
            ],
          },
        )
        break
      }
      case 'b2b_value': {
        addSteveMessage(
          'Great. Let’s shape a private network for your organisation — a trusted place for the right people to connect, share updates, and keep useful context together. I’ll ask a few quick questions so we can set it up properly.',
          { options: [{ label: 'Continue', value: 'b2b_value_continue' }] },
        )
        break
      }
      case 'b2b_network_size': {
        addSteveMessage(
          'Great. Let’s shape a private network for your organisation — a trusted place for the right people to connect, share updates, and keep useful context together.\n\nFirst, about how many people do you expect in this network? This helps me point you toward the right setup.',
          { options: b2bNetworkSizeOptions(tierHintsRef.current || tierHints) },
        )
        break
      }
      case 'b2b_tier_guidance': {
        const sizeValue = data.b2bNetworkSize || ''
        const options: ChatMessage['options'] = [
          { label: 'Continue creating network', value: 'b2b_tier_continue' },
        ]
        if (isEnterpriseSize(sizeValue)) {
          options.push({ label: 'Contact sales', value: 'contact_sales_enterprise' })
        }
        addSteveMessage(
          b2bTierGuidanceText(sizeValue, tierHintsRef.current || tierHints),
          { options },
        )
        break
      }
      case 'b2b_org_type': {
        addSteveMessage(OCopy.ORG_TYPE_PROMPT, {
          inputType: 'text',
          inputPlaceholder: 'e.g. yoga studio, alumni association',
        })
        break
      }
      case 'b2b_parent_name': {
        addSteveMessage(
          'What should we call this network?',
          { inputType: 'text', inputPlaceholder: 'e.g. Northside Studio Collective' },
        )
        break
      }
      case 'b2b_sub_names': {
        addSteveMessage(
          'Optional: list **sub-community** names, separated by commas (smaller invite-only private communities under your network). Or skip for now.',
          {
            inputType: 'text',
            inputPlaceholder: 'Team A, Beginners, Staff — or leave blank',
            options: [{ label: 'Skip sub-communities for now', value: 'b2b_skip_subs' }],
          },
        )
        break
      }
      case 'welcome': {
        const greeting = data.firstName
          ? `Hey ${data.firstName}! 👋`
          : 'Hey there! 👋'
        let welcomeText: string
        if (mode === 'profile_builder') {
          welcomeText = `${greeting} Let's update your profile together.\n\nI'll walk you through a few quick questions — anything you've already filled in, we can skip. Ready?`
        } else {
          welcomeText = `${greeting} I'm Steve. Great to meet you.`
          if (communityName) {
            welcomeText += ` I see you were invited to ${communityName}.`
            welcomeText += `\n\nI'll help you build a profile that feels like you, so people in your private communities know who they're talking to. We'll keep it light - you can change anything later. Ready?`
          } else {
            welcomeText += `\n\nI'll ask a few simple questions so your profile feels like you, and so the right people can understand who you are inside C-Point. We'll keep it light - you can change anything later. Ready?`
          }
        }
        const welcomeOpts: ChatMessage['options'] =
          mode === 'profile_builder'
            ? [{ label: "Let's go!", value: 'start', icon: '🚀' }]
            : communityName
              ? [{ label: "Let's go!", value: 'start', icon: '🚀' }]
              : [
                  { label: "Let's go!", value: 'start' },
                  { label: 'Finish later', value: 'open_defer_modal' },
                ]
        addSteveMessage(welcomeText, { options: welcomeOpts })
        break
      }
      case 'profile_builder_summary': {
        const summary = profileSummaryBlock(data)
        addSteveMessage(
          `Here's what I already see on your public profile:\n\n${summary}\n\nNext, we'll confirm each filled-in field one at a time — then continue with the rest of your profile.`,
          { options: [{ label: 'Continue', value: 'pb_summary_continue', icon: '➡️' }] }
        )
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
        addSteveMessage(`I have your **${pbFieldLabel(field)}** as **${raw}** — still correct?`, {
          options: [
            { label: 'Yes', value: 'pb_confirm_yes', icon: '✅' },
            { label: 'Update', value: 'pb_confirm_update', icon: '✏️' },
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
        addSteveMessage(`What should I use for your **${pbFieldLabel(field)}**?`, {
          inputType: 'text',
          inputPlaceholder: 'Type your answer…',
        })
        break
      }
      case 'name': {
        const hasName = data.firstName && data.lastName
        if (hasName) {
          addSteveMessage(`I have your name as ${data.firstName} ${data.lastName} — is that right?`, {
            options: [
              { label: "That's correct", value: 'confirm_name', icon: '✅' },
              { label: 'Let me fix that', value: 'edit_name', icon: '✏️' },
            ],
          })
        } else {
          addSteveMessage("Let's start with your name. What should people call you here? First and last name is best.", {
            inputType: 'text',
            inputPlaceholder: 'First Last',
          })
        }
        break
      }
      case 'location':
        addSteveMessage('Where are you based?', {
          inputType: 'text',
          inputPlaceholder: 'e.g. Munich, Germany',
        })
        break
      case 'location_confirm': {
        const city = data?.city || collected.city || ''
        const country = data?.country || collected.country || ''
        if (city && country) {
          addSteveMessage(`Just to confirm — did you mean ${city}, ${country}?`, {
            options: [
              { label: `Yes, ${city}, ${country}`, value: 'confirm_location', icon: '✅' },
              { label: 'No, let me correct that', value: 'edit_location', icon: '✏️' },
            ],
          })
        } else {
          addSteveMessage('Where are you based?', {
            inputType: 'text',
            inputPlaceholder: 'e.g. Munich, Germany',
          })
          setStage('location')
        }
        break
      }
      case 'location_city': {
        const country = data?.country || collected.country || ''
        addSteveMessage(`${country} — great! Which city are you based in?`, {
          inputType: 'text',
          inputPlaceholder: `e.g. Berlin`,
          options: [{ label: 'Skip — just use country', value: 'skip_city', icon: '⏭️' }],
        })
        break
      }
      case 'photo':
        addSteveMessage("Add a profile picture if you want people to recognize you more easily.", {
          photoUpload: true,
          options: [{ label: 'Skip for now', value: 'skip_photo' }],
        })
        break
      case 'section_picker': {
        const personalStatus = data.personalSectionComplete ? 'Personal complete' : 'Personal pending'
        const professionalStatus = data.professionalSectionComplete ? 'Professional complete' : 'Professional pending'
        const pickerOptions: ChatMessage['options'] =
          data.personalSectionComplete && data.professionalSectionComplete
            ? [
                { label: 'Review profile', value: 'finish_sections_review' },
                { label: 'Finish later', value: 'open_defer_modal' },
              ]
            : [{ label: 'Finish later', value: 'open_defer_modal' }]
        addSteveMessage(
          'You can choose what to build next. Each section is short and finite, so this is not an open-ended interview.',
          {
            sectionPicker: {
              personalStatus,
              professionalStatus,
            },
            options: pickerOptions,
          },
        )
        break
      }
      case 'personal_section_intro':
        addSteveMessage(
          "Let's build your Personal Identity. This has 6 steps, including 4 dedicated questions, public social links, and your personal bio draft. It takes about 2 minutes and helps people understand the human side of you.",
          {
            sectionCard: {
              title: 'Personal Identity',
              subtitle: 'A warmer profile section for conversation, interests, and personality.',
              steps: PERSONAL_SECTION_STEPS,
              activeIndex: 0,
              sectionKind: 'personal',
            },
            options: [
              { label: 'Start personal section', value: 'start_personal_section' },
              { label: 'Finish later', value: 'open_defer_modal' },
            ],
          },
        )
        break
      case 'talk_all_day':
        addSteveMessage(
          "What are a few things you could happily talk about for ages?\n\nExamples: AI, leadership, travel, startups",
          {
            inputType: 'text',
            inputPlaceholder: 'Type your answer…',
            options: stageHistory.current.length > 1 ? [{ label: '← Go back', value: 'go_back', icon: '↩️' }] : undefined,
          }
        )
        break
      case 'reach_out':
        addSteveMessage(
          "What would you like people to reach out to you about?\n\nExamples: coffee chats, brainstorming, partnerships, new ventures",
          {
            inputType: 'text',
            inputPlaceholder: 'Type your answer…',
            options: stageHistory.current.length > 1 ? [{ label: '← Go back', value: 'go_back', icon: '↩️' }] : undefined,
          }
        )
        break
      case 'professional':
        addSteveMessage('What do you do professionally, or what are you building right now? Something like "Product Manager at Google" or "Founder, building in fintech" works great.', {
          inputType: 'text',
          inputPlaceholder: 'e.g. Product Manager at Google',
          options: stageHistory.current.length > 1 ? [{ label: '← Go back', value: 'go_back', icon: '↩️' }] : undefined,
        })
        break
      case 'professional_confirm': {
        const role = data?.role || collected.role || ''
        const company = data?.company || collected.company || ''
        if (role && company) {
          addSteveMessage(`Here's what I got:\n\nRole: ${role}\nCompany: ${company}\n\nDoes that look right?`, {
            options: [
              { label: `Yes, that's correct`, value: 'confirm_professional', icon: '✅' },
              { label: 'Fix role', value: 'edit_role_only', icon: '✏️' },
              { label: 'Fix company', value: 'edit_company_only', icon: '✏️' },
              { label: 'Fix both', value: 'edit_professional', icon: '✏️' },
            ],
          })
        } else if (role) {
          addSteveMessage(`Here's what I got:\n\nRole: ${role}\nCompany: not specified\n\nDoes that look right, or would you like to add a company?`, {
            options: [
              { label: `Yes, that's correct`, value: 'confirm_professional', icon: '✅' },
              { label: 'Add company', value: 'edit_company_only', icon: '✏️' },
              { label: 'Fix role', value: 'edit_role_only', icon: '✏️' },
            ],
          })
        } else {
          addSteveMessage('What do you do professionally?', {
            inputType: 'text',
            inputPlaceholder: 'e.g. Product Manager at Google',
          })
          setStage('professional')
        }
        break
      }
      case 'professional_section_intro':
        addSteveMessage(
          "Let's build your Professional Identity. This has 5 steps, including 3 dedicated questions, LinkedIn, and your professional bio draft. It takes about 2 minutes and helps make your work and collaboration context clear.",
          {
            sectionCard: {
              title: 'Professional Identity',
              subtitle: 'A practical profile section for work, expertise, and collaboration.',
              steps: PROFESSIONAL_SECTION_STEPS,
              activeIndex: 0,
              sectionKind: 'professional',
            },
            options: [
              { label: 'Start professional section', value: 'start_professional_section' },
              { label: 'Finish later', value: 'open_defer_modal' },
            ],
          },
        )
        break
      case 'professional_associations':
        addSteveMessage('What kinds of work, ideas, or opportunities should people associate you with?', {
          inputType: 'text',
          inputPlaceholder: 'e.g. product strategy, community building, early-stage ventures',
          options: stageHistory.current.length > 1 ? [{ label: '← Go back', value: 'go_back', icon: '↩️' }] : undefined,
        })
        break
      case 'professional_strengths':
        addSteveMessage('What are you especially good at, or what do people usually come to you for?', {
          inputType: 'text',
          inputPlaceholder: 'e.g. simplifying complex ideas, partnerships, go-to-market',
          options: stageHistory.current.length > 1 ? [{ label: '← Go back', value: 'go_back', icon: '↩️' }] : undefined,
        })
        break
      case 'recommend': {
        const recOpts: ChatMessage['options'] = [{ label: 'Skip', value: 'skip_recommend', icon: '⏭️' }]
        if (stageHistory.current.length > 1) recOpts.push({ label: '← Go back', value: 'go_back', icon: '↩️' })
        addSteveMessage("Recommend one book, film, podcast, place, or idea you think others might enjoy.", {
          inputType: 'text',
          inputPlaceholder: 'e.g. Sapiens, a favorite podcast, or a local place',
          options: recOpts,
        })
        break
      }
      case 'linkedin': {
        const lnOpts: ChatMessage['options'] = [{ label: 'Skip', value: 'skip_linkedin', icon: '⏭️' }]
        if (stageHistory.current.length > 1) lnOpts.push({ label: '← Go back', value: 'go_back', icon: '↩️' })
        addSteveMessage('Optional: add your LinkedIn URL so people can find your professional profile. You can skip this.', {
          inputType: 'url',
          inputPlaceholder: 'https://linkedin.com/in/yourprofile',
          options: lnOpts,
        })
        break
      }
      case 'optional_social': {
        const soOpts: ChatMessage['options'] = [{ label: 'Skip', value: 'skip_optional_social', icon: '⏭️' }]
        if (stageHistory.current.length > 1) soOpts.push({ label: '← Go back', value: 'go_back', icon: '↩️' })
        addSteveMessage(
          'Optional: share your Instagram, X, or TikTok links so other members in your networks can find your public profiles.\n\nPaste one URL per line, or skip.',
          {
            inputType: 'textarea',
            inputPlaceholder: 'https://instagram.com/yourprofile\nhttps://x.com/yourprofile\nhttps://www.tiktok.com/@you',
            options: soOpts,
          }
        )
        break
      }
      case 'journey':
        addSteveMessage('What is something your networks should know about you? Feel free to share an achievement you are proud of or a highlight that shapes who you are today.', {
          inputType: 'textarea',
          inputPlaceholder: 'Type your answer...',
          options: (() => {
            const opts: ChatMessage['options'] = [{ label: 'Skip', value: 'skip_journey', icon: '⏭️' }]
            if (stageHistory.current.length > 1) opts.push({ label: '← Go back', value: 'go_back', icon: '↩️' })
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
        addSteveMessage('Here is the profile we built together. You can edit either section later from your profile.', {
          profileReview: {
            personalBio: data.bio,
            professionalBio: data.professionalBio,
            linkedinAdded: !!data.linkedin?.trim(),
          },
          options: [
            { label: 'Looks good', value: 'finish_profile_review' },
            { label: 'Finish later', value: 'open_defer_modal' },
          ],
        })
        break
      case 'manual_bio_edit':
        break
      case 'enriching':
        // Enrichment disabled for normal users (admin-only on profile edit page)
        addSteveMessage("Your profile is complete! No public enrichment step for now.")
        setTimeout(() => advanceToComplete(), 800)
        break
      case 'review':
        // Review/enrichment step disabled for normal users
        addSteveMessage("Profile setup complete! You can always edit details later.")
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
      'professional_section_intro', 'professional', 'professional_associations',
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

  function jumpToSectionOutlineStep(sectionKind: ProfileSection, idx: number) {
    const map = sectionKind === 'personal' ? PERSONAL_SECTION_INDEX_TO_STAGE : PROFESSIONAL_SECTION_INDEX_TO_STAGE
    const target = map[idx]
    if (!target) return
    setCollected(prev => {
      const next = { ...prev, activeProfileSection: sectionKind }
      Promise.resolve().then(() => advanceTo(target, next))
      return next
    })
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
      addSteveMessage('I still need a name for your main network — what should we call it?', {
        inputType: 'text',
        inputPlaceholder: 'e.g. Northside Studio Collective',
      })
      setStage('b2b_parent_name')
      saveState('b2b_parent_name', c)
      return
    }
    const parentType = mapOrgHintToParentType(orgHint)
    setIsTyping(true)
    addSteveMessage('Creating your communities — one moment…')
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
        addSteveMessage(
          "You're set — your network shell is ready. Now let's finish your profile so people know who's leading the network.",
        )
        setTimeout(() => advanceTo('name', c), 600)
      } else {
        const err = (j?.error || 'Could not create communities right now.') as string
        addSteveMessage(`Hmm — ${err}\n\nLet’s try a different name for your main network.`)
        setStage('b2b_parent_name')
        saveState('b2b_parent_name', c)
        startStage('b2b_parent_name', c)
      }
    } catch {
      setIsTyping(false)
      addSteveMessage('Something went wrong creating your communities. Let’s try your main network name again.')
      setStage('b2b_parent_name')
      saveState('b2b_parent_name', c)
      startStage('b2b_parent_name', c)
    }
  }

  function showCompleteMsg() {
    addSteveMessage(
      "You're all set! Your profile is live.\n\nI'm always here if you need anything — just DM me or tag @Steve in any chat.\n\nA richer profile makes it easier for people to understand who you are, what you care about, and where collaboration might make sense. You can add more background, interests, and goals on Edit Profile, which also helps me make better introductions across your networks.",
      {
        options: [
          { label: 'Add more in Edit Profile', value: 'edit_profile' },
          { label: 'Show me around', value: 'start_tour' },
          { label: 'Take me to the dashboard', value: 'go_feed' },
          { label: 'Create a community', value: 'create_community' },
        ],
      }
    )
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
        }),
      })
      const j = await r.json().catch(() => null)
      const bio = j?.bio || ''
      setComposingBio(false)
      setBioDraftingKind(null)
      setIsTyping(false)
      if (bio) {
        addSteveMessage(
          kind === 'personal'
            ? "Here's a personal bio based on what you told me:"
            : "Here's a professional bio based on what you told me:",
          { composedBio: bio, composedBioKind: kind },
        )
      } else {
        addSteveMessage(`I couldn't compose your ${kind} bio right now — would you like to write one yourself?`, {
          inputType: 'textarea',
          inputPlaceholder: `Write a 2-3 sentence ${kind} bio...`,
        })
      }
    } catch {
      setComposingBio(false)
      setBioDraftingKind(null)
      setIsTyping(false)
      addSteveMessage(`Something went wrong. Want to write your own ${kind} bio instead?`, {
        inputType: 'textarea',
        inputPlaceholder: `Write a 2-3 sentence ${kind} bio...`,
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
    addUserMessage('Done reviewing')
    const accepted = enrichmentCards.filter(c => c.status === 'accepted')
    if (accepted.length > 0) {
      addSteveMessage(`Great choices! I've added ${accepted.length} item${accepted.length > 1 ? 's' : ''} to your profile.`)
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
    addUserMessage('Finish later')
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
        addSteveMessage('Saved. You can come back anytime from your dashboard, and I will send two gentle reminders while this is still fresh.')
        setShowDeferConfirm(false)
        setTimeout(() => onExit(), 800)
      } else {
        setDeferError(j?.error || 'I could not save that just now. Please try again, or keep going for now.')
      }
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === 'AbortError'
      setDeferError(timedOut ? 'Saving is taking longer than expected. Please try again.' : 'I could not save that just now. Please try again, or keep going for now.')
    } finally {
      window.clearTimeout(timeoutId)
      setDeferringProfile(false)
    }
  }

  async function handleOptionClick(value: string) {
    switch (value) {
      case 'intent_b2c': {
        addUserMessage('A private community for my personal circles')
        onboardingIntentRef.current = 'b2c'
        advanceTo('name', collected)
        break
      }
      case 'intent_b2b': {
        addUserMessage('A private network for my organisation')
        onboardingIntentRef.current = 'b2b'
        advanceTo('b2b_network_size', collected)
        break
      }
      case 'b2b_value_continue': {
        addUserMessage('Continue')
        advanceTo('b2b_network_size', collected)
        break
      }
      case 'b2b_skip_subs': {
        addUserMessage('Skip sub-communities for now')
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
        addUserMessage(b2bNetworkSizeLabel(value, tierHintsRef.current || tierHints))
        const newCollected = { ...collected, b2bNetworkSize: value }
        setCollected(newCollected)
        advanceTo('b2b_tier_guidance', newCollected)
        break
      }
      case 'b2b_tier_continue': {
        addUserMessage('Continue creating network')
        advanceTo('b2b_parent_name', collected)
        break
      }
      case 'contact_sales_enterprise': {
        addUserMessage('Contact sales')
        window.location.href = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent('Enterprise community plan')}`
        addSteveMessage('I opened an email to the sales team. You can still continue creating the network now.', {
          options: [{ label: 'Continue creating network', value: 'b2b_tier_continue' }],
        })
        break
      }
      case 'start':
        addUserMessage("Let's go!")
        if (mode === 'profile_builder') {
          advanceTo('profile_builder_summary')
        } else {
          advanceTo('name')
        }
        break
      case 'pb_summary_continue': {
        addUserMessage('Continue')
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
        addUserMessage('Yes')
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
        addUserMessage('Update')
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
        addUserMessage("That's correct")
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
        addUserMessage('Let me fix that')
        addSteveMessage("No problem! What's your first and last name?", {
          inputType: 'text',
          inputPlaceholder: 'First Last',
        })
        break
      case 'confirm_location': {
        addUserMessage(`Yes, ${collected.city}, ${collected.country}`)
        await saveField('city', collected.city)
        await saveField('country', collected.country)
        advanceTo('photo')
        break
      }
      case 'edit_location':
        addUserMessage('Let me correct that')
        addSteveMessage('No problem! Where are you based? Please include the country.', {
          inputType: 'text',
          inputPlaceholder: 'e.g. Munich, Germany',
        })
        setStage('location')
        break
      case 'confirm_professional': {
        const profLabel = collected.company
          ? `${collected.role} at ${collected.company}`
          : collected.role
        addUserMessage(`Yes, ${profLabel}`)
        await saveField('role', collected.role)
        if (collected.company) await saveField('company', collected.company)
        advanceTo('professional_associations')
        break
      }
      case 'edit_professional':
        addUserMessage('Let me fix both')
        addSteveMessage('No problem! What do you do professionally?', {
          inputType: 'text',
          inputPlaceholder: 'e.g. Product Manager at Google',
        })
        setStage('professional')
        break
      case 'edit_role_only':
        addUserMessage('Fix role')
        addSteveMessage(`No problem! What's your role/title?`, {
          inputType: 'text',
          inputPlaceholder: 'e.g. Product Manager',
        })
        setStage('fix_role')
        break
      case 'edit_company_only':
        addUserMessage(collected.company ? 'Fix company' : 'Add company')
        addSteveMessage(`What company do you work at?`, {
          inputType: 'text',
          inputPlaceholder: 'e.g. Google',
        })
        setStage('fix_company')
        break
      case 'skip_city': {
        addUserMessage('Skip — just use country')
        await saveField('country', collected.country)
        advanceTo('photo')
        break
      }
      case 'go_back': {
        addUserMessage('Go back')
        const hist = stageHistory.current
        if (hist.length >= 2) {
          hist.pop()
          const prev = hist[hist.length - 1]
          addSteveMessage("Sure — let's revisit that question.")
          setTimeout(() => {
            setStage(prev)
            startStage(prev)
          }, 400)
        } else {
          addSteveMessage("We're at the beginning — no previous questions to go back to.")
        }
        break
      }
      case 'gibberish_skip': {
        addUserMessage('Yes, skip it')
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
        addSteveMessage("No problem — you can always fill this in later from your profile.")
        setTimeout(() => advanceTo(nextStage), 600)
        break
      }
      case 'gibberish_retry': {
        addUserMessage('Let me try again')
        const retryStage = gibberishReturnStage.current
        gibberishReturnStage.current = null
        if (retryStage) {
          startStage(retryStage)
          setStage(retryStage)
        }
        break
      }
      case 'skip_photo':
        addUserMessage('Skip for now')
        addSteveMessage("No problem — you can always add one later from your profile.")
        setTimeout(() => advanceTo('section_picker'), 600)
        break
      case 'choose_personal_section': {
        addUserMessage('Personal Identity - about 2 minutes - 6 steps - 4 questions')
        const order = collected.profileSectionOrder?.includes('personal')
          ? collected.profileSectionOrder
          : [...(collected.profileSectionOrder || []), 'personal' as ProfileSection]
        const newCollected = { ...collected, activeProfileSection: 'personal' as ProfileSection, profileSectionOrder: order }
        setCollected(newCollected)
        advanceTo(startOrResumeSection('personal', newCollected), newCollected)
        break
      }
      case 'choose_professional_section': {
        addUserMessage('Professional Identity - about 2 minutes - 5 steps - 3 questions')
        const order = collected.profileSectionOrder?.includes('professional')
          ? collected.profileSectionOrder
          : [...(collected.profileSectionOrder || []), 'professional' as ProfileSection]
        const newCollected = { ...collected, activeProfileSection: 'professional' as ProfileSection, profileSectionOrder: order }
        setCollected(newCollected)
        advanceTo(startOrResumeSection('professional', newCollected), newCollected)
        break
      }
      case 'finish_sections_review':
        addUserMessage('Review profile')
        advanceTo('profile_review')
        break
      case 'start_personal_section':
        addUserMessage('Start personal section')
        advanceTo('talk_all_day')
        break
      case 'start_professional_section':
        addUserMessage('Start professional section')
        advanceTo('professional')
        break
      case 'skip_linkedin':
        addUserMessage('Skip')
        advanceTo('professional_bio_review')
        break
      case 'skip_optional_social':
        addUserMessage('Skip')
        advanceTo('personal_bio_review')
        break
      case 'skip_journey':
        addUserMessage('Skip')
        advanceTo('recommend')
        break
      case 'skip_recommend':
        addUserMessage('Skip')
        advanceTo('optional_social')
        break
      case 'use_bio': {
        const lastMessage = [...messages].reverse().find(m => m.composedBio)
        const lastComposed = lastMessage?.composedBio || ''
        const kind = lastMessage?.composedBioKind || 'personal'
        if (lastComposed) {
          addUserMessage('Use this')
          const newCollected =
            kind === 'professional'
              ? { ...collected, professionalBio: lastComposed, professionalSectionComplete: true }
              : { ...collected, bio: lastComposed, personalSectionComplete: true }
          setCollected(newCollected)
          await saveField(kind === 'professional' ? 'professional_about' : 'bio', lastComposed)
          addSteveMessage(kind === 'professional' ? 'Professional bio saved.' : 'Personal bio saved.')
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
        addUserMessage(value === 'bio_shorter' ? 'Shorter' : value === 'bio_more_professional' ? 'More professional' : 'More natural')
        await composeBio(kind, collected, style, lastMessage?.composedBio || '')
        break
      }
      case 'edit_bio': {
        const lastMessage = [...messages].reverse().find(m => m.composedBio)
        const bioToEdit = lastMessage?.composedBio || ''
        addUserMessage('Let me edit')
        setInputValue(bioToEdit)
        addSteveMessage("Go ahead — tweak it however you'd like. I'll save this version for the current section.", {
          inputType: 'textarea',
          inputPlaceholder: 'Edit this bio...',
        })
        setStage('manual_bio_edit')
        saveState('manual_bio_edit', collected)
        break
      }
      case 'redo_bio':
        addUserMessage('Start fresh')
        addSteveMessage('No problem — write your own version. 2-3 sentences is perfect.', {
          inputType: 'textarea',
          inputPlaceholder: 'Write this bio...',
        })
        setStage('manual_bio_edit')
        saveState('manual_bio_edit', collected)
        break
      case 'finish_profile_review':
        addUserMessage('Looks good')
        addSteveMessage('Your profile sections are set.')
        setTimeout(() => advanceToComplete(), 800)
        break
      case 'start_tour':
        addUserMessage('Show me around')
        await completeOnboarding()
        setTourStep(0)
        break
      case 'go_feed':
        await completeOnboarding()
        onComplete()
        break
      case 'edit_profile':
        addUserMessage('Add more in Edit Profile')
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
      addSteveMessage("Hmm, that doesn't look quite right. Would you like to skip this question?", {
        options: [
          { label: 'Yes, skip it', value: 'gibberish_skip', icon: '⏭️' },
          { label: 'No, let me try again', value: 'gibberish_retry', icon: '✏️' },
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
          addSteveMessage("I need at least a first name! What's your first and last name?", {
            inputType: 'text',
            inputPlaceholder: 'First Last',
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
              addSteveMessage("I couldn't quite place that location. No worries — you can set it later from your profile.")
              setTimeout(() => advanceTo('photo'), 800)
            }
          } catch {
            setIsTyping(false)
            addSteveMessage("I couldn't quite place that location. No worries — you can set it later from your profile.")
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
        const reactions = ['Love it!', 'Great taste!', 'Interesting!', 'Nice!']
        addSteveMessage(reactions[Math.floor(Math.random() * reactions.length)])
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
      case 'recommend': {
        const newCollected = { ...collected, recommend: val }
        setCollected(newCollected)
        addSteveMessage('Good pick.')
        setTimeout(() => advanceTo('optional_social', newCollected), 600)
        break
      }
      case 'linkedin': {
        const parsed = validateLinkedInProfileUrl(val)
        if (!parsed.ok) {
          addSteveMessage(parsed.error || 'Please add a valid LinkedIn profile URL, or skip this step.', {
            inputType: 'url',
            inputPlaceholder: 'https://www.linkedin.com/in/yourprofile',
            options: [{ label: 'Skip', value: 'skip_linkedin', icon: '⏭️' }],
          })
          return
        }
        const newCollected = { ...collected, linkedin: parsed.url || val }
        setCollected(newCollected)
        await saveField('linkedin', parsed.url || val)
        addSteveMessage('LinkedIn saved. It will appear with your professional profile details.')
        setTimeout(() => advanceTo('professional_bio_review', newCollected), 600)
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
          addSteveMessage('Saved — those public profile links are on file.')
        } else {
          addSteveMessage('No problem — you can add links later from your profile.')
        }
        setTimeout(() => advanceTo('personal_bio_review', collected), 600)
        break
      }
      case 'journey': {
        const newCollected = { ...collected, journey: val }
        setCollected(newCollected)
        addSteveMessage("Thanks for sharing — this helps paint a fuller picture of who you are.")
        setTimeout(() => advanceTo('recommend', newCollected), 800)
        break
      }
      case 'manual_bio_edit': {
        const lastKind = [...messages].reverse().find(m => m.composedBio)?.composedBioKind || 'personal'
        const newCollected =
          lastKind === 'professional'
            ? { ...collected, professionalBio: val, professionalSectionComplete: true }
            : { ...collected, bio: val, personalSectionComplete: true }
        setCollected(newCollected)
        await saveField(lastKind === 'professional' ? 'professional_about' : 'bio', val)
        addSteveMessage(lastKind === 'professional' ? 'Professional bio saved.' : 'Personal bio saved.')
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
        name: "What's your first and last name?",
        location: 'Where are you based?',
        professional: 'What do you do professionally?',
        linkedin: 'Got a LinkedIn URL?',
        optional_social: 'Optional social profile URLs?',
        journey: 'What should your network remember about your journey?',
        talk_all_day: 'What are the things you could talk about all day?',
        recommend: 'Recommend a book, movie, or TV show to your network.',
        reach_out: 'What do you want people to reach out to you about?',
        pb_edit_field: 'Update this profile field.',
        b2b_network_size: 'How many people do you expect in this network?',
        b2b_tier_guidance: 'Review the recommended tier, then continue creating the network.',
        b2b_org_type: OCopy.ORG_TYPE_PROMPT,
        b2b_parent_name: 'What should we call this network?',
        b2b_sub_names: 'List sub-communities separated by commas, or use the skip button.',
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
      const redirectMsg = j?.message || "Interesting! Let's come back to that. For now, let's finish getting you set up."
      setMessages(prev => [...prev, { from: 'steve', text: redirectMsg }])
      scrollToBottom()
    } catch {
      setIsTyping(false)
      setMessages(prev => [...prev, { from: 'steve', text: "Great thought! Let's finish setting up your profile first." }])
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
        addUserMessage('📷 Photo uploaded!')
        addSteveMessage('Looking great! 👌')
        setPicFile(null)
        setTimeout(() => advanceTo('section_picker'), 600)
      } else {
        addSteveMessage(j?.error || "Hmm, that didn't work. Try again or skip for now.", {
          photoUpload: true,
          options: [{ label: 'Skip for now', value: 'skip_photo', icon: '⏭️' }],
        })
      }
    } catch {
      addSteveMessage("Network issue — try again or skip for now.", {
        photoUpload: true,
        options: [{ label: 'Skip for now', value: 'skip_photo', icon: '⏭️' }],
      })
    } finally {
      setUploadingPic(false)
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) {
      setPicFile(f)
      try { setPicPreview(URL.createObjectURL(f)) } catch {}
    }
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, isTyping, scrollToBottom])

  const lastSteveMsg = [...messages].reverse().find(m => m.from === 'steve')
  const showInput = lastSteveMsg?.inputType && stage !== 'enriching' && stage !== 'review' && stage !== 'complete' && !composingBio
  const showPhotoUpload = lastSteveMsg?.photoUpload && stage === 'photo'
  const keyboardLift = keyboardOffset > 0 ? Math.max(0, keyboardOffset - safeBottomPx) : 0
  const composerBottom = `${keyboardLift}px`
  const composerClearance = showPhotoUpload ? 124 : showInput ? 112 : 24
  const composerPaddingBottom = keyboardLift > 0 ? '8px' : `calc(env(safe-area-inset-bottom, 0px) + 8px)`

  if (booting) {
    return (
      <div className="fixed inset-0 z-[1100] bg-black flex items-center justify-center px-6" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex flex-col items-center gap-4 text-center">
          <img
            src={headerLogoSrc}
            alt="C-Point"
            className="w-14 h-14 rounded-2xl object-contain"
            onError={() => setHeaderLogoSrc('/static/cpoint-logo.svg')}
          />
          <div className="w-8 h-8 rounded-full border-2 border-white/15 border-t-[#4db6ac] animate-spin" />
          <div className="text-sm text-white/65">Starting your profile setup...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[1100] bg-black flex flex-col" style={{ height: '100dvh' }}>
      {/* Header with logo */}
      <div className="shrink-0 border-b border-white/10 bg-black/95 backdrop-blur-sm">
        <div className="max-w-lg mx-auto px-4 pb-2 flex flex-col items-center" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}>
          <div className="flex items-center gap-2 mb-2">
            <img
              src={headerLogoSrc}
              alt="C-Point"
              className="w-8 h-8 rounded-lg object-contain"
              onError={() => setHeaderLogoSrc('/static/cpoint-logo.svg')}
            />
          </div>
          <div className="w-full flex items-center gap-3 pb-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#4db6ac] to-[#2a7a72] flex items-center justify-center text-[10px] font-bold text-black shrink-0">
              S
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-white">Steve</div>
            </div>
            <button
              type="button"
              onClick={() => setShowDeferConfirm(true)}
              className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-medium text-white/60 hover:text-white hover:border-white/20 transition"
            >
              Exit for now
            </button>
            <div className="text-[10px] text-white/30">Step {Math.min(Math.ceil(stageProgress(stage) / (100 / USER_FACING_STEPS)), USER_FACING_STEPS)} of {USER_FACING_STEPS}</div>
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
      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ paddingBottom: `${safeBottomPx + keyboardLift + composerClearance}px` }}>
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
                          {msg.sectionCard.steps.map((step, idx) => {
                            const sk = msg.sectionCard?.sectionKind
                            const active = idx === msg.sectionCard?.activeIndex
                            const rowClass = `w-full rounded-lg border px-3 py-2 text-[12px] ${
                              active
                                ? 'border-[#4db6ac]/40 bg-[#4db6ac]/10 text-[#d5fffb]'
                                : 'border-white/10 bg-black/20 text-white/60'
                            }`
                            if (sk) {
                              return (
                                <button
                                  key={step}
                                  type="button"
                                  onClick={() => jumpToSectionOutlineStep(sk, idx)}
                                  className={`text-left transition hover:border-[#4db6ac]/35 hover:bg-black/30 ${rowClass}`}
                                >
                                  {idx + 1}. {step}
                                </button>
                              )
                            }
                            return (
                              <div key={step} className={rowClass}>
                                {idx + 1}. {step}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    {msg.sectionPicker && (
                      <div className="grid gap-2 rounded-2xl border border-[#4db6ac]/25 bg-[#4db6ac]/[0.05] px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#4db6ac]">
                          Choose Your Next Section
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => handleOptionClick('choose_personal_section')}
                            className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-left transition hover:border-[#4db6ac]/35 hover:bg-[#4db6ac]/10"
                          >
                            <div className="text-[12px] font-semibold text-white">Personal Identity</div>
                            <div className="mt-1 text-[11px] text-white/55">About 2 minutes · 6 steps · 4 questions · {msg.sectionPicker.personalStatus}</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOptionClick('choose_professional_section')}
                            className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-left transition hover:border-[#4db6ac]/35 hover:bg-[#4db6ac]/10"
                          >
                            <div className="text-[12px] font-semibold text-white">Professional Identity</div>
                            <div className="mt-1 text-[11px] text-white/55">About 2 minutes · 5 steps · 3 questions · {msg.sectionPicker.professionalStatus}</div>
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
                            {msg.composedBioKind === 'professional' ? 'Professional Bio' : 'Personal Bio'}
                          </div>
                          <div className="text-[13px] text-white/90 leading-relaxed italic">"{msg.composedBio}"</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => handleOptionClick('use_bio')} className="px-3.5 py-2 rounded-xl border border-[#4db6ac]/30 bg-[#4db6ac]/10 text-[12px] font-medium text-[#4db6ac] hover:bg-[#4db6ac]/20 transition-colors">
                            Use this
                          </button>
                          <button onClick={() => handleOptionClick('bio_more_natural')} className="px-3.5 py-2 rounded-xl border border-white/10 bg-white/5 text-[12px] font-medium text-white/60 hover:bg-white/10 transition-colors">
                            More natural
                          </button>
                          <button onClick={() => handleOptionClick('bio_shorter')} className="px-3.5 py-2 rounded-xl border border-white/10 bg-white/5 text-[12px] font-medium text-white/60 hover:bg-white/10 transition-colors">
                            Shorter
                          </button>
                          <button onClick={() => handleOptionClick('bio_more_professional')} className="px-3.5 py-2 rounded-xl border border-white/10 bg-white/5 text-[12px] font-medium text-white/60 hover:bg-white/10 transition-colors">
                            More professional
                          </button>
                          <button onClick={() => handleOptionClick('edit_bio')} className="px-3.5 py-2 rounded-xl border border-white/10 bg-white/5 text-[12px] font-medium text-white/60 hover:bg-white/10 transition-colors">
                            Edit
                          </button>
                          <button onClick={() => handleOptionClick('redo_bio')} className="px-3.5 py-2 rounded-xl border border-white/10 bg-white/5 text-[12px] font-medium text-white/60 hover:bg-white/10 transition-colors">
                            Start fresh
                          </button>
                        </div>
                      </div>
                    )}
                    {msg.profileReview && i === messages.length - 1 && (
                      <div className="space-y-2 mt-1">
                        <div className="rounded-xl border border-[#4db6ac]/20 bg-[#4db6ac]/5 px-3.5 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#4db6ac]">
                            Personal Bio
                          </div>
                          <div className="mt-2 text-[13px] leading-relaxed text-white/90">
                            {msg.profileReview.personalBio || 'Not added yet.'}
                          </div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">
                            Professional Bio
                          </div>
                          <div className="mt-2 text-[13px] leading-relaxed text-white/90">
                            {msg.profileReview.professionalBio || 'Not added yet.'}
                          </div>
                          <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[12px] text-white/65">
                            LinkedIn: {msg.profileReview.linkedinAdded ? 'added' : 'not added'}
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
                                  ✅ Accept
                                </button>
                                <button
                                  onClick={() => handleCardAction(card.id, 'dismissed')}
                                  className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] font-medium text-white/50"
                                >
                                  ❌ Dismiss
                                </button>
                              </div>
                            )}
                            {card.status === 'accepted' && (
                              <div className="text-[10px] text-[#4db6ac]/70 mt-1.5">✅ Added to your profile</div>
                            )}
                            {card.status === 'dismissed' && (
                              <div className="text-[10px] text-white/30 mt-1.5">Dismissed</div>
                            )}
                          </div>
                        ))}
                        {allCardsReviewed() && (
                          <button
                            onClick={handleFinishReview}
                            className="w-full mt-2 px-4 py-3 rounded-xl bg-[#4db6ac] text-black text-sm font-semibold hover:brightness-110 transition"
                          >
                            Continue
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
                    Steve is drafting your {bioDraftingKind} bio...
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

      {/* Photo upload area */}
      {showPhotoUpload && (
        <div
          className="shrink-0 border-t border-white/10 bg-black/95 px-4 py-3"
          style={{
            bottom: composerBottom,
            position: 'fixed',
            left: '0',
            right: '0',
            zIndex: 1000,
            paddingBottom: composerPaddingBottom,
          }}
        >
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
                <img src={picPreview} alt="Preview" className="w-14 h-14 rounded-full object-cover border-2 border-[#4db6ac]/40" />
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
                    Choose a photo
                  </button>
                ) : (
                  <button
                    onClick={handlePhotoUpload}
                    disabled={uploadingPic}
                    className="px-4 py-2.5 rounded-xl bg-[#4db6ac] text-black text-sm font-semibold hover:brightness-110 transition w-full disabled:opacity-50"
                  >
                    {uploadingPic ? 'Uploading...' : 'Upload photo'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Text input */}
      {showInput && (
        <div
          className="shrink-0 border-t border-white/10 bg-black/95 px-4 py-3"
          style={{
            bottom: composerBottom,
            position: 'fixed',
            left: '0',
            right: '0',
            zIndex: 1000,
            paddingBottom: composerPaddingBottom,
          }}
        >
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
                placeholder={lastSteveMsg.inputPlaceholder || 'Type here...'}
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
                placeholder={lastSteveMsg?.inputPlaceholder || 'Type here...'}
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
        </div>
      )}

      {showDeferConfirm && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="w-full max-w-sm rounded-3xl border border-[#4db6ac]/25 bg-[#0d1214] p-5 shadow-[0_24px_80px_rgba(77,182,172,0.16)]">
            <div className="text-lg font-semibold text-white">Need more time?</div>
            <div className="mt-3 text-sm leading-relaxed text-white/70">
              A good profile is easier to build when you are not rushing. We will save what you have shared so far, and you can come back anytime from your dashboard. To help you finish while it is still fresh, we will send two gentle reminders: one after 24 hours and one after 48 hours.
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  setDeferError('')
                  setShowDeferConfirm(false)
                }}
                className="flex-1 rounded-xl border border-[#4db6ac]/30 bg-[#4db6ac]/10 px-4 py-2.5 text-sm font-semibold text-[#d5fffb] transition hover:bg-[#4db6ac]/15"
              >
                Keep going
              </button>
              <button
                type="button"
                onClick={finishLater}
                disabled={deferringProfile}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/75 transition hover:bg-white/10 disabled:opacity-50"
              >
                {deferringProfile ? 'Saving...' : 'Finish later'}
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
                <i className={`${TOUR_STEPS[tourStep].icon} text-2xl text-[#4db6ac]`} />
              </div>
              <div className="text-base font-semibold text-white mb-1.5">{TOUR_STEPS[tourStep].title}</div>
              <div className="text-sm text-white/60 leading-relaxed">{TOUR_STEPS[tourStep].description}</div>
            </div>
            {/* Dot indicators */}
            <div className="flex justify-center gap-1.5 pb-3">
              {TOUR_STEPS.map((_, i) => (
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
                {tourStep > 0 ? 'Back' : 'Skip'}
              </button>
              <div className="text-[10px] text-white/30">{tourStep + 1} of {TOUR_STEPS.length}</div>
              <button
                onClick={async () => {
                  if (tourStep < TOUR_STEPS.length - 1) {
                    setTourStep(tourStep + 1)
                  } else {
                    setTourStep(null)
                    await completeOnboarding()
                    onComplete()
                  }
                }}
                className="px-4 py-2 rounded-lg bg-[#4db6ac] text-black text-xs font-semibold hover:brightness-110 transition"
              >
                {tourStep < TOUR_STEPS.length - 1 ? 'Next' : "Let's go!"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
