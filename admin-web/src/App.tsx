import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import AuthGuard from './components/AuthGuard'
import Login from './pages/Login'
import Overview from './pages/Overview'
import Users from './pages/Users'
import Communities from './pages/Communities'
import Metrics from './pages/Metrics'
import Reports from './pages/Reports'
import Blocked from './pages/Blocked'
import Invites from './pages/Invites'
import Broadcast from './pages/Broadcast'
import Settings from './pages/Settings'
import FindAdmin from './pages/FindAdmin'
import Tenants from './pages/Tenants'
import UserProfiles from './pages/UserProfiles'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/find-admin" element={<FindAdmin />} />
      <Route element={<AuthGuard><Layout /></AuthGuard>}>
        <Route index element={<Overview />} />
        <Route path="users" element={<Users />} />
        <Route path="communities" element={<Communities />} />
        <Route path="profiles" element={<UserProfiles />} />
        <Route path="metrics" element={<Metrics />} />
        <Route path="reports" element={<Reports />} />
        <Route path="blocked" element={<Blocked />} />
        <Route path="invites" element={<Invites />} />
        <Route path="broadcast" element={<Broadcast />} />
        <Route path="settings" element={<Settings />} />
        <Route path="tenants" element={<Tenants />} />
      </Route>
    </Routes>
  )
}
