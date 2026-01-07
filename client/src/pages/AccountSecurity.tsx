import { useEffect, useState, useCallback } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate } from 'react-router-dom'

type BlockedUser = {
  username: string
  reason: string | null
  blocked_at: string
  profile_picture: string | null
}

type HiddenPost = {
  post_id: number
  hidden_at: string
  preview: string
  author: string
  image_path: string | null
}

export default function AccountSecurity() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'security' | 'privacy'>('security')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  
  // Blocked users state
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([])
  const [blockedUsersLoading, setBlockedUsersLoading] = useState(false)
  const [unblocking, setUnblocking] = useState<string | null>(null)
  
  // Hidden posts state
  const [hiddenPosts, setHiddenPosts] = useState<HiddenPost[]>([])
  const [hiddenPostsLoading, setHiddenPostsLoading] = useState(false)
  const [unhiding, setUnhiding] = useState<number | null>(null)

  useEffect(() => {
    setTitle('Privacy & Security')
  }, [setTitle])

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

  const loadHiddenPosts = useCallback(async () => {
    setHiddenPostsLoading(true)
    try {
      const res = await fetch('/api/hidden_posts', { credentials: 'include' })
      const j = await res.json()
      if (j?.success) {
        setHiddenPosts(j.hidden_posts || [])
      }
    } catch (e) {
      console.error('Failed to load hidden posts:', e)
    } finally {
      setHiddenPostsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'privacy') {
      loadBlockedUsers()
      loadHiddenPosts()
    }
  }, [activeTab, loadBlockedUsers, loadHiddenPosts])

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
      } else {
        alert(j?.error || 'Failed to unblock user')
      }
    } catch {
      alert('Network error')
    } finally {
      setUnblocking(null)
    }
  }

  async function handleUnhide(postId: number) {
    setUnhiding(postId)
    try {
      const res = await fetch('/api/unhide_post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ post_id: postId })
      })
      const j = await res.json()
      if (j?.success) {
        setHiddenPosts(prev => prev.filter(p => p.post_id !== postId))
      } else {
        alert(j?.error || 'Failed to unhide post')
      }
    } catch {
      alert('Network error')
    } finally {
      setUnhiding(null)
    }
  }

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
    } catch {
      setPasswordMessage({ type: 'error', text: 'Network error. Please try again.' })
    }
  }

  return (
    <div className="glass-page min-h-screen text-white pb-20">
      <div className="glass-card max-w-2xl mx-auto px-4 pb-6 space-y-4">
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
              Update your password and manage your privacy settings.
            </p>
          </div>

          <div className="flex gap-1 rounded-full border border-white/10 bg-white/5 p-1 overflow-hidden">
            {[
              { key: 'security', label: 'Security' },
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
            ) : (
              <div className="space-y-6">
                {/* Blocked Users Section */}
                <div className="space-y-3">
                  <div>
                    <h3 className="text-base font-semibold flex items-center gap-2">
                      <i className="fa-solid fa-ban text-red-400" />
                      Blocked Users
                    </h3>
                    <p className="text-xs text-white/60 mt-1">
                      Blocked users can't see your posts or send you messages.
                    </p>
                  </div>
                  
                  {blockedUsersLoading ? (
                    <div className="text-center py-4">
                      <i className="fa-solid fa-spinner fa-spin text-white/60" />
                    </div>
                  ) : blockedUsers.length === 0 ? (
                    <div className="text-center py-4 text-white/50 text-sm rounded-lg bg-white/5 border border-white/10">
                      <i className="fa-solid fa-check-circle mr-2 text-green-400" />
                      You haven't blocked anyone
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {blockedUsers.map(user => (
                        <div 
                          key={user.username}
                          className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-full bg-white/10 overflow-hidden flex-shrink-0">
                              {user.profile_picture ? (
                                <img 
                                  src={user.profile_picture} 
                                  alt={user.username}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-white/60">
                                  <i className="fa-solid fa-user text-xs" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">@{user.username}</div>
                              <div className="text-xs text-white/40 truncate">
                                {user.reason && `${user.reason} • `}
                                {new Date(user.blocked_at).toLocaleDateString()}
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => handleUnblock(user.username)}
                            disabled={unblocking === user.username}
                            className="px-3 py-1.5 text-xs rounded-lg border border-white/20 text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
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

                {/* Hidden Posts Section */}
                <div className="space-y-3 pt-4 border-t border-white/10">
                  <div>
                    <h3 className="text-base font-semibold flex items-center gap-2">
                      <i className="fa-solid fa-eye-slash text-orange-400" />
                      Hidden Posts
                    </h3>
                    <p className="text-xs text-white/60 mt-1">
                      Posts you've hidden from your feed. Unhide them to see them again.
                    </p>
                  </div>
                  
                  {hiddenPostsLoading ? (
                    <div className="text-center py-4">
                      <i className="fa-solid fa-spinner fa-spin text-white/60" />
                    </div>
                  ) : hiddenPosts.length === 0 ? (
                    <div className="text-center py-4 text-white/50 text-sm rounded-lg bg-white/5 border border-white/10">
                      <i className="fa-solid fa-check-circle mr-2 text-green-400" />
                      You haven't hidden any posts
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {hiddenPosts.map(post => (
                        <div 
                          key={post.post_id}
                          className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium text-[#4db6ac]">@{post.author}</span>
                              <span className="text-xs text-white/40">
                                {new Date(post.hidden_at).toLocaleDateString()}
                              </span>
                            </div>
                            <div className="text-xs text-white/60 truncate">{post.preview}</div>
                          </div>
                          <button
                            onClick={() => handleUnhide(post.post_id)}
                            disabled={unhiding === post.post_id}
                            className="ml-3 px-3 py-1.5 text-xs rounded-lg border border-white/20 text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                          >
                            {unhiding === post.post_id ? (
                              <i className="fa-solid fa-spinner fa-spin" />
                            ) : (
                              'Unhide'
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
