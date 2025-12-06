/**
 * Chat module exports
 * 
 * Usage:
 *   import { normalizeMediaPath, formatMessageTime, AudioMessage } from '../chat'
 */

// Utilities
export {
  normalizeTimestamp,
  normalizeMediaPath,
  parseMessageTime,
  ensureNormalizedTime,
  getMessageTimestamp,
  buildMetaKeys,
  readMessageMeta,
  writeMessageMeta,
  formatDateLabel,
  getDateKey,
  formatMessageTime,
  formatDuration,
  CHAT_CACHE_TTL_MS,
  CHAT_CACHE_VERSION,
  type MessageMeta,
} from './utils'

// Components
export { default as AudioMessage } from './AudioMessage'
export { default as LongPressActionable } from './LongPressActionable'
export { default as ChatHeader } from './ChatHeader'

// Hooks
export {
  useKeyboardLayout,
  useIsMobile,
  useScrollToBottom,
  useTouchDismiss,
} from './hooks'

// Media senders (already existed)
export { sendImageMessage, sendVideoMessage } from './mediaSenders'
