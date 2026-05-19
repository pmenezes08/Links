import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { performLogout } from '../utils/logout'

type Ctx = { requestLogout: (e?: React.MouseEvent) => void }

const LogoutPromptContext = createContext<Ctx | null>(null)

export function LogoutPromptProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  const requestLogout = useCallback((e?: React.MouseEvent) => {
    e?.preventDefault()
    setOpen(true)
  }, [])

  const confirm = useCallback(() => {
    setOpen(false)
    void performLogout().catch(console.error)
  }, [])

  const cancel = useCallback(() => setOpen(false), [])

  return (
    <LogoutPromptContext.Provider value={{ requestLogout }}>
      {children}
      {open ? (
        <div
          className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-confirm-title"
          onClick={e => {
            if (e.target === e.currentTarget) cancel()
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0b0f10] p-6 shadow-xl">
            <h2 id="logout-confirm-title" className="text-lg font-semibold text-white">
              Log out?
            </h2>
            <p className="mt-2 text-sm text-white/65">You will need to sign in again to use C-Point.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white hover:bg-white/10"
                onClick={cancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl bg-[#4db6ac] px-4 py-2.5 text-sm font-semibold text-black hover:brightness-110"
                onClick={confirm}
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </LogoutPromptContext.Provider>
  )
}

export function useLogoutRequest(): (e?: React.MouseEvent) => void {
  const ctx = useContext(LogoutPromptContext)
  if (!ctx) {
    return (e?: React.MouseEvent) => {
      e?.preventDefault()
      void performLogout().catch(console.error)
    }
  }
  return ctx.requestLogout
}
