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
  resolveDocUrl,
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
  getMessageReaction,
  setMessageReaction,
  getAllMessageReactions,
  CHAT_CACHE_TTL_MS,
  CHAT_CACHE_VERSION,
  type MessageMeta,
} from './utils'

// Components
export { default as AudioMessage } from './AudioMessage'
export { default as LongPressActionable } from './LongPressActionable'
export { default as ChatHeader } from './ChatHeader'
export { default as MessageBubble } from './MessageBubble'
export type { MessageBubbleProps } from './MessageBubble'

// Hooks
export {
  useKeyboardLayout,
  useIsMobile,
  useTouchDismiss,
  useChatThreadScroll,
} from './hooks'
export type { ChatThreadScrollMessage } from './hooks'
export { useChatComposerChrome, CHAT_COMPOSER_GAP_PX } from './useChatComposerChrome'
export type { UseChatComposerChromeOptions } from './useChatComposerChrome'
export { useChatListScrollHandlers } from './useChatListScrollHandlers'
export type { UseChatListScrollHandlersOptions } from './useChatListScrollHandlers'
export { useSmoothedPx } from './useSmoothedPx'
export { CHAT_KEYBOARD_ANIMATION_MS, easeChatKeyboard, DM_POLL_INTERVAL_MS, DM_FULL_SYNC_EVERY_N_POLL } from './constants'
export { useDmMessagePoll } from './useDmMessagePoll'
export type { UseDmMessagePollOptions } from './useDmMessagePoll'
export {
  DEFAULT_NEAR_BOTTOM_PX,
  isNearBottom,
  scrollElementToBottom,
  shouldShowScrollDownAfterOpen,
  maxScrollTop,
} from './scrollPin'

// Media senders (already existed)
export { sendImageMessage, sendVideoMessage } from './mediaSenders'
export { chatHapticSend, chatHapticAttachToggle, chatHapticComposerTap } from './chatHaptics'
export { ChatAttachMenuRow } from './ChatAttachMenuRow'
