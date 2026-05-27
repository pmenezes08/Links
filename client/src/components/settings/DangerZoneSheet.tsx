import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { useTranslation } from 'react-i18next'

import { resetAccountScopedState } from '../../utils/accountStateReset'
import { triggerHaptic } from '../../utils/haptics'
import { unregisterPushBeforeLogout } from '../../utils/logout'

type DangerZoneSheetProps = {
  open: boolean
  onClose: () => void
}

async function clearAllUserData(): Promise<void> {
  // Deactivate push tokens while session cookie is still valid.
  await unregisterPushBeforeLogout()

  try {
    if (Capacitor.isNativePlatform()) await Preferences.clear()
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
      cache: 'no-store',
    })
  } catch (e) {
    console.warn('Error calling logout:', e)
  }
}

export default function DangerZoneSheet({ open, onClose }: DangerZoneSheetProps) {
  const { t } = useTranslation()
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!open) {
      setConfirmation('')
      setFeedback(null)
      return
    }
    void triggerHaptic('medium')
  }, [open])

  const close = () => {
    if (loading) return
    void triggerHaptic('light')
    onClose()
  }

  const handleDelete = async () => {
    if (confirmation.trim().toUpperCase() !== 'DELETE') {
      setFeedback({ type: 'error', text: t('account.danger.confirm_error') })
      void triggerHaptic('warning')
      return
    }
    setFeedback(null)
    setLoading(true)
    void triggerHaptic('warning')
    try {
      const resp = await fetch('/delete_account', { method: 'POST', credentials: 'include' })
      if (!resp.ok) {
        setFeedback({ type: 'error', text: t('account.danger.server_error', { status: resp.status }) })
        setLoading(false)
        void triggerHaptic('error')
        return
      }
      const json = await resp.json().catch(() => null)
      if (json?.success) {
        setFeedback({ type: 'success', text: t('account.danger.deleted') })
        void triggerHaptic('success')

        try {
          if (Capacitor.isNativePlatform()) {
            const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth')
            await GoogleAuth.signOut()
          }
        } catch {}

        await clearAllUserData()

        setTimeout(() => {
          window.location.replace('/signup?cleared=' + Date.now())
        }, 800)
      } else {
        setFeedback({ type: 'error', text: json?.error || t('account.danger.delete_failed') })
        setLoading(false)
        void triggerHaptic('error')
      }
    } catch {
      setFeedback({ type: 'error', text: t('errors.network') })
      setLoading(false)
      void triggerHaptic('error')
    }
  }

  return (
    <div
      className={`fixed inset-0 z-[1300] flex items-end bg-black/60 transition-opacity duration-300 ${
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      }`}
      onClick={close}
      aria-hidden={!open}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full rounded-t-[2rem] border border-red-300/15 bg-[#090909] px-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] pt-3 text-white shadow-[0_-28px_80px_rgba(0,0,0,0.72)] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
        onClick={e => e.stopPropagation()}
      >
        <div className="mx-auto mb-5 h-1 w-11 rounded-full bg-white/20" />
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-red-300/80">{t('account.danger.section_title')}</p>
        <h2 className="mt-1 text-2xl font-bold tracking-[-0.03em] text-white">{t('account.danger.delete_title')}</h2>
        <p className="mt-2 text-sm leading-6 text-red-100/65">{t('account.danger.delete_warning')}</p>

        {feedback ? (
          <div
            className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
              feedback.type === 'success'
                ? 'border-white/10 bg-white/[0.055] text-white/75'
                : 'border-red-400/25 bg-red-500/10 text-red-200'
            }`}
          >
            {feedback.text}
          </div>
        ) : null}

        <label className="mt-5 block">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/28">{t('account.danger.confirm_label')}</span>
          <input
            type="text"
            value={confirmation}
            onChange={e => setConfirmation(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-red-300/20 bg-white/[0.06] px-4 py-3 text-white placeholder:text-white/25 focus:border-red-200/60 focus:outline-none"
            placeholder="DELETE"
            disabled={loading}
          />
        </label>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={close}
            className="rounded-2xl border border-white/10 px-4 py-3 font-bold text-white/75 active:bg-white/10 disabled:opacity-50"
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleDelete()}
            className="rounded-2xl bg-red-500 px-4 py-3 font-bold text-white active:opacity-80 disabled:opacity-50"
          >
            {loading ? t('account.danger.deleting') : t('account.danger.delete_button')}
          </button>
        </div>
      </div>
    </div>
  )
}
