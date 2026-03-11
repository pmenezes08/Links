import { useEffect, useState } from 'react'
import { apiJson, apiPost } from '../utils/api'

interface User {
  id: number
  username: string
  email?: string
  subscription?: string
}

interface AddUserForm {
  username: string
  email: string
  password: string
  subscription: string
}

export default function Users() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState<AddUserForm>({ username: '', email: '', password: '', subscription: 'free' })
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editSub, setEditSub] = useState('')
  const [actionMsg, setActionMsg] = useState('')

  const fetchUsers = () => {
    setLoading(true)
    apiJson<{ users?: User[] }>('/api/admin/dashboard')
      .then(d => setUsers(d.users ?? []))
      .catch(() => setError('Failed to load users'))
      .finally(() => setLoading(false))
  }

  useEffect(fetchUsers, [])

  const filtered = users.filter(u =>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    (u.email ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await apiPost('/api/admin/add_user', addForm)
      setShowAdd(false)
      setAddForm({ username: '', email: '', password: '', subscription: 'free' })
      setActionMsg('User added')
      fetchUsers()
    } catch { setActionMsg('Failed to add user') }
    setTimeout(() => setActionMsg(''), 3000)
  }

  const handleUpdateSub = async (id: number) => {
    try {
      await apiPost('/api/admin/update_user', { user_id: id, subscription: editSub })
      setEditingId(null)
      setActionMsg('Subscription updated')
      fetchUsers()
    } catch { setActionMsg('Failed to update') }
    setTimeout(() => setActionMsg(''), 3000)
  }

  const handleDelete = async (id: number, username: string) => {
    if (!confirm(`Delete user @${username}?`)) return
    try {
      await apiPost('/api/admin/delete_user', { user_id: id })
      setActionMsg('User deleted')
      fetchUsers()
    } catch { setActionMsg('Failed to delete') }
    setTimeout(() => setActionMsg(''), 3000)
  }

  if (loading) return <div className="text-muted text-center py-20">Loading users...</div>
  if (error) return <div className="text-red-400 text-center py-20">{error}</div>

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-semibold">Users</h1>
        <button onClick={() => setShowAdd(true)} className="bg-accent text-black font-semibold px-4 py-2 rounded-lg text-sm hover:bg-accent/90 transition">
          <i className="fa-solid fa-plus mr-2" />Add User
        </button>
      </div>

      {actionMsg && (
        <div className="p-3 bg-accent/10 border border-accent/30 rounded-lg text-accent text-sm">{actionMsg}</div>
      )}

      <input
        type="text"
        placeholder="Search users..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
      />

      <div className="bg-surface-2 border border-white/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-muted text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3">Username</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">Email</th>
                <th className="text-left px-4 py-3">Subscription</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3">
                    <span className="text-accent font-medium">@{u.username}</span>
                    <div className="sm:hidden text-muted text-xs mt-0.5">{u.email}</div>
                  </td>
                  <td className="px-4 py-3 text-muted hidden sm:table-cell">{u.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    {editingId === u.id ? (
                      <div className="flex items-center gap-2">
                        <select value={editSub} onChange={e => setEditSub(e.target.value)} className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none">
                          <option value="free">free</option>
                          <option value="premium">premium</option>
                          <option value="pro">pro</option>
                        </select>
                        <button onClick={() => handleUpdateSub(u.id)} className="text-accent text-xs hover:underline">Save</button>
                        <button onClick={() => setEditingId(null)} className="text-muted text-xs hover:underline">Cancel</button>
                      </div>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 border border-white/10">{u.subscription ?? 'free'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button onClick={() => { setEditingId(u.id); setEditSub(u.subscription ?? 'free') }} className="text-accent hover:underline text-xs">Edit</button>
                    <button onClick={() => handleDelete(u.id, u.username)} className="text-red-400 hover:underline text-xs">Delete</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">No users found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
                  <option value="pro">Pro</option>
                </select>
                <button type="submit" className="w-full bg-accent text-black font-semibold py-2.5 rounded-lg hover:bg-accent/90 transition">Add User</button>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
