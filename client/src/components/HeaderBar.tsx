import { useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { useTranslation } from 'react-i18next'
import Avatar from './Avatar'
import { useLogoutRequest } from '../contexts/LogoutPromptContext'
import { useBadges } from '../contexts/BadgeContext'
import BurgerMenuDrawer from './BurgerMenuDrawer'
import { hapticImpactLight } from '../utils/haptics'

type HeaderBarProps = {
  title: string
  username?: string
  displayName?: string
  avatarUrl?: string | null
  titleAccessory?: ReactNode
}

export default function HeaderBar({ title, username, displayName, avatarUrl, titleAccessory }: HeaderBarProps){
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const { unreadMsgs, unreadNotifs } = useBadges()
  const isWeb = typeof window !== 'undefined' ? Capacitor.getPlatform() === 'web' : false

  // PWA install prompt wiring
  // PWA install hooks removed here

  // Install handler moved to login page

  const resolvedAvatar = avatarUrl
    ? ((avatarUrl.startsWith('http') || avatarUrl.startsWith('/static')) ? avatarUrl : `/static/${avatarUrl}`)
    : null

  const requestLogout = useLogoutRequest()

  const showBack = location.pathname === '/notifications'
  const goBack = () => {
    hapticImpactLight()
    if (window.history.length > 1) { navigate(-1) } else { navigate('/home') }
  }

  return (
    <>
      <div
        className="header-with-safe-area fixed left-0 right-0 top-0 h-14 border-b border-c-border bg-c-header-bg flex items-center px-3 z-[1000] text-c-text-primary will-change-transform"
      >
        {showBack ? (
          <button className="mr-2 p-2 rounded-full hover:bg-c-hover-bg" onClick={goBack} aria-label={t('navigation.back')}>
            <i className="fa-solid fa-arrow-left" />
          </button>
        ) : (
          <button className="mr-3 md:hidden" onClick={() => setMenuOpen(v=>!v)} aria-label={t('navigation.menu')}>
            <Avatar username={username || ''} url={resolvedAvatar} size={32} />
          </button>
        )}
        <div className="tracking-[-0.01em] flex-1 min-w-0 relative flex items-center justify-center min-h-[2.5rem]">
          {(() => {
            const t = String(title || '').trim()
            if (!t && titleAccessory) {
              return (
                <div className="pointer-events-none absolute left-1/2 top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 max-w-[min(100%,18rem)]">
                  <span className="pointer-events-auto inline-flex">{titleAccessory}</span>
                </div>
              )
            }
            const full = String(title || '')
            const idx = full.indexOf(' · ')
            if (idx > -1){
              const left = full.slice(0, idx)
              const right = full.slice(idx + 3)
              return (
                <div className="inline-flex max-w-[70%] min-w-0 items-center gap-2">
                  <div className="min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">
                    <span className="font-semibold align-baseline">{left}</span>
                    <span className="text-c-text-tertiary text-[13px] font-normal align-baseline">{` · ${right}`}</span>
                  </div>
                  {titleAccessory ? <span className="flex-shrink-0">{titleAccessory}</span> : null}
                </div>
              )
            }
            return (
              <div className="inline-flex max-w-[70%] min-w-0 items-center gap-2 justify-center">
                <span className="font-semibold truncate align-baseline min-w-0">{full}</span>
                {titleAccessory ? <span className="flex-shrink-0">{titleAccessory}</span> : null}
              </div>
            )
          })()}
        </div>
        <div className="flex items-center gap-2">
          <button className="relative p-2 rounded-full hover:bg-c-hover-bg" onClick={()=> navigate('/user_chat')} aria-label={t('navigation.messages')}>
            <i className="fa-solid fa-comments" />
            {unreadMsgs > 0 ? (<span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-cpoint-turquoise text-black text-[10px] flex items-center justify-center">{unreadMsgs > 99 ? '99+' : unreadMsgs}</span>) : null}
          </button>
          <button className="relative p-2 rounded-full hover:bg-c-hover-bg" onClick={()=> navigate('/notifications')} aria-label={t('navigation.notifications')}>
            <i className="fa-regular fa-bell" />
            {unreadNotifs > 0 ? (<span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-cpoint-turquoise text-black text-[10px] flex items-center justify-center">{unreadNotifs > 99 ? '99+' : unreadNotifs}</span>) : null}
          </button>
        </div>
      </div>

      {/* Persistent left sidebar for web - matches mobile burger menu */}
      {isWeb && (
        <div className="fixed left-0 top-14 bottom-0 w-64 hidden lg:flex flex-col z-30 bg-c-bg-elevated border-r border-c-border shadow-xl overflow-y-auto">
          <div className="p-4">
            <div className="flex items-center gap-2 pb-4 border-b border-c-border mb-4">
              <Avatar username={username || ''} url={resolvedAvatar} size={40} />
              <div className="font-medium truncate text-c-text-primary">{displayName || username || ''}</div>
            </div>

            <nav className="space-y-1">
              {username === 'admin' && (
                <>
                  <a href="/admin_profile_react" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-c-hover-bg text-c-text-primary transition-colors">
                    <i className="fa-solid fa-shield-halved w-5" /> {t('navigation.admin_profile')}
                  </a>
                  <a href="/admin" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-c-hover-bg text-c-text-primary transition-colors">
                    <i className="fa-solid fa-chart-line w-5" /> {t('navigation.admin_dashboard')}
                  </a>
                </>
              )}

              <a href="/premium_dashboard" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-c-hover-bg text-c-text-primary transition-colors">
                <i className="fa-solid fa-house w-5" /> {t('navigation.dashboard')}
              </a>

              <button
                onClick={() => {
                  if (username) navigate(`/profile/${encodeURIComponent(username)}`)
                  else navigate('/profile')
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-c-hover-bg text-c-text-primary transition-colors text-left"
              >
                <i className="fa-solid fa-user w-5" /> {t('navigation.my_profile')}
              </button>

              <button
                onClick={() => navigate('/followers')}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-c-hover-bg text-c-text-primary transition-colors text-left"
              >
                <i className="fa-solid fa-users w-5" /> {t('navigation.followers')}
              </button>

              <button
                onClick={() => navigate('/subscription_plans')}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-c-hover-bg text-c-text-primary transition-colors text-left"
              >
                <i className="fa-solid fa-crown w-5" /> {t('navigation.subscriptions')}
              </button>

              <button
                onClick={requestLogout}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-c-hover-bg text-c-text-primary transition-colors text-left"
              >
                <i className="fa-solid fa-right-from-bracket w-5" /> {t('navigation.logout')}
              </button>

              <a href="/account_settings" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-c-hover-bg text-c-text-primary transition-colors">
                <i className="fa-solid fa-cog w-5" /> {t('navigation.account_settings')}
              </a>
            </nav>
          </div>
        </div>
      )}

      {menuOpen && (
        <BurgerMenuDrawer
          username={username}
          displayName={displayName}
          avatarUrl={resolvedAvatar}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </>
  )
}

