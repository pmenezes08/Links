import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { loadShareIntoStore } from '../services/shareImport'

/** Universal-link / bookmark entry for `/share/incoming` — hydrates native share inbox then opens Messages pick flow. */
export default function ShareIncomingRouteRedirect() {
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (Capacitor.getPlatform() !== 'web') {
        try {
          await loadShareIntoStore()
        } catch (e) {
          console.warn('ShareIncomingRouteRedirect load:', e)
        }
      }
      if (cancelled) return
      navigate('/user_chat?share_pick=1', { replace: true })
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  return (
    <div className="min-h-[40vh] flex items-center justify-center text-white/60 text-sm">Opening Messages…</div>
  )
}
