const DOB_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function parseDobIso(dobIso: string): Date | null {
  if (!DOB_ISO_PATTERN.test(dobIso)) return null
  const [year, month, day] = dobIso.split('-').map(Number)
  const parsed = new Date(year, month - 1, day)
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null
  }
  return parsed
}

export function isValidDobIso(dobIso: string): boolean {
  return parseDobIso(dobIso) !== null
}

/** Latest selectable DOB for the native date picker (18th birthday on or before today). */
export function maxDobForPicker(now: Date = new Date()): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const cutoff = new Date(today)
  cutoff.setFullYear(cutoff.getFullYear() - 18)
  const year = cutoff.getFullYear()
  const month = String(cutoff.getMonth() + 1).padStart(2, '0')
  const day = String(cutoff.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** User must be at least 18 full years old in the local timezone. */
export function isAtLeast18(dobIso: string, now: Date = new Date()): boolean {
  const parsed = parseDobIso(dobIso)
  if (!parsed) return false
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const cutoff = new Date(today)
  cutoff.setFullYear(cutoff.getFullYear() - 18)
  return parsed <= cutoff
}
