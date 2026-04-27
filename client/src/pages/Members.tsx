import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { triggerDashboardServerPull } from '../utils/serverPull'
import { refreshDashboardCommunities } from '../utils/dashboardCache'

type Member = {
  username: string;
  profile_picture?: string | null;
  role?: 'member'|'admin'|'owner'|'creator';
  is_creator?: boolean;
}

type InviteStep = 'choose' | 'username' | 'email' | 'link'

export default function Members(){
  const { community_id } = useParams()
  const navigate = useNavigate()
  const [members, setMembers] = useState<Member[]>([])
  const [communityName, setCommunityName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [canInviteCurrentCommunity, setCanInviteCurrentCommunity] = useState(false)
  const [ownerUsername, setOwnerUsername] = useState<string>('')
  const [currentUserRole, setCurrentUserRole] = useState<'member'|'admin'|'owner'|'app_admin'>('member')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteStep, setInviteStep] = useState<InviteStep>('choose')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteUsername, setInviteUsername] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteUpgradeUrl, setInviteUpgradeUrl] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [inviteSuccessMessage, setInviteSuccessMessage] = useState('')
  const [showQRCode, setShowQRCode] = useState(false)
  const [qrCodeUrl, setQRCodeUrl] = useState('')
  const [inviteSingleUse, setInviteSingleUse] = useState(false)
  const numericCommunityId = community_id ? Number(community_id) : null
  const [inviteCommunityId, setInviteCommunityId] = useState<number | null>(numericCommunityId)

  useEffect(() => {
    let mounted = true
    async function load(){
      setLoading(true)
      try{
        // Permissions
        try{
          const fd = new URLSearchParams({ community_id: String(community_id) })
          const perm = await fetch('/get_community_members', { method:'POST', credentials:'include', body: fd })
          const pj = await perm.json()
          if (mounted && pj){
            const role = pj.current_user_role || 'member'
            setOwnerUsername(pj.creator_username || '')
            setCurrentUserRole(role)
            const can = role === 'app_admin' || role === 'owner' || role === 'admin'
            setCanManage(!!can)
            if (!can) setCanInviteCurrentCommunity(false)
          }
        }catch{}

        // Members list
        const r = await fetch(`/community/${community_id}/members/list`, { credentials: 'include' })
        const j = await r.json()
        if (!mounted) return
        if (j?.success){
          console.log('API Response:', j)
          setMembers(j.members || [])
          if (j.community_name) setCommunityName(j.community_name)
          setError(null)
        } else {
          console.error('API Error:', j)
          setError(j?.message || j?.error || 'Error loading members')
        }
      }catch{
        if (mounted) setError('Error loading members')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [community_id])

  useEffect(() => {
    setInviteCommunityId(numericCommunityId)
  }, [numericCommunityId])

  useEffect(() => {
    if (!canManage || !numericCommunityId) {
      setCanInviteCurrentCommunity(false)
      return
    }

    let mounted = true
    async function loadRootInviteAccess() {
      try {
        const response = await fetch('/api/community/manageable', { credentials: 'include', headers: { 'Accept': 'application/json' } })
        const data = await response.json().catch(() => null)
        if (!mounted) return
        const roots = Array.isArray(data?.communities) ? data.communities : []
        setCanInviteCurrentCommunity(roots.some((community: { id?: number }) => Number(community.id) === numericCommunityId))
      } catch {
        if (mounted) setCanInviteCurrentCommunity(false)
      }
    }

    loadRootInviteAccess()
    return () => {
      mounted = false
    }
  }, [canManage, numericCommunityId])

  const resetInviteSelections = () => {
    setInviteCommunityId(numericCommunityId)
    setInviteEmail('')
    setInviteUsername('')
    setInviteError('')
    setInviteUpgradeUrl('')
    setInviteSuccess(false)
    setInviteSuccessMessage('')
    setShowQRCode(false)
    setQRCodeUrl('')
    setInviteStep('choose')
  }

  const handleCloseInviteModal = () => {
    resetInviteSelections()
    setShowInviteModal(false)
  }

  const buildInvitePayload = (base: Record<string, unknown> = {}) => {
    if (!inviteCommunityId) return base
    const payload: Record<string, unknown> = {
      community_id: inviteCommunityId,
      ...base
    }
    return payload
  }

  const handleOpenInviteModal = () => {
    if (!numericCommunityId) return
    setInviteCommunityId(numericCommunityId)
    setInviteEmail('')
    setInviteUsername('')
    setInviteError('')
    setInviteUpgradeUrl('')
    setInviteSuccess(false)
    setInviteSuccessMessage('')
    setShowQRCode(false)
    setQRCodeUrl('')
    setInviteStep('choose')

    // Load invite settings
    fetch(`/api/community/${numericCommunityId}/invite_settings`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(r => r.json())
      .then(d => { if (d?.success) setInviteSingleUse(d.invite_single_use) })
      .catch(() => {})

    setShowInviteModal(true)
  }

  // Add member removed per new requirements; community code is displayed instead

  async function removeMember(usernameToRemove: string){
    const ok = confirm(`Remove @${usernameToRemove} from this community?`)
    if (!ok) return
    const fd = new URLSearchParams({ community_id: String(community_id), username: usernameToRemove })
    const r = await fetch('/remove_community_member', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success){
      try{
        const rr = await fetch(`/community/${community_id}/members/list`, { credentials: 'include' })
        const jj = await rr.json()
        if (jj?.success) setMembers(jj.members || [])
      }catch{}
    } else {
      alert(j?.error || 'Unable to remove member')
    }
  }

  async function updateRole(targetUsername: string, newRole: 'admin'|'member'|'owner'){
    const label = newRole === 'admin' ? 'Make admin' : newRole === 'member' ? 'Remove admin' : 'Transfer ownership'
    const ok = confirm(`${label} for @${targetUsername}?`)
    if (!ok) return
    const fd = new URLSearchParams({ community_id: String(community_id), target_username: targetUsername, new_role: newRole })
    const r = await fetch('/update_member_role', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success){
      try{
        const rr = await fetch(`/community/${community_id}/members/list`, { credentials: 'include' })
        const jj = await rr.json()
        if (jj?.success) setMembers(jj.members || [])
      }catch{}
    } else {
      alert(j?.error || 'Unable to update role')
    }
  }

  async function leaveCommunity(){
    const ok = confirm(`Are you sure you want to leave ${communityName || 'this community'}?`)
    if (!ok) return
    const fd = new URLSearchParams({ community_id: String(community_id) })
    const r = await fetch('/leave_community', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success){
      await triggerDashboardServerPull()
      await refreshDashboardCommunities()
      navigate('/communities')
    } else {
      alert(j?.error || 'Unable to leave community')
    }
  }

  async function handleSendInvite() {
    if (!inviteEmail.trim()) {
      setInviteError('Email is required')
      return
    }
    if (!inviteCommunityId) {
      setInviteError('No community selected for invitation')
      return
    }
    setInviteLoading(true)
    setInviteError('')
    setInviteUpgradeUrl('')
    setInviteSuccess(false)

    try {
      const payload = buildInvitePayload({ email: inviteEmail.trim() })
      const response = await fetch('/api/community/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setInviteSuccess(true)
        setInviteSuccessMessage('Invitation sent successfully!')
        setInviteEmail('')
        setTimeout(() => {
          handleCloseInviteModal()
        }, 2000)
      } else {
        if (data?.show_upgrade && data?.upgrade_url) setInviteUpgradeUrl(data.upgrade_url)
        setInviteError(data.error || 'Failed to send invitation')
      }
    } catch (error) {
      console.error('Error sending invitation:', error)
      setInviteError('Failed to send invitation')
    } finally {
      setInviteLoading(false)
    }
  }

  async function handleSendUsernameInvite() {
    const targetUsername = inviteUsername.trim().replace(/^@+/, '')
    if (!targetUsername) {
      setInviteError('Username is required')
      return
    }
    if (!inviteCommunityId) {
      setInviteError('No community selected for invitation')
      return
    }
    setInviteLoading(true)
    setInviteError('')
    setInviteUpgradeUrl('')
    setInviteSuccess(false)
    setInviteSuccessMessage('')

    try {
      const payload = buildInvitePayload({ username: targetUsername })
      const response = await fetch('/api/community/invite_username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setInviteSuccess(true)
        setInviteSuccessMessage(data.message || `Invite sent to @${targetUsername}`)
        setInviteUsername('')
      } else {
        if (data?.show_upgrade && data?.upgrade_url) setInviteUpgradeUrl(data.upgrade_url)
        setInviteError(data.error || 'Failed to send username invitation')
      }
    } catch (error) {
      console.error('Error sending username invitation:', error)
      setInviteError('Failed to send username invitation')
    } finally {
      setInviteLoading(false)
    }
  }

  async function handleGenerateQR() {
    if (!inviteCommunityId) {
      setInviteError('No community selected for invitation')
      return
    }
    setInviteLoading(true)
    setInviteError('')
    setInviteUpgradeUrl('')
    
    try {
      const payload = buildInvitePayload()
      const response = await fetch('/api/community/invite_link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setQRCodeUrl(data.invite_url)
        setShowQRCode(true)
      } else {
        if (data?.show_upgrade && data?.upgrade_url) setInviteUpgradeUrl(data.upgrade_url)
        setInviteError(data.error || 'Failed to generate QR code')
      }
    } catch (error) {
      console.error('Error generating QR code:', error)
      setInviteError('Failed to generate QR code')
    } finally {
      setInviteLoading(false)
    }
  }

  function getRoleBadge(member: Member){
    // Debug logging to see what data we're getting
    console.log('Member data:', member)

    if (member.role === 'owner' || member.is_creator || member.role === 'creator') {
      return <span className="px-2 py-0.5 text-xs font-medium bg-teal-600/20 text-teal-300 rounded-full border border-teal-500/30">Owner</span>
    } else if (member.role === 'admin') {
      return <span className="px-2 py-0.5 text-xs font-medium bg-cyan-600/20 text-cyan-300 rounded-full border border-cyan-500/30">Admin</span>
    } else {
      return <span className="px-2 py-0.5 text-xs font-medium bg-gray-600/20 text-gray-300 rounded-full border border-gray-500/30">Member</span>
    }
  }

  return (
    <div className="min-h-screen bg-black text-white pb-safe">
      <div
        className="fixed left-0 right-0 h-12 border-b border-white/10 bg-black/95 backdrop-blur flex items-center px-3 z-40"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))', '--app-subnav-height': '48px' } as CSSProperties}
      >
        <button className="px-3 py-2 rounded-full text-[#cfd8dc] hover:text-[#4db6ac]" onClick={()=> navigate(`/community_feed_react/${community_id}`)} aria-label="Back">
          <i className="fa-solid fa-arrow-left" />
        </button>
        <div className="ml-2 text-xs text-[#9fb0b5]">
          {members.length} {members.length === 1 ? 'Member' : 'Members'}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!canManage && (
            <button
              onClick={leaveCommunity}
              className="px-3 py-1.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-medium hover:bg-red-500/30"
            >
              <i className="fa-solid fa-arrow-right-from-bracket mr-1.5" />
              Leave
            </button>
          )}
            {canManage && canInviteCurrentCommunity && (
            <button
                onClick={handleOpenInviteModal}
              className="px-3 py-1.5 bg-[#4db6ac] text-black rounded-lg text-xs font-medium hover:bg-[#45a099]"
            >
              <i className="fa-solid fa-envelope mr-1.5" />
              Invite
            </button>
          )}
        </div>
      </div>
      <div
        className="app-subnav-offset max-w-2xl mx-auto px-3 pb-6"
        style={{ minHeight: 'calc(100vh - var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px))))', '--app-subnav-height': '48px' } as CSSProperties}
      >
        {loading ? (
          <div className="text-[#9fb0b5]">Loading…</div>
        ) : error ? (
          <div className="text-red-400">{error}</div>
        ) : (
          <div className="space-y-2">
            {members.length === 0 ? (
              <div className="text-[#9fb0b5]">No members.</div>
            ) : members.map((m, i) => (
              <button key={i} className="flex items-center gap-3 p-2 rounded-xl bg-white/[0.03] w-full text-left hover:bg-white/[0.06]"
                onClick={()=> { window.location.href = `/profile/${encodeURIComponent(m.username)}` }}
                aria-label={`View @${m.username} profile`}>
                  <Avatar username={m.username} url={m.profile_picture || undefined} size={36} linkToProfile />
                <div className="flex-1">
                  <div className="font-medium">{m.username}</div>
                  <div className="mt-1">
                    {getRoleBadge(m)}
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-1">
                  {canManage && m.username !== ownerUsername ? (
                    <MemberActions
                      memberRole={m.role || 'member'}
                      memberUsername={m.username}
                      communityId={numericCommunityId}
                      onPromote={()=> updateRole(m.username, 'admin')}
                      onDemote={()=> updateRole(m.username, 'member')}
                      onTransfer={currentUserRole === 'app_admin' ? ()=> updateRole(m.username, 'owner') : undefined}
                      onRemove={()=> removeMember(m.username)}
                    />
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div
          className="fixed inset-0 z-[9990] flex items-start justify-center bg-[radial-gradient(circle_at_top,_rgba(77,182,172,0.18),_rgba(0,0,0,0.92)_42%)] px-3 pb-6 backdrop-blur-md sm:px-4 sm:pb-4"
          style={{ paddingTop: 'calc(var(--app-header-height, 56px) + env(safe-area-inset-top, 0px) + 14px)' }}
          onClick={(e) => { if (e.target === e.currentTarget && !inviteLoading) handleCloseInviteModal() }}
        >
          <div
            className="flex max-h-[calc(100dvh-var(--app-header-height,56px)-40px)] w-full max-w-md flex-col overflow-hidden rounded-[30px] border border-[#4db6ac]/20 bg-[#070909]/95 shadow-2xl shadow-black/70 ring-1 ring-white/[0.04] sm:max-h-[82dvh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-1 w-full bg-gradient-to-r from-transparent via-[#4db6ac] to-transparent opacity-80" />
            <div className="flex items-center gap-3 border-b border-white/10 bg-gradient-to-b from-white/[0.06] to-transparent px-4 py-4">
              {inviteStep !== 'choose' ? (
                <button
                  type="button"
                  onClick={() => {
                    setInviteStep('choose')
                    setInviteError('')
                    setInviteSuccess(false)
                    setInviteSuccessMessage('')
                    setShowQRCode(false)
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white/80 transition hover:border-[#4db6ac]/60 hover:bg-[#4db6ac]/10 hover:text-[#4db6ac]"
                  disabled={inviteLoading}
                  aria-label="Back to invite options"
                >
                  <i className="fa-solid fa-arrow-left text-sm" />
                </button>
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#4db6ac]/80">Invite members</div>
                <h2 className="truncate text-lg font-semibold text-white">Invite to {communityName || 'Community'}</h2>
                <p className="mt-0.5 text-xs text-white/55">
                  {inviteStep === 'choose' ? 'Choose how you want to invite members' : 'Complete the selected invite method'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseInviteModal}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white/80 transition hover:border-[#4db6ac]/60 hover:bg-[#4db6ac]/10 hover:text-[#4db6ac]"
                disabled={inviteLoading}
                aria-label="Close invite modal"
              >
                <i className="fa-solid fa-xmark text-sm" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4" style={{ WebkitOverflowScrolling: 'touch' }}>
              {inviteSuccess && (
                <div className="mb-4 rounded-2xl border border-green-500/25 bg-green-500/10 p-3 text-sm text-green-300">
                  {inviteSuccessMessage || 'Invitation sent successfully!'}
                </div>
              )}

              {inviteError && (
                <div className="mb-4 rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-300">
                  {inviteError}
                  {inviteUpgradeUrl && (
                    <button
                      type="button"
                      onClick={() => navigate(inviteUpgradeUrl)}
                      className="mt-3 w-full rounded-full bg-[#4db6ac] px-4 py-2 text-sm font-semibold text-black hover:bg-[#45a099]"
                    >
                      Upgrade community tier
                    </button>
                  )}
                </div>
              )}

              {inviteStep === 'choose' && (
                <div className="space-y-3">
                  <div className="rounded-3xl border border-white/10 bg-black/35 p-4">
                    <p className="text-sm leading-relaxed text-white/70">
                      Pick the simplest route for the person you are inviting. You can come back and choose another method anytime.
                    </p>
                  </div>
                  {([
                    {
                      id: 'username',
                      icon: 'fa-solid fa-at',
                      title: 'Username',
                      text: 'Invite an existing C-Point member with an in-app notification.',
                    },
                    {
                      id: 'email',
                      icon: 'fa-regular fa-envelope',
                      title: 'E-mail',
                      text: 'Send a direct invite to someone by e-mail address.',
                    },
                    {
                      id: 'link',
                      icon: 'fa-solid fa-qrcode',
                      title: 'QR code / link',
                      text: 'Generate a shareable QR code and invite link.',
                    },
                  ] as Array<{ id: InviteStep; icon: string; title: string; text: string }>).map(option => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setInviteStep(option.id)
                        setInviteError('')
                        setInviteSuccess(false)
                        setInviteSuccessMessage('')
                      }}
                      className="group flex w-full items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.035] p-4 text-left shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:border-[#4db6ac]/50 hover:bg-[#4db6ac]/10"
                    >
                      <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-[#4db6ac]/20 bg-[#4db6ac]/15 text-[#4db6ac] transition group-hover:bg-[#4db6ac]/20">
                        <i className={`${option.icon} text-base`} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-white">{option.title}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-white/55">{option.text}</span>
                      </span>
                      <i className="fa-solid fa-chevron-right text-xs text-white/30 transition group-hover:text-[#4db6ac]" />
                    </button>
                  ))}
                </div>
              )}

              {inviteStep === 'username' && (
                <div className="space-y-4">
                  <div className="rounded-3xl border border-white/10 bg-black/35 p-4">
                    <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-white/40">C-Point username</label>
                    <input
                      type="text"
                      value={inviteUsername}
                      onChange={(e) => {
                        setInviteUsername(e.target.value)
                        setInviteError('')
                        setInviteSuccess(false)
                        setInviteSuccessMessage('')
                      }}
                      placeholder="@username"
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-white/35 outline-none transition focus:border-[#4db6ac] focus:bg-black/40"
                      disabled={inviteLoading}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleSendUsernameInvite()
                        }
                      }}
                    />
                    <p className="mt-2 text-xs leading-relaxed text-white/45">
                      The member gets an in-app and push notification, then can accept or decline.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleSendUsernameInvite}
                    className="flex h-12 w-full items-center justify-center rounded-2xl bg-[#4db6ac] px-4 text-sm font-semibold text-black shadow-lg shadow-[#4db6ac]/20 transition hover:bg-[#45a099] disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={inviteLoading || !inviteUsername.trim()}
                  >
                    {inviteLoading ? 'Sending...' : 'Send Username Invite'}
                  </button>
                </div>
              )}

              {inviteStep === 'email' && (
                <div className="space-y-4">
                  <div className="rounded-3xl border border-white/10 bg-black/35 p-4">
                    <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-white/40">E-mail address</label>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => {
                        setInviteEmail(e.target.value)
                        setInviteError('')
                        setInviteSuccess(false)
                      }}
                      placeholder="email@example.com"
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-white/35 outline-none transition focus:border-[#4db6ac] focus:bg-black/40"
                      disabled={inviteLoading || inviteSuccess}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleSendInvite()
                        }
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSendInvite}
                    className="flex h-12 w-full items-center justify-center rounded-2xl bg-[#4db6ac] px-4 text-sm font-semibold text-black shadow-lg shadow-[#4db6ac]/20 transition hover:bg-[#45a099] disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={inviteLoading || inviteSuccess || !inviteEmail.trim()}
                  >
                    {inviteLoading ? 'Sending...' : 'Send E-mail Invite'}
                  </button>
                </div>
              )}

              {inviteStep === 'link' && (
                <div className="space-y-4">
                  {(currentUserRole === 'admin' || currentUserRole === 'owner' || currentUserRole === 'app_admin') && (
                    <div className="flex items-center justify-between gap-3 rounded-3xl border border-white/10 bg-black/35 px-4 py-3">
                      <div>
                        <div className="text-sm font-semibold text-white">Single-use invite link</div>
                        <div className="text-xs text-white/45">When enabled, each QR/link can only be used once.</div>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          const newVal = !inviteSingleUse
                          setInviteSingleUse(newVal)
                          try {
                            await fetch(`/api/community/${inviteCommunityId}/invite_settings`, {
                              method: 'POST', credentials: 'include',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ invite_single_use: newVal })
                            })
                          } catch {}
                        }}
                        className={`relative h-7 w-12 flex-shrink-0 rounded-full transition-colors ${inviteSingleUse ? 'bg-[#4db6ac]' : 'bg-white/20'}`}
                        aria-pressed={inviteSingleUse}
                      >
                        <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${inviteSingleUse ? 'translate-x-5' : ''}`} />
                      </button>
                    </div>
                  )}

                  {!showQRCode ? (
                    <button
                      type="button"
                      onClick={handleGenerateQR}
                      className="flex h-12 w-full items-center justify-center rounded-2xl border border-[#4db6ac]/35 bg-[#4db6ac]/15 px-4 text-sm font-semibold text-[#4db6ac] transition hover:bg-[#4db6ac]/25 disabled:cursor-not-allowed disabled:opacity-45"
                      disabled={inviteLoading}
                    >
                      <i className="fa-solid fa-qrcode mr-2" />
                      {inviteLoading ? 'Generating...' : 'Generate QR Code / Link'}
                    </button>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-3xl border border-white/10 bg-white p-5">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCodeUrl)}`}
                          alt="Invitation QR Code"
                          className="mx-auto h-60 w-60 max-w-full"
                        />
                      </div>
                      <div className="break-all rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-center text-xs text-white/50">
                        {qrCodeUrl}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setShowQRCode(false)}
                          className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white/80 hover:bg-white/[0.08]"
                        >
                          Regenerate
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(qrCodeUrl)
                            alert('Link copied to clipboard!')
                          }}
                          className="rounded-2xl bg-[#4db6ac] px-4 py-3 text-sm font-semibold text-black hover:bg-[#45a099]"
                        >
                          Copy Link
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


type SubCommunity = {
  id: number
  name: string
  parent_community_id?: number | null
}

function MemberActions({ 
  memberRole, 
  memberUsername,
  communityId,
  onPromote, 
  onDemote, 
  onTransfer, 
  onRemove,
  onMemberUpdated
}:{ 
  memberRole: string, 
  memberUsername: string,
  communityId: number | null,
  onPromote: ()=>void, 
  onDemote: ()=>void, 
  onTransfer?: ()=>void, 
  onRemove: ()=>void,
  onMemberUpdated?: ()=>void
}){
  const [open, setOpen] = useState(false)
  const [showSubCommunityModal, setShowSubCommunityModal] = useState(false)
  const [subCommunities, setSubCommunities] = useState<SubCommunity[]>([])
  const [loadingSubCommunities, setLoadingSubCommunities] = useState(false)
  const [addingToSubCommunity, setAddingToSubCommunity] = useState(false)
  const [subCommunityError, setSubCommunityError] = useState('')
  const isAdmin = memberRole === 'admin'
  const isMember = memberRole === 'member'

  const handleOpenSubCommunityModal = async () => {
    setOpen(false)
    setShowSubCommunityModal(true)
    setSubCommunityError('')
    setLoadingSubCommunities(true)
    
    try {
      const response = await fetch('/api/member/accessible_subcommunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          community_id: communityId,
          target_username: memberUsername
        })
      })
      const data = await response.json()
      if (data.success) {
        setSubCommunities(data.subcommunities || [])
      } else {
        setSubCommunityError(data.error || 'Failed to load sub-communities')
      }
    } catch (err) {
      console.error('Failed to load sub-communities:', err)
      setSubCommunityError('Failed to load sub-communities')
    } finally {
      setLoadingSubCommunities(false)
    }
  }

  const handleAddToSubCommunity = async (targetCommunityId: number) => {
    setAddingToSubCommunity(true)
    setSubCommunityError('')
    
    try {
      const response = await fetch('/api/member/add_to_subcommunity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          target_username: memberUsername,
          target_community_id: targetCommunityId,
          source_community_id: communityId
        })
      })
      const data = await response.json()
      if (data.success) {
        // Remove the community from the list since they're now a member
        setSubCommunities(prev => prev.filter(c => c.id !== targetCommunityId))
        if (onMemberUpdated) onMemberUpdated()
        // If no more communities, close the modal
        if (subCommunities.length <= 1) {
          setShowSubCommunityModal(false)
        }
      } else {
        setSubCommunityError(data.error || 'Failed to add member')
      }
    } catch (err) {
      console.error('Failed to add member to sub-community:', err)
      setSubCommunityError('Failed to add member')
    } finally {
      setAddingToSubCommunity(false)
    }
  }
  
  return (
    <>
      <div className="relative" onClick={(e)=> e.stopPropagation()}>
        <button className="px-2 py-1 rounded-md border border-white/10 text-xs text-[#cfd8dc] hover:bg-white/5" onClick={()=> setOpen(v=>!v)} aria-expanded={open} aria-haspopup="menu">
          Manage
        </button>
        {open && (
          <div className="absolute right-0 mt-1 w-48 rounded-md border border-white/10 bg-black shadow-lg z-20">
            {isMember && (
              <button className="w-full text-left px-3 py-2 text-xs hover:bg-white/5" onClick={()=> { setOpen(false); onPromote() }}>Make admin</button>
            )}
            {isAdmin && (
              <button className="w-full text-left px-3 py-2 text-xs hover:bg-white/5" onClick={()=> { setOpen(false); onDemote() }}>Remove admin</button>
            )}
            {onTransfer ? (
              <button className="w-full text-left px-3 py-2 text-xs hover:bg-white/5" onClick={()=> { setOpen(false); onTransfer() }}>Transfer ownership</button>
            ) : null}
            <div className="h-px bg-white/10" />
            <button 
              className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 text-[#4db6ac]" 
              onClick={handleOpenSubCommunityModal}
            >
              <i className="fa-solid fa-plus mr-2" />
              Add to sub-community
            </button>
            <div className="h-px bg-white/10" />
            <button className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 text-red-400" onClick={()=> { setOpen(false); onRemove() }}>Remove member</button>
          </div>
        )}
      </div>

      {/* Add to Sub-Community Modal */}
      {showSubCommunityModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
          <div className="bg-[#1a1a1a] rounded-xl p-6 w-full max-w-md border border-white/10 max-h-[80vh] overflow-hidden flex flex-col">
            <h2 className="text-lg font-semibold mb-2">Add @{memberUsername} to Sub-Community</h2>
            <p className="text-sm text-white/60 mb-4">Select a sub-community to add this member to</p>

            {subCommunityError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {subCommunityError}
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {loadingSubCommunities ? (
                <div className="text-center py-8 text-white/60">
                  <i className="fa-solid fa-spinner fa-spin text-xl mb-2" />
                  <div className="text-sm">Loading sub-communities...</div>
                </div>
              ) : subCommunities.length === 0 ? (
                <div className="text-center py-8 text-white/40">
                  <i className="fa-solid fa-folder-open text-2xl mb-2" />
                  <div className="text-sm">No available sub-communities</div>
                  <div className="text-xs mt-1">Either there are no sub-communities, or this member is already in all of them.</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {subCommunities.map(sc => (
                    <button
                      key={sc.id}
                      onClick={() => handleAddToSubCommunity(sc.id)}
                      disabled={addingToSubCommunity}
                      className="w-full text-left px-4 py-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 hover:border-[#4db6ac]/50 transition disabled:opacity-50"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{sc.name}</span>
                        <i className="fa-solid fa-plus text-[#4db6ac]" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => setShowSubCommunityModal(false)}
              className="mt-4 w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-medium hover:bg-white/10"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  )
}

