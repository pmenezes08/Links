/**
 * DM thread list and per-chat device caches are keyed by the logged-in viewer
 * so switching accounts cannot show another user's thread list or offline DM rows.
 */

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
