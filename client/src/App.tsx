import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import ErrorBoundary from './components/ErrorBoundary'
import PremiumDashboard from './pages/PremiumDashboard'
import HeaderBar from './components/HeaderBar'
import { HeaderContext } from './contexts/HeaderContext'
import CrossfitExact from './pages/CrossfitExact'
import CommunityFeed from './pages/CommunityFeed'
import PostDetail from './pages/PostDetail'
import CreatePost from './pages/CreatePost'
import Members from './pages/Members'
import Communities from './pages/Communities'
import HomeTimeline from './pages/HomeTimeline'
import WorkoutTracking from './pages/WorkoutTracking'
import YourSports from './pages/YourSports'
import Messages from './pages/Messages'

const queryClient = new QueryClient()

export default function App() {
  const [title, setTitle] = useState('')
  const [userMeta, setUserMeta] = useState<{ username?:string; avatarUrl?:string|null }>({})

  useEffect(() => {
    // Preload user meta once for persistent avatar
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

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <HeaderContext.Provider value={{ setTitle }}>
          <HeaderBar title={title} username={userMeta.username} avatarUrl={userMeta.avatarUrl} />
          <div style={{ paddingTop: '56px' }}>
            <ErrorBoundary>
              <Routes>
              <Route path="/" element={<PremiumDashboard />} />
              <Route path="/premium" element={<PremiumDashboard />} />
              <Route path="/premium_dashboard" element={<PremiumDashboard />} />
              <Route path="/premium_dashboard_react" element={<PremiumDashboard />} />
              <Route path="/crossfit" element={<CrossfitExact />} />
              <Route path="/crossfit_react" element={<CrossfitExact />} />
              <Route path="/communities" element={<Communities />} />
              <Route path="/your_sports" element={<YourSports />} />
              <Route path="/user_chat" element={<Messages />} />
              <Route path="/home" element={<HomeTimeline />} />
              <Route path="/workout_tracking" element={<WorkoutTracking />} />
              <Route path="/community_feed_react/:community_id" element={<CommunityFeed />} />
              <Route path="/community/:community_id/members" element={<Members />} />
              <Route path="/post/:post_id" element={<PostDetail />} />
              <Route path="/compose" element={<CreatePost />} />
              <Route path="*" element={<PremiumDashboard />} />
              </Routes>
            </ErrorBoundary>
          </div>
        </HeaderContext.Provider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
