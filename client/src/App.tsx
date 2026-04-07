import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { Keyboard, KeyboardResize } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import { BrowserRouter, Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom'
import { extractInviteToken, joinCommunityWithInvite } from './utils/internalLinkHandler'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ErrorBoundary from './components/ErrorBoundary'
import MobileLogin from './pages/MobileLogin'
import PremiumDashboard from './pages/PremiumDashboard'
import HeaderBar from './components/HeaderBar'
import { HeaderContext } from './contexts/HeaderContext'
import { UserProfileContext, type UserProfile } from './contexts/UserProfileContext'
import PushInit from './components/PushInit'
import NotificationPrompt from './components/NotificationPrompt'
import { NetworkProvider } from './contexts/NetworkContext'
import { BadgeProvider } from './contexts/BadgeContext'
import OfflineBanner from './components/OfflineBanner'
import OutboxDrainer from './components/OutboxDrainer'
// import NativePushInit from './components/NativePushInit' // Disabled - conflicts with PushInit
import BrandAssetsInit from './components/BrandAssetsInit'
// Encryption removed — not in use
import CrossfitExact from './pages/CrossfitExact'
import CommunityFeed from './pages/CommunityFeed'
import CommunityCalendar from './pages/CommunityCalendar'
import CommunityTasks from './pages/CommunityTasks'
import CommunityPolls from './pages/CommunityPolls'
import CommunityResources from './pages/CommunityResources'
import UsefulLinks from './pages/UsefulLinks'
import CommunityPhotos from './pages/CommunityPhotos'
import PostDetail from './pages/PostDetail'
import CreatePost from './pages/CreatePost'
import Members from './pages/Members'
import EditCommunity from './pages/EditCommunity'
import Communities from './pages/Communities'
import Followers from './pages/Followers'
import Networking from './pages/Networking'
import HomeTimeline from './pages/HomeTimeline'
import WorkoutTracking from './pages/WorkoutTracking'
import Gym from './pages/Gym'
import YourSports from './pages/YourSports'
import Messages from './pages/Messages'
import NewMessage from './pages/NewMessage'
import ChatThread from './pages/ChatThread'
import GroupChatThread from './pages/GroupChatThread'
import GroupChatMedia from './pages/GroupChatMedia'
import ChatMedia from './pages/ChatMedia'
import Profile from './pages/Profile'
import SteveKnowsMe from './pages/SteveKnowsMe'
import PublicProfile from './pages/PublicProfile'
import AccountSettings from './pages/AccountSettings'
import AccountSecurity from './pages/AccountSecurity'
import AccountDangerZone from './pages/AccountDangerZone'
import SubscriptionPlans from './pages/SubscriptionPlans'
import Signup from './pages/Signup'
import Notifications from './pages/Notifications'
import AdminDashboard from './pages/AdminDashboard'
import AdminProfile from './pages/AdminProfile'
import KeyPosts from './pages/KeyPosts'
import OnboardingWelcome from './pages/OnboardingWelcome'
import VerifyOverlay from './components/VerifyOverlay'
import EventDetail from './pages/EventDetail'
import GroupFeed from './pages/GroupFeed'
import EditGroup from './pages/EditGroup'
// EncryptionSettings removed — not in use
import CommentReply from './pages/CommentReply'

const queryClient = new QueryClient()

function AppRoutes(){
  const [title, setTitle] = useState('')
  const [headerHiddenOverride, setHeaderHiddenOverride] = useState(false)
  const [userMeta, setUserMeta] = useState<{ username?:string; displayName?:string|null; avatarUrl?:string|null }>({})
  const location = useLocation()
  const isFirstPage = location.pathname === '/'
  const navigate = useNavigate()
  const [authLoaded, setAuthLoaded] = useState(false)
  const [isVerified, setIsVerified] = useState<boolean | null>(null)
  // const [hasCommunities, setHasCommunities] = useState<boolean | null>(null)
  const [requireVerification] = useState(() => (import.meta as any).env?.VITE_REQUIRE_VERIFICATION_CLIENT === 'true')
  const [profileData, setProfileData] = useState<UserProfile>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const isChatRoute = location.pathname.startsWith('/user_chat/chat/') || location.pathname.startsWith('/group_chat/')

  const locationRef = useRef(location.pathname)
  const scrollRegionRef = useRef<HTMLDivElement | null>(null)
  const publicPaths = useMemo(
    () => new Set(['/', '/welcome', '/onboarding', '/login', '/signup', '/signup_react', '/verify_required']),
    [],
  )
  const applyKeyboardOffset = useCallback((nextOffset: number) => {
    setKeyboardOffset(prev => (Math.abs(prev - nextOffset) < 1 ? prev : nextOffset))
    document.documentElement.style.setProperty('--keyboard-offset', `${nextOffset}px`)
    if (document.body) {
      document.body.dataset.keyboard = nextOffset > 0 ? 'open' : 'closed'
    }
  }, [])

  useLayoutEffect(() => {
    if (isChatRoute) {
      applyKeyboardOffset(0)
      return
    }
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const viewport = window.visualViewport
    if (!viewport) return

    let rafId: number | null = null

    const updateOffset = () => {
      const nextOffset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      applyKeyboardOffset(nextOffset)
    }

    const handleChange = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updateOffset)
    }

    viewport.addEventListener('resize', handleChange)
    viewport.addEventListener('scroll', handleChange)
    updateOffset()

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', handleChange)
      viewport.removeEventListener('scroll', handleChange)
      document.documentElement.style.removeProperty('--keyboard-offset')
      if (document.body) {
        delete document.body.dataset.keyboard
      }
    }
  }, [applyKeyboardOffset, isChatRoute])

  useEffect(() => {
    if (Capacitor.getPlatform() === 'web') return

    Keyboard.setResizeMode({ mode: KeyboardResize.None }).catch(() => {})
    Keyboard.setScroll({ isDisabled: true }).catch(() => {})

    if (isChatRoute) return

    let showSub: PluginListenerHandle | undefined
    let hideSub: PluginListenerHandle | undefined

    const handleShow = (info: KeyboardInfo) => {
      const height = info?.keyboardHeight ?? 0
      applyKeyboardOffset(height)
    }

    const handleHide = () => {
      applyKeyboardOffset(0)
    }

    Keyboard.addListener('keyboardWillShow', handleShow).then(handle => {
      showSub = handle
    })
    Keyboard.addListener('keyboardWillHide', handleHide).then(handle => {
      hideSub = handle
    })

    return () => {
      showSub?.remove()
      hideSub?.remove()
      applyKeyboardOffset(0)
    }
  }, [applyKeyboardOffset, isChatRoute])

  // State for deep link join modal
  const [deepLinkJoin, setDeepLinkJoin] = useState<{ name: string; id: number } | null>(null)
  
  // Track processed URLs to prevent infinite loops - use sessionStorage for persistence across page reloads
  const processedUrlsRef = useRef<Set<string>>(new Set())
  
  // Initialize from sessionStorage on first render
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('cpoint_processed_deep_links')
      if (stored) {
        const urls = JSON.parse(stored) as string[]
        urls.forEach(url => processedUrlsRef.current.add(url))
      }
    } catch {
      // Ignore
    }
  }, [])
  
  // Helper to mark URL as processed (persists in sessionStorage)
  const markUrlProcessed = useCallback((url: string) => {
    processedUrlsRef.current.add(url)
    try {
      sessionStorage.setItem('cpoint_processed_deep_links', JSON.stringify([...processedUrlsRef.current]))
    } catch (e) {
      console.warn('🔗 Failed to persist processed URLs:', e)
    }
  }, [])
  
  // Helper to check if URL was already processed
  const isUrlProcessed = useCallback((url: string): boolean => {
    // Also check sessionStorage in case ref wasn't initialized
    if (processedUrlsRef.current.has(url)) return true
    try {
      const stored = sessionStorage.getItem('cpoint_processed_deep_links')
      if (stored) {
        const urls = JSON.parse(stored) as string[]
        if (urls.includes(url)) {
          processedUrlsRef.current.add(url)
          return true
        }
      }
    } catch {
      // Ignore
    }
    return false
  }, [])

  // Handle deep links (Universal Links) when app is opened from external sources
  // IMPORTANT: Wait for authLoaded before processing to avoid race conditions
  useEffect(() => {
    if (Capacitor.getPlatform() === 'web') return
    // Don't process deep links until auth state is known
    if (!authLoaded) {
      console.log('🔗 Waiting for auth to load before processing deep links...')
      return
    }

    let listenerHandle: PluginListenerHandle | undefined

    const handleDeepLink = async (url: string, source: string) => {
      console.log(`🔗 Deep link received (${source}):`, url)
      
      // Prevent processing the same URL multiple times (persisted check)
      if (isUrlProcessed(url)) {
        console.log('🔗 URL already processed (persisted), skipping:', url)
        return
      }
      
      // Check if this is an invite link
      const inviteToken = extractInviteToken(url)
      if (inviteToken) {
        console.log('🔗 Invite token found:', inviteToken)
        
        const currentUrl = window.location.href
        const currentPath = window.location.pathname
        
        // Check if we're already on the login page with this invite token
        if (currentUrl.includes(`invite=${inviteToken}`)) {
          console.log('🔗 Already on login page with this invite token, skipping redirect')
          markUrlProcessed(url)
          return
        }
        
        // Check if we're already on a community feed page (prevent redirect loop)
        if (currentPath.startsWith('/community_feed_react/')) {
          console.log('🔗 Already on community feed, marking URL as processed')
          markUrlProcessed(url)
          return
        }
        
        // Mark as processed BEFORE any async operations
        markUrlProcessed(url)
        
        // Store invite token immediately so it persists through login flow
        try {
          sessionStorage.setItem('cpoint_pending_invite', JSON.stringify({ inviteToken }))
          console.log('🔗 Stored invite token in sessionStorage')
        } catch (e) {
          console.error('🔗 Failed to store invite token:', e)
        }
        
        // If user is already logged in (profileData exists), try to join
        if (profileData) {
          console.log('🔗 User is authenticated, attempting to join community')
          try {
            const result = await joinCommunityWithInvite(inviteToken)
            console.log('🔗 Join result:', result)
            
            if (result.success && result.communityId) {
              // Successfully joined - show modal and navigate
              if (result.communityName) {
                setDeepLinkJoin({ name: result.communityName, id: result.communityId })
                // Auto-dismiss and navigate after 2.5 seconds
                setTimeout(() => {
                  setDeepLinkJoin(null)
                  navigate(`/community_feed_react/${result.communityId}`)
                }, 2500)
              } else {
                navigate(`/community_feed_react/${result.communityId}`)
              }
            } else if (result.alreadyMember && result.communityId) {
              // Already a member - just navigate (use navigate instead of window.location.href)
              console.log('🔗 Already a member, navigating to community')
              navigate(`/community_feed_react/${result.communityId}`)
            } else {
              // Join failed for some reason (but user is logged in)
              console.log('🔗 Join failed but user is logged in:', result.error)
              // Don't redirect to login - user is already logged in
              // The error will be shown in the community if they navigate there
            }
          } catch (err) {
            console.error('🔗 Error processing invite:', err)
            // Don't redirect to login on error if user is already logged in
          }
        } else {
          console.log('🔗 User not authenticated, redirecting to login with invite token')
          // User not authenticated - redirect to login with invite token
          // Use navigate instead of window.location.href to avoid page reload
          navigate(`/login?invite=${inviteToken}`)
        }
      }
    }

    // Listen for app URL open events (Universal Links)
    CapacitorApp.addListener('appUrlOpen', (event: { url: string }) => {
      console.log('🔗 appUrlOpen event:', event.url)
      handleDeepLink(event.url, 'appUrlOpen')
    }).then((handle: PluginListenerHandle) => {
      listenerHandle = handle
    })

    // Also check if app was launched with a URL (only once when auth is loaded)
    CapacitorApp.getLaunchUrl().then((result) => {
      if (result?.url) {
        console.log('🔗 App launched with URL:', result.url)
        handleDeepLink(result.url, 'getLaunchUrl')
      }
    }).catch(() => {})

    return () => {
      listenerHandle?.remove()
    }
  }, [navigate, authLoaded, profileData, isUrlProcessed, markUrlProcessed])

  const resetScrollPosition = useCallback(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const scrollToTop = (target: any) => {
      if (!target) return
      if (typeof target.scrollTo === 'function') {
        try {
          target.scrollTo({ top: 0, left: 0, behavior: 'auto' })
          return
        } catch {
          try {
            target.scrollTo(0, 0)
            return
          } catch {
            // ignore
          }
        }
      }
      if (typeof target.scrollTop === 'number') {
        target.scrollTop = 0
      }
    }

    const candidates: any[] = [
      scrollRegionRef.current,
      document.scrollingElement,
      document.documentElement,
      document.body,
    ]

    candidates.forEach(scrollToTop)

    if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'auto' })
    }

    const scrollableSelectors = [
      '.overflow-y-auto',
      '.overflow-auto',
      '.overflow-scroll',
      '.no-scrollbar',
      '[data-scroll-region-child]',
      '[data-scrollable]',
    ]

    if (scrollRegionRef.current && scrollableSelectors.length) {
      try {
        const nodes = scrollRegionRef.current.querySelectorAll<HTMLElement>(scrollableSelectors.join(','))
        nodes.forEach(node => {
          const style = window.getComputedStyle(node)
          const overflowY = style.overflowY || style.overflow
          const isScrollable = /auto|scroll/i.test(overflowY)
          if (!isScrollable) return
          if (node.scrollHeight - node.clientHeight <= 1) return
          if (typeof node.scrollTo === 'function') {
            node.scrollTo({ top: 0, behavior: 'auto' })
          } else {
            node.scrollTop = 0
          }
        })
      } catch (err) {
        console.warn('scroll reset failed', err)
      }
    }
  }, [])

  const loadProfile = useCallback(async (path?: string): Promise<UserProfile> => {
    const currentPath = path ?? locationRef.current
    setProfileLoading(true)
    setProfileError(null)

    if (!navigator.onLine) {
      try {
        const cached = JSON.parse(localStorage.getItem('cached_profile') || '')
        if (cached) {
          setProfileData(cached)
          setIsVerified(!!(cached as any)?.email_verified)
          setProfileError(null)
          setProfileLoading(false)
          setAuthLoaded(true)
          return cached
        }
      } catch { /* no cached profile */ }
      setProfileData(null)
      setProfileError('Offline')
      setProfileLoading(false)
      setAuthLoaded(true)
      return null
    }

    try {
      const response = await fetch(`/api/profile_me?_t=${Date.now()}`, { 
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' }
      })
      if (response.status === 401) {
        setProfileData(null)
        setIsVerified(null)
        try { localStorage.removeItem('cached_profile') } catch {}
        if (!publicPaths.has(currentPath)) {
          window.location.href = '/'
        } else {
          setAuthLoaded(true)
        }
        return null
      }
      if (response.status === 403) {
        setProfileData(null)
        setIsVerified(false)
        return null
      }
      if (!response.ok) {
        throw new Error(`Profile fetch failed: ${response.status}`)
      }
      const json = await response.json().catch(() => null)
      if (json?.success && json.profile) {
        const profile = json.profile as UserProfile
        setProfileData(profile)
        setIsVerified(!!(profile as any)?.email_verified)
        setProfileError(null)
        try { localStorage.setItem('cached_profile', JSON.stringify(profile)) } catch {}

        const username = (profile as any)?.username
        
        // Detect user change and clear stale caches from previous user
        const previousUsername = localStorage.getItem('current_username')
        if (username && previousUsername && previousUsername !== username) {
          const keysToRemove = ['home-timeline', 'communityManagementShowNested']
          const prefixesToClear = ['community_', 'chat_', 'dashboard-', 'community-feed:', 'group-feed:']
          
          try {
            keysToRemove.forEach(key => localStorage.removeItem(key))
            Object.keys(localStorage).forEach(key => {
              if (prefixesToClear.some(prefix => key.startsWith(prefix))) {
                localStorage.removeItem(key)
              }
            })
          } catch (e) {
            console.warn('Error clearing localStorage for user change:', e)
          }
          
          if ('caches' in window) {
            caches.keys().then(names => {
              names.forEach(name => {
                if (name.includes('runtime') || name.includes('cp-')) {
                  caches.delete(name)
                }
              })
            }).catch(() => {})
          }
          
          try {
            import('./utils/avatarCache').then(({ clearAllAvatarCache }) => clearAllAvatarCache()).catch(() => {})
          } catch {}
        }
        
        if (username) {
          localStorage.setItem('current_username', username)
        }

        // Prefetch countries list so Edit Profile loads instantly
        if (!sessionStorage.getItem('geo_countries')) {
          fetch('/api/geo/countries', { credentials: 'include' })
            .then(r => r.json())
            .then(d => {
              if (d?.success && Array.isArray(d.countries)) {
                const names = d.countries
                  .map((item: any) => typeof item?.name === 'string' ? item.name : null)
                  .filter(Boolean)
                try { sessionStorage.setItem('geo_countries', JSON.stringify(names)) } catch {}
              }
            })
            .catch(() => {})
        }

        return profile
      }

      throw new Error(json?.error || 'Profile response invalid')
    } catch (err) {
      try {
        const cached = JSON.parse(localStorage.getItem('cached_profile') || '')
        if (cached) {
          setProfileData(cached)
          setIsVerified(!!(cached as any)?.email_verified)
          setProfileError(null)
          return cached
        }
      } catch { /* no cached profile */ }
      setProfileData(null)
      setProfileError('Failed to load profile')
      return null
    } finally {
      setProfileLoading(false)
      setAuthLoaded(true)
    }
  }, [navigate, publicPaths])

  useEffect(() => {
    locationRef.current = location.pathname
  }, [location.pathname])

  useEffect(() => {
    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
  }, [])

  useEffect(() => {
    loadProfile(locationRef.current)
  }, [loadProfile])

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return
    const raf = window.requestAnimationFrame(() => {
      resetScrollPosition()
    })
    return () => window.cancelAnimationFrame(raf)
  }, [location.pathname, location.search, resetScrollPosition])

  useEffect(() => {
    if (profileData) {
      const username = (profileData as any)?.username
      const displayName = (profileData as any)?.display_name || username
      const rawAvatarUrl = (profileData as any)?.profile_picture || null
      // Cache-bust by username + timestamp so switching accounts always shows correct avatar
      const avatarUrl = rawAvatarUrl 
        ? (rawAvatarUrl.includes('?') ? rawAvatarUrl : `${rawAvatarUrl}?u=${username}&v=${Date.now()}`)
        : null
      setUserMeta({ username, displayName, avatarUrl })
    } else {
      setUserMeta({})
    }
  }, [profileData])

  const userProfileValue = useMemo(
    () => ({
      profile: profileData,
      setProfile: setProfileData,
      loading: profileLoading,
      error: profileError,
      refresh: () => loadProfile(),
    }),
    [profileData, profileLoading, profileError, loadProfile],
  )

  useEffect(() => {
    if (authLoaded) {
      document.getElementById('initial-loader')?.remove()
    }
  }, [authLoaded])

  const rootRouteElement = (() => {
    if (!authLoaded) return null
    if (profileData) {
      return <Navigate to="/premium_dashboard" replace />
    }
    return <OnboardingWelcome />
  })()

  const currentPath = location.pathname
  const hideHeader =
    isFirstPage ||
    currentPath === '/welcome' ||
    currentPath === '/onboarding' ||
    currentPath === '/login' ||
    currentPath === '/signup' ||
    currentPath === '/signup_react' ||
    currentPath.startsWith('/user_chat/chat/') ||  // Chat thread has its own header
    currentPath.startsWith('/group_chat/') ||  // Group chat has its own header
    currentPath.startsWith('/post/') ||  // Post detail has its own header
    currentPath.startsWith('/reply/') ||  // Reply/thread page has its own header
    currentPath.startsWith('/community_feed_react/') ||  // Community feed has its own header
    currentPath.startsWith('/community/') && currentPath.includes('/feed')  // Community feed alternate route
  const showHeader = authLoaded && !hideHeader && !headerHiddenOverride
  const headerHeightValue = showHeader ? 'calc(56px + env(safe-area-inset-top, 0px))' : 'env(safe-area-inset-top, 0px)'
  const contentOffsetValue = headerHiddenOverride ? '0px' : headerHeightValue
  const mainStyle = {
    paddingTop: contentOffsetValue,
    minHeight: '100%',
    paddingBottom: isChatRoute ? '0px' : `calc(env(safe-area-inset-bottom, 0px) + ${keyboardOffset}px)`,
    '--app-header-offset': contentOffsetValue,
    '--app-header-height': headerHeightValue,
    '--app-subnav-height': '40px',
    '--app-subnav-gap': '12px',
    '--app-content-gap': '8px',
  } as CSSProperties

  // ProtectedRoute no longer used after simplifying guards

  return (
    <UserProfileContext.Provider value={userProfileValue}>
      <BadgeProvider>
      <HeaderContext.Provider value={{ setTitle, setHeaderHidden: setHeaderHiddenOverride }}>
        {showHeader && (
          <HeaderBar title={title} username={userMeta.username} displayName={userMeta.displayName || undefined} avatarUrl={userMeta.avatarUrl} />
        )}
        <main
          ref={scrollRegionRef}
          data-scroll-region="true"
          className="app-scroll-region ios-scroll-region"
          style={mainStyle}
        >
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={rootRouteElement} />
                <Route path="/welcome" element={<OnboardingWelcome />} />
                <Route path="/login" element={<MobileLogin />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/signup_react" element={<Signup />} />
                <Route path="/onboarding" element={<OnboardingWelcome />} />
                <Route path="/premium" element={<PremiumDashboard />} />
                <Route path="/premium_dashboard" element={<PremiumDashboard />} />
                <Route path="/premium_dashboard_react" element={<PremiumDashboard />} />
                <Route path="/crossfit" element={<CrossfitExact />} />
                <Route path="/crossfit_react" element={<CrossfitExact />} />
                <Route path="/communities" element={<Communities />} />
                <Route path="/followers" element={<Followers />} />
                <Route path="/networking" element={<Networking />} />
                <Route path="/your_sports" element={<YourSports />} />
                <Route path="/gym" element={<Gym />} />
                <Route path="/user_chat" element={<Messages />} />
                  <Route path="/user_chat/new" element={<NewMessage />} />
                  <Route path="/user_chat/chat/:username" element={<ChatThread />} />
                  <Route path="/chat/:username/media" element={<ChatMedia />} />
                  <Route path="/group_chat/:group_id" element={<GroupChatThread />} />
                  <Route path="/group_chat/:group_id/media" element={<GroupChatMedia />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/profile_react" element={<Profile />} />
                  <Route path="/profile/steve" element={<SteveKnowsMe />} />
                  <Route path="/profile/:username" element={<PublicProfile />} />
                <Route path="/account_settings" element={<AccountSettings />} />
                <Route path="/account_settings_react" element={<AccountSettings />} />
                <Route path="/account_settings/security" element={<AccountSecurity />} />
                <Route path="/account_settings/danger" element={<AccountDangerZone />} />
                  <Route path="/subscription_plans" element={<SubscriptionPlans />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/admin_dashboard" element={<AdminDashboard />} />
                <Route path="/admin_dashboard_react" element={<AdminDashboard />} />
                <Route path="/admin_profile_react" element={<AdminProfile />} />
                <Route path="/home" element={<HomeTimeline />} />
                <Route path="/workout_tracking" element={<WorkoutTracking />} />
                <Route path="/community_feed_react/:community_id" element={<CommunityFeed />} />
                <Route path="/community/:community_id/calendar_react" element={<CommunityCalendar />} />
                <Route path="/community/:community_id/tasks_react" element={<CommunityTasks />} />
                <Route path="/community/:community_id/polls_react" element={<CommunityPolls />} />
                <Route path="/community/:community_id/resources_react" element={<CommunityResources />} />
                <Route path="/community/:community_id/useful_links_react" element={<UsefulLinks />} />
                <Route path="/community/:community_id/photos_react" element={<CommunityPhotos />} />
                <Route path="/community/:community_id/key_posts" element={<KeyPosts />} />
                <Route path="/community/:community_id/members" element={<Members />} />
                <Route path="/community/:community_id/edit" element={<EditCommunity />} />
                <Route path="/event/:event_id" element={<EventDetail />} />
                <Route path="/post/:post_id" element={<PostDetail />} />
                <Route path="/reply/:reply_id" element={<CommentReply />} />
                <Route path="/compose" element={<CreatePost />} />
                <Route path="/group_feed_react/:group_id" element={<GroupFeed />} />
                <Route path="/group/:group_id/edit" element={<EditGroup />} />
                <Route path="*" element={<PremiumDashboard />} />
              </Routes>
            </ErrorBoundary>
        </main>
        {requireVerification && authLoaded && isVerified === false && (
          <VerifyOverlay onRecheck={async ()=>{
            try{
              const r = await fetch('/api/profile_me', { credentials:'include', headers: { 'Accept': 'application/json' } })
              const j = await r.json().catch(()=>null)
              const v = !!(j?.profile?.email_verified)
              setIsVerified(v)
            }catch{}
          }} />
        )}

        {/* Deep Link Join Success Modal */}
        {deepLinkJoin && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="mx-4 w-full max-w-sm rounded-2xl border border-[#4db6ac]/30 bg-[#0a0a0a] p-6 shadow-2xl animate-fade-in">
              <div className="flex flex-col items-center text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#4db6ac]/20">
                  <i className="fa-solid fa-check text-3xl text-[#4db6ac]" />
                </div>
                <h3 className="mb-2 text-xl font-semibold text-white">Welcome!</h3>
                <p className="mb-4 text-sm text-white/70">
                  You've joined <span className="font-medium text-[#4db6ac]">{deepLinkJoin.name}</span>
                </p>
                <p className="text-xs text-white/50">Taking you to the community...</p>
              </div>
            </div>
          </div>
        )}
      </HeaderContext.Provider>
      </BadgeProvider>
    </UserProfileContext.Provider>
  )
}

export default function App() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      window.__googleAuthReady = true
      return
    }
    import('@codetrix-studio/capacitor-google-auth')
      .then(({ GoogleAuth }) => {
        return GoogleAuth.initialize({
          clientId: '739552904126-nb0l7j8d0p8q8q8rr84gatij5e0ip23p.apps.googleusercontent.com',
          iosClientId: '739552904126-nb0l7j8d0p8q8q8rr84gatij5e0ip23p.apps.googleusercontent.com',
          scopes: ['profile', 'email'],
          grantOfflineAccess: false,
        } as any)
      })
      .then(() => { window.__googleAuthReady = true })
      .catch(() => { window.__googleAuthReady = true })
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <NetworkProvider>
        <BrowserRouter>
          <OfflineBanner />
          <OutboxDrainer />
          <BrandAssetsInit />
          <PushInit />
          <NotificationPrompt />
          <AppRoutes />
        </BrowserRouter>
      </NetworkProvider>
    </QueryClientProvider>
  )
}
