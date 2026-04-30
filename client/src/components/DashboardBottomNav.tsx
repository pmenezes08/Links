import { useNavigate, useLocation } from 'react-router-dom'

export function isPremiumDashboardPath(path: string): boolean {
  return (
    path === '/premium_dashboard' ||
    path === '/premium' ||
    path === '/premium_dashboard_react'
  )
}

type DashboardBottomNavProps = {
  show: boolean
  /** Dashboard page: controlled search panel */
  searchOpen?: boolean
  onToggleSearch?: () => void
}

/** Fixed bottom bar shared by Premium Dashboard and Feed (matches PremiumDashboard chrome). */
export default function DashboardBottomNav({ show, searchOpen = false, onToggleSearch }: DashboardBottomNavProps) {
  const navigate = useNavigate()
  const location = useLocation()
  if (!show) return null

  const isFeed = location.pathname === '/feed'
  const isDashboard = isPremiumDashboardPath(location.pathname)

  const onSearch = () => {
    if (isFeed) {
      navigate('/premium_dashboard?open_search=1')
    } else {
      onToggleSearch?.()
    }
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[100] flex flex-col"
      style={{ touchAction: 'manipulation' }}
    >
      <div
        className="w-full bg-black border-t border-[#262f30]"
        style={{
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
        }}
      >
        <div className="h-14 flex items-center justify-between gap-1 text-[#cfd8dc] px-2 sm:px-4">
          <button
            type="button"
            className={`p-2 sm:p-3 rounded-full transition-colors touch-manipulation ${isDashboard ? 'bg-white/10' : 'hover:bg-white/10 active:bg-white/15'}`}
            aria-label="Communities"
            aria-current={isDashboard ? 'page' : undefined}
            onClick={() => navigate('/premium_dashboard')}
          >
            <i className={`fa-solid fa-th text-lg ${isDashboard ? 'text-[#4db6ac]' : ''}`} />
          </button>
          <button
            type="button"
            className={`p-2 sm:p-3 rounded-full transition-colors touch-manipulation ${isFeed ? 'bg-white/10' : 'hover:bg-white/10 active:bg-white/15'}`}
            aria-label="Feed"
            aria-current={isFeed ? 'page' : undefined}
            onClick={() => navigate('/feed')}
          >
            <i className={`fa-solid fa-rss text-lg ${isFeed ? 'text-[#4db6ac]' : ''}`} />
          </button>
          <button
            type="button"
            className="py-1 px-2 sm:px-3 rounded-full hover:bg-white/10 active:bg-white/15 transition-colors touch-manipulation flex flex-col items-center justify-center gap-0 leading-none min-w-0"
            aria-label="Chat with Steve"
            onClick={() => navigate('/user_chat/chat/Steve')}
          >
            <i className="fa-solid fa-user text-[15px] sm:text-base leading-none" />
            <span className="text-[8px] sm:text-[9px] text-[#cfd8dc]/90 font-medium tracking-tight">Steve</span>
          </button>
          <button
            type="button"
            className={`p-2 sm:p-3 rounded-full transition-colors touch-manipulation ${!isFeed && searchOpen ? 'bg-white/10 text-[#4db6ac]' : 'hover:bg-white/10 active:bg-white/15'}`}
            aria-label={searchOpen && !isFeed ? 'Close search' : 'Search communities'}
            aria-pressed={!isFeed && searchOpen}
            onClick={onSearch}
          >
            <i className="fa-solid fa-magnifying-glass text-lg" />
          </button>
        </div>
      </div>
      <div
        className="w-full flex-shrink-0 bg-black"
        style={{ height: 'env(safe-area-inset-bottom, 0px)' }}
        aria-hidden
      />
    </div>
  )
}
