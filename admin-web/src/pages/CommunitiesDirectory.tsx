import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiJson } from '../utils/api'

interface CommunityDirectoryRow {
  id: number
  name: string
  type?: string | null
  creator_username?: string | null
  parent_community_id?: number | null
  member_count: number
  direct_child_count: number
  admin_usernames: string[]
  tier?: string | null
  subscription_status?: string | null
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  current_period_end?: string | null
  cancel_at_period_end?: boolean
  canceled_at?: string | null
  steve_package_subscription_active?: boolean
  steve_package_subscription_status?: string | null
  steve_package_current_period_end?: string | null
  steve_pool_cap?: number
  steve_pool_used?: number
  steve_pool_remaining?: number | null
}

interface PricingDiagRow {
  label: string
  field: string
  present: boolean
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function resolveRootRow(row: CommunityDirectoryRow, byId: Map<number, CommunityDirectoryRow>): CommunityDirectoryRow {
  let cur = row
  const seen = new Set<number>()
  while (cur.parent_community_id != null && !seen.has(cur.id)) {
    seen.add(cur.id)
    const p = byId.get(cur.parent_community_id)
    if (!p) break
    cur = p
  }
  return cur
}

function tiersBelowRoot(
  ch: CommunityDirectoryRow,
  rootId: number,
  byId: Map<number, CommunityDirectoryRow>
): number {
  let n = 0
  let pid = ch.parent_community_id
  while (pid != null && pid !== rootId) {
    n++
    const parent = byId.get(pid)
    if (!parent) break
    pid = parent.parent_community_id
  }
  return n
}

const TIER_OPTIONS = ['paid_l1', 'paid_l2', 'paid_l3'] as const

export default function CommunitiesDirectory() {
  const [rows, setRows] = useState<CommunityDirectoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<CommunityDirectoryRow | null>(null)
  const [manageErr, setManageErr] = useState<string | null>(null)
  const [tierBusy, setTierBusy] = useState(false)
  const [stevePriceMissing, setStevePriceMissing] = useState<boolean | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const data: { success?: boolean; communities?: CommunityDirectoryRow[]; error?: string } = await apiJson(
        '/api/admin/communities/directory'
      )
      if (!data?.success) throw new Error(data?.error || 'Failed to load directory')
      setRows(data.communities ?? [])
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDiagnostics = useCallback(async () => {
    try {
      const data: { success?: boolean; diagnostics?: PricingDiagRow[] } = await apiJson(
        '/api/admin/subscriptions/pricing_diagnostics'
      )
      if (!data?.success || !data.diagnostics) return
      const steve = data.diagnostics.find(d => d.label === 'Steve Community Package')
      if (steve) setStevePriceMissing(!steve.present)
    } catch {
      setStevePriceMissing(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadDiagnostics()
  }, [loadDiagnostics])

  const byId = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows])

  const childrenByParent = useMemo(() => {
    const m = new Map<number, CommunityDirectoryRow[]>()
    for (const r of rows) {
      const p = r.parent_community_id
      if (p == null) continue
      if (!m.has(p)) m.set(p, [])
      m.get(p)!.push(r)
    }
    for (const [, arr] of m) arr.sort((a, b) => a.name.localeCompare(b.name))
    return m
  }, [rows])

  const descendantsOfRoot = useCallback(
    (rootId: number): CommunityDirectoryRow[] => {
      const out: CommunityDirectoryRow[] = []
      const walk = (parentId: number) => {
        const kids = childrenByParent.get(parentId) ?? []
        for (const k of kids) {
          out.push(k)
          walk(k.id)
        }
      }
      walk(rootId)
      return out
    },
    [childrenByParent]
  )

  const rootRows = useMemo(() => rows.filter(r => r.parent_community_id == null).sort((a, b) => a.name.localeCompare(b.name)), [rows])

  const billingRoot = selected ? resolveRootRow(selected, byId) : null

  const changeTier = async (rootCommunity: CommunityDirectoryRow, tierCode: string) => {
    if (!tierCode || tierCode === (rootCommunity.tier || 'free')) return
    if (!rootCommunity.stripe_subscription_id) {
      setManageErr('Tier changes require an active Stripe subscription on the root network.')
      return
    }
    const ok = window.confirm(`Change ${rootCommunity.name} (root network) from ${rootCommunity.tier || 'free'} to ${tierCode}?`)
    if (!ok) return
    setTierBusy(true)
    setManageErr(null)
    try {
      const data: { success?: boolean; error?: string } = await apiJson(
        `/api/admin/communities/${rootCommunity.id}/billing/change-tier`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tier_code: tierCode }),
        }
      )
      if (!data?.success) throw new Error(data?.error || 'Tier change failed')
      await load()
    } catch (e: unknown) {
      setManageErr(e instanceof Error ? e.message : String(e))
    } finally {
      setTierBusy(false)
    }
  }

  const openRow = (row: CommunityDirectoryRow) => {
    setSelected(row)
    setManageErr(null)
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Communities</h1>
          <p className="text-sm text-white/60">
            Root networks only in the table; open a network or pick a sub-community from the dropdown when present.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-accent/40 px-3 py-2 text-sm text-accent hover:bg-accent/10"
        >
          Refresh
        </button>
      </header>

      {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>}

      {loading ? (
        <div className="text-white/50">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-surface-2">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-xs uppercase tracking-wide text-white/50">
              <tr className="border-b border-white/10">
                <th className="px-4 py-3 text-left">Network (root)</th>
                <th className="px-4 py-3 text-left">Owner</th>
                <th className="px-4 py-3 text-right">Members</th>
                <th className="px-4 py-3 text-right">Sub-communities</th>
                <th className="px-4 py-3 text-left">Admins</th>
                <th className="px-4 py-3 text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {rootRows.map(root => {
                const descendants = descendantsOfRoot(root.id)
                const hasSubs = descendants.length > 0
                return (
                  <tr key={root.id} className="border-b border-white/5">
                    <td className="px-4 py-3">
                      <div className="font-medium">{root.name}</div>
                      <div className="text-xs text-white/40">#{root.id}</div>
                    </td>
                    <td className="px-4 py-3 text-accent">@{root.creator_username || '—'}</td>
                    <td className="px-4 py-3 text-right">{root.member_count}</td>
                    <td className="px-4 py-3 text-right">{root.direct_child_count}</td>
                    <td className="px-4 py-3 text-white/70 max-w-[200px] truncate" title={root.admin_usernames.join(', ')}>
                      {root.admin_usernames.length ? root.admin_usernames.slice(0, 3).join(', ') : '—'}
                      {root.admin_usernames.length > 3 ? ` +${root.admin_usernames.length - 3}` : ''}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {hasSubs ? (
                        <select
                          aria-label={`Open ${root.name} or a sub-community`}
                          className="max-w-[220px] rounded-lg border border-white/20 bg-black px-2 py-1 text-xs outline-none hover:bg-white/5"
                          defaultValue=""
                          onChange={e => {
                            const v = e.target.value
                            e.target.value = ''
                            if (!v) return
                            const id = Number(v)
                            const row = byId.get(id)
                            if (row) openRow(row)
                          }}
                        >
                          <option value="">Choose network / sub…</option>
                          <option value={root.id}>{root.name} (root)</option>
                          {descendants.map(ch => {
                            const depth = tiersBelowRoot(ch, root.id, byId)
                            const prefix = `${'└ '.repeat(Math.min(depth + 1, 5))}`
                            return (
                              <option key={ch.id} value={ch.id}>
                                {prefix}
                                {ch.name}
                              </option>
                            )
                          })}
                        </select>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openRow(root)}
                          className="rounded-lg border border-white/20 px-3 py-1 text-xs hover:bg-white/5"
                        >
                          Details
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {rootRows.length === 0 && (
            <div className="px-4 py-8 text-center text-white/50">No root communities in scope.</div>
          )}
        </div>
      )}

      {selected && billingRoot && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-black p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">{selected.name}</h2>
                <p className="text-xs text-white/40 mt-1">ID #{selected.id}</p>
                {selected.parent_community_id != null && (
                  <p className="text-xs text-white/45 mt-2">
                    Sub-community under root #{billingRoot.id} ({billingRoot.name}). Steve usage and billing follow the root network.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg border border-white/20 px-2 py-1 text-xs hover:bg-white/5"
              >
                Close
              </button>
            </div>

            <div className="mt-6 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs uppercase text-white/40">Owner</div>
                  <div className="text-accent">@{selected.creator_username || '—'}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-white/40">Type</div>
                  <div>{selected.type || '—'}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-white/40">Members</div>
                  <div>{selected.member_count}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-white/40">Sub-communities</div>
                  <div>{selected.direct_child_count}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs uppercase text-white/40">Parent</div>
                  <div>{selected.parent_community_id == null ? 'Root network' : `#${selected.parent_community_id}`}</div>
                </div>
              </div>

              <div>
                <div className="text-xs uppercase text-white/40 mb-1">Community admins</div>
                {selected.admin_usernames.length ? (
                  <ul className="list-disc list-inside text-white/80 space-y-0.5">
                    {selected.admin_usernames.map(u => (
                      <li key={u}>@{u}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-white/50">None listed (owner may still manage).</div>
                )}
              </div>

              <div className="border-t border-white/10 pt-4">
                <h3 className="font-medium text-accent mb-2">Manage (root network billing)</h3>
                {manageErr && (
                  <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200">{manageErr}</div>
                )}
                <p className="text-xs text-white/45 mb-3">
                  Tier and Stripe subscription apply to <strong>{billingRoot.name}</strong> — shared by this network and its sub-communities.
                </p>
                <div className="space-y-2 text-white/80">
                  <div className="flex justify-between gap-2">
                    <span className="text-white/50">Tier</span>
                    <span>{billingRoot.tier || 'free'}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-white/50">Subscription status</span>
                    <span>{billingRoot.subscription_status || '—'}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-white/50">Stripe subscription</span>
                    <span className="truncate max-w-[200px]" title={billingRoot.stripe_subscription_id || ''}>
                      {billingRoot.stripe_subscription_id || '—'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-white/50">Renewal / end</span>
                    <span>{formatDate(billingRoot.current_period_end)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-white/50">Cancel at period end</span>
                    <span>{billingRoot.cancel_at_period_end ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-white/50">Canceled at</span>
                    <span>{formatDate(billingRoot.canceled_at)}</span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <label className="text-xs text-white/50">Change tier</label>
                  <select
                    aria-label={`Change tier for root ${billingRoot.name}`}
                    disabled={tierBusy || !billingRoot.stripe_subscription_id}
                    value=""
                    onChange={e => {
                      const next = e.target.value
                      e.target.value = ''
                      if (next) void changeTier(billingRoot, next)
                    }}
                    className="rounded-lg border border-accent/30 bg-black px-2 py-1 text-xs text-accent outline-none disabled:opacity-40"
                  >
                    <option value="">{tierBusy ? 'Updating…' : 'Choose tier…'}</option>
                    {TIER_OPTIONS.filter(t => t !== (billingRoot.tier || '').toLowerCase()).map(t => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  {!billingRoot.stripe_subscription_id && (
                    <span className="text-xs text-white/40">Requires Stripe subscription on root</span>
                  )}
                </div>

                <Link
                  to="/subscriptions"
                  className="mt-3 inline-block text-xs text-accent hover:underline"
                >
                  Open Subscriptions (community billing table)
                </Link>
              </div>

              <div className="border-t border-white/10 pt-4">
                <h3 className="font-medium text-white/70 mb-2">Add-ons</h3>
                <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/60">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-white/80">Steve Community Package</p>
                    {billingRoot.steve_package_subscription_active && (
                      <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="mt-1">When enabled, pooled Steve usage is configured at the root network and applies across sub-communities.</p>
                  {billingRoot.steve_package_subscription_active ? (
                    <div className="mt-3 space-y-1.5 text-white/80">
                      <div className="flex justify-between gap-2">
                        <span className="text-white/50">Package status</span>
                        <span>{billingRoot.steve_package_subscription_status || 'active'}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-white/50">Steve pool used</span>
                        <span>
                          {billingRoot.steve_pool_used ?? 0}
                          {billingRoot.steve_pool_cap ? ` of ${billingRoot.steve_pool_cap}` : ''}
                        </span>
                      </div>
                      {billingRoot.steve_pool_remaining != null && (
                        <div className="flex justify-between gap-2">
                          <span className="text-white/50">Remaining</span>
                          <span>{billingRoot.steve_pool_remaining}</span>
                        </div>
                      )}
                      {selected.id !== billingRoot.id && (
                        <p className="text-[11px] text-white/45">
                          Showing root network pool usage for {billingRoot.name}; sub-communities inherit this pool.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-2 text-white/45">No active Steve package on this root network.</p>
                  )}
                  {stevePriceMissing === true && (
                    <p className="mt-2 text-amber-200/90">Stripe price ID missing in KB for current mode — configure in Knowledge Base.</p>
                  )}
                </div>
              </div>

              <div className="pt-2">
                <Link to="/network-insights" className="text-xs text-accent hover:underline">
                  Open Network Insights
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
