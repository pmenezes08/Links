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
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{type: 'success'|'error', text: string}|null>(null)

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

    setSaving(true)
    setMessage(null)

    const formData = new FormData()
    Object.entries(profile).forEach(([key, value]) => {
      if (value) formData.append(key, value)
    })

    fetch('/update_public_profile', {
      method: 'POST',
      credentials: 'include',
      body: formData
    })
    .then(r => r.json())
    .then(j => {
      if (j?.success) {
        setMessage({ type: 'success', text: 'Profile updated successfully!' })
      } else {
        setMessage({ type: 'error', text: j?.error || 'Failed to update profile' })
      }
    })
    .catch(() => {
      setMessage({ type: 'error', text: 'Error updating profile' })
    })
    .finally(() => setSaving(false))
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
          {/* Profile Picture Section */}
          <div className="bg-white/5 rounded-xl p-6 border border-white/10">
            <h2 className="text-lg font-semibold mb-4">Profile Picture</h2>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center overflow-hidden">
                {profile.profile_picture ? (
                  <img 
                    src={`/static/${profile.profile_picture}`}
                    alt="Profile"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <i className="fa-solid fa-user text-2xl text-white/50" />
                )}
              </div>
              <div>
                <button 
                  type="button"
                  className="px-4 py-2 bg-[#4db6ac] text-black rounded-lg hover:bg-[#45a99c] transition-colors"
                >
                  Change Photo
                </button>
                <div className="text-xs text-white/60 mt-1">JPG, PNG up to 5MB</div>
              </div>
            </div>
          </div>

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
                <label className="block text-sm font-medium mb-2">Display Name</label>
                <input
                  type="text"
                  value={profile.display_name || ''}
                  onChange={e => handleInputChange('display_name', e.target.value)}
                  placeholder="Your display name"
                  className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white focus:border-[#4db6ac] focus:outline-none"
                />
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

              <div>
                <label className="block text-sm font-medium mb-2">Bio</label>
                <textarea
                  value={profile.bio || ''}
                  onChange={e => handleInputChange('bio', e.target.value)}
                  placeholder="Tell us about yourself..."
                  rows={3}
                  className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white focus:border-[#4db6ac] focus:outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Location</label>
                <input
                  type="text"
                  value={profile.location || ''}
                  onChange={e => handleInputChange('location', e.target.value)}
                  placeholder="City, Country"
                  className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white focus:border-[#4db6ac] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Social Links */}
          <div className="bg-white/5 rounded-xl p-6 border border-white/10">
            <h2 className="text-lg font-semibold mb-4">Social Links</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Website</label>
                <input
                  type="url"
                  value={profile.website || ''}
                  onChange={e => handleInputChange('website', e.target.value)}
                  placeholder="https://yourwebsite.com"
                  className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white focus:border-[#4db6ac] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Instagram</label>
                <input
                  type="text"
                  value={profile.instagram || ''}
                  onChange={e => handleInputChange('instagram', e.target.value)}
                  placeholder="@username"
                  className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white focus:border-[#4db6ac] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Twitter</label>
                <input
                  type="text"
                  value={profile.twitter || ''}
                  onChange={e => handleInputChange('twitter', e.target.value)}
                  placeholder="@username"
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
            </div>
          </div>

          {/* Save Button */}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className={`flex-1 py-3 rounded-lg font-medium transition-colors ${
                saving
                  ? 'bg-gray-600 text-gray-300 cursor-not-allowed'
                  : 'bg-[#4db6ac] text-black hover:bg-[#45a99c]'
              }`}
            >
              {saving ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <i className="fa-solid fa-save mr-2" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}