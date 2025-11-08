import { useEffect, useRef, useState } from 'react'
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
  // Parent-only creation; no parent selection
  // Removed parentsWithChildren usage in desktop since cards now route to unified communities page
  const [emailVerified, setEmailVerified] = useState<boolean|null>(null)
  const [showVerifyFirstModal, setShowVerifyFirstModal] = useState(false)
  const [communitiesLoaded, setCommunitiesLoaded] = useState(false)
  // Onboarding steps
  const [onbStep, setOnbStep] = useState<0|1|2|3|4|5>(0)
  const [displayName, setDisplayName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [username, setUsername] = useState('')
  const [subscription, setSubscription] = useState<string>('free')
  const [hasProfilePic, setHasProfilePic] = useState<boolean>(false)
  const [savingName, setSavingName] = useState(false)
  const [picFile, setPicFile] = useState<File | null>(null)
  const [picPreview, setPicPreview] = useState('')
  const [uploadingPic, setUploadingPic] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)
  const [showPremiumOnlyModal, setShowPremiumOnlyModal] = useState(false)
  const [emailVerifiedAt, setEmailVerifiedAt] = useState<string | null>(null)
  const [isRecentlyVerified, setIsRecentlyVerified] = useState(false)
  const onboardingTriggeredRef = useRef(false)  // Track if onboarding was already triggered
  const [joinedCommunityId, setJoinedCommunityId] = useState<number | null>(null)  // Track community joined during onboarding
  const [joinedCommunityName, setJoinedCommunityName] = useState<string | null>(null)  // Track community name
  const [showSuccessModal, setShowSuccessModal] = useState(false)  // Success modal for join
  const doneKey = username ? `onboarding_done:${username}` : 'onboarding_done'
  const { setTitle } = useHeader()
  useEffect(() => { setTitle('Dashboard') }, [setTitle])
  const navigate = useNavigate()

  function handleExitConfirm(){
    try { localStorage.setItem(doneKey, '1') } catch {}
    setOnbStep(0)
    setConfirmExit(false)
    onboardingTriggeredRef.current = false  // Reset so it can trigger again if flag is cleared
    window.location.href = '/premium_dashboard'
  }

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
          if (me?.success && me.profile){
            setEmailVerified(!!me.profile.email_verified)
            setEmailVerifiedAt(me.profile.email_verified_at || null)
            setUsername(me.profile.username || '')
            setFirstName(me.profile.first_name || '')
            setDisplayName(me.profile.display_name || me.profile.username)
            setSubscription((me.profile.subscription || 'free') as string)
            setHasProfilePic(!!me.profile.profile_picture)
          }
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
          // Direct fix: do not redirect here; welcome/join modal handles first-time case
        }
      } catch (error) {
        console.error('Error loading user data:', error)
        setHasGymAccess(false)
        setCommunities([])
      }
    }
    
    loadUserData()
  }, [])

  // Robust re-check after email verification: when tab regains focus or becomes visible
  useEffect(() => {
    let cancelled = false
    async function refresh(){
      try{
        const pr = await fetch('/api/profile_me', { credentials:'include' })
        const pj = await pr.json().catch(()=>null)
        if (cancelled) return
        if (pj?.success && pj.profile){
          setEmailVerified(!!pj.profile.email_verified)
          setEmailVerifiedAt(pj.profile.email_verified_at || null)
          setUsername(pj.profile.username || '')
          setDisplayName(pj.profile.display_name || pj.profile.username)
          setHasProfilePic(!!pj.profile.profile_picture)
        }
        // Also refresh communities snapshot
        const parentDataResp = await fetch('/api/user_parent_community', { credentials:'include' })
        const parentData = await parentDataResp.json().catch(()=>null)
        if (cancelled) return
        const fetchedCommunities = (parentData?.success && Array.isArray(parentData.communities)) ? parentData.communities : []
        setCommunities(fetchedCommunities)
        setCommunitiesLoaded(true)
      }catch{}
    }
    const onFocus = () => refresh()
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisibility) }
  }, [])

  // Check if user was recently verified (within last 24 hours)
  // This gives plenty of time for users to complete signup and reach dashboard
  useEffect(() => {
    if (!emailVerifiedAt || !emailVerified) {
      setIsRecentlyVerified(false)
      return
    }
    try {
      const verifiedTime = new Date(emailVerifiedAt).getTime()
      const now = Date.now()
      const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000) // 24 hours in milliseconds
      const isRecent = verifiedTime > twentyFourHoursAgo
      console.log('Onboarding check:', { emailVerifiedAt, verifiedTime, now, twentyFourHoursAgo, isRecent, diff: (now - verifiedTime) / 1000 + 's ago' })
      setIsRecentlyVerified(isRecent)
    } catch (err) {
      console.error('Error parsing email_verified_at:', err)
      setIsRecentlyVerified(false)
    }
  }, [emailVerifiedAt, emailVerified])

  // Auto-prompt onboarding for newly verified users with no communities/profile
  useEffect(() => {
    console.log('Onboarding trigger check:', { 
      communitiesLoaded, 
      emailVerified, 
      communitiesArray: Array.isArray(communities), 
      communitiesLength: communities?.length,
      username, 
      onbStep, 
      doneKey,
      doneValue: localStorage.getItem(doneKey),
      isRecentlyVerified,
      hasProfilePic,
      emailVerifiedAt,
      alreadyTriggered: onboardingTriggeredRef.current
    })
    
    // Don't re-trigger if we already triggered onboarding in this session
    if (onboardingTriggeredRef.current) return
    
    if (!communitiesLoaded) return
    if (emailVerified !== true) {
      console.log('Onboarding skipped: user not verified')
      return
    }
    if (!Array.isArray(communities)) return
    if (!username) return
    if (onbStep !== 0) return
    
    // Check if user has marked onboarding as done
    try{ if (localStorage.getItem(doneKey) === '1') {
      console.log('Onboarding skipped: already completed')
      return
    }}catch{}
    
    const hasNoCommunities = (communities || []).length === 0
    if (!hasNoCommunities || hasProfilePic){
      console.log('Onboarding not triggered:', { hasNoCommunities, hasProfilePic })
      return
    }
    
    // Trigger onboarding for verified users with no communities/profile who:
    // 1. Recently verified (within 24 hours) - primary path
    // 2. OR have no verification timestamp yet (legacy users or edge cases) - fallback
    if (isRecentlyVerified || !emailVerifiedAt) {
      console.log('🎉 Triggering onboarding flow!', isRecentlyVerified ? '(recently verified)' : '(no timestamp - legacy user)')
      onboardingTriggeredRef.current = true  // Mark as triggered
      setOnbStep(1)
    } else {
      console.log('Onboarding skipped: verified more than 24 hours ago')
    }
  }, [communitiesLoaded, emailVerified, communities, hasProfilePic, username, onbStep, doneKey, isRecentlyVerified, emailVerifiedAt])

  // Parent-only creation: skip loading parent communities


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
              <div className="px-3 py-10">
                <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
                  <div className="text-sm font-bold text-white">Your new world awaits you</div>
                  <div className="mt-2 text-sm text-[#9fb0b5]">
                    Enter an invite code to join a community or create your own. Welcome to CPoint, the network where ideas connect people.
                  </div>
                </div>
              </div>
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
          <button className="w-full text-left px-3 py-2 rounded-lg hover:bg:white/5 text-sm" onClick={()=> { setFabOpen(false); if ((subscription||'free').toLowerCase() !== 'premium') { setShowPremiumOnlyModal(true); return } setShowCreateModal(true) }}>Create Community</button>
            </div>
          )}
          <button className="w-14 h-14 rounded-full bg-[#4db6ac] text-black shadow-lg hover:brightness-110 grid place-items-center border border-[#4db6ac]" onClick={()=> setFabOpen(v=>!v)} aria-label="Actions">
            <i className="fa-solid fa-plus" />
          </button>
        </div>
      </div>

      {/* Onboarding Step 1: Welcome */}
      {onbStep === 1 && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
          <div className="w-[92%] max-w-md rounded-xl border border-white/10 bg-[#0b0f10] p-6">
            <div className="text-center">
              <div className="text-2xl font-bold mb-3">Welcome {firstName || 'to CPoint'}! 👋</div>
              <div className="text-sm text-[#9fb0b5] mb-6">
                Let's get you set up in just a few steps. This will only take a minute.
              </div>
              <button 
                className="w-full px-4 py-3 text-base rounded-lg bg-[#4db6ac] text-black font-semibold hover:brightness-110" 
                onClick={() => setOnbStep(2)}
              >
                Get Started
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding Step 2: Display Name */}
      {onbStep === 2 && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
          <div className="w-[92%] max-w-md rounded-xl border border-white/10 bg-[#0b0f10] p-5">
            <div className="text-lg font-semibold mb-2">Choose your display name</div>
            <div className="text-xs text-[#9fb0b5] mb-3">By default, your display name matches your username. You can change it now.</div>
            <input value={displayName} onChange={(e)=> setDisplayName(e.target.value)} className="w-full px-3 py-3 rounded-xl border border-white/10 bg-white/[0.04] focus:border-[#4db6ac] focus:outline-none" />
            <div className="mt-4 flex gap-2 justify-between">
              <div>
                <button className="px-3 py-2 text-sm rounded-lg border border-white/10 bg-white/[0.04]" onClick={()=> setOnbStep(1)}>Back</button>
              </div>
              <div className="flex gap-2">
              <button type="button" className="px-3 py-2 text-sm rounded-lg border border-white/10 bg-white/[0.04]" onClick={(e)=> { e.preventDefault(); setConfirmExit(true) }}>Exit</button>
              <button className="px-3 py-2 text-sm rounded-lg border border-white/10 bg-white/[0.04]" onClick={()=> setOnbStep(3)} disabled={savingName}>Skip</button>
              <button className="px-3 py-2 text-sm rounded-lg bg-[#4db6ac] text-black font-semibold" disabled={savingName} onClick={async()=>{
                try{
                  const fd = new FormData(); fd.append('display_name', displayName.trim())
                  const r = await fetch('/update_public_profile', { method:'POST', credentials:'include', body: fd })
                  if (!r.ok){ alert('Failed to save name'); return }
                  setOnbStep(3)
                }catch{ alert('Network error') } finally { setSavingName(false) }
              }}>{savingName ? 'Saving…' : 'Save & continue'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding Step 3: Profile Picture */}
      {onbStep === 3 && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
          <div className="w-[92%] max-w-md rounded-xl border border-white/10 bg-[#0b0f10] p-5">
            <div className="text-lg font-semibold mb-2">Add a profile picture</div>
            <div className="text-xs text-[#9fb0b5] mb-3">Help people recognize you. You can change this later in your profile.</div>
            <input type="file" accept="image/*" onChange={(e)=>{
              const f = e.target.files && e.target.files[0] ? e.target.files[0] : null
              setPicFile(f as any)
              if (f){ try{ setPicPreview(URL.createObjectURL(f)) }catch{ setPicPreview('') } }
            }} />
            {picPreview && (
              <div className="mt-3 flex items-center justify-center">
                <img src={picPreview} className="max-h-40 rounded-lg border border-white/10" />
              </div>
            )}
            <div className="mt-4 flex gap-2 justify-between">
              <div>
                <button className="px-3 py-2 text-sm rounded-lg border border-white/10 bg-white/[0.04]" onClick={()=> setOnbStep(2)} disabled={uploadingPic}>Back</button>
              </div>
              <div className="flex gap-2">
              <button type="button" className="px-3 py-2 text-sm rounded-lg border border-white/10 bg-white/[0.04]" onClick={(e)=> { e.preventDefault(); setConfirmExit(true) }} disabled={uploadingPic}>Exit</button>
              <button className="px-3 py-2 text-sm rounded-lg border border-white/10 bg-white/[0.04]" onClick={()=> setOnbStep(4)} disabled={uploadingPic}>Skip</button>
              <button className="px-3 py-2 text-sm rounded-lg bg-[#4db6ac] text-black font-semibold" disabled={uploadingPic || !picFile} onClick={async()=>{
                if (!picFile) return; setUploadingPic(true)
                try{
                  const fd = new FormData(); fd.append('profile_picture', picFile)
                  const r = await fetch('/upload_profile_picture', { method:'POST', credentials:'include', body: fd })
                  const j = await r.json().catch(()=>null)
                  if (!r.ok || !j?.success){ alert(j?.error || 'Failed to upload'); return }
                  setOnbStep(4)
                }catch{ alert('Network error') } finally { setUploadingPic(false) }
              }}>{uploadingPic ? 'Uploading…' : 'Upload & continue'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding Step 4: Create First Post (Join step removed) */}
      {onbStep === 4 && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
          <div className="w-[92%] max-w-md rounded-xl border border-white/10 bg-[#0b0f10] p-5">
            <div className="text-center mb-4">
              <div className="text-4xl mb-3">✍️</div>
              <div className="text-lg font-semibold mb-2">Create or React to Your First Post!</div>
              <div className="text-sm text-[#9fb0b5] mb-4">
                Welcome to {joinedCommunityName || 'your community'}! Share your thoughts, introduce yourself, or start a conversation.
              </div>
            </div>
            <div className="flex justify-between gap-2">
              <div>
                <button className="px-3 py-2 text-sm rounded-lg border border-white/10 bg-white/[0.04]" onClick={()=> setOnbStep(4)}>Back</button>
              </div>
              <div className="flex gap-2">
                <button className="px-3 py-2 text-sm rounded-lg border border-white/10 bg-white/[0.04]" onClick={handleExitConfirm}>Skip for now</button>
                <button className="px-3 py-2 text-sm rounded-lg bg-[#4db6ac] text-black font-semibold" onClick={()=> {
                  // Mark onboarding as complete and redirect to community feed
                  try { localStorage.setItem(doneKey, '1') } catch {}
                  if (joinedCommunityId) {
                    window.location.href = `/community_feed_react/${joinedCommunityId}?highlight_post=true`;
                  } else {
                    window.location.href = '/communities';
                  }
                }}>Go to Community</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Success Toast - Subtle notification */}
      {showSuccessModal && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-[60] pointer-events-none">
          <div className="px-6 py-3 rounded-full border border-[#4db6ac]/40 bg-black/90 backdrop-blur-sm shadow-lg animate-fade-in">
            <div className="text-sm font-medium text-white">
              Joined <span className="text-[#4db6ac]">{joinedCommunityName}</span>
            </div>
          </div>
        </div>
      )}

      {/* Global Exit confirmation modal (available on any step) */}
      {confirmExit && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && setConfirmExit(false)}>
          <div className="w-[92%] max-w-md rounded-xl border border-white/10 bg-[#0b0f10] p-5">
            <div className="text-base font-semibold mb-2">Exit onboarding?</div>
            <div className="text-xs text-[#9fb0b5] mb-4">You can update these details anytime later in your Profile page.</div>
            <div className="flex justify-end gap-2">
              <button type="button" className="px-3 py-2 text-sm rounded-lg border border-white/10 bg-white/[0.04]" onClick={()=> setConfirmExit(false)}>Cancel</button>
              <button type="button" className="px-3 py-2 text-sm rounded-lg bg-[#4db6ac] text-black font-semibold" onClick={handleExitConfirm}>Exit</button>
            </div>
          </div>
        </div>
      )}
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
                <label className="block text-xs text-[#9fb0b5] mb-1">Community Name (Parent)</label>
                <input value={newCommName} onChange={e=> setNewCommName(e.target.value)} placeholder="e.g., My Parent Community" className="w-full px-3 py-2 rounded-md bg-black border border:white/15 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[#9fb0b5] mb-1">Community Type</label>
                <select value={newCommType} onChange={e=> setNewCommType(e.target.value as any)} className="w-full px-3 py-2 rounded-md bg-black border border:white/15 text-sm">
                  <option value="Gym">Gym</option>
                  <option value="University">University</option>
                  <option value="General">General</option>
                </select>
              </div>
              {/* For parent-only creation: remove parent selector and always create top-level */}
              <div className="text-xs text-[#9fb0b5]">This will create a parent community.</div>
              <div className="flex items-center justify-end gap-2">
                <button className="px-3 py-2 rounded-md bg:white/10 hover:bg:white/15" onClick={()=> setShowCreateModal(false)}>Cancel</button>
                <button className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110" onClick={async()=> {
                  if (!newCommName.trim()) { alert('Please provide a name'); return }
                  try{
                    const fd = new URLSearchParams({ name: newCommName.trim(), type: newCommType })
                  // Force parent community creation: do not include parent_community_id
                    const r = await fetch('/create_community', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
                    const j = await r.json().catch(()=>null)
                    if (j?.success){
                      setShowCreateModal(false); setNewCommName('')
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
      {showPremiumOnlyModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && setShowPremiumOnlyModal(false)}>
          <div className="w-[92%] max-w-sm rounded-2xl border border-white/10 bg-[#0b0f10] p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-sm">Premium feature</div>
              <button className="p-2 rounded-md hover:bg:white/5" onClick={()=> setShowPremiumOnlyModal(false)} aria-label="Close"><i className="fa-solid fa-xmark"/></button>
            </div>
            <div className="text-sm text-[#9fb0b5] mb-3">Community creation is available for premium users only.</div>
            <div className="flex items-center justify-end gap-2">
              <button className="px-3 py-2 rounded-md bg:white/10 hover:bg:white/15 text-sm" onClick={()=> setShowPremiumOnlyModal(false)}>OK</button>
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
                    
                    if (j?.success){ 
                      setJoinedCommunityId(j.community_id);
                      setJoinedCommunityName(j.community_name || 'community');
                      setShowJoinModal(false); 
                      setJoinCode('');
                      setShowSuccessModal(true);
                    }
                    else alert(j?.error || 'Failed to join community')
                  }catch(err){ 
                    alert('Failed to join community') 
                  }
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

