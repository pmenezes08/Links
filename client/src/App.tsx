import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ErrorBoundary from './components/ErrorBoundary'
import MobileLogin from './pages/MobileLogin'
import PremiumDashboard from './pages/PremiumDashboard'
import HeaderBar from './components/HeaderBar'
import { HeaderContext } from './contexts/HeaderContext'
import { UserProfileContext, type UserProfile } from './contexts/UserProfileContext'
import PushInit from './components/PushInit'
import NativePushInit from './components/NativePushInit'
import BrandAssetsInit from './components/BrandAssetsInit'
import { encryptionService } from './services/simpleEncryption'
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

  const locationRef = useRef(location.pathname)
  const publicPaths = useMemo(
    () => new Set(['/', '/welcome', '/onboarding', '/login', '/signup', '/signup_react', '/verify_required']),
    [],
  )
  const encryptionUserRef = useRef<string | null>(null)

  const loadProfile = useCallback(async (path?: string): Promise<UserProfile> => {
    const currentPath = path ?? locationRef.current
    setProfileLoading(true)
    setProfileError(null)
    try {
      const response = await fetch('/api/profile_me', { credentials: 'include' })
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

        if (currentPath === '/') {
          navigate('/premium_dashboard', { replace: true })
        }

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
        if (username && encryptionUserRef.current !== username) {
          try {
            console.log('🔐 Initializing encryption for:', username)
            await encryptionService.init(username)
            const existingTimestamp = localStorage.getItem('encryption_keys_generated_at')
            if (!existingTimestamp) {
              localStorage.setItem('encryption_keys_generated_at', Date.now().toString())
            }
            console.log('🔐 ✅ Encryption ready globally!')
          } catch (encError) {
            console.error('🔐 ❌ Encryption init failed:', encError)
          } finally {
            encryptionUserRef.current = username
          }
        }

        return profile
      }

      setProfileData(null)
      setProfileError(json?.error || 'Failed to load profile')
      return null
    } catch (error) {
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
    loadProfile(locationRef.current)
  }, [loadProfile])

  useEffect(() => {
    if (profileData) {
      const username = (profileData as any)?.username
      const displayName = (profileData as any)?.display_name || username
      const avatarUrl = (profileData as any)?.profile_picture || null
      setUserMeta({ username, displayName, avatarUrl })
    } else {
      setUserMeta({})
    }
  }, [profileData])

  useEffect(() => {
    if (location.pathname === '/' && profileData) {
      navigate('/premium_dashboard', { replace: true })
    }
  }, [location.pathname, navigate, profileData])

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

  // ProtectedRoute no longer used after simplifying guards

  return (
    <UserProfileContext.Provider value={userProfileValue}>
      <NativePushInit />
      <HeaderContext.Provider value={{ setTitle }}>
        {(() => {
          const path = location.pathname
          const hideHeader = isFirstPage || path === '/welcome' || path === '/onboarding' || path === '/login' || path === '/signup' || path === '/signup_react'
          return !hideHeader
        })() && (
          <HeaderBar title={title} username={userMeta.username} displayName={userMeta.displayName || undefined} avatarUrl={userMeta.avatarUrl} />
        )}
        <div style={{ paddingTop: (() => { const p = location.pathname; return (isFirstPage || p === '/welcome' || p === '/onboarding' || p === '/login' || p === '/signup' || p === '/signup_react') ? 0 : '56px' })() }}>
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<OnboardingWelcome />} />
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
        </div>
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
