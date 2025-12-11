/**
 * Chat utility functions
 * Handles timestamp normalization, media paths, and date formatting
 */

export type MessageMeta = { reaction?: string; replySnippet?: string }

// ===== ID-based Reaction Storage (more reliable than time-based) =====
const REACTIONS_CACHE_KEY_PREFIX = 'chat-reactions:'
const REACTIONS_CACHE_VERSION = 'v1'

type ReactionCache = {
  version: string
  reactions: Record<string, string> // messageId -> emoji
}

function getReactionsStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function getReactionsCacheKey(chatUsername: string): string {
  return `${REACTIONS_CACHE_KEY_PREFIX}${chatUsername.toLowerCase()}`
}

function loadReactionsCache(chatUsername: string): ReactionCache {
  const storage = getReactionsStorage()
  if (!storage) return { version: REACTIONS_CACHE_VERSION, reactions: {} }
  
  try {
    const raw = storage.getItem(getReactionsCacheKey(chatUsername))
    if (!raw) return { version: REACTIONS_CACHE_VERSION, reactions: {} }
    
    const parsed = JSON.parse(raw) as ReactionCache
    if (parsed.version !== REACTIONS_CACHE_VERSION) {
      return { version: REACTIONS_CACHE_VERSION, reactions: {} }
    }
    return parsed
  } catch {
    return { version: REACTIONS_CACHE_VERSION, reactions: {} }
  }
}

function saveReactionsCache(chatUsername: string, cache: ReactionCache) {
  const storage = getReactionsStorage()
  if (!storage) return
  
  try {
    storage.setItem(getReactionsCacheKey(chatUsername), JSON.stringify(cache))
  } catch {
    // Storage full or unavailable
  }
}

/**
 * Get reaction for a message by ID
 */
export function getMessageReaction(chatUsername: string, messageId: string | number): string | undefined {
  const cache = loadReactionsCache(chatUsername)
  return cache.reactions[String(messageId)]
}

/**
 * Set reaction for a message by ID
 */
export function setMessageReaction(chatUsername: string, messageId: string | number, emoji: string) {
  const cache = loadReactionsCache(chatUsername)
  cache.reactions[String(messageId)] = emoji
  saveReactionsCache(chatUsername, cache)
}

/**
 * Get all reactions for a chat (for batch loading)
 */
export function getAllMessageReactions(chatUsername: string): Record<string, string> {
  const cache = loadReactionsCache(chatUsername)
  return cache.reactions
}

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
 * Preserves original timestamp string if parsing fails (better than using current time)
 */
export function ensureNormalizedTime(raw?: string): string {
  if (!raw) return new Date().toISOString()
  
  const parsed = parseMessageTime(raw)
  if (parsed) return parsed.toISOString()
  
  const normalized = normalizeTimestamp(raw)
  if (normalized) {
    const reparsed = new Date(normalized)
    if (!isNaN(reparsed.getTime())) return reparsed.toISOString()
  }
  
  // Try additional formats that MySQL might return
  // MySQL can return: "2024-01-15 10:30:45" or "2024-01-15T10:30:45"
  const mysqlFormats = [
    raw.replace(' ', 'T') + 'Z',  // "2024-01-15 10:30:45" -> "2024-01-15T10:30:45Z"
    raw + 'Z',                      // Add Z suffix
    raw.replace(' ', 'T'),          // Just replace space with T
  ]
  
  for (const fmt of mysqlFormats) {
    try {
      const d = new Date(fmt)
      if (!isNaN(d.getTime())) return d.toISOString()
    } catch {
      continue
    }
  }
  
  // Last resort: return original string so at least we can display something
  // rather than showing current time for all messages
  console.warn('Failed to parse timestamp:', raw)
  return raw
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
