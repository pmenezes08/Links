import { useEffect, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate } from 'react-router-dom'

type ProfileData = {
  username: string
  email: string
  subscription: string
  display_name: string
  bio: string
  location: string
  website: string
  instagram: string
  twitter: string
  profile_picture: string
  cover_photo: string
}

export default function AccountSettings(){
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<ProfileData|null>(null)
  const [loading, setLoading] = useState(true)
  // Removed saving state since only email updates are handled here now
  const [message, setMessage] = useState<{type: 'success'|'error', text: string}|null>(null)
  const [showVerifyModal, setShowVerifyModal] = useState(false)

  useEffect(() => { setTitle('Account Settings') }, [setTitle])

  useEffect(() => {
    loadProfile()
  }, [])

  function loadProfile() {
    setLoading(true)
    fetch('/api/profile_me', { credentials: 'include' })
      .then(r => r.json())
      .then(j => {
        if (j?.success && j.profile) {
          setProfile(j.profile)
        } else {
          setMessage({ type: 'error', text: 'Failed to load profile' })
        }
      })
      .catch(() => {
        setMessage({ type: 'error', text: 'Error loading profile' })
      })
      .finally(() => setLoading(false))
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    setMessage(null)

    // Save public fields
    const pf = new FormData()
    ;(['display_name','bio','location','website','instagram','twitter'] as const).forEach((k)=>{
      const v = (profile as any)[k]
      if (v !== undefined) pf.append(k, v as string)
    })
    fetch('/update_public_profile', { method:'POST', credentials:'include', body: pf })
      .then(()=>{})
      .catch(()=>{})
      .finally(()=>{})

    // If email changed, call update_email
    const newEmail = profile.email
    if (newEmail) {
      const ef = new FormData()
      ef.append('new_email', newEmail)
      fetch('/update_email', { method:'POST', credentials:'include', body: ef })
        .then(r=>r.json())
        .then(j=>{
          if (j?.success) {
            setShowVerifyModal(true)
            setMessage({ type: 'success', text: 'Email updated. Please verify your new email.' })
          } else if (j?.error) {
            setMessage({ type: 'error', text: j.error })
          }
        })
        .catch(()=> setMessage({ type:'error', text:'Error updating email' }))
        .finally(()=> {})
    } else {
      // no-op
    }
  }

  function handleInputChange(field: keyof ProfileData, value: string) {
    if (!profile) return
    setProfile(prev => prev ? { ...prev, [field]: value } : null)
  }

  if (loading) {
    return (
      <div className="h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <i className="fa-solid fa-spinner fa-spin text-2xl mb-4" />
          <div>Loading profile...</div>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <i className="fa-solid fa-exclamation-triangle text-2xl mb-4 text-red-400" />
          <div>Failed to load profile</div>
          <button 
            className="mt-4 px-4 py-2 bg-[#4db6ac] text-black rounded-lg hover:bg-[#45a99c]"
            onClick={loadProfile}
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="sticky top-14 bg-black/90 backdrop-blur border-b border-white/10 px-4 py-3 flex items-center gap-3">
        <button 
          className="p-2 rounded-full hover:bg-white/10 transition-colors"
          onClick={() => navigate(-1)}
          aria-label="Back"
        >
          <i className="fa-solid fa-arrow-left text-white" />
        </button>
        <h1 className="text-lg font-semibold">Account Settings</h1>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Message */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg border ${
            message.type === 'success' 
              ? 'bg-green-500/10 border-green-500/30 text-green-400' 
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            {message.text}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-6">
          {/* Basic Information */}
          <div className="bg-white/5 rounded-xl p-6 border border-white/10">
            <h2 className="text-lg font-semibold mb-4">Basic Information</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Username</label>
                <input
                  type="text"
                  value={profile.username}
                  disabled
                  className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white/60 cursor-not-allowed"
                />
                <div className="text-xs text-white/50 mt-1">Username cannot be changed</div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Email</label>
                <input
                  type="email"
                  value={profile.email || ''}
                  onChange={e => handleInputChange('email', e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white focus:border-[#4db6ac] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Account Information */}
          <div className="bg-white/5 rounded-xl p-6 border border-white/10">
            <h2 className="text-lg font-semibold mb-4">Account Information</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Subscription</label>
                <div className={`px-4 py-3 rounded-lg border ${
                  profile.subscription === 'premium' 
                    ? 'bg-[#4db6ac]/10 border-[#4db6ac]/30 text-[#4db6ac]' 
                    : 'bg-white/5 border-white/20 text-white/60'
                }`}>
                  {profile.subscription === 'premium' ? '⭐ Premium' : '🆓 Free'}
                </div>
              </div>
              <div className="pt-3 border-t border-white/10">
                <h3 className="text-sm font-semibold mb-2 text-red-400">Danger zone</h3>
                <button type="button" className="px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-500" onClick={async()=>{
                  if (!confirm('Permanently delete your account? This cannot be undone.')) return
                  
                  // Show loading state
                  const btn = event?.currentTarget as HTMLButtonElement
                  const originalText = btn?.textContent || ''
                  if (btn) btn.textContent = 'Deleting...'
                  
                  try{
                    const r = await fetch('/delete_account', { method:'POST', credentials:'include' })
                    
                    if (!r.ok) {
                      alert('Server error: ' + r.status)
                      if (btn) btn.textContent = originalText
                      return
                    }
                    
                    const j = await r.json().catch(()=>null)
                    
                    if (j?.success){ 
                      alert('✅ Account deleted successfully! Clearing data...')
                      
                      // Clear all onboarding-related localStorage flags more aggressively
                      try {
                        const keys = Object.keys(localStorage)
                        keys.forEach(key => {
                          if (key.includes('onboarding') || key.includes('first_login')) {
                            localStorage.removeItem(key)
                            console.log('Cleared:', key)
                          }
                        })
                        console.log('All onboarding flags cleared')
                      } catch(e) { 
                        console.error('Failed to clear localStorage:', e) 
                      }
                      
                      // Force redirect using replace to prevent back button
                      console.log('Redirecting to clear_onboarding_storage...')
                      setTimeout(() => {
                        window.location.replace('/clear_onboarding_storage')
                      }, 500)
                      return
                    }
                    
                    if (j?.error) {
                      alert('Error: ' + j.error)
                      if (btn) btn.textContent = originalText
                    } else {
                      alert('Failed to delete account. Please try again.')
                      if (btn) btn.textContent = originalText
                    }
                  }catch(e){ 
                    console.error('Delete account error:', e)
                    alert('Network error: ' + (e instanceof Error ? e.message : 'Please try again.'))
                    if (btn) btn.textContent = originalText
                  }
                }}>Delete Account</button>
              </div>
            </div>
          </div>
          {/* Save Button removed (email saves immediately) */}
        </form>
        {showVerifyModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <div className="w-[90%] max-w-md rounded-xl border border-white/10 bg-[#0b0b0b] p-4">
              <div className="text-lg font-semibold mb-1">Verify your new email</div>
              <div className="text-sm text-white/80">We sent a verification link to your new email. Please verify to complete the change.</div>
              <div className="mt-3 flex items-center gap-2">
                <button className="px-3 py-2 rounded-md bg-[#4db6ac] text-black" onClick={()=> setShowVerifyModal(false)}>OK</button>
                <button className="px-3 py-2 rounded-md border border-white/10" onClick={async ()=>{
                  try{
                    const r = await fetch('/resend_verification', { method:'POST', credentials:'include' })
                    const j = await r.json().catch(()=>null)
                    if (!j?.success) alert(j?.error || 'Failed to resend')
                    else alert('Verification email sent')
                  }catch{ alert('Network error') }
                }}>Resend email</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}