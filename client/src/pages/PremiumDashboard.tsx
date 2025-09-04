import { useEffect, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate } from 'react-router-dom'

// type Community = { id: number; name: string; type: string }

export default function PremiumDashboard() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { setTitle } = useHeader()
  useEffect(() => { setTitle('Dashboard') }, [setTitle])
  const navigate = useNavigate()


  return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-[#f3f4f6] text-white overflow-hidden z-0">
      {/* Desktop sidebar */}
      <div className="fixed left-0 top-0 h-screen w-52 border-r border-[#e5e7eb] bg-white hidden md:flex flex-col z-50 text-black">
        <div className="flex items-center h-14 px-2 border-b border-[#333]">
          <div className="text-black font-semibold text-base truncate pl-2">Dashboard</div>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          <a className="block px-5 py-3 text-sm hover:bg-black/5 hover:text-teal-700 text-black" href="/dashboard">Dashboard</a>
          <a className="block px-5 py-3 text-sm hover:bg-black/5 hover:text-teal-700 text-black" href="/profile">Profile</a>
          <a className="block px-5 py-3 text-sm hover:bg-black/5 hover:text-teal-700 text-black" href="/user_chat">Messages</a>
          <a className="block px-5 py-3 text-sm hover:bg-black/5 hover:text-teal-700 text-black" href="/communities">Your Communities</a>
          <a className="block px-5 py-3 text-sm hover:bg-black/5 hover:text-teal-700 text-black" href="/your_sports">Your Sports</a>
          <a className="block px-5 py-3 text-sm hover:bg-black/5 hover:text-teal-700 text-black" href="/logout">Logout</a>
          <a className="block px-5 py-3 text-sm hover:bg-black/5 hover:text-teal-700 text-black" href="/account_settings"><i className="fa-solid fa-cog mr-2" />Settings</a>
        </nav>
      </div>

      {/* Header handled globally (HeaderBar) */}

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="fixed top-14 left-0 right-0 z-40 border-t border-[#333] bg-[#1a1a1a] md:hidden">
          <nav className="flex flex-col">
            <a className="px-5 py-3 border-b border-[#222]" href="/dashboard" onClick={() => setMobileMenuOpen(false)}>Dashboard</a>
            <a className="px-5 py-3 border-b border-[#222]" href="/profile" onClick={() => setMobileMenuOpen(false)}>Profile</a>
            <a className="px-5 py-3 border-b border-[#222]" href="/user_chat" onClick={() => setMobileMenuOpen(false)}>Messages</a>
            <a className="px-5 py-3 border-b border-[#222]" href="/communities" onClick={() => setMobileMenuOpen(false)}>Your Communities</a>
            <a className="px-5 py-3 border-b border-[#222]" href="/your_sports" onClick={() => setMobileMenuOpen(false)}>Your Sports</a>
            <a className="px-5 py-3 border-b border-[#222]" href="/logout" onClick={() => setMobileMenuOpen(false)}>Logout</a>
            <a className="px-5 py-3" href="/account_settings" onClick={() => setMobileMenuOpen(false)}><i className="fa-solid fa-cog mr-2" />Settings</a>
          </nav>
        </div>
      )}

      <div className="h-full overflow-hidden text-black">
        {/* Desktop profile summary (kept, but edit profile removed) */}
        <div className="hidden md:flex fixed right-5 top-20 w-44 h-44 rounded-lg border border-[#e5e7eb] bg-white flex-col items-center gap-2 p-3">
          <div className="w-20 h-20 rounded-full bg-black/5 border border-black/10 flex items-center justify-center">
            <i className="fa-solid fa-user text-2xl text-[#6b7280]" />
          </div>
          <div className="text-sm font-semibold truncate max-w-[10rem]">You</div>
        </div>

        {/* Cards grid */}
        <div className="h-full flex items-center justify-center px-3 md:ml-52">
          <div className="w-full max-w-5xl grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card iconClass="fa-solid fa-plus" title="Create/Join a Community" onClick={() => (location.assign('/communities'))} />
            <Card iconClass="fa-solid fa-house" title="Your Communities" onClick={() => navigate('/home')} />
            <Card iconClass="fa-solid fa-person-snowboarding" title="Your Sports" onClick={() => navigate('/your_sports')} />
          </div>
        </div>
      </div>

      {/* Communities modal removed; button links to /communities */}
    </div>
  )
}

function Card({ iconClass, title, onClick }:{ iconClass:string; title:string; onClick:()=>void }){
  return (
    <button
      onClick={onClick}
      aria-label={title}
      className="group relative w-full h-40 rounded-2xl overflow-hidden text-white transition-all duration-300
                 bg-gradient-to-b from-[#101619] to-[#0b0f10] border border-white/10 hover:border-teal-400/30
                 shadow-[0_10px_30px_rgba(0,0,0,0.4)] hover:shadow-[0_16px_40px_rgba(0,0,0,0.55)] hover:-translate-y-0.5"
    >
      {/* subtle glow on hover */}
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
           style={{ background: 'radial-gradient(600px circle at var(--x,50%) var(--y,50%), rgba(77,182,172,0.10), transparent 40%)' }} />

      <div className="absolute inset-0 flex flex-col items-center justify-center px-4">
        <div
          className="w-16 h-16 mb-3 rounded-full flex items-center justify-center
                     bg-black/60 border border-white/10 group-hover:border-teal-500/40 transition-colors"
        >
          <i className={iconClass} style={{ fontSize: 22, color: '#4db6ac' }} />
        </div>
        <div className="text-[15px] font-semibold tracking-tight text-white/90">{title}</div>
      </div>

      {/* top accent line */}
      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-teal-400/40 to-transparent opacity-60" />
    </button>
  )
}

