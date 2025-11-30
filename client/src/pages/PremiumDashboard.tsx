import { useEffect, useRef, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate } from 'react-router-dom'
import { readDeviceCache, writeDeviceCache } from '../utils/deviceCache'

const PENDING_INVITE_KEY = 'cpoint_pending_invite'
const ONBOARDING_PROFILE_HINT_KEY = 'cpoint_onboarding_profile_hint'
const ONBOARDING_RESUME_KEY = 'cpoint_onboarding_resume_step'
const DASHBOARD_DEVICE_CACHE_KEY = 'dashboard-device-cache'
const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000

type DashboardCachePayload = {
  profile: {
    emailVerified: boolean | null
    emailVerifiedAt: string | null
    username: string
    firstName: string
    displayName: string
    subscription: string
    hasProfilePic: boolean
    existingProfilePic: string
  }
  communities: Array<{ id: number; name: string; type: string }>
  hasGymAccess: boolean
  isAppAdmin: boolean
}

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
  const [newCommType, setNewCommType] = useState<'Gym'|'University'|'General'|'Business'>('General')
  const [isAppAdmin, setIsAppAdmin] = useState(false)
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
  const [existingProfilePic, setExistingProfilePic] = useState<string>('')
  const [savingName, setSavingName] = useState(false)
  const [picFile, setPicFile] = useState<File | null>(null)
  const [picPreview, setPicPreview] = useState('')
  const [uploadingPic, setUploadingPic] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)
  const [emailVerifiedAt, setEmailVerifiedAt] = useState<string | null>(null)
  const [isRecentlyVerified, setIsRecentlyVerified] = useState(false)
  const onboardingTriggeredRef = useRef(false)  // Track if onboarding was already triggered
  const [joinedCommunityName, setJoinedCommunityName] = useState<string | null>(null)
  const [joinedCommunityId, setJoinedCommunityId] = useState<number | null>(null)
  const [pendingInviteTarget, setPendingInviteTarget] = useState<{ communityId: number; communityName?: string | null } | null>(null)
  const [showSuccessModal, setShowSuccessModal] = useState(false)  // Success modal for join
  const doneKey = username ? `onboarding_done:${username}` : 'onboarding_done'
  const { setTitle } = useHeader()
  useEffect(() => { setTitle('Dashboard') }, [setTitle])
  const navigate = useNavigate()
  const isPremium = (subscription || 'free').toLowerCase() === 'premium'
  const handleCloseCreateModal = () => {
    setShowCreateModal(false)
    setNewCommName('')
    setNewCommType('General')
  }

  const storePendingInviteTarget = (info: { communityId?: number | null; communityName?: string | null }) => {
    if (!info?.communityId) return
    setPendingInviteTarget({ communityId: Number(info.communityId), communityName: info.communityName ?? null })
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(
          PENDING_INVITE_KEY,
          JSON.stringify({ communityId: Number(info.communityId), communityName: info.communityName ?? null }),
        )
      }
    } catch {}
  }

  useEffect(() => {
    const cached = readDeviceCache<DashboardCachePayload>(DASHBOARD_DEVICE_CACHE_KEY)
    if (!cached) return
    if (cached.profile) {
      setEmailVerified(cached.profile.emailVerified)
      setEmailVerifiedAt(cached.profile.emailVerifiedAt)
      setUsername(cached.profile.username)
      setFirstName(cached.profile.firstName)
      setDisplayName(cached.profile.displayName)
      setSubscription(cached.profile.subscription || 'free')
      setHasProfilePic(cached.profile.hasProfilePic)
      setExistingProfilePic(cached.profile.existingProfilePic || '')
      setPicPreview(prev => prev || cached.profile.existingProfilePic || '')
    }
    if (Array.isArray(cached.communities)) {
      setCommunities(cached.communities)
      setCommunitiesLoaded(true)
    }
    setHasGymAccess(!!cached.hasGymAccess)
    setIsAppAdmin(!!cached.isAppAdmin)
  }, [])

  const clearPendingInviteTarget = () => {
    setPendingInviteTarget(null)
    setJoinedCommunityId(null)
    try {
      if (typeof window !== 'undefined') sessionStorage.removeItem(PENDING_INVITE_KEY)
    } catch {}
  }

  const clearOnboardingProfileHint = () => {
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(ONBOARDING_PROFILE_HINT_KEY)
        sessionStorage.removeItem(ONBOARDING_RESUME_KEY)
      }
    } catch {}
  }

  const resolveAvatar = (value?: string | null) => {
    if (!value) return ''
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (trimmed.startsWith('http')) return trimmed
    if (trimmed.startsWith('/uploads') || trimmed.startsWith('/static')) return trimmed
    if (trimmed.startsWith('uploads') || trimmed.startsWith('static')) return `/${trimmed}`
    return `/uploads/${trimmed}`
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = sessionStorage.getItem(PENDING_INVITE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed?.communityId) {
          setPendingInviteTarget({
            communityId: Number(parsed.communityId),
            communityName: parsed.communityName ?? null,
          })
        }
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const resume = sessionStorage.getItem(ONBOARDING_RESUME_KEY)
      if (resume) {
        sessionStorage.removeItem(ONBOARDING_RESUME_KEY)
        const stepNumber = Number(resume)
        if ([1, 2, 3, 4, 5].includes(stepNumber)) {
          onboardingTriggeredRef.current = true
          setOnbStep(stepNumber as 0 | 1 | 2 | 3 | 4 | 5)
        }
      }
    } catch {}
  }, [])

  function handleExitConfirm(){
    try { localStorage.setItem(doneKey, '1') } catch {}
    clearPendingInviteTarget()
    clearOnboardingProfileHint()
    setOnbStep(0)
    setConfirmExit(false)
    onboardingTriggeredRef.current = false  // Reset so it can trigger again if flag is cleared
    window.location.href = '/premium_dashboard'
  }

  const handleGoToCommunity = () => {
    try { localStorage.setItem(doneKey, '1') } catch {}
    const fallbackCommunityId = communities[0]?.id
    const targetId = pendingInviteTarget?.communityId ?? joinedCommunityId ?? (fallbackCommunityId ?? null)
    clearOnboardingProfileHint()
    clearPendingInviteTarget()
    if (targetId) {
      window.location.href = `/community_feed_react/${targetId}`
      return
    }
    window.location.href = '/premium_dashboard'
  }

  const handleOpenProfile = () => {
    const profileUrl = '/profile'
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(ONBOARDING_PROFILE_HINT_KEY, '1')
        sessionStorage.setItem(ONBOARDING_RESUME_KEY, '4')
      }
      const newTab = window.open(profileUrl, '_blank', 'noopener')
      if (!newTab) window.location.href = profileUrl
    } catch {
      window.location.href = profileUrl
    }
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
      let profileSnapshot: DashboardCachePayload['profile'] | null = null
      let cachedCommunities: Array<{ id: number; name: string; type: string }> = []
      let hasGymAccessFlag = false
      let isAdminFlag = false
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
            const profilePicValue = me.profile.profile_picture || null
            const resolvedPic = resolveAvatar(profilePicValue)
            setHasProfilePic(!!profilePicValue)
            setExistingProfilePic(resolvedPic)
            setPicPreview(prev => prev || resolvedPic)
            setSubscription((me.profile.subscription || 'free') as string)
            profileSnapshot = {
              emailVerified: !!me.profile.email_verified,
              emailVerifiedAt: me.profile.email_verified_at || null,
              username: me.profile.username || '',
              firstName: me.profile.first_name || '',
              displayName: me.profile.display_name || me.profile.username || '',
              subscription: (me.profile.subscription || 'free') as string,
              hasProfilePic: !!profilePicValue,
              existingProfilePic: resolvedPic,
            }
          }
        }catch{ setEmailVerified(null) }

        // Check gym membership
        const gymData = await fetchJson('/api/check_gym_membership')
        hasGymAccessFlag = !!(gymData?.hasGymAccess)
        setHasGymAccess(hasGymAccessFlag)
        
        // Check if user is app admin
        try {
          const adminCheck = await fetchJson('/api/check_admin')
          isAdminFlag = !!(adminCheck?.is_admin)
          setIsAppAdmin(isAdminFlag)
        } catch {
          setIsAppAdmin(false)
          isAdminFlag = false
        }

        // Get all user communities and decide using the fetched value (avoid stale state)
        const parentData = await fetchJson('/api/user_parent_community')
        console.log('Dashboard: Parent communities API response:', parentData)
        const resolvedCommunities = (parentData?.success && Array.isArray(parentData.communities)) ? parentData.communities : []
        cachedCommunities = resolvedCommunities
        if (resolvedCommunities.length > 0) {
          console.log('Dashboard: Setting communities:', resolvedCommunities)
          setCommunities(resolvedCommunities)
          setCommunitiesLoaded(true)
        } else {
          console.log('Dashboard: No communities found or API error')
          setCommunities([])
          setCommunitiesLoaded(true)
          // Direct fix: do not redirect here; welcome/join modal handles first-time case
        }

        if (profileSnapshot) {
          writeDeviceCache(
            DASHBOARD_DEVICE_CACHE_KEY,
            {
              profile: profileSnapshot,
              communities: cachedCommunities,
              hasGymAccess: hasGymAccessFlag,
              isAppAdmin: isAdminFlag,
            },
            DASHBOARD_CACHE_TTL_MS
          )
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
          const profilePicValue = pj.profile.profile_picture || null
          const resolvedPic = resolveAvatar(profilePicValue)
          setHasProfilePic(!!profilePicValue)
          setExistingProfilePic(resolvedPic)
          setPicPreview(prev => prev || resolvedPic)
          setSubscription((pj.profile.subscription || 'free') as string)
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
    
    // Trigger onboarding for first-time users (no profile pic yet) who were recently verified
    // NOTE: Invited users may already have communities, so we check profile pic instead
    if (hasProfilePic){
      console.log('Onboarding not triggered: user already has profile pic')
      return
    }
    
    // Trigger onboarding for verified users without profile who:
    // 1. Recently verified (within 24 hours) - primary path (includes invited users)
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


  const hasAnyCommunity = communities.length > 0
  const resolvedCommunityName = (() => {
    if (pendingInviteTarget?.communityName) return pendingInviteTarget.communityName
    if (joinedCommunityName) return joinedCommunityName
    const targetId = pendingInviteTarget?.communityId ?? joinedCommunityId
    if (targetId) {
      const found = communities.find(c => c.id === targetId)
      if (found?.name) return found.name
    }
    return communities[0]?.name || 'your community'
  })()
  const profilePreviewSrc = picPreview || existingProfilePic

    return (
      <div className="app-content min-h-screen chat-thread-bg text-white pb-safe relative">
      {/* Desktop sidebar - same menu as mobile burger */}
      <div className="fixed left-0 top-14 bottom-0 w-52 hidden md:flex flex-col z-30 liquid-glass-surface border border-white/10 rounded-r-3xl shadow-[0_10px_40px_rgba(0,0,0,0.45)]">
        <nav className="flex-1 overflow-y-auto py-3">
          <a className="block px-5 py-3 text-sm text-white hover:bg-teal-700/20 hover:text-teal-300" href="/premium_dashboard">Dashboard</a>
          <a className="block px-5 py-3 text-sm text-white hover:bg-teal-700/20 hover:text-teal-300" href="/profile">Profile</a>
          <a className="block px-5 py-3 text-sm text-white hover:bg-teal-700/20 hover:text-teal-300" href="/user_chat">Messages</a>
          <a className="block px-5 py-3 text-sm text-white hover:bg-teal-700/20 hover:text-teal-300" href="/followers">Followers</a>
          {hasGymAccess && <a className="block px-5 py-3 text-sm text-white hover:bg-teal-700/20 hover:text-teal-300" href="/your_sports">Your Sports</a>}
          <a className="block px-5 py-3 text-sm text-white hover:bg-teal-700/20 hover:text-teal-300" href="/logout">Logout</a>
          <a className="block px-5 py-3 text-sm text-white hover:bg-teal-700/20 hover:text-teal-300" href="/account_settings">
            <i className="fa-solid fa-cog mr-2" />Settings
          </a>
        </nav>
        {!isPremium && (
          <div className="p-4 border-t border-[#333]">
            <button
              type="button"
              className="w-full rounded-lg bg-gradient-to-r from-teal-400 to-teal-500 px-4 py-2.5 text-sm font-semibold text-white hover:from-teal-500 hover:to-teal-600 transition"
              onClick={() => navigate('/subscription_plans')}
            >
              Upgrade to Premium
            </button>
          </div>
        )}
      </div>

      {/* page content starts below header via pt-14 */}

      {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="fixed top-14 left-0 right-0 bottom-0 z-40 md:hidden flex flex-col px-3">
            <nav className="flex-1 overflow-y-auto flex flex-col liquid-glass-surface border border-white/10 rounded-3xl mt-3">
              <a className="px-5 py-3 border-b border-white/10" href="/dashboard" onClick={() => setMobileMenuOpen(false)}>Dashboard</a>
              <a className="px-5 py-3 border-b border-white/10" href="/profile" onClick={() => setMobileMenuOpen(false)}>Profile</a>
                <a className="px-5 py-3 border-b border-white/10" href="/user_chat" onClick={() => setMobileMenuOpen(false)}>Messages</a>
                <a className="px-5 py-3 border-b border-white/10" href="/followers" onClick={() => setMobileMenuOpen(false)}>Followers</a>
              {hasGymAccess && <a className="px-5 py-3 border-b border-white/10" href="/your_sports" onClick={() => setMobileMenuOpen(false)}>Your Sports</a>}
              <a className="px-5 py-3 border-b border-white/10" href="/logout" onClick={() => setMobileMenuOpen(false)}>Logout</a>
              <a className="px-5 py-3" href="/account_settings" onClick={() => setMobileMenuOpen(false)}><i className="fa-solid fa-cog mr-2" />Settings</a>
            </nav>
            <div className="px-4 py-4">
              <button
                type="button"
                  className="w-full rounded-2xl liquid-glass-chip border border-[#4db6ac]/30 px-4 py-3 text-sm font-semibold text-teal-50 tracking-[0.2em] uppercase shadow-[0_15px_35px_rgba(0,0,0,0.4)] hover:shadow-[0_20px_45px_rgba(0,0,0,0.55)] transition"
                onClick={() => {
                  setMobileMenuOpen(false)
                  navigate('/subscription_plans')
                }}
              >
                Premium
              </button>
            </div>
          </div>
        )}

      {/* Main content area with proper positioning */}
      <div className="min-h-screen md:ml-52 pb-20">
        <div className="app-content max-w-5xl mx-auto px-3 py-6">
            {communities.length === 0 ? (
              <div className="px-3 py-10">
                <div className="mx-auto max-w-xl liquid-glass-surface border border-white/10 rounded-2xl p-6 text-center shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
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

        {/* Floating Action Button */}
        <div className="fixed bottom-6 right-6 z-50">
          {fabOpen && (
            <div className="mb-2 rounded-xl border border-white/10 bg:black/80 backdrop-blur p-2 w-48 shadow-lg">
            <button className="w-full text-left px-3 py-2 rounded-lg hover:bg:white/5 text-sm" onClick={()=> { setFabOpen(false); setNewCommType('General'); setShowCreateModal(true) }}>Create Community</button>
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
          <div className="w-[92%] max-w-md rounded-xl border border-white/10 bg-black p-6">
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
          <div className="w-[92%] max-w-md rounded-xl border border-white/10 bg-black p-5">
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
          <div className="w-[92%] max-w-md rounded-xl border border-white/10 bg-black p-5">
            <div className="text-lg font-semibold mb-2">Add a profile picture</div>
            <div className="text-xs text-[#9fb0b5] mb-3">Help people recognize you. You can change this later in your profile.</div>
            <input type="file" accept="image/*" onChange={(e)=>{
              const f = e.target.files && e.target.files[0] ? e.target.files[0] : null
              setPicFile(f as any)
              if (f){ try{ setPicPreview(URL.createObjectURL(f)) }catch{ setPicPreview('') } }
            }} />
            {profilePreviewSrc && (
              <div className="mt-3 flex items-center justify-center">
                <img src={profilePreviewSrc} className="max-h-40 rounded-lg border border-white/10" />
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
                  if (picPreview && picPreview.startsWith('blob:')){
                    try { URL.revokeObjectURL(picPreview) } catch {}
                  }
                  const uploadedPath = resolveAvatar(j?.profile_picture || j?.path || j?.url || '')
                  if (uploadedPath){
                    // Add cache-busting timestamp to force avatar refresh across the app
                    const cacheBustedUrl = `${uploadedPath}?v=${Date.now()}`
                    setExistingProfilePic(cacheBustedUrl)
                    setPicPreview(cacheBustedUrl)
                  }
                  setHasProfilePic(true)
                  setPicFile(null)
                  setOnbStep(4)
                }catch{ alert('Network error') } finally { setUploadingPic(false) }
              }}>{uploadingPic ? 'Uploading…' : 'Upload & continue'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

        {/* Onboarding Step 4: Complete Profile */}
        {onbStep === 4 && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
            <div className="w-[92%] max-w-md rounded-xl border border-white/10 bg-black p-5">
              <div className="text-center mb-4">
                <div className="text-4xl mb-3">👤</div>
                <div className="text-lg font-semibold mb-2">Fill out your profile</div>
                <div className="text-sm text-[#9fb0b5] mb-4">
                  Keep your personal and professional details up to date so the right people can connect with you.
                </div>
              </div>
              <div className="space-y-3">
                  <button
                    className="w-full px-4 py-3 text-sm rounded-lg bg-[#4db6ac] text-black font-semibold hover:brightness-110 transition"
                    onClick={handleOpenProfile}
                  >
                  Open My Profile in a new tab
                </button>
                <div className="text-xs text-[#9fb0b5] text-center">
                  Update your bio, professional information, and personal interests. You can return here when you’re done.
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 justify-between">
                <button
                  className="px-3 py-2 text-sm rounded-lg border border-white/10 bg-white/[0.04]"
                  onClick={() => setOnbStep(3)}
                >
                  Back
                </button>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-2 text-sm rounded-lg border border-white/10 bg-white/[0.04]"
                    onClick={(e) => { e.preventDefault(); setConfirmExit(true) }}
                  >
                    Exit
                  </button>
                    <button
                      className="px-3 py-2 text-sm rounded-lg bg-[#4db6ac] text-black font-semibold"
                      onClick={() => {
                        clearOnboardingProfileHint()
                        setOnbStep(5)
                      }}
                    >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Onboarding Step 5: Final action */}
        {onbStep === 5 && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
            <div className="w-[92%] max-w-md rounded-xl border border-white/10 bg-black p-5">
              {hasAnyCommunity ? (
                <>
                  <div className="text-center mb-4">
                    <div className="text-4xl mb-3">✍️</div>
                      <div className="text-lg font-semibold mb-2">Create or React to Your First Post!</div>
                      <div className="text-sm text-[#9fb0b5] mb-4">
                        Welcome to {resolvedCommunityName}! Share your thoughts, introduce yourself, or start a conversation.
                      </div>
                  </div>
                  <div className="flex justify-between gap-2">
                    <div>
                      <button className="px-3 py-2 text-sm rounded-lg border border-white/10 bg-white/[0.04]" onClick={()=> setOnbStep(4)}>Back</button>
                    </div>
                    <div className="flex gap-2">
                      <button className="px-3 py-2 text-sm rounded-lg border border-white/10 bg-white/[0.04]" onClick={handleExitConfirm}>Skip for now</button>
                        <button
                          className="px-3 py-2 text-sm rounded-lg bg-[#4db6ac] text-black font-semibold"
                          onClick={handleGoToCommunity}
                        >
                        Go to Community
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-center mb-4">
                    <div className="text-4xl mb-3">🏗️</div>
                    <div className="text-lg font-semibold mb-2">Create your first community</div>
                    <div className="text-sm text-[#9fb0b5] mb-4">
                      You're all set. Launch a parent community to bring everyone together.
                    </div>
                  </div>
                  <div className="flex justify-between gap-2">
                    <div>
                      <button className="px-3 py-2 text-sm rounded-lg border border-white/10 bg-white/[0.04]" onClick={()=> setOnbStep(4)}>Back</button>
                    </div>
                    <div className="flex gap-2">
                      <button className="px-3 py-2 text-sm rounded-lg border border-white/10 bg-white/[0.04]" onClick={handleExitConfirm}>Skip for now</button>
                      <button
                        className="px-3 py-2 text-sm rounded-lg bg-[#4db6ac] text-black font-semibold"
                        onClick={() => {
                            clearPendingInviteTarget()
                            clearOnboardingProfileHint()
                          setFabOpen(false)
                          setShowCreateModal(true)
                          setOnbStep(0)
                        }}
                      >
                        Create community
                      </button>
                    </div>
                  </div>
                </>
              )}
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
          <div className="w-[92%] max-w-md rounded-xl border border-white/10 bg-black p-5">
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
          <div className="w-[92%] max-w-sm rounded-2xl border border-white/10 bg-black p-4">
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
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> { if (e.currentTarget===e.target) handleCloseCreateModal() }}>
          <div className="w-[92%] max-w-sm rounded-2xl border border-white/10 bg-black p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-sm">Create Community</div>
                <button className="p-2 rounded-md hover:bg:white/5" onClick={handleCloseCreateModal} aria-label="Close"><i className="fa-solid fa-xmark"/></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[#9fb0b5] mb-1">Community Name (Parent)</label>
                <input value={newCommName} onChange={e=> setNewCommName(e.target.value)} placeholder="e.g., My Parent Community" className="w-full px-3 py-2 rounded-md bg-black border border:white/15 text-sm" />
              </div>
                <div>
                  <label className="block text-xs text-[#9fb0b5] mb-1">Community Type</label>
                  <select value={newCommType} onChange={e=> setNewCommType(e.target.value as any)} className="w-full px-3 py-2 rounded-md bg-black border border:white/15 text-sm">
                    <option value="General">General</option>
                    {isPremium && (
                      <>
                        <option value="Gym">Gym</option>
                        <option value="University">University</option>
                        {isAppAdmin && <option value="Business">Business</option>}
                      </>
                    )}
                  </select>
                </div>
              {/* For parent-only creation: remove parent selector and always create top-level */}
              <div className="text-xs text-[#9fb0b5]">This will create a parent community.</div>
                <div className="flex items-center justify-end gap-2">
                  <button className="px-3 py-2 rounded-md bg:white/10 hover:bg:white/15" onClick={handleCloseCreateModal}>Cancel</button>
                    <button className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110" onClick={async()=> {
                  if (!newCommName.trim()) { alert('Please provide a name'); return }
                  try{
                      const fd = new URLSearchParams({ name: newCommName.trim(), type: newCommType })
                  // Force parent community creation: do not include parent_community_id
                    const r = await fetch('/create_community', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
                    const j = await r.json().catch(()=>null)
                      if (j?.success){
                        handleCloseCreateModal()
                        try { localStorage.setItem(doneKey, '1') } catch {}
                        setOnbStep(0)
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
          <div className="w-[92%] max-w-sm rounded-2xl border border-white/10 bg-black p-4">
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
                        setJoinedCommunityName(j.community_name || 'community')
                        setJoinedCommunityId(j.community_id ?? null)
                        storePendingInviteTarget({ communityId: j.community_id ?? null, communityName: j.community_name ?? null })
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
      className="group relative w-full h-40 rounded-2xl overflow-hidden text-white transition-all duration-300 liquid-glass-surface border border-white/15 hover:border-teal-400/40 shadow-[0_20px_50px_rgba(0,0,0,0.45)] hover:shadow-[0_30px_60px_rgba(0,0,0,0.55)] hover:-translate-y-0.5"
    >
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
           style={{ background: 'radial-gradient(600px circle at var(--x,50%) var(--y,50%), rgba(77,182,172,0.18), transparent 45%)' }} />

      <div className="absolute inset-0 flex flex-row items-center justify-start gap-3 px-6">
        <i className={iconClass} style={{ fontSize: 24, color: '#7fe7df' }} />
        <div className="text-[15px] font-semibold tracking-tight text-white/90">{title}</div>
      </div>

      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-teal-300/60 to-transparent opacity-80" />
    </button>
  )
}

