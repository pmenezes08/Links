import { useEffect, useState } from 'react'
import { apiJson } from '../utils/api'
import StatCard from '../components/StatCard'

interface LeaderboardEntry {
  username: string
  score: number
}

interface Cohort {
  month: string
  cohort_size: number
  retention: number[]
}

interface DashboardStats {
  dau: number
  mau: number
  wau: number
  mru: number
  wru: number
  avg_dau_30: number
  dau_pct?: number
  mau_pct?: number
  mru_repeat_rate_pct?: number
  wru_repeat_rate_pct?: number
  mau_month?: string
  cohorts?: Cohort[]
  leaderboards?: {
    top_posters: LeaderboardEntry[]
    top_reactors: LeaderboardEntry[]
    top_voters: LeaderboardEntry[]
  }
}

interface DashboardResponse {
  success: boolean
  stats: DashboardStats
}

export default function Metrics() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    apiJson<DashboardResponse>('/api/admin/dashboard')
      .then(d => setStats(d.stats))
      .catch(() => setError('Failed to load metrics'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-muted text-center py-20">Loading metrics...</div>
  if (error) return <div className="text-red-400 text-center py-20">{error}</div>
  if (!stats) return null

  const cohorts = stats.cohorts ?? []
  const leaderboards = stats.leaderboards
  const maxRetentionLen = cohorts.reduce((m, c) => Math.max(m, c.retention?.length ?? 0), 0)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Metrics</h1>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="DAU" value={stats.dau} icon="fa-chart-line" />
        <StatCard label="MAU" value={stats.mau} icon="fa-calendar-check" />
        <StatCard label="WAU" value={stats.wau} icon="fa-chart-bar" />
        <StatCard label="MRU" value={stats.mru} icon="fa-rotate" />
        <StatCard label="WRU" value={stats.wru} icon="fa-arrow-trend-up" />
        <StatCard label="Avg DAU 30d" value={stats.avg_dau_30} icon="fa-chart-area" />
      </div>

      {cohorts.length > 0 && (
        <div className="bg-surface-2 border border-white/10 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Cohort Retention</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted text-xs uppercase tracking-wide">
                  <th className="text-left px-3 py-2">Month</th>
                  <th className="text-right px-3 py-2">Cohort Size</th>
                  {Array.from({ length: maxRetentionLen }, (_, i) => (
                    <th key={i} className="text-right px-3 py-2">M{i}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohorts.map((row, i) => (
                  <tr key={i} className="border-b border-white/5 last:border-0">
                    <td className="px-3 py-2">{row.month}</td>
                    <td className="px-3 py-2 text-right text-muted">{row.cohort_size}</td>
                    {Array.from({ length: maxRetentionLen }, (_, j) => {
                      const val = row.retention?.[j]
                      return (
                        <td key={j} className="px-3 py-2 text-right">
                          {val != null ? (
                            <span className={val > 50 ? 'text-accent' : val > 20 ? 'text-yellow-400' : 'text-muted'}>
                              {val}%
                            </span>
                          ) : '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {leaderboards && (
        <div className="grid md:grid-cols-3 gap-4">
          <LeaderboardCard title="Top Posters" entries={leaderboards.top_posters} />
          <LeaderboardCard title="Top Reactors" entries={leaderboards.top_reactors} />
          <LeaderboardCard title="Top Voters" entries={leaderboards.top_voters} />
        </div>
      )}
    </div>
  )
}

function LeaderboardCard({ title, entries }: { title: string; entries?: LeaderboardEntry[] }) {
  if (!entries || entries.length === 0) return null
  return (
    <div className="bg-surface-2 border border-white/10 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">{title}</h2>
      <div className="space-y-1">
        {entries.map((entry, i) => (
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
  )
}
