import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

interface Stats {
  total_users: number
  premium_users: number
  total_communities: number
  total_posts: number
  dau?: number
  mau?: number
  dau_pct?: number
  mau_pct?: number
  avg_dau_30?: number
  leaderboards?: {
    top_posters: { username: string; count: number }[]
    top_reactors: { username: string; count: number }[]
    top_voters: { username: string; count: number }[]
  }
}

interface User {
  username: string
  subscription: string
  is_active: boolean
  is_admin?: boolean
  created_at?: string
}

interface Community {
  id: number
  name: string
  type: string
  creator_username: string
  join_code: string
  member_count: number
  is_active: boolean
  parent_community_id?: number | null
  children?: Community[]
}

export default function AdminDashboard() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [communities, setCommunities] = useState<Community[]>([])
  const flatCommunities: Community[] = (() => {
    const flat: Community[] = []
    for (const parent of communities) {
      flat.push(parent)
      if (parent.children && parent.children.length) {
        for (const child of parent.children) flat.push(child)
      }
    }
    return flat
  })()
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'communities' | 'metrics'>('overview')
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'premium' | 'free'>('all')
  const [showAddUserModal, setShowAddUserModal] = useState(false)
  const [showLogoModal, setShowLogoModal] = useState(false)
  const [currentLogo, setCurrentLogo] = useState<string | null>(null)
  const [logoStatus, setLogoStatus] = useState<'loading' | 'success' | 'error'>('loading')

  // New user form
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    subscription: 'free'
  })

  useEffect(() => {
    setTitle('Admin Dashboard')
    checkAdminAccess()
    loadAdminData()
    loadCurrentLogo()
  }, [setTitle])

  const checkAdminAccess = async () => {
    try {
      const response = await fetch('/api/check_admin', { credentials: 'include' })
      const data = await response.json()
      if (!data.is_admin) {
        navigate('/')
      }
    } catch (error) {
      console.error('Error checking admin access:', error)
      navigate('/')
    }
  }

  const loadAdminData = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/dashboard', { credentials: 'include' })
      const data = await response.json()

      if (data.success) {
        setStats(data.stats)
        setUsers(data.users)
        setCommunities(data.communities)
      }
    } catch (error) {
      console.error('Error loading admin data:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadCurrentLogo = async () => {
    try {
      setLogoStatus('loading')
      const response = await fetch('/get_logo', { credentials: 'include' })
      const data = await response.json()

      if (data.success && data.logo_path) {
        setCurrentLogo(`/static/${data.logo_path}`)
        setLogoStatus('success')
      } else {
        setCurrentLogo(null)
        setLogoStatus('success')
      }
    } catch (error) {
      console.error('Error loading logo:', error)
      setLogoStatus('error')
    }
  }

  const handleLogoUpload = async (file: File) => {
    const formData = new FormData()
    formData.append('logo', file)

    try {
      const response = await fetch('/upload_logo', {
        method: 'POST',
        credentials: 'include',
        body: formData
      })

      const data = await response.json()
      if (data.success) {
        alert('Logo uploaded successfully!')
        loadCurrentLogo()
        setShowLogoModal(false)
      } else {
        alert('Error uploading logo: ' + data.error)
      }
    } catch (error) {
      console.error('Error uploading logo:', error)
      alert('Error uploading logo')
    }
  }

  const handleRemoveLogo = async () => {
    if (!confirm('Are you sure you want to remove the logo?')) return

    try {
      const response = await fetch('/remove_logo', {
        method: 'POST',
        credentials: 'include'
      })

      const data = await response.json()
      if (data.success) {
        alert('Logo removed successfully!')
        loadCurrentLogo()
        setShowLogoModal(false)
      } else {
        alert('Error removing logo: ' + data.error)
      }
    } catch (error) {
      console.error('Error removing logo:', error)
      alert('Error removing logo')
    }
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const response = await fetch('/api/admin/add_user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newUser)
      })
      
      const data = await response.json()
      if (data.success) {
        setShowAddUserModal(false)
        setNewUser({ username: '', password: '', subscription: 'free' })
        loadAdminData()
      } else {
        alert(data.error || 'Failed to add user')
      }
    } catch (error) {
      console.error('Error adding user:', error)
      alert('Failed to add user')
    }
  }

  const handleUserUpdate = async (username: string, updates: Partial<User>) => {
    try {
      const response = await fetch('/api/admin/update_user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, ...updates })
      })
      
      const data = await response.json()
      if (data.success) {
        loadAdminData()
      }
    } catch (error) {
      console.error('Error updating user:', error)
    }
  }

  const handleDeleteUser = async (username: string) => {
    if (!confirm(`Are you sure you want to delete user ${username}?`)) return
    
    try {
      const response = await fetch('/api/admin/delete_user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username })
      })
      
      const data = await response.json()
      if (data.success) {
        loadAdminData()
      }
    } catch (error) {
      console.error('Error deleting user:', error)
    }
  }


  const handleDeleteCommunity = async (communityId: number) => {
    if (!confirm('Are you sure you want to delete this community?')) return
    
    try {
      const response = await fetch('/api/admin/delete_community', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ community_id: communityId })
      })
      
      const data = await response.json()
      if (data.success) {
        loadAdminData()
      }
    } catch (error) {
      console.error('Error deleting community:', error)
    }
  }

  const filteredUsers = users.filter(user => {
    const matchesSearch = user.username.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesFilter = filterType === 'all' || 
      (filterType === 'premium' && user.subscription === 'premium') ||
      (filterType === 'free' && user.subscription === 'free')
    return matchesSearch && matchesFilter
  })

  const filteredCommunities = communities.filter(community => {
    const q = searchQuery.toLowerCase()
    const name = (community.name || '').toLowerCase()
    const type = (community.type || '').toLowerCase()
    const creator = (community.creator_username || '').toLowerCase()
    return name.includes(q) || type.includes(q) || creator.includes(q)
  })
  const filteredFlatCommunities = flatCommunities.filter(c => {
    const q = searchQuery.toLowerCase()
    const name = (c.name || '').toLowerCase()
    const type = (c.type || '').toLowerCase()
    const creator = (c.creator_username || '').toLowerCase()
    return name.includes(q) || type.includes(q) || creator.includes(q)
  })

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-xl">Loading admin dashboard...</div>
      </div>
    )
  }

  return (
    <div className="h-screen overflow-hidden bg-black text-white">
      {/* Secondary nav like Communities page */}
      <div className="fixed left-0 right-0 top-14 h-10 bg-black/70 backdrop-blur z-40">
        <div className="max-w-4xl mx-auto h-full flex">
          <button 
            onClick={() => setActiveTab('overview')}
            className={`flex-1 text-center text-sm font-medium ${
              activeTab === 'overview' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'
            }`}
          >
            <div className="pt-2">Overview</div>
            <div className={`h-0.5 ${activeTab === 'overview' ? 'bg-[#4db6ac]' : 'bg-transparent'} rounded-full w-16 mx-auto mt-1`} />
          </button>
          <button 
            onClick={() => setActiveTab('users')}
            className={`flex-1 text-center text-sm font-medium ${
              activeTab === 'users' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'
            }`}
          >
            <div className="pt-2">Users</div>
            <div className={`h-0.5 ${activeTab === 'users' ? 'bg-[#4db6ac]' : 'bg-transparent'} rounded-full w-16 mx-auto mt-1`} />
          </button>
          <button 
            onClick={() => setActiveTab('communities')}
            className={`flex-1 text-center text-sm font-medium ${
              activeTab === 'communities' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'
            }`}
          >
            <div className="pt-2">Communities</div>
            <div className={`h-0.5 ${activeTab === 'communities' ? 'bg-[#4db6ac]' : 'bg-transparent'} rounded-full w-16 mx-auto mt-1`} />
          </button>
          <button 
            onClick={() => setActiveTab('metrics')}
            className={`flex-1 text-center text-sm font-medium ${
              activeTab === 'metrics' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'
            }`}
          >
            <div className="pt-2">Key Metrics</div>
            <div className={`h-0.5 ${activeTab === 'metrics' ? 'bg-[#4db6ac]' : 'bg-transparent'} rounded-full w-16 mx-auto mt-1`} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto pt-[70px] h-[calc(100vh-70px)] pb-6 px-3 overflow-y-auto no-scrollbar">
        {/* Overview Tab */}
        {activeTab === 'overview' && stats && (
          <div className="space-y-4">
            {/* Logo Management Section */}
            <div className="bg-white/5 backdrop-blur rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold mb-4 text-[#4db6ac]">App Logo Management</h3>

              <div className="flex items-center gap-6">
                <div className="flex flex-col items-center">
                  <div className="text-sm text-white/60 mb-2">Current Logo</div>
                  <div className="w-24 h-16 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center mb-3">
                    {logoStatus === 'loading' ? (
                      <div className="text-xs text-white/60">Loading...</div>
                    ) : currentLogo ? (
                      <img src={currentLogo} alt="Current Logo" className="max-w-full max-h-full object-contain" />
                    ) : (
                      <div className="text-xs text-white/60">No Logo</div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowLogoModal(true)}
                      className="px-3 py-1 text-xs bg-[#4db6ac] text-black rounded-lg hover:bg-[#45a099]"
                    >
                      Change
                    </button>
                    {currentLogo && (
                      <button
                        onClick={handleRemoveLogo}
                        className="px-3 py-1 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1">
                  <div className="grid grid-cols-1 gap-3">
                    <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                      <div className="text-sm font-medium mb-1">Logo Status</div>
                      <div className="text-xs">
                        {logoStatus === 'loading' && <span className="text-white/60">Loading...</span>}
                        {logoStatus === 'success' && currentLogo && <span className="text-[#4db6ac]">Uploaded</span>}
                        {logoStatus === 'success' && !currentLogo && <span className="text-yellow-400">Not Set</span>}
                        {logoStatus === 'error' && <span className="text-red-400">Error</span>}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <button
                      onClick={async () => {
                        try{
                          const r = await fetch('/admin/regenerate_app_icons', { method:'POST', credentials:'include' })
                          const j = await r.json()
                          if (j?.success) {
                            alert('App icons regenerated. Remove and re-add the PWA to update the home screen icon.')
                          } else {
                            alert('Failed to regenerate icons: ' + (j?.error || 'Unknown error'))
                          }
                        }catch(e){ alert('Server error') }
                      }}
                      className="px-3 py-1.5 bg-white/10 border border-white/20 rounded-lg text-sm hover:bg-white/15"
                    >
                      Regenerate App Icons
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Key Metrics removed from overview; available in Metrics tab */}

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
                <div className="text-2xl font-bold text-[#4db6ac]">{stats.total_users}</div>
                <div className="text-xs text-white/60 mt-1">Total Users</div>
              </div>
              <div className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
                <div className="text-2xl font-bold text-[#4db6ac]">{stats.premium_users}</div>
                <div className="text-xs text-white/60 mt-1">Premium Users</div>
              </div>
              <div className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
                <div className="text-2xl font-bold text-[#4db6ac]">{stats.total_communities}</div>
                <div className="text-xs text-white/60 mt-1">Communities</div>
              </div>
              <div className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
                <div className="text-2xl font-bold text-[#4db6ac]">{stats.total_posts}</div>
                <div className="text-xs text-white/60 mt-1">Total Posts</div>
              </div>
            </div>

            {/* Leaderboards removed from overview; available in Metrics tab */}

            {/* Parent Communities Cards */}
            <div>
              <h3 className="text-sm font-semibold mb-3 text-white/80">Parent Communities</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {communities.filter(c => !c.parent_community_id || c.parent_community_id === null).map(community => (
                  <div key={community.id} className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h4 className="font-semibold text-sm">{community.name}</h4>
                        <p className="text-xs text-white/60">{community.type}</p>
                      </div>
                      <span className="text-xs bg-[#4db6ac]/20 text-[#4db6ac] px-2 py-1 rounded">
                        {community.member_count} members
                      </span>
                    </div>
                    
                    {/* Show child communities if any */}
                    {community.children && community.children.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-white/10">
                        <p className="text-xs text-white/60 mb-2">Sub-communities:</p>
                        <div className="space-y-1">
                          {community.children.map(child => (
                            <div key={child.id} className="flex justify-between items-center text-xs">
                              <span className="text-white/80">• {child.name}</span>
                              <span className="text-white/50">{child.member_count} members</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => navigate(`/community_feed_react/${community.id}`)}
                        className="flex-1 py-1 text-xs bg-white/5 border border-white/10 rounded-lg hover:bg-white/10"
                      >
                        View
                      </button>
                      <button
                        onClick={() => setActiveTab('communities')}
                        className="flex-1 py-1 text-xs bg-white/5 border border-white/10 rounded-lg hover:bg-white/10"
                      >
                        Manage
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
              <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={() => { setActiveTab('users'); setShowAddUserModal(true) }}
                  className="py-2 px-3 bg-[#4db6ac]/20 text-[#4db6ac] rounded-lg text-sm font-medium hover:bg-[#4db6ac]/30 transition-colors"
                >
                  Add New User
                </button>
                <button 
                  onClick={() => navigate('/communities')}
                  className="py-2 px-3 bg-[#4db6ac]/20 text-[#4db6ac] rounded-lg text-sm font-medium hover:bg-[#4db6ac]/30 transition-colors"
                >
                  Create Community
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Metrics Tab */}
        {activeTab === 'metrics' && stats && (
          <div className="space-y-4">
            <div className="bg-white/5 backdrop-blur rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold mb-3 text-[#4db6ac]">Key Metrics</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                  <div className="text-xs text-white/60">DAU</div>
                  <div className="text-xl font-bold">{stats.dau ?? '—'}</div>
                  <div className="text-xs text-white/60">{stats.dau_pct != null ? `${stats.dau_pct}% of users` : ''}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                  <div className="text-xs text-white/60">MAU</div>
                  <div className="text-xl font-bold">{stats.mau ?? '—'}</div>
                  <div className="text-xs text-white/60">{stats.mau_pct != null ? `${stats.mau_pct}% of users` : ''}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                  <div className="text-xs text-white/60">Total Users</div>
                  <div className="text-xl font-bold">{stats.total_users}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                  <div className="text-xs text-white/60">Total Communities</div>
                  <div className="text-xl font-bold">{stats.total_communities}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                  <div className="text-xs text-white/60">Avg DAU (30d)</div>
                  <div className="text-xl font-bold">{stats.avg_dau_30 ?? '—'}</div>
                  <div className="text-xs text-white/60">daily avg</div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <div className="text-sm font-semibold mb-2">Top Posters</div>
                <div className="space-y-1 text-sm">
                  {stats.leaderboards?.top_posters?.length ? stats.leaderboards.top_posters.map((u, i) => (
                    <div key={u.username} className="flex items-center justify-between">
                      <span className="text-white/80">{i+1}. {u.username}</span>
                      <span className="text-white/60">{u.count}</span>
                    </div>
                  )) : <div className="text-white/60">No data</div>}
                </div>
              </div>
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <div className="text-sm font-semibold mb-2">Top Reactors</div>
                <div className="space-y-1 text-sm">
                  {stats.leaderboards?.top_reactors?.length ? stats.leaderboards.top_reactors.map((u, i) => (
                    <div key={u.username} className="flex items-center justify-between">
                      <span className="text-white/80">{i+1}. {u.username}</span>
                      <span className="text-white/60">{u.count}</span>
                    </div>
                  )) : <div className="text-white/60">No data</div>}
                </div>
              </div>
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <div className="text-sm font-semibold mb-2">Top Voters</div>
                <div className="space-y-1 text-sm">
                  {stats.leaderboards?.top_voters?.length ? stats.leaderboards.top_voters.map((u, i) => (
                    <div key={u.username} className="flex items-center justify-between">
                      <span className="text-white/80">{i+1}. {u.username}</span>
                      <span className="text-white/60">{u.count}</span>
                    </div>
                  )) : <div className="text-white/60">No data</div>}
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="space-y-3">
            {/* Search and Filter Bar */}
            <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/10 flex items-center gap-2">
              <input
                type="text"
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/40 focus:outline-none focus:border-[#4db6ac]"
              />
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as any)}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#4db6ac]"
              >
                <option value="all">All</option>
                <option value="premium">Premium</option>
                <option value="free">Free</option>
              </select>
              <button
                onClick={() => setShowAddUserModal(true)}
                className="px-3 py-1.5 bg-[#4db6ac] text-black rounded-lg text-sm font-medium hover:bg-[#45a099]"
              >
                Add User
              </button>
            </div>

            {/* Users List */}
            <div className="space-y-2">
              {filteredUsers.map(user => (
                <div key={user.username} className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/10">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-[#4db6ac] rounded-full flex items-center justify-center text-xs font-bold text-black">
                        {user.username[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-sm">{user.username}</div>
                        <div className="text-xs text-white/60">
                          {user.subscription === 'premium' ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#4db6ac]/20 text-[#4db6ac] font-medium">
                              PREMIUM
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-white/10 text-white/60">
                              FREE
                            </span>
                          )}
                          {user.is_admin && (
                            <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-medium">
                              ADMIN
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleUserUpdate(user.username, { 
                          subscription: user.subscription === 'premium' ? 'free' : 'premium' 
                        })}
                        className="px-2 py-1 text-xs rounded-lg bg-white/5 border border-white/10 hover:bg-white/10"
                      >
                        {user.subscription === 'premium' ? 'Downgrade' : 'Upgrade'}
                      </button>
                      {user.username !== 'admin' && (
                        <button
                          onClick={() => handleDeleteUser(user.username)}
                          className="px-2 py-1 text-xs rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Communities Tab */}
        {activeTab === 'communities' && (
          <div className="space-y-3">
            {/* Search Bar */}
            <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/10 flex items-center gap-2">
              <input
                type="text"
                placeholder="Search communities..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/40 focus:outline-none focus:border-[#4db6ac]"
              />
              <button
                onClick={() => navigate('/communities')}
                className="px-3 py-1.5 bg-[#4db6ac] text-black rounded-lg text-sm font-medium hover:bg-[#45a099]"
              >
                Create New
              </button>
            </div>

            {/* Communities List - Show parent communities with their children */}
            <div className="space-y-3">
              {filteredCommunities.filter(c => !c.parent_community_id).map(community => (
                <div key={community.id} className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold text-sm">{community.name}</h3>
                      <p className="text-xs text-white/60">{community.type}</p>
                    </div>
                    <span className="text-xs bg-[#4db6ac]/20 text-[#4db6ac] px-2 py-1 rounded">
                      {community.member_count} members
                    </span>
                  </div>
                  <div className="text-xs text-white/60 mb-3">
                    <div>Creator: {community.creator_username}</div>
                    <div>Code: {community.join_code}</div>
                  </div>
                  
                  {/* Show child communities if any */}
                  {community.children && community.children.length > 0 && (
                    <div className="mb-3 p-2 bg-black/20 rounded-lg">
                      <p className="text-xs text-white/60 mb-2">Sub-communities:</p>
                      <div className="space-y-2">
                        {community.children.map(child => (
                          <div key={child.id} className="flex justify-between items-center">
                            <div className="text-xs">
                              <span className="text-white/80">• {child.name}</span>
                              <span className="text-white/50 ml-2">({child.type})</span>
                            </div>
                            <div className="flex gap-1">
                              <span className="text-xs text-white/50">{child.member_count} members</span>
                              <button
                                onClick={() => navigate(`/community_feed_react/${child.id}`)}
                                className="px-2 py-0.5 text-xs bg-white/5 border border-white/10 rounded hover:bg-white/10"
                              >
                                View
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => navigate(`/community_feed_react/${community.id}`)}
                      className="flex-1 py-1 text-xs bg-white/5 border border-white/10 rounded-lg hover:bg-white/10"
                    >
                      View
                    </button>
                    <button
                      onClick={() => handleDeleteCommunity(community.id)}
                      className="px-2 py-1 text-xs rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Flat list of all communities with delete */}
            <div className="mt-6">
              <h4 className="text-sm font-semibold mb-2 text-white/80">All Communities (flat list)</h4>
              <div className="space-y-2">
                {filteredFlatCommunities.map(c => (
                  <div key={c.id} className="flex items-center justify-between bg-white/5 rounded-lg p-2 border border-white/10">
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 bg-[#4db6ac]/30 text-[#4db6ac] rounded flex items-center justify-center text-[10px] font-bold">
                        {c.name.substring(0,2).toUpperCase()}
                      </div>
                      <div className="text-xs">
                        <div className="text-white/90 font-medium">{c.name}</div>
                        <div className="text-white/50">{c.type}{c.parent_community_id ? ` — child of ${c.parent_community_id}` : ' — parent'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate(`/community_feed_react/${c.id}`)}
                        className="px-2 py-1 text-xs bg-white/5 border border-white/10 rounded hover:bg-white/10"
                      >
                        View
                      </button>
                      <button
                        onClick={() => handleDeleteCommunity(c.id)}
                        className="px-2 py-1 text-xs rounded bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] rounded-xl p-6 w-full max-w-md border border-white/10">
            <h2 className="text-lg font-semibold mb-4">Add New User</h2>
            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block text-xs text-white/60 mb-1">Username</label>
                <input
                  type="text"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-[#4db6ac]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Password</label>
                <input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-[#4db6ac]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Subscription</label>
                <select
                  value={newUser.subscription}
                  onChange={(e) => setNewUser({ ...newUser, subscription: e.target.value })}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-[#4db6ac]"
                >
                  <option value="free">Free</option>
                  <option value="premium">Premium</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#4db6ac] text-black rounded-lg font-medium hover:bg-[#45a099]"
                >
                  Add User
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddUserModal(false)
                    setNewUser({ username: '', password: '', subscription: 'free' })
                  }}
                  className="flex-1 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Logo Upload Modal */}
      {showLogoModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] rounded-xl p-6 w-full max-w-md border border-white/10">
            <h2 className="text-lg font-semibold mb-4">Change App Logo</h2>

            {/* Current Logo Preview */}
            <div className="mb-4">
              <div className="text-sm text-white/60 mb-2">Current Logo</div>
              <div className="w-full h-20 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center mb-3">
                {currentLogo ? (
                  <img src={currentLogo} alt="Current Logo" className="max-w-full max-h-full object-contain" />
                ) : (
                  <div className="text-sm text-white/60">No logo uploaded</div>
                )}
              </div>
            </div>

            {/* Upload Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const fileInput = document.getElementById('logoFile') as HTMLInputElement
                if (fileInput?.files?.[0]) {
                  handleLogoUpload(fileInput.files[0])
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm text-white/60 mb-1">Select New Logo</label>
                <input
                  id="logoFile"
                  type="file"
                  accept="image/*"
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-[#4db6ac]"
                  required
                />
                <div className="text-xs text-white/40 mt-1">Supported formats: PNG, JPG, SVG, WEBP (Max 200×100px)</div>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#4db6ac] text-black rounded-lg font-medium hover:bg-[#45a099]"
                >
                  Upload Logo
                </button>
                <button
                  type="button"
                  onClick={() => setShowLogoModal(false)}
                  className="flex-1 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}