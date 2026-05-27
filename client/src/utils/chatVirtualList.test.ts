import { describe, expect, it } from 'vitest'
import { CHAT_VIRTUAL_LIST_THRESHOLD, CHAT_VIRTUOSO_ENABLED, resolveChatVirtuosoEnabled } from '../chat/constants'

describe('CHAT_VIRTUAL_LIST_THRESHOLD', () => {
  it('is a positive threshold for Virtuoso windowing', () => {
    expect(CHAT_VIRTUAL_LIST_THRESHOLD).toBeGreaterThan(50)
    expect(CHAT_VIRTUAL_LIST_THRESHOLD).toBeLessThanOrEqual(200)
  })
})

describe('CHAT_VIRTUOSO_ENABLED', () => {
  it('resolveChatVirtuosoEnabled returns a boolean', () => {
    expect(typeof resolveChatVirtuosoEnabled()).toBe('boolean')
    expect(typeof CHAT_VIRTUOSO_ENABLED).toBe('boolean')
  })
})
