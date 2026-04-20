import { useEffect, useState, useCallback } from 'react'
import { apiJson, apiPost } from '../utils/api'

type EffectiveTier = 'special' | 'premium' | 'trial' | 'free' | 'anonymous' | 'unknown' | string

interface User {
  id: number
  username: string
  email?: string
  subscription?: string
  is_special?: boolean
  effective_tier?: EffectiveTier
  inherited_from?: string | null
  created_at?: string
  is_admin?: boolean
}

interface UsersResponse {
  success: boolean
  users: User[]
  total: number
  page: number
  per_page: number
  pages: number
}

interface AddUserForm {
  username: string
  email: string
  password: string
  subscription: string
}

interface UsageSummary {
  steve_month: number
  steve_month_cap: number | null
  whisper_minutes_month: number
  whisper_minutes_month_cap: number | null
  steve_today: number
  steve_today_cap: number | null
}

interface AuditEntry {
  id: number
  username: string
  action: string
  actor_username: string
  reason: string | null
  category: string | null
  expires_at: string | null
  created_at: string | null
}

interface ManageResponse {
  success: boolean
  username: string
  entitlements: Record<string, unknown>
  usage: UsageSummary
  audit: AuditEntry[]
}

function TierBadge({ tier, isSpecial, inheritedFrom }: { tier?: EffectiveTier; isSpecial?: boolean; inheritedFrom?: string | null }) {
  // Special dominates.
  if (isSpecial) {
    return <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-medium">Special</span>
  }
  const t = (tier || 'free').toLowerCase()
  const styles: Record<string, string> = {
    premium: 'bg-accent/20 text-accent border-accent/30',
    trial: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    free: 'bg-white/5 text-white/70 border-white/10',
    anonymous: 'bg-white/5 text-white/50 border-white/10',
    unknown: 'bg-white/5 text-white/50 border-white/10',
  }
  const style = styles[t] || styles.free
  const isEnterprise = !!inheritedFrom && inheritedFrom.startsWith('enterprise:')
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${style}`}>
        {t === 'premium' && isEnterprise ? 'Premium (Enterprise)' : t}
      </span>
      {isEnterprise && (
        <span className="text-[9px] text-muted" title={`Inherited from ${inheritedFrom}`}>↳ ent</span>
      )}
    </span>
  )
}

export default function Users() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState<AddUserForm>({ username: '', email: '', password: '', subscription: 'free' })
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editSub, setEditSub] = useState('')
  const [actionMsg, setActionMsg] = useState('')

  // Manage drawer
  const [manageUser, setManageUser] = useState<User | null>(null)
  const [manageData, setManageData] = useState<ManageResponse | null>(null)
  const [manageLoading, setManageLoading] = useState(false)

  const perPage = 50

  const fetchUsers = useCallback((p: number, q: string) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(p), per_page: String(perPage) })
    if (q) params.set('search', q)
    apiJson<UsersResponse>(`/api/admin/users?${params}`)
      .then(d => {
        setUsers(d.users ?? [])
        setTotalPages(d.pages ?? 1)
        setTotal(d.total ?? 0)
        setPage(d.page ?? p)
      })
      .catch(() => setError('Failed to load users'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchUsers(1, '') }, [fetchUsers])

  const flash = (msg: string) => {
    setActionMsg(msg)
    window.setTimeout(() => setActionMsg(''), 3000)
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(searchInput)
    fetchUsers(1, searchInput)
  }

  const goToPage = (p: number) => fetchUsers(p, search)

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await apiPost('/api/admin/add_user', addForm)
      setShowAdd(false)
      setAddForm({ username: '', email: '', password: '', subscription: 'free' })
      flash('User added')
      fetchUsers(page, search)
    } catch { flash('Failed to add user') }
  }

  const handleUpdateSub = async (user: User) => {
    try {
      await apiPost('/api/admin/update_user', { username: user.username, subscription: editSub })
      setEditingId(null)
      flash('Subscription updated')
      fetchUsers(page, search)
    } catch { flash('Failed to update') }
  }

  const handleDelete = async (username: string) => {
    if (!confirm(`Delete user @${username}?`)) return
    try {
      await apiPost('/api/admin/delete_user', { username })
      flash('User deleted')
      fetchUsers(page, search)
    } catch { flash('Failed to delete') }
  }

  const handleGrantSpecial = async (u: User) => {
    const reason = prompt(`Grant Special access to @${u.username}?\n\nReason (required):`, '')
    if (!reason || !reason.trim()) return
    try {
      await apiPost(`/api/admin/users/${encodeURIComponent(u.username)}/special/grant`, { reason: reason.trim() })
      flash(`@${u.username} is now Special`)
      fetchUsers(page, search)
      if (manageUser?.username === u.username) openManage(u)
    } catch { flash('Failed to grant Special') }
  }

  const handleRevokeSpecial = async (u: User) => {
    const reason = prompt(`Revoke Special access from @${u.username}?\n\nReason (required):`, '')
    if (!reason || !reason.trim()) return
    try {
      await apiPost(`/api/admin/users/${encodeURIComponent(u.username)}/special/revoke`, { reason: reason.trim() })
      flash(`@${u.username} is no longer Special`)
      fetchUsers(page, search)
      if (manageUser?.username === u.username) openManage(u)
    } catch { flash('Failed to revoke Special') }
  }

  const openManage = async (u: User) => {
    setManageUser(u)
    setManageData(null)
    setManageLoading(true)
    try {
      const d = await apiJson<ManageResponse>(`/api/admin/users/${encodeURIComponent(u.username)}/manage`)
      setManageData(d)
    } catch { flash('Failed to load user details') }
    setManageLoading(false)
  }

  if (error) return <div className="text-red-400 text-center py-20">{error}</div>

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-semibold">Users {total > 0 && <span className="text-muted text-sm font-normal">({total})</span>}</h1>
        <button onClick={() => setShowAdd(true)} className="bg-accent text-black font-semibold px-4 py-2 rounded-lg text-sm hover:bg-accent/90 transition">
          <i className="fa-solid fa-plus mr-2" />Add User
        </button>
      </div>

      {actionMsg && (
        <div className="p-3 bg-accent/10 border border-accent/30 rounded-lg text-accent text-sm">{actionMsg}</div>
      )}

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          placeholder="Search users..."
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
        />
        <button type="submit" className="bg-white/10 border border-white/10 rounded-lg px-4 py-2.5 text-sm hover:bg-white/20 transition">
          <i className="fa-solid fa-magnifying-glass" />
        </button>
      </form>

      {loading ? (
        <div className="text-muted text-center py-12">Loading users...</div>
      ) : (
        <>
          <div className="bg-surface-2 border border-white/10 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-muted text-xs uppercase tracking-wide">
                    <th className="text-left px-4 py-3">Username</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">Email</th>
                    <th className="text-left px-4 py-3">Subscription</th>
                    <th className="text-left px-4 py-3 hidden lg:table-cell">Effective tier</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Joined</th>
                    <th className="text-right px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-3">
                        <span className="text-accent font-medium">@{u.username}</span>
                        {u.is_admin && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">admin</span>}
                        {u.is_special && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">special</span>}
                        <div className="sm:hidden text-muted text-xs mt-0.5">{u.email}</div>
                      </td>
                      <td className="px-4 py-3 text-muted hidden sm:table-cell">{u.email ?? '—'}</td>
                      <td className="px-4 py-3">
                        {editingId === u.id ? (
                          <div className="flex items-center gap-2">
                            <select value={editSub} onChange={e => setEditSub(e.target.value)} className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none">
                              <option value="free">free</option>
                              <option value="premium">premium</option>
                            </select>
                            <button onClick={() => handleUpdateSub(u)} className="text-accent text-xs hover:underline">Save</button>
                            <button onClick={() => setEditingId(null)} className="text-muted text-xs hover:underline">Cancel</button>
                          </div>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 border border-white/10">{u.subscription ?? 'free'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <TierBadge tier={u.effective_tier} isSpecial={u.is_special} inheritedFrom={u.inherited_from} />
                      </td>
                      <td className="px-4 py-3 text-muted text-xs hidden md:table-cell">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                        <button onClick={() => openManage(u)} className="text-accent hover:underline text-xs">Manage</button>
                        <button onClick={() => { setEditingId(u.id); setEditSub(u.subscription ?? 'free') }} className="text-white/70 hover:underline text-xs">Edit</button>
                        {u.is_special ? (
                          <button onClick={() => handleRevokeSpecial(u)} className="text-purple-300 hover:underline text-xs">Revoke special</button>
                        ) : (
                          <button onClick={() => handleGrantSpecial(u)} className="text-purple-300 hover:underline text-xs">Grant special</button>
                        )}
                        <button onClick={() => handleDelete(u.username)} className="text-red-400 hover:underline text-xs">Delete</button>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">No users found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-muted text-xs">Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page <= 1}
                  className="px-3 py-1.5 rounded-lg text-sm bg-white/10 border border-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  <i className="fa-solid fa-chevron-left mr-1" />Prev
                </button>
                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 rounded-lg text-sm bg-white/10 border border-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  Next<i className="fa-solid fa-chevron-right ml-1" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {showAdd && (
        <>
          <div className="fixed inset-0 bg-black/60 z-50" onClick={() => setShowAdd(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface-2 border border-white/10 rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-semibold">Add User</h2>
                <button onClick={() => setShowAdd(false)} className="text-muted hover:text-white"><i className="fa-solid fa-xmark" /></button>
              </div>
              <form onSubmit={handleAdd} className="space-y-3">
                <input type="text" placeholder="Username" required value={addForm.username} onChange={e => setAddForm(p => ({ ...p, username: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none" />
                <input type="email" placeholder="Email" required value={addForm.email} onChange={e => setAddForm(p => ({ ...p, email: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none" />
                <input type="password" placeholder="Password" required value={addForm.password} onChange={e => setAddForm(p => ({ ...p, password: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none" />
                <select value={addForm.subscription} onChange={e => setAddForm(p => ({ ...p, subscription: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:outline-none">
                  <option value="free">Free</option>
                  <option value="premium">Premium</option>
                </select>
                <button type="submit" className="w-full bg-accent text-black font-semibold py-2.5 rounded-lg hover:bg-accent/90 transition">Add User</button>
              </form>
            </div>
          </div>
        </>
      )}

      {manageUser && (
        <ManageDrawer
          user={manageUser}
          data={manageData}
          loading={manageLoading}
          onClose={() => { setManageUser(null); setManageData(null) }}
          onGrant={handleGrantSpecial}
          onRevoke={handleRevokeSpecial}
        />
      )}
    </div>
  )
}

function UsageBar({ used, cap, label, unit }: { used: number; cap: number | null; label: string; unit?: string }) {
  const unlimited = cap === null
  const pct = !unlimited && cap && cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0
  const over = pct >= 95
  const warn = !over && pct >= 80
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className={over ? 'text-red-400' : warn ? 'text-yellow-400' : 'text-white/80'}>
          {unlimited ? (
            <>{used}{unit ? ` ${unit}` : ''} · unlimited</>
          ) : (
            <>{used} / {cap}{unit ? ` ${unit}` : ''} ({pct}%)</>
          )}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            className={`h-full ${over ? 'bg-red-500' : warn ? 'bg-yellow-500' : 'bg-accent'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}

function ManageDrawer({
  user, data, loading, onClose, onGrant, onRevoke,
}: {
  user: User
  data: ManageResponse | null
  loading: boolean
  onClose: () => void
  onGrant: (u: User) => void
  onRevoke: (u: User) => void
}) {
  const ent = (data?.entitlements || {}) as Record<string, unknown>
  const usage = data?.usage
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-surface-2 border-l border-white/10 overflow-y-auto">
        <div className="sticky top-0 bg-surface-2 border-b border-white/10 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <div className="text-xs text-muted">Manage user</div>
            <div className="font-semibold">@{user.username}</div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-white"><i className="fa-solid fa-xmark" /></button>
        </div>

        {loading || !data ? (
          <div className="p-5 text-muted text-sm">Loading…</div>
        ) : (
          <div className="p-5 space-y-6">
            <section>
              <h3 className="text-xs uppercase tracking-wide text-muted mb-2">Tier</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <TierBadge tier={user.effective_tier} isSpecial={user.is_special} inheritedFrom={user.inherited_from} />
                <span className="text-xs text-muted">subscription: {user.subscription ?? 'free'}</span>
                {user.is_admin && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">admin</span>}
              </div>
              <div className="mt-3 flex gap-2">
                {user.is_special ? (
                  <button onClick={() => onRevoke(user)} className="text-xs px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-200 border border-purple-500/30 hover:bg-purple-500/30">
                    Revoke Special
                  </button>
                ) : (
                  <button onClick={() => onGrant(user)} className="text-xs px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-200 border border-purple-500/30 hover:bg-purple-500/30">
                    Grant Special
                  </button>
                )}
              </div>
            </section>

            {usage && (
              <section className="space-y-3">
                <h3 className="text-xs uppercase tracking-wide text-muted">Usage — this month</h3>
                <UsageBar used={usage.steve_month} cap={usage.steve_month_cap} label="Steve uses" />
                <UsageBar used={usage.whisper_minutes_month} cap={usage.whisper_minutes_month_cap} label="Voice transcription" unit="min" />
                <UsageBar used={usage.steve_today} cap={usage.steve_today_cap} label="Steve today" />
              </section>
            )}

            <section>
              <h3 className="text-xs uppercase tracking-wide text-muted mb-2">Entitlements</h3>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                {(['can_use_steve', 'can_create_communities', 'communities_max', 'members_per_owned_community', 'ai_daily_limit', 'monthly_spend_ceiling_eur'] as const).map(k => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="text-muted truncate">{k}</span>
                    <span className="text-white/90">{formatVal(ent[k])}</span>
                  </div>
                ))}
              </div>
            </section>

            {data.audit && data.audit.length > 0 && (
              <section>
                <h3 className="text-xs uppercase tracking-wide text-muted mb-2">Special-access audit</h3>
                <ul className="space-y-2">
                  {data.audit.map(a => (
                    <li key={a.id} className="text-xs border border-white/10 rounded-lg p-2.5">
                      <div className="flex justify-between">
                        <span className="font-medium text-white/90">
                          {a.action}
                          {a.category && <span className="text-muted"> · {a.category}</span>}
                        </span>
                        <span className="text-muted">{a.created_at}</span>
                      </div>
                      <div className="text-muted mt-0.5">by @{a.actor_username}</div>
                      {a.reason && <div className="text-white/70 mt-1 italic">"{a.reason}"</div>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </aside>
    </>
  )
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return 'unlimited'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}
