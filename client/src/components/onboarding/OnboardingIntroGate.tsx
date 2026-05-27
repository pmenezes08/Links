import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { matchLocale, type SupportedLocale } from '../../i18n'
import { LOCALE_OPTIONS } from '../../i18n/localeOptions'
import { useLocale } from '../../i18n/useLocale'

type OnboardingIntroGateProps = {
  onStart: () => void
}

type IntroPage = 0 | 1 | 2

function fetchMockable(url: string, init?: RequestInit) {
  return fetch(url, init)
}

export default function OnboardingIntroGate({ onStart }: OnboardingIntroGateProps) {
  const { t } = useTranslation()
  const { locale, supported, saving, setLocale } = useLocale()
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoFailed, setVideoFailed] = useState(false)
  const [manifestoOpen, setManifestoOpen] = useState(false)
  const [page, setPage] = useState<IntroPage | null>(null)
  const [skipLanguageStep, setSkipLanguageStep] = useState(false)
  const [draftLocale, setDraftLocale] = useState<SupportedLocale>(locale)
  const [localeError, setLocaleError] = useState<string | null>(null)

  useEffect(() => {
    setDraftLocale(locale)
  }, [locale])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let hasSavedLocale = false
      try {
        const localeRes = await fetchMockable('/api/me/locale', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const localeJson = localeRes.ok ? await localeRes.json().catch(() => null) : null
        if (!cancelled && localeJson?.success && matchLocale(localeJson.preferred_locale)) {
          hasSavedLocale = true
          setSkipLanguageStep(true)
        }
      } catch {
        // Fall through to language step.
      }

      try {
        const response = await fetchMockable('/api/public/onboarding_welcome_video', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        const data = await response.json().catch(() => null)
        if (!cancelled && data?.success && data.video_url) {
          setVideoUrl(String(data.video_url))
        }
      } catch {
        if (!cancelled) setVideoFailed(true)
      } finally {
        if (!cancelled) {
          setPage(hasSavedLocale ? 1 : 0)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const showVideo = Boolean(videoUrl && !videoFailed) && page === 1
  const manifestoParagraphs = t('onboarding_intro.manifesto', { returnObjects: true }) as string[]

  const progressPages: IntroPage[] = skipLanguageStep ? [1, 2] : [0, 1, 2]

  const handleLanguageContinue = useCallback(async () => {
    setLocaleError(null)
    const result = await setLocale(draftLocale)
    if (!result.persisted) {
      setLocaleError(t('account.language.save_failed'))
      return
    }
    setPage(1)
  }, [draftLocale, setLocale, t])

  if (page === null) {
    return (
      <div className="fixed inset-0 z-[1101] bg-black text-white flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-white/15 border-t-cpoint-turquoise animate-spin" aria-hidden />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[1101] overflow-y-auto bg-black text-white">
      <div className="min-h-full px-5 py-8 flex items-center justify-center">
        <div className="w-full max-w-md">
          <div className="rounded-[28px] border border-cpoint-turquoise/45 bg-black overflow-hidden">
            <div className="p-6 sm:p-7">
              <img
                src="/api/public/logo"
                alt="C-Point"
                className="w-16 h-16 rounded-2xl object-contain mx-auto mb-5"
              />

              {showVideo && (
                <div className="mb-5 rounded-2xl overflow-hidden border border-cpoint-turquoise/35 bg-black">
                  <video
                    src={videoUrl || undefined}
                    className="w-full aspect-video object-cover"
                    muted
                    autoPlay
                    playsInline
                    controls
                    preload="metadata"
                    onError={() => setVideoFailed(true)}
                  />
                </div>
              )}

              {page === 0 ? (
                <div className="text-center">
                  <h1 className="text-2xl font-semibold tracking-tight mb-2">
                    {t('onboarding_intro.language_title')}
                  </h1>
                  <p className="text-sm leading-relaxed text-[#9fb0b5] mb-5">
                    {t('onboarding_intro.language_subtitle')}
                  </p>
                  <div className="space-y-2 text-left mb-2">
                    {LOCALE_OPTIONS.filter((opt) => supported.includes(opt.value)).map((opt) => {
                      const checked = draftLocale === opt.value
                      return (
                        <label
                          key={opt.value}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${
                            checked
                              ? 'border-cpoint-turquoise/60 bg-cpoint-turquoise/10 text-white'
                              : 'border-white/10 bg-white/5 text-white/80 hover:border-white/20'
                          }`}
                        >
                          <input
                            type="radio"
                            name="onboarding-language"
                            value={opt.value}
                            checked={checked}
                            disabled={saving}
                            onChange={() => {
                              setLocaleError(null)
                              setDraftLocale(opt.value)
                            }}
                            className="h-4 w-4 accent-cpoint-turquoise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                          />
                          <span>{t(opt.labelKey)}</span>
                        </label>
                      )
                    })}
                  </div>
                  {localeError ? (
                    <p className="text-xs text-red-300 mt-2">{localeError}</p>
                  ) : null}
                </div>
              ) : page === 1 ? (
                <div className="text-center">
                  <h1 className="text-2xl font-semibold tracking-tight mb-3">{t('onboarding_intro.welcome_title')}</h1>
                  <p className="text-sm leading-relaxed text-[#d5e4e7] mb-6">{t('onboarding_intro.summary')}</p>
                </div>
              ) : (
                <div className="text-center">
                  <h1 className="text-2xl font-semibold tracking-tight mb-3">{t('onboarding_intro.steve_title')}</h1>
                  <p className="text-sm leading-relaxed text-[#9fb0b5] mb-6">
                    {t('onboarding_intro.steve_body')}
                  </p>
                </div>
              )}

              <div className="space-y-3">
                {page === 0 ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleLanguageContinue()}
                    className="w-full rounded-xl bg-cpoint-turquoise text-black font-semibold py-3 text-sm hover:brightness-110 active:scale-[0.99] transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                  >
                    {saving ? t('account.language.saving') : t('onboarding_intro.language_continue')}
                  </button>
                ) : page === 1 ? (
                  <button
                    type="button"
                    onClick={() => setPage(2)}
                    className="w-full rounded-xl bg-cpoint-turquoise text-black font-semibold py-3 text-sm hover:brightness-110 active:scale-[0.99] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                  >
                    {t('onboarding_intro.continue')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onStart}
                    className="w-full rounded-xl bg-cpoint-turquoise text-black font-semibold py-3 text-sm hover:brightness-110 active:scale-[0.99] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                  >
                    {t('onboarding_intro.start')}
                  </button>
                )}
                {page === 1 ? (
                  <button
                    type="button"
                    onClick={() => setManifestoOpen(true)}
                    className="w-full rounded-xl bg-cpoint-turquoise/10 text-[#d5fffb] border border-cpoint-turquoise/30 font-medium py-3 text-sm hover:bg-cpoint-turquoise/15 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                  >
                    {t('onboarding_intro.read_manifesto')}
                  </button>
                ) : page === 2 ? (
                  <button
                    type="button"
                    onClick={() => setPage(1)}
                    className="w-full rounded-xl bg-cpoint-turquoise/10 text-[#d5fffb] border border-cpoint-turquoise/30 font-medium py-3 text-sm hover:bg-cpoint-turquoise/15 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                  >
                    {t('common.back')}
                  </button>
                ) : null}
              </div>
              <div className="mt-5 flex justify-center gap-2" aria-label={t('onboarding_intro.progress_label')}>
                {progressPages.map((item) => (
                  <span
                    key={item}
                    className={`h-1.5 w-6 rounded-full ${page === item ? 'bg-cpoint-turquoise' : 'bg-cpoint-turquoise/25'}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {manifestoOpen && (
        <div
          className="fixed inset-0 z-[1110] flex items-center justify-center px-4"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)',
          }}
        >
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={() => setManifestoOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-manifesto-title"
            className="relative w-full max-w-lg overflow-y-auto rounded-2xl border border-cpoint-turquoise/45 bg-black p-6 shadow-[0_24px_80px_rgba(0,206,200,0.18)]"
            style={{
              maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2rem)',
            }}
          >
            <img
              src="/api/public/logo"
              alt="C-Point"
              className="w-12 h-12 rounded-xl object-contain mx-auto mb-4"
            />
            <h2 id="onboarding-manifesto-title" className="text-xl font-semibold text-center mb-5">{t('onboarding_intro.manifesto_title')}</h2>
            <div className="space-y-4 text-sm leading-relaxed text-[#c8d6d9]">
              {manifestoParagraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setManifestoOpen(false)}
                className="rounded-xl bg-cpoint-turquoise/10 text-[#d5fffb] border border-cpoint-turquoise/30 font-medium py-3 text-sm hover:bg-cpoint-turquoise/15 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
              >
                {t('common.close')}
              </button>
              <button
                type="button"
                onClick={onStart}
                className="rounded-xl bg-cpoint-turquoise text-black font-semibold py-3 text-sm hover:brightness-110 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
              >
                {t('onboarding_intro.start')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
