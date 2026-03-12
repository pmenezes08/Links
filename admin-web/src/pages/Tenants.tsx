import { useEffect, useState, useCallback } from 'react'
import { apiJson, apiPost, api } from '../utils/api'

type Tenant = {
  id: number; name: string; subdomain: string; custom_domain?: string; plan?: string; created_at?: string; user_count: number; community_count: number
}

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
      const d = await apiPost('/api/admin/tenants', { name: name.trim(), subdomain: subdomain.trim().toLowerCase() })
      if (d?.success) { setShowCreate(false); setName(''); setSubdomain(''); loadTenants() }
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
    const [u, c] = await Promise.all([
      apiJson(`/api/admin/tenants/${t.id}/users`),
      apiJson(`/api/admin/tenants/${t.id}/communities`),
    ])
    setTenantUsers(u?.users || [])
    setTenantCommunities(c?.communities || [])
  }

  if (loading) return <div className="text-muted">Loading tenants...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tenants</h1>
        <button onClick={() => { setShowCreate(true); setName(''); setSubdomain('') }} className="px-4 py-2 bg-accent text-black rounded-lg text-sm font-semibold">Create Tenant</button>
      </div>

      {/* Create/Edit Modal */}
      {(showCreate || editTenant) && (
        <div className="bg-surface-2 border border-white/10 rounded-xl p-4 space-y-3">
          <h3 className="font-semibold">{editTenant ? 'Edit Tenant' : 'Create Tenant'}</h3>
          {error && <div className="text-red-400 text-sm">{error}</div>}
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Tenant name" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" />
          <input value={subdomain} onChange={e => setSubdomain(e.target.value)} placeholder="subdomain (e.g. whu)" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" />
          <input value={customDomain} onChange={e => setCustomDomain(e.target.value)} placeholder="Custom domain (optional)" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" />
          <select value={plan} onChange={e => setPlan(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
            <option value="free">Free</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option>
          </select>
          <div className="flex gap-2">
            <button onClick={editTenant ? handleUpdate : handleCreate} disabled={saving} className="px-4 py-2 bg-accent text-black rounded-lg text-sm font-semibold disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
            <button onClick={() => { setShowCreate(false); setEditTenant(null); setError('') }} className="px-4 py-2 bg-white/5 rounded-lg text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Tenant Detail */}
      {detailTenant && (
        <div className="bg-surface-2 border border-white/10 rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="font-semibold">{detailTenant.name} ({detailTenant.subdomain})</h3>
            <button onClick={() => setDetailTenant(null)} className="text-muted text-sm">Close</button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><h4 className="text-sm text-muted mb-2">Users ({tenantUsers.length})</h4>
              {tenantUsers.map(u => <div key={u.id} className="text-sm py-1">{u.username} <span className="text-muted">{u.email}</span></div>)}
              {tenantUsers.length === 0 && <div className="text-sm text-muted">No users assigned</div>}
            </div>
            <div><h4 className="text-sm text-muted mb-2">Communities ({tenantCommunities.length})</h4>
              {tenantCommunities.map(c => <div key={c.id} className="text-sm py-1">{c.name}</div>)}
              {tenantCommunities.length === 0 && <div className="text-sm text-muted">No communities assigned</div>}
            </div>
          </div>
        </div>
      )}

      {/* Tenants Table */}
      <div className="bg-surface-2 border border-white/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-white/10 text-muted text-left">
            <th className="px-4 py-3">Name</th><th className="px-4 py-3">Subdomain</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Users</th><th className="px-4 py-3">Communities</th><th className="px-4 py-3">Actions</th>
          </tr></thead>
          <tbody>
            {tenants.map(t => (
              <tr key={t.id} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-medium">{t.name}</td>
                <td className="px-4 py-3 text-accent">{t.subdomain}</td>
                <td className="px-4 py-3">{t.plan || 'free'}</td>
                <td className="px-4 py-3">{t.user_count}</td>
                <td className="px-4 py-3">{t.community_count}</td>
                <td className="px-4 py-3 space-x-2">
                  <button onClick={() => { setEditTenant(t); setName(t.name); setSubdomain(t.subdomain); setCustomDomain(t.custom_domain||''); setPlan(t.plan||'free') }} className="text-accent text-xs hover:underline">Edit</button>
                  <button onClick={() => loadTenantDetail(t)} className="text-muted text-xs hover:underline">Detail</button>
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
