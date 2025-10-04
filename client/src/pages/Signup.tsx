import { useState } from 'react'
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
  // Lock body scroll when verify modal is shown
  if (typeof document !== 'undefined'){
    try{
      document.body.style.overflow = showVerify ? 'hidden' : ''
    }catch{}
  }
  // kept for legacy flows (desktop), unused in mobile flag path
  // legacy var kept removed

  function handleInputChange(field: string, value: string) {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (error) setError('') // Clear error when user starts typing
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

    // Create form data for submission
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
        // Try to parse as JSON first
        try {
          const j = await r.json()
          console.log('Signup JSON response:', j)
          
          if (j?.success) {
            const dest = j.redirect || '/premium_dashboard'
            // Show verify modal for unverified flow (mobile JSON response)
            if (j.needs_email_verification) {
              setShowVerify(true)
            } else {
              // If no verification needed, proceed to destination
              navigate(dest)
            }
          } else {
            setError(j?.error || 'Registration failed')
          }
        } catch (jsonError) {
          // Not JSON response. Always require verification: gate user in modal.
          setShowVerify(true)
        }
      } else {
        // Error response
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

        {/* Verify Email Modal */}
        {showVerify && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" aria-modal="true" role="dialog">
            <div className="w-[90%] max-w-md rounded-xl border border-white/10 bg-[#0b0b0b] p-4">
              <div className="text-lg font-semibold mb-1">Verify your email</div>
              <div className="text-sm text-white/80">We sent a verification link to your email. Please click the link to verify your account.</div>
              <div className="mt-3 flex items-center gap-2">
                <button className="px-3 py-2 rounded-md border border-white/10" onClick={async ()=>{
                  try{
                    const r = await fetch('/resend_verification', { method:'POST', credentials:'include' })
                    const j = await r.json().catch(()=>null)
                    if (!j?.success) alert(j?.error || 'Failed to resend')
                    else alert('Verification email sent')
                  }catch{ alert('Network error') }
                }}>Resend verification</button>
                <button className="px-3 py-2 rounded-md bg-[#4db6ac] text-black" onClick={async ()=>{
                  try{
                    const r = await fetch('/api/profile_me', { credentials:'include' })
                    if (r.status === 403){ alert('Still unverified. Please click the link in your email.'); return }
                    const j = await r.json().catch(()=>null)
                    const verified = !!(j?.profile?.email_verified)
                    if (verified){ navigate('/premium_dashboard', { replace: true }) }
                    else { alert('Still unverified. Please check your email and try again.') }
                  }catch{ alert('Network error, please try again.') }
                }}>I’ve verified</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}