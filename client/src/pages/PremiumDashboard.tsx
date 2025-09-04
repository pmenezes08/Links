import { useState } from 'react'

// type Community = { id: number; name: string; type: string }

export default function PremiumDashboard() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)


  return (
    <div className="min-h-screen bg-[#0b0f10] text-white">
      {/* Desktop sidebar */}
      <div className="fixed left-0 top-0 h-screen w-52 border-r border-[#333] bg-[#1a1a1a] hidden md:flex flex-col z-50">
        <div className="flex items-center h-14 px-2 border-b border-[#333]">
          <div className="text-white font-semibold text-base truncate pl-2">Dashboard</div>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/dashboard">Dashboard</a>
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/profile">Profile</a>
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/user_chat">Messages</a>
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/communities">Your Communities</a>
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/your_sports">Your Sports</a>
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/logout">Logout</a>
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/account_settings"><i className="fa-solid fa-cog mr-2" />Settings</a>
        </nav>
      </div>

      {/* Header with mobile menu button */}
      <header className="fixed left-0 md:left-52 right-0 top-0 h-14 border-b border-[#333] z-40 bg-black md:bg-transparent flex items-center justify-between px-4">
        <div className="md:hidden font-semibold">Dashboard</div>
        <button
          className="md:hidden px-3 py-2 rounded border border-[#333] bg-[#1a1a1a]"
          aria-label="Menu"
          onClick={() => setMobileMenuOpen((v) => !v)}
        >
          <i className="fa-solid fa-bars" />
        </button>
      </header>

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

      <div className="pt-20 h-screen overflow-hidden">
        {/* Profile summary: hidden on mobile, visible on desktop with translucent styling */}
        <div className="hidden md:flex fixed right-5 top-20 w-44 h-44 rounded-lg border border-[#333] md:border-white/20 bg-[#1a1a1a] md:bg-white/5 flex-col items-center gap-2 p-3">
          <div className="w-20 h-20 rounded-full bg-white/5 border border-white/20 flex items-center justify-center">
            <i className="fa-solid fa-user text-2xl text-[#9fb0b5]" />
          </div>
          <div className="text-sm font-semibold truncate max-w-[10rem]">You</div>
          <button className="px-3 py-1.5 text-xs rounded bg-teal-700/20 text-teal-300 border border-teal-500/40 hover:bg-teal-700/30" onClick={() => (window.location.href = '/profile')}>Edit profile</button>
        </div>

        <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center space-y-4">
          <div>
            <button className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-[#333] md:border-white/10 bg-[#1a1a1a] md:bg-white/5 md:hover:bg-white/10 transition" onClick={() => (location.assign('/communities'))}>
              <i className="fa-solid fa-plus-circle" /> Create/Join a Community
            </button>
          </div>
          <div>
            <button className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-[#333] md:border-white/10 bg-[#1a1a1a] md:bg-white/5 md:hover:bg-white/10 transition" onClick={() => (location.assign('/home'))}>
              <i className="fa-solid fa-home" /> View Your Communities
            </button>
          </div>
          <div>
            <button className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-[#333] md:border-white/10 bg-[#1a1a1a] md:bg-white/5 md:hover:bg-white/10 transition" onClick={() => (location.assign('/your_sports'))}>
              <i className="fa-solid fa-water" /> View Your Sports
            </button>
          </div>
          {/* Optional: a small Edit Profile link on mobile */}
          <div className="md:hidden">
            <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#333] bg-[#1a1a1a]" onClick={() => (location.assign('/profile'))}>
              <i className="fa-solid fa-user" /> Edit profile
            </button>
          </div>
        </div>
      </div>

      {/* Communities modal removed; button links to /communities */}
    </div>
  )
}

