import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

interface Stats {
  total_users: number
  premium_users: number
  total_communities: number
  total_posts: number
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
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'communities'>('overview')
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'premium' | 'free'>('all')
  const [showAddUserModal, setShowAddUserModal] = useState(false)
  
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

  const filteredCommunities = communities.filter(community => 
    community.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    community.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
    community.creator_username.toLowerCase().includes(searchQuery.toLowerCase())
  )
  const filteredFlatCommunities = flatCommunities.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.creator_username.toLowerCase().includes(searchQuery.toLowerCase())
  )

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
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto pt-[70px] h-[calc(100vh-70px)] pb-6 px-3 overflow-y-auto no-scrollbar">
        {/* Overview Tab */}
        {activeTab === 'overview' && stats && (
          <div className="space-y-4">
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
    </div>
  )
}