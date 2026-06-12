import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { useUserProfile } from '../../contexts/UserProfileContext'
import {
  BASIC_PROFILE_GATE_EVENT,
  type BasicProfileStatus,
} from '../../utils/basicProfileGate'
import Avatar from '../Avatar'
import { useBasicProfileForm } from './useBasicProfileForm'

type GateEvent = CustomEvent<{ status?: BasicProfileStatus | null }>

function profileValue(profile: Record<string, unknown> | null, key: string): string {
  const raw = profile?.[key]
  return typeof raw === 'string' ? raw : ''
}

/**
 * Reactive 412 backstop: opens when a write action returns
 * basic_profile_required (legacy accounts, cleared-storage edge cases —
 * new members complete this on the welcome modal's You page). Shares the
 * form internals with that page via useBasicProfileForm so the two
 * definitions of "minimum profile" cannot drift.
 */
export default function BasicProfileGateProvider() {
  const { t } = useTranslation()
  const { profile, refresh } = useUserProfile()
  const profileRecord = profile as Record<string, unknown> | null
  const [open, setOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const form = useBasicProfileForm({
    username: profileValue(profileRecord, 'username'),
    onSaved: async () => {
      await refresh().catch(() => null)
      setOpen(false)
    },
  })
  const { setFirstName, setLastName, setCurrentPicture, setError, pickFile } = form

  useEffect(() => {
    const onGate = (event: Event) => {
      const detail = (event as GateEvent).detail || {}
      setFirstName(
        detail.status?.profile?.first_name ||
          profileValue(profileRecord, 'first_name') ||
          profileValue(profileRecord, 'firstName'),
      )
      setLastName(
        detail.status?.profile?.last_name ||
          profileValue(profileRecord, 'last_name') ||
          profileValue(profileRecord, 'lastName'),
      )
      setCurrentPicture(
        detail.status?.profile?.profile_picture ||
          profileValue(profileRecord, 'profile_picture') ||
          profileValue(profileRecord, 'profilePicture') ||
          profileValue(profileRecord, 'avatar_url'),
      )
      pickFile(null)
      setError('')
      setOpen(true)
    }
    window.addEventListener(BASIC_PROFILE_GATE_EVENT, onGate)
    return () => window.removeEventListener(BASIC_PROFILE_GATE_EVENT, onGate)
  }, [profileRecord, setFirstName, setLastName, setCurrentPicture, setError, pickFile])

  if (!open) return null

  const username = profileValue(profileRecord, 'username') || 'You'
  const errorText = form.error
    ? form.error === 'missing_fields'
      ? t('basic_profile.error_missing')
      : form.error === 'save_failed'
        ? t('basic_profile.error_save')
        : form.error
    : ''

  return createPortal(
    <div className="fixed inset-0 z-[2200] flex items-start justify-center overflow-y-auto bg-black/65 px-4 pb-8 pt-[calc(env(safe-area-inset-top,0px)+18px)] backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="basic-profile-title"
        className="w-full max-w-md rounded-3xl border border-c-border bg-c-bg-elevated p-5 shadow-2xl shadow-black/40"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cpoint-turquoise/80">
              {t('basic_profile.kicker')}
            </p>
            <h2 id="basic-profile-title" className="mt-1 text-xl font-semibold text-c-text-primary">
              {t('basic_profile.title')}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-c-text-secondary">
              {t('basic_profile.body')}
            </p>
          </div>
          <button
            type="button"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-c-border bg-c-hover-bg text-c-text-tertiary hover:border-cpoint-turquoise/50 hover:text-cpoint-turquoise"
            aria-label={t('common.close')}
            onClick={() => setOpen(false)}
          >
            <i className="fa-solid fa-xmark text-xs" />
          </button>
        </div>

        <div className="mt-5 flex items-center gap-4">
          <button
            type="button"
            className="relative h-20 w-20 overflow-hidden rounded-full border border-c-border bg-c-active-bg"
            onClick={() => fileInputRef.current?.click()}
            aria-label={t('basic_profile.photo_aria')}
          >
            <Avatar
              username={username}
              url={form.displayPreview}
              size={80}
              displayName={`${form.firstName} ${form.lastName}`.trim()}
            />
            <span className="absolute inset-x-0 bottom-0 bg-black/65 py-1 text-[11px] font-semibold text-white">
              {t('basic_profile.photo_label')}
            </span>
          </button>
          <div className="min-w-0 flex-1 text-sm text-c-text-secondary">
            {t('basic_profile.photo_hint')}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => pickFile(event.target.files?.[0] || null)}
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-c-text-secondary">{t('profile.personal.first_name')}</span>
            <input
              value={form.firstName}
              onChange={(event) => setFirstName(event.target.value)}
              className="mt-1 w-full rounded-2xl border border-c-border bg-c-bg-app px-3 py-3 text-sm text-c-text-primary outline-none focus:border-cpoint-turquoise"
              autoComplete="given-name"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-c-text-secondary">{t('profile.personal.last_name')}</span>
            <input
              value={form.lastName}
              onChange={(event) => setLastName(event.target.value)}
              className="mt-1 w-full rounded-2xl border border-c-border bg-c-bg-app px-3 py-3 text-sm text-c-text-primary outline-none focus:border-cpoint-turquoise"
              autoComplete="family-name"
            />
          </label>
        </div>

        {errorText ? (
          <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {errorText}
          </div>
        ) : null}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="rounded-2xl border border-c-border px-4 py-3 text-sm font-semibold text-c-text-secondary hover:bg-c-hover-bg"
            onClick={() => setOpen(false)}
          >
            {t('basic_profile.not_now')}
          </button>
          <button
            type="button"
            className="rounded-2xl bg-cpoint-turquoise px-4 py-3 text-sm font-semibold text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void form.save()}
            disabled={form.saving}
          >
            {form.saving ? t('basic_profile.saving') : t('basic_profile.save_cta')}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
