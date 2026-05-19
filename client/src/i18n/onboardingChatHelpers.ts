import type { TFunction } from 'i18next'

export type OnboardingChatTierCode = 'free' | 'paid_l1' | 'paid_l2' | 'paid_l3' | 'enterprise'

export type CommunityTierHint = {
  label: string
  min_members?: number | null
  max_members?: number | null
  price_eur_monthly?: number | string | null
  pricing?: string | null
}

export type OnboardingTierHints = {
  community_tiers?: Partial<Record<OnboardingChatTierCode, CommunityTierHint>>
}

const DEFAULT_TIER_HINTS: Record<OnboardingChatTierCode, CommunityTierHint> = {
  free: { label: 'Free Community', max_members: 25 },
  paid_l1: { label: 'Paid L1', min_members: 26, max_members: 75, price_eur_monthly: 25 },
  paid_l2: { label: 'Paid L2', min_members: 76, max_members: 150, price_eur_monthly: 50 },
  paid_l3: { label: 'Paid L3', min_members: 151, max_members: 250, price_eur_monthly: 80 },
  enterprise: { label: 'Enterprise', min_members: 251, pricing: 'custom' },
}

const B2B_SIZE_TO_TIER: Record<string, OnboardingChatTierCode> = {
  b2b_size_free: 'free',
  b2b_size_paid_l1: 'paid_l1',
  b2b_size_paid_l2: 'paid_l2',
  b2b_size_paid_l3: 'paid_l3',
  b2b_size_enterprise: 'enterprise',
}

export function oc(t: TFunction, key: string, opts?: Record<string, unknown>): string {
  return String(t(`onboarding_chat.${key}`, opts as never))
}

export function ocOpt(t: TFunction, key: string, value: string, icon?: string) {
  return { label: oc(t, `options.${key}`), value, icon }
}

export function tierHintsFromState(hints?: OnboardingTierHints | null): Record<OnboardingChatTierCode, CommunityTierHint> {
  const base = { ...DEFAULT_TIER_HINTS, ...(hints?.community_tiers || {}) }
  return base as Record<OnboardingChatTierCode, CommunityTierHint>
}

export function localizedTierLabel(t: TFunction, code: OnboardingChatTierCode): string {
  return oc(t, `tiers.${code}`)
}

export function formatCurrencyEur(t: TFunction, value: number | string | null | undefined): string {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return oc(t, 'tiers.published_price')
  return `€${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}/month`
}

export function b2bNetworkSizeOptions(
  t: TFunction,
  hints?: OnboardingTierHints | null,
): { label: string; value: string }[] {
  const tiers = tierHintsFromState(hints)
  return [
    {
      label: oc(t, 'tiers.size_free', { max: tiers.free.max_members }),
      value: 'b2b_size_free',
    },
    {
      label: oc(t, 'tiers.size_range', { min: tiers.paid_l1.min_members, max: tiers.paid_l1.max_members }),
      value: 'b2b_size_paid_l1',
    },
    {
      label: oc(t, 'tiers.size_range', { min: tiers.paid_l2.min_members, max: tiers.paid_l2.max_members }),
      value: 'b2b_size_paid_l2',
    },
    {
      label: oc(t, 'tiers.size_range', { min: tiers.paid_l3.min_members, max: tiers.paid_l3.max_members }),
      value: 'b2b_size_paid_l3',
    },
    {
      label: oc(t, 'tiers.size_enterprise', { min: tiers.enterprise.min_members }),
      value: 'b2b_size_enterprise',
    },
  ]
}

export function b2bNetworkSizeLabel(t: TFunction, value: string, hints?: OnboardingTierHints | null): string {
  return b2bNetworkSizeOptions(t, hints).find(option => option.value === value)?.label || oc(t, 'tiers.org_network_fallback')
}

export function b2bTierGuidanceText(t: TFunction, value: string | undefined, hints?: OnboardingTierHints | null): string {
  const tierCode = B2B_SIZE_TO_TIER[value || ''] || 'free'
  const tiers = tierHintsFromState(hints)
  const freeCap = tiers.free.max_members || 25
  const tier = tiers[tierCode]
  const tierLabel = localizedTierLabel(t, tierCode)
  if (tierCode === 'free') {
    return oc(t, 'tiers.guidance_free', { max: freeCap })
  }
  if (tierCode === 'enterprise') {
    return oc(t, 'tiers.guidance_enterprise', { max: freeCap })
  }
  return oc(t, 'tiers.guidance_paid', {
    tier: tierLabel,
    max: tier.max_members,
    maxFree: freeCap,
    price: formatCurrencyEur(t, tier.price_eur_monthly),
  })
}

export function isEnterpriseSize(value: string | undefined): boolean {
  return B2B_SIZE_TO_TIER[value || ''] === 'enterprise'
}

export function getTourSteps(t: TFunction) {
  return [
    { icon: 'fa-solid fa-house', title: oc(t, 'tour.dashboard_title'), description: oc(t, 'tour.dashboard_desc') },
    { icon: 'fa-solid fa-user', title: oc(t, 'tour.profile_title'), description: oc(t, 'tour.profile_desc') },
    { icon: 'fa-solid fa-users', title: oc(t, 'tour.followers_title'), description: oc(t, 'tour.followers_desc') },
    { icon: 'fa-solid fa-network-wired', title: oc(t, 'tour.networking_title'), description: oc(t, 'tour.networking_desc') },
    { icon: 'fa-solid fa-cog', title: oc(t, 'tour.settings_title'), description: oc(t, 'tour.settings_desc') },
  ]
}

export function getPersonalSectionSteps(t: TFunction): string[] {
  return t('onboarding_chat.section_steps.personal', { returnObjects: true }) as string[]
}

export function getProfessionalSectionSteps(t: TFunction): string[] {
  return t('onboarding_chat.section_steps.professional', { returnObjects: true }) as string[]
}

export function pbFieldLabel(t: TFunction, field: 'city' | 'country' | 'role' | 'company'): string {
  return oc(t, `pb_fields.${field}`)
}

export function validateLinkedInProfileUrl(
  t: TFunction,
  raw: string,
): { ok: boolean; url?: string; error?: string } {
  const value = raw.trim()
  if (!value) return { ok: false, error: oc(t, 'validation.linkedin_empty') }
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const path = url.pathname.toLowerCase()
    if (host !== 'linkedin.com') {
      return { ok: false, error: oc(t, 'validation.linkedin_host') }
    }
    if (!path.startsWith('/in/') || path.split('/').filter(Boolean).length < 2) {
      return { ok: false, error: oc(t, 'validation.linkedin_personal') }
    }
    if (['/company/', '/school/', '/jobs/', '/posts/', '/feed/', '/pulse/'].some(blocked => path.startsWith(blocked))) {
      return { ok: false, error: oc(t, 'validation.linkedin_not_personal') }
    }
    return { ok: true, url: url.toString() }
  } catch {
    return { ok: false, error: oc(t, 'validation.linkedin_invalid') }
  }
}

type SummaryCollected = {
  firstName?: string
  lastName?: string
  city?: string
  country?: string
  role?: string
  company?: string
  bio?: string
  professionalBio?: string
  linkedin?: string
}

export function profileSummaryBlock(t: TFunction, c: SummaryCollected): string {
  const lines: string[] = []
  const name = `${c.firstName || ''} ${c.lastName || ''}`.trim()
  if (name) lines.push(oc(t, 'summary.name', { value: name }))
  if (c.city?.trim()) lines.push(oc(t, 'summary.city', { value: c.city.trim() }))
  if (c.country?.trim()) lines.push(oc(t, 'summary.country', { value: c.country.trim() }))
  if (c.role?.trim()) lines.push(oc(t, 'summary.role', { value: c.role.trim() }))
  if (c.company?.trim()) lines.push(oc(t, 'summary.company', { value: c.company.trim() }))
  if (c.bio?.trim()) {
    const text = c.bio.trim()
    lines.push(oc(t, 'summary.personal_bio', { value: text.length > 220 ? `${text.slice(0, 217)}…` : text }))
  }
  if (c.professionalBio?.trim()) {
    const text = c.professionalBio.trim()
    lines.push(oc(t, 'summary.professional_bio', { value: text.length > 220 ? `${text.slice(0, 217)}…` : text }))
  }
  if (c.linkedin?.trim()) lines.push(oc(t, 'summary.linkedin_added'))
  if (lines.length === 0) return oc(t, 'summary.empty')
  return lines.join('\n')
}

export function onboardingGreeting(t: TFunction, firstName?: string): string {
  return firstName?.trim()
    ? oc(t, 'messages.greeting_named', { name: firstName.trim() })
    : oc(t, 'messages.greeting_generic')
}

export function reactionMessage(t: TFunction): string {
  const keys = ['messages.reaction_1', 'messages.reaction_2', 'messages.reaction_3', 'messages.reaction_4'] as const
  const key = keys[Math.floor(Math.random() * keys.length)]
  return oc(t, key)
}
