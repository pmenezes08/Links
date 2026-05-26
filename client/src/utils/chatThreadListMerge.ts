/**
 * Stable merge for DM / group inbox poll updates.
 * Returns the previous array reference when row UI signatures and order are unchanged.
 */

export interface DmThreadRowLike {
  other_username: string
  display_name: string
  profile_picture_url: string | null
  last_message_text: string | null
  last_activity_time: string | null
  last_sender?: string | null
  unread_count?: number
  is_archived?: boolean
  muted?: boolean
}

export interface GroupChatRowLike {
  id: number
  name: string
  member_count: number
  creator: string
  last_message: { sender: string; text: string; time: string } | null
  unread_count: number
  muted?: boolean
}

export function dmThreadRowSignature(t: DmThreadRowLike): string {
  return [
    t.other_username,
    t.display_name,
    t.profile_picture_url ?? '',
    t.last_message_text ?? '',
    t.last_activity_time ?? '',
    t.last_sender ?? '',
    t.unread_count ?? 0,
    t.is_archived ? 1 : 0,
    t.muted ? 1 : 0,
  ].join('\u001f')
}

export function groupChatRowSignature(g: GroupChatRowLike): string {
  const lm = g.last_message
  return [
    g.id,
    g.name,
    g.member_count,
    g.creator,
    lm?.sender ?? '',
    lm?.text ?? '',
    lm?.time ?? '',
    g.unread_count,
    g.muted ? 1 : 0,
  ].join('\u001f')
}

function mergeBySignature<T>(
  prev: T[],
  next: T[],
  signature: (row: T) => string,
  key: (row: T) => string | number,
): T[] {
  if (prev.length !== next.length) {
    return next
  }
  const prevByKey = new Map<string | number, T>()
  for (const row of prev) {
    prevByKey.set(key(row), row)
  }
  const merged: T[] = []
  for (let i = 0; i < next.length; i++) {
    const row = next[i]
    if (signature(prev[i]) !== signature(row)) {
      return next
    }
    const existing = prevByKey.get(key(row))
    merged.push(existing && signature(existing) === signature(row) ? existing : row)
  }
  if (merged.every((row, i) => row === prev[i])) {
    return prev
  }
  return merged
}

export function mergeThreadLists<T extends DmThreadRowLike>(prev: T[], next: T[]): T[] {
  return mergeBySignature(prev, next, dmThreadRowSignature, t => t.other_username)
}

export function mergeGroupChatLists<T extends GroupChatRowLike>(prev: T[], next: T[]): T[] {
  return mergeBySignature(prev, next, groupChatRowSignature, g => g.id)
}
