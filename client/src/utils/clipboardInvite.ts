/**
 * Deferred invite handoff: landing page copies `cpoint:invite:<token>` to the
 * system clipboard before the user opens the store; the app reads it on launch.
 */

export const CLIPBOARD_INVITE_PREFIX = 'cpoint:invite:'

/** Matches server-generated invite tokens (url-safe). */
const TOKEN_RE = /^[-a-zA-Z0-9_]+$/

export function parseInviteTokenFromClipboard(text: string | null | undefined): string | null {
  if (!text || typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed.startsWith(CLIPBOARD_INVITE_PREFIX)) return null
  const token = trimmed.slice(CLIPBOARD_INVITE_PREFIX.length).trim()
  if (!token || !TOKEN_RE.test(token)) return null
  return token
}

const CONSUMED_KEY = 'cpoint_consumed_clipboard_invites'

export function isClipboardInviteConsumed(token: string): boolean {
  try {
    const raw = localStorage.getItem(CONSUMED_KEY)
    if (!raw) return false
    const arr = JSON.parse(raw) as string[]
    return Array.isArray(arr) && arr.includes(token)
  } catch {
    return false
  }
}

export function markClipboardInviteConsumed(token: string): void {
  try {
    const raw = localStorage.getItem(CONSUMED_KEY)
    const arr: string[] = raw ? (JSON.parse(raw) as string[]) : []
    if (!arr.includes(token)) {
      arr.push(token)
      while (arr.length > 50) arr.shift()
      localStorage.setItem(CONSUMED_KEY, JSON.stringify(arr))
    }
  } catch {
    // ignore
  }
}
