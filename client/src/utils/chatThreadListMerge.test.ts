import { describe, expect, it } from 'vitest'
import { mergeGroupChatLists, mergeThreadLists } from './chatThreadListMerge'

const baseThread = {
  other_username: 'alice',
  display_name: 'Alice',
  profile_picture_url: 'https://cdn.example/a.jpg',
  last_message_text: 'Hi',
  last_activity_time: '2026-05-26T10:00:00Z',
  unread_count: 0,
  muted: false,
}

describe('mergeThreadLists', () => {
  it('returns same reference when signatures and order match', () => {
    const prev = [baseThread]
    const next = [{ ...baseThread }]
    expect(mergeThreadLists(prev, next)).toBe(prev)
  })

  it('returns new array when preview changes', () => {
    const prev = [baseThread]
    const next = [{ ...baseThread, last_message_text: 'Updated' }]
    const merged = mergeThreadLists(prev, next)
    expect(merged).not.toBe(prev)
    expect(merged[0].last_message_text).toBe('Updated')
  })

  it('returns new array when order changes', () => {
    const bob = { ...baseThread, other_username: 'bob', display_name: 'Bob' }
    const prev = [baseThread, bob]
    const next = [bob, baseThread]
    expect(mergeThreadLists(prev, next)).not.toBe(prev)
  })

  it('preserves unchanged row object refs when another row updates', () => {
    const bob = { ...baseThread, other_username: 'bob', display_name: 'Bob' }
    const prev = [baseThread, bob]
    const next = [baseThread, { ...bob, unread_count: 2 }]
    const merged = mergeThreadLists(prev, next)
    expect(merged[0]).toBe(prev[0])
    expect(merged[1]).not.toBe(prev[1])
    expect(merged[1].unread_count).toBe(2)
  })
})

describe('mergeGroupChatLists', () => {
  const baseGroup = {
    id: 1,
    name: 'Team',
    member_count: 3,
    creator: 'alice',
    last_message: { sender: 'alice', text: 'Hey', time: '2026-05-26T10:00:00Z' },
    unread_count: 0,
    muted: false,
  }

  it('returns same reference when unchanged', () => {
    const prev = [baseGroup]
    expect(mergeGroupChatLists(prev, [{ ...baseGroup }])).toBe(prev)
  })

  it('detects unread change', () => {
    const prev = [baseGroup]
    const merged = mergeGroupChatLists(prev, [{ ...baseGroup, unread_count: 1 }])
    expect(merged).not.toBe(prev)
  })
})
