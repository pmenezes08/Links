// client/src/i18n/useLocale.ts
//
// Thin React hook on top of react-i18next that exposes the active
// supported locale and a setter that:
//   1. flips i18n.language immediately (instant UI re-render)
//   2. mirrors the choice into localStorage (already handled by the
//      LanguageDetector cache config)
//   3. persists the explicit choice on the server via
//      PATCH /api/me/locale -- the server is the source of truth for
//      future sessions, push notifications, and emails.
//
// Components that just want to translate strings should keep using
// `useTranslation()` from react-i18next; this hook is for the
// Account Settings language picker and any other surface that lets
// the user change locale.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import i18n, {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  matchLocale,
  type SupportedLocale,
} from './index'

export interface UseLocaleResult {
  /** Currently active supported locale. */
  locale: SupportedLocale
  /** Locales we ship UI translations for. */
  supported: readonly SupportedLocale[]
  /** Whether the most recent change request is still flying. */
  saving: boolean
  /** Error from the most recent change attempt, if any. */
  error: string | null
  /**
   * Flip the active locale. When `persist` is true (default) also
   * write through to the server. Throws nothing; consumers should
   * read `error` instead.
   */
  setLocale: (next: string | null | undefined, options?: { persist?: boolean }) => Promise<SupportedLocale>
}

async function patchPreferredLocale(locale: SupportedLocale | null): Promise<void> {
  const body = JSON.stringify({ locale })
  const res = await fetch('/api/me/locale', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  if (!res.ok) {
    let detail = ''
    try {
      const json = await res.json()
      detail = json?.message || json?.error || ''
    } catch {
      // ignore body parse failures
    }
    throw new Error(detail || `Locale save failed (${res.status})`)
  }
}

export function useLocale(): UseLocaleResult {
  // We only consume useTranslation() to subscribe to language changes;
  // the actual i18n.t() calls happen at each call site via the hook
  // returned to them.
  useTranslation()

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeLocale, setActiveLocale] = useState<SupportedLocale>(
    matchLocale(i18n.language) ?? DEFAULT_LOCALE,
  )

  useEffect(() => {
    function onChange(lng: string) {
      setActiveLocale(matchLocale(lng) ?? DEFAULT_LOCALE)
    }
    i18n.on('languageChanged', onChange)
    return () => {
      i18n.off('languageChanged', onChange)
    }
  }, [])

  const setLocale = useCallback<UseLocaleResult['setLocale']>(
    async (next, options) => {
      const persist = options?.persist ?? true
      const matched = matchLocale(next) ?? DEFAULT_LOCALE

      setError(null)

      try {
        await i18n.changeLanguage(matched)
      } catch (err) {
        setError((err as Error)?.message || 'change_failed')
        return matched
      }

      if (persist) {
        setSaving(true)
        try {
          await patchPreferredLocale(matched)
        } catch (err) {
          setError((err as Error)?.message || 'save_failed')
        } finally {
          setSaving(false)
        }
      }

      return matched
    },
    [],
  )

  return {
    locale: activeLocale,
    supported: SUPPORTED_LOCALES,
    saving,
    error,
    setLocale,
  }
}
