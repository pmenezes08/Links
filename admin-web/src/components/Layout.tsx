import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api } from '../utils/api'

const navItems = [
  { to: '/', icon: 'fa-chart-line', label: 'Overview' },
  { to: '/users', icon: 'fa-users', label: 'Users' },
  { to: '/communities', icon: 'fa-people-group', label: 'Communities' },
  { to: '/metrics', icon: 'fa-chart-bar', label: 'Metrics' },
  { to: '/reports', icon: 'fa-flag', label: 'Reports' },
  { to: '/blocked', icon: 'fa-ban', label: 'Blocked' },
  { to: '/invites', icon: 'fa-envelope', label: 'Invites' },
  { to: '/broadcast', icon: 'fa-bullhorn', label: 'Broadcast' },
  { to: '/settings', icon: 'fa-gear', label: 'Settings' },
]

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const navigate = useNavigate()

  const handleLogout = async () => {
    try { await api('/logout') } catch {}
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-black flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 bg-surface border-r border-white/10 fixed inset-y-0">
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-black font-bold text-sm">C</div>
            <span className="font-semibold">C.Point Admin</span>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {navItems.map(item => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${isActive ? 'bg-accent/10 text-accent' : 'text-white/70 hover:bg-white/5'}`}>
              <i className={`fa-solid ${item.icon} w-5 text-center text-xs`} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-2 border-t border-white/10">
          <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-red-400 hover:bg-white/5 w-full">
            <i className="fa-solid fa-right-from-bracket w-5 text-center text-xs" />
            Logout
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-surface border-b border-white/10 z-50 flex items-center px-4 justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-black font-bold text-xs">C</div>
          <span className="font-semibold text-sm">Admin</span>
        </div>
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2"><i className="fa-solid fa-bars" /></button>
      </div>

      {/* Mobile slide-out menu */}
      {sidebarOpen && (
        <>
          <div className="md:hidden fixed inset-0 bg-black/60 z-50" onClick={() => setSidebarOpen(false)} />
          <div className="md:hidden fixed right-0 top-0 bottom-0 w-64 bg-surface z-50 p-4 space-y-1">
            <div className="flex justify-between items-center mb-4">
              <span className="font-semibold">Menu</span>
              <button onClick={() => setSidebarOpen(false)} className="p-2"><i className="fa-solid fa-xmark" /></button>
            </div>
            {navItems.map(item => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={() => setSidebarOpen(false)} className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${isActive ? 'bg-accent/10 text-accent' : 'text-white/70'}`}>
                <i className={`fa-solid ${item.icon} w-5 text-center text-xs`} />
                {item.label}
              </NavLink>
            ))}
            <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-red-400 w-full mt-4">
              <i className="fa-solid fa-right-from-bracket w-5 text-center text-xs" />
              Logout
            </button>
          </div>
        </>
      )}

      {/* Main content */}
      <main className="flex-1 md:ml-56 pt-14 md:pt-0 min-h-screen">
        <div className="p-4 md:p-6 max-w-6xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
