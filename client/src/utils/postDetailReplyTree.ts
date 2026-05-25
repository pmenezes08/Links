/**
 * Post-detail reply tree normalization (display-only).
 *
 * X-style threading: user-authored replies appear as root rows on post detail;
 * nested Steve answers stay as children and drive the "N replies" count.
 */

export const STEVE_AI_USERNAME = 'steve'

export type PostDetailReply = {
  id: number
  username: string
  content: string
  timestamp: string
  parent_reply_id?: number | null
  children?: PostDetailReply[]
  reply_count?: number
  reactions?: Record<string, number>
  user_reaction?: string | null
  profile_picture?: string | null
  image_path?: string | null
  video_path?: string | null
  audio_path?: string | null
  audio_summary?: string | null
  view_count?: number
}

export type PostDetailPost = {
  id: number
  username: string
  content: string
  timestamp: string
  replies: PostDetailReply[]
  reactions?: Record<string, number>
  user_reaction?: string | null
  [key: string]: unknown
}

export function isSteveAiReply(r: Pick<PostDetailReply, 'username'>): boolean {
  return (r.username || '').toLowerCase() === STEVE_AI_USERNAME
}

function replyTimestampMs(reply: PostDetailReply): number {
  const parsed = Date.parse(String(reply.timestamp || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function withReplyCount(reply: PostDetailReply): PostDetailReply {
  const children = reply.children || []
  return {
    ...reply,
    children,
    reply_count: children.length > 0 ? children.length : reply.reply_count,
  }
}

/**
 * Walk a subtree: keep Steve nested; promote user replies to the post-detail root list.
 */
function processSubtree(reply: PostDetailReply): { node: PostDetailReply; promoted: PostDetailReply[] } {
  const promoted: PostDetailReply[] = []
  const keptChildren: PostDetailReply[] = []

  for (const child of reply.children || []) {
    const processed = processSubtree(child)
    if (isSteveAiReply(processed.node)) {
      keptChildren.push(processed.node)
    } else {
      promoted.push(processed.node)
      promoted.push(...processed.promoted)
    }
  }

  return {
    node: withReplyCount({ ...reply, children: keptChildren }),
    promoted,
  }
}

/** Normalize nested server tree into the flat root list shown on post detail. */
export function normalizeReplyTreeForDetail(
  replies: PostDetailReply[] | undefined | null,
): PostDetailReply[] {
  const roots: PostDetailReply[] = []

  for (const reply of replies || []) {
    const { node, promoted } = processSubtree(reply)
    roots.push(node, ...promoted)
  }

  return roots.sort((a, b) => {
    const delta = replyTimestampMs(a) - replyTimestampMs(b)
    if (delta !== 0) return delta
    return a.id - b.id
  })
}

export function normalizePostForDetail<T extends PostDetailPost>(rawPost: T | null | undefined): T | null {
  if (!rawPost) return null
  return {
    ...rawPost,
    replies: normalizeReplyTreeForDetail(rawPost.replies),
  }
}

/** Attach a new reply under parentId when set; otherwise prepend at root. */
export function attachReplyToPostTree(
  replies: PostDetailReply[],
  newReply: PostDetailReply,
  parentId: number | null,
): PostDetailReply[] {
  if (parentId == null) {
    return normalizeReplyTreeForDetail([newReply, ...replies])
  }

  function attach(list: PostDetailReply[]): PostDetailReply[] {
    return list.map(item => {
      if (item.id === parentId) {
        const children = item.children ? [newReply, ...item.children] : [newReply]
        return withReplyCount({ ...item, children })
      }
      if (item.children?.length) {
        return { ...item, children: attach(item.children) }
      }
      return item
    })
  }

  return normalizeReplyTreeForDetail(attach(replies))
}
