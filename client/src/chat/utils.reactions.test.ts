import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAllMessageReactions, getMessageReaction, setMessageReaction } from './utils'

/**
 * Privacy: the per-message reaction cache must be keyed by the logged-in viewer
 * (current_username), not just the peer, so one account's reactions never paint
 * for a different account on the same device after logout / account switch.
 */
describe('chat reaction cache viewer-scoping', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('keys reactions by the current viewer so they do not leak across accounts', () => {
    localStorage.setItem('current_username', 'alice')
    setMessageReaction('bob', '42', '👍')

    // Stored under the viewer-scoped key, not the bare peer-only key.
    expect(localStorage.getItem('chat-reactions:alice:bob')).not.toBeNull()
    expect(localStorage.getItem('chat-reactions:bob')).toBeNull()
    expect(getMessageReaction('bob', '42')).toBe('👍')

    // A different account on the same device sees none of alice's reactions.
    localStorage.setItem('current_username', 'carol')
    expect(getMessageReaction('bob', '42')).toBeUndefined()
    expect(getAllMessageReactions('bob')).toEqual({})
  })
})
