import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ErrorBoundary from './components/ErrorBoundary'
import MobileLogin from './pages/MobileLogin'
import PremiumDashboard from './pages/PremiumDashboard'
import HeaderBar from './components/HeaderBar'
import { HeaderContext } from './contexts/HeaderContext'
import PushInit from './components/PushInit'
import CrossfitExact from './pages/CrossfitExact'
import CommunityFeed from './pages/CommunityFeed'
import CommunityCalendar from './pages/CommunityCalendar'
import CommunityPolls from './pages/CommunityPolls'
import CommunityResources from './pages/CommunityResources'
import UsefulLinks from './pages/UsefulLinks'
import CommunityPhotos from './pages/CommunityPhotos'
import PostDetail from './pages/PostDetail'
import CreatePost from './pages/CreatePost'
import Members from './pages/Members'
import EditCommunity from './pages/EditCommunity'
import Communities from './pages/Communities'
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
import Signup from './pages/Signup'
import Notifications from './pages/Notifications'
import AdminDashboard from './pages/AdminDashboard'
import ProductDevelopment from './pages/ProductDevelopment'
import KeyPosts from './pages/KeyPosts'
import OnboardingWelcome from './pages/OnboardingWelcome'

const queryClient = new QueryClient()

function AppRoutes(){
  const [title, setTitle] = useState('')
  const [userMeta, setUserMeta] = useState<{ username?:string; avatarUrl?:string|null }>({})
  const location = useLocation()
  const isFirstPage = location.pathname === '/'

  useEffect(() => {
    async function load(){
      try{
        const r = await fetch('/api/home_timeline', { credentials:'include' })
        const j = await r.json()
        if (j?.success){
          setUserMeta({ username: j.username, avatarUrl: j.current_user_profile_picture })
        }
      }catch{}
    }
    load()
  }, [])

  // Global guard: if user is logged in but email not verified, redirect to /verify_required
  useEffect(() => {
    let cancelled = false
    async function guard(){
      try{
        const r = await fetch('/api/profile_me', { credentials: 'include' })
        if (!r.ok) return
        const j = await r.json().catch(()=>null)
        if (!j?.success || !j.profile) return
        const verified = !!j.profile.email_verified
        if (!verified && location.pathname !== '/verify_required'){
          if (!cancelled){
            window.location.href = '/verify_required'
          }
        }
      }catch{}
    }
    guard()
    return () => { cancelled = true }
  }, [location.pathname])

  return (
    <HeaderContext.Provider value={{ setTitle }}>
      {!isFirstPage && (
        <HeaderBar title={title} username={userMeta.username} avatarUrl={userMeta.avatarUrl} />
      )}
      <div style={{ paddingTop: isFirstPage ? 0 : '56px' }}>
        <ErrorBoundary>
          <Routes>
          <Route path="/" element={<MobileLogin />} />
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
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin_dashboard" element={<AdminDashboard />} />
          <Route path="/home" element={<HomeTimeline />} />
          <Route path="/workout_tracking" element={<WorkoutTracking />} />
          <Route path="/community_feed_react/:community_id" element={<CommunityFeed />} />
          <Route path="/community/:community_id/calendar_react" element={<CommunityCalendar />} />
          <Route path="/community/:community_id/polls_react" element={<CommunityPolls />} />
          <Route path="/community/:community_id/resources_react" element={<CommunityResources />} />
          <Route path="/community/:community_id/useful_links_react" element={<UsefulLinks />} />
          <Route path="/community/:community_id/photos_react" element={<CommunityPhotos />} />
          <Route path="/community/:community_id/key_posts" element={<KeyPosts />} />
          <Route path="/community/:community_id/members" element={<Members />} />
          <Route path="/community/:community_id/edit" element={<EditCommunity />} />
          <Route path="/post/:post_id" element={<PostDetail />} />
          <Route path="/compose" element={<CreatePost />} />
          <Route path="/product_development" element={<ProductDevelopment />} />
          <Route path="*" element={<PremiumDashboard />} />
          </Routes>
        </ErrorBoundary>
      </div>
    </HeaderContext.Provider>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <PushInit />
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
