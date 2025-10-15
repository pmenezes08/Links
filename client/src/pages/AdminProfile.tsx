import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

interface Stats {
  total_users: number
  total_posts: number
  total_communities: number
  premium_users: number
}

interface AdminInfo {
  username: string
  email?: string
  first_name?: string
  last_name?: string
  subscription?: string
  created_at?: string
  profile_picture?: string | null
}

export default function AdminProfile(){
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [admin, setAdmin] = useState<AdminInfo | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => { setTitle('Admin Profile') }, [setTitle])
  useEffect(() => { load() }, [])

  async function load(){
    setLoading(true)
    try{
      // Ensure only admin can access
      const a = await fetch('/api/check_admin', { credentials:'include' })
      const aj = await a.json()
      if (!aj?.is_admin){ navigate('/'); return }

      const r = await fetch('/api/admin/profile', { credentials:'include' })
      const j = await r.json()
      if (j?.success){
        setAdmin(j.admin)
        setStats(j.stats)
      } else {
        alert(j?.error || 'Failed to load admin profile')
        navigate('/')
      }
    }catch(e){
      console.error('Load admin profile error', e)
      navigate('/')
    }finally{
      setLoading(false)
    }
  }

  if (loading){
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-xl">Loading admin profile...</div>
      </div>
    )
  }

  if (!admin || !stats){
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-xl">Unauthorized</div>
      </div>
    )
  }

  const displayName = [admin.first_name, admin.last_name].filter(Boolean).join(' ') || admin.username

  return (
    <div className="h-screen overflow-hidden bg-black text-white">
      <div className="max-w-3xl mx-auto h-[calc(100vh-56px)] overflow-y-auto no-scrollbar px-4 py-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-4 bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-white/10 flex items-center justify-center">
            {admin.profile_picture ? (
              <img src={admin.profile_picture.startsWith('http') ? admin.profile_picture : `/static/${admin.profile_picture}`} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              <div className="text-2xl font-bold text-[#4db6ac]">{admin.username[0].toUpperCase()}</div>
            )}
          </div>
          <div>
            <div className="text-lg font-semibold">{displayName}</div>
            <div className="text-sm text-white/60">{admin.email || '—'}</div>
            <div className="text-xs text-white/50">Joined: {admin.created_at ? new Date(admin.created_at).toLocaleDateString() : '—'}</div>
          </div>
        </div>

        {/* Stats */}
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

        {/* Links */}
        <div className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
          <div className="text-sm font-semibold mb-3">Admin Links</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <a href="/admin_dashboard" className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10">Dashboard</a>
            <a href="/communities" className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10">Manage Communities</a>
          </div>
        </div>
      </div>
    </div>
  )
}
