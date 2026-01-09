import { useEffect, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate } from 'react-router-dom'

// Comprehensive cache clearing for account deletion
async function clearAllUserData(): Promise<void> {
  console.log('🗑️ Clearing all user data after account deletion...')
  
  // 1. Clear all localStorage
  try {
    localStorage.clear()
    console.log('✅ localStorage cleared')
  } catch (e) {
    console.warn('Error clearing localStorage:', e)
  }

  // 2. Clear sessionStorage
  try {
    sessionStorage.clear()
    console.log('✅ sessionStorage cleared')
  } catch (e) {
    console.warn('Error clearing sessionStorage:', e)
  }

  // 3. Clear IndexedDB databases
  const dbsToDelete = [
    'chat-encryption',
    'signal-protocol',
    'signal-store',
  ]
  
  for (const dbName of dbsToDelete) {
    try {
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(dbName)
        request.onsuccess = () => {
          console.log(`✅ Deleted IndexedDB: ${dbName}`)
          resolve()
        }
        request.onerror = () => resolve()
        request.onblocked = () => resolve()
        setTimeout(resolve, 1000)
      })
    } catch (e) {
      console.warn(`Error deleting IndexedDB ${dbName}:`, e)
    }
  }

  // 4. Clear ALL service worker caches (not just runtime - full cleanup for deleted account)
  try {
    if ('caches' in window) {
      const cacheNames = await caches.keys()
      await Promise.all(
        cacheNames.map(cacheName => {
          console.log(`🗑️ Deleting cache: ${cacheName}`)
          return caches.delete(cacheName)
        })
      )
      console.log('✅ All service worker caches cleared')
    }
  } catch (e) {
    console.warn('Error clearing service worker caches:', e)
  }

  // 5. Unregister service workers
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      for (const registration of registrations) {
        await registration.unregister()
        console.log('✅ Service worker unregistered')
      }
    }
  } catch (e) {
    console.warn('Error unregistering service workers:', e)
  }
}

export default function AccountDangerZone() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    setTitle('Danger Zone')
  }, [setTitle])

  const handleDelete = async () => {
    if (confirmation.trim().toUpperCase() !== 'DELETE') {
      setFeedback({ type: 'error', text: 'Please type DELETE to confirm.' })
      return
    }
    setFeedback(null)
    setLoading(true)
    try {
      // First, delete the account on the server
      const resp = await fetch('/delete_account', { method: 'POST', credentials: 'include' })
      if (!resp.ok) {
        setFeedback({ type: 'error', text: `Server error (${resp.status})` })
        setLoading(false)
        return
      }
      const json = await resp.json().catch(() => null)
      if (json?.success) {
        setFeedback({ type: 'success', text: 'Account deleted. Clearing data…' })
        
        // Clear all user data (localStorage, sessionStorage, IndexedDB, service worker caches)
        await clearAllUserData()
        
        // Call logout endpoint to clear server session
        try {
          await fetch('/logout', { credentials: 'include' })
        } catch {}
        
        // Redirect to signup page with a hard reload
        setTimeout(() => {
          window.location.href = '/signup'
        }, 500)
      } else {
        setFeedback({ type: 'error', text: json?.error || 'Failed to delete account' })
        setLoading(false)
      }
    } catch {
      setFeedback({ type: 'error', text: 'Network error. Please try again.' })
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <button
          type="button"
          className="inline-flex items-center gap-2 text-sm text-[#9fb0b5] hover:text-white"
          onClick={() => navigate('/account_settings')}
        >
          <i className="fa-solid fa-arrow-left" />
          Back to Account Settings
        </button>

        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-6 space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-red-300">Danger Zone</p>
            <h1 className="text-xl font-semibold text-white">Delete your account</h1>
            <p className="text-sm text-red-200/80 mt-2">
              This action is permanent. All posts, messages, and membership data will be deleted and cannot be recovered.
            </p>
          </div>

          {feedback && (
            <div
              className={`rounded-lg border p-3 text-sm ${
                feedback.type === 'success'
                  ? 'border-green-500/40 bg-green-500/10 text-green-200'
                  : 'border-red-500/40 bg-red-500/10 text-red-200'
              }`}
            >
              {feedback.text}
            </div>
          )}

          <div className="space-y-3">
            <label className="text-sm text-white/80">
              Type <span className="font-semibold">DELETE</span> to confirm
            </label>
            <input
              type="text"
              value={confirmation}
              onChange={e => setConfirmation(e.target.value)}
              className="w-full rounded-lg border border-red-500/40 bg-black px-4 py-3 text-white focus:border-red-300 focus:outline-none"
              placeholder="DELETE"
              disabled={loading}
            />
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={handleDelete}
            className="w-full rounded-lg bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-500 disabled:opacity-60"
          >
            {loading ? 'Deleting…' : 'Delete Account Permanently'}
          </button>
        </div>
      </div>
    </div>
  )
}
