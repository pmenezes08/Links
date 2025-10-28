import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Signup(){
  const navigate = useNavigate()
  const [formData, setFormData] = useState({
    username: '',
    first_name: '',
    last_name: '',
    email: '',
    mobile: '',
    password: '',
    confirm_password: ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [debugInfo, setDebugInfo] = useState<string[]>([])
  const [showVerify, setShowVerify] = useState(false)
  const [pendingEmail, setPendingEmail] = useState('')
  const [showInstallPrompt, setShowInstallPrompt] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [checkingInstall, setCheckingInstall] = useState(true)

  // Check if app is installed on mount
  useEffect(() => {
    async function checkInstallStatus() {
      try {
        // Check if running in standalone mode
        const mql = window.matchMedia && window.matchMedia('(display-mode: standalone)')
        const standalone = (mql && mql.matches) || (navigator as any).standalone === true
        
        if (standalone) {
          // Already installed, don't show prompt
          setCheckingInstall(false)
          return
        }

        // Check for installed related apps (Android/Chrome)
        const navAny: any = navigator as any
        if (typeof navAny.getInstalledRelatedApps === 'function') {
          const related = await navAny.getInstalledRelatedApps()
          if (Array.isArray(related) && related.length > 0) {
            // Already installed, don't show prompt
            setCheckingInstall(false)
            return
          }
        }

        // Detect iOS
        const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
        setIsIOS(ios)

        // Not installed - show prompt after brief delay
        setTimeout(() => {
          setCheckingInstall(false)
          setShowInstallPrompt(true)
        }, 500)
      } catch (err) {
        console.error('Install check error:', err)
        setCheckingInstall(false)
      }
    }

    checkInstallStatus()
  }, [])

  // Lock body scroll when modals are shown
  useEffect(() => {
    if (typeof document !== 'undefined') {
      try {
        document.body.style.overflow = (showVerify || showInstallPrompt) ? 'hidden' : ''
      } catch {}
    }
  }, [showVerify, showInstallPrompt])

  function handleInputChange(field: string, value: string) {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (error) setError('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    console.log('Signup form submitted with data:', formData)
    setDebugInfo(['Form submitted, validating...'])

    // Validation
    if (!formData.first_name.trim()) {
      setError('First name is required')
      return
    }
    if (!formData.last_name.trim()) {
      setError('Last name is required')
      return
    }
    if (!formData.username.trim()) {
      setError('Username is required')
      return
    }
    if (!formData.email.trim()) {
      setError('Email is required')
      return
    }
    if (!formData.password) {
      setError('Password is required')
      return
    }
    if (formData.password !== formData.confirm_password) {
      setError('Passwords do not match')
      return
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setLoading(true)

    const submitData = new FormData()
    submitData.append('username', formData.username)
    submitData.append('first_name', formData.first_name)
    submitData.append('last_name', formData.last_name)
    submitData.append('email', formData.email)
    submitData.append('mobile', formData.mobile)
    submitData.append('password', formData.password)
    submitData.append('confirm_password', formData.confirm_password)

    console.log('Sending signup request to /signup')
    console.log('FormData contents:', Array.from(submitData.entries()))
    setDebugInfo(prev => [...prev, 'Sending request to server...'])

    fetch('/signup', {
      method: 'POST',
      credentials: 'include',
      body: submitData
    })
    .then(async r => {
      console.log('Signup response status:', r.status)
      console.log('Signup response headers:', r.headers)
      setDebugInfo(prev => [...prev, `Response received: ${r.status}`])
      
      if (r.ok) {
        try {
          const j = await r.json()
          console.log('Signup JSON response:', j)
          
          if (j?.success) {
            const dest = j.redirect || '/premium_dashboard'
            if (j.needs_email_verification) {
              setPendingEmail(formData.email)
              setShowVerify(true)
            } else {
              navigate(dest)
            }
          } else {
            setError(j?.error || 'Registration failed')
          }
        } catch (jsonError) {
          setShowVerify(true)
        }
      } else {
        try {
          const j = await r.json()
          setError(j?.error || `Server error (${r.status})`)
        } catch {
          setError(`Server error (${r.status})`)
        }
      }
    })
    .catch((error) => {
      console.error('Signup fetch error:', error)
      setDebugInfo(prev => [...prev, `Network error: ${error.message}`])
      setError(`Network error: ${error.message}`)
    })
    .finally(() => setLoading(false))
  }

  // Show loading spinner while checking install status
  if (checkingInstall) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <i className="fa-solid fa-spinner fa-spin text-3xl text-[#4db6ac] mb-3" />
          <p className="text-white/60 text-sm">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold mb-2">Create Account</h1>
          <p className="text-white/60 text-sm">Join C.Point today</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Debug Info (visible on screen) */}
        {debugInfo.length > 0 && (
          <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-blue-400 text-xs">
            <div className="font-medium mb-1">Debug Info:</div>
            {debugInfo.map((info, i) => (
              <div key={i}>• {info}</div>
            ))}
          </div>
        )}

        {/* Signup Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Name Fields */}
          <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1.5">Username</label>
            <input
              type="text"
              value={formData.username}
              onChange={e => handleInputChange('username', e.target.value)}
              placeholder="Choose a unique username"
              required
              className="w-full px-3 py-2.5 bg-white/5 border border-white/20 rounded-lg text-sm text-white placeholder-white/50 focus:border-[#4db6ac] focus:outline-none transition-colors"
            />
          </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">First Name</label>
              <input
                type="text"
                value={formData.first_name}
                onChange={e => handleInputChange('first_name', e.target.value)}
                placeholder="First"
                required
                className="w-full px-3 py-2.5 bg-white/5 border border-white/20 rounded-lg text-sm text-white placeholder-white/50 focus:border-[#4db6ac] focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">Last Name</label>
              <input
                type="text"
                value={formData.last_name}
                onChange={e => handleInputChange('last_name', e.target.value)}
                placeholder="Last"
                required
                className="w-full px-3 py-2.5 bg-white/5 border border-white/20 rounded-lg text-sm text-white placeholder-white/50 focus:border-[#4db6ac] focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-medium mb-1.5">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={e => handleInputChange('email', e.target.value)}
              placeholder="your@email.com"
              required
              className="w-full px-3 py-2.5 bg-white/5 border border-white/20 rounded-lg text-sm text-white placeholder-white/50 focus:border-[#4db6ac] focus:outline-none transition-colors"
            />
          </div>

          {/* Mobile (Optional) */}
          <div>
            <label className="block text-xs font-medium mb-1.5">Mobile (Optional)</label>
            <input
              type="tel"
              value={formData.mobile}
              onChange={e => handleInputChange('mobile', e.target.value)}
              placeholder="+1 (555) 123-4567"
              className="w-full px-3 py-2.5 bg-white/5 border border-white/20 rounded-lg text-sm text-white placeholder-white/50 focus:border-[#4db6ac] focus:outline-none transition-colors"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-medium mb-1.5">Password</label>
            <input
              type="password"
              value={formData.password}
              onChange={e => handleInputChange('password', e.target.value)}
              placeholder="••••••••"
              required
              className="w-full px-3 py-2.5 bg-white/5 border border-white/20 rounded-lg text-sm text-white placeholder-white/50 focus:border-[#4db6ac] focus:outline-none transition-colors"
            />
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-xs font-medium mb-1.5">Confirm Password</label>
            <input
              type="password"
              value={formData.confirm_password}
              onChange={e => handleInputChange('confirm_password', e.target.value)}
              placeholder="••••••••"
              required
              className="w-full px-3 py-2.5 bg-white/5 border border-white/20 rounded-lg text-sm text-white placeholder-white/50 focus:border-[#4db6ac] focus:outline-none transition-colors"
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors ${
              loading
                ? 'bg-gray-600 text-gray-300 cursor-not-allowed'
                : 'bg-[#4db6ac] text-black hover:bg-[#45a99c]'
            }`}
          >
            {loading ? (
              <>
                <i className="fa-solid fa-spinner fa-spin mr-2" />
                Creating Account...
              </>
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        {/* Login Link */}
        <div className="mt-4 text-center">
          <p className="text-white/60 text-xs">
            Already have an account?{' '}
            <button 
              className="text-[#4db6ac] hover:text-[#45a99c] transition-colors text-xs"
              onClick={() => navigate('/login')}
            >
              Sign in
            </button>
          </p>
        </div>

        {/* Terms */}
        <div className="mt-4 text-center">
          <p className="text-white/40 text-xs">
            By creating an account, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>

        {/* Install App Prompt Modal - Shows BEFORE signup */}
        {showInstallPrompt && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 backdrop-blur-sm" aria-modal="true" role="dialog">
            <div className="w-[90%] max-w-md rounded-2xl border border-[#4db6ac]/30 bg-[#0b0b0b] p-6 shadow-[0_0_40px_rgba(77,182,172,0.3)]">
              {/* Icon */}
              <div className="text-center mb-4">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#4db6ac]/10 border border-[#4db6ac]/30 mb-3">
                  <i className="fa-solid fa-download text-2xl text-[#4db6ac]" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Install C.Point First</h3>
                <p className="text-sm text-white/70 leading-relaxed">
                  Before creating your account, please install the C.Point app to receive notifications and get the full experience.
                </p>
              </div>

              {/* Instructions */}
              <div className="bg-white/5 border border-white/10 rounded-lg p-4 mb-4">
                <div className="text-xs font-semibold text-[#4db6ac] mb-2">How to install:</div>
                <div className="space-y-2 text-xs text-white/80">
                  {isIOS ? (
                    <div className="flex items-start gap-2">
                      <span className="text-[#4db6ac] shrink-0">iOS:</span>
                      <span>Tap <i className="fa-solid fa-arrow-up-from-bracket mx-1" /> (Share button) → "Add to Home Screen"</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start gap-2">
                        <span className="text-[#4db6ac] shrink-0">Android:</span>
                        <span>Tap menu <i className="fa-solid fa-ellipsis-vertical mx-1" /> → "Install app" or "Add to Home screen"</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-[#4db6ac] shrink-0">Desktop:</span>
                        <span>Click install icon <i className="fa-solid fa-download mx-1" /> in address bar</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Benefits */}
              <div className="bg-[#4db6ac]/5 border border-[#4db6ac]/20 rounded-lg p-3 mb-4">
                <div className="text-xs font-semibold text-[#4db6ac] mb-2">Why install?</div>
                <ul className="space-y-1 text-xs text-white/70">
                  <li>• Receive push notifications</li>
                  <li>• Faster performance</li>
                  <li>• Quick access from home screen</li>
                </ul>
              </div>

              {/* Buttons */}
              <div className="flex flex-col gap-2">
                <button 
                  className="w-full px-4 py-3 rounded-lg bg-[#4db6ac] text-black font-medium hover:bg-[#45a99c] transition-colors"
                  onClick={() => {
                    setShowInstallPrompt(false)
                    // Optionally, show instructions again or a reminder after they close
                  }}
                >
                  Install now
                </button>
                <button 
                  className="w-full px-4 py-3 rounded-lg border border-white/20 text-white/80 text-sm hover:bg-white/5 transition-colors"
                  onClick={() => {
                    setShowInstallPrompt(false)
                  }}
                >
                  Skip for now (not recommended)
                </button>
              </div>

              {/* Warning */}
              <div className="mt-3 text-center">
                <p className="text-xs text-white/50">
                  ⚠️ Browser users won't receive push notifications
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Verify Email Modal */}
        {showVerify && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" aria-modal="true" role="dialog">
            <div className="w-[90%] max-w-md rounded-xl border border-white/10 bg-[#0b0b0b] p-4">
              <div className="text-lg font-semibold mb-1">Verify your email</div>
              <div className="text-sm text-white/80">
                We sent a verification link to <span className="text-white font-medium">{pendingEmail || formData.email || 'your email'}</span>.
                Please click the link to verify your account.
              </div>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <button className="px-3 py-2 rounded-md border border-white/10" onClick={async ()=>{
                  try{
                    const r = await fetch('/resend_verification_pending', { method:'POST', credentials:'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: pendingEmail || formData.email }) })
                    const j = await r.json().catch(()=>null)
                    if (!j?.success) alert(j?.error || 'Failed to resend')
                    else alert('Verification email sent')
                  }catch{ alert('Network error') }
                }}>Resend verification</button>
                <button className="px-3 py-2 rounded-md border border-white/10" onClick={()=> {
                  setShowVerify(false)
                }}>Edit email</button>
                <button className="px-3 py-2 rounded-md border border-white/10" onClick={()=> {
                  setShowVerify(false); navigate('/')
                }}>Go to start</button>
                <button className="ml-auto px-3 py-2 rounded-md bg-[#4db6ac] text-black" onClick={async ()=>{
                  try{
                    alert('Once verified, please sign in. Returning to login…')
                    navigate('/login', { replace: true })
                  }catch{ alert('Network error, please try again.') }
                }}>I've verified</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
