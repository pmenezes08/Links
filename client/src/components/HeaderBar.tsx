import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Avatar from './Avatar'

type HeaderBarProps = {
  title: string
  username?: string
  avatarUrl?: string | null
}

export default function HeaderBar({ title, username, avatarUrl }: HeaderBarProps){
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [unreadMsgs, setUnreadMsgs] = useState<number>(0)
  const [unreadNotifs, setUnreadNotifs] = useState<number>(0)

  // Light polling for unread counts
  // Using window.setInterval to avoid importing useEffect here per minimal diff constraints
  if (typeof window !== 'undefined' && !(window as any).__header_poll){
    ;(window as any).__header_poll = true
    const poll = async () => {
      let msgs = 0
      let notifs = 0
      try{
        // Unread messages
        const m = await fetch('/check_unread_messages', { credentials:'include' })
        const mj = await m.json().catch(()=>null)
        if (mj && typeof mj.unread_count === 'number') { msgs = mj.unread_count; setUnreadMsgs(mj.unread_count) }
      }catch{}
      try{
        // Unread notifications
        const n = await fetch('/api/notifications', { credentials:'include' })
        const nj = await n.json().catch(()=>null)
        if (nj?.success && Array.isArray(nj.notifications)){
          const cnt = nj.notifications.filter((x:any)=> x && x.is_read === false).length
          notifs = cnt
          setUnreadNotifs(cnt)
        }
      }catch{}
      // Update app icon badge where supported (Android/desktop). iOS currently does not support Badging API for PWAs.
      try{
        const total = msgs + notifs
        const navAny: any = navigator as any
        if (total > 0){
          if (typeof navAny.setAppBadge === 'function') navAny.setAppBadge(total)
          else if (typeof navAny.setExperimentalAppBadge === 'function') navAny.setExperimentalAppBadge(total)
        }else{
          if (typeof navAny.clearAppBadge === 'function') navAny.clearAppBadge()
          else if (typeof navAny.setExperimentalAppBadge === 'function') navAny.setExperimentalAppBadge(0)
        }
      }catch{}
    }
    ;(window as any).__header_do_poll = poll
    poll()
    setInterval(poll, 5000)
  }

  const resolvedAvatar = avatarUrl
    ? ((avatarUrl.startsWith('http') || avatarUrl.startsWith('/static')) ? avatarUrl : `/static/${avatarUrl}`)
    : null

  const showBack = location.pathname === '/notifications'
  const goBack = () => {
    if (window.history.length > 1) { navigate(-1) } else { navigate('/home') }
  }

  return (
    <>
      <div className="fixed left-0 right-0 top-0 h-14 border-b border-[#262f30] bg-black flex items-center px-3 z-[100] text-white will-change-transform">
        {showBack ? (
          <button className="mr-2 p-2 rounded-full hover:bg-white/5" onClick={goBack} aria-label="Back">
            <i className="fa-solid fa-arrow-left" />
          </button>
        ) : (
          <button className="mr-3 md:hidden" onClick={() => setMenuOpen(v=>!v)} aria-label="Menu">
            <Avatar username={username || ''} url={resolvedAvatar} size={32} />
          </button>
        )}
        <div className="font-semibold truncate tracking-[-0.01em] flex-1">{title}</div>
        <div className="flex items-center gap-2">
          {location.pathname === '/user_chat' && (
            <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> navigate('/user_chat/new')} aria-label="New Message">
              <i className="fa-solid fa-plus" />
            </button>
          )}
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

      {menuOpen && (
        <div className="fixed inset-0 z-[90] flex bg-black/50" onClick={(e)=> e.currentTarget===e.target && setMenuOpen(false)}>
          <div className="w-[90%] h-full bg-black/95 backdrop-blur border-r border-white/10 p-4 space-y-3 text-white">
            <div className="flex items-center gap-2 pb-2 border-b border-white/10">
              <Avatar username={username || ''} url={resolvedAvatar} size={40} />
              <div className="font-medium truncate">{username || ''}</div>
            </div>
            {username === 'admin' ? (
              <>
                <a className="block px-4 py-3 rounded-xl hover:bg:white/5 text-white" href="/admin_profile">Admin Profile</a>
                <a className="block px-4 py-3 rounded-xl hover:bg:white/5 text-white" href="/admin">Admin Dashboard</a>
              </>
            ) : null}
            <a className="block px-4 py-3 rounded-xl hover:bg:white/5 text-white" href="/dashboard">Dashboard</a>
            <a className="block px-4 py-3 rounded-xl hover:bg:white/5 text-white" href="/profile">Profile</a>
            <a className="block px-4 py-3 rounded-xl hover:bg:white/5 text:white" href="/user_chat">Messages</a>
            <button className="block w-full text-left px-4 py-3 rounded-xl hover:bg:white/5 text-white" onClick={()=> { setMenuOpen(false); navigate('/communities') }}>Your Communities</button>
            <a className="block px-4 py-3 rounded-xl hover:bg:white/5 text-white" href="/your_sports">Your Sports</a>
            <a className="block px-4 py-3 rounded-xl hover:bg:white/5 text-white" href="/logout">Logout</a>
            <a className="block px-4 py-3 rounded-xl hover:bg:white/5 text-white" href="/account_settings">Settings</a>
          </div>
          <div className="flex-1 h-full" onClick={()=> setMenuOpen(false)} />
        </div>
      )}
    </>
  )
}

