import { ENTITLEMENTS_REFRESH_EVENT } from '../hooks/useEntitlements'

export type TranslateContext = 'voice_summary' | 'profile'

export type TranslateSummaryResult =
  | { ok: true; translated: string }
  | { ok: false; error?: string; entitlementsError?: Record<string, unknown> }

export async function requestTranslateSummary({
  summary,
  targetLanguage,
  context = 'voice_summary',
}: {
  summary: string
  targetLanguage: string
  context?: TranslateContext
}): Promise<TranslateSummaryResult> {
  try {
    const res = await fetch('/translate_summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        summary,
        target_language: targetLanguage,
        context,
      }),
    })
    const data = await res.json().catch(() => null)
    if (data?.error === 'entitlements_error') {
      return { ok: false, entitlementsError: data as Record<string, unknown> }
    }
    if (data?.success && data.translated_summary) {
      try {
        window.dispatchEvent(new Event(ENTITLEMENTS_REFRESH_EVENT))
      } catch {
        /* noop */
      }
      return { ok: true, translated: String(data.translated_summary) }
    }
    return { ok: false, error: data?.error || data?.message || 'Translation failed' }
  } catch {
    return { ok: false, error: 'Translation failed' }
  }
}

export const TRANSLATE_LANGUAGES = [
  { code: 'pt', nameKey: 'feed.language_pt', flag: '🇵🇹' },
  { code: 'en', nameKey: 'feed.language_en', flag: '🇬🇧' },
  { code: 'fr', nameKey: 'feed.language_fr', flag: '🇫🇷' },
  { code: 'de', nameKey: 'feed.language_de', flag: '🇩🇪' },
  { code: 'es', nameKey: 'feed.language_es', flag: '🇪🇸' },
  { code: 'it', nameKey: 'feed.language_it', flag: '🇮🇹' },
  { code: 'zh', nameKey: 'feed.language_zh', flag: '🇨🇳' },
] as const
