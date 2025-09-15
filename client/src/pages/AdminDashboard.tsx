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
}

interface Community {
  id: number
  name: string
  type: string
  creator_username: string
  join_code: string
  member_count: number
  is_active: boolean
}

export default function AdminDashboard() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [communities, setCommunities] = useState<Community[]>([])
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'communities' | 'create'>('overview')
  const [loading, setLoading] = useState(true)
  
  // New community form
  const [newCommunity, setNewCommunity] = useState({
    name: '',
    type: 'gym',
    description: '',
    location: ''
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

  const handleCommunityUpdate = async (communityId: number, updates: Partial<Community>) => {
    try {
      const response = await fetch('/api/admin/update_community', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ community_id: communityId, ...updates })
      })
      
      const data = await response.json()
      if (data.success) {
        loadAdminData()
      }
    } catch (error) {
      console.error('Error updating community:', error)
    }
  }

  const handleCreateCommunity = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const response = await fetch('/create_community', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        credentials: 'include',
        body: new URLSearchParams(newCommunity)
      })
      
      const data = await response.json()
      if (data.success) {
        setNewCommunity({ name: '', type: 'gym', description: '', location: '' })
        loadAdminData()
        setActiveTab('communities')
      }
    } catch (error) {
      console.error('Error creating community:', error)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-xl">Loading admin dashboard...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 p-4">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <p className="text-gray-400 text-sm mt-1">Manage your platform</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-800 bg-gray-900/50">
        <div className="flex overflow-x-auto">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'overview'
                ? 'text-[#4db6ac] border-b-2 border-[#4db6ac]'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'users'
                ? 'text-[#4db6ac] border-b-2 border-[#4db6ac]'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Users
          </button>
          <button
            onClick={() => setActiveTab('communities')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'communities'
                ? 'text-[#4db6ac] border-b-2 border-[#4db6ac]'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Communities
          </button>
          <button
            onClick={() => setActiveTab('create')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'create'
                ? 'text-[#4db6ac] border-b-2 border-[#4db6ac]'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Create Community
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Overview Tab */}
        {activeTab === 'overview' && stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-900 rounded-lg p-4">
              <div className="text-3xl font-bold text-[#4db6ac]">{stats.total_users}</div>
              <div className="text-sm text-gray-400 mt-1">Total Users</div>
            </div>
            <div className="bg-gray-900 rounded-lg p-4">
              <div className="text-3xl font-bold text-[#4db6ac]">{stats.premium_users}</div>
              <div className="text-sm text-gray-400 mt-1">Premium Users</div>
            </div>
            <div className="bg-gray-900 rounded-lg p-4">
              <div className="text-3xl font-bold text-[#4db6ac]">{stats.total_communities}</div>
              <div className="text-sm text-gray-400 mt-1">Communities</div>
            </div>
            <div className="bg-gray-900 rounded-lg p-4">
              <div className="text-3xl font-bold text-[#4db6ac]">{stats.total_posts}</div>
              <div className="text-sm text-gray-400 mt-1">Total Posts</div>
            </div>
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="space-y-2">
            {users.map(user => (
              <div key={user.username} className="bg-gray-900 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium">{user.username}</div>
                  <div className="text-sm text-gray-400">
                    {user.subscription} • {user.is_active ? 'Active' : 'Inactive'}
                    {user.is_admin && ' • Admin'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleUserUpdate(user.username, { 
                      subscription: user.subscription === 'premium' ? 'free' : 'premium' 
                    })}
                    className="px-3 py-1 bg-[#4db6ac] text-black rounded-lg text-sm font-medium"
                  >
                    Toggle Premium
                  </button>
                  <button
                    onClick={() => handleUserUpdate(user.username, { 
                      is_active: !user.is_active 
                    })}
                    className={`px-3 py-1 rounded-lg text-sm font-medium ${
                      user.is_active 
                        ? 'bg-red-500 text-white' 
                        : 'bg-green-500 text-white'
                    }`}
                  >
                    {user.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Communities Tab */}
        {activeTab === 'communities' && (
          <div className="space-y-2">
            {communities.map(community => (
              <div key={community.id} className="bg-gray-900 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-medium text-lg">{community.name}</div>
                    <div className="text-sm text-gray-400">
                      Type: {community.type} • Creator: {community.creator_username}
                    </div>
                    <div className="text-sm text-gray-400">
                      Code: {community.join_code} • {community.member_count} members
                    </div>
                  </div>
                  <button
                    onClick={() => handleCommunityUpdate(community.id, { 
                      is_active: !community.is_active 
                    })}
                    className={`px-3 py-1 rounded-lg text-sm font-medium ${
                      community.is_active 
                        ? 'bg-red-500 text-white' 
                        : 'bg-green-500 text-white'
                    }`}
                  >
                    {community.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
                <button
                  onClick={() => navigate(`/community_feed/${community.id}`)}
                  className="text-[#4db6ac] text-sm hover:underline"
                >
                  View Community →
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Create Community Tab */}
        {activeTab === 'create' && (
          <form onSubmit={handleCreateCommunity} className="max-w-lg mx-auto space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Community Name</label>
              <input
                type="text"
                value={newCommunity.name}
                onChange={(e) => setNewCommunity({ ...newCommunity, name: e.target.value })}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg focus:outline-none focus:border-[#4db6ac]"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Type</label>
              <select
                value={newCommunity.type}
                onChange={(e) => setNewCommunity({ ...newCommunity, type: e.target.value })}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg focus:outline-none focus:border-[#4db6ac]"
              >
                <option value="gym">Gym</option>
                <option value="crossfit">CrossFit</option>
                <option value="yoga">Yoga</option>
                <option value="martial_arts">Martial Arts</option>
                <option value="running">Running</option>
                <option value="cycling">Cycling</option>
                <option value="swimming">Swimming</option>
                <option value="other">Other</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Description</label>
              <textarea
                value={newCommunity.description}
                onChange={(e) => setNewCommunity({ ...newCommunity, description: e.target.value })}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg focus:outline-none focus:border-[#4db6ac] h-24"
                placeholder="Optional description..."
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Location</label>
              <input
                type="text"
                value={newCommunity.location}
                onChange={(e) => setNewCommunity({ ...newCommunity, location: e.target.value })}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg focus:outline-none focus:border-[#4db6ac]"
                placeholder="Optional location..."
              />
            </div>
            
            <button
              type="submit"
              className="w-full py-3 bg-[#4db6ac] text-black font-medium rounded-lg hover:bg-[#45a099] transition-colors"
            >
              Create Community
            </button>
          </form>
        )}
      </div>
    </div>
  )
}