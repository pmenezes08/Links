import { useEffect, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'

// type Community = { id: number; name: string; type: string }

export default function PremiumDashboard() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { setTitle } = useHeader()
  useEffect(() => { setTitle('Dashboard') }, [setTitle])


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

      <div className="pt-16 h-screen overflow-hidden">
        {/* Desktop profile summary (kept, but edit profile removed) */}
        <div className="hidden md:flex fixed right-5 top-20 w-44 h-44 rounded-lg border border-[#333] md:border-white/20 bg-[#1a1a1a] md:bg-white/5 flex-col items-center gap-2 p-3">
          <div className="w-20 h-20 rounded-full bg-white/5 border border-white/20 flex items-center justify-center">
            <i className="fa-solid fa-user text-2xl text-[#9fb0b5]" />
          </div>
          <div className="text-sm font-semibold truncate max-w-[10rem]">You</div>
        </div>

        {/* Mobile-first full-height buttons */}
        <div className="block md:hidden h-[calc(100vh-64px)] px-3">
          <div className="flex flex-col gap-3 h-full">
            <button className="flex-1 w-full rounded-2xl border border-[#4db6ac] text-white bg-black/40 flex items-center justify-center text-lg" onClick={() => (location.assign('/communities'))}>
              <i className="fa-solid fa-plus-circle mr-2" /> Create/Join a Community
            </button>
            <button className="flex-1 w-full rounded-2xl border border-[#4db6ac] text-white bg-black/40 flex items-center justify-center text-lg" onClick={() => (location.assign('/home'))}>
              <i className="fa-solid fa-home mr-2" /> View Your Communities
            </button>
            <button className="flex-1 w-full rounded-2xl border border-[#4db6ac] text-white bg-black/40 flex items-center justify-center text-lg" onClick={() => (location.assign('/your_sports'))}>
              <i className="fa-solid fa-water mr-2" /> View Your Sports
            </button>
          </div>
        </div>

        {/* Fallback for larger screens: center but not full height */}
        <div className="hidden md:flex items-center justify-center h-full">
          <div className="w-[420px] max-w-[92%] space-y-3 text-center">
            <button className="w-full rounded-2xl border border-[#4db6ac] text-white bg-black/40 px-6 py-3" onClick={() => (location.assign('/communities'))}>
              <i className="fa-solid fa-plus-circle mr-2" /> Create/Join a Community
            </button>
            <button className="w-full rounded-2xl border border-[#4db6ac] text-white bg-black/40 px-6 py-3" onClick={() => (location.assign('/home'))}>
              <i className="fa-solid fa-home mr-2" /> View Your Communities
            </button>
            <button className="w-full rounded-2xl border border-[#4db6ac] text-white bg-black/40 px-6 py-3" onClick={() => (location.assign('/your_sports'))}>
              <i className="fa-solid fa-water mr-2" /> View Your Sports
            </button>
          </div>
        </div>
      </div>

      {/* Communities modal removed; button links to /communities */}
    </div>
  )
}

