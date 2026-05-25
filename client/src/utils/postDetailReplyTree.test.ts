import { describe, expect, it } from 'vitest'
import {
  attachReplyToPostTree,
  isSteveAiReply,
  normalizeReplyTreeForDetail,
  type PostDetailReply,
} from './postDetailReplyTree'

function reply(partial: Partial<PostDetailReply> & Pick<PostDetailReply, 'id' | 'username' | 'content' | 'timestamp'>): PostDetailReply {
  return {
    reactions: {},
    user_reaction: null,
    ...partial,
  }
}

describe('postDetailReplyTree', () => {
  it('isSteveAiReply is case-insensitive', () => {
    expect(isSteveAiReply({ username: 'steve' })).toBe(true)
    expect(isSteveAiReply({ username: 'Steve' })).toBe(true)
    expect(isSteveAiReply({ username: 'paulo' })).toBe(false)
  })

  it('promotes user nested under Steve; keeps Steve answer under user', () => {
    const steve2 = reply({
      id: 3,
      username: 'steve',
      content: 'Market data…',
      timestamp: '2026-05-25T12:00:03Z',
      parent_reply_id: 2,
    })
    const user1 = reply({
      id: 2,
      username: 'paulo',
      content: 'Can you add market data?',
      timestamp: '2026-05-25T12:00:02Z',
      parent_reply_id: 1,
      children: [steve2],
    })
    const steve1 = reply({
      id: 1,
      username: 'steve',
      content: 'Here is a structure…',
      timestamp: '2026-05-25T12:00:01Z',
      parent_reply_id: null,
      children: [user1],
    })

    const roots = normalizeReplyTreeForDetail([steve1])

    expect(roots.map(r => r.id)).toEqual([1, 2])
    expect(roots[0].children).toEqual([])
    expect(roots[1].children?.map(c => c.id)).toEqual([3])
    expect(roots.some(r => r.id === 3)).toBe(false)
  })

  it('keeps user-to-post as a single root without promotion side effects', () => {
    const userRoot = reply({
      id: 10,
      username: 'paulo',
      content: 'Top-level question',
      timestamp: '2026-05-25T10:00:00Z',
      parent_reply_id: null,
    })

    const roots = normalizeReplyTreeForDetail([userRoot])
    expect(roots).toHaveLength(1)
    expect(roots[0].id).toBe(10)
    expect(roots[0].children).toEqual([])
  })

  it('keeps legacy server root Steve even when parent_reply_id is set', () => {
    const steveRoot = reply({
      id: 5,
      username: 'steve',
      content: 'Answer',
      timestamp: '2026-05-25T11:00:00Z',
      parent_reply_id: 999,
    })

    const roots = normalizeReplyTreeForDetail([steveRoot])
    expect(roots).toHaveLength(1)
    expect(roots[0].id).toBe(5)
  })

  it('sorts display roots by timestamp ascending', () => {
    const earlySteve = reply({
      id: 1,
      username: 'steve',
      content: 'First',
      timestamp: '2026-05-25T09:00:00Z',
      children: [],
    })
    const lateUser = reply({
      id: 2,
      username: 'paulo',
      content: 'Follow-up',
      timestamp: '2026-05-25T10:00:00Z',
      parent_reply_id: 1,
    })
    earlySteve.children = [lateUser]

    const roots = normalizeReplyTreeForDetail([earlySteve])
    expect(roots.map(r => r.id)).toEqual([1, 2])
  })

  it('attachReplyToPostTree nests Steve under user parent then normalizes', () => {
    const userRow = reply({
      id: 2,
      username: 'paulo',
      content: 'Question',
      timestamp: '2026-05-25T12:00:02Z',
    })
    const steveReply = reply({
      id: 3,
      username: 'steve',
      content: 'Answer',
      timestamp: '2026-05-25T12:00:03Z',
      parent_reply_id: 2,
    })

    const next = attachReplyToPostTree([userRow], steveReply, 2)
    expect(next.map(r => r.id)).toEqual([2])
    expect(next[0].children?.map(c => c.id)).toEqual([3])
    expect(next[0].reply_count).toBe(1)
  })
})
