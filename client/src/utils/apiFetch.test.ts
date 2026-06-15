import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiFetch, ApiFetchError } from './apiFetch'

const originalFetch = global.fetch

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

beforeEach(() => {
  setOnline(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  global.fetch = originalFetch
})

describe('apiFetch', () => {
  it('returns the response on success and defaults to credentials: include', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }))
    global.fetch = fetchMock as unknown as typeof fetch

    const res = await apiFetch('/api/thing')
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'include' })
  })

  it('retries a 5xx GET then succeeds', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
    global.fetch = fetchMock as unknown as typeof fetch

    const p = apiFetch('/api/thing', { backoffBaseMs: 1 })
    await vi.advanceTimersByTimeAsync(100)
    const res = await p
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry a 4xx (entitlements/auth must surface immediately)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"nope"}', { status: 403 }))
    global.fetch = fetchMock as unknown as typeof fetch

    const res = await apiFetch('/api/thing')
    expect(res.status).toBe(403)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a network error then succeeds', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
    global.fetch = fetchMock as unknown as typeof fetch

    const p = apiFetch('/api/thing', { backoffBaseMs: 1 })
    await vi.advanceTimersByTimeAsync(100)
    const res = await p
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('aborts on timeout and throws an ApiFetchError flagged isTimeout', async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn(
      (_input, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          )
        }),
    ) as unknown as typeof fetch

    const p = apiFetch('/api/slow', { timeoutMs: 100, retries: 0 })
    const assertion = expect(p).rejects.toBeInstanceOf(ApiFetchError)
    await vi.advanceTimersByTimeAsync(150)
    await assertion
  })

  it('dedups concurrent identical GETs into one network call, each caller gets a readable body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"n":1}', { status: 200 }))
    global.fetch = fetchMock as unknown as typeof fetch

    const [a, b] = await Promise.all([apiFetch('/api/dedup'), apiFetch('/api/dedup')])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await a.json()).toEqual({ n: 1 })
    expect(await b.json()).toEqual({ n: 1 })
  })

  it('does not retry while offline (fail fast for a retry affordance)', async () => {
    setOnline(false)
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(apiFetch('/api/thing', { retries: 2 })).rejects.toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never retries a caller-initiated abort', async () => {
    const ac = new AbortController()
    const fetchMock = vi.fn(
      (_input, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          )
        }),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const p = apiFetch('/api/thing', { signal: ac.signal, retries: 2 })
    const assertion = expect(p).rejects.toBeTruthy()
    ac.abort()
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
