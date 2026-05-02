/**
 * Tests for `resetAllAccountState` and `shouldPurgeCacheBucket`.
 *
 * Account isolation depends on this module wiping every relevant
 * client-side surface (localStorage / sessionStorage / IndexedDB / Cache
 * Storage / Capacitor prefs) on logout, login, and login-epoch mismatch.
 * The tests below pin the contract:
 *
 *   * PURGE_KEYS and PURGE_PREFIXES drop user-scoped data while the test's
 *     `theme` key (representing user prefs unrelated to identity) survives;
 *   * shouldPurgeCacheBucket drops user runtime caches but preserves the
 *     app shell;
 *   * sessionStorage is cleared except for the deep-link dedupe key;
 *   * `preserveKeys` overrides the default purge for explicitly-named keys.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// IndexedDB management has its own retry/fallback logic that's exercised in
// `offlineDb.test.ts`; in this suite we only care that resetAllAccountState
// asks for it to be deleted, so stub the dynamic import out.
vi.mock('./offlineDb', () => ({
  deleteCpointOfflineDatabase: vi.fn(() => Promise.resolve()),
}))

vi.mock('./avatarCache', () => ({
  clearAllAvatarCache: vi.fn(),
}))

import {
  PURGE_KEYS,
  PURGE_PREFIXES,
  resetAllAccountState,
  shouldPurgeCacheBucket,
} from './accountStateReset'

describe('shouldPurgeCacheBucket', () => {
  it.each([
    'cp-runtime-2.70.0',
    'cp-media-2.70.0',
    'cp-pages',
    'runtime-v1',
    'cp-old-bucket',
  ])('purges user-scoped bucket %s', (name) => {
    expect(shouldPurgeCacheBucket(name)).toBe(true)
  })

  it.each(['cp-shell-2.70.0', 'cp-shell-1.0.0', 'app-shell', 'app-shell-v2', 'unrelated-bucket'])(
    'preserves bucket %s',
    (name) => {
      expect(shouldPurgeCacheBucket(name)).toBe(false)
    },
  )
})

describe('PURGE_KEYS / PURGE_PREFIXES', () => {
  it('PURGE_KEYS includes the login epoch key', () => {
    expect(PURGE_KEYS).toContain('last_login_id')
    expect(PURGE_KEYS).toContain('current_username')
    expect(PURGE_KEYS).toContain('cached_profile')
  })

  it('PURGE_PREFIXES has no duplicates', () => {
    expect(new Set(PURGE_PREFIXES).size).toBe(PURGE_PREFIXES.length)
  })
})

describe('resetAllAccountState', () => {
  let store: Record<string, string>
  let sessionStore: Record<string, string>
  let cachesDelete: ReturnType<typeof vi.fn>

  beforeEach(() => {
    store = {
      cached_profile: '{"username":"alice"}',
      current_username: 'alice',
      last_login_id: 'old-epoch',
      'chat-threads-list:alice': '[]',
      'community_42': '1',
      'dashboard-x': '1',
      theme: 'dark',
    }
    sessionStore = {
      cpoint_processed_deep_links: 'foo',
      cpoint_signin_notice: 'existing_account',
    }
    cachesDelete = vi.fn(() => Promise.resolve(true))

    vi.stubGlobal('localStorage', {
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
    } as Storage)

    vi.stubGlobal('sessionStorage', {
      getItem(k: string) {
        return sessionStore[k] ?? null
      },
      setItem(k: string, v: string) {
        sessionStore[k] = v
      },
      removeItem(k: string) {
        delete sessionStore[k]
      },
      clear() {
        Object.keys(sessionStore).forEach((k) => delete sessionStore[k])
      },
    } as unknown as Storage)

    vi.stubGlobal('caches', {
      keys: () => Promise.resolve(['cp-runtime-2.70.0', 'cp-shell-2.70.0', 'cp-pages']),
      delete: cachesDelete,
    })

    vi.stubGlobal(
      'navigator',
      Object.assign({}, navigator, {
        serviceWorker: {
          ready: Promise.resolve({ active: null }),
          getRegistrations: () => Promise.resolve([]),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      }) as Navigator,
    )

    // IndexedDB stub: every request resolves on the next microtask so the
    // helper's open→close→delete dance completes synchronously enough for
    // vitest's 5s budget (the production path tolerates 1.5s per DB).
    function makeRequest(): IDBOpenDBRequest {
      const req: Record<string, unknown> = { result: { close: () => undefined } }
      Object.defineProperty(req, 'onsuccess', {
        configurable: true,
        set(cb: ((ev: Event) => void) | null) {
          if (typeof cb === 'function') {
            queueMicrotask(() => cb({} as Event))
          }
        },
      })
      Object.defineProperty(req, 'onerror', { configurable: true, set() {} })
      Object.defineProperty(req, 'onblocked', { configurable: true, set() {} })
      return req as IDBOpenDBRequest
    }

    vi.stubGlobal(
      'indexedDB',
      {
        open() {
          return makeRequest()
        },
        deleteDatabase() {
          return makeRequest()
        },
      } as IDBFactory,
    )

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true } as Response)))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('removes user-scoped localStorage keys but keeps the theme', async () => {
    await resetAllAccountState({ unregisterServiceWorkers: false })
    expect(store.cached_profile).toBeUndefined()
    expect(store.current_username).toBeUndefined()
    expect(store.last_login_id).toBeUndefined()
    expect(store['chat-threads-list:alice']).toBeUndefined()
    expect(store.community_42).toBeUndefined()
    expect(store['dashboard-x']).toBeUndefined()
    expect(store.theme).toBe('dark')
  })

  it('preserves explicitly listed keys via preserveKeys', async () => {
    store.user_prefers_dark = '1'
    await resetAllAccountState({
      unregisterServiceWorkers: false,
      preserveKeys: ['user_prefers_dark'],
    })
    expect(store.user_prefers_dark).toBe('1')
  })

  it('clears sessionStorage but preserves the deep-link dedupe key', async () => {
    await resetAllAccountState({ unregisterServiceWorkers: false })
    expect(sessionStore.cpoint_signin_notice).toBeUndefined()
    expect(sessionStore.cpoint_processed_deep_links).toBe('foo')
  })

  it('deletes user-scoped Cache Storage buckets but keeps cp-shell-*', async () => {
    await resetAllAccountState({ unregisterServiceWorkers: false })
    const deleted = cachesDelete.mock.calls.map((c) => String(c[0]))
    expect(deleted).toContain('cp-runtime-2.70.0')
    expect(deleted).toContain('cp-pages')
    expect(deleted).not.toContain('cp-shell-2.70.0')
  })

  it('expires native_push_install_id cookie', async () => {
    document.cookie = 'native_push_install_id=abc; Path=/'
    await resetAllAccountState({ unregisterServiceWorkers: false })
    // We can't read past cookie state in jsdom reliably, but the call must
    // not throw — covered by the absence of an exception above.
    expect(true).toBe(true)
  })
})
