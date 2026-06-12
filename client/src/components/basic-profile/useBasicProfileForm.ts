import { useCallback, useEffect, useState } from 'react'

import { BASIC_PROFILE_COMPLETED_EVENT } from '../../utils/basicProfileGate'
import { clearImageCache } from '../Avatar'

/**
 * Shared logic for collecting the minimum participation profile (photo +
 * first/last name): prefill, photo preview, validation, and the multipart
 * save to /api/me/basic_profile. Used by both Tier-1 surfaces — the
 * welcome modal's "You" page and the reactive 412 gate modal — so the two
 * can't drift. UI stays native to each surface; this is internals only.
 */

export type BasicProfilePrefill = {
  firstName?: string
  lastName?: string
  currentPicture?: string
}

export function useBasicProfileForm(options: {
  prefill?: BasicProfilePrefill
  /** Fetch GET /api/me/basic_profile on mount to prefill (welcome page). */
  fetchPrefill?: boolean
  username?: string
  onSaved?: (basicProfile: unknown) => void | Promise<void>
}) {
  const { prefill, fetchPrefill, username, onSaved } = options
  const [firstName, setFirstName] = useState(prefill?.firstName || '')
  const [lastName, setLastName] = useState(prefill?.lastName || '')
  const [currentPicture, setCurrentPicture] = useState(prefill?.currentPicture || '')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!fetchPrefill) return
    let mounted = true
    fetch('/api/me/basic_profile', { credentials: 'include', headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(data => {
        if (!mounted || !data?.success) return
        const p = data.basic_profile?.profile || {}
        setFirstName(prev => prev || String(p.first_name || ''))
        setLastName(prev => prev || String(p.last_name || ''))
        setCurrentPicture(prev => prev || String(p.profile_picture || ''))
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [fetchPrefill])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const pickFile = useCallback(
    (next: File | null) => {
      setFile(next)
      setError('')
      setPreviewUrl(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return next ? URL.createObjectURL(next) : null
      })
    },
    [],
  )

  const hasPhoto = Boolean(file || currentPicture)
  const canSave = Boolean(firstName.trim() && lastName.trim() && hasPhoto && !saving)
  const displayPreview = previewUrl || currentPicture || undefined

  const save = useCallback(async (): Promise<boolean> => {
    const cleanFirst = firstName.trim()
    const cleanLast = lastName.trim()
    if (!cleanFirst || !cleanLast || !(file || currentPicture)) {
      setError('missing_fields')
      return false
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
        setError(json?.error || 'save_failed')
        return false
      }
      try {
        if (username) clearImageCache(username)
      } catch {}
      window.dispatchEvent(new CustomEvent(BASIC_PROFILE_COMPLETED_EVENT, { detail: json.basic_profile }))
      await onSaved?.(json.basic_profile)
      return true
    } catch {
      setError('save_failed')
      return false
    } finally {
      setSaving(false)
    }
  }, [firstName, lastName, file, currentPicture, username, onSaved])

  return {
    firstName,
    setFirstName,
    lastName,
    setLastName,
    setCurrentPicture,
    file,
    pickFile,
    displayPreview,
    hasPhoto,
    canSave,
    saving,
    error,
    setError,
    save,
  }
}
