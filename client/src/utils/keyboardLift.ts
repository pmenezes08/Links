/** Ignore tiny viewport / plugin jitter below this height (px). */
export const KEYBOARD_LIFT_THRESHOLD = 2

/** Lift amount for fixed composers; safe-area inset applies only when keyboard is closed. */
export function computeKeyboardLift(liftSource: number): number {
  return liftSource > KEYBOARD_LIFT_THRESHOLD ? liftSource : 0
}

export function readCssPxVar(name: string): number {
  if (typeof document === 'undefined') return 0
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return parseFloat(raw) || 0
}

/** Distance from layout viewport bottom to visual viewport bottom (IME height on Android). */
export function readVisualViewportImeInset(threshold = 48): number {
  if (typeof window === 'undefined') return 0
  const viewport = window.visualViewport
  if (!viewport) return 0
  const inset = Math.max(0, window.innerHeight - viewport.offsetTop - viewport.height)
  return inset < threshold ? 0 : inset
}
