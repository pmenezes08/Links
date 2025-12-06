/**
 * Chat utility functions
 * Handles timestamp normalization, media paths, and date formatting
 */

export type MessageMeta = { reaction?: string; replySnippet?: string }

/**
 * Normalize timestamp to ISO format with timezone
 */
export function normalizeTimestamp(raw?: string): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const hasOffset = /([+-]\d{2}:\d{2}|Z)$/i.test(trimmed)
  if (trimmed.includes('T')) {
    return hasOffset ? trimmed : `${trimmed}Z`
  }
  return `${trimmed.replace(' ', 'T')}Z`
}

/**
 * Normalize media paths - handles CDN URLs, blob URLs, and local paths
 */
export function normalizeMediaPath(path?: string | null): string {
  if (!path) return ''
  // Already a full URL (CDN or blob)
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('blob:')) {
    return path
  }
  // Already has /uploads/ prefix
  if (path.startsWith('/uploads/') || path.startsWith('/static/')) {
    return path
  }
  // Add /uploads/ prefix for relative paths
  return `/uploads/${path}`
}

/**
 * Parse message timestamp to Date object
 */
export function parseMessageTime(raw?: string): Date | null {
  const normalized = normalizeTimestamp(raw)
  if (!normalized) return null
  const parsed = new Date(normalized)
  return isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Ensure a timestamp is normalized to ISO format
 */
export function ensureNormalizedTime(raw?: string): string {
  const parsed = parseMessageTime(raw)
  if (parsed) return parsed.toISOString()
  if (raw) {
    const normalized = normalizeTimestamp(raw)
    if (normalized) {
      const reparsed = new Date(normalized)
      if (!isNaN(reparsed.getTime())) return reparsed.toISOString()
    }
  }
  return new Date().toISOString()
}

/**
 * Get timestamp in milliseconds from message time string
 */
export function getMessageTimestamp(raw?: string): number | null {
  const parsed = parseMessageTime(raw)
  return parsed ? parsed.getTime() : null
}

/**
 * Build unique keys for message metadata storage
 */
export function buildMetaKeys(time: string | undefined, messageText: string, sent: boolean) {
  const suffix = `|${messageText}|${sent ? 'me' : 'other'}`
  const normalized = parseMessageTime(time)?.toISOString()
  return {
    normalizedKey: normalized ? `${normalized}${suffix}` : null,
    legacyKey: time ? `${time}${suffix}` : null,
  }
}

/**
 * Read message metadata from storage
 */
export function readMessageMeta(
  store: Record<string, MessageMeta>,
  time: string | undefined,
  messageText: string,
  sent: boolean
): MessageMeta {
  const { normalizedKey, legacyKey } = buildMetaKeys(time, messageText, sent)
  return (normalizedKey && store[normalizedKey]) || (legacyKey && store[legacyKey]) || {}
}

/**
 * Write message metadata to storage
 */
export function writeMessageMeta(
  store: Record<string, MessageMeta>,
  time: string | undefined,
  messageText: string,
  sent: boolean,
  updates: MessageMeta
) {
  const { normalizedKey, legacyKey } = buildMetaKeys(time, messageText, sent)
  if (normalizedKey) {
    store[normalizedKey] = { ...(store[normalizedKey] || {}), ...updates }
  }
  if (legacyKey && legacyKey !== normalizedKey) {
    store[legacyKey] = { ...(store[legacyKey] || {}), ...updates }
  }
}

/**
 * Format date label for message grouping (Today, Yesterday, weekday, or full date)
 */
export function formatDateLabel(dateStr: string): string {
  const messageDate = parseMessageTime(dateStr)
  if (!messageDate) return ''
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const msgDateOnly = new Date(messageDate.getFullYear(), messageDate.getMonth(), messageDate.getDate())
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const yesterdayOnly = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate())

  if (msgDateOnly.getTime() === todayOnly.getTime()) {
    return 'Today'
  } else if (msgDateOnly.getTime() === yesterdayOnly.getTime()) {
    return 'Yesterday'
  } else {
    const daysDiff = Math.floor((todayOnly.getTime() - msgDateOnly.getTime()) / (1000 * 60 * 60 * 24))
    if (daysDiff <= 6) {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      return days[messageDate.getDay()]
    } else {
      return messageDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
  }
}

/**
 * Get date key for grouping messages by day
 */
export function getDateKey(dateStr: string): string {
  const parsed = parseMessageTime(dateStr)
  return parsed ? parsed.toDateString() : dateStr
}

/**
 * Format message time for display (HH:MM)
 */
export function formatMessageTime(dateStr: string): string {
  const parsed = parseMessageTime(dateStr)
  if (!parsed) return ''
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Format audio duration as MM:SS
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${String(secs).padStart(2, '0')}`
}

// Cache settings for chat messages
export const CHAT_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes (matches server Redis TTL)
export const CHAT_CACHE_VERSION = 'chat-v1'
