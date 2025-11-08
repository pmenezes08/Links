import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'

type Member = {
  username: string;
  profile_picture?: string | null;
  role?: 'member'|'admin'|'owner'|'creator';
  is_creator?: boolean;
}

export default function Members(){
  const { community_id } = useParams()
  const navigate = useNavigate()
  const [members, setMembers] = useState<Member[]>([])
  const [communityName, setCommunityName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [ownerUsername, setOwnerUsername] = useState<string>('')
  const [currentUserRole, setCurrentUserRole] = useState<'member'|'admin'|'owner'|'app_admin'>('member')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [showQRCode, setShowQRCode] = useState(false)
  const [qrCodeUrl, setQRCodeUrl] = useState('')

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

    setInviteLoading(true)
    setInviteError('')
    setInviteSuccess(false)

    try {
      const response = await fetch('/api/community/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          community_id: Number(community_id),
          email: inviteEmail 
        })
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setInviteSuccess(true)
        setInviteEmail('')
        setTimeout(() => {
          setShowInviteModal(false)
          setInviteSuccess(false)
        }, 2000)
      } else {
        setInviteError(data.error || 'Failed to send invitation')
      }
    } catch (error) {
      console.error('Error sending invitation:', error)
      setInviteError('Failed to send invitation')
    } finally {
      setInviteLoading(false)
    }
  }

  async function handleGenerateQR() {
    setInviteLoading(true)
    setInviteError('')
    
    try {
      const response = await fetch('/api/community/invite_link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ community_id: Number(community_id) })
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setQRCodeUrl(data.invite_url)
        setShowQRCode(true)
      } else {
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
    <div className="min-h-screen bg-black text-white">
      <div className="fixed left-0 right-0 top-14 h-12 border-b border-white/10 bg-black/70 backdrop-blur flex items-center px-3 z-40">
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
          {canManage && (
            <button
              onClick={() => setShowInviteModal(true)}
              className="px-3 py-1.5 bg-[#4db6ac] text-black rounded-lg text-xs font-medium hover:bg-[#45a099]"
            >
              <i className="fa-solid fa-envelope mr-1.5" />
              Invite
            </button>
          )}
        </div>
      </div>
      <div className="max-w-2xl mx-auto pt-28 px-3 pb-6">
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
                <Avatar username={m.username} url={m.profile_picture || undefined} size={36} />
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
      {showInviteModal && !showQRCode && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] rounded-xl p-6 w-full max-w-md border border-white/10">
            <h2 className="text-lg font-semibold mb-2">Invite to {communityName || 'Community'}</h2>
            <p className="text-sm text-white/60 mb-4">Choose how you want to invite members</p>

            {inviteSuccess && (
              <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
                Invitation sent successfully!
              </div>
            )}

            {inviteError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {inviteError}
              </div>
            )}

            <div className="space-y-3">
              {/* Email Invitation */}
              <div>
                <label className="block text-xs text-white/60 mb-2">Send invitation via email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-sm text-white placeholder-white/50 focus:border-[#4db6ac] focus:outline-none"
                  disabled={inviteLoading || inviteSuccess}
                />
                <button
                  onClick={handleSendInvite}
                  className="w-full mt-2 px-4 py-2 bg-[#4db6ac] text-black rounded-lg text-sm font-medium hover:bg-[#45a099] disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={inviteLoading || inviteSuccess || !inviteEmail.trim()}
                >
                  {inviteLoading ? 'Sending...' : 'Send Email Invite'}
                </button>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/10"></div>
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-2 bg-[#1a1a1a] text-white/40">OR</span>
                </div>
              </div>

              {/* QR Code */}
              <div>
                <label className="block text-xs text-white/60 mb-2">Share via QR code</label>
                <button
                  onClick={handleGenerateQR}
                  className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-lg text-sm font-medium hover:bg-white/10 disabled:opacity-50"
                  disabled={inviteLoading}
                >
                  <i className="fa-solid fa-qrcode mr-2" />
                  Generate QR Code
                </button>
              </div>
            </div>

            <div className="mt-4">
              <button
                onClick={() => setShowInviteModal(false)}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-medium hover:bg-white/10"
                disabled={inviteLoading}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {showQRCode && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] rounded-xl p-6 w-full max-w-md border border-white/10">
            <h2 className="text-lg font-semibold mb-2">QR Code Invitation</h2>
            <p className="text-sm text-white/60 mb-4">Scan this QR code to join {communityName || 'the community'}</p>

            <div className="bg-white p-6 rounded-xl mb-4 flex justify-center">
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCodeUrl)}`}
                alt="Invitation QR Code"
                className="w-64 h-64"
              />
            </div>

            <div className="text-xs text-white/40 mb-4 text-center break-all">
              {qrCodeUrl}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowQRCode(false)
                  setShowInviteModal(true)
                }}
                className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-medium hover:bg-white/10"
              >
                Back
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(qrCodeUrl)
                  alert('Link copied to clipboard!')
                }}
                className="flex-1 px-4 py-2 bg-[#4db6ac] text-black rounded-lg text-sm font-medium hover:bg-[#45a099]"
              >
                Copy Link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


function MemberActions({ memberRole, onPromote, onDemote, onTransfer, onRemove }:{ memberRole: string, onPromote: ()=>void, onDemote: ()=>void, onTransfer?: ()=>void, onRemove: ()=>void }){
  const [open, setOpen] = useState(false)
  const isAdmin = memberRole === 'admin'
  const isMember = memberRole === 'member'
  
  return (
    <div className="relative" onClick={(e)=> e.stopPropagation()}>
      <button className="px-2 py-1 rounded-md border border-white/10 text-xs text-[#cfd8dc] hover:bg-white/5" onClick={()=> setOpen(v=>!v)} aria-expanded={open} aria-haspopup="menu">
        Manage
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-40 rounded-md border border-white/10 bg-black shadow-lg z-20">
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
          <button className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 text-red-400" onClick={()=> { setOpen(false); onRemove() }}>Remove member</button>
        </div>
      )}
    </div>
  )
}

