import { useEffect, useState } from 'react'
import { apiJson } from '../utils/api'
import StatCard from '../components/StatCard'

interface MetricsData {
  dau_count: number
  mau_count: number
  wru_count?: number
  mru_count?: number
  cohort_data?: { period: string; retained: number; total: number }[]
  leaderboard?: { username: string; score: number }[]
  community_leaderboard?: { name: string; score: number }[]
}

export default function Metrics() {
  const [data, setData] = useState<MetricsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    apiJson<MetricsData>('/api/admin/dashboard')
      .then(setData)
      .catch(() => setError('Failed to load metrics'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-muted text-center py-20">Loading metrics...</div>
  if (error) return <div className="text-red-400 text-center py-20">{error}</div>
  if (!data) return null

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Metrics</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="DAU" value={data.dau_count} icon="fa-chart-line" />
        <StatCard label="MAU" value={data.mau_count} icon="fa-calendar-check" />
        <StatCard label="WRU" value={data.wru_count ?? '—'} icon="fa-arrow-trend-up" />
        <StatCard label="MRU" value={data.mru_count ?? '—'} icon="fa-rotate" />
      </div>

      {data.cohort_data && data.cohort_data.length > 0 && (
        <div className="bg-surface-2 border border-white/10 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Cohort Retention</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted text-xs uppercase tracking-wide">
                  <th className="text-left px-3 py-2">Period</th>
                  <th className="text-right px-3 py-2">Retained</th>
                  <th className="text-right px-3 py-2">Total</th>
                  <th className="text-right px-3 py-2">Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.cohort_data.map((row, i) => (
                  <tr key={i} className="border-b border-white/5 last:border-0">
                    <td className="px-3 py-2">{row.period}</td>
                    <td className="px-3 py-2 text-right text-accent">{row.retained}</td>
                    <td className="px-3 py-2 text-right text-muted">{row.total}</td>
                    <td className="px-3 py-2 text-right">
                      {row.total > 0 ? `${((row.retained / row.total) * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {data.leaderboard && data.leaderboard.length > 0 && (
          <div className="bg-surface-2 border border-white/10 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">User Leaderboard</h2>
            <div className="space-y-1">
              {data.leaderboard.map((entry, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-muted text-xs w-5 text-right">{i + 1}</span>
                    <span className="text-accent font-medium">@{entry.username}</span>
                  </div>
                  <span className="text-sm font-semibold">{entry.score}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.community_leaderboard && data.community_leaderboard.length > 0 && (
          <div className="bg-surface-2 border border-white/10 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Community Leaderboard</h2>
            <div className="space-y-1">
              {data.community_leaderboard.map((entry, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-muted text-xs w-5 text-right">{i + 1}</span>
                    <span className="font-medium">{entry.name}</span>
                  </div>
                  <span className="text-sm font-semibold">{entry.score}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
