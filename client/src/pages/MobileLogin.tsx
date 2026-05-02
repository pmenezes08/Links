import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { resetAllAccountState } from '../utils/accountStateReset'
import { invalidateDashboardCache } from '../utils/dashboardCache'
import { deleteCachedKeyVal } from '../utils/offlineDb'
import { triggerDashboardServerPull } from '../utils/serverPull'
import { markClipboardInviteConsumed, parseInviteTokenFromClipboard } from '../utils/clipboardInvite'
import { extractInviteToken } from '../utils/internalLinkHandler'
import {
  loadGsiScript,
  setGsiIdTokenHandler,
  initializeGoogleIdentityOnce,
  renderGoogleSignInButton,
} from '../utils/googleIdentityWeb'
import { useUserProfile } from '../contexts/UserProfileContext'

const PENDING_INVITE_KEY = 'cpoint_pending_invite'

export default function MobileLogin() {
  const navigate = useNavigate()
  const { refresh, applyProfileFromServer } = useUserProfile()
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
  const [authCheckDone, setAuthCheckDone] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [inviteFromInstallBusy, setInviteFromInstallBusy] = useState(false)
  const [showInviteClipboardModal, setShowInviteClipboardModal] = useState(false)
  // PWA install state (removed install UI)

  // Check invitation token
  useEffect(() => {
    if (!inviteToken) {
      try {
        if (typeof window !== 'undefined') sessionStorage.removeItem(PENDING_INVITE_KEY)
      } catch {}
      return
    }
    fetch(`/api/invitation/verify?token=${inviteToken}`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(r => r.json())
      .then(j => {
        if (j?.success) {
          setError(null)
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

  /** User gesture (tap) is required for reliable clipboard read on iOS. */
  const tryInviteFromInstallTap = useCallback(async () => {
    setError(null)
    setInviteFromInstallBusy(true)
    try {
      const text = await navigator.clipboard.readText()
      const raw = text.trim()
      let token = parseInviteTokenFromClipboard(raw)
      if (!token && (raw.startsWith('http') || raw.startsWith('cpoint://'))) {
        token = extractInviteToken(raw)
      }
      if (!token) {
        setError('Could not read your invite. Click on the invite link, then try again.')
        return
      }

      const r = await fetch(`/api/invitation/verify?token=${encodeURIComponent(token)}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      const j = await r.json()
      if (!j?.success || !j.community_name) {
        setError('This invite is not valid or has already been used.')
        return
      }

      markClipboardInviteConsumed(token)
      navigate(`/login?invite=${encodeURIComponent(token)}`, { replace: true })
    } catch {
      setError('Could not read your invite. Click on the invite link, then try again.')
    } finally {
      setInviteFromInstallBusy(false)
      setShowInviteClipboardModal(false)
    }
  }, [navigate])

  const gsiButtonRef = useRef<HTMLDivElement>(null)

  const postGoogleIdToken = useCallback(
    async (idToken: string) => {
      setError(null)
      const isAndroidGoogleDebug = Capacitor.getPlatform() === 'android'
      const finishSuccess = async (j: { username?: string; is_new?: boolean; login_id?: string }) => {
        if (inviteToken) {
          try {
            await fetch('/api/join_with_invite', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ invite_token: inviteToken }),
            })
          } catch {}
        }

        // CRITICAL ORDER (account-isolation hardening, PR 2):
        // 1. Reset all client state BEFORE writing the new identity, so any
        //    leftover bytes from the previous session cannot leak into the
        //    bootstrap render. Keep the SW registered (we still want it) but
        //    flush every cache, IndexedDB row, and localStorage key.
        // 2. Then capture the new username + signin-notice flag.
        await resetAllAccountState({ unregisterServiceWorkers: false })

        // Restore the existing-account banner flag AFTER the reset, since
        // resetAllAccountState wipes sessionStorage.
        if (j.is_new === false) {
          try {
            sessionStorage.setItem('cpoint_signin_notice', 'existing_account')
          } catch {
            /* ignore */
          }
        }

        try {
          localStorage.setItem('current_username', j.username ?? '')
          if (j.login_id) localStorage.setItem('last_login_id', j.login_id)
        } catch {}

        invalidateDashboardCache()
        void deleteCachedKeyVal('dashboard-data')

        await (window as any).__reregisterPushToken?.()
        await triggerDashboardServerPull()
        try {
          await refresh()
        } catch {
          /* ignore; dashboard will refetch */
        }
        window.location.assign('/premium_dashboard')
      }
      try {
        const r = await fetch('/api/auth/google', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id_token: idToken,
            platform: Capacitor.getPlatform(),
            invite_token: inviteToken || undefined,
          }),
        })

        // Android only: surface HTTP status + non-JSON bodies (iOS/web unchanged).
        if (isAndroidGoogleDebug) {
          const text = await r.text()
          let j: { success?: boolean; username?: string; is_new?: boolean; login_id?: string; error?: string } | null = null
          try {
            j = text ? (JSON.parse(text) as { success?: boolean; username?: string; is_new?: boolean; login_id?: string; error?: string }) : null
          } catch {
            const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 280)
            setError(
              `Google sign-in HTTP ${r.status}: response was not JSON${snippet ? ` — ${snippet}` : ''}`,
            )
            return
          }
          if (j?.success) {
            await finishSuccess(j)
          } else {
            setError(j?.error || `Google sign-in failed (HTTP ${r.status})`)
          }
          return
        }

        const j = await r.json()
        if (j?.success) {
          await finishSuccess(j)
        } else {
          setError(j?.error || 'Google sign-in failed')
        }
      } catch {
        setError(
          isAndroidGoogleDebug
            ? 'Google sign-in: network error or request failed before a response.'
            : 'Google sign-in failed. Please try again.',
        )
      }
    },
    [inviteToken, refresh],
  )

  useEffect(() => {
    if (Capacitor.isNativePlatform() || step === 'password') return
    let cancelled = false
    void loadGsiScript().then(() => {
      if (cancelled) return
      setGsiIdTokenHandler((jwt) => {
        setGoogleLoading(true)
        void postGoogleIdToken(jwt).finally(() => setGoogleLoading(false))
      })
      initializeGoogleIdentityOnce()
      requestAnimationFrame(() => {
        if (cancelled || !gsiButtonRef.current) return
        renderGoogleSignInButton(gsiButtonRef.current, { theme: 'filled_black' })
      })
    })
    return () => {
      cancelled = true
      setGsiIdTokenHandler(null)
    }
  }, [step, postGoogleIdToken])

  // If already authenticated, auto-join community if invited
  useEffect(() => {
    // Skip auth check if we're on the password step or already checked
    if (step === 'password') return
    if (authCheckDone) return
    
    async function check(){
      try{
        // CRITICAL: First clear any stale sessions (from deleted accounts)
        await fetch('/api/clear_stale_session', { 
          method: 'POST', 
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' }
        })
        
        const r = await fetch('/api/profile_me', { credentials:'include', headers: { 'Accept': 'application/json' } })
        if (r.status === 403){
          setAuthCheckDone(true)
          navigate('/verify_required', { replace: true })
          return
        }
        if (r.ok){
          const j = await r.json()
          if (j?.success && j?.profile) {
            const profile = j.profile as Record<string, unknown>
            const loginId = typeof j.login_id === 'string' ? j.login_id : undefined
            applyProfileFromServer(profile, loginId)
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
                  await triggerDashboardServerPull()
                  setAuthCheckDone(true)
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
              const ht = await fetch('/api/home_timeline', { credentials:'include', headers: { 'Accept': 'application/json' } })
              const hj = await ht.json().catch(()=>null)
              const hasCommunities = Boolean(hj?.admin_communities?.length || hj?.communities_list?.length)
              if (!hasCommunities){
                setAuthCheckDone(true)
                navigate('/onboarding', { replace: true })
                return
              }
            }catch{}
            setAuthCheckDone(true)
            navigate('/premium_dashboard', { replace: true })
            return
          }
        }
        // User not authenticated - stay on login page
        setAuthCheckDone(true)
      }catch{
        setAuthCheckDone(true)
      }
    }
    check()
  }, [navigate, inviteToken, step, authCheckDone, applyProfileFromServer])

  // Sync error from query string when URL changes (e.g. /?error=... → /login?invite=...)
  useEffect(() => {
    const e = searchParams.get('error')
    setError(e)
  }, [searchParams])

  // Check if there's a pending username (password step)
  useEffect(() => {
    if (step === 'password') {
      // Check session for pending username
      fetch('/api/check_pending_login', { 
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      })
        .then(r => r.json())
        .then(j => {
          console.log('check_pending_login response:', j)
          if (j?.pending_username) {
            setPendingUsername(j.pending_username)
          } else {
            // No pending login in session
            // Check if we have a locally stored pending username (fallback for iOS)
            const storedUsername = sessionStorage.getItem('cpoint_pending_username')
            if (storedUsername) {
              console.log('Using stored pending username:', storedUsername)
              setPendingUsername(storedUsername)
            } else {
              // Redirect back to username step
              console.log('No pending username found, redirecting to login')
              navigate('/login' + (inviteToken ? `?invite=${inviteToken}` : ''), { replace: true })
            }
          }
        })
        .catch((err) => {
          console.error('check_pending_login error:', err)
          // Fallback to local storage
          const storedUsername = sessionStorage.getItem('cpoint_pending_username')
          if (storedUsername) {
            setPendingUsername(storedUsername)
          } else {
            navigate('/login' + (inviteToken ? `?invite=${inviteToken}` : ''), { replace: true })
          }
        })
    }
  }, [step, navigate, inviteToken])

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
            <h1 className="text-lg font-semibold">C-Point</h1>
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
          <form 
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault()
              setIsSubmitting(true)
              setError(null)
              
              const formData = new FormData(e.currentTarget)
              const password = formData.get('password') as string
              
              if (!password) {
                setError('Password is required')
                setIsSubmitting(false)
                return
              }
              
              try {
                // Include username in request body as fallback for iOS session issues
                const response = await fetch('/login_password', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  credentials: 'include',
                  body: new URLSearchParams({ password, username: pendingUsername })
                })
                
                // Check for redirect (successful login)
                if (response.redirected) {
                  const url = new URL(response.url)
                  console.log('Password login redirected to:', url.pathname)
                  
                  // Check if redirected to login with error
                  if (url.pathname === '/login') {
                    const errorParam = url.searchParams.get('error')
                    if (errorParam) {
                      setError(decodeURIComponent(errorParam))
                      setIsSubmitting(false)
                      return
                    }
                    // Redirected back to login without error - session issue
                    setError('Session expired. Please try again.')
                    navigate('/login' + (inviteToken ? `?invite=${inviteToken}` : ''), { replace: true })
                    setIsSubmitting(false)
                    return
                  }
                  
                  // Successful login - re-register push token, clear stored username, redirect
                  try { sessionStorage.removeItem('cpoint_pending_username') } catch {}
                  await (window as any).__reregisterPushToken?.()
                  window.location.href = url.pathname + url.search
                  return
                }
                
                // If not redirected, try to parse response for errors
                const text = await response.text()
                if (text.includes('error=')) {
                  const errorMatch = text.match(/error=([^&"]+)/)
                  if (errorMatch) {
                    setError(decodeURIComponent(errorMatch[1]))
                  } else {
                    setError('Incorrect password. Please try again.')
                  }
                } else if (response.ok) {
                  await (window as any).__reregisterPushToken?.()
                  window.location.href = '/premium_dashboard'
                } else {
                  setError('Login failed. Please try again.')
                }
              } catch (err) {
                console.error('Password login error:', err)
                setError('Connection error. Please try again.')
              } finally {
                setIsSubmitting(false)
              }
            }}
          >
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
            <button 
              type="submit" 
              disabled={isSubmitting}
              className="w-full rounded-lg bg-teal-400 text-white py-2.5 text-sm font-medium active:opacity-90 disabled:opacity-50"
            >
              {isSubmitting ? 'Logging in...' : 'Login'}
            </button>
            <button type="button" onClick={() => navigate('/login')} className="w-full rounded-lg border border-white/10 bg-white/5 text-white py-2.5 text-sm font-medium active:opacity-90">Back</button>
          </form>
        ) : (
          <form 
            className="space-y-3" 
            onSubmit={async (e) => {
              e.preventDefault()
              console.log('Form submitting...')
              setIsSubmitting(true)
              setError(null)
              
              const formData = new FormData(e.currentTarget)
              const username = formData.get('username') as string
              
              if (!username?.trim()) {
                setError('Username is required')
                setIsSubmitting(false)
                return
              }
              
              try {
                // Store username locally as a fallback (for iOS session issues)
                try {
                  sessionStorage.setItem('cpoint_pending_username', username.trim())
                } catch (e) {
                  console.warn('Could not store pending username:', e)
                }
                
                // Submit username to start login flow
                const response = await fetch('/login', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  credentials: 'include',
                  body: new URLSearchParams({
                    username: username.trim(),
                    ...(inviteToken ? { invite_token: inviteToken } : {})
                  })
                })
                
                // Check if redirected
                if (response.redirected) {
                  const url = new URL(response.url)
                  
                  // Check for error in redirected URL (e.g., username doesn't exist)
                  const errorParam = url.searchParams.get('error')
                  if (errorParam) {
                    setError(decodeURIComponent(errorParam))
                    // Clear stored username on error
                    try { sessionStorage.removeItem('cpoint_pending_username') } catch {}
                    return
                  }
                  
                  // Check if redirected to password step
                  if (url.pathname === '/login' && url.searchParams.get('step') === 'password') {
                    // Navigate to password step
                    navigate(`/login?step=password${inviteToken ? `&invite=${inviteToken}` : ''}`)
                    return
                  }
                }
                
                // If not redirected, try to parse response
                const text = await response.text()
                if (text.includes('error=')) {
                  const errorMatch = text.match(/error=([^&"]+)/)
                  if (errorMatch) {
                    setError(decodeURIComponent(errorMatch[1]))
                    // Clear stored username on error
                    try { sessionStorage.removeItem('cpoint_pending_username') } catch {}
                  }
                } else {
                  // Likely redirected to password step, navigate there
                  navigate(`/login?step=password${inviteToken ? `&invite=${inviteToken}` : ''}`)
                }
              } catch (err) {
                console.error('Login error:', err)
                setError('Connection error. Please try again.')
                // Clear stored username on error
                try { sessionStorage.removeItem('cpoint_pending_username') } catch {}
              } finally {
                setIsSubmitting(false)
              }
            }}
          >
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

            <div className="flex flex-col gap-3">
              {Capacitor.isNativePlatform() ? (
                <button
                  type="button"
                  disabled={googleLoading || isSubmitting || !window.__googleAuthReady}
                  className="w-full rounded-lg border border-white/10 bg-white/5 py-2.5 text-sm font-medium active:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                  onClick={async () => {
                    const isAndroid = Capacitor.getPlatform() === 'android'
                    setGoogleLoading(true)
                    setError(null)
                    try {
                      const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth')
                      const result = await GoogleAuth.signIn()
                      const idToken = result?.authentication?.idToken
                      if (!idToken) {
                        if (isAndroid) {
                          const hint = result?.authentication
                            ? 'authentication object present but idToken missing (check Web client ID / SHA-1).'
                            : 'no authentication in sign-in result.'
                          console.error('[Google Sign-In Android]', hint, result)
                          setError(`Google sign-in failed: ${hint}`)
                        } else {
                          setError('Google sign-in failed')
                        }
                        return
                      }
                      await postGoogleIdToken(idToken)
                    } catch (err: any) {
                      if (err?.message !== 'The user canceled the sign-in flow.') {
                        if (isAndroid) {
                          const msg =
                            typeof err?.message === 'string' && err.message.trim()
                              ? err.message.trim()
                              : String(err ?? 'unknown error')
                          console.error('[Google Sign-In Android]', err)
                          setError(`Google sign-in: ${msg}`)
                        } else {
                          setError('Google sign-in failed. Please try again.')
                        }
                      }
                    } finally {
                      setGoogleLoading(false)
                    }
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                  {googleLoading ? 'Signing in...' : 'Sign in with Google'}
                </button>
              ) : (
                <div
                  className={`relative w-full min-h-[44px] ${
                    googleLoading || isSubmitting || !window.__googleAuthReady
                      ? 'pointer-events-none opacity-50'
                      : ''
                  }`}
                >
                  {/* Visual match to native (iOS/Android); GIS button sits underneath (invisible) for JWT. */}
                  <div
                    className="pointer-events-none relative z-[1] flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 py-2.5 text-sm font-medium text-white"
                    aria-hidden
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                    {googleLoading ? 'Signing in...' : 'Sign in with Google'}
                  </div>
                  <div
                    ref={gsiButtonRef}
                    className="absolute inset-0 z-0 flex w-full cursor-pointer items-stretch justify-center opacity-0"
                    aria-label="Sign in with Google"
                  />
                </div>
              )}

              <a href={inviteToken ? `/signup?invite=${inviteToken}` : '/signup'} className="block w-full text-center rounded-lg border border-white/10 bg-white/5 py-2 text-sm">Create Account</a>

              {Capacitor.getPlatform() !== 'web' && !inviteToken && authCheckDone && (
                <div className="space-y-2">
                  <button
                    type="button"
                    disabled={inviteFromInstallBusy}
                    onClick={() => setShowInviteClipboardModal(true)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 py-2 text-sm text-center active:opacity-90 disabled:opacity-50"
                  >
                    Use Community Invite
                  </button>
                  <p className="text-white/40 text-[11px] text-center leading-snug">
                    After installing C-Point from an invite link, tap here before you sign in
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {/* Terms and Privacy Policy */}
        <div className="mt-4 text-center">
          <p className="text-white/40 text-xs">
            By signing in, you agree to our{' '}
            <a 
              href="https://www.c-point.co/terms" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-teal-300 hover:underline"
            >
              Terms of Service
            </a>{' '}
            and{' '}
            <a 
              href="https://www.c-point.co/privacy" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-teal-300 hover:underline"
            >
              Privacy Policy
            </a>
          </p>
        </div>

        {/* Install app UI removed */}
      </div>

      {showInviteClipboardModal && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
          onClick={() => setShowInviteClipboardModal(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-[360px] rounded-2xl border border-white/10 bg-[#111] p-5 text-white shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-center mb-4">
              <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-[#4db6ac]/10 flex items-center justify-center">
                <i className="fa-solid fa-link text-[#4db6ac] text-xl" />
              </div>
              <h3 className="text-lg font-semibold m-0">Use your invite link</h3>
            </div>
            <p className="text-sm text-white/70 text-center mb-4 leading-relaxed">
              We&apos;ll read your clipboard once to find your community invite. On the next step, iOS may ask you to allow paste — that&apos;s expected.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={inviteFromInstallBusy}
                onClick={() => void tryInviteFromInstallTap()}
                className="w-full rounded-xl bg-[#4db6ac] text-black font-semibold text-sm py-3 active:opacity-90 disabled:opacity-50"
              >
                {inviteFromInstallBusy ? 'Checking…' : 'Continue'}
              </button>
              <button
                type="button"
                disabled={inviteFromInstallBusy}
                onClick={() => setShowInviteClipboardModal(false)}
                className="w-full rounded-xl bg-white/5 text-white/60 text-sm py-3 border-0 active:opacity-90 disabled:opacity-50"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

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
