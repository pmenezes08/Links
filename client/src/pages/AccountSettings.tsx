import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Capacitor } from '@capacitor/core'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import DangerZoneSheet from '../components/settings/DangerZoneSheet'
import LanguageSettingsPanel from '../components/settings/LanguageSettingsPanel'
import ManageMembershipModal, { type MembershipTab } from '../components/membership/ManageMembershipModal'
import PrivacySecurityPanel from '../components/settings/PrivacySecurityPanel'
import RequestMyDataModal from '../components/privacy/RequestMyDataModal'
import SettingsHome, { type SettingsPanelKey } from '../components/settings/SettingsHome'
import SettingsPanel from '../components/settings/SettingsPanel'
import SettingsSwitch from '../components/settings/SettingsSwitch'
import { ABOUT_CPOINT_VERSION_LABEL } from '../content/aboutCPoint'
import { useHeader } from '../contexts/HeaderContext'
import { LOCALE_OPTIONS } from '../i18n/localeOptions'
import { useLocale } from '../i18n/useLocale'
import { triggerHaptic } from '../utils/haptics'
import { SkeletonSettingsList } from '../components/SkeletonRow'

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
  notification_show_previews?: boolean
}

function cpointVersionEnvironment(): 'Production' | 'Staging' {
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  return host === 'app.c-point.co' ? 'Production' : 'Staging'
}

function FieldCard({
  label,
  children,
  helper,
}: {
  label: string
  children: ReactNode
  helper?: string
}) {
  return (
    <label className="block rounded-3xl border border-white/[0.06] bg-white/[0.055] p-4">
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/28">{label}</span>
      <div className="mt-2">{children}</div>
      {helper ? <span className="mt-2 block text-xs text-white/35">{helper}</span> : null}
    </label>
  )
}

function PanelCard({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-3xl border border-white/[0.06] bg-white/[0.055]">{children}</div>
}

export default function AccountSettings() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { locale } = useLocale()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showVerifyModal, setShowVerifyModal] = useState(false)
  const [notifStatus, setNotifStatus] = useState<'granted' | 'denied' | 'default' | 'loading'>('loading')
  const [membershipTab, setMembershipTab] = useState<MembershipTab | null>(null)
  const [showRequestMyData, setShowRequestMyData] = useState(false)
  const [activePanel, setActivePanel] = useState<SettingsPanelKey | null>(null)
  const [dangerOpen, setDangerOpen] = useState(false)

  const openMembership = useCallback((tab: MembershipTab = 'plan') => {
    void triggerHaptic('selection')
    setMembershipTab(tab)
  }, [])
  const closeMembership = useCallback(() => setMembershipTab(null), [])

  useEffect(() => {
    const path = window.location.pathname
    if (/membership/.test(path)) {
      const params = new URLSearchParams(window.location.search)
      const tab = params.get('tab') as MembershipTab | null
      const allowed: MembershipTab[] = ['plan', 'ai', 'billing', 'payment']
      setMembershipTab(tab && allowed.includes(tab) ? tab : 'plan')
    }
    if (/\/account_settings\/security$/.test(path)) setActivePanel('privacy')
    if (/\/account_settings\/danger$/.test(path)) setDangerOpen(true)
  }, [])

  const loadProfile = useCallback((opts?: { silent?: boolean; refresh?: boolean }) => {
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
  }, [t])

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
        setProfile(prev => (prev ? { ...prev, notification_show_previews: previousValue } : null))
        void triggerHaptic('error')
        return
      }
      setProfile(prev =>
        prev
          ? {
              ...prev,
              notification_show_previews: typeof j.show_content_previews === 'boolean' ? j.show_content_previews : show,
            }
          : null,
      )
      loadProfile({ silent: true, refresh: true })
      void triggerHaptic('success')
    } catch {
      setMessage({ type: 'error', text: t('account.messages.notification_update_network') })
      setProfile(prev => (prev ? { ...prev, notification_show_previews: previousValue } : null))
      void triggerHaptic('error')
    }
  }, [loadProfile, t])

  const openDeviceSettings = useCallback(async () => {
    void triggerHaptic('selection')
    try {
      if (Capacitor.getPlatform() === 'ios') {
        const { App: CapApp } = await import('@capacitor/app')
        // @ts-ignore - openUrl may not be in types but works at runtime.
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
  useEffect(() => { void checkNotifPermission() }, [checkNotifPermission])
  useEffect(() => { loadProfile() }, [loadProfile])

  useEffect(() => {
    const locked = activePanel !== null || dangerOpen
    const previous = document.body.style.overflow
    if (locked) document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [activePanel, dangerOpen])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 2400)
    return () => window.clearTimeout(id)
  }, [toast])

  function openPanel(panel: SettingsPanelKey) {
    void triggerHaptic('light')
    setActivePanel(panel)
  }

  function closePanel() {
    setActivePanel(null)
  }

  function handleInputChange(field: keyof ProfileData, value: string) {
    setProfile(prev => (prev ? { ...prev, [field]: value } : null))
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    setMessage(null)

    const pf = new FormData()
    ;(['display_name', 'bio', 'location', 'website', 'instagram', 'twitter'] as const).forEach(k => {
      const v = profile[k]
      if (v !== undefined) pf.append(k, v as string)
    })
    fetch('/update_public_profile', { method: 'POST', credentials: 'include', body: pf }).catch(() => {})

    if (profile.email) {
      const ef = new FormData()
      ef.append('new_email', profile.email)
      fetch('/update_email', { method: 'POST', credentials: 'include', body: ef })
        .then(r => r.json())
        .then(j => {
          if (j?.success) {
            setShowVerifyModal(true)
            setMessage({ type: 'success', text: t('account.messages.email_updated') })
            void triggerHaptic('success')
          } else if (j?.error) {
            setMessage({ type: 'error', text: j.error })
            void triggerHaptic('error')
          }
        })
        .catch(() => {
          setMessage({ type: 'error', text: t('account.messages.email_update_error') })
          void triggerHaptic('error')
        })
    }
  }

  const languageLabel = useMemo(() => {
    const option = LOCALE_OPTIONS.find(opt => opt.value === locale)
    return option ? t(option.labelKey) : String(locale)
  }, [locale, t])

  const notificationLabel = useMemo(() => {
    if (notifStatus === 'loading') return t('account.notifications.checking')
    return notifStatus === 'granted' ? t('account.notifications.enabled') : t('account.notifications.disabled')
  }, [notifStatus, t])

  if (loading) {
    return (
      <div className="overflow-hidden bg-black text-white" style={{ minHeight: 'calc(100dvh - var(--app-header-offset, 0px))' }}>
        <div className="mx-auto max-w-xl px-4 pt-4">
          <SkeletonSettingsList />
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <div className="text-center">
          <i className="fa-solid fa-exclamation-triangle mb-4 text-2xl text-red-400" />
          <div>{t('account.messages.profile_load_failed')}</div>
          <button
            className="mt-4 rounded-lg bg-[#4db6ac] px-4 py-2 text-black hover:bg-[#45a99c]"
            onClick={() => loadProfile()}
          >
            {t('account.info.try_again')}
          </button>
        </div>
      </div>
    )
  }

  const isPanelOpen = activePanel !== null
  const isPremium = profile.subscription === 'premium'
  const settingsMinHeight = 'calc(100dvh - var(--app-header-offset, 0px))'

  return (
    <div className="overflow-hidden bg-black text-white" style={{ minHeight: settingsMinHeight }}>
      <div className="relative mx-auto max-w-xl overflow-hidden bg-black" style={{ minHeight: settingsMinHeight }}>
        <div
          className={`transition-[transform,opacity,filter] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
            isPanelOpen ? '-translate-x-[24%] opacity-45 blur-[1px]' : 'translate-x-0 opacity-100 blur-0'
          }`}
          style={{ minHeight: settingsMinHeight }}
        >
          <SettingsHome
            username={profile.username}
            email={profile.email}
            avatarUrl={profile.profile_picture}
            subscription={profile.subscription}
            notificationsLabel={notificationLabel}
            languageLabel={languageLabel}
            activePanel={activePanel}
            dangerOpen={dangerOpen}
            onOpenPanel={openPanel}
            onOpenDanger={() => {
              setDangerOpen(true)
            }}
          />
        </div>

        <SettingsPanel title="Account" open={activePanel === 'account'} onBack={closePanel}>
          {message ? (
            <div className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${message.type === 'success' ? 'border-white/10 bg-white/[0.055] text-white/75' : 'border-red-400/25 bg-red-500/10 text-red-200'}`}>
              {message.text}
            </div>
          ) : null}
          <form onSubmit={handleSave} className="space-y-4">
            <FieldCard label={t('account.info.username')} helper={t('account.info.username_locked')}>
              <input
                type="text"
                value={profile.username}
                disabled
                className="w-full cursor-not-allowed rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-white/45"
              />
            </FieldCard>
            <FieldCard label={t('account.info.email')}>
              <input
                type="email"
                value={profile.email || ''}
                onChange={e => handleInputChange('email', e.target.value)}
                placeholder={t('account.info.email_placeholder')}
                className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.08] px-4 py-3 text-white placeholder:text-white/25 focus:border-[#4db6ac] focus:outline-none"
              />
            </FieldCard>
            <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4db6ac] px-4 py-3 font-bold text-black active:opacity-80">
              <i className="fa-solid fa-check" />
              {t('account.info.save_changes')}
            </button>
          </form>
        </SettingsPanel>

        <SettingsPanel title="Subscription" open={activePanel === 'subscription'} onBack={closePanel}>
          <div className="space-y-4">
            <PanelCard>
              <div className="p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/28">{t('account.subscription.label')}</div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-xl font-bold text-white">{isPremium ? t('account.subscription.premium') : t('account.subscription.free')}</div>
                  {isPremium ? <span className="rounded-full bg-[#4db6ac]/12 px-3 py-1 text-xs font-bold text-[#4db6ac]">Premium</span> : null}
                </div>
                <p className="mt-2 text-sm text-white/45">{t('account.subscription.helper')}</p>
              </div>
            </PanelCard>
            <button type="button" onClick={() => openMembership('plan')} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4db6ac] px-4 py-3 font-bold text-black active:opacity-80">
              <i className="fa-regular fa-credit-card" />
              {t('account.subscription.manage_membership')}
            </button>
            <button type="button" onClick={() => openMembership('ai')} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 py-3 font-bold text-white/75 active:bg-white/10">
              <i className="fa-solid fa-robot" />
              {t('account.subscription.view_ai_usage')}
            </button>
          </div>
        </SettingsPanel>

        <SettingsPanel title="Notifications" open={activePanel === 'notifications'} onBack={closePanel}>
          <div className="space-y-4">
            <PanelCard>
              <div className="p-4">
                <div className="text-base font-bold text-white">{notificationLabel}</div>
                <p className="mt-1 text-sm text-white/45">
                  {notifStatus === 'granted'
                    ? t('account.notifications.enabled_helper')
                    : t('account.notifications.disabled_helper')}
                </p>
              </div>
              {notifStatus !== 'granted' && notifStatus !== 'loading' ? (
                <div className="border-t border-white/[0.055] p-4">
                  <button type="button" onClick={openDeviceSettings} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4db6ac] px-4 py-3 font-bold text-black active:opacity-80">
                    <i className="fa-solid fa-gear" />
                    {t('account.notifications.open_settings')}
                  </button>
                </div>
              ) : null}
            </PanelCard>
            <PanelCard>
              <SettingsSwitch
                checked={profile.notification_show_previews !== false}
                label={t('account.notifications.preview_label')}
                description={t('account.notifications.preview_helper')}
                onChange={v => {
                  void triggerHaptic('selection')
                  const previousValue = profile.notification_show_previews
                  setProfile(prev => (prev ? { ...prev, notification_show_previews: v } : null))
                  void saveNotificationPreviewPref(v, previousValue)
                }}
              />
            </PanelCard>
          </div>
        </SettingsPanel>

        <SettingsPanel title={t('account.language.section_title')} open={activePanel === 'language'} onBack={closePanel}>
          <LanguageSettingsPanel onDone={closePanel} onToast={(text, type = 'success') => setToast({ text, type })} />
        </SettingsPanel>

        <SettingsPanel title={t('account.privacy.section_title')} open={activePanel === 'privacy'} onBack={closePanel}>
          <div className="space-y-5">
            <PrivacySecurityPanel />
            <PanelCard>
              <button
                type="button"
                onClick={() => {
                  void triggerHaptic('selection')
                  setShowRequestMyData(true)
                }}
                className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left active:bg-white/[0.08]"
              >
                <span>
                  <span className="block text-base font-bold text-white">{t('account.privacy.request_data')}</span>
                  <span className="mt-0.5 block text-sm text-white/45">{t('account.privacy.request_data_helper')}</span>
                </span>
                <i className="fa-solid fa-chevron-right text-xs text-white/22" />
              </button>
            </PanelCard>
          </div>
        </SettingsPanel>

        <SettingsPanel title={t('account.about.section_title')} open={activePanel === 'about'} onBack={closePanel}>
          <div className="space-y-5">
            <PanelCard>
              <div className="border-b border-white/[0.055] p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/28">Version</div>
                <div className="mt-2 text-xl font-bold text-white">{cpointVersionEnvironment()}</div>
                <div className="mt-1 text-sm text-white/35">Up to date</div>
              </div>
              <div className="p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/28">Build</div>
                <div className="mt-2 text-xl font-bold text-white">{ABOUT_CPOINT_VERSION_LABEL}</div>
              </div>
            </PanelCard>
            <PanelCard>
              <button type="button" onClick={() => { void triggerHaptic('selection'); navigate('/about_cpoint') }} className="flex w-full items-center justify-between px-4 py-4 text-left active:bg-white/[0.08]">
                <span>
                  <span className="block text-base font-bold text-white">{t('account.about.open')}</span>
                  <span className="mt-0.5 block text-sm text-white/45">{t('account.about.helper')}</span>
                </span>
                <i className="fa-solid fa-chevron-right text-xs text-white/22" />
              </button>
            </PanelCard>
          </div>
        </SettingsPanel>
      </div>

      {toast ? (
        <div className={`fixed left-1/2 top-[calc(env(safe-area-inset-top,0px)+1rem)] z-[1400] -translate-x-1/2 rounded-full border px-4 py-2 text-sm font-semibold shadow-2xl backdrop-blur-xl ${toast.type === 'success' ? 'border-white/10 bg-white/10 text-white' : 'border-red-400/25 bg-red-500/20 text-red-100'}`}>
          {toast.text}
        </div>
      ) : null}

      {showVerifyModal && (
        <div className="fixed inset-0 z-[1350] flex items-center justify-center bg-black/70 p-5">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0b0b0b] p-5">
            <div className="mb-1 text-lg font-bold">{t('account.verify.title')}</div>
            <div className="text-sm text-white/70">{t('account.verify.body')}</div>
            <div className="mt-4 flex items-center gap-2">
              <button className="rounded-2xl bg-[#4db6ac] px-4 py-2 font-bold text-black" onClick={() => setShowVerifyModal(false)}>
                {t('common.ok')}
              </button>
              <button
                className="rounded-2xl border border-white/10 px-4 py-2 text-white/75"
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

      <DangerZoneSheet open={dangerOpen} onClose={() => setDangerOpen(false)} />
      <ManageMembershipModal open={membershipTab !== null} initialTab={membershipTab ?? 'plan'} onClose={closeMembership} />
      <RequestMyDataModal
        open={showRequestMyData}
        onClose={() => setShowRequestMyData(false)}
        username={profile?.username}
        accountEmail={profile?.email}
      />
    </div>
  )
}
