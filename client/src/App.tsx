import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PremiumDashboard from './pages/PremiumDashboard'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/premium" replace />} />
          <Route path="/premium" element={<PremiumDashboard />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
