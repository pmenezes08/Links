import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PremiumDashboard from './pages/PremiumDashboard'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/premium_dashboard" replace />} />
          <Route path="/premium" element={<PremiumDashboard />} />
          <Route path="/premium_dashboard" element={<PremiumDashboard />} />
          <Route path="*" element={<PremiumDashboard />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
