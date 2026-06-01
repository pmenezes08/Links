/** Typographic separators as JS escapes — survives editor/encoding churn. */
export const EM_DASH = '\u2014'
export const MIDDLE_DOT = '\u00B7'
export const BULLET = '\u2022'
export const ELLIPSIS = '\u2026'

export const SEP_EM_DASH = ` ${EM_DASH} `
export const SEP_MIDDLE_DOT = ` ${MIDDLE_DOT} `

/** Join two date labels with an em dash (e.g. "Sep 2023 — Nov 2024"). */
export function formatDateRange(left: string, right: string): string {
  if (!left) return right
  if (!right) return left
  return `${left}${SEP_EM_DASH}${right}`
}
