import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAccountScopedLocalStorage,
  resetAccountScopedState,
} from './accountStateReset'

const clearAllAvatarCache = vi.fn()

vi.mock('./avatarCache', () => ({
  clearAllAvatarCache,
}))

describe('accountStateReset', () => {
  let deletedDbs: string[]
  let deletedCaches: string[]
  let swUnregister: ReturnType<typeof vi.fn>

  beforeEach(() => {
    deletedDbs = []
    deletedCaches = []
    swUnregister = vi.fn(() => Promise.resolve(true))
    clearAllAvatarCache.mockReset()
    localStorage.clear()
    sessionStorage.clear()

    vi.stubGlobal('indexedDB', {
      deleteDatabase(dbName: string) {
        deletedDbs.push(dbName)
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
    } as IDBFactory)

    vi.stubGlobal('caches', {
      keys: () => Promise.resolve(['runtime-v1', 'cp-shell-1', 'app-shell']),
      delete: vi.fn((cacheName: string) => {
        deletedCaches.push(cacheName)
        return Promise.resolve(true)
      }),
    })

    vi.stubGlobal(
      'navigator',
      Object.assign({}, navigator, {
        serviceWorker: {
          getRegistrations: () => Promise.resolve([{ unregister: swUnregister }]),
        },
      }) as Navigator,
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('clears account-scoped localStorage without removing unrelated preferences', () => {
    localStorage.setItem('cached_profile', '{"username":"alice"}')
    localStorage.setItem('current_username', 'alice')
    localStorage.setItem('chat-threads-list:alice', 'threads')
    localStorage.setItem('community-management:root', 'community-management')
    localStorage.setItem('communities:all-hierarchy', 'hierarchy')
    localStorage.setItem('ann_last_seen_1', 'announcement')
    localStorage.setItem('docs_last_seen_1', 'docs')
    localStorage.setItem('docs_last_seen_group_1', 'group-docs')
    localStorage.setItem('theme', 'dark')

    clearAccountScopedLocalStorage()

    expect(localStorage.getItem('cached_profile')).toBe(null)
    expect(localStorage.getItem('current_username')).toBe(null)
    expect(localStorage.getItem('chat-threads-list:alice')).toBe(null)
    expect(localStorage.getItem('community-management:root')).toBe(null)
    expect(localStorage.getItem('communities:all-hierarchy')).toBe(null)
    expect(localStorage.getItem('ann_last_seen_1')).toBe(null)
    expect(localStorage.getItem('docs_last_seen_1')).toBe(null)
    expect(localStorage.getItem('docs_last_seen_group_1')).toBe(null)
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('resets offline databases, account caches, avatars, and preserves deep-link session dedupe by default', async () => {
    sessionStorage.setItem('cpoint_processed_deep_links', '["link"]')
    sessionStorage.setItem('temporary', 'remove-me')

    await resetAccountScopedState({ clearSessionStorage: true, unregisterServiceWorkers: true })

    expect(deletedDbs).toEqual(expect.arrayContaining([
      'cpoint-offline',
      'chat-encryption',
      'signal-protocol',
      'signal-store',
    ]))
    expect(deletedCaches).toEqual(expect.arrayContaining(['runtime-v1', 'cp-shell-1']))
    expect(deletedCaches).not.toContain('app-shell')
    expect(clearAllAvatarCache).toHaveBeenCalled()
    expect(swUnregister).toHaveBeenCalled()
    expect(sessionStorage.getItem('cpoint_processed_deep_links')).toBe('["link"]')
    expect(sessionStorage.getItem('temporary')).toBe(null)
  })

  it('supports account deletion mode that clears all localStorage, sessionStorage, and caches', async () => {
    localStorage.setItem('theme', 'dark')
    sessionStorage.setItem('cpoint_processed_deep_links', '["link"]')

    await resetAccountScopedState({
      localStorageMode: 'all',
      clearSessionStorage: true,
      preserveSessionStorageKeys: [],
      cacheMode: 'all',
    })

    expect(localStorage.getItem('theme')).toBe(null)
    expect(sessionStorage.getItem('cpoint_processed_deep_links')).toBe(null)
    expect(deletedDbs).toContain('cpoint-offline')
    expect(deletedCaches).toEqual(expect.arrayContaining(['runtime-v1', 'cp-shell-1', 'app-shell']))
  })
})
