// client/src/i18n/index.ts
//
// Single entrypoint for react-i18next on the client. Boots with the
// device / browser locale; first-run language pick is in OnboardingIntroGate.
// Maps common
// aliases to the supported set, and exposes a small typed API for the
// rest of the SPA.
//
// Catalogs live under client/src/locales/<locale>.json. We bundle them
// directly (no async http loader) so first paint never depends on a
// fetch round-trip. New locales are added by importing another JSON
// file and listing it in SUPPORTED_LOCALES.
//
// See docs/I18N_ROADMAP.md for the engineering plan.

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from '../locales/en.json'
import ptPT from '../locales/pt-PT.json'

export const DEFAULT_LOCALE = 'en'
export const SUPPORTED_LOCALES = ['en', 'pt-PT'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

// i18next may internally resolve regional tags in different forms depending
// on browser / native shell input (`pt`, `pt-PT`, or lower-cased `pt-pt`).
// Keep the public app locale as `pt-PT`, but register the same catalog under
// every key i18next can reasonably ask for so a successful language switch
// never falls back to English text.
const I18NEXT_SUPPORTED_LNGS = ['en', 'pt', 'pt-PT', 'pt-pt'] as const

const ALIAS_MAP: Record<string, SupportedLocale> = {
  en: 'en',
  'en-us': 'en',
  'en-gb': 'en',
  'en-au': 'en',
  'en-ca': 'en',
  'en-nz': 'en',
  'en-ie': 'en',
  pt: 'pt-PT',
  'pt-pt': 'pt-PT',
  'pt-br': 'pt-PT',
}

/**
 * Map an arbitrary BCP47 tag onto a locale we ship, or null when the
 * input is unrecognised. Distinguishes "unknown" from "genuinely en"
 * so callers can fall back to the next link in their chain.
 */
export function matchLocale(raw: string | null | undefined): SupportedLocale | null {
  if (!raw) return null
  const tag = String(raw).trim().replace(/_/g, '-').toLowerCase()
  if (!tag) return null
  if (tag in ALIAS_MAP) return ALIAS_MAP[tag]
  const primary = tag.split('-', 1)[0]
  if (primary in ALIAS_MAP) return ALIAS_MAP[primary]
  return null
}

/** Like matchLocale but returns DEFAULT_LOCALE on unknown input. */
export function normalizeLocale(raw: string | null | undefined): SupportedLocale {
  return matchLocale(raw) ?? DEFAULT_LOCALE
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      pt: { translation: ptPT },
      'pt-PT': { translation: ptPT },
      'pt-pt': { translation: ptPT },
    },
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...I18NEXT_SUPPORTED_LNGS],
    nonExplicitSupportedLngs: true,
    interpolation: {
      escapeValue: false, // react already escapes
    },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: [], // persistence is owned by the server-backed pref
      lookupLocalStorage: 'cpoint:active_locale',
    },
    returnNull: false,
  })

// Always reflect the active locale on <html lang="..."> so screen
// readers, mobile keyboards, and the auto-translate browser hint do
// the right thing.
function syncHtmlLang(locale: string) {
  try {
    const matched = matchLocale(locale) ?? DEFAULT_LOCALE
    if (typeof document !== 'undefined') {
      document.documentElement.lang = matched
    }
  } catch {
    // No-op in non-DOM environments (vitest jsdom is fine).
  }
}

i18n.on('languageChanged', (lng) => {
  syncHtmlLang(lng)
})

syncHtmlLang(i18n.language)

export default i18n
