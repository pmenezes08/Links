import type { TFunction } from 'i18next'

/** Map canonical English stored values to profile.gender.* / profile.industry.* / profile.interest.* keys. */
export function profileOptionSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/ & /g, '_')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

export function profileGenderLabel(value: string, t: TFunction): string {
  if (!value) return value
  const slug = profileOptionSlug(value)
  return t(`profile.gender.${slug}`, { defaultValue: value })
}

export function profileIndustryLabel(value: string, t: TFunction): string {
  if (!value) return value
  const slug = profileOptionSlug(value)
  return t(`profile.industry.${slug}`, { defaultValue: value })
}

export function profileInterestLabel(value: string, t: TFunction): string {
  if (!value) return value
  const slug = profileOptionSlug(value)
  return t(`profile.interest.${slug}`, { defaultValue: value })
}
