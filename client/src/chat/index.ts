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

export {
  readStaleDeviceCache,
  markThreadCachePainted,
  isCachePaintedForGen,
  isUnchangedFromCacheSnapshot,
  hydrateThreadFromIndexedDb,
  snapshotFromMessages,
  type ThreadCacheSnapshot,
} from './threadDeviceCache'

// Components
export { default as AudioMessage } from './AudioMessage'
export { default as LongPressActionable } from './LongPressActionable'
export { default as ChatHeader } from './ChatHeader'
export { default as ChatThreadSearch } from './ChatThreadSearch'
export { default as MessageBubble } from './MessageBubble'
export type { MessageBubbleProps } from './MessageBubble'

// Hooks
export {
  useIsMobile,
  useTouchDismiss,
  useChatThreadScroll,
} from './hooks'
export type { ChatThreadScrollMessage } from './hooks'
export { useChatThreadChrome } from './useChatThreadChrome'
export type { UseChatThreadChromeOptions } from './useChatThreadChrome'
export { useChatComposerChrome, CHAT_COMPOSER_GAP_PX } from './useChatComposerChrome'
export type {
  UseChatComposerChromeOptions,
  ChatComposerSurfaceKey,
} from './useChatComposerChrome'
export { useChatListScrollHandlers } from './useChatListScrollHandlers'
export type { UseChatListScrollHandlersOptions } from './useChatListScrollHandlers'
export { useSmoothedPx } from './useSmoothedPx'
export { useResumeOutboxDrain } from './useResumeOutboxDrain'
export { ChatSelectionBar } from './ChatSelectionBar'
export type { ChatSelectionBarProps } from './ChatSelectionBar'
export { NewMessagesChip } from './NewMessagesChip'
export type { NewMessagesChipProps } from './NewMessagesChip'
export { SwipeToReply } from './SwipeToReply'
export type { SwipeToReplyProps } from './SwipeToReply'
export { CHAT_KEYBOARD_ANIMATION_MS, easeChatKeyboard, DM_POLL_INTERVAL_MS, DM_FULL_SYNC_EVERY_N_POLL, GROUP_POLL_INTERVAL_MS, GROUP_FULL_SYNC_EVERY_N_POLL, CHAT_VIRTUOSO_ENABLED, CHAT_LINK_PREVIEW_MAX_INFLIGHT } from './constants'
export { useDmMessagePoll } from './useDmMessagePoll'
export type { UseDmMessagePollOptions } from './useDmMessagePoll'
export { useGroupMessagePoll } from './useGroupMessagePoll'
export type { UseGroupMessagePollOptions } from './useGroupMessagePoll'
export {
  DEFAULT_NEAR_BOTTOM_PX,
  LOAD_OLDER_TRIGGER_PX,
  isInvertedAtBottom,
  pinInvertedToBottom,
  smoothPinInvertedToBottom,
  distanceFromInvertedBottom,
  distanceFromInvertedTop,
} from './scrollPin'

// Media senders (already existed)
export { sendImageMessage, sendVideoMessage } from './mediaSenders'
export { chatHapticSend, chatHapticAttachToggle, chatHapticComposerTap, chatHapticMenuOpen, chatHapticReaction } from './chatHaptics'
export { ChatAttachMenuRow } from './ChatAttachMenuRow'
export { ChatMediaPreviewModal } from './ChatMediaPreviewModal'
export type { ChatMediaPreviewModalProps, PendingMediaItem } from './ChatMediaPreviewModal'
export { ChatMediaViewerModal } from './ChatMediaViewerModal'
export type { ChatMediaViewerModalProps, ChatMediaViewerState } from './ChatMediaViewerModal'
export { useChatDraft } from './useChatDraft'
export type { UseChatDraftOptions } from './useChatDraft'
export { ChatThreadShell } from './ChatThreadShell'
export type { ChatThreadShellProps } from './ChatThreadShell'
export { ChatComposerPortal, ChatComposerCard } from './ChatComposer'
export type { ChatComposerPortalProps, ChatComposerCardProps } from './ChatComposer'
export { ChatVirtualMessageList } from './ChatVirtualMessageList'
export type { ChatVirtualMessageListProps } from './ChatVirtualMessageList'
export { CHAT_VIRTUAL_LIST_THRESHOLD } from './constants'
