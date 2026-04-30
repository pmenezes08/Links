import { useEffect, useState } from 'react'
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
  const [steveOpen, setSteveOpen] = useState(false)

  useEffect(() => {
    if (!steveOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSteveOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [steveOpen])

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
    <>
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
              aria-label="Steve options"
              aria-expanded={steveOpen}
              onClick={() => setSteveOpen(true)}
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

      {steveOpen ? (
        <div
          className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center sm:p-4 bg-black/60"
          role="presentation"
          onClick={() => setSteveOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Steve"
            className="w-full max-w-sm sm:rounded-2xl rounded-t-2xl border border-white/10 bg-[#0a0a0a] shadow-xl p-2 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] sm:pb-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center text-sm font-semibold text-white/90 py-2 border-b border-white/10 mb-1">
              Steve
            </div>
            <button
              type="button"
              className="w-full text-left px-4 py-3.5 rounded-xl text-white hover:bg-white/10 active:bg-white/15"
              onClick={() => {
                setSteveOpen(false)
                navigate('/user_chat/chat/Steve')
              }}
            >
              <div className="font-medium">Talk to Steve</div>
              <div className="text-xs text-[#9fb0b5] mt-0.5">Open direct messages</div>
            </button>
            <div className="px-4 py-3.5 rounded-xl text-[#9fb0b5]/80">
              <div className="font-medium text-white/70">Steve Recommendations</div>
              <div className="text-xs mt-0.5">Coming soon</div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
