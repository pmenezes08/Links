import { describe, it, expect, vi, afterEach } from 'vitest'
import { nextPollBackoffMs, MAX_POLL_BACKOFF_MS } from './constants'

afterEach(() => vi.restoreAllMocks())

describe('nextPollBackoffMs', () => {
  it('returns 0 with no errors (poll at the normal interval)', () => {
    expect(nextPollBackoffMs(0)).toBe(0)
    expect(nextPollBackoffMs(-3)).toBe(0)
  })

  it('grows exponentially on the base and is capped', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1) // jitter -> 100% of ceiling
    expect(nextPollBackoffMs(1, 1500)).toBe(3000)
    expect(nextPollBackoffMs(2, 1500)).toBe(6000)
    expect(nextPollBackoffMs(3, 1500)).toBe(12000)
    expect(nextPollBackoffMs(10, 1500)).toBe(MAX_POLL_BACKOFF_MS) // capped
  })

  it('applies full jitter — never below half the ceiling', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0) // jitter -> 50% of ceiling
    expect(nextPollBackoffMs(1, 1500)).toBe(1500) // 3000 * 0.5
    expect(nextPollBackoffMs(10, 1500)).toBe(MAX_POLL_BACKOFF_MS / 2)
  })
})
