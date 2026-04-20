/**
 * Enterprise lifecycle admin page.
 *
 * Three tabs:
 *   - Active seats     : everyone currently holding an Enterprise seat,
 *                        with a "Force end seat" action (manual override).
 *   - Audit log        : recent rows from `subscription_audit_log`, with
 *                        simple filtering by user or action.
 *   - Winback          : conversion card + totals for the promo programme.
 *
 * All data comes from /api/admin/enterprise/* + /api/admin/winback/analytics
 * added in Wave 5 + Wave 7.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiJson } from '../utils/api'

type TabId = 'seats' | 'audit' | 'winback'

interface Seat {
  id: number
  username: string
  community_id: number
  community_slug?: string | null
  started_at?: string | null
}

interface AuditRow {
  id: number
  username: string
  action: string
  source?: string | null
  community_id?: number | null
  community_slug?: string | null
  actor_username?: string | null
  reason?: string | null
  metadata?: Record<string, unknown> | null
  effective_at?: string | null
  created_at?: string | null
}

interface WinbackAnalytics {
  window_days: number
  counts: { issued: number; sent: number; redeemed: number; expired: number; pending: number }
  conversion_pct: number
}

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'seats',   label: 'Active seats', icon: 'fa-chair' },
  { id: 'audit',   label: 'Audit log',    icon: 'fa-clipboard-list' },
  { id: 'winback', label: 'Winback',      icon: 'fa-arrow-rotate-left' },
]

export default function Enterprise() {
  const [tab, setTab] = useState<TabId>('seats')
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Enterprise lifecycle</h1>
        <p className="text-sm text-white/60">
          Seats, audit trail, and winback conversion for Enterprise members.
        </p>
      </header>
      <nav className="flex gap-2 border-b border-white/10">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px transition ${
              tab === t.id ? 'border-accent text-accent' : 'border-transparent text-white/60 hover:text-white'
            }`}
          >
            <i className={`fa-solid ${t.icon} mr-1.5`} />
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'seats' && <SeatsTab />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'winback' && <WinbackTab />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

function SeatsTab() {
  const [seats, setSeats] = useState<Seat[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const data: any = await apiJson('/api/admin/enterprise/seats')
      if (data?.success) setSeats(data.seats || [])
      else setErr(data?.error || 'Failed to load seats')
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const forceEnd = async (s: Seat) => {
    const reason = window.prompt(`Force-end seat for @${s.username} in community ${s.community_id}? Enter a reason:`)
    if (!reason) return
    try {
      const data: any = await apiJson('/api/admin/enterprise/seats/override-end', {
        method: 'POST',
        body: JSON.stringify({ username: s.username, community_id: s.community_id, reason }),
      })
      if (data?.success) await load()
      else alert(data?.error || 'Failed')
    } catch (e: any) {
      alert(e?.message || String(e))
    }
  }

  if (loading) return <div className="text-white/50">Loading seats…</div>
  if (err) return <div className="text-red-400">{err}</div>

  return (
    <div className="bg-surface-2 border border-white/10 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-white/50 text-xs uppercase tracking-wide">
          <tr className="border-b border-white/10">
            <th className="text-left px-4 py-3">Username</th>
            <th className="text-left px-4 py-3">Community</th>
            <th className="text-left px-4 py-3">Started</th>
            <th className="text-right px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {seats.map(s => (
            <tr key={s.id} className="border-b border-white/5">
              <td className="px-4 py-3 text-accent">@{s.username}</td>
              <td className="px-4 py-3">
                {s.community_slug ? <span className="text-white/90">{s.community_slug}</span> : <span className="text-white/50">#{s.community_id}</span>}
                <span className="text-white/40 ml-2">(#{s.community_id})</span>
              </td>
              <td className="px-4 py-3 text-white/70">{s.started_at ? new Date(s.started_at).toLocaleString() : '—'}</td>
              <td className="px-4 py-3 text-right">
                <button onClick={() => forceEnd(s)} className="text-red-300 hover:underline text-xs">
                  Force end
                </button>
              </td>
            </tr>
          ))}
          {seats.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-8 text-center text-white/50">No active seats.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

function AuditTab() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [usernameQ, setUsernameQ] = useState('')
  const [actionQ, setActionQ] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const qs = new URLSearchParams()
      if (usernameQ.trim()) qs.set('username', usernameQ.trim())
      if (actionQ.trim()) qs.set('action', actionQ.trim())
      qs.set('limit', '200')
      const data: any = await apiJson(`/api/admin/subscription-audit?${qs.toString()}`)
      if (data?.success) setRows(data.rows || [])
      else setErr(data?.error || 'Failed to load audit log')
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [usernameQ, actionQ])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={usernameQ}
          onChange={e => setUsernameQ(e.target.value)}
          placeholder="Filter by username"
          className="bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm focus:outline-none"
        />
        <input
          value={actionQ}
          onChange={e => setActionQ(e.target.value)}
          placeholder="Filter by action (e.g. enterprise_seat_joined)"
          className="bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm focus:outline-none flex-1 min-w-[240px]"
        />
        <button onClick={() => void load()} className="px-3 py-1.5 bg-accent/20 text-accent border border-accent/30 rounded text-sm">
          Refresh
        </button>
      </div>
      {loading ? (
        <div className="text-white/50">Loading audit log…</div>
      ) : err ? (
        <div className="text-red-400">{err}</div>
      ) : (
        <div className="bg-surface-2 border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="text-white/50 uppercase tracking-wide">
              <tr className="border-b border-white/10">
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">User</th>
                <th className="text-left px-3 py-2">Action</th>
                <th className="text-left px-3 py-2">Source</th>
                <th className="text-left px-3 py-2">Community</th>
                <th className="text-left px-3 py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-white/5 align-top">
                  <td className="px-3 py-2 text-white/70 whitespace-nowrap">{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
                  <td className="px-3 py-2 text-accent">{r.username ? `@${r.username}` : '—'}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.action}</td>
                  <td className="px-3 py-2 text-white/60">{r.source || '—'}</td>
                  <td className="px-3 py-2 text-white/60">{r.community_slug || (r.community_id ? `#${r.community_id}` : '—')}</td>
                  <td className="px-3 py-2 text-white/50">{r.reason || '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-white/50">No audit rows.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Winback
// ---------------------------------------------------------------------------

function WinbackTab() {
  const [data, setData] = useState<WinbackAnalytics | null>(null)
  const [days, setDays] = useState(90)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    setLoading(true)
    setErr(null)
    apiJson(`/api/admin/winback/analytics?days=${days}`)
      .then((d: any) => { if (!cancel) { if (d?.success) setData(d); else setErr(d?.error || 'Failed') } })
      .catch((e: any) => { if (!cancel) setErr(e?.message || String(e)) })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [days])

  const stats = useMemo(() => {
    const c = data?.counts || { issued: 0, sent: 0, redeemed: 0, expired: 0, pending: 0 }
    return [
      { label: 'Issued',    value: c.issued,    help: 'Tokens created' },
      { label: 'Sent',      value: c.sent,      help: 'Delivered to user' },
      { label: 'Redeemed',  value: c.redeemed,  help: 'Came back on Premium' },
      { label: 'Expired',   value: c.expired,   help: '14-day window passed' },
      { label: 'Pending',   value: c.pending,   help: 'Issued, not yet sent' },
    ]
  }, [data])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-sm text-white/60">Window (days):</label>
        <select value={days} onChange={e => setDays(parseInt(e.target.value, 10))} className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm focus:outline-none">
          <option value={30}>30</option>
          <option value={90}>90</option>
          <option value={180}>180</option>
          <option value={365}>365</option>
        </select>
      </div>
      {loading ? (
        <div className="text-white/50">Loading…</div>
      ) : err ? (
        <div className="text-red-400">{err}</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {stats.map(s => (
              <div key={s.label} className="bg-surface-2 border border-white/10 rounded-xl p-4">
                <div className="text-xs text-white/50">{s.label}</div>
                <div className="text-2xl font-semibold mt-1">{s.value}</div>
                <div className="text-[11px] text-white/40 mt-1">{s.help}</div>
              </div>
            ))}
          </div>
          <div className="bg-surface-2 border border-white/10 rounded-xl p-5">
            <div className="text-xs text-white/50">Conversion</div>
            <div className="text-3xl font-semibold text-accent mt-1">{data.conversion_pct.toFixed(1)}%</div>
            <div className="text-[11px] text-white/40 mt-1">
              redeemed / (sent + redeemed + expired), last {data.window_days} days
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
