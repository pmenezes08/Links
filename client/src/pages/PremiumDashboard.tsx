import { useEffect, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate } from 'react-router-dom'

// type Community = { id: number; name: string; type: string }

export default function PremiumDashboard() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [hasGymAccess, setHasGymAccess] = useState(false)
  const [communities, setCommunities] = useState<Array<{id: number, name: string, type: string}>>([])
  const [fabOpen, setFabOpen] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newCommName, setNewCommName] = useState('')
  const [newCommType, setNewCommType] = useState<'Gym'|'University'|'General'>('Gym')
  const [parentOptions, setParentOptions] = useState<Array<{ id:number; name:string; type?:string }>>([])
  const [selectedParentId, setSelectedParentId] = useState<string>('none')
  // Removed parentsWithChildren usage in desktop since cards now route to unified communities page
  const [emailVerified, setEmailVerified] = useState<boolean|null>(null)
  const [showVerifyFirstModal, setShowVerifyFirstModal] = useState(false)
  const [communitiesLoaded, setCommunitiesLoaded] = useState(false)
  const { setTitle } = useHeader()
  useEffect(() => { setTitle('Dashboard') }, [setTitle])
  const navigate = useNavigate()

  async function fetchJson(url: string){
    try{
      const r = await fetch(url, { credentials:'include' })
      const ct = r.headers.get('content-type')||''
      let bodyText = ''
      try{ bodyText = await r.clone().text() }catch{}
      if (!ct.includes('application/json')){
        try{ await fetch('/api/client_log', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ level:'error', type:'dashboard_fetch', url, status:r.status, ct, body: bodyText.slice(0,200) }) }) }catch{}
      }
      const data = await r.json()
      return data
    }catch(err:any){
      try{ await fetch('/api/client_log', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ level:'error', type:'dashboard_fetch_error', url, message: String(err) }) }) }catch{}
      return null
    }
  }

  useEffect(() => {
    async function loadUserData() {
      try {
        // Profile (email verification status)
        try{
          const r = await fetch('/api/profile_me', { credentials:'include' })
          if (r.status === 403){ navigate('/verify_required', { replace: true }); return }
          const me = await r.json().catch(()=>null)
          if (me?.success && me.profile){ setEmailVerified(!!me.profile.email_verified) }
        }catch{ setEmailVerified(null) }

        // Check gym membership
        const gymData = await fetchJson('/api/check_gym_membership')
        setHasGymAccess(gymData.hasGymAccess || false)

        // Get all user communities and decide using the fetched value (avoid stale state)
        const parentData = await fetchJson('/api/user_parent_community')
        console.log('Dashboard: Parent communities API response:', parentData)
        const fetchedCommunities = (parentData?.success && Array.isArray(parentData.communities)) ? parentData.communities : []
        if (fetchedCommunities.length > 0) {
          console.log('Dashboard: Setting communities:', fetchedCommunities)
          setCommunities(fetchedCommunities)
          setCommunitiesLoaded(true)
        } else {
          console.log('Dashboard: No communities found or API error')
          setCommunities([])
          setCommunitiesLoaded(true)
          // Redirect first-time users to onboarding if no communities
          navigate('/onboarding', { replace: true })
          return
        }
      } catch (error) {
        console.error('Error loading user data:', error)
        setHasGymAccess(false)
        setCommunities([])
      }
    }
    
    loadUserData()
  }, [])

  // Auto-prompt on first login: if user has no communities, show join; if not verified, show verify-first
  useEffect(() => {
    if (!communitiesLoaded) return
    if (emailVerified === null) return
    if (!Array.isArray(communities)) return
    const hasNoCommunities = (communities || []).length === 0
    if (!hasNoCommunities) return
    const k = 'welcome_join_prompt_shown'
    try{
      if (localStorage.getItem(k)) return
    }catch{}
    if (emailVerified === false){
      setShowVerifyFirstModal(true)
    } else {
      setShowJoinModal(true)
    }
    try{ localStorage.setItem(k, '1') }catch{}
  }, [communities, emailVerified])

  // Load available parent communities when opening create modal
  useEffect(() => {
    let mounted = true
    async function loadParents(){
      try{
        const r = await fetch('/get_available_parent_communities', { credentials:'include' })
        const j = await r.json().catch(()=>null)
        if (!mounted) return
        if (j?.success && Array.isArray(j.communities)){
          setParentOptions(j.communities)
        } else {
          setParentOptions([])
        }
      }catch{ setParentOptions([]) }
    }
    if (showCreateModal){
      setSelectedParentId('none')
      loadParents()
    }
    return () => { mounted = false }
  }, [showCreateModal])


  return (
    <div className="min-h-screen pt-14 bg-[#0b0f10] text-white">
      {/* Desktop sidebar */}
      <div className="fixed left-0 top-14 bottom-0 w-52 border-r border-[#333] bg-[#1a1a1a] hidden md:flex flex-col z-30">
        <div className="flex items-center h-14 px-2 border-b border-[#333]">
          <div className="text-white font-semibold text-base truncate pl-2">Dashboard</div>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/dashboard">Dashboard</a>
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/profile">Profile</a>
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/user_chat">Messages</a>
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/communities">Your Communities</a>
          {hasGymAccess && <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/your_sports">Your Sports</a>}
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/logout">Logout</a>
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/account_settings"><i className="fa-solid fa-cog mr-2" />Settings</a>
        </nav>
      </div>

      {/* page content starts below header via pt-14 */}

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="fixed top-14 left-0 right-0 z-40 border-t border-[#333] bg-[#1a1a1a] md:hidden">
          <nav className="flex flex-col">
            <a className="px-5 py-3 border-b border-[#222]" href="/dashboard" onClick={() => setMobileMenuOpen(false)}>Dashboard</a>
            <a className="px-5 py-3 border-b border-[#222]" href="/profile" onClick={() => setMobileMenuOpen(false)}>Profile</a>
            <a className="px-5 py-3 border-b border-[#222]" href="/user_chat" onClick={() => setMobileMenuOpen(false)}>Messages</a>
            <a className="px-5 py-3 border-b border-[#222]" href="/communities" onClick={() => setMobileMenuOpen(false)}>Your Communities</a>
            {hasGymAccess && <a className="px-5 py-3 border-b border-[#222]" href="/your_sports" onClick={() => setMobileMenuOpen(false)}>Your Sports</a>}
            <a className="px-5 py-3 border-b border-[#222]" href="/logout" onClick={() => setMobileMenuOpen(false)}>Logout</a>
            <a className="px-5 py-3" href="/account_settings" onClick={() => setMobileMenuOpen(false)}><i className="fa-solid fa-cog mr-2" />Settings</a>
          </nav>
        </div>
      )}

      <div className="">
        {/* Desktop profile summary (kept, but edit profile removed) */}
        <div className="hidden md:flex fixed right-5 top-20 w-44 h-44 rounded-lg border border-[#333] md:border-white/20 bg-[#1a1a1a] md:bg-white/5 flex-col items-center gap-2 p-3">
          <div className="w-20 h-20 rounded-full bg-white/5 border border-white/20 flex items-center justify-center">
            <i className="fa-solid fa-user text-2xl text-[#9fb0b5]" />
          </div>
          <div className="text-sm font-semibold truncate max-w-[10rem]">You</div>
        </div>

        {/* Cards grid */}
        <div className="flex items-start justify-center px-3 md:ml-52 py-6">
          <div className="w-full max-w-5xl">
            {communities.length === 0 ? (
              <div className="text-[#9fb0b5] text-sm px-2 py-8 text-center">No communities found.</div>
            ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Show all communities */}
              {communities.map(community => {
              // Desktop HTML communities page now provides the unified view
              const onCardClick = () => {
                navigate(`/communities?parent_id=${community.id}`)
              }
              return (
                <Card 
                  key={community.id}
                  iconClass="fa-solid fa-house" 
                  title={community.name} 
                  onClick={onCardClick} 
                />
              )
              })}
              {/* Shortcut: Product Development (pinned at bottom) */}
              <Card 
                iconClass="fa-solid fa-flask"
                title="Product Development"
                onClick={()=> navigate('/product_development')}
              />
            </div>
            )}
          </div>
        </div>

        {/* Floating Action Button */}
        <div className="fixed bottom-6 right-6 z-50">
          {fabOpen && (
            <div className="mb-2 rounded-xl border border-white/10 bg:black/80 backdrop-blur p-2 w-48 shadow-lg">
              <button className="w-full text-left px-3 py-2 rounded-lg hover:bg:white/5 text-sm" onClick={()=> { setFabOpen(false); setShowCreateModal(true) }}>Create Community</button>
              <button className="w-full text-left px-3 py-2 rounded-lg hover:bg:white/5 text-sm" onClick={()=> { setFabOpen(false); setShowJoinModal(true) }}>Join Community</button>
            </div>
          )}
          <button className="w-14 h-14 rounded-full bg-[#4db6ac] text-black shadow-lg hover:brightness-110 grid place-items-center border border-[#4db6ac]" onClick={()=> setFabOpen(v=>!v)} aria-label="Actions">
            <i className="fa-solid fa-plus" />
          </button>
        </div>
      </div>

      {/* Verify email first modal */}
      {showVerifyFirstModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && setShowVerifyFirstModal(false)}>
          <div className="w-[92%] max-w-sm rounded-2xl border border-white/10 bg-[#0b0f10] p-4">
            <div className="font-semibold text-sm mb-2">Verify your email</div>
            <div className="text-sm text-[#9fb0b5]">Please verify your email before joining a community.</div>
            <div className="flex items-center justify-end gap-2 mt-3">
              <button className="px-3 py-2 rounded-md bg:white/10 hover:bg:white/15" onClick={()=> setShowVerifyFirstModal(false)}>Close</button>
              <button className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110" onClick={async()=>{ try{ await fetch('/resend_verification', { method:'POST', credentials:'include' }) }catch{} alert('Verification email sent (if not rate limited).'); setShowVerifyFirstModal(false) }}>Resend email</button>
            </div>
          </div>
        </div>
      )}

      {/* Communities modal removed; button links to /communities */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && setShowCreateModal(false)}>
          <div className="w-[92%] max-w-sm rounded-2xl border border-white/10 bg-[#0b0f10] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-sm">Create Community</div>
              <button className="p-2 rounded-md hover:bg:white/5" onClick={()=> setShowCreateModal(false)} aria-label="Close"><i className="fa-solid fa-xmark"/></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[#9fb0b5] mb-1">Community Name</label>
                <input value={newCommName} onChange={e=> setNewCommName(e.target.value)} placeholder="e.g., My Gym" className="w-full px-3 py-2 rounded-md bg-black border border:white/15 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[#9fb0b5] mb-1">Community Type</label>
                <select value={newCommType} onChange={e=> setNewCommType(e.target.value as any)} className="w-full px-3 py-2 rounded-md bg-black border border:white/15 text-sm">
                  <option value="Gym">Gym</option>
                  <option value="University">University</option>
                  <option value="General">General</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#9fb0b5] mb-1">Parent Community (optional)</label>
                <select
                  value={selectedParentId}
                  onChange={(e)=> setSelectedParentId(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-black border border:white/15 text-sm"
                >
                  <option value="none">None</option>
                  {parentOptions.map(opt => (
                    <option key={opt.id} value={String(opt.id)}>{opt.name}{opt.type ? ` (${opt.type})` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button className="px-3 py-2 rounded-md bg:white/10 hover:bg:white/15" onClick={()=> setShowCreateModal(false)}>Cancel</button>
                <button className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110" onClick={async()=> {
                  if (!newCommName.trim()) { alert('Please provide a name'); return }
                  try{
                    const fd = new URLSearchParams({ name: newCommName.trim(), type: newCommType })
                    if (selectedParentId && selectedParentId !== 'none'){
                      fd.append('parent_community_id', selectedParentId)
                    }
                    const r = await fetch('/create_community', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
                    const j = await r.json().catch(()=>null)
                    if (j?.success){
                      setShowCreateModal(false); setNewCommName(''); setSelectedParentId('none')
                      // Refresh dashboard communities
                      const resp = await fetch('/api/user_parent_community', { method:'GET', credentials:'include' })
                      const data = await resp.json().catch(()=>null)
                      if (data?.success && data.communities) setCommunities(data.communities)
                    } else alert(j?.error || 'Failed to create community')
                  }catch{ alert('Failed to create community') }
                }}>Create</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && setShowJoinModal(false)}>
          <div className="w-[92%] max-w-sm rounded-2xl border border-white/10 bg-[#0b0f10] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-sm">Join Community</div>
              <button className="p-2 rounded-md hover:bg:white/5" onClick={()=> setShowJoinModal(false)} aria-label="Close"><i className="fa-solid fa-xmark"/></button>
            </div>
            <div className="space-y-3">
              <input value={joinCode} onChange={e=> setJoinCode(e.target.value)} placeholder="Enter community code" className="w-full px-3 py-2 rounded-md bg-black border border:white/15 text-sm" />
              <div className="flex items-center justify-end gap-2">
                <button className="px-3 py-2 rounded-md bg:white/10 hover:bg:white/15" onClick={()=> setShowJoinModal(false)}>Cancel</button>
                <button className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110" onClick={async()=> {
                  if (!joinCode.trim()) { alert('Please enter a code'); return }
                  // If not verified, gate join with verification
                  if (emailVerified === false){
                    setShowJoinModal(false)
                    setShowVerifyFirstModal(true)
                    return
                  }
                  try{
                    const fd = new URLSearchParams({ community_code: joinCode.trim() })
                    const r = await fetch('/join_community', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
                    const j = await r.json().catch(()=>null)
                    if (j?.success){ setShowJoinModal(false); setJoinCode(''); location.href = '/communities' }
                    else alert(j?.error || 'Failed to join community')
                  }catch{ alert('Failed to join community') }
                }}>Join</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Card({ iconClass, title, onClick }:{ iconClass:string; title:string; onClick:()=>void }){
  return (
    <button
      onClick={onClick}
      aria-label={title}
      className="group relative w-full h-40 rounded-2xl overflow-hidden text-white transition-all duration-300
                 bg-black border border-white/10 hover:border-teal-400/30
                 shadow-[0_10px_30px_rgba(0,0,0,0.4)] hover:shadow-[0_16px_40px_rgba(0,0,0,0.55)] hover:-translate-y-0.5"
    >
      {/* subtle glow on hover */}
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
           style={{ background: 'radial-gradient(600px circle at var(--x,50%) var(--y,50%), rgba(77,182,172,0.10), transparent 40%)' }} />

      <div className="absolute inset-0 flex flex-row items-center justify-start gap-3 px-6">
        <i className={iconClass} style={{ fontSize: 24, color: '#4db6ac' }} />
        <div className="text-[15px] font-semibold tracking-tight text-white/90">{title}</div>
      </div>

      {/* top accent line */}
      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-teal-400/40 to-transparent opacity-60" />
    </button>
  )
}

