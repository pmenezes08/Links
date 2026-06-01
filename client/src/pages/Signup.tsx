import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useUserProfile } from '../contexts/UserProfileContext'

export default function Signup(){
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { refresh } = useUserProfile()
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('invite')
  
  const PENDING_INVITE_KEY = 'cpoint_pending_invite'

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
  const [showVerify, setShowVerify] = useState(false)
  const [pendingEmail, setPendingEmail] = useState('')
  const [invitationInfo, setInvitationInfo] = useState<{email: string, community_name: string, invited_by: string} | null>(null)
  const [emailLocked, setEmailLocked] = useState(false)
  
  // Check invitation token on mount
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
          setInvitationInfo(j)
          const payload = {
            communityId: j.community_id ?? null,
            communityName: j.community_name,
            inviteToken,
          }
          try {
            if (typeof window !== 'undefined') sessionStorage.setItem(PENDING_INVITE_KEY, JSON.stringify(payload))
          } catch {}
          // Only pre-fill email if it's not a QR code placeholder
          const isQRInvite = j.email?.startsWith('qr-invite-') && j.email?.endsWith('@placeholder.local')
          if (!isQRInvite) {
            setFormData(prev => ({ ...prev, email: j.email }))
            setEmailLocked(true)
          }
        } else {
          setError(j?.error || t('auth.signup.invalid_invite'))
          try {
            if (typeof window !== 'undefined') sessionStorage.removeItem(PENDING_INVITE_KEY)
          } catch {}
        }
      })
      .catch(err => {
        console.error('Error verifying invitation:', err)
        setError(t('auth.signup.invite_verify_failed'))
      })
  }, [inviteToken])
  
  // Lock body scroll when modals are shown
  useEffect(() => {
    if (typeof document !== 'undefined') {
      try {
        document.body.style.overflow = showVerify ? 'hidden' : ''
      } catch {}
    }
  }, [showVerify])

  function handleInputChange(field: string, value: string) {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (error) setError('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    // Validation
    if (!formData.first_name.trim()) {
      setError(t('auth.signup.validation.first_name_required'))
      return
    }
    if (!formData.last_name.trim()) {
      setError(t('auth.signup.validation.last_name_required'))
      return
    }
    if (!formData.username.trim()) {
      setError(t('auth.signup.validation.username_required'))
      return
    }
    if (!formData.email.trim()) {
      setError(t('auth.signup.validation.email_required'))
      return
    }
    if (!formData.password) {
      setError(t('auth.signup.validation.password_required'))
      return
    }
    if (formData.password !== formData.confirm_password) {
      setError(t('auth.signup.validation.passwords_do_not_match'))
      return
    }
    if (formData.password.length < 6) {
      setError(t('auth.signup.validation.password_too_short'))
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
    if (inviteToken) submitData.append('invite_token', inviteToken)

    fetch('/signup', {
      method: 'POST',
      credentials: 'include',
      body: submitData
    })
    .then(async r => {
      if (r.ok) {
        try {
          const j = await r.json()

          if (j?.success) {
            const dest = j.redirect || '/premium_dashboard'
            if (j.needs_email_verification) {
              setPendingEmail(formData.email)
              setShowVerify(true)
            } else {
              void (async () => {
                try {
                  await refresh()
                } catch {
                  /* ignore */
                }
                navigate(dest)
              })()
            }
          } else {
            setError(j?.error || t('auth.signup.registration_failed'))
          }
        } catch {
          setShowVerify(true)
        }
      } else {
        try {
          const j = await r.json()
          setError(j?.error || t('auth.signup.server_error', { status: r.status }))
        } catch {
          setError(t('auth.signup.server_error', { status: r.status }))
        }
      }
    })
    .catch((error) => {
      console.error('Signup fetch error:', error)
      setError(t('auth.signup.network_error', { message: error.message }))
    })
    .finally(() => setLoading(false))
  }

  return (
    <div className="min-h-screen bg-c-bg-app text-c-text-primary flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold mb-2">{t('auth.signup.title')}</h1>
          {invitationInfo ? (
            <div className="bg-cpoint-turquoise/10 border border-cpoint-turquoise/30 rounded-lg p-3 mt-3">
              <p className="text-c-text-primary text-sm font-medium">
                {t('auth.signup.invited_to_join', { community: invitationInfo.community_name })}
              </p>
              <p className="text-c-text-tertiary text-xs mt-1">
                {t('auth.signup.invited_by', { username: invitationInfo.invited_by })}
              </p>
            </div>
          ) : (
            <p className="text-c-text-tertiary text-sm">{t('auth.signup.join_today')}</p>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div
            role="alert"
            className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm"
          >
            {error}
          </div>
        )}

        {/* Signup Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Name Fields */}
          <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1.5">{t('auth.signup.username')}</label>
            <input
              type="text"
              value={formData.username}
              onChange={e => handleInputChange('username', e.target.value)}
              placeholder={t('auth.signup.username_placeholder')}
              required
              className="w-full px-3 py-2.5 bg-c-hover-bg border border-white/20 rounded-lg text-sm text-c-text-primary placeholder-white/50 focus:border-cpoint-turquoise focus:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50 transition-colors"
            />
          </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">{t('auth.signup.first_name')}</label>
              <input
                type="text"
                value={formData.first_name}
                onChange={e => handleInputChange('first_name', e.target.value)}
                placeholder={t('auth.signup.first_name_placeholder')}
                required
                className="w-full px-3 py-2.5 bg-c-hover-bg border border-white/20 rounded-lg text-sm text-c-text-primary placeholder-white/50 focus:border-cpoint-turquoise focus:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">{t('auth.signup.last_name')}</label>
              <input
                type="text"
                value={formData.last_name}
                onChange={e => handleInputChange('last_name', e.target.value)}
                placeholder={t('auth.signup.last_name_placeholder')}
                required
                className="w-full px-3 py-2.5 bg-c-hover-bg border border-white/20 rounded-lg text-sm text-c-text-primary placeholder-white/50 focus:border-cpoint-turquoise focus:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50 transition-colors"
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-medium mb-1.5">{t('auth.signup.email')}</label>
            <input
              type="email"
              value={formData.email}
              onChange={e => handleInputChange('email', e.target.value)}
              placeholder={t('auth.signup.email_placeholder')}
              required
              disabled={emailLocked}
              className={`w-full px-3 py-2.5 bg-c-hover-bg border border-white/20 rounded-lg text-sm text-c-text-primary placeholder-white/50 focus:border-cpoint-turquoise focus:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50 transition-colors ${emailLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
            {emailLocked && (
              <p className="text-xs text-c-text-tertiary mt-1">{t('auth.signup.email_locked')}</p>
            )}
          </div>

          {/* Mobile (Optional) */}
          <div>
            <label className="block text-xs font-medium mb-1.5">{t('auth.signup.mobile')}</label>
            <input
              type="tel"
              value={formData.mobile}
              onChange={e => handleInputChange('mobile', e.target.value)}
              placeholder="+1 (555) 123-4567"
              className="w-full px-3 py-2.5 bg-c-hover-bg border border-white/20 rounded-lg text-sm text-c-text-primary placeholder-white/50 focus:border-cpoint-turquoise focus:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50 transition-colors"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-medium mb-1.5">{t('auth.signup.password')}</label>
            <input
              type="password"
              value={formData.password}
              onChange={e => handleInputChange('password', e.target.value)}
              placeholder="********"
              required
              className="w-full px-3 py-2.5 bg-c-hover-bg border border-white/20 rounded-lg text-sm text-c-text-primary placeholder-white/50 focus:border-cpoint-turquoise focus:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50 transition-colors"
            />
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-xs font-medium mb-1.5">{t('auth.signup.confirm_password')}</label>
            <input
              type="password"
              value={formData.confirm_password}
              onChange={e => handleInputChange('confirm_password', e.target.value)}
              placeholder="********"
              required
              className="w-full px-3 py-2.5 bg-c-hover-bg border border-white/20 rounded-lg text-sm text-c-text-primary placeholder-white/50 focus:border-cpoint-turquoise focus:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50 transition-colors"
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50 ${
              loading
                ? 'bg-gray-600 text-gray-300 cursor-not-allowed'
                : 'bg-cpoint-turquoise text-black hover:brightness-110'
            }`}
          >
            {loading ? (
              <>
                <i className="fa-solid fa-spinner fa-spin mr-2" />
                {t('auth.signup.submitting')}
              </>
            ) : (
              t('auth.signup.submit')
            )}
          </button>
        </form>

        {/* Login Link */}
        <div className="mt-4 text-center">
          <p className="text-c-text-tertiary text-xs">
            {t('auth.signup.have_account')}{' '}
            <button
              className="text-cpoint-turquoise hover:brightness-110 transition-colors text-xs rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
              onClick={async () => {
                // Clear any stale session before navigating to login
                try {
                  await fetch('/api/clear_stale_session', { method: 'POST', credentials: 'include' })
                } catch {}
                navigate('/login')
              }}
            >
              {t('auth.signup.sign_in')}
            </button>
          </p>
        </div>

        {/* Terms */}
        <div className="mt-4 text-center">
          <p className="text-c-text-tertiary text-xs">
            {t('auth.signup.terms_prefix')}{' '}
            <a
              href="https://www.c-point.co/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cpoint-turquoise hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
            >
              {t('auth.signup.terms')}
            </a>{' '}
            {t('auth.signup.and')}{' '}
            <a
              href="https://www.c-point.co/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cpoint-turquoise hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
            >
              {t('auth.signup.privacy')}
            </a>
          </p>
        </div>

        {/* Verify Email Modal */}
        {showVerify && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-c-bg-app/70" aria-modal="true" role="dialog" aria-labelledby="signup-verify-title">
            <div className="w-[90%] max-w-md rounded-xl border border-c-border bg-c-bg-app p-4">
              <div id="signup-verify-title" className="text-lg font-semibold mb-1">{t('auth.signup.verify.title')}</div>
              <div className="text-sm text-c-text-secondary">
                {t('auth.signup.verify.body', { email: pendingEmail || formData.email || t('auth.signup.verify.fallback_email') })}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  className="px-3 py-2 rounded-md border border-c-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                  onClick={async ()=>{
                    try{
                      const r = await fetch('/resend_verification_pending', { method:'POST', credentials:'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: pendingEmail || formData.email }) })
                      const j = await r.json().catch(()=>null)
                      if (!j?.success) alert(j?.error || t('auth.signup.verify.resend_failed'))
                      else alert(t('auth.signup.verify.resent'))
                    }catch{ alert(t('account.messages.network_error')) }
                  }}
                >
                  {t('auth.signup.verify.resend')}
                </button>
                <button
                  className="px-3 py-2 rounded-md border border-c-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                  onClick={()=> { setShowVerify(false) }}
                >
                  {t('auth.signup.verify.edit_email')}
                </button>
                <button
                  className="px-3 py-2 rounded-md border border-c-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                  onClick={()=> { setShowVerify(false); navigate('/') }}
                >
                  {t('auth.signup.verify.go_start')}
                </button>
                <button
                  className="col-span-2 px-3 py-3 rounded-xl bg-cpoint-turquoise text-black font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                  onClick={async ()=>{
                    try{
                      const r = await fetch('/api/email_verified_status', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email: pendingEmail || formData.email }) })
                      const j = await r.json().catch(()=>null)
                      if (j?.success && j?.verified){
                        alert(t('auth.signup.verify.verified_alert'))
                        navigate('/login', { replace: true })
                      } else {
                        alert(t('auth.signup.verify.not_verified'))
                      }
                    }catch{ alert(t('auth.signup.verify.network_try_again')) }
                  }}
                >
                  {t('auth.signup.verify.verified')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
