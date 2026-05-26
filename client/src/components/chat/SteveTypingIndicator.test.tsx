import { describe, expect, it } from 'vitest'
import { getSteveTypingPhaseLabel, PHASE_LONGER_MS, PHASE_STILL_MS, PHASE_UNUSUAL_MS } from './SteveTypingIndicator'

const t = (key: string) => key

describe('SteveTypingIndicator', () => {
  it('escalates copy as elapsed time increases', () => {
    expect(getSteveTypingPhaseLabel(0, t)).toBe('chat.steve_typing')
    expect(getSteveTypingPhaseLabel(PHASE_STILL_MS, t)).toBe('chat.steve_typing_still')
    expect(getSteveTypingPhaseLabel(PHASE_LONGER_MS, t)).toBe('chat.steve_typing_longer')
    expect(getSteveTypingPhaseLabel(PHASE_UNUSUAL_MS, t)).toBe('chat.steve_typing_unusual')
  })
})
