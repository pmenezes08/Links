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
// import NativePushInit from './components/NativePushInit' // Disabled - conflicts with PushInit
import BrandAssetsInit from './components/BrandAssetsInit'
import { encryptionService } from './services/simpleEncryption'
import { signalService } from './services/signalProtocol'
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
import HomeTimeline from './pages/HomeTimeline'
import WorkoutTracking from './pages/WorkoutTracking'
import Gym from './pages/Gym'
import YourSports from './pages/YourSports'
import Messages from './pages/Messages'
import NewMessage from './pages/NewMessage'
import ChatThread from './pages/ChatThread'
import Profile from './pages/Profile'
import PublicProfile from './pages/PublicProfile'
import AccountSettings from './pages/AccountSettings'
import AccountSecurity from './pages/AccountSecurity'
import AccountDangerZone from './pages/AccountDangerZone'
import SubscriptionPlans from './pages/SubscriptionPlans'
import Signup from './pages/Signup'
import Notifications from './pages/Notifications'
import AdminDashboard from './pages/AdminDashboard'
import AdminProfile from './pages/AdminProfile'
import ProductDevelopment from './pages/ProductDevelopment'
import KeyPosts from './pages/KeyPosts'
import OnboardingWelcome from './pages/OnboardingWelcome'
import VerifyOverlay from './components/VerifyOverlay'
import EventDetail from './pages/EventDetail'
import GroupFeed from './pages/GroupFeed'
import EncryptionSettings from './pages/EncryptionSettings'

const queryClient = new QueryClient()

function AppRoutes(){
  const [title, setTitle] = useState('')
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

  const locationRef = useRef(location.pathname)
  const scrollRegionRef = useRef<HTMLDivElement | null>(null)
  const publicPaths = useMemo(
    () => new Set(['/', '/welcome', '/onboarding', '/login', '/signup', '/signup_react', '/verify_required']),
    [],
  )
  const encryptionUserRef = useRef<string | null>(null)
  const applyKeyboardOffset = useCallback((nextOffset: number) => {
    setKeyboardOffset(prev => (Math.abs(prev - nextOffset) < 1 ? prev : nextOffset))
    document.documentElement.style.setProperty('--keyboard-offset', `${nextOffset}px`)
    if (document.body) {
      document.body.dataset.keyboard = nextOffset > 0 ? 'open' : 'closed'
    }
  }, [])

  useLayoutEffect(() => {
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
  }, [applyKeyboardOffset])

  useEffect(() => {
    if (Capacitor.getPlatform() === 'web') return

    Keyboard.setResizeMode({ mode: KeyboardResize.None }).catch(() => {})
    Keyboard.setScroll({ isDisabled: true }).catch(() => {})

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
  }, [applyKeyboardOffset])

  // State for deep link join modal
  const [deepLinkJoin, setDeepLinkJoin] = useState<{ name: string; id: number } | null>(null)

  // Handle deep links (Universal Links) when app is opened from external sources
  useEffect(() => {
    if (Capacitor.getPlatform() === 'web') return

    let listenerHandle: PluginListenerHandle | undefined

    const handleDeepLink = async (url: string) => {
      console.log('🔗 Deep link received:', url)
      
      // Check if this is an invite link
      const inviteToken = extractInviteToken(url)
      if (inviteToken) {
        console.log('🔗 Invite token found:', inviteToken)
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
            // Already a member - just navigate
            navigate(`/community_feed_react/${result.communityId}`)
          } else {
            console.error('🔗 Failed to join:', result.error)
          }
        } catch (err) {
          console.error('🔗 Error processing invite:', err)
        }
      }
    }

    // Listen for app URL open events (Universal Links)
    CapacitorApp.addListener('appUrlOpen', (event: { url: string }) => {
      console.log('🔗 appUrlOpen event:', event.url)
      handleDeepLink(event.url)
    }).then((handle: PluginListenerHandle) => {
      listenerHandle = handle
    })

    // Also check if app was launched with a URL
    CapacitorApp.getLaunchUrl().then((result) => {
      if (result?.url) {
        console.log('🔗 App launched with URL:', result.url)
        handleDeepLink(result.url)
      }
    }).catch(() => {})

    return () => {
      listenerHandle?.remove()
    }
  }, [navigate])

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
    try {
      // Add cache-buster to prevent browser caching, ensuring profile picture updates appear immediately
      const response = await fetch(`/api/profile_me?_t=${Date.now()}`, { 
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      })
      if (response.status === 401) {
        setProfileData(null)
        setIsVerified(null)
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
        setProfileData(null)
        setProfileError('Failed to load profile')
        return null
      }
      const json = await response.json().catch(() => null)
      if (json?.success && json.profile) {
        const profile = json.profile as UserProfile
        setProfileData(profile)
        setIsVerified(!!(profile as any)?.email_verified)
        setProfileError(null)

        const resetRequested = localStorage.getItem('encryption_reset_requested')
        if (resetRequested === 'true') {
          console.log('🔐 Reset requested - deleting old encryption database...')
          localStorage.removeItem('encryption_reset_requested')
          try {
            await new Promise<void>((resolve) => {
              const request = indexedDB.deleteDatabase('chat-encryption')
              request.onsuccess = () => {
                console.log('🔐 ✅ Old encryption database deleted')
                resolve()
              }
              request.onerror = () => {
                console.log('🔐 ⚠️ Database deletion error (may not exist)')
                resolve()
              }
              request.onblocked = () => {
                console.log('🔐 ⚠️ Database deletion blocked, will retry on next load')
                resolve()
              }
            })
          } catch (e) {
            console.log('🔐 ⚠️ Delete error:', e)
          }
        }

        const username = (profile as any)?.username
        
        // Detect user change and clear stale caches from previous user
        const previousUsername = localStorage.getItem('current_username')
        if (username && previousUsername && previousUsername !== username) {
          console.log(`👤 User changed from ${previousUsername} to ${username} - clearing caches`)
          
          // Clear localStorage items that might have old user data
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
          
          // Clear service worker caches
          if ('caches' in window) {
            caches.keys().then(names => {
              names.forEach(name => {
                if (name.includes('runtime') || name.includes('cp-')) {
                  caches.delete(name)
                }
              })
            }).catch(() => {})
          }
          
          // Clear IndexedDB for encryption (different user = different keys)
          try {
            indexedDB.deleteDatabase('chat-encryption')
            indexedDB.deleteDatabase('signal-protocol')
            indexedDB.deleteDatabase('signal-store')
          } catch (e) {
            console.warn('Error clearing IndexedDB for user change:', e)
          }
        }
        
        // Store current username for future comparison
        if (username) {
          localStorage.setItem('current_username', username)
        }
        
        if (username && encryptionUserRef.current !== username) {
          try {
            // Initialize Signal Protocol (multi-device E2E encryption)
            console.log('🔐 Initializing Signal Protocol for:', username)
            const { isNewDevice, deviceId } = await signalService.init(username)
            
            // Store device ID for use in chat
            localStorage.setItem('signal_device_id', String(deviceId))
            
            if (isNewDevice) {
              console.log('🔐 ✅ New device registered, deviceId:', deviceId)
              localStorage.setItem('encryption_keys_generated_at', Date.now().toString())
            } else {
              console.log('🔐 ✅ Existing device loaded, deviceId:', deviceId)
            }
            
            // Clear old sync flag (no longer needed with Signal Protocol)
            localStorage.removeItem('encryption_needs_sync')
            
            console.log('🔐 ✅ Signal Protocol ready!')
          } catch (encError) {
            console.error('🔐 ❌ Signal Protocol init failed:', encError)
            
            // Fallback to simple encryption if Signal fails
            try {
              console.log('🔐 Falling back to simple encryption...')
              await encryptionService.init(username)
              console.log('🔐 ✅ Simple encryption fallback ready')
            } catch (fallbackError) {
              console.error('🔐 ❌ Fallback encryption also failed:', fallbackError)
            }
          } finally {
            encryptionUserRef.current = username
          }
        }

        return profile
      }

      setProfileData(null)
      setProfileError(json?.error || 'Failed to load profile')
      return null
    } catch {
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
      // Add cache-buster to avatar URL to ensure fresh image loads after upload
      const avatarUrl = rawAvatarUrl 
        ? (rawAvatarUrl.includes('?') ? rawAvatarUrl : `${rawAvatarUrl}?v=${Date.now()}`)
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

  const rootRouteElement = (() => {
    if (!authLoaded) {
      return (
        <div className="h-screen bg-black text-white flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <i className="fa-solid fa-spinner fa-spin text-2xl" aria-hidden="true" />
            <span className="text-sm text-white/70">Loading your dashboard…</span>
          </div>
        </div>
      )
    }
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
    currentPath.startsWith('/post/') ||  // Post detail has its own header
    currentPath.startsWith('/community_feed_react/') ||  // Community feed has its own header
    currentPath.startsWith('/community/') && currentPath.includes('/feed')  // Community feed alternate route
  const showHeader = !hideHeader
  const headerHeightValue = showHeader ? 'calc(56px + env(safe-area-inset-top, 0px))' : 'env(safe-area-inset-top, 0px)'
  const contentOffsetValue = headerHeightValue
  const mainStyle = {
    paddingTop: contentOffsetValue,
    minHeight: '100%',
    paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${keyboardOffset}px)`,
    '--app-header-offset': contentOffsetValue,
    '--app-header-height': headerHeightValue,
    '--app-subnav-height': '40px',
    '--app-subnav-gap': '12px',
    '--app-content-gap': '8px',
  } as CSSProperties

  // ProtectedRoute no longer used after simplifying guards

  return (
    <UserProfileContext.Provider value={userProfileValue}>
      {/* <NativePushInit /> */}
      <HeaderContext.Provider value={{ setTitle }}>
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
                <Route path="/your_sports" element={<YourSports />} />
                <Route path="/gym" element={<Gym />} />
                <Route path="/user_chat" element={<Messages />} />
                  <Route path="/user_chat/new" element={<NewMessage />} />
                  <Route path="/user_chat/chat/:username" element={<ChatThread />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/profile_react" element={<Profile />} />
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
                <Route path="/compose" element={<CreatePost />} />
                <Route path="/product_development" element={<ProductDevelopment />} />
                <Route path="/group_feed_react/:group_id" element={<GroupFeed />} />
                <Route path="/encryption_settings" element={<EncryptionSettings />} />
                <Route path="*" element={<PremiumDashboard />} />
              </Routes>
            </ErrorBoundary>
        </main>
        {requireVerification && authLoaded && isVerified === false && (
          <VerifyOverlay onRecheck={async ()=>{
            try{
              const r = await fetch('/api/profile_me', { credentials:'include' })
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
    </UserProfileContext.Provider>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <BrandAssetsInit />
        <PushInit />
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
