import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { performLogout } from './logout'

describe('performLogout (Phase G4)', () => {
  const originalFetch = globalThis.fetch
  let fetchMock: ReturnType<typeof vi.fn>
  let sequence: string[]
  let locationReplace: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sequence = []
    locationReplace = vi.fn((href: string) => {
      sequence.push(`replace:${href}`)
    })
    try {
      Object.defineProperty(window, 'location', {
        configurable: true,
        enumerable: true,
        value: { ...window.location, replace: locationReplace } as Location,
      })
    } catch {
      ;(window as unknown as { location: Location }).location = {
        ...window.location,
        replace: locationReplace,
      } as Location
    }

    fetchMock = vi.fn((_url: string | Request) => {
      sequence.push(typeof _url === 'string' ? _url : 'request')
      return Promise.resolve({ ok: true, status: 200 } as Response)
    })
    vi.stubGlobal('fetch', fetchMock)

    const store: Record<string, string> = {}
    const ls = {
      get length() {
        return Object.keys(store).length
      },
      key(i: number) {
        return Object.keys(store)[i] ?? null
      },
      getItem(k: string) {
        return Object.keys(store).includes(k) ? store[k] : null
      },
      setItem(k: string, v: string) {
        store[k] = v
      },
      removeItem(k: string) {
        delete store[k]
      },
      clear() {
        Object.keys(store).forEach((k) => delete store[k])
      },
    }
    seedStore(store)
    vi.stubGlobal('localStorage', ls as Storage)

    const sessionStore: Record<string, string> = {}
    vi.stubGlobal(
      'sessionStorage',
      {
        getItem(k: string) {
          return sessionStore[k] ?? null
        },
        setItem(k: string, v: string) {
          sessionStore[k] = v
        },
        clear() {
          Object.keys(sessionStore).forEach((k) => delete sessionStore[k])
        },
      } as unknown as Storage,
    )

    vi.stubGlobal('caches', {
      keys: () => Promise.resolve(['runtime-v1', 'cp-pages', 'app-shell']),
      delete: vi.fn(() => Promise.resolve(true)),
    })

    vi.stubGlobal(
      'indexedDB',
      {
        deleteDatabase() {
          const req = {} as Record<string, unknown>
          Object.defineProperty(req, 'onsuccess', {
            configurable: true,
            set(cb: ((ev: Event) => void) | null) {
              if (typeof cb === 'function') {
                cb({} as Event)
              }
            },
          })
          return req as IDBOpenDBRequest
        },
      } as IDBFactory,
    )
  })

  function seedStore(store: Record<string, string>) {
    store.cached_profile = JSON.stringify({ username: 'alice' })
    store.current_username = 'alice'
    store['dashboard-x'] = '1'
    store['community-feed:1'] = '1'
    store.theme = 'dark'
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    globalThis.fetch = originalFetch
  })

  it('clears cached_profile and current_username but keeps unrelated keys such as theme', async () => {
    await performLogout()
    expect(window.localStorage.getItem('cached_profile')).toBe(null)
    expect(window.localStorage.getItem('current_username')).toBe(null)
    expect(window.localStorage.getItem('theme')).toBe('dark')
  })

  it('calls caches.delete only for runtime and cp- prefixes (not app-shell)', async () => {
    const cachesApi = caches as typeof caches & { delete: ReturnType<typeof vi.fn> }
    await performLogout()
    expect(cachesApi.delete).toHaveBeenCalled()
    const deleted = cachesApi.delete.mock.calls.map((c) => String(c[0]))
    expect(deleted).toContain('runtime-v1')
    expect(deleted).toContain('cp-pages')
    expect(deleted.some((n) => n.includes('app-shell'))).toBe(false)
  })

  it('calls unregister_fcm fetch before navigating to /logout', async () => {
    await performLogout()
    const idxFetch = sequence.findIndex((s) => s.includes('/api/push/unregister_fcm'))
    const idxReplace = sequence.findIndex((s) => s.startsWith('replace:'))
    expect(idxFetch).not.toBe(-1)
    expect(idxReplace).not.toBe(-1)
    expect(idxFetch).toBeLessThan(idxReplace)
    expect(sequence[idxReplace]).toBe('replace:/logout')
  })
})
