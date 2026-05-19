import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'

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
    let savedLocaleApplied = false

    // 1) Native shells: ask Capacitor for the device language tag. The
    //    react-i18next browser detector reads navigator.language, which
    //    on Capacitor maps to the WebView locale -- usually right but
    //    not guaranteed to match the OS keyboard / system language. The
    //    plugin call gives us the explicit system tag before the user
    //    has had a chance to pick anything in Account Settings.
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/device')
        .then(({ Device }) => Device.getLanguageTag())
        .then((res) => {
          if (cancelled) return
          if (savedLocaleApplied) return
          const tag = matchLocale(res?.value)
          if (tag && tag !== i18n.language) {
            i18n.changeLanguage(tag).catch(() => undefined)
          }
        })
        .catch(() => undefined)
    }

    // 2) After auth becomes available, the server's saved
    //    preferred_locale wins over both the WebView guess and the
    //    Capacitor device tag.
    fetch('/api/me/locale', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.success) return
        const saved = matchLocale(json.preferred_locale)
        if (saved) {
          savedLocaleApplied = true
        }
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
