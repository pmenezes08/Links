import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PremiumDashboard from './pages/PremiumDashboard'
import CrossfitExact from './pages/CrossfitExact'
import Gym from './pages/Gym'
import CommunityFeed from './pages/CommunityFeed'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PremiumDashboard />} />
          <Route path="/premium" element={<PremiumDashboard />} />
          <Route path="/premium_dashboard" element={<PremiumDashboard />} />
          <Route path="/crossfit" element={<CrossfitExact />} />
          <Route path="/crossfit_react" element={<CrossfitExact />} />
          <Route path="/gym" element={<Gym />} />
          <Route path="/community_feed_react/:community_id" element={<CommunityFeed />} />
          <Route path="*" element={<PremiumDashboard />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
