/** Compare thread tails for unchanged background refresh dedupe. */
export function chatMessageTailUnchanged(
  a: { id?: unknown }[],
  b: { id?: unknown }[],
): boolean {
  if (a.length !== b.length) return false
  if (a.length === 0) return true
  return String(a[a.length - 1]?.id) === String(b[b.length - 1]?.id)
}
