import { useEffect, useState } from 'react'
import { apiJson, apiPost } from '../utils/api'

interface Report {
  id: number
  post_id: number
  post_content?: string
  reporter?: string
  reason?: string
  status?: string
  created_at?: string
}

type TabStatus = 'pending' | 'reviewed'

export default function Reports() {
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<TabStatus>('pending')
  const [actionMsg, setActionMsg] = useState('')

  const fetchReports = (status: TabStatus) => {
    setLoading(true)
    apiJson<Report[] | { reports?: Report[] }>(`/api/admin/reported_posts?status=${status}`)
      .then(d => setReports(Array.isArray(d) ? d : d.reports ?? []))
      .catch(() => setError('Failed to load reports'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchReports(tab) }, [tab])

  const handleDismiss = async (reportId: number) => {
    try {
      await apiPost('/api/admin/review_report', { report_id: reportId, action: 'dismiss' })
      setActionMsg('Report dismissed')
      fetchReports(tab)
    } catch { setActionMsg('Failed to dismiss report') }
    setTimeout(() => setActionMsg(''), 3000)
  }

  const handleDelete = async (postId: number) => {
    if (!confirm('Delete this reported post?')) return
    try {
      await apiPost('/api/admin/delete_reported_post', { post_id: postId })
      setActionMsg('Post deleted')
      fetchReports(tab)
    } catch { setActionMsg('Failed to delete post') }
    setTimeout(() => setActionMsg(''), 3000)
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Reports</h1>

      <div className="flex gap-2">
        {(['pending', 'reviewed'] as TabStatus[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === t ? 'bg-accent/10 text-accent border border-accent/30' : 'bg-white/5 text-muted border border-white/10 hover:bg-white/10'}`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {actionMsg && (
        <div className="p-3 bg-accent/10 border border-accent/30 rounded-lg text-accent text-sm">{actionMsg}</div>
      )}

      {loading ? (
        <div className="text-muted text-center py-12">Loading reports...</div>
      ) : error ? (
        <div className="text-red-400 text-center py-12">{error}</div>
      ) : reports.length === 0 ? (
        <div className="bg-surface-2 border border-white/10 rounded-xl p-8 text-center text-muted">No {tab} reports</div>
      ) : (
        <div className="space-y-3">
          {reports.map(r => (
            <div key={r.id} className="bg-surface-2 border border-white/10 rounded-xl p-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {r.post_content && (
                    <p className="text-sm mb-2 break-words">{r.post_content}</p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    {r.reporter && <span><i className="fa-solid fa-user mr-1" />Reporter: {r.reporter}</span>}
                    {r.reason && <span><i className="fa-solid fa-circle-info mr-1" />{r.reason}</span>}
                    {r.created_at && <span>{new Date(r.created_at).toLocaleDateString()}</span>}
                  </div>
                </div>
                {tab === 'pending' && (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => handleDismiss(r.id)} className="px-3 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 text-muted hover:bg-white/10 transition">Dismiss</button>
                    <button onClick={() => handleDelete(r.post_id)} className="px-3 py-1.5 text-xs rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition">Delete Post</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
