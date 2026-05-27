import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { triggerHaptic } from '../utils/haptics'
import { isOnboardingFullscreenOverlayActive } from '../utils/fullscreenOverlay'

export const DASHBOARD_BOTTOM_NAV_HEIGHT_CSS = 'var(--app-dashboard-bottom-nav-height)'

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
  const { t } = useTranslation()
  const [steveOpen, setSteveOpen] = useState(false)
  const [steveModalView, setSteveModalView] = useState<SteveModalView>('main')
  const [onboardingOverlayActive, setOnboardingOverlayActive] = useState(isOnboardingFullscreenOverlayActive)

  useEffect(() => {
    const sync = () => setOnboardingOverlayActive(isOnboardingFullscreenOverlayActive())
    window.addEventListener('cpoint-fullscreen-overlay', sync)
    return () => window.removeEventListener('cpoint-fullscreen-overlay', sync)
  }, [])

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

  if (!show || onboardingOverlayActive) return null

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

  const steveRowBtn =
    'w-full text-left px-4 py-3.5 rounded-xl border border-white/10 bg-white/[0.04] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-cpoint-turquoise/40 hover:bg-cpoint-turquoise/10 active:bg-cpoint-turquoise/15 active:scale-[0.98] transition-[transform,background-color,border-color] duration-100 touch-manipulation'

  const tabPress = () => {
    void triggerHaptic('selection')
  }

  const chrome = (
    <>
      <div
        className="fixed bottom-0 left-0 right-0 z-[900] bg-black border-t border-[#262f30]"
        style={{
          paddingBottom: 'var(--sab-px, 0px)',
          paddingLeft: 'var(--sal-px, 0px)',
          paddingRight: 'var(--sar-px, 0px)',
          touchAction: 'manipulation',
          pointerEvents: 'auto',
        }}
      >
        <div className="h-14 flex items-center justify-between gap-1 text-[#cfd8dc] px-2 sm:px-4">
          <button
            type="button"
            className={`p-2 sm:p-3 rounded-full transition-[transform,background-color] duration-100 touch-manipulation active:scale-95 ${isDashboard ? 'bg-white/10' : 'hover:bg-white/10 active:bg-white/15'}`}
            aria-label={t('navigation.communities')}
            aria-current={isDashboard ? 'page' : undefined}
            onClick={() => { tabPress(); navigate('/premium_dashboard') }}
          >
            <i className={`fa-solid fa-th text-[24px] leading-none ${isDashboard ? 'text-cpoint-turquoise' : ''}`} />
          </button>
          <button
            type="button"
            className={`p-2 sm:p-3 rounded-full transition-[transform,background-color] duration-100 touch-manipulation active:scale-95 ${isFeed ? 'bg-white/10' : 'hover:bg-white/10 active:bg-white/15'}`}
            aria-label={t('navigation.feed')}
            aria-current={isFeed ? 'page' : undefined}
            onClick={() => { tabPress(); navigate('/feed') }}
          >
            <i className={`fa-solid fa-rss text-[24px] leading-none ${isFeed ? 'text-cpoint-turquoise' : ''}`} />
          </button>
          <button
            type="button"
            className="py-1 px-2 sm:px-3 rounded-full hover:bg-white/10 active:bg-white/15 active:scale-95 transition-[transform,background-color] duration-100 touch-manipulation flex flex-col items-center justify-center gap-0 leading-none min-w-0"
            aria-label={t('steve.options_label')}
            aria-expanded={steveOpen}
            onClick={() => { tabPress(); setSteveOpen(true) }}
          >
            <i className="fa-solid fa-user text-[22px] sm:text-[24px] leading-none" />
            <span className="text-[9px] sm:text-[10px] text-[#cfd8dc]/90 font-medium tracking-tight">{t('steve.label')}</span>
          </button>
          <button
            type="button"
            className={`p-2 sm:p-3 rounded-full transition-[transform,background-color] duration-100 touch-manipulation active:scale-95 ${!isFeed && !isAbout && searchOpen ? 'bg-white/10 text-cpoint-turquoise' : 'hover:bg-white/10 active:bg-white/15'}`}
            aria-label={searchOpen && !isFeed && !isAbout ? t('navigation.close_search') : t('navigation.search_communities')}
            aria-pressed={!isFeed && !isAbout && searchOpen}
            onClick={() => { tabPress(); onSearch() }}
          >
            <i className="fa-solid fa-magnifying-glass text-[24px] leading-none" />
          </button>
        </div>
      </div>

      {steveOpen ? (
        <div
          className="fixed inset-0 z-[950] flex items-center justify-center px-4 pt-4 bg-black pb-[var(--app-dashboard-bottom-nav-height)]"
          role="presentation"
          onClick={() => setSteveOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={steveModalView === 'main' ? t('steve.main_aria') : steveModalView === 'recommendations' ? t('steve.recommendations_aria') : t('steve.news_aria')}
            className="relative z-[950] w-full max-w-sm rounded-2xl overflow-hidden border border-cpoint-turquoise bg-[#0d1214] shadow-[0_24px_56px_rgba(0,0,0,0.52)] flex flex-col max-h-[min(420px,78dvh)] min-h-[220px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative z-[1] flex flex-col flex-1 min-h-0 p-2">
            {steveModalView === 'main' && (
              <>
                <div className="shrink-0 text-center text-sm font-semibold text-white/95 py-2 border-b border-white/10 tracking-tight">
                  {t('steve.label')}
                </div>
                <div className="flex flex-col justify-center gap-2 flex-1 py-4 px-0.5">
                <button
                  type="button"
                  className={steveRowBtn}
                  onClick={() => {
                    setSteveOpen(false)
                    navigate('/user_chat/chat/Steve')
                  }}
                >
                  <div className="font-medium">{t('steve.talk_to_steve')}</div>
                  <div className="text-xs text-[#9fb0b5] mt-0.5">{t('steve.talk_to_steve_helper')}</div>
                </button>
                <button
                  type="button"
                  className={steveRowBtn}
                  onClick={() => setSteveModalView('recommendations')}
                >
                  <div className="font-medium">{t('steve.recommendations')}</div>
                  <div className="text-xs text-[#9fb0b5] mt-0.5">{t('steve.recommendations_helper')}</div>
                </button>
                </div>
              </>
            )}

            {steveModalView === 'recommendations' && (
              <>
                <div className="shrink-0 flex items-center gap-2 py-2 border-b border-white/10">
                  <button
                    type="button"
                    className="p-2 rounded-lg text-[#9fb0b5] hover:bg-cpoint-turquoise/15 hover:text-cpoint-turquoise transition-colors"
                    aria-label={t('navigation.back')}
                    onClick={() => setSteveModalView('main')}
                  >
                    <i className="fa-solid fa-arrow-left" />
                  </button>
                  <div className="flex-1 text-center text-sm font-semibold text-white/95 pr-8 tracking-tight">{t('steve.recommendations')}</div>
                </div>
                <div className="flex flex-col justify-center gap-2 flex-1 py-4 px-0.5 min-h-[120px]">
                <button
                  type="button"
                  className={steveRowBtn}
                  onClick={() => {
                    setSteveOpen(false)
                    setSteveModalView('main')
                    navigate('/networking')
                  }}
                >
                  <div className="font-medium">{t('steve.networking')}</div>
                  <div className="text-xs text-[#9fb0b5] mt-0.5">{t('steve.networking_helper')}</div>
                </button>
                <button
                  type="button"
                  className={steveRowBtn}
                  onClick={() => setSteveModalView('news_soon')}
                >
                  <div className="font-medium">{t('steve.news_articles')}</div>
                  <div className="text-xs text-[#9fb0b5] mt-0.5">{t('steve.news_articles_helper')}</div>
                </button>
                </div>
              </>
            )}

            {steveModalView === 'news_soon' && (
              <>
                <div className="shrink-0 flex items-center gap-2 py-2 border-b border-white/10">
                  <button
                    type="button"
                    className="p-2 rounded-lg text-[#9fb0b5] hover:bg-cpoint-turquoise/15 hover:text-cpoint-turquoise transition-colors"
                    aria-label={t('navigation.back')}
                    onClick={() => setSteveModalView('recommendations')}
                  >
                    <i className="fa-solid fa-arrow-left" />
                  </button>
                  <div className="flex-1 text-center text-sm font-semibold text-white/95 pr-8 tracking-tight">{t('steve.news_articles')}</div>
                </div>
                <div className="flex flex-col flex-1 justify-center items-center px-4 py-6 text-center min-h-[140px]">
                  <p className="text-base font-medium text-white">{t('steve.coming_soon')}</p>
                  <p className="text-sm text-[#9fb0b5] mt-2 leading-relaxed max-w-[280px]">
                    {t('steve.coming_soon_body')}
                  </p>
                </div>
              </>
            )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )

  if (typeof document === 'undefined') return null
  return createPortal(chrome, document.body)
}
