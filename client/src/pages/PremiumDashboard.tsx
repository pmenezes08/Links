import { useCallback, useEffect, useRef, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { useUserProfile } from '../contexts/UserProfileContext'
import { useLocation, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { readDeviceCacheStale, writeDeviceCache } from '../utils/deviceCache'
import { cacheKeyVal, deleteCachedKeyVal, getCachedKeyVal } from '../utils/offlineDb'
import {
  DASHBOARD_CACHE_TTL_MS,
  DASHBOARD_CACHE_VERSION,
  DASHBOARD_DEVICE_CACHE_KEY,
  invalidateDashboardCache,
  refreshDashboardCommunities,
} from '../utils/dashboardCache'
import type { DashboardCachePayload } from '../utils/dashboardCache'
import { triggerDashboardServerPull } from '../utils/serverPull'
import { useLogoutRequest } from '../contexts/LogoutPromptContext'
import OnboardingChat from './OnboardingChat'
import OnboardingIntroGate from '../components/onboarding/OnboardingIntroGate'
import DashboardBottomNav, { isPremiumDashboardPath } from '../components/DashboardBottomNav'

const PENDING_INVITE_KEY = 'cpoint_pending_invite'
const ONBOARDING_PROFILE_HINT_KEY = 'cpoint_onboarding_profile_hint'
const ONBOARDING_RESUME_KEY = 'cpoint_onboarding_resume_step'

type Community = {
  id: number
  name: string
  type: string
  description?: string | null
  member_count?: number
  last_activity?: string | null
  is_owner?: boolean
  is_admin?: boolean
  unread_posts_count?: number
}

type OnboardingStateSummary = {
  profileDeferUntil?: string | null
  serverTime?: string | null
  requiresOnboardingResume?: boolean
  onboardingComplete?: boolean
  onboardingProgress?: {
    personalSectionComplete?: boolean
    professionalSectionComplete?: boolean
    nextStage?: string
  }
}

function formatOnboardingRemaining(profileDeferUntil?: string | null, serverTime?: string | null): string {
  if (!profileDeferUntil) return ''
  const end = new Date(profileDeferUntil).getTime()
  const server = serverTime ? new Date(serverTime).getTime() : Date.now()
  if (Number.isNaN(end) || Number.isNaN(server)) return ''
  const diffMs = end - server
  if (diffMs <= 0) return 'Ready to continue'
  const hours = Math.ceil(diffMs / 3600000)
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  if (days > 0 && remHours > 0) return `${days} day${days === 1 ? '' : 's'} ${remHours} hour${remHours === 1 ? '' : 's'} remaining`
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} remaining`
  return `${hours} hour${hours === 1 ? '' : 's'} remaining`
}

function formatLastActive(timestamp: string | null | undefined): string {
  if (!timestamp) return ''
  try {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  } catch {
    return ''
  }
}

function dashboardDeviceCacheMatchesSession(c: DashboardCachePayload): boolean {
  const pu = c.profile?.username?.trim()
  if (!pu) return true
  try {
    const hint = localStorage.getItem('current_username')?.trim() ?? ''
    if (!hint) return false
    return pu === hint
  } catch {
    return false
  }
}

function sortCommunitiesByRole(communities: Community[]): Community[] {
  return [...communities].sort((a, b) => {
    // Owner first
    if (a.is_owner && !b.is_owner) return -1
    if (!a.is_owner && b.is_owner) return 1
    // Then admin
    if (a.is_admin && !b.is_admin) return -1
    if (!a.is_admin && b.is_admin) return 1
    // Then alphabetically
    return (a.name || '').localeCompare(b.name || '')
  })
}

export default function PremiumDashboard() {
  const requestLogout = useLogoutRequest()
  const { applyProfileFromServer } = useUserProfile()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [hasGymAccess, setHasGymAccess] = useState(false)
  const [communities, setCommunities] = useState<Community[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newCommName, setNewCommName] = useState('')
  const [newCommType, setNewCommType] = useState<'Gym'|'University'|'General'|'Business'>('General')
  const [isCreatingCommunity, setIsCreatingCommunity] = useState(false)
  const [isAppAdmin, setIsAppAdmin] = useState(false)
  // Parent-only creation; no parent selection
  // Removed parentsWithChildren usage in desktop since cards now route to unified communities page
  const [emailVerified, setEmailVerified] = useState<boolean|null>(null)
  const [showVerifyFirstModal, setShowVerifyFirstModal] = useState(false)
  const [communitiesLoaded, setCommunitiesLoaded] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  // Onboarding
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showOnboardingWelcome, setShowOnboardingWelcome] = useState(false)
  const [onboardingGateRequired, setOnboardingGateRequired] = useState(false)
  const [onboardingMode, setOnboardingMode] = useState<'fresh' | 'profile_builder'>('fresh')
  const [onboardingLaunching, setOnboardingLaunching] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [username, setUsername] = useState('')
  const [subscription, setSubscription] = useState<string>('free')
  const [, setHasProfilePic] = useState<boolean>(false)
  const [existingProfilePic, setExistingProfilePic] = useState<string>('')
  const [emailVerifiedAt, setEmailVerifiedAt] = useState<string | null>(null)
  const [isRecentlyVerified, setIsRecentlyVerified] = useState(false)
  const [onboardingStateSummary, setOnboardingStateSummary] = useState<OnboardingStateSummary | null>(null)
  const onboardingTriggeredRef = useRef(false)  // Track if onboarding was already triggered
  const refreshInFlightRef = useRef(false)
  const lastScrollRefreshRef = useRef(0)
  const prevPathnameForDashboardRef = useRef<string | null>(null)
  const [pullHint, setPullHint] = useState<'idle' | 'ready' | 'refreshing'>('idle')
  const [pullPx, setPullPx] = useState(0)
  const [joinedCommunityName, setJoinedCommunityName] = useState<string | null>(null)
  const [joinedCommunityId, setJoinedCommunityId] = useState<number | null>(null)
  const [pendingInviteTarget, setPendingInviteTarget] = useState<{ communityId: number; communityName?: string | null } | null>(null)
  const [showSuccessModal, setShowSuccessModal] = useState(false)  // Success modal for join
  const doneKey = username ? `onboarding_done:${username}` : 'onboarding_done'
  const { setTitle, setHeaderHidden, setTitleAccessory } = useHeader()
  useEffect(() => {
    setTitle('')
    return () => setTitle('')
  }, [setTitle])
  useEffect(() => {
    const hideHeaderForOnboarding = showOnboarding || showOnboardingWelcome || onboardingLaunching || onboardingGateRequired
    setHeaderHidden(hideHeaderForOnboarding)
    return () => setHeaderHidden(false)
  }, [showOnboarding, showOnboardingWelcome, onboardingLaunching, onboardingGateRequired, setHeaderHidden])

  useEffect(() => {
    // Once Steve is mounted, the bridging overlay is no longer needed; clear it so it never
    // lingers behind the dashboard if the user later exits onboarding.
    if (showOnboarding && onboardingLaunching) {
      setOnboardingLaunching(false)
    }
  }, [showOnboarding, onboardingLaunching])

  useEffect(() => {
    if (communities.length === 0) {
      setTitleAccessory(null)
      return
    }
    setTitleAccessory(
      <button
        type="button"
        className="shrink-0 px-3 py-1.5 rounded-lg bg-[#4db6ac] text-black text-xs sm:text-sm font-semibold hover:brightness-110 transition-all touch-manipulation whitespace-nowrap"
        onClick={() => {
          setNewCommType('General')
          setShowCreateModal(true)
        }}
      >
        +Community
      </button>,
    )
    return () => setTitleAccessory(null)
  }, [communities.length, setTitleAccessory])
  const navigate = useNavigate()
  const location = useLocation()
  const isWeb = Capacitor.getPlatform() === 'web'

  useEffect(() => {
    const sp = new URLSearchParams(location.search)
    let changed = false
    if (sp.get('open_create') === '1') {
      setNewCommType('General')
      setShowCreateModal(true)
      sp.delete('open_create')
      changed = true
    }
    if (sp.get('open_search') === '1') {
      setSearchOpen(true)
      sp.delete('open_search')
      changed = true
    }
    if (changed) {
      const next = sp.toString()
      navigate({ pathname: location.pathname, search: next ? `?${next}` : '' }, { replace: true })
    }
  }, [location.search, location.pathname, navigate])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])
  const isPremium = (subscription || 'free').toLowerCase() === 'premium'
  const handleCloseCreateModal = () => {
    setShowCreateModal(false)
    setNewCommName('')
    setNewCommType('General')
    setIsCreatingCommunity(false)
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
    let cancelled = false
    const { data: cached } = readDeviceCacheStale<DashboardCachePayload>(DASHBOARD_DEVICE_CACHE_KEY, DASHBOARD_CACHE_VERSION)
    if (cached) {
      if (!dashboardDeviceCacheMatchesSession(cached)) {
        invalidateDashboardCache()
        void deleteCachedKeyVal('dashboard-data')
      } else {
        applyDashboardCache(cached)
        return () => {
          cancelled = true
        }
      }
    }
    getCachedKeyVal<DashboardCachePayload>('dashboard-data').then(idbCached => {
      if (cancelled || !idbCached) return
      if (!dashboardDeviceCacheMatchesSession(idbCached)) {
        invalidateDashboardCache()
        void deleteCachedKeyVal('dashboard-data')
        return
      }
      applyDashboardCache(idbCached)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function applyDashboardCache(cached: DashboardCachePayload) {
    const profile = cached.profile
    if (profile) {
      setEmailVerified(profile.emailVerified)
      setEmailVerifiedAt(profile.emailVerifiedAt)
      setUsername(profile.username)
      setFirstName(profile.firstName)
      setLastName(profile.lastName || '')
      setDisplayName(profile.displayName)
      setSubscription(profile.subscription || 'free')
      setHasProfilePic(profile.hasProfilePic)
      setExistingProfilePic(profile.existingProfilePic || '')
      setInitialLoading(false)
    }
    if (Array.isArray(cached.communities)) {
      setCommunities(cached.communities)
      setCommunitiesLoaded(true)
    }
    setHasGymAccess(!!cached.hasGymAccess)
    setIsAppAdmin(!!cached.isAppAdmin)
  }

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
        onboardingTriggeredRef.current = true
        setOnboardingMode('profile_builder')
        setShowOnboarding(true)
      }
    } catch {}
  }, [])

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

  async function fetchJson(url: string, bypassCache = false){
    try{
      // Add cache-busting parameter if requested
      const fetchUrl = bypassCache ? `${url}${url.includes('?') ? '&' : '?'}_nocache=${Date.now()}` : url
      const r = await fetch(fetchUrl, { 
        credentials:'include',
        headers: { 'Accept': 'application/json' },
        cache: bypassCache ? 'no-store' : 'default'
      })
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

  const loadUserData = useCallback(async (forceRefresh = false) => {
    let profileSnapshot: DashboardCachePayload['profile'] | null = null
    let cachedCommunities: Array<{ id: number; name: string; type: string }> = []
    let hasGymAccessFlag = false
    let isAdminFlag = false
    try {
      const [profileBundle, gymData, adminCheck, parentData] = await Promise.all([
        (async () => {
          const profileUrl = forceRefresh ? `/api/profile_me?_nocache=${Date.now()}` : '/api/profile_me'
          const r = await fetch(profileUrl, { credentials:'include', headers: { 'Accept': 'application/json' }, cache: forceRefresh ? 'no-store' : 'default' })
          if (r.status === 403) return { profileResult: { _forbidden: true } as any, hydratedFromNetwork: false }
          const profileResult = await r.json().catch(() => null)
          return { profileResult, hydratedFromNetwork: true }
        })().catch(() => ({ profileResult: null as any, hydratedFromNetwork: false })),
        fetchJson('/api/check_gym_membership', forceRefresh),
        fetchJson('/api/check_admin', forceRefresh).catch(() => null),
        fetchJson('/api/user_parent_community', forceRefresh),
      ])

      const profileResult = profileBundle.profileResult
      const hydratedFromNetwork = profileBundle.hydratedFromNetwork

      if (profileResult?._forbidden) {
        navigate('/verify_required', { replace: true })
        return
      }

      const me = profileResult
      if (me?.success && me.profile && hydratedFromNetwork) {
        applyProfileFromServer(me.profile as Record<string, unknown>)
      }
      if (me?.success && me.profile) {
        setEmailVerified(!!me.profile.email_verified)
        setEmailVerifiedAt(me.profile.email_verified_at || null)
        setUsername(me.profile.username || '')
        setFirstName(me.profile.first_name || '')
        setLastName(me.profile.last_name || '')
        setDisplayName(me.profile.display_name || me.profile.username)
        const profilePicValue = me.profile.profile_picture || null
        const resolvedPic = resolveAvatar(profilePicValue)
        setHasProfilePic(!!profilePicValue)
        setExistingProfilePic(resolvedPic)
        setSubscription((me.profile.subscription || 'free') as string)
        profileSnapshot = {
          emailVerified: !!me.profile.email_verified,
          emailVerifiedAt: me.profile.email_verified_at || null,
          username: me.profile.username || '',
          firstName: me.profile.first_name || '',
          lastName: me.profile.last_name || '',
          displayName: me.profile.display_name || me.profile.username || '',
          subscription: (me.profile.subscription || 'free') as string,
          hasProfilePic: !!profilePicValue,
          existingProfilePic: resolvedPic,
        }
      }

      hasGymAccessFlag = !!(gymData?.hasGymAccess)
      setHasGymAccess(hasGymAccessFlag)

      isAdminFlag = !!(adminCheck?.is_admin)
      setIsAppAdmin(isAdminFlag)

      if (parentData?.success && Array.isArray(parentData.communities)) {
        cachedCommunities = parentData.communities
        setCommunities(parentData.communities)
        setCommunitiesLoaded(true)
      }

      if (profileSnapshot) {
        const payload = {
          profile: profileSnapshot,
          communities: cachedCommunities,
          hasGymAccess: hasGymAccessFlag,
          isAppAdmin: isAdminFlag,
        }
        writeDeviceCache(DASHBOARD_DEVICE_CACHE_KEY, payload, DASHBOARD_CACHE_TTL_MS, DASHBOARD_CACHE_VERSION)
        cacheKeyVal('dashboard-data', payload)
      }
    } catch (error) {
      console.error('Error loading user data:', error)
      // Don't overwrite cached data when offline — leave whatever the cache loaded
    } finally {
      setInitialLoading(false)
    }
  }, [navigate, applyProfileFromServer])

  const refreshDashboardSilently = useCallback(async () => {
    if (refreshInFlightRef.current) return
    const now = Date.now()
    if (now - lastScrollRefreshRef.current < 15000) return
    refreshInFlightRef.current = true
    setPullHint('refreshing')
    try{
      await triggerDashboardServerPull()
      // Force refresh to bypass all caches (server + device)
      await loadUserData(true)
      lastScrollRefreshRef.current = Date.now()
    }catch(err){
      console.warn('Dashboard auto-refresh failed', err)
    }finally{
      refreshInFlightRef.current = false
      setPullHint('idle')
    }
  }, [loadUserData])

  useEffect(() => {
    loadUserData()
  }, [loadUserData])

  // Refetch when returning to the dashboard from another route (fresh unread counts / server cache bypass).
  useEffect(() => {
    const prev = prevPathnameForDashboardRef.current
    const path = location.pathname
    const onDashboard = isPremiumDashboardPath(path)
    const wasOnDashboard = prev !== null && isPremiumDashboardPath(prev)
    prevPathnameForDashboardRef.current = path
    if (onDashboard && prev !== null && !wasOnDashboard) {
      void loadUserData(true)
    }
  }, [location.pathname, loadUserData])

  // Touch-based pull-to-refresh for iOS Capacitor
  useEffect(() => {
    if (typeof window === 'undefined') return
    let startY = 0
    const threshold = 64
    
    function onTouchStart(ev: TouchEvent) {
      try {
        startY = ev.touches?.[0]?.clientY || 0
      } catch {
        startY = 0
      }
      setPullPx(0)
      if (!refreshInFlightRef.current) {
        setPullHint('idle')
      }
    }
    
    function onTouchMove(ev: TouchEvent) {
      if (refreshInFlightRef.current) return
      try {
        const scrollY = window.scrollY || document.documentElement?.scrollTop || 0
        const curY = ev.touches?.[0]?.clientY || 0
        const dy = curY - startY
        
        // Only activate pull-to-refresh when at top of page and pulling down
        if (scrollY <= 0 && dy > 0) {
          const px = Math.min(100, Math.max(0, dy * 0.5))
          setPullPx(px)
          
          if (px > 8) {
            setPullHint('ready')
          }
          
          // Trigger refresh when threshold is reached
          if (px >= threshold) {
            const now = Date.now()
            if (now - lastScrollRefreshRef.current >= 15000) {
              refreshDashboardSilently()
            }
          }
        } else {
          setPullPx(0)
          if (!refreshInFlightRef.current) {
            setPullHint('idle')
          }
        }
      } catch {
        // ignore
      }
    }
    
    function onTouchEnd() {
      setPullPx(0)
      if (!refreshInFlightRef.current) {
        setPullHint('idle')
      }
    }
    
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [refreshDashboardSilently])

  // Robust re-check after email verification: when tab regains focus or becomes visible
  useEffect(() => {
    let cancelled = false
    async function refresh(){
      try{
        const pr = await fetch('/api/profile_me', { credentials:'include', headers: { 'Accept': 'application/json' } })
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
          setSubscription((pj.profile.subscription || 'free') as string)
        }
        // Also refresh communities snapshot
        const parentDataResp = await fetch(
          '/api/user_parent_community?refresh=1',
          { credentials: 'include', headers: { Accept: 'application/json' } },
        ).catch(() => null)
        const parentData = parentDataResp ? await parentDataResp.json().catch(()=>null) : null
        if (cancelled) return
        if (parentData?.success && Array.isArray(parentData.communities)) {
          setCommunities(parentData.communities)
          setCommunitiesLoaded(true)
        }
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
      setIsRecentlyVerified(isRecent)
    } catch (err) {
      console.error('Error parsing email_verified_at:', err)
      setIsRecentlyVerified(false)
    }
  }, [emailVerifiedAt, emailVerified])

  const previousUsernameForOnboardingRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = previousUsernameForOnboardingRef.current
    const current = username || null
    previousUsernameForOnboardingRef.current = current
    if (!prev || !current || prev === current) return
    onboardingTriggeredRef.current = false
    setOnboardingStateSummary(null)
    setOnboardingGateRequired(false)
    setShowOnboardingWelcome(false)
  }, [username])

  const openOnboardingResume = useCallback(() => {
    setOnboardingGateRequired(false)
    setShowOnboardingWelcome(false)
    setOnboardingMode('fresh')
    setOnboardingLaunching(true)
    setShowOnboarding(true)
  }, [])

  const refreshOnboardingStateSummary = useCallback(async () => {
    try {
      const r = await fetch('/api/onboarding/state', { credentials: 'include' })
      const j = await r.json().catch(() => null)
      if (j?.success) {
        setOnboardingStateSummary({
          profileDeferUntil: j.profileDeferUntil,
          serverTime: j.serverTime,
          requiresOnboardingResume: j.requiresOnboardingResume,
          onboardingComplete: j.onboardingComplete || (j.state && (j.state.stage === 'complete' || j.state.completed_at)),
          onboardingProgress: j.onboardingProgress,
        })
      } else if (r.status === 401 || r.status === 404 || j?.success === false) {
        setOnboardingStateSummary(null)
        setOnboardingGateRequired(false)
      }
    } catch {}
  }, [])

  // Auto-prompt conversational onboarding; server state (defer / resume) runs even when not "recently verified"
  useEffect(() => {
    if (onboardingTriggeredRef.current) return
    if (!communitiesLoaded) return
    if (emailVerified !== true) return
    if (!Array.isArray(communities)) return
    if (!username) return
    if (showOnboarding) return
    if (showOnboardingWelcome) return

    try { if (localStorage.getItem(doneKey) === '1') return } catch {}

    ;(async () => {
      try {
        const r = await fetch('/api/onboarding/state', { credentials: 'include' })
        const j = await r.json().catch(() => null)
        if (j?.success) {
          setOnboardingStateSummary({
            profileDeferUntil: j.profileDeferUntil,
            serverTime: j.serverTime,
            requiresOnboardingResume: j.requiresOnboardingResume,
            onboardingComplete: j.onboardingComplete || (j.state && (j.state.stage === 'complete' || j.state.completed_at)),
            onboardingProgress: j.onboardingProgress,
          })
          if (j.requiresOnboardingResume) {
            setOnboardingGateRequired(true)
            onboardingTriggeredRef.current = true
            return
          }
          if (j.onboardingComplete || (j.state && (j.state.stage === 'complete' || j.state.completed_at))) {
            try { localStorage.setItem(doneKey, '1') } catch {}
            onboardingTriggeredRef.current = true
            return
          }
          if (j.profileDeferUntil) {
            const end = new Date(j.profileDeferUntil).getTime()
            if (!Number.isNaN(end) && Date.now() < end) {
              onboardingTriggeredRef.current = true
              return
            }
          }
          if (j.profileCompleteEffective) {
            try { localStorage.setItem(doneKey, '1') } catch {}
            onboardingTriggeredRef.current = true
            return
          }
        } else if (r.status === 401 || r.status === 404 || j?.success === false) {
          setOnboardingStateSummary(null)
          setOnboardingGateRequired(false)
        }
      } catch {}

      if (!isRecentlyVerified) {
        // Stable "no auto-prompt" for established accounts: do not re-fetch on every communities refresh
        // (focus/visibility refetch replaces the array and was retriggering this effect).
        if (emailVerifiedAt != null) {
          onboardingTriggeredRef.current = true
        }
        return
      }

      // Only flip the launching overlay on right when we are actually about to mount Steve.
      onboardingTriggeredRef.current = true
      setShowOnboardingWelcome(true)
    })()
    // Intentionally omit `communities`: array identity changes on every parent-community refetch and caused
    // a one-shot "Starting onboarding..." flicker for users who exit without auto-opening Steve.
  }, [communitiesLoaded, emailVerified, emailVerifiedAt, username, showOnboarding, showOnboardingWelcome, doneKey, isRecentlyVerified])

  // Parent-only creation: skip loading parent communities


  const hasAnyCommunity = communities.length > 0
  const showOnboardingCompletionCard = !!(
    onboardingStateSummary &&
    !onboardingStateSummary.onboardingComplete &&
    (onboardingStateSummary.profileDeferUntil || onboardingStateSummary.requiresOnboardingResume)
  )
  const onboardingRemaining = formatOnboardingRemaining(
    onboardingStateSummary?.profileDeferUntil,
    onboardingStateSummary?.serverTime,
  )
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
  // Show loading screen while initial data loads
  if (initialLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <img src="/static/logo.png" alt="Logo" className="w-16 h-16 rounded-2xl object-contain" />
            <div className="absolute -inset-2">
              <svg className="w-20 h-20 animate-spin" viewBox="0 0 24 24">
                <circle 
                  className="opacity-20" 
                  cx="12" cy="12" r="10" 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  fill="none"
                  style={{ color: '#4db6ac' }}
                />
                <path 
                  className="opacity-80" 
                  fill="none"
                  stroke="#4db6ac"
                  strokeWidth="2"
                  strokeLinecap="round"
                  d="M12 2a10 10 0 0 1 10 10"
                />
              </svg>
            </div>
          </div>
          <p className="text-white/60 text-sm">Loading...</p>
        </div>
      </div>
    )
  }

    return (
      <div className="app-content min-h-screen chat-thread-bg text-white pb-safe relative">
      {/* Web uses shared HeaderBar from App.tsx, native platforms use old sidebar */}
      {!isWeb && (
      /* Desktop sidebar - only for native platforms (iOS/Android) */
      <div className="fixed left-0 top-14 bottom-0 w-52 hidden md:flex flex-col z-30 liquid-glass-surface border border-white/10 rounded-r-3xl shadow-[0_10px_40px_rgba(0,0,0,0.45)]">
        <nav className="flex-1 overflow-y-auto py-3">
          <a className="block px-5 py-3 text-sm text-white hover:bg-teal-700/20 hover:text-teal-300" href="/premium_dashboard">Dashboard</a>
          <a className="block px-5 py-3 text-sm text-white hover:bg-teal-700/20 hover:text-teal-300" href="/profile">Profile</a>
          <a className="block px-5 py-3 text-sm text-white hover:bg-teal-700/20 hover:text-teal-300" href="/user_chat">Messages</a>
          <a className="block px-5 py-3 text-sm text-white hover:bg-teal-700/20 hover:text-teal-300" href="/followers">Followers</a>
          {hasGymAccess && <a className="block px-5 py-3 text-sm text-white hover:bg-teal-700/20 hover:text-teal-300" href="/your_sports">Your Sports</a>}
          <button className="block w-full text-left px-5 py-3 text-sm text-white hover:bg-teal-700/20 hover:text-teal-300" onClick={requestLogout}>Logout</button>
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
      )}

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
              <button className="w-full text-left px-5 py-3 border-b border-white/10" onClick={(e) => { setMobileMenuOpen(false); requestLogout(e) }}>Logout</button>
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
      <div
        className={`min-h-screen pb-[calc(3.5rem+env(safe-area-inset-bottom,0px)+12px)] ${isWeb ? 'lg:ml-64' : 'md:ml-52'}`}
      >
        <div className="app-content max-w-5xl mx-auto px-3 py-6">
          {showOnboardingCompletionCard && (
            <div className="mb-4 rounded-2xl border border-[#4db6ac]/30 bg-[#4db6ac]/10 p-4 shadow-[0_16px_45px_rgba(0,0,0,0.28)]">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-base font-semibold text-white">Complete your onboarding</div>
                  <p className="mt-1 text-sm leading-relaxed text-white/70">
                    {onboardingStateSummary?.requiresOnboardingResume
                      ? 'Your profile is saved. Continue when you are ready so people can understand who you are in your communities.'
                      : 'Your progress is saved. You can continue from where you left off.'}
                  </p>
                  {onboardingRemaining && (
                    <div className="mt-2 text-xs font-medium text-[#d5fffb]">{onboardingRemaining}</div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                    <span className={`rounded-full border px-2.5 py-1 ${onboardingStateSummary?.onboardingProgress?.personalSectionComplete ? 'border-[#4db6ac]/35 bg-[#4db6ac]/10 text-[#d5fffb]' : 'border-white/10 bg-white/5 text-white/55'}`}>
                      {onboardingStateSummary?.onboardingProgress?.personalSectionComplete ? 'Personal complete' : 'Personal pending'}
                    </span>
                    <span className={`rounded-full border px-2.5 py-1 ${onboardingStateSummary?.onboardingProgress?.professionalSectionComplete ? 'border-[#4db6ac]/35 bg-[#4db6ac]/10 text-[#d5fffb]' : 'border-white/10 bg-white/5 text-white/55'}`}>
                      {onboardingStateSummary?.onboardingProgress?.professionalSectionComplete ? 'Professional complete' : 'Professional pending'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openOnboardingResume}
                  className="shrink-0 rounded-xl bg-[#4db6ac] px-4 py-2.5 text-sm font-semibold text-black transition hover:brightness-110"
                >
                  Continue onboarding
                </button>
              </div>
            </div>
          )}
          <div 
            className="sticky top-0 z-20 mb-3 flex justify-center pointer-events-none transition-transform duration-150"
            style={{ transform: `translateY(${Math.min(pullPx * 0.5, 30)}px)` }}
          >
            <span
              className={`rounded-full border border-white/10 bg-black/70 px-4 py-1 text-[11px] text-[#9fb0b5] transition-opacity flex items-center gap-2 ${
                pullHint === 'idle' ? 'opacity-60' : 'opacity-100'
              }`}
            >
              {pullHint === 'refreshing' ? (
                <>
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Refreshing…
                </>
              ) : pullHint === 'ready' ? (
                <>
                  <i className="fa-solid fa-arrow-down text-[10px]" />
                  Release to refresh
                </>
              ) : (
                <>
                  <i className="fa-solid fa-arrow-down text-[10px]" />
                  Pull down to refresh
                </>
              )}
            </span>
          </div>
            {communities.length === 0 ? (
              <div className="px-3 py-6 space-y-4">
                <div className="mx-auto max-w-xl rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
                  <div className="text-sm font-semibold text-white mb-1.5">About C-Point</div>
                  <p className="text-sm text-[#9fb0b5] leading-relaxed mb-3">
                    Manifesto, how the app works, and what Steve can do — a short in-app guide.
                  </p>
                  <button
                    type="button"
                    className="w-full py-2 rounded-lg border border-[#4db6ac]/50 text-sm font-medium text-[#4db6ac] hover:bg-[#4db6ac]/10 touch-manipulation"
                    onClick={() => navigate('/about_cpoint')}
                  >
                    Read About C-Point
                  </button>
                </div>
                {/* Welcome Card */}
                <div className="mx-auto max-w-xl liquid-glass-surface border border-white/10 rounded-2xl p-5 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
                  <div className="text-base font-semibold text-white mb-3">
                    Welcome to C-Point
                  </div>
                  <div className="text-sm text-[#9fb0b5] leading-relaxed space-y-3">
                    <p>A global platform of private, independent networks - we call them communities.</p>
                    <p className="font-medium text-white/80">Your dashboard is empty by design.</p>
                    <p>There are no public feeds, no algorithms, and no endless noise — only the communities you create or are invited to join. This is how we protect real privacy and genuine connection.</p>
                    <p>Create or ask to be invited to the private spaces that matter to you — whether personal or professional.</p>
                  </div>
                  <div className="mt-5 text-center">
                    <div className="text-sm text-white/70 mb-3">Ready to get started?</div>
                    <button 
                      className="px-5 py-2.5 rounded-full bg-[#4db6ac] text-black font-semibold shadow-lg hover:brightness-110 active:scale-95 transition-transform touch-manipulation"
                      onClick={() => { setNewCommType('General'); setShowCreateModal(true) }}
                      style={{ WebkitTapHighlightColor: 'transparent' }}
                    >
                      Create Your Community
                    </button>
                  </div>
                </div>

                {/* Meet Steve Card */}
                <div className="mx-auto max-w-xl liquid-glass-surface border border-white/10 rounded-2xl p-5 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
                  <div className="text-base font-semibold text-white mb-3">
                    Hi, I'm Steve.
                  </div>
                  <div className="text-sm text-[#9fb0b5] leading-relaxed">
                    <p>Think of me as an ever-present member whose purpose is to bring intelligence to the platform. Why am I here? To help you meet people in your communities you might not yet know. To help you find people you know who aren't in any of your communities yet. To add facts or a different perspective to discussions. And to do the small things that go a long way — like summarising a voice note so you know what it's about before you listen, or condensing a long post so you're up to speed in seconds.</p>
                  </div>
                  <div className="mt-4">
                    <button 
                      className="px-5 py-2.5 rounded-full border border-[#4db6ac]/40 text-[#4db6ac] font-medium hover:bg-[#4db6ac]/10 active:scale-95 transition-all touch-manipulation"
                      onClick={() => navigate('/user_chat/chat/Steve')}
                      style={{ WebkitTapHighlightColor: 'transparent' }}
                    >
                      Talk to Steve
                    </button>
                  </div>
                </div>
              </div>
            ) : (
            <>
              {/* Welcome Header */}
              <div className="mb-4 text-sm text-[#9fb0b5]">
                Welcome to C-Point: a global platform made of private micro-networks. We call them communities.
              </div>

              {searchOpen && (
                <div className="mb-4">
                  <div className="relative w-full max-w-xl">
                    <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[#9fb0b5] text-sm pointer-events-none" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search communities..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-[#9fb0b5] focus:outline-none focus:border-[#4db6ac]/40"
                    />
                  </div>
                </div>
              )}

              {/* Communities Grid */}
              {(() => {
                const sorted = sortCommunitiesByRole(communities)
                const filtered = searchQuery.trim()
                  ? sorted.filter((c) => {
                      const q = searchQuery.toLowerCase()
                      if (c.name.toLowerCase().includes(q)) return true
                      const desc = (c.description ?? '').toLowerCase()
                      return desc.includes(q)
                    })
                  : sorted
                const ownedOrAdmin = filtered.filter(c => c.is_owner || c.is_admin)
                const memberOnly = filtered.filter(c => !c.is_owner && !c.is_admin)

                return (
                  <div className="space-y-4">
                    {/* Owner/Admin Section */}
                    {ownedOrAdmin.length > 0 && (
                      <>
                        {/* Separator - Owner/Admin of */}
                        <div className="flex items-center gap-3 py-1">
                          <div className="h-px flex-1 bg-white/10" />
                          <span className="text-[10px] uppercase tracking-wider text-[#9fb0b5]/60 font-medium">Owner / Admin of</span>
                          <div className="h-px flex-1 bg-white/10" />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {ownedOrAdmin.map((community) => (
                            <CommunityCard
                              key={community.id}
                              name={community.name}
                              description={community.description}
                              memberCount={community.member_count}
                              lastActivity={community.last_activity}
                              isOwner={community.is_owner}
                              isAdmin={community.is_admin}
                              unreadPostsCount={community.unread_posts_count}
                              onClick={() =>
                                navigate(`/communities?parent_id=${community.id}`)
                              }
                            />
                          ))}
                        </div>
                      </>
                    )}

                    {/* Member Section */}
                    {memberOnly.length > 0 && (
                      <>
                        {/* Separator - Member of */}
                        <div className="flex items-center gap-3 py-1">
                          <div className="h-px flex-1 bg-white/10" />
                          <span className="text-[10px] uppercase tracking-wider text-[#9fb0b5]/60 font-medium">Member of</span>
                          <div className="h-px flex-1 bg-white/10" />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {memberOnly.map((community) => (
                            <CommunityCard
                              key={community.id}
                              name={community.name}
                              description={community.description}
                              memberCount={community.member_count}
                              lastActivity={community.last_activity}
                              isOwner={community.is_owner}
                              isAdmin={community.is_admin}
                              unreadPostsCount={community.unread_posts_count}
                              onClick={() =>
                                navigate(`/communities?parent_id=${community.id}`)
                              }
                            />
                          ))}
                        </div>
                      </>
                    )}

                    {/* No results message */}
                    {filtered.length === 0 && searchQuery.trim() && (
                      <div className="text-center py-8 text-[#9fb0b5] text-sm">
                        No communities found matching "{searchQuery}"
                      </div>
                    )}
                  </div>
                )
              })()}
            </>
            )}
        </div>

        <DashboardBottomNav show searchOpen={searchOpen} onToggleSearch={() => setSearchOpen((v) => !v)} />
      </div>

      {/* Conversational Onboarding with Steve */}
      {showOnboardingWelcome && !showOnboarding && !onboardingGateRequired && (
        <OnboardingIntroGate
          onStart={() => {
            setShowOnboardingWelcome(false)
            setOnboardingLaunching(true)
            setShowOnboarding(true)
          }}
        />
      )}
      {onboardingGateRequired && !showOnboarding && (
        <div className="fixed inset-0 z-[1101] bg-black/90 backdrop-blur-md flex items-center justify-center px-6">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1214] p-6 text-center shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
            <img src="/api/public/logo" alt="C-Point" className="w-14 h-14 rounded-2xl object-contain mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-white mb-2">Finish your profile</h2>
            <p className="text-sm text-[#9fb0b5] mb-6">
              Your onboarding window has ended. Jump back in with Steve to wrap up — it only takes a few minutes.
            </p>
            <button
              type="button"
              className="w-full rounded-xl bg-[#4db6ac] text-black font-semibold py-3 text-sm hover:brightness-110 transition"
              onClick={openOnboardingResume}
            >
              Continue with Steve
            </button>
          </div>
        </div>
      )}
      {onboardingLaunching && !showOnboarding && !onboardingGateRequired && (
        <div className="fixed inset-0 z-[1100] bg-black/80 backdrop-blur-sm flex items-center justify-center px-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <img src="/api/public/logo" alt="C-Point" className="w-14 h-14 rounded-2xl object-contain" />
            <div className="w-8 h-8 rounded-full border-2 border-white/15 border-t-[#4db6ac] animate-spin" />
            <div className="text-sm text-white/65">Opening Steve...</div>
          </div>
        </div>
      )}
      {showOnboarding && (
        <OnboardingChat
          firstName={firstName}
          lastName={lastName}
          username={username}
          displayName={displayName}
          communityName={resolvedCommunityName !== 'your community' ? resolvedCommunityName : null}
          hasCommunity={hasAnyCommunity}
          existingProfilePic={existingProfilePic}
          mode={onboardingMode}
          onComplete={() => {
            setShowOnboarding(false)
            setShowOnboardingWelcome(false)
            setOnboardingLaunching(false)
            setOnboardingGateRequired(false)
            onboardingTriggeredRef.current = false
            window.location.href = '/premium_dashboard'
          }}
          onCreateCommunity={() => {
            setShowOnboarding(false)
            setShowOnboardingWelcome(false)
            setOnboardingLaunching(false)
            setShowCreateModal(true)
          }}
          onGoToCommunity={() => {
            setShowOnboarding(false)
            setShowOnboardingWelcome(false)
            setOnboardingLaunching(false)
            handleGoToCommunity()
          }}
          onExit={() => {
            setShowOnboarding(false)
            setShowOnboardingWelcome(false)
            setOnboardingLaunching(false)
            setTimeout(() => { void refreshOnboardingStateSummary() }, 900)
          }}
        />
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

      {/* Communities modal removed; dashboard links use /communities?parent_id= */}
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
                  <button className="px-3 py-2 rounded-md bg:white/10 hover:bg:white/15" onClick={handleCloseCreateModal} disabled={isCreatingCommunity}>Cancel</button>
                    <button 
                      className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed" 
                      disabled={isCreatingCommunity}
                      onClick={async()=> {
                        if (isCreatingCommunity) return // Extra guard
                        if (!newCommName.trim()) { alert('Please provide a name'); return }
                        setIsCreatingCommunity(true)
                        try{
                          const fd = new URLSearchParams({ name: newCommName.trim(), type: newCommType })
                          // Force parent community creation: do not include parent_community_id
                          const r = await fetch('/create_community', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
                          const j = await r.json().catch(()=>null)
                          if (j?.success){
                            handleCloseCreateModal()
                            try { localStorage.setItem(doneKey, '1') } catch {}
                            setShowOnboarding(false)
                            await triggerDashboardServerPull()
                            const refreshed = await refreshDashboardCommunities()
                            if (refreshed) {
                              setCommunities(refreshed)
                              setCommunitiesLoaded(true)
                            }
                          } else {
                            alert(j?.error || 'Failed to create community')
                            setIsCreatingCommunity(false)
                          }
                        }catch{ 
                          alert('Failed to create community')
                          setIsCreatingCommunity(false)
                        }
                      }}
                    >{isCreatingCommunity ? 'Creating…' : 'Create'}</button>
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
                      await triggerDashboardServerPull()
                      const refreshed = await refreshDashboardCommunities()
                      if (refreshed) {
                        setCommunities(refreshed)
                        setCommunitiesLoaded(true)
                      }
                    }
                      else alert(j?.error || 'Failed to join community')
                  }catch{ 
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

function CommunityCard({
  name,
  description,
  memberCount,
  lastActivity,
  isOwner,
  isAdmin,
  unreadPostsCount,
  onClick,
}: {
  name: string
  description?: string | null
  memberCount?: number
  lastActivity?: string | null
  isOwner?: boolean
  isAdmin?: boolean
  unreadPostsCount?: number
  onClick: () => void
}) {
  const lastActiveText = formatLastActive(lastActivity)
  const badge = isOwner ? 'Owner' : isAdmin ? 'Admin' : null
  const descText = typeof description === 'string' ? description.trim() : ''
  const unread = unreadPostsCount ?? 0

  return (
    <button
      onClick={onClick}
      aria-label={name}
      className="group relative flex min-h-[8.5rem] w-full rounded-2xl overflow-hidden text-white transition-all duration-300 liquid-glass-surface border border-white/15 hover:border-teal-400/40 shadow-[0_24px_56px_rgba(0,0,0,0.48)] hover:shadow-[0_32px_64px_rgba(0,0,0,0.58)] hover:-translate-y-0.5 text-left"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{
          background:
            'radial-gradient(600px circle at var(--x,50%) var(--y,50%), rgba(77,182,172,0.18), transparent 45%)',
        }}
      />

      <div className="relative flex flex-col gap-3 p-6 sm:p-7">
        <div className="w-full min-w-0">
          <div
            className={`text-[17px] font-semibold tracking-tight text-white/90 leading-tight${badge ? ' pr-16 sm:pr-20' : ''}`}
          >
            {name}
          </div>
        </div>

        {descText.length > 0 ? (
          <p className="text-[11.5px] text-[#9fb0b5]/85 leading-relaxed line-clamp-3">
            {descText}
          </p>
        ) : isOwner || isAdmin ? (
          <p className="text-[11.5px] text-[#9fb0b5]/70 leading-relaxed italic">
            No description yet — add one in &quot;Manage Community&quot;.
          </p>
        ) : (
          <p className="text-[11.5px] text-[#9fb0b5]/70 leading-relaxed">
            No description yet.
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#9fb0b5] pt-1">
          {typeof memberCount === 'number' && (
            <span className="flex items-center gap-1.5">
              <i className="fa-solid fa-users text-[10px] text-[#4db6ac] drop-shadow-[0_0_8px_rgba(77,182,172,0.45)]" aria-hidden />
              {memberCount}
            </span>
          )}
          {lastActiveText && (
            <span className="flex items-center gap-1.5">
              <i className="fa-regular fa-clock text-[10px]" />
              {lastActiveText}
            </span>
          )}
        </div>
      </div>

      {badge && (
        <span className="pointer-events-none absolute top-4 right-4 sm:top-5 sm:right-5 z-10 flex-shrink-0 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide rounded-full bg-[#4db6ac]/20 text-[#4db6ac] border border-[#4db6ac]/30">
          {badge}
        </span>
      )}

      {unread > 0 && (
        <span className="pointer-events-none absolute bottom-4 right-4 sm:bottom-5 sm:right-5 z-10 flex-shrink-0 px-2 py-0.5 text-[10px] font-medium rounded-full bg-[#4db6ac]/20 text-[#4db6ac] border border-[#4db6ac]/30">
          {unread} new post{unread === 1 ? '' : 's'}
        </span>
      )}

      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-teal-300/60 to-transparent opacity-80" />
    </button>
  )
}

