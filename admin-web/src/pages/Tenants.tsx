import { useEffect, useState, useCallback } from 'react'
import { apiJson, apiPost, api } from '../utils/api'

type Tenant = {
  id: number; name: string; subdomain: string; custom_domain?: string; plan?: string; created_at?: string; user_count: number; community_count: number
}
type AssignableUser = { id: number; username?: string; email?: string }
type AssignableCommunity = { id: number; name: string }

export default function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editTenant, setEditTenant] = useState<Tenant | null>(null)
  const [name, setName] = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [customDomain, setCustomDomain] = useState('')
  const [plan, setPlan] = useState('free')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [detailTenant, setDetailTenant] = useState<Tenant | null>(null)
  const [tenantUsers, setTenantUsers] = useState<any[]>([])
  const [tenantCommunities, setTenantCommunities] = useState<any[]>([])

  const [assignMode, setAssignMode] = useState<'users' | 'communities' | null>(null)
  const [availableUsers, setAvailableUsers] = useState<AssignableUser[]>([])
  const [availableCommunities, setAvailableCommunities] = useState<AssignableCommunity[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignMsg, setAssignMsg] = useState('')

  const loadTenants = useCallback(async () => {
    setLoading(true)
    try {
      const d = await apiJson('/api/admin/tenants')
      if (d?.success) setTenants(d.tenants || [])
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(() => { loadTenants() }, [loadTenants])

  const handleCreate = async () => {
    if (!name.trim() || !subdomain.trim()) return
    setSaving(true); setError('')
    try {
      const d = await apiPost('/api/admin/tenants', { name: name.trim(), subdomain: subdomain.trim().toLowerCase(), plan: plan || undefined })
      if (d?.success) { setShowCreate(false); setName(''); setSubdomain(''); setPlan('free'); loadTenants() }
      else setError(d?.error || 'Failed to create')
    } catch { setError('Connection error') } finally { setSaving(false) }
  }

  const handleUpdate = async () => {
    if (!editTenant) return
    setSaving(true); setError('')
    try {
      const res = await api(`/api/admin/tenants/${editTenant.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, subdomain, custom_domain: customDomain, plan }) })
      const d = await res.json()
      if (d?.success) { setEditTenant(null); loadTenants() }
      else setError(d?.error || 'Failed to update')
    } catch { setError('Connection error') } finally { setSaving(false) }
  }

  const loadTenantDetail = async (t: Tenant) => {
    setDetailTenant(t)
    setAssignMode(null)
    const [u, c] = await Promise.all([
      apiJson(`/api/admin/tenants/${t.id}/users`),
      apiJson(`/api/admin/tenants/${t.id}/communities`),
    ])
    setTenantUsers(u?.users || [])
    setTenantCommunities(c?.communities || [])
  }

  const openAssign = async (mode: 'users' | 'communities') => {
    setAssignMode(mode)
    setSelectedIds(new Set())
    setAssignMsg('')
    setAssignLoading(true)
    try {
      if (mode === 'users') {
        const d = await apiJson('/api/admin/users')
        const all: AssignableUser[] = d?.users || []
        const assignedIds = new Set(tenantUsers.map((u: any) => u.id))
        setAvailableUsers(all.filter(u => !assignedIds.has(u.id)))
      } else {
        const d = await apiJson('/api/admin/communities')
        const all: AssignableCommunity[] = d?.communities || []
        const assignedIds = new Set(tenantCommunities.map((c: any) => c.id))
        setAvailableCommunities(all.filter(c => !assignedIds.has(c.id)))
      }
    } catch { setAssignMsg('Failed to load items') }
    finally { setAssignLoading(false) }
  }

  const toggleId = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleAssign = async () => {
    if (!detailTenant || selectedIds.size === 0) return
    setAssignLoading(true); setAssignMsg('')
    try {
      const ids = Array.from(selectedIds)
      const endpoint = assignMode === 'users'
        ? `/api/admin/tenants/${detailTenant.id}/assign-users`
        : `/api/admin/tenants/${detailTenant.id}/assign-communities`
      const body = assignMode === 'users' ? { user_ids: ids } : { community_ids: ids }
      const res = await api(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json()
      if (d?.success) {
        setAssignMsg(`Assigned ${ids.length} ${assignMode} successfully`)
        setAssignMode(null)
        loadTenantDetail(detailTenant)
        loadTenants()
      } else { setAssignMsg(d?.error || 'Failed to assign') }
    } catch { setAssignMsg('Connection error') }
    finally { setAssignLoading(false) }
  }

  if (loading) return <div className="text-muted text-center py-20">Loading tenants...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tenants</h1>
        <button onClick={() => { setShowCreate(true); setName(''); setSubdomain(''); setPlan('free'); setError('') }} className="px-4 py-2 bg-accent text-black rounded-lg text-sm font-semibold hover:bg-accent/90 transition">
          <i className="fa-solid fa-plus mr-2" />Create Tenant
        </button>
      </div>

      {(showCreate || editTenant) && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => { setShowCreate(false); setEditTenant(null); setError('') }}>
          <div className="bg-surface-2 border border-white/10 rounded-xl p-5 w-full max-w-md space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-lg">{editTenant ? 'Edit Tenant' : 'Create Tenant'}</h3>
            {error && <div className="text-red-400 text-sm p-2 bg-red-500/10 border border-red-500/30 rounded-lg">{error}</div>}
            <div>
              <label className="text-sm text-muted block mb-1">Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Tenant name" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-accent focus:outline-none" />
            </div>
            <div>
              <label className="text-sm text-muted block mb-1">Subdomain</label>
              <input value={subdomain} onChange={e => setSubdomain(e.target.value)} placeholder="e.g. whu" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-accent focus:outline-none" />
            </div>
            {editTenant && (
              <div>
                <label className="text-sm text-muted block mb-1">Custom Domain</label>
                <input value={customDomain} onChange={e => setCustomDomain(e.target.value)} placeholder="Optional" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-accent focus:outline-none" />
              </div>
            )}
            <div>
              <label className="text-sm text-muted block mb-1">Plan</label>
              <select value={plan} onChange={e => setPlan(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-accent focus:outline-none">
                <option value="free">Free</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={editTenant ? handleUpdate : handleCreate} disabled={saving} className="flex-1 px-4 py-2.5 bg-accent text-black rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-accent/90 transition">
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => { setShowCreate(false); setEditTenant(null); setError('') }} className="px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm hover:bg-white/10 transition">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {detailTenant && (
        <div className="bg-surface-2 border border-white/10 rounded-xl p-5 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-semibold text-lg">{detailTenant.name}</h3>
              <span className="text-accent text-sm">{detailTenant.subdomain}</span>
              {detailTenant.plan && <span className="ml-2 text-xs text-muted bg-white/5 px-2 py-0.5 rounded">{detailTenant.plan}</span>}
            </div>
            <button onClick={() => { setDetailTenant(null); setAssignMode(null) }} className="text-muted text-sm hover:text-white transition">
              <i className="fa-solid fa-xmark mr-1" />Close
            </button>
          </div>

          <div className="flex gap-2">
            <button onClick={() => openAssign('users')} className="px-3 py-2 bg-accent/10 border border-accent/30 text-accent rounded-lg text-sm font-medium hover:bg-accent/20 transition">
              <i className="fa-solid fa-user-plus mr-1.5" />Assign Users
            </button>
            <button onClick={() => openAssign('communities')} className="px-3 py-2 bg-accent/10 border border-accent/30 text-accent rounded-lg text-sm font-medium hover:bg-accent/20 transition">
              <i className="fa-solid fa-people-group mr-1.5" />Assign Communities
            </button>
          </div>

          {assignMode && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-semibold">
                {assignMode === 'users' ? 'Select Users to Assign' : 'Select Communities to Assign'}
              </h4>
              {assignMsg && <div className="text-sm p-2 bg-accent/10 border border-accent/30 rounded-lg text-accent">{assignMsg}</div>}
              {assignLoading ? (
                <div className="text-muted text-sm py-4 text-center">Loading...</div>
              ) : (
                <>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {assignMode === 'users' ? (
                      availableUsers.length === 0 ? <div className="text-muted text-sm">No unassigned users available</div> :
                      availableUsers.map(u => (
                        <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer">
                          <input type="checkbox" checked={selectedIds.has(u.id)} onChange={() => toggleId(u.id)} className="w-4 h-4 rounded border-white/20 bg-white/5 text-accent" />
                          <span className="text-sm">{u.username || u.email || `User #${u.id}`}</span>
                          {u.email && u.username && <span className="text-muted text-xs">{u.email}</span>}
                        </label>
                      ))
                    ) : (
                      availableCommunities.length === 0 ? <div className="text-muted text-sm">No unassigned communities available</div> :
                      availableCommunities.map(c => (
                        <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer">
                          <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleId(c.id)} className="w-4 h-4 rounded border-white/20 bg-white/5 text-accent" />
                          <span className="text-sm">{c.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={handleAssign} disabled={selectedIds.size === 0 || assignLoading} className="px-4 py-2 bg-accent text-black rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-accent/90 transition">
                      Assign {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                    </button>
                    <button onClick={() => setAssignMode(null)} className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm hover:bg-white/10 transition">Cancel</button>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm text-muted font-medium mb-2">Users ({tenantUsers.length})</h4>
              <div className="space-y-1">
                {tenantUsers.map((u: any) => (
                  <div key={u.id} className="text-sm py-1.5 px-2 rounded bg-white/5">{u.username || `User #${u.id}`} <span className="text-muted">{u.email}</span></div>
                ))}
                {tenantUsers.length === 0 && <div className="text-sm text-muted">No users assigned</div>}
              </div>
            </div>
            <div>
              <h4 className="text-sm text-muted font-medium mb-2">Communities ({tenantCommunities.length})</h4>
              <div className="space-y-1">
                {tenantCommunities.map((c: any) => (
                  <div key={c.id} className="text-sm py-1.5 px-2 rounded bg-white/5">{c.name}</div>
                ))}
                {tenantCommunities.length === 0 && <div className="text-sm text-muted">No communities assigned</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-surface-2 border border-white/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-muted text-xs uppercase tracking-wide text-left">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Subdomain</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Users</th>
              <th className="px-4 py-3">Communities</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map(t => (
              <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition">
                <td className="px-4 py-3 font-medium">{t.name}</td>
                <td className="px-4 py-3 text-accent">{t.subdomain}</td>
                <td className="px-4 py-3"><span className="bg-white/5 px-2 py-0.5 rounded text-xs">{t.plan || 'free'}</span></td>
                <td className="px-4 py-3">{t.user_count}</td>
                <td className="px-4 py-3">{t.community_count}</td>
                <td className="px-4 py-3 space-x-2">
                  <button onClick={() => { setEditTenant(t); setName(t.name); setSubdomain(t.subdomain); setCustomDomain(t.custom_domain || ''); setPlan(t.plan || 'free'); setError('') }} className="text-accent text-xs hover:underline">Edit</button>
                  <button onClick={() => loadTenantDetail(t)} className="text-muted text-xs hover:text-white hover:underline transition">Detail</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {tenants.length === 0 && <div className="text-center py-8 text-muted">No tenants yet</div>}
      </div>
    </div>
  )
}
