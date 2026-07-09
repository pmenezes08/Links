import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { LimitReachedModal } from '../components/entitlements'
import type { EntitlementsError } from '../utils/entitlementsError'
import { isEntitlementsError, normalizeCommunityId } from '../utils/entitlementsError'

/**
 * App-wide plumbing for the `entitlements_error` response shape.
 *
 * Mount `<EntitlementsProvider>` near the root and any surface can call
 * `useEntitlementsHandler().showError(err)` to raise a full-screen modal,
 * or `handleResponse(res)` to automatically detect + surface one.
 *
 * This is the "modal" surface (button-triggered actions). Conversational
 * surfaces (DM / group chat) prefer `LimitReachedBubble` inline instead.
 */
export interface EntitlementsErrorContextOptions {
  /** Community the user was acting in when the limit hit. When known, the
   *  modal's `/subscription_plans` CTA deep-links straight to that
   *  community's plans instead of the bare picker. */
  communityId?: number | string | null
}

interface EntitlementsErrorApi {
  /** Show the modal directly for an already-parsed entitlements payload. */
  showError: (err: EntitlementsError, opts?: EntitlementsErrorContextOptions) => void
  /** Pass a `Response` — if it's an entitlements error, raise the modal
   *  and return `null`; otherwise return the parsed JSON body. */
  handleResponse: <T = unknown>(res: Response, opts?: EntitlementsErrorContextOptions) => Promise<T | null>
  /** Dismiss any active entitlements modal. */
  clear: () => void
}

const EntitlementsContext = createContext<EntitlementsErrorApi>({
  showError: () => {},
  handleResponse: async () => null,
  clear: () => {},
})

export function useEntitlementsHandler(): EntitlementsErrorApi {
  return useContext(EntitlementsContext)
}

interface ProviderProps {
  children: ReactNode
}

interface ActiveEntitlementsError {
  err: EntitlementsError
  communityId: number | null
}

export function EntitlementsProvider({ children }: ProviderProps) {
  const [active, setActive] = useState<ActiveEntitlementsError | null>(null)

  const showError = useCallback((err: EntitlementsError, opts?: EntitlementsErrorContextOptions) => {
    setActive({ err, communityId: normalizeCommunityId(opts?.communityId) })
  }, [])

  const clear = useCallback(() => setActive(null), [])

  const handleResponse = useCallback(async function <T = unknown>(
    res: Response,
    opts?: EntitlementsErrorContextOptions,
  ): Promise<T | null> {
    if (res.ok) {
      try { return (await res.json()) as T } catch { return null }
    }
    // 402/403/429 typically carry the entitlements shape.
    try {
      const body = await res.clone().json()
      if (isEntitlementsError(body)) {
        setActive({ err: body, communityId: normalizeCommunityId(opts?.communityId) })
        return null
      }
      return body as T
    } catch {
      return null
    }
  }, [])

  return (
    <EntitlementsContext.Provider value={{ showError, handleResponse, clear }}>
      {children}
      {active ? <LimitReachedModal err={active.err} communityId={active.communityId} onClose={clear} /> : null}
    </EntitlementsContext.Provider>
  )
}
