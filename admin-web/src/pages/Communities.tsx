import { useEffect, useState } from 'react'
import { apiJson, apiPost } from '../utils/api'

interface Community {
  id: number
  name: string
  creator?: string
  member_count?: number
  created_at?: string
}

export default function Communities() {
  const [communities, setCommunities] = useState<Community[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionMsg, setActionMsg] = useState('')

  const fetchCommunities = () => {
    setLoading(true)
    apiJson<{ communities?: Community[] }>('/api/admin/dashboard')
      .then(d => setCommunities(d.communities ?? []))
      .catch(() => setError('Failed to load communities'))
      .finally(() => setLoading(false))
  }

  useEffect(fetchCommunities, [])

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete community "${name}"?`)) return
    try {
      await apiPost('/api/admin/delete_community', { community_id: id })
      setActionMsg('Community deleted')
      fetchCommunities()
    } catch {
      setActionMsg('Failed to delete community')
    }
    setTimeout(() => setActionMsg(''), 3000)
  }

  if (loading) return <div className="text-muted text-center py-20">Loading communities...</div>
  if (error) return <div className="text-red-400 text-center py-20">{error}</div>

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Communities</h1>

      {actionMsg && (
        <div className="p-3 bg-accent/10 border border-accent/30 rounded-lg text-accent text-sm">{actionMsg}</div>
      )}

      {communities.length === 0 ? (
        <div className="bg-surface-2 border border-white/10 rounded-xl p-8 text-center text-muted">No communities found</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {communities.map(c => (
            <div key={c.id} className="bg-surface-2 border border-white/10 rounded-xl p-4 flex flex-col">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold">{c.name}</h3>
                  {c.creator && <p className="text-muted text-xs mt-0.5">by {c.creator}</p>}
                </div>
                <button onClick={() => handleDelete(c.id, c.name)} className="text-red-400 hover:text-red-300 text-xs p-1" title="Delete">
                  <i className="fa-solid fa-trash" />
                </button>
              </div>
              <div className="mt-auto flex items-center justify-between text-xs text-muted">
                <span><i className="fa-solid fa-users mr-1" />{c.member_count ?? 0} members</span>
                {c.created_at && <span>{new Date(c.created_at).toLocaleDateString()}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
