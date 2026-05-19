import { afterEach, describe, expect, it, vi } from 'vitest'
import { preflightSteveMention } from './stevePreflight'

describe('preflightSteveMention', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not call the backend when text does not mention Steve', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const handler = { handleResponse: vi.fn() }

    const result = await preflightSteveMention({
      text: 'hello everyone',
      communityId: 123,
      entitlementsHandler: handler,
    })

    expect(result.ok).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(handler.handleResponse).not.toHaveBeenCalled()
  })

  it('returns false when the entitlement modal handler consumes the response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 403 }))
    const handler = { handleResponse: vi.fn().mockResolvedValue(null) }

    const result = await preflightSteveMention({
      text: '@Steve help',
      communityId: 123,
      postId: 456,
      entitlementsHandler: handler,
    })

    expect(result.ok).toBe(false)
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/ai/steve_preflight', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }))
  })
})
