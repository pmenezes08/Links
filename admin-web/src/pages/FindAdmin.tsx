import { useState } from 'react'
import { apiPost } from '../utils/api'

export default function FindAdmin() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      const data = await apiPost('/api/admin/login-by-email', { email: email.trim() })
      if (data?.success && data.redirect_url) {
        window.location.href = data.redirect_url
      } else {
        setError(data?.error || 'No admin account found for that email')
      }
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src={`${import.meta.env.VITE_API_BASE || 'https://app.c-point.co'}/api/public/logo`} alt="C.Point" className="w-16 h-16 mx-auto mb-4 rounded-2xl" />
          <h1 className="text-xl font-semibold">Find Your Admin</h1>
          <p className="text-muted text-sm mt-1">Enter your email to find your admin dashboard</p>
        </div>

        <div className="bg-surface-2 border border-white/10 rounded-2xl p-6">
          {error && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm text-muted block mb-1.5">Email Address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" required autoFocus
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-accent focus:outline-none" />
            </div>
            <button type="submit" disabled={loading} className="w-full bg-accent text-black font-semibold py-3 rounded-lg hover:bg-accent/90 disabled:opacity-50 transition">
              {loading ? 'Looking up...' : 'Find My Dashboard'}
            </button>
          </form>
        </div>

        <div className="text-center mt-4 space-y-2">
          <a href="/login" className="text-accent text-sm hover:underline block">Already know your admin URL? Sign in directly</a>
          <a href="https://www.c-point.co" className="text-muted text-sm hover:underline block">Back to C.Point</a>
        </div>
      </div>
    </div>
  )
}
