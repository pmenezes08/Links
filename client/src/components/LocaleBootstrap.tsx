import { useEffect, useRef } from 'react'

import i18n, { matchLocale } from '../i18n'

/**
 * Pull the user's saved `preferred_locale` from the server once per
 * session (after auth becomes available) and switch the UI to it.
 *
 * Before the user is signed in we rely on react-i18next's
 * LanguageDetector + the global fetch wrapper (which still sends
 * `Accept-Language` / `X-CPoint-Locale`) to keep things in the right
 * language. The moment we have a session, the server is the source
 * of truth for the explicit choice so we adopt it.
 *
 * Safe to mount multiple times; the request is rate-limited to one
 * per page lifetime.
 */
export default function LocaleBootstrap() {
  const fetched = useRef(false)

  useEffect(() => {
    if (fetched.current) return
    fetched.current = true

    let cancelled = false

    fetch('/api/me/locale', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.success) return
        const saved = matchLocale(json.saved_locale)
        if (saved && saved !== i18n.language) {
          i18n.changeLanguage(saved).catch(() => undefined)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
