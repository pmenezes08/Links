import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiJson } from '../utils/api'

type Tab = 'users' | 'communities'

interface UserSubscription {
  username: string
  email: string
  subscription: string
  subscription_status?: string | null
  current_period_end?: string | null
  cancel_at_period_end?: boolean
  canceled_at?: string | null
  is_special?: boolean
  billing_kind?: 'stripe' | 'special' | 'manual' | 'free' | string
  current_subscription_value_cents?: number
  spent_total_cents?: number
  spent_ytd_cents?: number
  steve_used_month: number
  whisper_minutes_month: number
}

interface CommunitySubscription {
  id: number
  name: string
  owner: string
  tier: string
  member_count: number
  subscription_status?: string | null
  current_period_end?: string | null
  cancel_at_period_end?: boolean
  canceled_at?: string | null
  stripe_subscription_id?: string | null
  current_subscription_value_cents?: number
  spent_total_cents?: number
  spent_ytd_cents?: number
}

interface Diagnostic {
  label: string
  field: string
  present: boolean
  price_id?: string
}

export default function Subscriptions() {
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<UserSubscription[]>([])
  const [communities, setCommunities] = useState<CommunitySubscription[]>([])
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [mode, setMode] = useState('test')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [tierChangingId, setTierChangingId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const [userData, communityData, diagData]: any[] = await Promise.all([
        apiJson('/api/admin/subscriptions/users'),
        apiJson('/api/admin/subscriptions/communities'),
        apiJson('/api/admin/subscriptions/pricing_diagnostics'),
      ])
      if (!userData?.success) throw new Error(userData?.error || 'Failed to load users')
      if (!communityData?.success) throw new Error(communityData?.error || 'Failed to load communities')
      if (!diagData?.success) throw new Error(diagData?.error || 'Failed to load diagnostics')
      setUsers(userData.users || [])
      setCommunities(communityData.communities || [])
      setDiagnostics(diagData.missing || [])
      setMode(diagData.stripe_mode || 'test')
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const changeCommunityTier = useCallback(async (community: CommunitySubscription, tierCode: string) => {
    if (!tierCode || tierCode === community.tier) return
    const ok = window.confirm(`Change ${community.name} from ${community.tier} to ${tierCode}?`)
    if (!ok) return
    setTierChangingId(community.id)
    setErr(null)
    try {
      const data: any = await apiJson(`/api/admin/communities/${community.id}/billing/change-tier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier_code: tierCode }),
      })
      if (!data?.success) throw new Error(data?.error || 'Failed to change community tier')
      await load()
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setTierChangingId(null)
    }
  }, [load])

  const userCounts = useMemo(() => counts(users), [users])
  const communityCounts = useMemo(() => counts(communities), [communities])
  const currentValue = useMemo(() => (
    sumCents(users, 'current_subscription_value_cents') + sumCents(communities, 'current_subscription_value_cents')
  ), [users, communities])
  const paidYtd = useMemo(() => sumCents([...users, ...communities], 'spent_ytd_cents'), [users, communities])

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Subscriptions</h1>
          <p className="text-sm text-white/60">
            Paid user and community subscriptions, renewal state, cancellation state, and AI usage.
          </p>
        </div>
        <button onClick={() => void load()} className="rounded-lg border border-accent/40 px-3 py-2 text-sm text-accent hover:bg-accent/10">
          Refresh
        </button>
      </header>

      {diagnostics.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          <div className="font-medium">Missing Stripe Price IDs ({mode})</div>
          <div className="mt-1 text-amber-100/80">
            Add Price IDs in the Knowledge Base fields: {diagnostics.map(d => d.field).join(', ')}.
          </div>
        </div>
      )}

      {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>}

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Active users" value={userCounts.active} />
        <SummaryCard label="Current value" value={formatMoney(currentValue)} />
        <SummaryCard label="Paid YTD" value={formatMoney(paidYtd)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryCard label="Cancelling users" value={userCounts.cancelling} />
        <SummaryCard label="Paid communities" value={communityCounts.total} />
      </div>

      <nav className="flex gap-2 border-b border-white/10">
        <TabButton active={tab === 'users'} onClick={() => setTab('users')} label="User" />
        <TabButton active={tab === 'communities'} onClick={() => setTab('communities')} label="Community" />
      </nav>

      {loading ? (
        <div className="text-white/50">Loading subscriptions…</div>
      ) : tab === 'users' ? (
        <UsersTable rows={users} />
      ) : (
        <CommunitiesTable rows={communities} changingId={tierChangingId} onChangeTier={changeCommunityTier} />
      )}
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-surface-2 p-4">
      <div className="text-xs uppercase tracking-wide text-white/50">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  )
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm border-b-2 -mb-px transition ${active ? 'border-accent text-accent' : 'border-transparent text-white/60 hover:text-white'}`}
    >
      {label}
    </button>
  )
}

function UsersTable({ rows }: { rows: UserSubscription[] }) {
  return (
    <TableShell empty={rows.length === 0} emptyText="No paid users found.">
      <thead className="text-xs uppercase tracking-wide text-white/50">
        <tr className="border-b border-white/10">
          <th className="px-4 py-3 text-left">User</th>
          <th className="px-4 py-3 text-left">Status</th>
          <th className="px-4 py-3 text-left">Billing type</th>
          <th className="px-4 py-3 text-right">Current value</th>
          <th className="px-4 py-3 text-right">Spent YTD</th>
          <th className="px-4 py-3 text-right">Spent since signup</th>
          <th className="px-4 py-3 text-left">Renewal / end</th>
          <th className="px-4 py-3 text-left">Cancelled</th>
          <th className="px-4 py-3 text-right">Steve</th>
          <th className="px-4 py-3 text-right">Whisper</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.username} className="border-b border-white/5">
            <td className="px-4 py-3">
              <div className="font-medium text-accent">@{row.username}</div>
              <div className="text-xs text-white/40">{row.email}</div>
            </td>
            <td className="px-4 py-3">{statusPill(row.is_special ? 'special' : row.subscription_status || row.subscription)}</td>
            <td className="px-4 py-3">{billingPill(row.billing_kind || (row.is_special ? 'special' : 'free'))}</td>
            <td className="px-4 py-3 text-right">{formatMoney(row.current_subscription_value_cents)}</td>
            <td className="px-4 py-3 text-right">{formatMoney(row.spent_ytd_cents)}</td>
            <td className="px-4 py-3 text-right">{formatMoney(row.spent_total_cents)}</td>
            <td className="px-4 py-3 text-white/70">{formatDate(row.current_period_end)}</td>
            <td className="px-4 py-3 text-white/70">
              {row.cancel_at_period_end ? `Ends ${formatDate(row.current_period_end)}` : formatDate(row.canceled_at)}
            </td>
            <td className="px-4 py-3 text-right">{row.steve_used_month}</td>
            <td className="px-4 py-3 text-right">{row.whisper_minutes_month}</td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  )
}

function CommunitiesTable({
  rows,
  changingId,
  onChangeTier,
}: {
  rows: CommunitySubscription[]
  changingId: number | null
  onChangeTier: (community: CommunitySubscription, tierCode: string) => void
}) {
  return (
    <TableShell empty={rows.length === 0} emptyText="No paid communities found.">
      <thead className="text-xs uppercase tracking-wide text-white/50">
        <tr className="border-b border-white/10">
          <th className="px-4 py-3 text-left">Community</th>
          <th className="px-4 py-3 text-left">Owner</th>
          <th className="px-4 py-3 text-left">Tier</th>
          <th className="px-4 py-3 text-left">Status</th>
          <th className="px-4 py-3 text-right">Current value</th>
          <th className="px-4 py-3 text-right">Spent YTD</th>
          <th className="px-4 py-3 text-right">Spent total</th>
          <th className="px-4 py-3 text-left">Renewal / end</th>
          <th className="px-4 py-3 text-right">Members</th>
          <th className="px-4 py-3 text-right">Admin action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.id} className="border-b border-white/5">
            <td className="px-4 py-3">
              <div className="font-medium">{row.name}</div>
              <div className="text-xs text-white/40">#{row.id}</div>
            </td>
            <td className="px-4 py-3 text-accent">@{row.owner}</td>
            <td className="px-4 py-3">{row.tier}</td>
            <td className="px-4 py-3">{statusPill(row.subscription_status || row.tier)}</td>
            <td className="px-4 py-3 text-right">{formatMoney(row.current_subscription_value_cents)}</td>
            <td className="px-4 py-3 text-right">{formatMoney(row.spent_ytd_cents)}</td>
            <td className="px-4 py-3 text-right">{formatMoney(row.spent_total_cents)}</td>
            <td className="px-4 py-3 text-white/70">
              {row.cancel_at_period_end ? `Ends ${formatDate(row.current_period_end)}` : formatDate(row.current_period_end)}
            </td>
            <td className="px-4 py-3 text-right">{row.member_count}</td>
            <td className="px-4 py-3 text-right">
              <TierChangeControl
                row={row}
                disabled={changingId === row.id}
                onChangeTier={onChangeTier}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  )
}

function TierChangeControl({
  row,
  disabled,
  onChangeTier,
}: {
  row: CommunitySubscription
  disabled: boolean
  onChangeTier: (community: CommunitySubscription, tierCode: string) => void
}) {
  const options = ['paid_l1', 'paid_l2', 'paid_l3'].filter(tier => tier !== row.tier)
  if (!row.stripe_subscription_id) {
    return <span className="text-xs text-white/35">No Stripe sub</span>
  }
  return (
    <select
      aria-label={`Change tier for ${row.name}`}
      disabled={disabled}
      value=""
      onChange={(event) => {
        const next = event.target.value
        event.target.value = ''
        if (next) onChangeTier(row, next)
      }}
      className="rounded-lg border border-accent/30 bg-black px-2 py-1 text-xs text-accent outline-none disabled:opacity-50"
    >
      <option value="">{disabled ? 'Changing...' : 'Change tier'}</option>
      {options.map(option => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  )
}

function TableShell({ children, empty, emptyText }: { children: ReactNode; empty: boolean; emptyText: string }) {
  if (empty) return <div className="rounded-xl border border-white/10 bg-surface-2 px-4 py-8 text-center text-white/50">{emptyText}</div>
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-surface-2">
      <table className="w-full min-w-[1060px] text-sm">{children}</table>
    </div>
  )
}

function statusPill(status: string) {
  const value = status || 'unknown'
  const special = value === 'special'
  const warn = ['past_due', 'unpaid', 'cancelled'].includes(value)
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${special ? 'border-violet-300/40 bg-violet-400/10 text-violet-200' : warn ? 'border-amber-400/30 bg-amber-400/10 text-amber-200' : 'border-accent/30 bg-accent/10 text-accent'}`}>
      {value}
    </span>
  )
}

function billingPill(kind: string) {
  const value = kind || 'free'
  return (
    <span className="inline-flex rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-white/70">
      {value}
    </span>
  )
}

function counts(rows: Array<{ subscription_status?: string | null; cancel_at_period_end?: boolean }>) {
  return {
    total: rows.length,
    active: rows.filter(r => ['active', 'trialing'].includes(String(r.subscription_status || '').toLowerCase())).length,
    cancelling: rows.filter(r => r.cancel_at_period_end).length,
  }
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function formatMoney(cents?: number | null) {
  const amount = Number(cents || 0) / 100
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(amount)
}

function sumCents<T extends Record<string, any>>(rows: T[], key: keyof T) {
  return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0)
}
