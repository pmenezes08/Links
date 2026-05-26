/** Match iOS keyboard / composer easing (sync with list inset smoothing). */
export const CHAT_KEYBOARD_ANIMATION_MS = 250

/** cubic-bezier(0.32, 0.72, 0, 1) — close ease-out for JS smoothing */
export function easeChatKeyboard(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return 1 - Math.pow(1 - x, 2.2)
}
