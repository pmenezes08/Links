import { useEffect, useState } from 'react'
import { apiJson, apiPost } from '../utils/api'

interface BlockedEntry {
  id: number
  blocker_username: string
  blocked_username: string
  reason?: string
  blocked_at?: string
}

export default function Blocked() {
  const [entries, setEntries] = useState<BlockedEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionMsg, setActionMsg] = useState('')

  const fetchBlocked = () => {
    setLoading(true)
    apiJson<BlockedEntry[] | { blocked_users?: BlockedEntry[] }>('/api/admin/all_blocked_users')
      .then(d => setEntries(Array.isArray(d) ? d : d.blocked_users ?? []))
      .catch(() => setError('Failed to load blocked users'))
      .finally(() => setLoading(false))
  }

  useEffect(fetchBlocked, [])

  const handleUnblock = async (blockId: number) => {
    if (!confirm('Unblock this user?')) return
    try {
      await apiPost('/api/admin/unblock_user', { block_id: blockId })
      setActionMsg('User unblocked')
      fetchBlocked()
    } catch { setActionMsg('Failed to unblock user') }
    setTimeout(() => setActionMsg(''), 3000)
  }

  if (loading) return <div className="text-muted text-center py-20">Loading blocked users...</div>
  if (error) return <div className="text-red-400 text-center py-20">{error}</div>

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Blocked Users</h1>

      {actionMsg && (
        <div className="p-3 bg-accent/10 border border-accent/30 rounded-lg text-accent text-sm">{actionMsg}</div>
      )}

      {entries.length === 0 ? (
        <div className="bg-surface-2 border border-white/10 rounded-xl p-8 text-center text-muted">No blocked users</div>
      ) : (
        <div className="bg-surface-2 border border-white/10 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Blocker</th>
                  <th className="text-left px-4 py-3">Blocked</th>
                  <th className="text-left px-4 py-3 hidden sm:table-cell">Reason</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Date</th>
                  <th className="text-right px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-3 text-accent">@{e.blocker_username}</td>
                    <td className="px-4 py-3">@{e.blocked_username}</td>
                    <td className="px-4 py-3 text-muted hidden sm:table-cell">{e.reason || '—'}</td>
                    <td className="px-4 py-3 text-muted hidden md:table-cell">
                      {e.blocked_at ? new Date(e.blocked_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleUnblock(e.id)} className="px-3 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 text-muted hover:bg-white/10 transition">
                        Unblock
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
