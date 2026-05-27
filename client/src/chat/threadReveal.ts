/** Safety deadline when a thread opens with no messages yet (ms). */
export const OPEN_PIN_MAX_MS = 1200

/** iOS WKWebView needs longer open-pin lock (layout + inset + media). */
export const OPEN_PIN_IOS_MS = 2200

export function resolveOpenPinLockMs(platform: string): number {
  return platform === 'ios' ? OPEN_PIN_IOS_MS : OPEN_PIN_MAX_MS
}

/**
 * Whether the message list should become visible after scroll settle.
 * Phase A: reveal immediately once messages exist (media/link layout shifts
 * are handled by background scroll nudges, not by hiding the list).
 */
export function evaluateThreadListReveal(messageCount: number): boolean {
  return messageCount >= 0
}

/** Compare thread tails for unchanged background refresh dedupe. */
export function chatMessageTailUnchanged(
  a: { id?: unknown }[],
  b: { id?: unknown }[],
): boolean {
  if (a.length !== b.length) return false
  if (a.length === 0) return true
  return String(a[a.length - 1]?.id) === String(b[b.length - 1]?.id)
}
