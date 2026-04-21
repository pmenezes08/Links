/**
 * DM thread list and per-chat device caches are keyed by the logged-in viewer
 * so switching accounts cannot show another user's thread list or offline DM rows.
 */

/** localStorage key prefixes that must be cleared on logout and account switch (keep in sync with logout.ts). */
export const VIEWER_SCOPED_LOCAL_STORAGE_PREFIXES: readonly string[] = [
  'chat-threads-list',
  'group-chats-list',
  'chat-communities-tree',
  'chat-messages:',
  'chat-profile:',
]

export function threadsListCacheKey(viewerUsername: string): string {
  return `chat-threads-list:${viewerUsername}`
}

export function groupChatsListCacheKey(viewerUsername: string): string {
  return `group-chats-list:${viewerUsername}`
}

export function communitiesTreeCacheKey(viewerUsername: string): string {
  return `chat-communities-tree:${viewerUsername}`
}

/** IndexedDB message rows for a DM (viewer ↔ peer). */
export function dmConversationOfflineKey(viewerUsername: string, peerUsername: string): string {
  return `dm:${viewerUsername}:${peerUsername}`
}

export function dmUserIdKeyvalKey(viewerUsername: string, peerUsername: string): string {
  return `dm-user-id:${viewerUsername}:${peerUsername}`
}

export function chatMessagesDeviceCacheKey(viewerUsername: string, peerUsername: string): string {
  return `chat-messages:${viewerUsername}:${peerUsername}`
}

export function chatProfileDeviceCacheKey(viewerUsername: string, peerUsername: string): string {
  return `chat-profile:${viewerUsername}:${peerUsername}`
}
