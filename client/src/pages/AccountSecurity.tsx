import { useEffect, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate } from 'react-router-dom'

export default function AccountSecurity() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'security' | 'encryption' | 'privacy'>('security')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    setTitle('Privacy & Security')
  }, [setTitle])

  const handlePasswordUpdate = async () => {
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
      const resp = await fetch('/update_password', { method: 'POST', credentials: 'include', body: fd })
      const json = await resp.json().catch(() => null)
      if (json?.success) {
        setPasswordMessage({ type: 'success', text: 'Password updated successfully!' })
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        setPasswordMessage({ type: 'error', text: json?.error || 'Failed to update password' })
      }
    } catch (err) {
      setPasswordMessage({ type: 'error', text: 'Network error. Please try again.' })
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-2xl mx-auto px-4 pb-6 space-y-4">
        <button
          type="button"
          className="inline-flex items-center gap-2 text-sm text-[#9fb0b5] hover:text-white"
          onClick={() => navigate('/account_settings')}
        >
          <i className="fa-solid fa-arrow-left" />
          Back to Account Settings
        </button>

        <div className="rounded-xl border border-white/10 bg-black p-6 space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8ca0a8]">Privacy &amp; Security</p>
            <h1 className="text-xl font-semibold text-white">Keep your data protected</h1>
            <p className="text-sm text-white/60">
              Update your password, manage encryption keys, and review privacy controls.
            </p>
          </div>

          <div className="flex gap-1 rounded-full border border-white/10 bg-white/5 p-1 overflow-hidden">
            {[
              { key: 'security', label: 'Security' },
              { key: 'encryption', label: 'Encryption' },
              { key: 'privacy', label: 'Privacy' },
            ].map(tab => {
              const isActive = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`flex-1 min-w-0 rounded-full px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition truncate ${
                    isActive ? 'bg-white text-black' : 'text-white/70 hover:text-white'
                  }`}
                  onClick={() => setActiveTab(tab.key as typeof activeTab)}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          <div className="space-y-4">
            {activeTab === 'security' ? (
              <>
                {passwordMessage && (
                  <div
                    className={`rounded-lg border p-4 ${
                      passwordMessage.type === 'success'
                        ? 'bg-green-500/10 border-green-500/30 text-green-400'
                        : 'bg-red-500/10 border-red-500/30 text-red-400'
                    }`}
                  >
                    {passwordMessage.text}
                  </div>
                )}
                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium">Current Password</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      placeholder="Enter current password"
                      className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-white focus:border-[#4db6ac] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium">New Password</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="Enter new password"
                      className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-white focus:border-[#4db6ac] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium">Confirm New Password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-white focus:border-[#4db6ac] focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handlePasswordUpdate}
                    className="rounded-lg bg-[#4db6ac] px-6 py-3 font-medium text-black transition-colors hover:bg-[#45a99c]"
                  >
                    Update Password
                  </button>
                </div>
              </>
            ) : activeTab === 'encryption' ? (
              <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                <p className="text-sm text-white/70">
                  Manage end-to-end encryption keys for your conversations. Export backups, regenerate secrets, or review
                  linked devices.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/encryption_settings')}
                  className="mt-4 flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/5 p-4 transition-colors hover:bg-white/10"
                >
                  <div>
                    <div className="font-semibold text-white">Encryption Settings</div>
                    <div className="text-sm text-white/60">Open the encryption control center.</div>
                  </div>
                  <i className="fa-solid fa-chevron-right text-white/40" />
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-black/40 p-4 text-sm text-white/70">
                <p>
                  Control how your profile and activity appear to other community members. Additional privacy controls
                  are coming soon.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
