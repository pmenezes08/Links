import { useEffect, useState, useCallback } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate } from 'react-router-dom'

type BlockedUser = {
  username: string
  reason: string | null
  blocked_at: string
  profile_picture: string | null
}

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
  
  // Blocked users state
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([])
  const [blockedUsersLoading, setBlockedUsersLoading] = useState(false)
  const [unblocking, setUnblocking] = useState<string | null>(null)

  useEffect(() => { setTitle('Account Settings') }, [setTitle])

  const loadBlockedUsers = useCallback(async () => {
    setBlockedUsersLoading(true)
    try {
      const res = await fetch('/api/blocked_users', { credentials: 'include' })
      const j = await res.json()
      if (j?.success) {
        setBlockedUsers(j.blocked_users || [])
      }
    } catch (e) {
      console.error('Failed to load blocked users:', e)
    } finally {
      setBlockedUsersLoading(false)
    }
  }, [])

  async function handleUnblock(username: string) {
    setUnblocking(username)
    try {
      const res = await fetch('/api/unblock_user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ blocked_username: username })
      })
      const j = await res.json()
      if (j?.success) {
        setBlockedUsers(prev => prev.filter(u => u.username !== username))
        setMessage({ type: 'success', text: `@${username} has been unblocked` })
      } else {
        setMessage({ type: 'error', text: j?.error || 'Failed to unblock user' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' })
    } finally {
      setUnblocking(null)
    }
  }

  useEffect(() => {
    loadProfile()
    loadBlockedUsers()
  }, [loadBlockedUsers])

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
    <div className="glass-page min-h-screen text-white pb-safe">
      <div className="glass-card glass-card--plain max-w-2xl mx-auto px-4 pb-8 space-y-8">
        {message && (
          <div
            className={`mb-6 rounded-lg border p-4 ${
              message.type === 'success'
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
          >
            {message.text}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-6">
          {/* Account Information */}
        <div className="glass-section space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Account Information</h2>
              <p className="text-sm text-white/60">Update the email tied to your account.</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium">Username</label>
                <input
                  type="text"
                  value={profile.username}
                  disabled
                  className="w-full cursor-not-allowed rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-white/60"
                />
                <div className="mt-1 text-xs text-white/50">Username cannot be changed</div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Email</label>
                <input
                  type="email"
                  value={profile.email || ''}
                  onChange={e => handleInputChange('email', e.target.value)}
                  placeholder="your@email.com"
                  className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-white focus:border-[#4db6ac] focus:outline-none"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#4db6ac] px-4 py-2 font-semibold text-black hover:bg-[#3da398]"
                >
                  <i className="fa-solid fa-floppy-disk" />
                  Save Changes
                </button>
              </div>
            </div>
          </div>

          {/* Privacy & Security summary */}
        <div className="glass-section">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Privacy &amp; Security</h2>
              <p className="text-sm text-white/60">
                Update your password, manage encryption keys, and adjust privacy controls from a dedicated workspace.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/account_settings/security')}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:border-white/40"
            >
              <i className="fa-solid fa-shield"></i>
              Open Privacy &amp; Security
            </button>
          </div>

          {/* Subscription Management */}
        <div className="glass-section">
            <h2 className="text-lg font-semibold mb-4">Subscription Management</h2>
            <p className="text-sm text-white/60 mb-4">
              View your current status and manage upgrades or downgrades.
            </p>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium">Subscription</label>
                <div
                  className={`rounded-lg border px-4 py-3 ${
                    profile.subscription === 'premium'
                      ? 'bg-[#4db6ac]/10 border-[#4db6ac]/30 text-[#4db6ac]'
                      : 'bg-white/5 border-white/20 text-white/60'
                  }`}
                >
                  {profile.subscription === 'premium' ? '⭐ Premium' : '🆓 Free'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate('/subscription_plans')}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:border-white/40"
              >
                <i className="fa-regular fa-credit-card" />
                Manage your subscription
              </button>
            </div>
          </div>

          {/* Blocked Users */}
          <div className="glass-section space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Blocked Users</h2>
              <p className="text-sm text-white/60">
                Users you've blocked won't appear in your feed. You can unblock them here.
              </p>
            </div>
            
            {blockedUsersLoading ? (
              <div className="text-center py-4">
                <i className="fa-solid fa-spinner fa-spin text-white/60" />
              </div>
            ) : blockedUsers.length === 0 ? (
              <div className="text-center py-4 text-white/60 text-sm">
                <i className="fa-solid fa-check-circle mr-2 text-green-400" />
                You haven't blocked anyone
              </div>
            ) : (
              <div className="space-y-2">
                {blockedUsers.map(user => (
                  <div 
                    key={user.username}
                    className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-white/10 overflow-hidden">
                        {user.profile_picture ? (
                          <img 
                            src={user.profile_picture} 
                            alt={user.username}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-white/60">
                            <i className="fa-solid fa-user" />
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="font-medium">@{user.username}</div>
                        {user.reason && (
                          <div className="text-xs text-white/50">Reason: {user.reason}</div>
                        )}
                        <div className="text-xs text-white/40">
                          Blocked {new Date(user.blocked_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleUnblock(user.username)}
                      disabled={unblocking === user.username}
                      className="px-3 py-1.5 text-sm rounded-lg border border-white/20 text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {unblocking === user.username ? (
                        <i className="fa-solid fa-spinner fa-spin" />
                      ) : (
                        'Unblock'
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Danger Zone */}
          <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-6">
            <h2 className="text-lg font-semibold text-red-300">Danger Zone</h2>
            <p className="text-sm text-red-200/80 mt-2">
              Permanently delete your account and all associated data. You’ll be asked to confirm this action on a
              dedicated page.
            </p>
            <button
              type="button"
              onClick={() => navigate('/account_settings/danger')}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-red-300/40 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/10"
            >
              <i className="fa-solid fa-skull"></i>
              Go to Danger Zone
            </button>
          </div>
        </form>

        {showVerifyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
            <div className="w-[90%] max-w-md rounded-xl border border-white/10 bg-[#0b0b0b] p-4">
              <div className="text-lg font-semibold mb-1">Verify your new email</div>
              <div className="text-sm text-white/80">
                We sent a verification link to your new email. Please verify to complete the change.
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button className="rounded-md bg-[#4db6ac] px-3 py-2 text-black" onClick={() => setShowVerifyModal(false)}>
                  OK
                </button>
                <button
                  className="rounded-md border border-white/10 px-3 py-2"
                  onClick={async () => {
                    try {
                      const r = await fetch('/resend_verification', { method: 'POST', credentials: 'include' })
                      const j = await r.json().catch(() => null)
                      if (!j?.success) alert(j?.error || 'Failed to resend')
                      else alert('Verification email sent')
                    } catch {
                      alert('Network error')
                    }
                  }}
                >
                  Resend email
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}