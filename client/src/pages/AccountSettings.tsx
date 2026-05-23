import { useEffect, useState, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ManageMembershipModal, { type MembershipTab } from '../components/membership/ManageMembershipModal'
import RequestMyDataModal from '../components/privacy/RequestMyDataModal'
import LanguagePicker from '../components/settings/LanguagePicker'

type ProfileData = {
  username: string
  email: string
  subscription: string
  display_name: string
  bio: string
  location: string
  website: string
  instagram: string
  twitter: string
  profile_picture: string
  cover_photo: string
  /** When true, in-app notifications include a short text preview of the post or reply */
  notification_show_previews?: boolean
}

function cpointVersionEnvironment(): 'Production' | 'Staging' {
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  return host === 'app.c-point.co' ? 'Production' : 'Staging'
}

export default function AccountSettings(){
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [profile, setProfile] = useState<ProfileData|null>(null)
  const [loading, setLoading] = useState(true)
  // Removed saving state since only email updates are handled here now
  const [message, setMessage] = useState<{type: 'success'|'error', text: string}|null>(null)
  const [showVerifyModal, setShowVerifyModal] = useState(false)
  const [notifStatus, setNotifStatus] = useState<'granted' | 'denied' | 'default' | 'loading'>('loading')
  const [membershipTab, setMembershipTab] = useState<MembershipTab | null>(null)
  const [showRequestMyData, setShowRequestMyData] = useState(false)

  const openMembership = useCallback((tab: MembershipTab = 'plan') => {
    setMembershipTab(tab)
  }, [])
  const closeMembership = useCallback(() => setMembershipTab(null), [])

  // Honor /account_settings/membership and /settings/membership with optional
  // ?tab=ai|billing|payment|plan to open the modal directly.
  useEffect(() => {
    const path = window.location.pathname
    if (!/membership/.test(path)) return
    const params = new URLSearchParams(window.location.search)
    const tab = params.get('tab') as MembershipTab | null
    const allowed: MembershipTab[] = ['plan', 'ai', 'billing', 'payment']
    const initial = tab && allowed.includes(tab) ? tab : 'plan'
    setMembershipTab(initial)
  }, [])

  const checkNotifPermission = useCallback(async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        const { PushNotifications } = await import('@capacitor/push-notifications')
        const result = await PushNotifications.checkPermissions()
        setNotifStatus(result.receive === 'granted' ? 'granted' : result.receive === 'denied' ? 'denied' : 'default')
      } else if ('Notification' in window) {
        setNotifStatus(Notification.permission as 'granted' | 'denied' | 'default')
      } else {
        setNotifStatus('denied')
      }
    } catch {
      setNotifStatus('denied')
    }
  }, [])

  const saveNotificationPreviewPref = useCallback(async (show: boolean, previousValue: boolean | undefined) => {
    try {
      const r = await fetch('/api/account/notification_preferences', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ show_content_previews: show }),
      })
      const j = await r.json().catch(() => null)
      if (!j?.success) {
        setMessage({ type: 'error', text: j?.error || t('account.messages.notification_update_failed') })
        setProfile(prev =>
          prev ? { ...prev, notification_show_previews: previousValue } : null
        )
        return
      }
      setProfile(prev =>
        prev
          ? {
              ...prev,
              notification_show_previews:
                typeof j.show_content_previews === 'boolean' ? j.show_content_previews : show,
            }
          : null
      )
      loadProfile({ silent: true, refresh: true })
    } catch {
      setMessage({ type: 'error', text: t('account.messages.notification_update_network') })
      setProfile(prev =>
        prev ? { ...prev, notification_show_previews: previousValue } : null
      )
    }
  }, [t])

  const openDeviceSettings = useCallback(async () => {
    try {
      if (Capacitor.getPlatform() === 'ios') {
        const { App: CapApp } = await import('@capacitor/app')
        // @ts-ignore - openUrl may not be in types but works at runtime
        if (CapApp.openUrl) await CapApp.openUrl({ url: 'app-settings:' })
        else window.open('app-settings:', '_system')
      } else if (Capacitor.getPlatform() === 'android') {
        const { App: CapApp } = await import('@capacitor/app')
        // @ts-ignore
        if (CapApp.openUrl) await CapApp.openUrl({ url: 'android.settings.APP_NOTIFICATION_SETTINGS' })
        else alert(t('account.notifications.android_settings_alert'))
      } else {
        alert(t('account.notifications.browser_settings_alert'))
      }
    } catch {
      alert(t('account.notifications.device_settings_alert'))
    }
  }, [t])

  useEffect(() => { setTitle(t('account.settings')) }, [setTitle, t])
  useEffect(() => { checkNotifPermission() }, [checkNotifPermission])

  useEffect(() => {
    loadProfile()
  }, [])

  function loadProfile(opts?: { silent?: boolean; refresh?: boolean }) {
    const silent = !!opts?.silent
    const refresh = !!opts?.refresh
    if (!silent) setLoading(true)
    const url = refresh ? '/api/profile_me?refresh=1' : '/api/profile_me'
    fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(j => {
        if (j?.success && j.profile) {
          setProfile(j.profile)
        } else if (!silent) {
          setMessage({ type: 'error', text: t('account.messages.profile_load_failed') })
        }
      })
      .catch(() => {
        if (!silent) setMessage({ type: 'error', text: t('account.messages.profile_load_error') })
      })
      .finally(() => {
        if (!silent) setLoading(false)
      })
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    setMessage(null)

    // Save public fields
    const pf = new FormData()
    ;(['display_name','bio','location','website','instagram','twitter'] as const).forEach((k)=>{
      const v = (profile as any)[k]
      if (v !== undefined) pf.append(k, v as string)
    })
    fetch('/update_public_profile', { method:'POST', credentials:'include', body: pf })
      .then(()=>{})
      .catch(()=>{})
      .finally(()=>{})

    // If email changed, call update_email
    const newEmail = profile.email
    if (newEmail) {
      const ef = new FormData()
      ef.append('new_email', newEmail)
      fetch('/update_email', { method:'POST', credentials:'include', body: ef })
        .then(r=>r.json())
        .then(j=>{
          if (j?.success) {
            setShowVerifyModal(true)
            setMessage({ type: 'success', text: t('account.messages.email_updated') })
          } else if (j?.error) {
            setMessage({ type: 'error', text: j.error })
          }
        })
        .catch(()=> setMessage({ type:'error', text:t('account.messages.email_update_error') }))
        .finally(()=> {})
    } else {
      // no-op
    }
  }

  function handleInputChange(field: keyof ProfileData, value: string) {
    if (!profile) return
    setProfile(prev => prev ? { ...prev, [field]: value } : null)
  }

  if (loading) {
    return (
      <div className="h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <i className="fa-solid fa-spinner fa-spin text-2xl mb-4" />
          <div>{t('account.info.loading_profile')}</div>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <i className="fa-solid fa-exclamation-triangle text-2xl mb-4 text-red-400" />
          <div>{t('account.messages.profile_load_failed')}</div>
          <button 
            className="mt-4 px-4 py-2 bg-[#4db6ac] text-black rounded-lg hover:bg-[#45a99c]"
            onClick={() => loadProfile()}
          >
            {t('account.info.try_again')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="glass-page min-h-screen text-white pb-safe">
      <div className="glass-card glass-card--plain max-w-2xl mx-auto px-4 pb-8 space-y-8">
        {message && (
          <div
            className={`mb-6 rounded-lg border p-4 ${
              message.type === 'success'
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
          >
            {message.text}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-6">
          {/* Account Information */}
        <div className="glass-section space-y-4">
            <div>
              <h2 className="text-lg font-semibold">{t('account.info.section_title')}</h2>
              <p className="text-sm text-white/60">{t('account.info.helper')}</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium">{t('account.info.username')}</label>
                <input
                  type="text"
                  value={profile.username}
                  disabled
                  className="w-full cursor-not-allowed rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-white/60"
                />
                <div className="mt-1 text-xs text-white/50">{t('account.info.username_locked')}</div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">{t('account.info.email')}</label>
                <input
                  type="email"
                  value={profile.email || ''}
                  onChange={e => handleInputChange('email', e.target.value)}
                  placeholder={t('account.info.email_placeholder')}
                  className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-white focus:border-[#4db6ac] focus:outline-none"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#4db6ac] px-4 py-2 font-semibold text-black hover:bg-[#3da398]"
                >
                  <i className="fa-solid fa-floppy-disk" />
                  {t('account.info.save_changes')}
                </button>
              </div>
            </div>
          </div>

        <div className="glass-section space-y-2">
          <div>
            <h2 className="text-lg font-semibold">{t('account.about.section_title')}</h2>
            <p className="text-sm text-white/60">{t('account.about.helper')}</p>
          </div>
          {Capacitor.getPlatform() === 'ios' && (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/75">
              {t('account.about.version_environment', {
                environment: cpointVersionEnvironment(),
              })}
            </div>
          )}
          <button
            type="button"
            onClick={() => navigate('/about_cpoint')}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:border-[#4db6ac]/50"
          >
            <i className="fa-solid fa-circle-info" />
            {t('account.about.open')}
          </button>
        </div>

          {/* Privacy & Security summary */}
        <div className="glass-section">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">{t('account.privacy.section_title')}</h2>
              <p className="text-sm text-white/60">
                {t('account.privacy.helper')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/account_settings/security')}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:border-white/40"
            >
              <i className="fa-solid fa-shield"></i>
              {t('account.privacy.open')}
            </button>
            <button
              type="button"
              onClick={() => setShowRequestMyData(true)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-white/80 hover:border-white/30"
            >
              <i className="fa-solid fa-download"></i>
              {t('account.privacy.request_data')}
            </button>
            <p className="mt-2 text-xs text-white/40">
              {t('account.privacy.request_data_helper')}
            </p>
          </div>

          {/* Subscription Management */}
        <div className="glass-section">
            <h2 className="text-lg font-semibold mb-4">{t('account.subscription.section_title')}</h2>
            <p className="text-sm text-white/60 mb-4">
              {t('account.subscription.helper')}
            </p>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium">{t('account.subscription.label')}</label>
                <div
                  className={`rounded-lg border px-4 py-3 ${
                    profile.subscription === 'premium'
                      ? 'bg-[#4db6ac]/10 border-[#4db6ac]/30 text-[#4db6ac]'
                      : 'bg-white/5 border-white/20 text-white/60'
                  }`}
                >
                  {profile.subscription === 'premium' ? t('account.subscription.premium') : t('account.subscription.free')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => openMembership('plan')}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:border-white/40"
              >
                <i className="fa-regular fa-credit-card" />
                {t('account.subscription.manage_membership')}
              </button>
              <button
                type="button"
                onClick={() => openMembership('ai')}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-xs font-medium text-white/80 hover:border-white/30"
              >
                <i className="fa-solid fa-robot" />
                {t('account.subscription.view_ai_usage')}
              </button>
            </div>
          </div>

        </form>

        <div className="space-y-6">
          {/* Notifications — outside the account form so the preview toggle cannot submit the form or conflict with Enter-to-save */}
          <div className="glass-section space-y-4">
            <div>
              <h2 className="text-lg font-semibold">{t('account.notifications.section_title')}</h2>
              <p className="text-sm text-white/60">{t('account.notifications.helper')}</p>
            </div>
            {notifStatus === 'loading' ? (
              <div className="text-sm text-white/40">{t('account.notifications.checking')}</div>
            ) : notifStatus === 'granted' ? (
              <div className="flex items-center gap-3 rounded-lg bg-green-500/10 border border-green-500/20 px-4 py-3">
                <i className="fa-solid fa-bell text-green-400" />
                <div>
                  <div className="text-sm font-medium text-green-400">{t('account.notifications.enabled')}</div>
                  <div className="text-xs text-white/50">{t('account.notifications.enabled_helper')}</div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3 rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3">
                  <i className="fa-solid fa-bell-slash text-amber-400" />
                  <div>
                    <div className="text-sm font-medium text-amber-400">{t('account.notifications.disabled')}</div>
                    <div className="text-xs text-white/50">{t('account.notifications.disabled_helper')}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openDeviceSettings}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#4db6ac] px-4 py-2 text-sm font-semibold text-black hover:bg-[#3da398]"
                >
                  <i className="fa-solid fa-gear" />
                  {t('account.notifications.open_settings')}
                </button>
                <p className="text-xs text-white/40 text-center">
                  {Capacitor.isNativePlatform()
                    ? t('account.notifications.native_helper')
                    : t('account.notifications.browser_helper')}
                </p>
              </div>
            )}
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 rounded border-white/30 bg-black/40 text-[#4db6ac] [accent-color:#4db6ac] focus:ring-[#4db6ac]"
                  checked={profile.notification_show_previews !== false}
                  onChange={e => {
                    const v = e.target.checked
                    const previousValue = profile.notification_show_previews
                    setProfile(prev => (prev ? { ...prev, notification_show_previews: v } : null))
                    void saveNotificationPreviewPref(v, previousValue)
                  }}
                />
                <div>
                  <div className="text-sm font-medium text-white">{t('account.notifications.preview_label')}</div>
                  <div className="text-xs text-white/50 mt-0.5">
                    {t('account.notifications.preview_helper')}
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Language picker -- locked decision: lives between Notifications and
              Danger Zone (docs/I18N_ROADMAP.md § 3). */}
          <LanguagePicker />

          {/* Danger Zone */}
          <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-6">
            <h2 className="text-lg font-semibold text-red-300">{t('account.danger.section_title')}</h2>
            <p className="text-sm text-red-200/80 mt-2">
              {t('account.danger.summary')}
            </p>
            <button
              type="button"
              onClick={() => navigate('/account_settings/danger')}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-red-300/40 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/10"
            >
              <i className="fa-solid fa-skull"></i>
              {t('account.danger.go')}
            </button>
          </div>
        </div>

        {showVerifyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
            <div className="w-[90%] max-w-md rounded-xl border border-white/10 bg-[#0b0b0b] p-4">
              <div className="text-lg font-semibold mb-1">{t('account.verify.title')}</div>
              <div className="text-sm text-white/80">
                {t('account.verify.body')}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button className="rounded-md bg-[#4db6ac] px-3 py-2 text-black" onClick={() => setShowVerifyModal(false)}>
                  {t('common.ok')}
                </button>
                <button
                  className="rounded-md border border-white/10 px-3 py-2"
                  onClick={async () => {
                    try {
                      const r = await fetch('/resend_verification', { method: 'POST', credentials: 'include' })
                      const j = await r.json().catch(() => null)
                      if (!j?.success) alert(j?.error || t('account.messages.resend_failed'))
                      else alert(t('account.messages.verification_sent'))
                    } catch {
                      alert(t('account.messages.network_error'))
                    }
                  }}
                >
                  {t('account.verify.resend')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ManageMembershipModal
        open={membershipTab !== null}
        initialTab={membershipTab ?? 'plan'}
        onClose={closeMembership}
      />
      <RequestMyDataModal
        open={showRequestMyData}
        onClose={() => setShowRequestMyData(false)}
        username={profile?.username}
        accountEmail={profile?.email}
      />
    </div>
  )
}