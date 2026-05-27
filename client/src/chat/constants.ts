import { Capacitor } from '@capacitor/core'

/** Match iOS keyboard / composer easing (sync with list inset smoothing). */
export const CHAT_KEYBOARD_ANIMATION_MS = 250

/** DM thread poll interval (ms). */
export const DM_POLL_INTERVAL_MS = 1500

/** Every Nth poll omits since_id for a full page sync (reactions, edits on existing rows). */
export const DM_FULL_SYNC_EVERY_N_POLL = 6

/** Group thread poll interval (ms). */
export const GROUP_POLL_INTERVAL_MS = 1500

/** Every Nth group poll omits since_id for full sync. */
export const GROUP_FULL_SYNC_EVERY_N_POLL = 6

/** Switch to Virtuoso windowing when a thread exceeds this many rows. */
export const CHAT_VIRTUAL_LIST_THRESHOLD = 80

/** Max concurrent link-preview fetches per page (protects iOS connection limits). */
export const CHAT_LINK_PREVIEW_MAX_INFLIGHT = 2

/**
 * Virtuoso windowing for long threads. Disabled on iOS Capacitor by default
 * unless VITE_CHAT_VIRTUOSO=1; set VITE_CHAT_VIRTUOSO=0 to disable everywhere.
 */
export function resolveChatVirtuosoEnabled(): boolean {
  const flag = import.meta.env.VITE_CHAT_VIRTUOSO
  if (flag === '0' || flag === 'false') return false
  if (flag === '1' || flag === 'true') return true
  if (typeof window === 'undefined') return true
  if (Capacitor.getPlatform() === 'ios') return false
  return true
}

export const CHAT_VIRTUOSO_ENABLED = resolveChatVirtuosoEnabled()

/** cubic-bezier(0.32, 0.72, 0, 1) — close ease-out for JS smoothing */
export function easeChatKeyboard(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return 1 - Math.pow(1 - x, 2.2)
}
