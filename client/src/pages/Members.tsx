import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const { community_id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const openedInviteFromQueryRef = useRef(false)
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
          setError(j?.message || j?.error || t('social.error_loading_members'))
        }
      }catch{
        if (mounted) setError(t('social.error_loading_members'))
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

  useEffect(() => {
    if (openedInviteFromQueryRef.current) return
    const sp = new URLSearchParams(location.search)
    if (sp.get('open_invite') !== '1') return
    if (loading || !numericCommunityId || !canManage) return
    openedInviteFromQueryRef.current = true
    handleOpenInviteModal()
    if (community_id) {
      navigate(`/community/${community_id}/members`, { replace: true })
    }
  }, [loading, canManage, numericCommunityId, location.search, community_id, navigate])

  // Add member removed per new requirements; community code is displayed instead

  async function removeMember(usernameToRemove: string){
    const ok = confirm(t('social.remove_member_confirm', { username: usernameToRemove }))
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
      alert(j?.error || t('social.unable_remove_member'))
    }
  }

  async function updateRole(targetUsername: string, newRole: 'admin'|'member'|'owner'){
    const label = newRole === 'admin'
      ? t('feed.make_admin')
      : newRole === 'member'
        ? t('feed.remove_admin')
        : t('social.transfer_ownership')
    const ok = confirm(t('social.update_role_confirm', { action: label, username: targetUsername }))
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
      alert(j?.error || t('social.unable_update_role'))
    }
  }

  async function leaveCommunity(){
    const ok = confirm(t('social.leave_confirm', {
      community: communityName || t('social.community_this'),
    }))
    if (!ok) return
    const fd = new URLSearchParams({ community_id: String(community_id) })
    const r = await fetch('/leave_community', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success){
      await triggerDashboardServerPull()
      await refreshDashboardCommunities()
      navigate('/premium_dashboard')
    } else {
      alert(j?.error || t('social.unable_leave_community'))
    }
  }

  async function handleSendInvite() {
    if (!inviteEmail.trim()) {
      setInviteError(t('social.email_required'))
      return
    }
    if (!inviteCommunityId) {
      setInviteError(t('social.no_community_selected'))
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
        setInviteSuccessMessage(t('social.invite_sent_success'))
        setInviteEmail('')
        setTimeout(() => {
          handleCloseInviteModal()
        }, 2000)
      } else {
        if (data?.show_upgrade && data?.upgrade_url) setInviteUpgradeUrl(data.upgrade_url)
        setInviteError(data.error || t('social.failed_send_invite'))
      }
    } catch (error) {
      console.error('Error sending invitation:', error)
      setInviteError(t('social.failed_send_invite'))
    } finally {
      setInviteLoading(false)
    }
  }

  async function handleSendUsernameInvite() {
    const targetUsername = inviteUsername.trim().replace(/^@+/, '')
    if (!targetUsername) {
      setInviteError(t('social.username_required'))
      return
    }
    if (!inviteCommunityId) {
      setInviteError(t('social.no_community_selected'))
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
        setInviteSuccessMessage(data.message || t('social.invite_sent_to_username', { username: targetUsername }))
        setInviteUsername('')
      } else {
        if (data?.show_upgrade && data?.upgrade_url) setInviteUpgradeUrl(data.upgrade_url)
        setInviteError(data.error || t('social.failed_username_invite'))
      }
    } catch (error) {
      console.error('Error sending username invitation:', error)
      setInviteError(t('social.failed_username_invite'))
    } finally {
      setInviteLoading(false)
    }
  }

  async function handleGenerateQR() {
    if (!inviteCommunityId) {
      setInviteError(t('social.no_community_selected'))
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
        setInviteError(data.error || t('social.failed_generate_qr'))
      }
    } catch (error) {
      console.error('Error generating QR code:', error)
      setInviteError(t('social.failed_generate_qr'))
    } finally {
      setInviteLoading(false)
    }
  }

  function getRoleBadge(member: Member){
    // Debug logging to see what data we're getting
    console.log('Member data:', member)

    if (member.role === 'owner' || member.is_creator || member.role === 'creator') {
      return <span className="px-2 py-0.5 text-xs font-medium bg-teal-600/20 text-teal-300 rounded-full border border-teal-500/30">{t('feed.owner')}</span>
    } else if (member.role === 'admin') {
      return <span className="px-2 py-0.5 text-xs font-medium bg-cyan-600/20 text-cyan-300 rounded-full border border-cyan-500/30">{t('feed.admin')}</span>
    } else {
      return <span className="px-2 py-0.5 text-xs font-medium bg-gray-600/20 text-gray-300 rounded-full border border-gray-500/30">{t('social.role_member')}</span>
    }
  }

  return (
    <div className="min-h-screen bg-black text-white pb-safe">
      <div
        className="fixed left-0 right-0 h-12 border-b border-white/10 bg-black/95 backdrop-blur flex items-center px-3 z-40"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))', '--app-subnav-height': '48px' } as CSSProperties}
      >
        <button className="px-3 py-2 rounded-full text-[#cfd8dc] hover:text-[#4db6ac]" onClick={()=> navigate(`/community_feed_react/${community_id}`)} aria-label={t('common.back')}>
          <i className="fa-solid fa-arrow-left" />
        </button>
        <div className="ml-2 text-xs text-[#9fb0b5]">
          {t('social.member_count', { count: members.length })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!canManage && (
            <button
              onClick={leaveCommunity}
              className="px-3 py-1.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-medium hover:bg-red-500/30"
            >
              <i className="fa-solid fa-arrow-right-from-bracket mr-1.5" />
              {t('communities.leave_action')}
            </button>
          )}
            {canManage && canInviteCurrentCommunity && (
            <button
                onClick={handleOpenInviteModal}
              className="px-3 py-1.5 bg-[#4db6ac] text-black rounded-lg text-xs font-medium hover:bg-[#45a099]"
            >
              <i className="fa-solid fa-envelope mr-1.5" />
              {t('social.invite')}
            </button>
          )}
        </div>
      </div>
      <div
        className="app-subnav-offset max-w-2xl mx-auto px-3 pb-6"
        style={{ minHeight: 'calc(100vh - var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px))))', '--app-subnav-height': '48px' } as CSSProperties}
      >
        {loading ? (
          <div className="text-[#9fb0b5]">{t('social.members_loading')}</div>
        ) : error ? (
          <div className="text-red-400">{error}</div>
        ) : (
          <div className="space-y-2">
            {members.length === 0 ? (
              <div className="text-[#9fb0b5]">{t('social.no_members')}</div>
            ) : members.map((m, i) => (
              <button key={i} className="flex items-center gap-3 p-2 rounded-xl bg-white/[0.03] w-full text-left hover:bg-white/[0.06]"
                onClick={()=> { window.location.href = `/profile/${encodeURIComponent(m.username)}` }}
                aria-label={t('social.view_profile', { username: m.username })}>
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
          className="fixed inset-0 z-[9990] flex items-start justify-center bg-[radial-gradient(circle_at_top,_rgba(77,182,172,0.18),_rgba(0,0,0,0.92)_42%)] px-3 backdrop-blur-md sm:px-4"
          style={{
            paddingTop: 'calc(var(--app-header-height, 56px) + env(safe-area-inset-top, 0px) + 14px)',
            paddingBottom: 'max(18px, env(safe-area-inset-bottom, 0px))',
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !inviteLoading) handleCloseInviteModal() }}
        >
          <div
            className="flex max-h-[calc(100dvh-var(--app-header-height,56px)-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-42px)] w-full max-w-md flex-col overflow-hidden rounded-[30px] border border-[#4db6ac]/20 bg-[#070909]/95 shadow-2xl shadow-black/70 ring-1 ring-white/[0.04] sm:max-h-[82dvh]"
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
                  aria-label={t('social.back_to_invite_options')}
                >
                  <i className="fa-solid fa-arrow-left text-sm" />
                </button>
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#4db6ac]/80">{t('social.invite_members')}</div>
                <h2 className="truncate text-lg font-semibold text-white">{t('social.invite_to', { community: communityName || t('social.community_fallback') })}</h2>
                <p className="mt-0.5 text-xs text-white/55">
                  {inviteStep === 'choose' ? t('social.invite_step_choose_hint') : t('social.invite_step_complete_hint')}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseInviteModal}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white/80 transition hover:border-[#4db6ac]/60 hover:bg-[#4db6ac]/10 hover:text-[#4db6ac]"
                disabled={inviteLoading}
                aria-label={t('social.close_invite_modal')}
              >
                <i className="fa-solid fa-xmark text-sm" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4" style={{ WebkitOverflowScrolling: 'touch', paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))' }}>
              {inviteSuccess && (
                <div className="mb-4 rounded-2xl border border-green-500/25 bg-green-500/10 p-3 text-sm text-green-300">
                  {inviteSuccessMessage || t('social.invite_sent_success')}
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
                      {t('social.upgrade_community_tier')}
                    </button>
                  )}
                </div>
              )}

              {inviteStep === 'choose' && (
                <div className="space-y-3">
                  <div className="rounded-3xl border border-white/10 bg-black/35 p-4">
                    <p className="text-sm leading-relaxed text-white/70">
                      {t('social.invite_choose_intro')}
                    </p>
                  </div>
                  {([
                    {
                      id: 'username',
                      icon: 'fa-solid fa-at',
                      titleKey: 'social.invite_method_username_title',
                      textKey: 'social.invite_method_username_text',
                    },
                    {
                      id: 'email',
                      icon: 'fa-regular fa-envelope',
                      titleKey: 'social.invite_method_email_title',
                      textKey: 'social.invite_method_email_text',
                    },
                    {
                      id: 'link',
                      icon: 'fa-solid fa-qrcode',
                      titleKey: 'social.invite_method_link_title',
                      textKey: 'social.invite_method_link_text',
                    },
                  ] as Array<{ id: InviteStep; icon: string; titleKey: string; textKey: string }>).map(option => (
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
                        <span className="block text-sm font-semibold text-white">{t(option.titleKey)}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-white/55">{t(option.textKey)}</span>
                      </span>
                      <i className="fa-solid fa-chevron-right text-xs text-white/30 transition group-hover:text-[#4db6ac]" />
                    </button>
                  ))}
                </div>
              )}

              {inviteStep === 'username' && (
                <div className="space-y-4">
                  <div className="rounded-3xl border border-white/10 bg-black/35 p-4">
                    <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-white/40">{t('social.username_label')}</label>
                    <input
                      type="text"
                      value={inviteUsername}
                      onChange={(e) => {
                        setInviteUsername(e.target.value)
                        setInviteError('')
                        setInviteSuccess(false)
                        setInviteSuccessMessage('')
                      }}
                      placeholder={t('social.username_placeholder')}
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
                      {t('social.username_invite_hint')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleSendUsernameInvite}
                    className="flex h-12 w-full items-center justify-center rounded-2xl bg-[#4db6ac] px-4 text-sm font-semibold text-black shadow-lg shadow-[#4db6ac]/20 transition hover:bg-[#45a099] disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={inviteLoading || !inviteUsername.trim()}
                  >
                    {inviteLoading ? t('social.sending') : t('social.send_username_invite')}
                  </button>
                </div>
              )}

              {inviteStep === 'email' && (
                <div className="space-y-4">
                  <div className="rounded-3xl border border-white/10 bg-black/35 p-4">
                    <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-white/40">{t('social.email_label')}</label>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => {
                        setInviteEmail(e.target.value)
                        setInviteError('')
                        setInviteSuccess(false)
                      }}
                      placeholder={t('social.email_placeholder')}
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
                    {inviteLoading ? t('social.sending') : t('social.send_email_invite')}
                  </button>
                </div>
              )}

              {inviteStep === 'link' && (
                <div className="space-y-4">
                  {(currentUserRole === 'admin' || currentUserRole === 'owner' || currentUserRole === 'app_admin') && (
                    <div className="flex items-center justify-between gap-3 rounded-3xl border border-white/10 bg-black/35 px-4 py-3">
                      <div>
                        <div className="text-sm font-semibold text-white">{t('social.single_use_link_title')}</div>
                        <div className="text-xs text-white/45">{t('social.single_use_link_hint')}</div>
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
                      {inviteLoading ? t('social.generating') : t('social.generate_qr_link')}
                    </button>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-3xl border border-white/10 bg-white p-5">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCodeUrl)}`}
                          alt={t('social.qr_code_alt')}
                          className="mx-auto aspect-square h-auto w-full max-w-[15rem] max-h-[min(15rem,36dvh)]"
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
                          {t('social.regenerate')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(qrCodeUrl)
                            alert(t('social.link_copied'))
                          }}
                          className="rounded-2xl bg-[#4db6ac] px-4 py-3 text-sm font-semibold text-black hover:bg-[#45a099]"
                        >
                          {t('social.copy_link')}
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
  const { t } = useTranslation()
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
        setSubCommunityError(data.error || t('social.failed_load_sub_communities'))
      }
    } catch (err) {
      console.error('Failed to load sub-communities:', err)
      setSubCommunityError(t('social.failed_load_sub_communities'))
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
        setSubCommunityError(data.error || t('social.failed_add_member'))
      }
    } catch (err) {
      console.error('Failed to add member to sub-community:', err)
      setSubCommunityError(t('social.failed_add_member'))
    } finally {
      setAddingToSubCommunity(false)
    }
  }
  
  return (
    <>
      <div className="relative" onClick={(e)=> e.stopPropagation()}>
        <button className="px-2 py-1 rounded-md border border-white/10 text-xs text-[#cfd8dc] hover:bg-white/5" onClick={()=> setOpen(v=>!v)} aria-expanded={open} aria-haspopup="menu">
          {t('social.manage')}
        </button>
        {open && (
          <div className="absolute right-0 mt-1 w-48 rounded-md border border-white/10 bg-black shadow-lg z-20">
            {isMember && (
              <button className="w-full text-left px-3 py-2 text-xs hover:bg-white/5" onClick={()=> { setOpen(false); onPromote() }}>{t('feed.make_admin')}</button>
            )}
            {isAdmin && (
              <button className="w-full text-left px-3 py-2 text-xs hover:bg-white/5" onClick={()=> { setOpen(false); onDemote() }}>{t('feed.remove_admin')}</button>
            )}
            {onTransfer ? (
              <button className="w-full text-left px-3 py-2 text-xs hover:bg-white/5" onClick={()=> { setOpen(false); onTransfer() }}>{t('social.transfer_ownership')}</button>
            ) : null}
            <div className="h-px bg-white/10" />
            <button 
              className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 text-[#4db6ac]" 
              onClick={handleOpenSubCommunityModal}
            >
              <i className="fa-solid fa-plus mr-2" />
              {t('social.add_to_sub_community')}
            </button>
            <div className="h-px bg-white/10" />
            <button className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 text-red-400" onClick={()=> { setOpen(false); onRemove() }}>{t('social.remove_member')}</button>
          </div>
        )}
      </div>

      {/* Add to Sub-Community Modal */}
      {showSubCommunityModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
          <div className="bg-[#1a1a1a] rounded-xl p-6 w-full max-w-md border border-white/10 max-h-[80vh] overflow-hidden flex flex-col">
            <h2 className="text-lg font-semibold mb-2">{t('social.add_to_sub_community_title', { username: memberUsername })}</h2>
            <p className="text-sm text-white/60 mb-4">{t('social.add_to_sub_community_hint')}</p>

            {subCommunityError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {subCommunityError}
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {loadingSubCommunities ? (
                <div className="text-center py-8 text-white/60">
                  <i className="fa-solid fa-spinner fa-spin text-xl mb-2" />
                  <div className="text-sm">{t('social.loading_sub_communities')}</div>
                </div>
              ) : subCommunities.length === 0 ? (
                <div className="text-center py-8 text-white/40">
                  <i className="fa-solid fa-folder-open text-2xl mb-2" />
                  <div className="text-sm">{t('social.no_available_sub_communities')}</div>
                  <div className="text-xs mt-1">{t('social.sub_communities_empty_hint')}</div>
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
              {t('common.close')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

