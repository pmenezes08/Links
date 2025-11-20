import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

const PENDING_INVITE_KEY = 'cpoint_pending_invite'

export default function MobileLogin() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('invite')
  const step = searchParams.get('step')
  const [showForgot, setShowForgot] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingUsername, setPendingUsername] = useState<string | null>(null)
  const [invitationInfo, setInvitationInfo] = useState<{community_name: string, invited_by: string} | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  // PWA install state (removed install UI)

  // Check invitation token
  useEffect(() => {
    if (!inviteToken) {
      try {
        if (typeof window !== 'undefined') sessionStorage.removeItem(PENDING_INVITE_KEY)
      } catch {}
      return
    }
    fetch(`/api/invitation/verify?token=${inviteToken}`, { credentials: 'include' })
      .then(r => r.json())
      .then(j => {
        if (j?.success) {
          const payload = {
            communityId: j.community_id ?? null,
            communityName: j.community_name,
            inviteToken,
          }
          try {
            if (typeof window !== 'undefined') sessionStorage.setItem(PENDING_INVITE_KEY, JSON.stringify(payload))
          } catch {}
          const isQRInvite = j.email?.startsWith('qr-invite-') && j.email?.endsWith('@placeholder.local')
          if (isQRInvite) {
            setInvitationInfo({ community_name: j.community_name, invited_by: j.invited_by })
          }
        } else {
          try {
            if (typeof window !== 'undefined') sessionStorage.removeItem(PENDING_INVITE_KEY)
          } catch {}
        }
      })
      .catch(err => console.error('Error verifying invitation:', err))
  }, [inviteToken])

  // If already authenticated, auto-join community if invited
  useEffect(() => {
    // Skip auth check if we're on the password step
    if (step === 'password') return
    
    async function check(){
      try{
        const r = await fetch('/api/profile_me', { credentials:'include' })
        if (r.status === 403){
          navigate('/verify_required', { replace: true })
          return
        }
        if (r.ok){
          const j = await r.json()
          if (j && j.username){
            // If user has invite token, auto-join them
            if (inviteToken) {
              try {
                const joinResponse = await fetch('/api/join_with_invite', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({ invite_token: inviteToken })
                })
                const joinData = await joinResponse.json()
                if (joinData?.success) {
                  // Redirect to the community
                  navigate(`/community_feed_react/${joinData.community_id}`, { replace: true })
                  return
                } else if (joinResponse.status === 403) {
                  // Email mismatch - show error
                  setError(joinData?.error || 'This invitation was sent to a different email address')
                }
              } catch (err) {
                console.error('Error joining via invite:', err)
              }
            }
            
            // Normal flow
            try{
              const ht = await fetch('/api/home_timeline', { credentials:'include' })
              const hj = await ht.json().catch(()=>null)
              const hasCommunities = Boolean(hj?.admin_communities?.length || hj?.communities_list?.length)
              if (!hasCommunities){
                navigate('/onboarding', { replace: true })
                return
              }
            }catch{}
            navigate('/premium_dashboard', { replace: true })
            return
          }
        }
      }catch{}
    }
    check()
  }, [navigate, inviteToken, step])

  // Read error from query string (e.g., /?error=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const e = params.get('error')
    setError(e)
  }, [])

  // Check if there's a pending username (password step)
  useEffect(() => {
    if (step === 'password') {
      // Check session for pending username
      fetch('/api/check_pending_login', { credentials: 'include' })
        .then(r => r.json())
        .then(j => {
          if (j?.pending_username) {
            setPendingUsername(j.pending_username)
          } else {
            // No pending login, redirect back to username step
            navigate('/login', { replace: true })
          }
        })
        .catch(() => navigate('/login', { replace: true }))
    }
  }, [step, navigate])

  // Removed install prompt wiring

  // Removed install handler

  // Allow natural page scroll (no viewport locking)

  async function submitReset(e: React.FormEvent) {
    e.preventDefault()
    try {
      await fetch('/request_password_reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail })
      })
    } catch {}
    setResetSent(true)
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-black text-white p-5 relative">
      <div className="w-full max-w-xs rounded-xl p-6 relative z-10 bg-black border border-white/10">
        {step !== 'password' && (
          <div className="text-center mb-5">
            <h1 className="text-lg font-semibold">C.Point</h1>
            {invitationInfo ? (
              <div className="mt-3 p-3 bg-[#4db6ac]/10 border border-[#4db6ac]/30 rounded-lg">
                <p className="text-xs text-white font-medium">
                  You've been invited to join
                </p>
                <p className="text-sm text-[#4db6ac] font-semibold mt-1">
                  {invitationInfo.community_name}
                </p>
                <p className="text-xs text-white/60 mt-1">
                  by {invitationInfo.invited_by}
                </p>
              </div>
            ) : (
              <p className="text-xs text-white/60 mt-1">Sign in to your account</p>
            )}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-md border border-red-500 text-red-400 bg-red-500/10 px-3 py-2 text-sm text-center">
            {error}
          </div>
        )}

        {step === 'password' && pendingUsername ? (
          <form method="POST" action="/login_password" className="space-y-3">
            <div className="text-center mb-4">
              <h2 className="text-xl font-semibold text-white mb-1">Welcome Back</h2>
              <p className="text-white/70 text-base">{pendingUsername}</p>
            </div>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                placeholder="Enter Password"
                required
                autoFocus
                className="w-full rounded-md bg-black border border-white/10 px-3 py-2.5 text-sm text-white outline-none pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white"
              >
                {showPassword ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
            <button type="submit" className="w-full rounded-lg bg-teal-400 text-white py-2.5 text-sm font-medium active:opacity-90">Login</button>
            <button type="button" onClick={() => navigate('/login')} className="w-full rounded-lg border border-white/10 bg-white/5 text-white py-2.5 text-sm font-medium active:opacity-90">Back</button>
          </form>
        ) : (
          <form 
            method="POST" 
            action="/login"
            className="space-y-3" 
            onSubmit={() => {
              console.log('Form submitting...')
              setIsSubmitting(true)
              setError(null)
              // Allow default form submission to proceed
            }}
          >
            {inviteToken && <input type="hidden" name="invite_token" value={inviteToken} />}
            <div>
              <input
                type="text"
                name="username"
                placeholder="Username"
                required
                autoComplete="username"
                className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-3 text-base outline-none focus:border-teal-400/70"
              />
            </div>
            <button 
              type="submit" 
              disabled={isSubmitting}
              className="w-full rounded-lg bg-teal-400 text-white py-2 text-sm font-medium active:opacity-90 disabled:opacity-50"
            >
              {isSubmitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        )}
        {false && (
          <div className="mt-3">
            <a href="/login_back" className="text-xs text-white/60 hover:text-white/80">Back</a>
          </div>
        )}

        <div className="text-center mt-3">
          <button onClick={() => { setShowForgot(true); setResetSent(false) }} className="text-teal-300 text-sm">Forgot Password?</button>
        </div>

        {step !== 'password' && (
          <>
            <div className="flex items-center gap-3 my-4 text-white/40 text-[12px]">
              <div className="flex-1 h-px bg-white/10" />
              <span>or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            <a href={inviteToken ? `/signup?invite=${inviteToken}` : '/signup'} className="block w-full text-center rounded-lg border border-white/10 bg-white/5 py-2 text-sm">Create Account</a>
          </>
        )}

        {/* Install app UI removed */}
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
                  <p className="text-white/70 text-sm mb-4">Enter your email address. We'll send you a link to reset your password.</p>
                  <form onSubmit={submitReset} className="space-y-3">
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

      {/* Install modal removed */}
    </div>
  )
}

