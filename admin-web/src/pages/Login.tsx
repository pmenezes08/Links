import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../utils/api'

export default function Login() {
  const navigate = useNavigate()
  const [step, setStep] = useState<'username' | 'password'>('username')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleUsername = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim()) return
    setLoading(true)
    setError('')
    try {
      const fd = new URLSearchParams({ username: username.trim() })
      const res = await api('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: fd })
      if (res.redirected || res.ok) {
        setStep('password')
      } else {
        setError('User not found')
      }
    } catch { setError('Connection error') }
    finally { setLoading(false) }
  }

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password) return
    setLoading(true)
    setError('')
    try {
      const fd = new URLSearchParams({ password, username: username.trim() })
      // Use redirect:'manual' so we get the Set-Cookie without following cross-origin redirect
      const res = await api('/login_password', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, 
        body: fd,
        redirect: 'manual'
      })
      // Status 0 = opaque redirect (CORS), 302/303 = redirect, 200 = success
      if (res.status === 0 || res.ok || res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
        // Small delay to let cookie propagate
        await new Promise(r => setTimeout(r, 300))
        const check = await api('/api/check_admin')
        const j = await check.json()
        if (j?.is_admin) { navigate('/', { replace: true }) }
        else { setError('Not authorized. Admin access required.') }
      } else {
        setError('Invalid password')
      }
    } catch { setError('Connection error') }
    finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src={`${import.meta.env.VITE_API_BASE || ''}/api/public/logo`} alt="C.Point" className="w-16 h-16 mx-auto mb-4 rounded-2xl" />
          <h1 className="text-xl font-semibold">C.Point Admin</h1>
          <p className="text-muted text-sm mt-1">Sign in to manage your platform</p>
        </div>

        <div className="bg-surface-2 border border-white/10 rounded-2xl p-6">
          {error && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">{error}</div>}

          {step === 'username' ? (
            <form onSubmit={handleUsername} className="space-y-4">
              <div>
                <label className="text-sm text-muted block mb-1.5">Username</label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter username" required autoFocus
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-accent focus:outline-none" />
              </div>
              <button type="submit" disabled={loading} className="w-full bg-accent text-black font-semibold py-3 rounded-lg hover:bg-accent/90 disabled:opacity-50 transition">
                {loading ? 'Checking...' : 'Continue'}
              </button>
            </form>
          ) : (
            <form onSubmit={handlePassword} className="space-y-4">
              <div className="text-sm text-muted mb-2">Signing in as <span className="text-accent font-medium">@{username}</span></div>
              <div>
                <label className="text-sm text-muted block mb-1.5">Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" required autoFocus
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-accent focus:outline-none" />
              </div>
              <button type="submit" disabled={loading} className="w-full bg-accent text-black font-semibold py-3 rounded-lg hover:bg-accent/90 disabled:opacity-50 transition">
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
              <button type="button" onClick={() => { setStep('username'); setPassword(''); setError('') }} className="w-full text-muted text-sm hover:text-white transition">Back</button>
            </form>
          )}
        </div>

        <div className="text-center mt-4">
          <a href="https://app.c-point.co/login" target="_blank" rel="noopener" className="text-accent text-sm hover:underline">Forgot password?</a>
        </div>
      </div>
    </div>
  )
}
