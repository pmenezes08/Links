import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { LimitReachedModal } from '../components/entitlements'
import type { EntitlementsError } from '../utils/entitlementsError'
import { isEntitlementsError } from '../utils/entitlementsError'

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
interface EntitlementsErrorApi {
  /** Show the modal directly for an already-parsed entitlements payload. */
  showError: (err: EntitlementsError) => void
  /** Pass a `Response` — if it's an entitlements error, raise the modal
   *  and return `null`; otherwise return the parsed JSON body. */
  handleResponse: <T = unknown>(res: Response) => Promise<T | null>
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

export function EntitlementsProvider({ children }: ProviderProps) {
  const [active, setActive] = useState<EntitlementsError | null>(null)

  const showError = useCallback((err: EntitlementsError) => {
    setActive(err)
  }, [])

  const clear = useCallback(() => setActive(null), [])

  const handleResponse = useCallback(async function <T = unknown>(res: Response): Promise<T | null> {
    if (res.ok) {
      try { return (await res.json()) as T } catch { return null }
    }
    // 402/403/429 typically carry the entitlements shape.
    try {
      const body = await res.clone().json()
      if (isEntitlementsError(body)) {
        setActive(body)
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
      {active ? <LimitReachedModal err={active} onClose={clear} /> : null}
    </EntitlementsContext.Provider>
  )
}
