import { useEffect, useState } from 'react'

export default function MobileLogin() {
  const [showForgot, setShowForgot] = useState(false)
  const [resetUsername, setResetUsername] = useState('')
  const [resetEmail, setResetEmail] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Read error from query string (e.g., /?error=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const e = params.get('error')
    setError(e)
  }, [])

  // Allow natural page scroll (no viewport locking)

  async function submitReset(e: React.FormEvent) {
    e.preventDefault()
    try {
      await fetch('/request_password_reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: resetUsername, email: resetEmail })
      })
    } catch {}
    setResetSent(true)
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-black text-white p-5">
      <div className="w-full max-w-xs border border-white/10 rounded-xl p-6 bg-white/5 backdrop-blur">
        <div className="text-center mb-5">
          <h1 className="text-lg font-semibold">C.Point</h1>
          <p className="text-xs text-white/60 mt-1">Sign in to your account</p>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-500 text-red-400 bg-red-500/10 px-3 py-2 text-sm text-center">
            {error}
          </div>
        )}

        <form method="POST" action="/" className="space-y-3">
          <div>
            <input
              type="text"
              name="username"
              placeholder="Username"
              required
              className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-3 text-base outline-none focus:border-teal-400/70"
            />
          </div>
          <button type="submit" className="w-full rounded-lg bg-teal-400 text-white py-2 text-sm font-medium active:opacity-90">Sign In</button>
        </form>

        <div className="text-center mt-3">
          <button onClick={() => { setShowForgot(true); setResetSent(false) }} className="text-teal-300 text-sm">Forgot Password?</button>
        </div>

        <div className="flex items-center gap-3 my-4 text-white/40 text-[12px]">
          <div className="flex-1 h-px bg-white/10" />
          <span>or</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <a href="/signup" className="block w-full text-center rounded-lg border border-white/10 bg-white/5 py-2 text-sm">Create Account</a>

        <div className="flex items-center gap-3 my-4 text-white/40 text-[12px]">
          <div className="flex-1 h-px bg-white/10" />
          <span>other options</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <a href="/login_x" className="block w-full text-center rounded-lg border border-white/10 bg-white/5 py-2 text-sm">Sign In with X</a>
      </div>

      {showForgot && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-[90%] max-w-sm bg-[#1a1a1a] border border-[#333] rounded-xl">
            <div className="flex items-center justify-between p-4 border-b border-[#333]">
              <h2 className="text-white text-base font-semibold">Reset Password</h2>
              <button className="text-[#999] text-2xl" onClick={() => setShowForgot(false)}>&times;</button>
            </div>
            <div className="p-4">
              {!resetSent ? (
                <>
                  <p className="text-white/70 text-sm mb-4">Enter your username and email address. We'll send you a link to reset your password.</p>
                  <form onSubmit={submitReset} className="space-y-3">
                    <input
                      type="text"
                      placeholder="Username"
                      value={resetUsername}
                      onChange={e => setResetUsername(e.target.value)}
                      required
                      className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm outline-none focus:border-teal-400/70"
                    />
                    <input
                      type="email"
                      placeholder="Email address"
                      value={resetEmail}
                      onChange={e => setResetEmail(e.target.value)}
                      required
                      className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm outline-none focus:border-teal-400/70"
                    />
                    <button type="submit" className="w-full rounded-lg bg-teal-400 text-white py-2 text-sm font-medium active:opacity-90">Send Reset Link</button>
                  </form>
                </>
              ) : (
                <>
                  <div className="w-full rounded-md border border-teal-500 text-teal-400 bg-teal-500/10 px-3 py-2 text-sm text-center">Reset link sent! Check your email.</div>
                  <p className="text-white/70 text-sm mt-4 text-center">If an account exists with the provided information, you will receive an email with instructions to reset your password.</p>
                  <button className="w-full mt-4 rounded-lg border border-white/10 bg-white/5 py-2 text-sm" onClick={() => setShowForgot(false)}>Close</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

