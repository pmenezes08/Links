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
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState<{type: 'success'|'error', text: string}|null>(null)

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
            {/* Account Information */}
            <div className="bg-black rounded-xl p-6 border border-white/10 space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Account Information</h2>
                <p className="text-sm text-white/60">Update the email tied to your account.</p>
              </div>
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
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#4db6ac] text-black font-semibold hover:bg-[#3da398]"
                    >
                      <i className="fa-solid fa-floppy-disk" />
                      Save Changes
                    </button>
                  </div>
            </div>
          </div>

          {/* Privacy & Security */}
            <div className="bg-black rounded-xl p-6 border border-white/10">
            <h2 className="text-lg font-semibold mb-4">Privacy & Security</h2>
            
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => navigate('/encryption_settings')}
                className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center">
                    <i className="fa-solid fa-lock text-[#4db6ac]" />
                  </div>
                  <div className="text-left">
                    <div className="font-medium">Encryption Settings</div>
                    <div className="text-sm text-white/60">Manage your end-to-end encryption keys</div>
                  </div>
                </div>
                <i className="fa-solid fa-chevron-right text-white/40 group-hover:text-white/60" />
              </button>
            </div>
          </div>

            {/* Password Update */}
            <div className="bg-black rounded-xl p-6 border border-white/10">
            <h2 className="text-lg font-semibold mb-4">Change Password</h2>
            {passwordMessage && (
              <div className={`mb-4 p-4 rounded-lg border ${
                passwordMessage.type === 'success' 
                  ? 'bg-green-500/10 border-green-500/30 text-green-400' 
                  : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}>
                {passwordMessage.text}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white focus:border-[#4db6ac] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white focus:border-[#4db6ac] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white focus:border-[#4db6ac] focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={async () => {
                  setPasswordMessage(null)
                  
                  if (!currentPassword || !newPassword || !confirmPassword) {
                    setPasswordMessage({ type: 'error', text: 'Please fill in all password fields' })
                    return
                  }
                  
                  if (newPassword !== confirmPassword) {
                    setPasswordMessage({ type: 'error', text: 'New passwords do not match' })
                    return
                  }
                  
                  if (newPassword.length < 6) {
                    setPasswordMessage({ type: 'error', text: 'New password must be at least 6 characters' })
                    return
                  }
                  
                  try {
                    const fd = new FormData()
                    fd.append('current_password', currentPassword)
                    fd.append('new_password', newPassword)
                    
                    const r = await fetch('/update_password', { method: 'POST', credentials: 'include', body: fd })
                    const j = await r.json()
                    
                    if (j?.success) {
                      setPasswordMessage({ type: 'success', text: 'Password updated successfully!' })
                      setCurrentPassword('')
                      setNewPassword('')
                      setConfirmPassword('')
                    } else {
                      setPasswordMessage({ type: 'error', text: j?.error || 'Failed to update password' })
                    }
                  } catch (err) {
                    setPasswordMessage({ type: 'error', text: 'Network error. Please try again.' })
                  }
                }}
                className="px-6 py-3 bg-[#4db6ac] text-black rounded-lg hover:bg-[#45a99c] font-medium transition-colors"
              >
                Update Password
              </button>
            </div>
          </div>

            {/* Subscription + Danger Zone */}
            <div className="bg-black rounded-xl p-6 border border-white/10">
              <h2 className="text-lg font-semibold mb-4">Subscription Area</h2>
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
                <button type="button" className="px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-500" onClick={async(event)=>{
                  if (!confirm('Permanently delete your account? This cannot be undone.')) return
                  
                  // Show loading state
                  const btn = event?.currentTarget as HTMLButtonElement
                  const originalText = btn?.textContent || ''
                  if (btn) btn.textContent = 'Deleting...'
                  
                  // FIRST: Clear ALL localStorage completely to ensure clean slate
                  try {
                    console.log('Clearing ALL localStorage before deletion...')
                    const allKeys = Object.keys(localStorage)
                    console.log('All localStorage keys before deletion:', allKeys)
                    
                    // Clear everything onboarding-related
                    allKeys.forEach(key => {
                      if (key.includes('onboarding') || key.includes('first_login')) {
                        localStorage.removeItem(key)
                        console.log('Pre-deletion cleared:', key)
                      }
                    })
                    
                    // Also clear any other app-specific data
                    localStorage.clear()
                    console.log('localStorage.clear() called - everything removed')
                  } catch(e) { 
                    console.error('Failed to clear localStorage:', e) 
                  }
                  
                  try{
                    const r = await fetch('/delete_account', { method:'POST', credentials:'include' })
                    
                    if (!r.ok) {
                      alert('Server error: ' + r.status)
                      if (btn) btn.textContent = originalText
                      return
                    }
                    
                    const j = await r.json().catch(()=>null)
                    
                    if (j?.success){ 
                      alert('✅ Account deleted! You can now create a new account.')
                      
                      // Double-check localStorage is cleared
                      try {
                        localStorage.clear()
                        console.log('localStorage cleared again after deletion success')
                      } catch(e) {}
                      
                      // Redirect to signup (not the clearing page, since we already cleared)
                      setTimeout(() => {
                        window.location.replace('/signup')
                      }, 1000)
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