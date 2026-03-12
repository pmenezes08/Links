import { useEffect, useState } from 'react'
import { apiJson } from '../utils/api'
import StatCard from '../components/StatCard'

interface OverviewData {
  total_users: number
  premium_users: number
  total_communities: number
  total_posts: number
  recent_users: { username: string; created_at: string }[]
  recent_communities: { id: number; name: string }[]
}

export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    apiJson<OverviewData>('/api/admin/overview')
      .then(setData)
      .catch(() => setError('Failed to load overview'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-muted text-center py-20">Loading overview...</div>
  if (error) return <div className="text-red-400 text-center py-20">{error}</div>
  if (!data) return null

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Overview</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Users" value={data.total_users} icon="fa-users" />
        <StatCard label="Premium Users" value={data.premium_users} icon="fa-crown" />
        <StatCard label="Communities" value={data.total_communities} icon="fa-people-group" />
        <StatCard label="Total Posts" value={data.total_posts} icon="fa-message" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {data.recent_users && data.recent_users.length > 0 && (
          <div className="bg-surface-2 border border-white/10 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Recent Users</h2>
            <div className="space-y-2">
              {data.recent_users.map(u => (
                <div key={u.username} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                  <div>
                    <span className="text-accent font-medium">@{u.username}</span>
                  </div>
                  {u.created_at && (
                    <span className="text-muted text-xs">{new Date(u.created_at).toLocaleDateString()}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {data.recent_communities && data.recent_communities.length > 0 && (
          <div className="bg-surface-2 border border-white/10 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Recent Communities</h2>
            <div className="space-y-2">
              {data.recent_communities.map(c => (
                <div key={c.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                  <div>
                    <span className="font-medium">{c.name}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
