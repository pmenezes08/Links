import { useCallback, useEffect, useState } from 'react'

import { triggerHaptic } from '../../utils/haptics'

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

export default function PrivacySecurityPanel() {
  const [activeTab, setActiveTab] = useState<'security' | 'privacy'>('security')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([])
  const [blockedUsersLoading, setBlockedUsersLoading] = useState(false)
  const [unblocking, setUnblocking] = useState<string | null>(null)
  const [hiddenPosts, setHiddenPosts] = useState<HiddenPost[]>([])
  const [hiddenPostsLoading, setHiddenPostsLoading] = useState(false)
  const [unhiding, setUnhiding] = useState<number | null>(null)

  const loadBlockedUsers = useCallback(async () => {
    setBlockedUsersLoading(true)
    try {
      const res = await fetch('/api/blocked_users', { credentials: 'include', headers: { Accept: 'application/json' } })
      const j = await res.json()
      if (j?.success) setBlockedUsers(j.blocked_users || [])
    } catch (e) {
      console.error('Failed to load blocked users:', e)
    } finally {
      setBlockedUsersLoading(false)
    }
  }, [])

  const loadHiddenPosts = useCallback(async () => {
    setHiddenPostsLoading(true)
    try {
      const res = await fetch('/api/hidden_posts', { credentials: 'include', headers: { Accept: 'application/json' } })
      const j = await res.json()
      if (j?.success) setHiddenPosts(j.hidden_posts || [])
    } catch (e) {
      console.error('Failed to load hidden posts:', e)
    } finally {
      setHiddenPostsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'privacy') {
      void loadBlockedUsers()
      void loadHiddenPosts()
    }
  }, [activeTab, loadBlockedUsers, loadHiddenPosts])

  async function handleUnblock(username: string) {
    void triggerHaptic('selection')
    setUnblocking(username)
    try {
      const res = await fetch('/api/unblock_user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ blocked_username: username }),
      })
      const j = await res.json()
      if (j?.success) {
        setBlockedUsers(prev => prev.filter(u => u.username !== username))
        void triggerHaptic('success')
      } else {
        void triggerHaptic('error')
        alert(j?.error || 'Failed to unblock user')
      }
    } catch {
      void triggerHaptic('error')
      alert('Network error')
    } finally {
      setUnblocking(null)
    }
  }

  async function handleUnhide(postId: number) {
    void triggerHaptic('selection')
    setUnhiding(postId)
    try {
      const res = await fetch('/api/unhide_post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ post_id: postId }),
      })
      const j = await res.json()
      if (j?.success) {
        setHiddenPosts(prev => prev.filter(p => p.post_id !== postId))
        void triggerHaptic('success')
      } else {
        void triggerHaptic('error')
        alert(j?.error || 'Failed to unhide post')
      }
    } catch {
      void triggerHaptic('error')
      alert('Network error')
    } finally {
      setUnhiding(null)
    }
  }

  const handlePasswordUpdate = async () => {
    setPasswordMessage(null)
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Please fill in all password fields' })
      void triggerHaptic('error')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'New passwords do not match' })
      void triggerHaptic('error')
      return
    }
    if (newPassword.length < 6) {
      setPasswordMessage({ type: 'error', text: 'New password must be at least 6 characters' })
      void triggerHaptic('error')
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
        void triggerHaptic('success')
      } else {
        setPasswordMessage({ type: 'error', text: json?.error || 'Failed to update password' })
        void triggerHaptic('error')
      }
    } catch {
      setPasswordMessage({ type: 'error', text: 'Network error. Please try again.' })
      void triggerHaptic('error')
    }
  }

  const tabClass = (tab: 'security' | 'privacy') =>
    `flex-1 rounded-full px-3 py-2 text-sm font-semibold transition-colors ${
      activeTab === tab ? 'bg-c-bg-surface text-c-text-primary' : 'text-c-text-secondary active:bg-c-active-bg'
    }`

  return (
    <div className="space-y-5">
      <div className="rounded-full border border-c-border bg-c-bg-surface p-1">
        <button type="button" className={tabClass('security')} onClick={() => { setActiveTab('security'); void triggerHaptic('selection') }}>
          Security
        </button>
        <button type="button" className={tabClass('privacy')} onClick={() => { setActiveTab('privacy'); void triggerHaptic('selection') }}>
          Privacy
        </button>
      </div>

      {activeTab === 'security' ? (
        <div className="space-y-4">
          {passwordMessage ? (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${
                passwordMessage.type === 'success'
                  ? 'border-c-border bg-c-bg-surface text-c-text-secondary'
                  : 'border-red-400/25 bg-red-500/10 text-red-200'
              }`}
            >
              {passwordMessage.text}
            </div>
          ) : null}
          {[
            ['Current Password', currentPassword, setCurrentPassword, 'Enter current password'],
            ['New Password', newPassword, setNewPassword, 'Enter new password'],
            ['Confirm New Password', confirmPassword, setConfirmPassword, 'Confirm new password'],
          ].map(([label, value, setter, placeholder]) => (
            <label key={label as string} className="block rounded-3xl border border-c-border bg-c-bg-surface p-4">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-c-text-tertiary">{label as string}</span>
              <input
                type="password"
                value={value as string}
                onChange={e => (setter as (v: string) => void)(e.target.value)}
                placeholder={placeholder as string}
                className="mt-2 w-full rounded-2xl border border-c-border bg-c-hover-bg px-4 py-3 text-c-text-primary placeholder:text-c-text-tertiary focus:border-cpoint-turquoise focus:outline-none"
              />
            </label>
          ))}
          <button
            type="button"
            onClick={handlePasswordUpdate}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-cpoint-turquoise px-4 py-3 font-bold text-black active:opacity-80"
          >
            <i className="fa-solid fa-lock" />
            Update password
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <section className="rounded-3xl border border-c-border bg-c-bg-surface p-4">
            <h3 className="text-base font-bold text-c-text-primary">Blocked Users</h3>
            <p className="mt-1 text-sm text-c-text-tertiary">Blocked users can't see your posts or send you messages.</p>
            <div className="mt-4 space-y-2">
              {blockedUsersLoading ? (
                <div className="py-6 text-center text-c-text-tertiary"><i className="fa-solid fa-spinner fa-spin" /></div>
              ) : blockedUsers.length === 0 ? (
                <div className="rounded-2xl border border-c-border bg-c-hover-bg px-4 py-4 text-center text-sm text-c-text-tertiary">You haven't blocked anyone</div>
              ) : (
                blockedUsers.map(user => (
                  <div key={user.username} className="flex items-center justify-between gap-3 rounded-2xl border border-c-border bg-c-hover-bg p-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-c-text-primary">@{user.username}</div>
                      <div className="truncate text-xs text-c-text-tertiary">{user.reason && `${user.reason} · `}{new Date(user.blocked_at).toLocaleDateString()}</div>
                    </div>
                    <button type="button" onClick={() => void handleUnblock(user.username)} disabled={unblocking === user.username} className="rounded-full border border-c-border px-3 py-1.5 text-xs font-semibold text-c-text-secondary disabled:opacity-50">
                      {unblocking === user.username ? <i className="fa-solid fa-spinner fa-spin" /> : 'Unblock'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-c-border bg-c-bg-surface p-4">
            <h3 className="text-base font-bold text-c-text-primary">Hidden Posts</h3>
            <p className="mt-1 text-sm text-c-text-tertiary">Posts you've hidden from your feed. Unhide them to see them again.</p>
            <div className="mt-4 space-y-2">
              {hiddenPostsLoading ? (
                <div className="py-6 text-center text-c-text-tertiary"><i className="fa-solid fa-spinner fa-spin" /></div>
              ) : hiddenPosts.length === 0 ? (
                <div className="rounded-2xl border border-c-border bg-c-hover-bg px-4 py-4 text-center text-sm text-c-text-tertiary">You haven't hidden any posts</div>
              ) : (
                hiddenPosts.map(post => (
                  <div key={post.post_id} className="flex items-center justify-between gap-3 rounded-2xl border border-c-border bg-c-hover-bg p-3">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-c-text-secondary">@{post.author} · {new Date(post.hidden_at).toLocaleDateString()}</div>
                      <div className="truncate text-sm text-c-text-tertiary">{post.preview}</div>
                    </div>
                    <button type="button" onClick={() => void handleUnhide(post.post_id)} disabled={unhiding === post.post_id} className="rounded-full border border-c-border px-3 py-1.5 text-xs font-semibold text-c-text-secondary disabled:opacity-50">
                      {unhiding === post.post_id ? <i className="fa-solid fa-spinner fa-spin" /> : 'Unhide'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
