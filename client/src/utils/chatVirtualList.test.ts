import { describe, expect, it } from 'vitest'
import { CHAT_VIRTUAL_LIST_THRESHOLD } from '../chat/constants'

describe('CHAT_VIRTUAL_LIST_THRESHOLD', () => {
  it('is a positive threshold for Virtuoso windowing', () => {
    expect(CHAT_VIRTUAL_LIST_THRESHOLD).toBeGreaterThan(50)
    expect(CHAT_VIRTUAL_LIST_THRESHOLD).toBeLessThanOrEqual(200)
  })
})
