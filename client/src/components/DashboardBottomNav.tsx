import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'

export function isPremiumDashboardPath(path: string): boolean {
  return (
    path === '/premium_dashboard' ||
    path === '/premium' ||
    path === '/premium_dashboard_react'
  )
}

export function isAboutCPointPath(path: string): boolean {
  return path === '/about_cpoint'
}

type DashboardBottomNavProps = {
  show: boolean
  /** Dashboard page: controlled search panel */
  searchOpen?: boolean
  onToggleSearch?: () => void
}

/** Fixed bottom bar shared by Premium Dashboard and Feed (matches PremiumDashboard chrome). */
type SteveModalView = 'main' | 'recommendations' | 'news_soon'

export default function DashboardBottomNav({ show, searchOpen = false, onToggleSearch }: DashboardBottomNavProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [steveOpen, setSteveOpen] = useState(false)
  const [steveModalView, setSteveModalView] = useState<SteveModalView>('main')

  useEffect(() => {
    if (!steveOpen) setSteveModalView('main')
  }, [steveOpen])

  useEffect(() => {
    if (!steveOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (steveModalView !== 'main') setSteveModalView('main')
      else setSteveOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [steveOpen, steveModalView])

  if (!show) return null

  const isFeed = location.pathname === '/feed'
  const isDashboard = isPremiumDashboardPath(location.pathname)
  const isAbout = isAboutCPointPath(location.pathname)

  const onSearch = () => {
    if (isFeed || isAbout) {
      navigate('/premium_dashboard?open_search=1')
    } else {
      onToggleSearch?.()
    }
  }

  const steveModal =
    steveOpen ? (
      <div
        className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center sm:p-4 bg-black/60 pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] sm:pb-4"
        role="presentation"
        onClick={() => setSteveOpen(false)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={steveModalView === 'main' ? 'Steve' : steveModalView === 'recommendations' ? 'Steve recommendations' : 'News and articles'}
          className="w-full max-w-sm sm:rounded-2xl rounded-t-2xl border border-white/10 bg-[#0a0a0a] shadow-xl p-2 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] sm:pb-3"
          onClick={(e) => e.stopPropagation()}
        >
          {steveModalView === 'main' && (
            <>
              <div className="text-center text-sm font-semibold text-white/90 py-2 border-b border-white/10 mb-1">Steve</div>
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
              <button
                type="button"
                className="w-full text-left px-4 py-3.5 rounded-xl text-white hover:bg-white/10 active:bg-white/15"
                onClick={() => setSteveModalView('recommendations')}
              >
                <div className="font-medium">Steve Recommendations</div>
                <div className="text-xs text-[#9fb0b5] mt-0.5">Networking and curated picks</div>
              </button>
            </>
          )}

          {steveModalView === 'recommendations' && (
            <>
              <div className="flex items-center gap-2 py-2 border-b border-white/10 mb-1">
                <button
                  type="button"
                  className="p-2 rounded-lg text-[#9fb0b5] hover:bg-white/10 hover:text-white"
                  aria-label="Back"
                  onClick={() => setSteveModalView('main')}
                >
                  <i className="fa-solid fa-arrow-left" />
                </button>
                <div className="flex-1 text-center text-sm font-semibold text-white/90 pr-8">Steve Recommendations</div>
              </div>
              <button
                type="button"
                className="w-full text-left px-4 py-3.5 rounded-xl text-white hover:bg-white/10 active:bg-white/15"
                onClick={() => {
                  setSteveOpen(false)
                  setSteveModalView('main')
                  navigate('/networking')
                }}
              >
                <div className="font-medium">Networking</div>
                <div className="text-xs text-[#9fb0b5] mt-0.5">Ask Steve to match you with people in your networks</div>
              </button>
              <button
                type="button"
                className="w-full text-left px-4 py-3.5 rounded-xl text-white hover:bg-white/10 active:bg-white/15"
                onClick={() => setSteveModalView('news_soon')}
              >
                <div className="font-medium">News / Articles</div>
                <div className="text-xs text-[#9fb0b5] mt-0.5">Personalized reading from your networks</div>
              </button>
            </>
          )}

          {steveModalView === 'news_soon' && (
            <>
              <div className="flex items-center gap-2 py-2 border-b border-white/10 mb-1">
                <button
                  type="button"
                  className="p-2 rounded-lg text-[#9fb0b5] hover:bg-white/10 hover:text-white"
                  aria-label="Back"
                  onClick={() => setSteveModalView('recommendations')}
                >
                  <i className="fa-solid fa-arrow-left" />
                </button>
                <div className="flex-1 text-center text-sm font-semibold text-white/90 pr-8">News / Articles</div>
              </div>
              <div className="px-4 py-6 text-center">
                <p className="text-base font-medium text-white">Coming soon</p>
                <p className="text-sm text-[#9fb0b5] mt-2 leading-relaxed">
                  Steve will surface articles and updates tailored to your communities.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    ) : null

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
              className={`p-2 sm:p-3 rounded-full transition-colors touch-manipulation ${!isFeed && !isAbout && searchOpen ? 'bg-white/10 text-[#4db6ac]' : 'hover:bg-white/10 active:bg-white/15'}`}
              aria-label={searchOpen && !isFeed && !isAbout ? 'Close search' : 'Search communities'}
              aria-pressed={!isFeed && !isAbout && searchOpen}
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

      {typeof document !== 'undefined' && steveModal ? createPortal(steveModal, document.body) : null}
    </>
  )
}
