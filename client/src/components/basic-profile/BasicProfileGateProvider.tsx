import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useUserProfile } from '../../contexts/UserProfileContext'
import {
  BASIC_PROFILE_COMPLETED_EVENT,
  BASIC_PROFILE_GATE_EVENT,
  type BasicProfileStatus,
} from '../../utils/basicProfileGate'
import Avatar, { clearImageCache } from '../Avatar'

type GateEvent = CustomEvent<{ status?: BasicProfileStatus | null }>

function profileValue(profile: Record<string, unknown> | null, key: string): string {
  const raw = profile?.[key]
  return typeof raw === 'string' ? raw : ''
}

export default function BasicProfileGateProvider() {
  const { profile, refresh } = useUserProfile()
  const profileRecord = profile as Record<string, unknown> | null
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<BasicProfileStatus | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const onGate = (event: Event) => {
      const detail = (event as GateEvent).detail || {}
      setStatus(detail.status || null)
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
      setFile(null)
      setPreviewUrl(null)
      setError('')
      setOpen(true)
    }
    window.addEventListener(BASIC_PROFILE_GATE_EVENT, onGate)
    return () => window.removeEventListener(BASIC_PROFILE_GATE_EVENT, onGate)
  }, [profileRecord])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const currentPicture = useMemo(() => {
    const fromStatus = status?.profile?.profile_picture
    if (fromStatus) return fromStatus
    return (
      profileValue(profileRecord, 'profile_picture') ||
      profileValue(profileRecord, 'profilePicture') ||
      profileValue(profileRecord, 'avatar_url')
    )
  }, [profileRecord, status])

  async function save() {
    const cleanFirst = firstName.trim()
    const cleanLast = lastName.trim()
    if (!cleanFirst || !cleanLast || (!file && !currentPicture)) {
      setError('Add your first name, last name, and a profile picture to participate.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('first_name', cleanFirst)
      fd.append('last_name', cleanLast)
      if (file) fd.append('profile_picture', file)
      const res = await fetch('/api/me/basic_profile', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      })
      const json = await res.json().catch(() => null)
      if (!json?.success) {
        setError(json?.error || 'Could not save your profile.')
        return
      }
      try {
        clearImageCache(profileValue(profileRecord, 'username'))
      } catch {}
      await refresh().catch(() => null)
      window.dispatchEvent(new CustomEvent(BASIC_PROFILE_COMPLETED_EVENT, { detail: json.basic_profile }))
      setOpen(false)
    } catch {
      setError('Could not save your profile.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const username = profileValue(profileRecord, 'username') || 'You'
  const displayPreview = previewUrl || currentPicture || undefined

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
              Almost there
            </p>
            <h2 id="basic-profile-title" className="mt-1 text-xl font-semibold text-c-text-primary">
              Add your name and photo
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-c-text-secondary">
              You can look around first. To post, reply, react, invite, or message, C-Point asks for a basic real profile.
            </p>
          </div>
          <button
            type="button"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-c-border bg-c-hover-bg text-c-text-tertiary hover:border-cpoint-turquoise/50 hover:text-cpoint-turquoise"
            aria-label="Close"
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
          >
            <Avatar username={username} url={displayPreview} size={80} displayName={`${firstName} ${lastName}`.trim()} />
            <span className="absolute inset-x-0 bottom-0 bg-black/65 py-1 text-[11px] font-semibold text-white">
              Photo
            </span>
          </button>
          <div className="min-w-0 flex-1 text-sm text-c-text-secondary">
            A face or clear profile image helps owners and members know who is in the room.
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const next = event.target.files?.[0] || null
              setFile(next)
              setError('')
              if (previewUrl) URL.revokeObjectURL(previewUrl)
              setPreviewUrl(next ? URL.createObjectURL(next) : null)
            }}
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-c-text-secondary">First name</span>
            <input
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              className="mt-1 w-full rounded-2xl border border-c-border bg-c-bg-app px-3 py-3 text-sm text-c-text-primary outline-none focus:border-cpoint-turquoise"
              autoComplete="given-name"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-c-text-secondary">Last name</span>
            <input
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              className="mt-1 w-full rounded-2xl border border-c-border bg-c-bg-app px-3 py-3 text-sm text-c-text-primary outline-none focus:border-cpoint-turquoise"
              autoComplete="family-name"
            />
          </label>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="rounded-2xl border border-c-border px-4 py-3 text-sm font-semibold text-c-text-secondary hover:bg-c-hover-bg"
            onClick={() => setOpen(false)}
          >
            Not now
          </button>
          <button
            type="button"
            className="rounded-2xl bg-cpoint-turquoise px-4 py-3 text-sm font-semibold text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save and participate'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
