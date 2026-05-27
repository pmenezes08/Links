import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import DashboardBottomNav from './DashboardBottomNav'

type DashboardNavOverrides = {
  show?: boolean
  searchOpen?: boolean
  onToggleSearch?: () => void
}

type DashboardLayoutContextValue = {
  setNavOverrides: (overrides: DashboardNavOverrides) => void
  clearNavOverrides: () => void
}

const DashboardLayoutContext = createContext<DashboardLayoutContextValue>({
  setNavOverrides: () => {},
  clearNavOverrides: () => {},
})

export function useDashboardLayout() {
  return useContext(DashboardLayoutContext)
}

/**
 * Persistent layout shell for Dashboard tab routes (Dashboard, Feed, About).
 * DashboardBottomNav stays mounted across tab switches — eliminating the
 * flash/remount that occurred when each page owned its own instance.
 */
export default function DashboardLayout() {
  const [overrides, setOverrides] = useState<DashboardNavOverrides>({})

  const setNavOverrides = useCallback((o: DashboardNavOverrides) => {
    setOverrides(o)
  }, [])

  const clearNavOverrides = useCallback(() => {
    setOverrides({})
  }, [])

  return (
    <DashboardLayoutContext.Provider value={{ setNavOverrides, clearNavOverrides }}>
      <Outlet />
      <DashboardBottomNav
        show={overrides.show ?? true}
        searchOpen={overrides.searchOpen}
        onToggleSearch={overrides.onToggleSearch}
      />
    </DashboardLayoutContext.Provider>
  )
}
