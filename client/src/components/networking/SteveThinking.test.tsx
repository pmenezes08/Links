import { describe, expect, it } from 'vitest'
import { getSteveThinkingLabel } from './SteveThinking'
import {
  STEVE_THINKING_SEARCHING_MS,
  STEVE_THINKING_NARROWING_MS,
  STEVE_THINKING_LONG_MS,
} from '../../design/motion'

const t = (key: string) => key

describe('SteveThinking', () => {
  it('advances copy as elapsed time increases and never regresses', () => {
    expect(getSteveThinkingLabel(0, t)).toBe('networking.steve_thinking')
    expect(getSteveThinkingLabel(STEVE_THINKING_SEARCHING_MS - 1, t)).toBe('networking.steve_thinking')
    expect(getSteveThinkingLabel(STEVE_THINKING_SEARCHING_MS, t)).toBe('networking.steve_status_searching')
    expect(getSteveThinkingLabel(STEVE_THINKING_NARROWING_MS, t)).toBe('networking.steve_status_narrowing')
    expect(getSteveThinkingLabel(STEVE_THINKING_LONG_MS, t)).toBe('networking.steve_status_long')
    // The last line persists for arbitrarily long waits.
    expect(getSteveThinkingLabel(STEVE_THINKING_LONG_MS * 10, t)).toBe('networking.steve_status_long')
  })
})
