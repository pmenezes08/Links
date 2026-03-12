import { useEffect, useState } from 'react'
import { apiJson, apiPost } from '../utils/api'

interface Community {
  id: number
  name: string
}

export default function Broadcast() {
  const [communities, setCommunities] = useState<Community[]>([])
  const [commLoading, setCommLoading] = useState(true)
  const [form, setForm] = useState({ title: '', message: '', url: '', community_id: '', send_email: false })
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    apiJson<{ communities?: Community[] }>('/api/admin/communities_list')
      .then(d => setCommunities(d.communities ?? []))
      .catch(() => {})
      .finally(() => setCommLoading(false))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setFeedback(null)
    try {
      await apiPost('/api/admin/broadcast_notification', {
        title: form.title,
        message: form.message,
        url: form.url || undefined,
        community_id: form.community_id || undefined,
        send_email: form.send_email,
      })
      setFeedback({ type: 'success', text: 'Broadcast sent successfully' })
      setForm({ title: '', message: '', url: '', community_id: '', send_email: false })
    } catch {
      setFeedback({ type: 'error', text: 'Failed to send broadcast' })
    } finally {
      setLoading(false)
    }
    setTimeout(() => setFeedback(null), 5000)
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Broadcast Notification</h1>

      <div className="bg-surface-2 border border-white/10 rounded-xl p-5 max-w-lg">
        <p className="text-muted text-xs mb-4">Send a push notification to users</p>

        {feedback && (
          <div className={`mb-4 p-3 rounded-lg text-sm border ${feedback.type === 'success' ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
            {feedback.text}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-sm text-muted block mb-1.5">Target Audience</label>
            <select
              value={form.community_id}
              onChange={e => setForm(p => ({ ...p, community_id: e.target.value }))}
              disabled={commLoading}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none disabled:opacity-50"
            >
              <option value="">All Users</option>
              {communities.map(c => (
                <option key={c.id} value={c.id}>{c.name} (ID: {c.id})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-muted block mb-1.5">Title</label>
            <input
              type="text"
              placeholder="Notification title"
              required
              value={form.title}
              onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="text-sm text-muted block mb-1.5">Message</label>
            <textarea
              placeholder="Notification message"
              required
              rows={4}
              value={form.message}
              onChange={e => setForm(p => ({ ...p, message: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none resize-none"
            />
          </div>
          <div>
            <label className="text-sm text-muted block mb-1.5">URL <span className="text-muted/60">(optional)</span></label>
            <input
              type="url"
              placeholder="https://..."
              value={form.url}
              onChange={e => setForm(p => ({ ...p, url: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2.5 py-1 cursor-pointer">
            <input
              type="checkbox"
              checked={form.send_email}
              onChange={e => setForm(p => ({ ...p, send_email: e.target.checked }))}
              className="w-4 h-4 rounded border-white/20 bg-white/5 text-accent focus:ring-accent focus:ring-offset-0"
            />
            <span className="text-sm">Also send by email</span>
          </label>
          <button type="submit" disabled={loading} className="w-full bg-accent text-black font-semibold py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-50 transition text-sm">
            {loading ? 'Sending...' : (<><i className="fa-solid fa-bullhorn mr-2" />Send Broadcast</>)}
          </button>
        </form>
      </div>
    </div>
  )
}
