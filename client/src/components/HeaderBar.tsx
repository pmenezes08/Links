import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

type HeaderBarProps = {
  title: string
  username?: string
  avatarUrl?: string | null
}

export default function HeaderBar({ title, username, avatarUrl }: HeaderBarProps){
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const resolvedAvatar = avatarUrl
    ? ((avatarUrl.startsWith('http') || avatarUrl.startsWith('/static')) ? avatarUrl : `/static/${avatarUrl}`)
    : null

  return (
    <>
      <div className="fixed left-0 right-0 top-0 h-14 border-b border-[#262f30] bg-black/70 backdrop-blur flex items-center px-3 z-40 text-white">
        <button className="mr-3 md:hidden" onClick={() => setMenuOpen(v=>!v)} aria-label="Menu">
          <div className="w-8 h-8 rounded-full bg-white/10 overflow-hidden">
            {resolvedAvatar ? (
              <img src={resolvedAvatar} alt="" className="w-full h-full object-cover" />
            ) : (<i className="fa-solid fa-user" />)}
          </div>
        </button>
        <div className="font-semibold truncate tracking-[-0.01em] flex-1">{title}</div>
        <div className="flex items-center gap-2">
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> navigate('/user_chat')} aria-label="Messages">
            <i className="fa-solid fa-cloud" />
          </button>
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> navigate('/notifications')} aria-label="Notifications">
            <i className="fa-regular fa-bell" />
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-[90] flex bg-black/50" onClick={(e)=> e.currentTarget===e.target && setMenuOpen(false)}>
          <div className="w-[90%] h-full bg-black/95 backdrop-blur border-r border-white/10 p-4 space-y-3 text-white">
            <div className="flex items-center gap-2 pb-2 border-b border-white/10">
              <div className="w-10 h-10 rounded-full overflow-hidden bg-white/10">
                {resolvedAvatar ? (
                  <img src={resolvedAvatar} alt="" className="w-full h-full object-cover" />
                ) : (<i className="fa-solid fa-user" />)}
              </div>
              <div className="font-medium truncate">{username || ''}</div>
            </div>
            {username === 'admin' ? (
              <>
                <a className="block px-4 py-3 rounded-xl hover:bg-white/5 text-white" href="/admin_profile">Admin Profile</a>
                <a className="block px-4 py-3 rounded-xl hover:bg-white/5 text-white" href="/admin">Admin Dashboard</a>
              </>
            ) : null}
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5 text-white" href="/dashboard">Dashboard</a>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5 text-white" href="/profile">Profile</a>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5 text-white" href="/user_chat">Messages</a>
            <button className="block w-full text-left px-4 py-3 rounded-xl hover:bg-white/5 text-white" onClick={()=> { setMenuOpen(false); navigate('/communities') }}>Your Communities</button>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5 text-white" href="/your_sports">Your Sports</a>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5 text-white" href="/logout">Logout</a>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5 text-white" href="/account_settings">Settings</a>
          </div>
          <div className="flex-1 h-full" onClick={()=> setMenuOpen(false)} />
        </div>
      )}
    </>
  )
}

