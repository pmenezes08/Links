import { describe, expect, it } from 'vitest'
import {
  groupMessagePollSignature,
  isConfirmedGroupMessage,
  mergePolledGroupMessages,
} from './groupPollMergeMessages'

const baseMsg = {
  id: 10,
  sender: 'alice',
  text: 'hello',
  created_at: '2026-05-26T12:00:00.000Z',
  profile_picture: null,
  image: null,
  voice: null,
}

describe('groupPollMergeMessages', () => {
  it('full sync updates reaction on existing id', () => {
    const prev = [{ ...baseMsg, reaction: null }]
    const server = [{ ...baseMsg, reaction: '👍' }]
    const next = mergePolledGroupMessages(prev, server, {
      pendingDeletions: new Set(),
      isDelta: false,
      silent: true,
    })
    expect(next[0].reaction).toBe('👍')
  })

  it('delta merge keeps stable ref when unchanged', () => {
    const prev = [{ ...baseMsg }]
    const server = [{ ...baseMsg }]
    const next = mergePolledGroupMessages(prev, server, {
      pendingDeletions: new Set(),
      isDelta: true,
      silent: true,
    })
    expect(next).toBe(prev)
  })

  it('delta merge surfaces reaction edit on existing message', () => {
    // Reactions are stored on the message row (DM parity), so a poll that
    // changes only the reaction must replace the row in the merge output.
    const prev = [{ ...baseMsg, reaction: null }]
    const server = [{ ...baseMsg, reaction: '🎉' }]
    const next = mergePolledGroupMessages(prev, server, {
      pendingDeletions: new Set(),
      isDelta: true,
      silent: true,
    })
    expect(next[0].reaction).toBe('🎉')
  })

  it('isConfirmedGroupMessage matches client_key', () => {
    expect(
      isConfirmedGroupMessage(
        { ...baseMsg, client_key: 'temp_1' },
        { ...baseMsg, id: -1, clientKey: 'temp_1', isOptimistic: true },
      ),
    ).toBe(true)
  })

  it('groupMessagePollSignature includes reaction', () => {
    const a = groupMessagePollSignature({ ...baseMsg, reaction: null })
    const b = groupMessagePollSignature({ ...baseMsg, reaction: '❤️' })
    expect(a).not.toBe(b)
  })
})
