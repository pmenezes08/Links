import { useEffect, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { resetAccountScopedState } from '../utils/accountStateReset'
import { unregisterPushBeforeLogout } from '../utils/logout'

// Comprehensive cache clearing for account deletion
async function clearAllUserData(): Promise<void> {
  console.log('🗑️ Clearing all user data after account deletion...')

  // Deactivate push tokens while session cookie is still valid.
  await unregisterPushBeforeLogout()

  try {
    if (Capacitor.isNativePlatform()) {
      await Preferences.clear()
      console.log('✅ Capacitor Preferences (native storage) cleared')
    }
  } catch (e) {
    console.warn('Error clearing Capacitor Preferences:', e)
  }

  await resetAccountScopedState({
    localStorageMode: 'all',
    clearSessionStorage: true,
    preserveSessionStorageKeys: [],
    cacheMode: 'all',
    unregisterServiceWorkers: true,
  })

  try {
    await fetch('/logout?_=' + Date.now(), { 
      credentials: 'include',
      cache: 'no-store'
    })
    console.log('✅ Server session cleared via /logout')
  } catch (e) {
    console.warn('Error calling logout:', e)
  }
}

export default function AccountDangerZone() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    setTitle(t('account.danger.section_title'))
  }, [setTitle, t])

  const handleDelete = async () => {
    if (confirmation.trim().toUpperCase() !== 'DELETE') {
      setFeedback({ type: 'error', text: t('account.danger.confirm_error') })
      return
    }
    setFeedback(null)
    setLoading(true)
    try {
      // First, delete the account on the server
      const resp = await fetch('/delete_account', { method: 'POST', credentials: 'include' })
      if (!resp.ok) {
        setFeedback({ type: 'error', text: t('account.danger.server_error', { status: resp.status }) })
        setLoading(false)
        return
      }
      const json = await resp.json().catch(() => null)
      if (json?.success) {
        setFeedback({ type: 'success', text: t('account.danger.deleted') })
        
        // Clear Google Sign-In cached account
        try {
          if (Capacitor.isNativePlatform()) {
            const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth')
            await GoogleAuth.signOut()
          }
        } catch {}

        // Clear all user data (localStorage, sessionStorage, IndexedDB, Capacitor Preferences, service worker caches)
        await clearAllUserData()
        
        // Force redirect to signup page with cache busting
        // Use replace to prevent back button issues
        setTimeout(() => {
          window.location.replace('/signup?cleared=' + Date.now())
        }, 800)
      } else {
        setFeedback({ type: 'error', text: json?.error || t('account.danger.delete_failed') })
        setLoading(false)
      }
    } catch {
      setFeedback({ type: 'error', text: t('errors.network') })
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
          {t('account.danger.back_to_settings')}
        </button>

        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-6 space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-red-300">{t('account.danger.section_title')}</p>
            <h1 className="text-xl font-semibold text-white">{t('account.danger.delete_title')}</h1>
            <p className="text-sm text-red-200/80 mt-2">
              {t('account.danger.delete_warning')}
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
              {t('account.danger.confirm_label')}
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
            {loading ? t('account.danger.deleting') : t('account.danger.delete_button')}
          </button>
        </div>
      </div>
    </div>
  )
}
