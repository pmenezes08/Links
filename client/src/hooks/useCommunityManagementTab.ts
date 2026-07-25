import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export type CommunityManagementTab = 'timeline' | 'management' | 'groups' | 'training'

const VALID_TABS: ReadonlySet<string> = new Set(['timeline', 'management', 'groups', 'training'])

/**
 * The community-management page's active tab, addressed by the URL
 * (`?tab=groups`) instead of local state.
 *
 * URL-addressable tabs are what make "return from a group feed lands on the
 * Groups tab" possible at all: back targets append `&tab=groups`, deep links
 * restore, and refresh keeps your place. Tab taps replace the history entry
 * so the hardware back button never walks through tab switches.
 */
export function useCommunityManagementTab(): [CommunityManagementTab, (next: CommunityManagementTab) => void] {
  const location = useLocation()
  const navigate = useNavigate()

  const tab = useMemo<CommunityManagementTab>(() => {
    const raw = new URLSearchParams(location.search).get('tab') || ''
    return (VALID_TABS.has(raw) ? raw : 'management') as CommunityManagementTab
  }, [location.search])

  const setTab = useCallback(
    (next: CommunityManagementTab) => {
      const sp = new URLSearchParams(location.search)
      if (next === 'management') sp.delete('tab')
      else sp.set('tab', next)
      const qs = sp.toString()
      navigate(`${location.pathname}${qs ? `?${qs}` : ''}`, { replace: true })
    },
    [location.pathname, location.search, navigate],
  )

  return [tab, setTab]
}
