import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useHeader } from '../contexts/HeaderContext'
import { useUserProfile } from '../contexts/UserProfileContext'
import { normalizeHandleInput } from '../components/community/HandleSettings'
import SpotlightAsk from '../components/dashboard/SpotlightAsk'
import DashboardEmptyState from '../components/dashboard/DashboardEmptyState'
import JoinByHandlePanel from '../components/community/JoinByHandlePanel'
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
import { isPremiumDashboardPath } from '../components/DashboardBottomNav'
import { useDashboardLayout } from '../components/DashboardLayout'
import { SkeletonCommunityCard } from '../components/SkeletonRow'
import AboutCPointModal from '../components/about/AboutCPointModal'
import BrandLogo from '../components/BrandLogo'
import { setOnboardingFullscreenOverlay } from '../utils/fullscreenOverlay'
import { useSingleCommunityLanding } from '../hooks/useSingleCommunityLanding'

const PENDING_INVITE_KEY = 'cpoint_pending_invite'
const DASHBOARD_INVITE_PROMPT_DISMISSED_KEY = 'cpoint_dashboard_invite_prompt_dismissed'
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

type PendingCommunityInvite = {
  id: number
  community_id: number
  community_name?: string | null
  invited_by_username?: string | null
  invited_at?: string | null
  expires_at?: string | null
  expired?: boolean
  invite_type?: string | null
  source?: 'pending' | 'token'
  token?: string | null
  status?: string | null
  used?: boolean
  already_member?: boolean
}

export type OnboardingStateSummary = {
  profileDeferUntil?: string | null
  serverTime?: string | null
  requiresOnboardingResume?: boolean
  onboardingComplete?: boolean
  onboardingProgress?: {
    personalSectionComplete?: boolean
    professionalSectionComplete?: boolean
    personalSectionCompleteEffective?: boolean
    professionalSectionCompleteEffective?: boolean
    nextStage?: string
  }
}

export function getEffectiveProfileSectionStatus(summary: OnboardingStateSummary | null | undefined) {
  const personal =
    summary?.onboardingProgress?.personalSectionCompleteEffective ??
    summary?.onboardingProgress?.personalSectionComplete ??
    false
  const professional =
    summary?.onboardingProgress?.professionalSectionCompleteEffective ??
    summary?.onboardingProgress?.professionalSectionComplete ??
    false
  return { personal, professional, complete: personal && professional }
}

export function shouldShowProfileHelpCard(summary: OnboardingStateSummary | null | undefined): boolean {
  if (!summary || summary.onboardingComplete) return false
  const sections = getEffectiveProfileSectionStatus(summary)
  if (sections.complete) return false
  return Boolean(
    summary.profileDeferUntil ||
    summary.requiresOnboardingResume ||
    !sections.personal ||
    !sections.professional,
  )
}

function formatInviteExpiry(value?: string | null) {
  if (!value) return ''
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const date = new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatLastActive(timestamp: string | null | undefined, t: TFunction): string {
  if (!timestamp) return ''
  try {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return t('dashboard.just_now')
    if (diffMins < 60) return t('dashboard.minutes_ago_short', { count: diffMins })
    if (diffHours < 24) return t('dashboard.hours_ago_short', { count: diffHours })
    if (diffDays < 7) return t('dashboard.days_ago_short', { count: diffDays })
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
  const { t } = useTranslation()
  const requestLogout = useLogoutRequest()
  const { applyProfileFromServer } = useUserProfile()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [hasGymAccess, setHasGymAccess] = useState(false)
  const [communities, setCommunities] = useState<Community[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [showAboutCPointModal, setShowAboutCPointModal] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newCommName, setNewCommName] = useState('')
  // Handle pre-fills from the name (slugified) until the creator edits it
  // by hand; sent with create and validated server-side (silent fallback
  // to auto-generation on conflict, adjustable later in Manage Community).
  const [newCommHandle, setNewCommHandle] = useState('')
  const [handleEdited, setHandleEdited] = useState(false)
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
  const [onboardingMode, setOnboardingMode] = useState<'fresh' | 'profile_builder'>('fresh')
  const [onboardingLaunching, setOnboardingLaunching] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [username, setUsername] = useState('')
  const [, setSubscription] = useState<string>('free')
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
  const [joinedCommunityId, setJoinedCommunityId] = useState<number | null>(null)
  const [pendingInviteTarget, setPendingInviteTarget] = useState<{ communityId: number; communityName?: string | null } | null>(null)
  const [pendingCommunityInvites, setPendingCommunityInvites] = useState<PendingCommunityInvite[]>([])
  const [activeInvitePrompt, setActiveInvitePrompt] = useState<PendingCommunityInvite | null>(null)
  const [invitesChecked, setInvitesChecked] = useState(false)
  const [invitePromptLoading, setInvitePromptLoading] = useState(false)
  const [invitePromptError, setInvitePromptError] = useState('')
  const [inviteActionLoading, setInviteActionLoading] = useState<'accept' | 'decline' | null>(null)
  const [invitePromptDismissed, setInvitePromptDismissed] = useState(() => {
    try {
      return typeof window !== 'undefined' && sessionStorage.getItem(DASHBOARD_INVITE_PROMPT_DISMISSED_KEY) === '1'
    } catch {
      return false
    }
  })
  const doneKey = username ? `onboarding_done:${username}` : 'onboarding_done'
  const { setTitle, setHeaderHidden, setTitleAccessory } = useHeader()
  useEffect(() => {
    setTitle('')
    return () => setTitle('')
  }, [setTitle])
  useEffect(() => {
    const hideHeaderForOnboarding = showOnboarding || showOnboardingWelcome || onboardingLaunching
    setHeaderHidden(hideHeaderForOnboarding)
    // Only undo our own hide on cleanup. The dashboard stays mounted during
    // the 250ms page transition, so an unconditional reset here would stomp
    // the next page's setHeaderHidden(true) (e.g. ScopedProfileBuilder) and
    // bring the global header back over its full-screen chat.
    return () => {
      if (hideHeaderForOnboarding) setHeaderHidden(false)
    }
  }, [showOnboarding, showOnboardingWelcome, onboardingLaunching, setHeaderHidden])

  useEffect(() => {
    const overlayActive =
      showOnboarding || showOnboardingWelcome || onboardingLaunching
    setOnboardingFullscreenOverlay(overlayActive)
    return () => setOnboardingFullscreenOverlay(false)
  }, [showOnboarding, showOnboardingWelcome, onboardingLaunching])

  useEffect(() => {
    // Once Steve is mounted, the bridging overlay is no longer needed; clear it so it never
    // lingers behind the dashboard if the user later exits onboarding.
    if (showOnboarding && onboardingLaunching) {
      setOnboardingLaunching(false)
    }
  }, [showOnboarding, onboardingLaunching])

  useEffect(() => {
    setTitleAccessory(null)
    return () => setTitleAccessory(null)
  }, [setTitleAccessory])
  const navigate = useNavigate()
  const location = useLocation()
  const isWeb = Capacitor.getPlatform() === 'web'
  // The pull-to-refresh gesture is touch-only (touchstart/touchmove below),
  // so its hint pill would be an unactionable instruction on fine-pointer
  // devices — render it only where the gesture can actually fire.
  const [hasCoarsePointer] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  )
  const invitePromptRequested = new URLSearchParams(location.search).get('invite_prompt') === '1'

  // B2B landing: single-community members open the app inside their community.
  useSingleCommunityLanding({
    ready: communitiesLoaded && invitesChecked && emailVerified === true && !invitePromptRequested,
    communities,
    hasPendingInvites: pendingCommunityInvites.length > 0 || !!activeInvitePrompt,
    overlayActive:
      showOnboarding || showOnboardingWelcome || onboardingLaunching || showCreateModal,
  })

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
  const handleCloseCreateModal = () => {
    setShowCreateModal(false)
    setNewCommName('')
    setNewCommHandle('')
    setHandleEdited(false)
    setNewCommType('General')
    setIsCreatingCommunity(false)
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

  const readStoredInviteToken = () => {
    try {
      if (typeof window === 'undefined') return ''
      const raw = sessionStorage.getItem(PENDING_INVITE_KEY)
      if (!raw) return ''
      const parsed = JSON.parse(raw)
      return typeof parsed?.inviteToken === 'string' ? parsed.inviteToken : ''
    } catch {
      return ''
    }
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
        setOnboardingMode('profile_builder')
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

  const clearInvitePromptQuery = useCallback(() => {
    if (!invitePromptRequested) return
    const sp = new URLSearchParams(location.search)
    sp.delete('invite_prompt')
    const next = sp.toString()
    navigate({ pathname: location.pathname, search: next ? `?${next}` : '' }, { replace: true })
  }, [invitePromptRequested, location.pathname, location.search, navigate])

  const dismissInvitePromptForSession = useCallback(() => {
    setInvitePromptDismissed(true)
    setActiveInvitePrompt(null)
    setInvitePromptError('')
    clearInvitePromptQuery()
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(DASHBOARD_INVITE_PROMPT_DISMISSED_KEY, '1')
      }
    } catch {}
  }, [clearInvitePromptQuery])

  const loadPendingCommunityInvites = useCallback(async () => {
    setInvitePromptLoading(true)
    try {
      const inviteCandidates: PendingCommunityInvite[] = []
      const r = await fetch('/api/community/invites/pending?include_email=true', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      if (r.status !== 401 && r.status !== 403) {
        const j = await r.json().catch(() => null)
        const invites = Array.isArray(j?.invites) ? j.invites : []
        inviteCandidates.push(...invites.map((invite: PendingCommunityInvite) => ({ ...invite, source: 'pending' as const })))
      }

      const storedInviteToken = readStoredInviteToken()
      if (storedInviteToken) {
        const previewResponse = await fetch(`/api/invite_preview/${encodeURIComponent(storedInviteToken)}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        })
        const preview = await previewResponse.json().catch(() => null)
        if (
          preview?.success &&
          !preview.already_member &&
          !preview.used &&
          (!preview.status || preview.status === 'pending')
        ) {
          const duplicate = inviteCandidates.some(invite => String(invite.id) === String(preview.invite_id))
          if (!duplicate) {
            inviteCandidates.unshift({
              id: Number(preview.invite_id),
              community_id: Number(preview.community_id),
              community_name: preview.community_name,
              invited_by_username: preview.invited_by_username,
              invited_at: preview.invited_at,
              expires_at: preview.expires_at,
              expired: !!preview.expired,
              invite_type: preview.recipient_bound ? 'email' : 'link',
              source: 'token',
              token: storedInviteToken,
              status: preview.status,
              used: !!preview.used,
              already_member: !!preview.already_member,
            })
          }
        }
      }

      setPendingCommunityInvites(inviteCandidates)
    } catch {
      setPendingCommunityInvites([])
    } finally {
      setInvitePromptLoading(false)
      setInvitesChecked(true)
    }
  }, [])

  const activeInviteExpiryText = formatInviteExpiry(activeInvitePrompt?.expires_at)

  async function respondToDashboardInvite(action: 'accept' | 'decline') {
    if (!activeInvitePrompt || inviteActionLoading) return
    if (action === 'accept' && activeInvitePrompt.expired) return
    setInviteActionLoading(action)
    setInvitePromptError('')
    try {
      const endpoint =
        activeInvitePrompt.source === 'token' && activeInvitePrompt.token
          ? `/api/community/invites/token/${encodeURIComponent(activeInvitePrompt.token)}/${action}`
          : `/api/community/invites/${activeInvitePrompt.id}/${action}`
      const r = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.success) {
        setInvitePromptError(j?.error || `Could not ${action} this invitation.`)
        return
      }
      setPendingCommunityInvites(prev => prev.filter(invite => invite.id !== activeInvitePrompt.id))
      setActiveInvitePrompt(null)
      setInvitePromptDismissed(false)
      try {
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem(DASHBOARD_INVITE_PROMPT_DISMISSED_KEY)
          if (activeInvitePrompt.source === 'token') sessionStorage.removeItem(PENDING_INVITE_KEY)
        }
      } catch {}
      clearInvitePromptQuery()
      if (action === 'accept') {
        await triggerDashboardServerPull()
        const refreshed = await refreshDashboardCommunities(undefined, true)
        if (refreshed) {
          setCommunities(refreshed)
          setCommunitiesLoaded(true)
        }
        const targetId = j.community_id || activeInvitePrompt.community_id
        navigate(j.next_url || `/community_feed_react/${targetId}`, { replace: true })
      }
    } catch {
      setInvitePromptError(`Could not ${action} this invitation. Please try again.`)
    } finally {
      setInviteActionLoading(null)
    }
  }

  const loadUserData = useCallback(async (forceRefresh = false) => {
    invalidateDashboardCache() // Clear stale/ghost profile cache on login/new build (ties to firestore_reads.get_steve_user_profile)
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
      // Don't overwrite cached data when offline â€” leave whatever the cache loaded
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

  useEffect(() => {
    if (!username && emailVerified == null) return
    void loadPendingCommunityInvites()
  }, [username, emailVerified, loadPendingCommunityInvites])

  useEffect(() => {
    if (pendingCommunityInvites.length === 0 || activeInvitePrompt) return
    if (invitePromptDismissed && !invitePromptRequested) return
    const nextInvite = pendingCommunityInvites[0]
    setActiveInvitePrompt(nextInvite)
    setInvitePromptError('')
    clearInvitePromptQuery()
  }, [
    activeInvitePrompt,
    clearInvitePromptQuery,
    invitePromptDismissed,
    invitePromptRequested,
    pendingCommunityInvites,
  ])

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
    setShowOnboardingWelcome(false)
  }, [username])

  const openOnboardingResume = useCallback(() => {
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
          }
    } catch {}
  }, [])

  // Rich Steve onboarding is optional enrichment. Server state only powers the
  // dashboard reminder card; it no longer blocks first-session community value.
  useEffect(() => {
    if (onboardingTriggeredRef.current) return
    if (!communitiesLoaded) return
    if (emailVerified !== true) return
    if (!Array.isArray(communities)) return
    if (!username) return
    if (showOnboarding) return
    if (showOnboardingWelcome) return
    if (activeInvitePrompt || pendingCommunityInvites.length > 0) return

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

      // Revived first-session intro: language + appearance (dark/light/system)
      // + welcome video/manifesto, shown once per account for newly verified
      // users. The 18+ AgeGate is app-level and stacks above this overlay, so
      // compliance still runs first. Marked seen on show so an abandoned
      // intro never re-nags.
      try {
        const introSeenKey = `cpoint:intro_gate_done:${username}`
        if (localStorage.getItem(introSeenKey) !== '1') {
          localStorage.setItem(introSeenKey, '1')
          setShowOnboardingWelcome(true)
        }
      } catch {}

      onboardingTriggeredRef.current = true
    })()
    // Intentionally omit `communities`: array identity changes on every parent-community refetch and caused
    // a one-shot "Starting onboarding..." flicker for users who exit without auto-opening Steve.
  }, [activeInvitePrompt, communitiesLoaded, emailVerified, emailVerifiedAt, username, showOnboarding, showOnboardingWelcome, doneKey, isRecentlyVerified, pendingCommunityInvites.length])

  // Parent-only creation: skip loading parent communities


  const hasAnyCommunity = communities.length > 0
  const {
    personal: personalSectionComplete,
    professional: professionalSectionComplete,
  } = getEffectiveProfileSectionStatus(onboardingStateSummary)
  const showOnboardingCompletionCard = shouldShowProfileHelpCard(onboardingStateSummary)
  // Host-register ask, one section at a time: personal copy only when the
  // professional section is already done (professional first by default).
  // Shares the feed card's strings so the two surfaces can't drift.
  const onboardingCardAskPersonal = !personalSectionComplete && professionalSectionComplete
  const onboardingCardTitle = t(onboardingCardAskPersonal ? 'feed.steve_ask_personal_title' : 'feed.steve_ask_professional_title')
  const onboardingCardBody = t(onboardingCardAskPersonal ? 'feed.steve_ask_personal_body' : 'feed.steve_ask_professional_body')
  const onboardingOverlayActive =
    showOnboarding || showOnboardingWelcome || onboardingLaunching || !!activeInvitePrompt
  const { setNavOverrides, clearNavOverrides } = useDashboardLayout()
  useEffect(() => {
    setNavOverrides({ show: !onboardingOverlayActive, searchOpen, onToggleSearch: () => setSearchOpen((v) => !v) })
    return clearNavOverrides
  }, [onboardingOverlayActive, searchOpen, setNavOverrides, clearNavOverrides])
  const communityFallback = t('dashboard.community_fallback')
  const resolvedCommunityName = (() => {
    if (pendingInviteTarget?.communityName) return pendingInviteTarget.communityName
    const targetId = pendingInviteTarget?.communityId ?? joinedCommunityId
    if (targetId) {
      const found = communities.find(c => c.id === targetId)
      if (found?.name) return found.name
    }
    return communities[0]?.name || communityFallback
  })()
  // Show skeleton shell while initial data loads (matches final layout to prevent CLS)
  if (initialLoading) {
    return (
      <div className="app-content min-h-screen chat-thread-bg text-c-text-primary relative">
        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:ml-52">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <SkeletonCommunityCard />
            <SkeletonCommunityCard />
            <SkeletonCommunityCard />
          </div>
        </div>
      </div>
    )
  }

    return (
      <div className="app-content min-h-screen chat-thread-bg text-c-text-primary relative">
      {/* Web uses shared HeaderBar from App.tsx, native platforms use old sidebar */}
      {!isWeb && (
      /* Desktop sidebar - only for native platforms (iOS/Android) */
      <div className="fixed left-0 top-14 bottom-0 w-52 hidden md:flex flex-col z-30 liquid-glass-surface border border-c-border rounded-r-3xl shadow-c-glass">
        <nav className="flex-1 overflow-y-auto py-3">
          <a className="block px-5 py-3 text-sm text-c-text-primary hover:bg-cpoint-turquoise/20 hover:text-cpoint-turquoise" href="/premium_dashboard">{t('navigation.dashboard')}</a>
          <a className="block px-5 py-3 text-sm text-c-text-primary hover:bg-cpoint-turquoise/20 hover:text-cpoint-turquoise" href="/profile">{t('navigation.profile')}</a>
          <a className="block px-5 py-3 text-sm text-c-text-primary hover:bg-cpoint-turquoise/20 hover:text-cpoint-turquoise" href="/user_chat">{t('navigation.messages')}</a>
          <a className="block px-5 py-3 text-sm text-c-text-primary hover:bg-cpoint-turquoise/20 hover:text-cpoint-turquoise" href="/followers">{t('navigation.followers')}</a>
          <a className="block px-5 py-3 text-sm text-c-text-primary hover:bg-cpoint-turquoise/20 hover:text-cpoint-turquoise" href="/builds">My Builds</a>
          {hasGymAccess && <a className="block px-5 py-3 text-sm text-c-text-primary hover:bg-cpoint-turquoise/20 hover:text-cpoint-turquoise" href="/your_sports">{t('dashboard.your_sports')}</a>}
          <button className="block w-full text-left px-5 py-3 text-sm text-c-text-primary hover:bg-cpoint-turquoise/20 hover:text-cpoint-turquoise" onClick={requestLogout}>{t('navigation.logout')}</button>
          <a className="block px-5 py-3 text-sm text-c-text-primary hover:bg-cpoint-turquoise/20 hover:text-cpoint-turquoise" href="/account_settings">
            <i className="fa-solid fa-cog mr-2" />{t('navigation.settings')}
          </a>
        </nav>
        {/* B2B pivot (June 2026): personal Premium upsell removed â€” plans hub
            now leads with community tiers, reached via the menu entry. */}
      </div>
      )}

      {/* page content starts below header via pt-14 */}

      {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="fixed top-14 left-0 right-0 bottom-0 z-40 md:hidden flex flex-col px-3">
            <nav className="flex-1 overflow-y-auto flex flex-col liquid-glass-surface border border-c-border rounded-3xl mt-3">
              <a className="px-5 py-3 border-b border-c-border" href="/dashboard" onClick={() => setMobileMenuOpen(false)}>{t('navigation.dashboard')}</a>
              <a className="px-5 py-3 border-b border-c-border" href="/profile" onClick={() => setMobileMenuOpen(false)}>{t('navigation.profile')}</a>
                <a className="px-5 py-3 border-b border-c-border" href="/user_chat" onClick={() => setMobileMenuOpen(false)}>{t('navigation.messages')}</a>
                <a className="px-5 py-3 border-b border-c-border" href="/followers" onClick={() => setMobileMenuOpen(false)}>{t('navigation.followers')}</a>
              {hasGymAccess && <a className="px-5 py-3 border-b border-c-border" href="/your_sports" onClick={() => setMobileMenuOpen(false)}>{t('dashboard.your_sports')}</a>}
              <button className="w-full text-left px-5 py-3 border-b border-c-border" onClick={(e) => { setMobileMenuOpen(false); requestLogout(e) }}>{t('navigation.logout')}</button>
              <a className="px-5 py-3" href="/account_settings" onClick={() => setMobileMenuOpen(false)}><i className="fa-solid fa-cog mr-2" />{t('navigation.settings')}</a>
            </nav>
            <div className="px-4 py-4">
              <button
                type="button"
                  className="w-full rounded-2xl liquid-glass-chip border border-cpoint-turquoise/30 px-4 py-3 text-sm font-semibold text-c-text-primary tracking-[0.2em] uppercase shadow-c-card hover:shadow-c-glass transition"
                onClick={() => {
                  setMobileMenuOpen(false)
                  navigate('/subscription_plans')
                }}
              >
                {t('dashboard.premium')}
              </button>
            </div>
          </div>
        )}

      {/* Main content area with proper positioning */}
      <div
        className={`min-h-screen pb-[var(--app-dashboard-content-pad-bottom)] ${isWeb ? 'lg:ml-64' : 'md:ml-52'}`}
      >
        <div className="app-content max-w-5xl mx-auto px-3 py-6">
          {showOnboardingCompletionCard && (
            <div className="mb-4 rounded-2xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 p-4 shadow-c-card">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-base font-semibold text-c-text-primary">{onboardingCardTitle}</div>
                  {/* No countdown, no per-section status pills: deadlines are
                      manufactured urgency and pills are progress framing —
                      both banned by the ask register. Title + one line + CTA. */}
                  <p className="mt-1 text-sm leading-relaxed text-c-text-secondary">
                    {onboardingCardBody}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    // When exactly one section is missing, open the scoped
                    // 2-minute builder for that section — the full chat
                    // (name/photo/section picker) is only right for a
                    // completely fresh profile.
                    if (personalSectionComplete && !professionalSectionComplete) {
                      navigate('/steve/profile-builder/professional')
                    } else if (professionalSectionComplete && !personalSectionComplete) {
                      navigate('/steve/profile-builder/personal')
                    } else {
                      openOnboardingResume()
                    }
                  }}
                  className="shrink-0 rounded-xl bg-cpoint-turquoise px-4 py-2.5 text-sm font-semibold text-black transition hover:brightness-110"
                >
                  {t(onboardingCardAskPersonal ? 'feed.steve_ask_personal_cta' : 'feed.steve_ask_professional_cta')}
                </button>
              </div>
            </div>
          )}
          {hasCoarsePointer && (
          <div
            className="sticky top-0 z-20 mb-3 flex justify-center pointer-events-none transition-transform duration-150"
            style={{ transform: `translateY(${Math.min(pullPx * 0.5, 30)}px)` }}
          >
            {/* Revealed by the pull itself — invisible at rest so the hint
                never competes with content as a permanent instruction. */}
            <span
              className={`rounded-full border border-c-border bg-c-bg-app/70 px-4 py-1 text-[11px] text-c-text-tertiary transition-opacity flex items-center gap-2 ${
                pullHint === 'idle' ? 'opacity-0' : 'opacity-100'
              }`}
            >
              {pullHint === 'refreshing' ? (
                <>
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {t('feed.refreshing')}
                </>
              ) : pullHint === 'ready' ? (
                <>
                  <i className="fa-solid fa-arrow-down text-[10px]" />
                  {t('feed.release_to_refresh')}
                </>
              ) : (
                <>
                  <i className="fa-solid fa-arrow-down text-[10px]" />
                  {t('feed.pull_down_to_refresh')}
                </>
              )}
            </span>
          </div>
          )}
            {!communitiesLoaded ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <SkeletonCommunityCard />
                <SkeletonCommunityCard />
                <SkeletonCommunityCard />
              </div>
            ) : communities.length === 0 ? (
              <DashboardEmptyState
                onCreate={() => { setNewCommType('General'); setShowCreateModal(true) }}
                onJoin={() => setShowJoinModal(true)}
                onAbout={() => setShowAboutCPointModal(true)}
              />
            ) : (
            <>
              {searchOpen && (
                <div className="mb-4">
                  <div className="relative w-full max-w-xl">
                    <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-c-text-tertiary text-sm pointer-events-none" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder={t('navigation.search_communities')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 rounded-xl bg-c-hover-bg border border-c-border text-sm text-c-text-primary placeholder-c-text-tertiary focus:outline-none focus:border-cpoint-turquoise/40"
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
                    {/* Steve's spotlight question — at most one ask per screen:
                        the reminder card outranks it. */}
                    {!showOnboardingCompletionCard && <SpotlightAsk />}

                    {/* Find a community — the door for handles shared outside
                        the app (the Join modal opens handle-first). */}
                    <button
                      type="button"
                      onClick={() => setShowJoinModal(true)}
                      aria-label={t('communities.find_entry_aria')}
                      className="flex h-11 w-full items-center gap-3 rounded-2xl border border-c-border bg-c-bg-elevated px-3 text-left transition hover:bg-c-hover-bg active:scale-[0.99]"
                    >
                      <i className="fa-solid fa-at text-sm text-c-text-tertiary" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-c-text-primary">
                        {t('communities.find_entry_label')}
                      </span>
                      <i className="fa-solid fa-chevron-right text-xs text-c-text-tertiary" aria-hidden="true" />
                    </button>

                    {/* My Builds — direct access to Steve Build creations without
                        remembering which community they were made in. */}
                    <button
                      type="button"
                      onClick={() => navigate('/builds')}
                      aria-label="My Builds"
                      className="flex h-11 w-full items-center gap-3 rounded-2xl border border-c-border bg-c-bg-elevated px-3 text-left transition hover:bg-c-hover-bg active:scale-[0.99]"
                    >
                      <i className="fa-solid fa-wand-magic-sparkles text-sm text-cpoint-turquoise" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-c-text-primary">
                        My Builds
                      </span>
                      <i className="fa-solid fa-chevron-right text-xs text-c-text-tertiary" aria-hidden="true" />
                    </button>

                    {/* Owner/Admin Section */}
                    {ownedOrAdmin.length > 0 && (
                      <>
                        {/* Separator - Owner/Admin of */}
                        <div className="flex items-center gap-3 py-1">
                          <div className="h-px flex-1 bg-c-active-bg" />
                          <span className="text-[10px] uppercase tracking-wider text-c-text-tertiary font-medium">{t('dashboard.owner_admin_section')}</span>
                          <div className="h-px flex-1 bg-c-active-bg" />
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
                          <div className="h-px flex-1 bg-c-active-bg" />
                          <span className="text-[10px] uppercase tracking-wider text-c-text-tertiary font-medium">{t('dashboard.member_of_section')}</span>
                          <div className="h-px flex-1 bg-c-active-bg" />
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
                      <div className="text-center py-8 text-c-text-tertiary text-sm">
                        {t('dashboard.no_search_results', { query: searchQuery })}
                      </div>
                    )}
                  </div>
                )
              })()}
            </>
            )}
        </div>

        {communities.length > 0 && !onboardingOverlayActive && (
          <button
            type="button"
            aria-label={t('dashboard.create_community_short')}
            className="fixed bottom-[calc(var(--app-dashboard-bottom-nav-height)+1.25rem)] right-5 z-[120] flex h-16 w-16 items-center justify-center rounded-full bg-cpoint-turquoise text-3xl font-light leading-none text-black shadow-[0_12px_34px_rgba(0,206,200,0.36)] transition hover:brightness-110 active:scale-95 touch-manipulation"
            onClick={() => {
              setNewCommType('General')
              setShowCreateModal(true)
            }}
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            +
          </button>
        )}

        {/* DashboardBottomNav is now rendered by DashboardLayout (persistent across tabs) */}
      </div>

      {/* Conversational Onboarding â€” portaled to body so z-index clears dashboard nav (main is z-0). */}
      {onboardingOverlayActive && typeof document !== 'undefined' && createPortal(
        <>
          {showOnboardingWelcome && !showOnboarding && (
            <OnboardingIntroGate
              onStart={() => {
                setShowOnboardingWelcome(false)
                setOnboardingLaunching(true)
                setShowOnboarding(true)
              }}
            />
          )}
          {/* The hard "finish your profile" wall is gone for good: the rich
              Steve onboarding is invited (cards, gates with payoff), never
              forced. Tier-1 basics are collected in the intro gate's You page. */}
          {onboardingLaunching && !showOnboarding && (
            <div className="fixed inset-0 z-[1200] bg-c-bg-overlay backdrop-blur-sm flex items-center justify-center px-6">
              <div className="flex flex-col items-center gap-4 text-center">
                <BrandLogo className="w-14 h-14 rounded-2xl object-contain" />
                <div className="w-8 h-8 rounded-full border-2 border-c-border border-t-cpoint-turquoise animate-spin" />
                <div className="text-sm text-c-text-tertiary">{t('dashboard.opening_steve')}</div>
              </div>
            </div>
          )}
          {showOnboarding && (
            <OnboardingChat
              firstName={firstName}
              lastName={lastName}
              username={username}
              displayName={displayName}
              communityName={resolvedCommunityName !== communityFallback ? resolvedCommunityName : null}
              hasCommunity={hasAnyCommunity}
              existingProfilePic={existingProfilePic}
              mode={onboardingMode}
              onComplete={() => {
                setShowOnboarding(false)
                setShowOnboardingWelcome(false)
                setOnboardingLaunching(false)
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
        </>,
        document.body
      )}

      {activeInvitePrompt && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-c-bg-app/80 px-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-3xl border border-c-border bg-c-bg-elevated p-5 shadow-c-glass">
            <div className="mb-5 flex justify-center">
              <BrandLogo className="h-10 w-auto" />
            </div>
            <div className="rounded-2xl border border-cpoint-turquoise/25 bg-cpoint-turquoise/10 p-5 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cpoint-turquoise/20 text-cpoint-turquoise">
                <i className="fa-solid fa-user-plus text-xl" />
              </div>
              <p className="text-xs uppercase tracking-wide text-c-text-tertiary">Community invitation</p>
              <h2 className="mt-2 text-2xl font-semibold text-c-text-primary">
                {activeInvitePrompt.community_name || 'Private community'}
              </h2>
              <p className="mt-2 text-sm text-c-text-secondary">
                {activeInvitePrompt.invited_by_username
                  ? `${activeInvitePrompt.invited_by_username} invited you to join this C-Point community.`
                  : 'You have been invited to join this C-Point community.'}
              </p>
              {activeInviteExpiryText ? (
                <p className={`mt-3 text-xs ${activeInvitePrompt.expired ? 'text-red-300' : 'text-c-text-tertiary'}`}>
                  {activeInvitePrompt.expired ? 'Expired' : 'Valid until'} {activeInviteExpiryText}
                </p>
              ) : null}
            </div>

            {activeInvitePrompt.expired ? (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                This invitation expired. Ask the sender for a new invite.
              </div>
            ) : null}

            {invitePromptError ? (
              <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {invitePromptError.toLowerCase().includes('different email')
                  ? 'This invite was sent to a different email. Sign in with that email, or ask the sender to invite your current account.'
                  : invitePromptError}
              </div>
            ) : null}

            <div className="mt-5 space-y-2">
              {!activeInvitePrompt.expired ? (
                <button
                  className="flex w-full items-center justify-center rounded-xl bg-cpoint-turquoise px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
                  disabled={inviteActionLoading !== null || invitePromptLoading}
                  onClick={() => { void respondToDashboardInvite('accept') }}
                >
                  {inviteActionLoading === 'accept'
                    ? 'Joining...'
                    : `Join ${activeInvitePrompt.community_name || 'community'}`}
                </button>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <button
                  className="rounded-xl border border-c-border bg-c-hover-bg px-4 py-3 text-sm font-semibold text-c-text-primary disabled:opacity-50"
                  disabled={inviteActionLoading !== null}
                  onClick={dismissInvitePromptForSession}
                >
                  Not now
                </button>
                <button
                  className="rounded-xl border border-c-border bg-transparent px-4 py-3 text-sm text-c-text-secondary disabled:opacity-50"
                  disabled={inviteActionLoading !== null}
                  onClick={() => { void respondToDashboardInvite('decline') }}
                >
                  {inviteActionLoading === 'decline' ? 'Declining...' : 'Decline'}
                </button>
              </div>
              <button
                className="w-full rounded-xl px-4 py-2 text-xs font-medium text-cpoint-turquoise"
                onClick={() => navigate('/notifications?tab=invites')}
              >
                View all invitations
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Verify email first modal */}
      {showVerifyFirstModal && (
        <div className="fixed inset-0 z-50 bg-c-bg-app/70 backdrop-blur flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && setShowVerifyFirstModal(false)}>
          <div className="w-[92%] max-w-sm rounded-2xl border border-c-border bg-c-bg-app p-4">
            <div className="font-semibold text-sm mb-2">{t('dashboard.verify_email_title')}</div>
            <div className="text-sm text-c-text-tertiary">{t('dashboard.verify_email_body')}</div>
            <div className="flex items-center justify-end gap-2 mt-3">
              <button className="px-3 py-2 rounded-md bg:white/10 hover:bg:white/15" onClick={()=> setShowVerifyFirstModal(false)}>{t('common.close')}</button>
              <button className="px-3 py-2 rounded-md bg-cpoint-turquoise text-black hover:brightness-110" onClick={async()=>{ try{ await fetch('/resend_verification', { method:'POST', credentials:'include' }) }catch{} alert(t('dashboard.verification_sent_rate_limit')); setShowVerifyFirstModal(false) }}>{t('dashboard.resend_email')}</button>
            </div>
          </div>
        </div>
      )}

      <AboutCPointModal open={showAboutCPointModal} onClose={() => setShowAboutCPointModal(false)} />

      {/* Communities modal removed; dashboard links use /communities?parent_id= */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 bg-c-bg-app/70 backdrop-blur flex items-center justify-center" onClick={(e)=> { if (e.currentTarget===e.target) handleCloseCreateModal() }}>
          <div className="w-[92%] max-w-sm rounded-2xl border border-c-border bg-c-bg-app p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-sm">{t('dashboard.create_community_title')}</div>
                <button className="p-2 rounded-md hover:bg:white/5" onClick={handleCloseCreateModal} aria-label={t('common.close')}><i className="fa-solid fa-xmark"/></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-c-text-tertiary mb-1">{t('dashboard.community_name_parent_label')}</label>
                <input
                  value={newCommName}
                  onChange={e=> {
                    setNewCommName(e.target.value)
                    if (!handleEdited) setNewCommHandle(normalizeHandleInput(e.target.value))
                  }}
                  placeholder={t('dashboard.community_name_parent_placeholder')}
                  className="w-full px-3 py-2 rounded-md bg-c-bg-app border border:white/15 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-c-text-tertiary mb-1">{t('communities.handle_section_title')}</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-c-text-tertiary text-sm">@</span>
                  <input
                    value={newCommHandle}
                    onChange={e=> { setHandleEdited(true); setNewCommHandle(normalizeHandleInput(e.target.value)) }}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                    className="w-full pl-7 pr-3 py-2 rounded-md bg-c-bg-app border border:white/15 text-sm text-c-text-primary"
                  />
                </div>
                <div className="text-[11px] text-c-text-tertiary mt-1">{t('communities.handle_helper')}</div>
              </div>
                <div>
                  <label className="block text-xs text-c-text-tertiary mb-1">{t('dashboard.community_type_label')}</label>
                  {isAppAdmin ? (
                    <select value={newCommType} onChange={e=> setNewCommType(e.target.value as any)} className="w-full px-3 py-2 rounded-md bg-c-bg-app border border:white/15 text-sm">
                      <option value="General">{t('dashboard.type_general')}</option>
                      <option value="Gym">{t('dashboard.type_gym')}</option>
                      <option value="University">{t('dashboard.type_university')}</option>
                      <option value="Business">{t('dashboard.type_business')}</option>
                    </select>
                  ) : (
                    <div className="w-full px-3 py-2 rounded-md bg-c-bg-app/50 border border-c-border text-sm text-c-text-tertiary">
                      {t('dashboard.type_general')}
                    </div>
                  )}
                </div>
              <div className="text-xs text-c-text-tertiary">{t('dashboard.create_parent_hint')}</div>
                <div className="flex items-center justify-end gap-2">
                  <button className="px-3 py-2 rounded-md bg:white/10 hover:bg:white/15" onClick={handleCloseCreateModal} disabled={isCreatingCommunity}>{t('common.cancel')}</button>
                    <button 
                      className="px-3 py-2 rounded-md bg-cpoint-turquoise text-black hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed" 
                      disabled={isCreatingCommunity}
                      onClick={async()=> {
                        if (isCreatingCommunity) return
                        if (!newCommName.trim()) { alert(t('dashboard.name_required')); return }
                        setIsCreatingCommunity(true)
                        try{
                          const fd = new URLSearchParams({ name: newCommName.trim(), type: isAppAdmin ? newCommType : 'General' })
                          if (newCommHandle.trim()) fd.set('handle', newCommHandle.trim())
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
                            alert(j?.error || t('dashboard.create_community_failed'))
                            setIsCreatingCommunity(false)
                          }
                        }catch{ 
                          alert(t('dashboard.create_community_failed'))
                          setIsCreatingCommunity(false)
                        }
                      }}
                    >{isCreatingCommunity ? t('dashboard.creating') : t('communities.create')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 bg-c-bg-app/70 backdrop-blur flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && setShowJoinModal(false)}>
          <div className="w-[92%] max-w-sm rounded-2xl border border-c-border bg-c-bg-app p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-sm">{t('dashboard.join_community_title')}</div>
              <button className="p-2 rounded-md hover:bg:white/5" onClick={()=> setShowJoinModal(false)} aria-label={t('common.close')}><i className="fa-solid fa-xmark"/></button>
            </div>
            {/* Handle-only: the legacy join-by-code path is gone (its
                endpoint never existed in this backend). */}
            <JoinByHandlePanel onJoinedNavigate={() => setShowJoinModal(false)} />
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
  const { t } = useTranslation()
  const lastActiveText = formatLastActive(lastActivity, t)
  const badge = isOwner ? t('feed.owner') : isAdmin ? t('feed.admin') : null
  const descText = typeof description === 'string' ? description.trim() : ''
  const unread = unreadPostsCount ?? 0

  return (
    <button
      onClick={onClick}
      aria-label={name}
      className="group relative flex min-h-[8.5rem] w-full rounded-2xl overflow-hidden text-c-text-primary transition-all duration-300 liquid-glass-surface border border-c-border hover:border-cpoint-turquoise/40 shadow-c-glass hover:shadow-c-glass hover:-translate-y-0.5 text-left"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{
          background:
            'radial-gradient(600px circle at var(--x,50%) var(--y,50%), rgba(0,206,200,0.18), transparent 45%)',
        }}
      />

      <div className="relative flex flex-col gap-3 p-6 sm:p-7">
        <div className="w-full min-w-0">
          <div
            className={`text-[17px] font-semibold tracking-tight text-c-text-secondary leading-tight${badge ? ' pr-16 sm:pr-20' : ''}`}
          >
            {name}
          </div>
        </div>

        {descText.length > 0 ? (
          <p className="text-[11.5px] text-c-text-tertiary leading-relaxed line-clamp-3">
            {descText}
          </p>
        ) : isOwner || isAdmin ? (
          <p className="text-[11.5px] text-c-text-tertiary leading-relaxed italic">
            {t('dashboard.no_description_add_manage')}
          </p>
        ) : (
          <p className="text-[11.5px] text-c-text-tertiary leading-relaxed">
            {t('dashboard.no_description_yet')}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-c-text-tertiary pt-1">
          {typeof memberCount === 'number' && (
            <span className="flex items-center gap-1.5">
              <i className="fa-solid fa-users text-[10px] text-cpoint-turquoise drop-shadow-[0_0_8px_rgba(0,206,200,0.45)]" aria-hidden />
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
        <span className="pointer-events-none absolute top-4 right-4 sm:top-5 sm:right-5 z-10 flex-shrink-0 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide rounded-full bg-cpoint-turquoise/20 text-cpoint-turquoise border border-cpoint-turquoise/30">
          {badge}
        </span>
      )}

      {unread > 0 && (
        <span className="pointer-events-none absolute bottom-4 right-4 sm:bottom-5 sm:right-5 z-10 flex-shrink-0 px-2 py-0.5 text-[10px] font-medium rounded-full bg-cpoint-turquoise/20 text-cpoint-turquoise border border-cpoint-turquoise/30">
          {t('dashboard.new_posts', { count: unread })}
        </span>
      )}

      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-cpoint-turquoise/60 to-transparent opacity-80" />
    </button>
  )
}

