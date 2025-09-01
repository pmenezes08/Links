import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

type Community = { id: number; name: string; type: string }

function fetchUserCommunities(): Promise<{ success: boolean; communities: Community[] }> {
  return fetch('/get_user_communities', { credentials: 'include' }).then((r) => r.json())
}

export default function PremiumDashboard() {
  const [modalOpen, setModalOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['user-communities'],
    queryFn: fetchUserCommunities,
    enabled: modalOpen,
  })

  const communities = data?.communities ?? []

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
            <button className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-[#333] md:border-white/10 bg-[#1a1a1a] md:bg-white/5 md:hover:bg-white/10 transition" onClick={() => (window.location.href = '/communities')}>
              <i className="fa-solid fa-plus-circle" /> Create/Join a Community
            </button>
          </div>
          <div>
            <button className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-[#333] md:border-white/10 bg-[#1a1a1a] md:bg-white/5 md:hover:bg-white/10 transition" onClick={() => setModalOpen(true)}>
              <i className="fa-solid fa-home" /> View Your Communities
            </button>
          </div>
          <div>
            <button className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-[#333] md:border-white/10 bg-[#1a1a1a] md:bg-white/5 md:hover:bg-white/10 transition" onClick={() => (window.location.href = '/your_sports')}>
              <i className="fa-solid fa-water" /> View Your Sports
            </button>
          </div>
          {/* Optional: a small Edit Profile link on mobile */}
          <div className="md:hidden">
            <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#333] bg-[#1a1a1a]" onClick={() => (window.location.href = '/profile')}>
              <i className="fa-solid fa-user" /> Edit profile
            </button>
          </div>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur" onClick={(e) => e.currentTarget === e.target && setModalOpen(false)}>
          <div className="w-[90%] max-w-[600px] rounded-xl bg-[#2d3839] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-teal-700/30 bg-black">
              <h3 className="text-base font-semibold flex items-center gap-2"><i className="fa-solid fa-home text-teal-300" /> Your Communities</h3>
              <button className="text-2xl text-[#9fb0b5] hover:text-white" onClick={() => setModalOpen(false)}>&times;</button>
            </div>
            <div className="p-4 max-h-[380px] overflow-y-auto">
              {isLoading ? (
                <div className="text-center text-[#9fb0b5]">Loading...</div>
              ) : communities.length === 0 ? (
                <div className="text-center text-[#9fb0b5]">
                  <i className="fa-solid fa-users text-4xl mb-2 block" />
                  <div className="text-sm text-white mb-1">No communities yet</div>
                  <div className="text-xs">Join an existing community or create your own to get started</div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {communities.map((c) => (
                    <div key={c.id} className="rounded-md border border-white/10 bg-white/5 p-3">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 pr-3">
                          <div className="text-sm text-white truncate">{c.name}</div>
                          <div className="text-[11px] text-[#9fb0b5] mt-0.5"><i className="fa-solid fa-tag text-[10px]" /> {c.type}</div>
                        </div>
                        <button className="px-3 py-1.5 text-xs rounded border border-white/10 bg-white/5 hover:bg-white/10" onClick={() => (window.location.href = `/community_feed/${c.id}`)}>
                          <i className="fa-solid fa-door-open text-[11px]" /> Enter
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

