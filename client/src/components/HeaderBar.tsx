import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import Avatar from './Avatar'
import { handleLogoutClick } from '../utils/logout'
import { useBadges } from '../contexts/BadgeContext'

type HeaderBarProps = {
  title: string
  username?: string
  displayName?: string
  avatarUrl?: string | null
}

export default function HeaderBar({ title, username, displayName, avatarUrl }: HeaderBarProps){
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const { unreadMsgs, unreadNotifs } = useBadges()
  const isWeb = typeof window !== 'undefined' ? Capacitor.getPlatform() === 'web' : false

  // PWA install prompt wiring
  // PWA install hooks removed here

  // Install handler moved to login page

  const resolvedAvatar = avatarUrl
    ? ((avatarUrl.startsWith('http') || avatarUrl.startsWith('/static')) ? avatarUrl : `/static/${avatarUrl}`)
    : null

  const showBack = location.pathname === '/notifications'
  const goBack = () => {
    if (window.history.length > 1) { navigate(-1) } else { navigate('/home') }
  }

  return (
    <>
      <div className="header-with-safe-area fixed left-0 right-0 top-0 h-14 border-b border-[#262f30] bg-black flex items-center px-3 z-[1000] text-white will-change-transform">
        {showBack ? (
          <button className="mr-2 p-2 rounded-full hover:bg-white/5" onClick={goBack} aria-label="Back">
            <i className="fa-solid fa-arrow-left" />
          </button>
        ) : (
          <button className="mr-3 md:hidden" onClick={() => setMenuOpen(v=>!v)} aria-label="Menu">
            <Avatar username={username || ''} url={resolvedAvatar} size={32} />
          </button>
        )}
        <div className="tracking-[-0.01em] flex-1 min-w-0 text-center">
          {(() => {
            const t = String(title || '')
            const idx = t.indexOf(' · ')
            if (idx > -1){
              const left = t.slice(0, idx)
              const right = t.slice(idx + 3)
              return (
                <div className="inline-block max-w-[75%] whitespace-nowrap overflow-hidden text-ellipsis align-middle">
                  <span className="font-semibold truncate align-baseline">{left}</span>
                  <span className="text-[#9fb0b5] text-[13px] font-normal align-baseline">{` · ${right}`}</span>
                </div>
              )
            }
            return (
              <span className="font-semibold truncate inline-block align-baseline">
                {t}
              </span>
            )
          })()}
        </div>
        <div className="flex items-center gap-2">
          <button className="relative p-2 rounded-full hover:bg-white/5" onClick={()=> navigate('/user_chat')} aria-label="Messages">
            <i className="fa-solid fa-comments" />
            {unreadMsgs > 0 ? (<span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#4db6ac] text-black text-[10px] flex items-center justify-center">{unreadMsgs > 99 ? '99+' : unreadMsgs}</span>) : null}
          </button>
          <button className="relative p-2 rounded-full hover:bg-white/5" onClick={()=> navigate('/notifications')} aria-label="Notifications">
            <i className="fa-regular fa-bell" />
            {unreadNotifs > 0 ? (<span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#4db6ac] text-black text-[10px] flex items-center justify-center">{unreadNotifs > 99 ? '99+' : unreadNotifs}</span>) : null}
          </button>
        </div>
      </div>

      {/* Persistent left sidebar for web - matches mobile burger menu */}
      {isWeb && (
        <div className="fixed left-0 top-14 bottom-0 w-64 hidden lg:flex flex-col z-30 bg-[#0a0a0c] border-r border-white/10 shadow-xl overflow-y-auto">
          <div className="p-4">
            <div className="flex items-center gap-2 pb-4 border-b border-white/10 mb-4">
              <Avatar username={username || ''} url={resolvedAvatar} size={40} />
              <div className="font-medium truncate text-white">{displayName || username || ''}</div>
            </div>

            <nav className="space-y-1">
              {username === 'admin' && (
                <>
                  <a href="/admin_profile_react" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-white transition-colors">
                    <i className="fa-solid fa-shield-halved w-5" /> Admin Profile
                  </a>
                  <a href="/admin" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-white transition-colors">
                    <i className="fa-solid fa-chart-line w-5" /> Admin Dashboard
                  </a>
                </>
              )}

              <a href="/premium_dashboard" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-white transition-colors">
                <i className="fa-solid fa-house w-5" /> Dashboard
              </a>

              <button
                onClick={() => {
                  if (username) navigate(`/profile/${encodeURIComponent(username)}`)
                  else navigate('/profile')
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-white transition-colors text-left"
              >
                <i className="fa-solid fa-user w-5" /> My Profile
              </button>

              <button
                onClick={() => navigate('/followers')}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-white transition-colors text-left"
              >
                <i className="fa-solid fa-users w-5" /> Followers
              </button>

              <button
                onClick={() => navigate('/networking')}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-white transition-colors text-left"
              >
                <i className="fa-solid fa-network-wired w-5" /> Networking
              </button>

              <button
                onClick={handleLogoutClick}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-white transition-colors text-left"
              >
                <i className="fa-solid fa-right-from-bracket w-5" /> Logout
              </button>

              <a href="/account_settings" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-white transition-colors">
                <i className="fa-solid fa-cog w-5" /> Account Settings
              </a>
            </nav>
          </div>
        </div>
      )}

        {menuOpen && (
        <div className="fixed inset-0 z-[90] flex bg-black/50" onClick={(e)=> e.currentTarget===e.target && setMenuOpen(false)} style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="w-[90%] h-full bg-black/95 backdrop-blur border-r border-white/10 p-4 space-y-3 text-white overflow-y-auto overscroll-auto" style={{ paddingTop: '1rem', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="flex items-center gap-2 pb-2 border-b border-white/10">
              <Avatar username={username || ''} url={resolvedAvatar} size={40} />
              <div className="font-medium truncate">{displayName || username || ''}</div>
            </div>
            {/* Install action moved to login page */}
            {username === 'admin' ? (
              <>
                <a className="block px-4 py-3 rounded-xl hover:bg:white/5 text-white" href="/admin_profile_react">Admin Profile</a>
                <a className="block px-4 py-3 rounded-xl hover:bg:white/5 text-white" href="/admin">Admin Dashboard</a>
              </>
            ) : null}
              <a className="block px-4 py-3 rounded-xl hover:bg:white/5 text-white" href="/premium_dashboard">Dashboard</a>
              <button
                className="block w-full text-left px-4 py-3 rounded-xl hover:bg:white/5 text-white"
                onClick={() => {
                  setMenuOpen(false)
                  if (username) navigate(`/profile/${encodeURIComponent(username)}`)
                  else navigate('/profile')
                }}
              >
                My Profile
              </button>
                <button className="block w-full text-left px-4 py-3 rounded-xl hover:bg:white/5 text:white" onClick={()=> { setMenuOpen(false); navigate('/followers') }}>Followers</button>
                <button className="block w-full text-left px-4 py-3 rounded-xl hover:bg-white/5 text-white" onClick={()=> { setMenuOpen(false); navigate('/networking') }}>Networking</button>
            <button className="block w-full text-left px-4 py-3 rounded-xl hover:bg-white/5 text-white" onClick={handleLogoutClick}>Logout</button>
              <a className="block px-4 py-3 rounded-xl hover:bg-white/5 text-white" href="/account_settings">Account Settings</a>
          </div>
          <div className="flex-1 h-full" onClick={()=> setMenuOpen(false)} />
        </div>
      )}
    </>
  )
}

