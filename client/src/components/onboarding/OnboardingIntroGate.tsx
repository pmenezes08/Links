import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useTheme, type Theme } from '../../contexts/ThemeContext'
import { matchLocale, type SupportedLocale } from '../../i18n'
import { LOCALE_OPTIONS } from '../../i18n/localeOptions'
import { useLocale } from '../../i18n/useLocale'
import { isAtLeast18, isValidDobIso, maxDobForPicker } from '../../lib/ageGate'
import { clearAllUserData } from '../../utils/clearAllUserData'
import BrandLogo from '../BrandLogo'

type OnboardingIntroGateProps = {
  onStart: () => void
}

type IntroPage = 0 | 1 | 2 | 3

type AgeGateError = 'dob_required' | 'consent_required' | 'dob_invalid' | null

type DeleteStep = 'idle' | 'confirm' | 'loading'

const AGE_GATE_CONFIRMED_KEY = 'cpoint:age_gate_confirmed_at'

function fetchMockable(url: string, init?: RequestInit) {
  return fetch(url, init)
}

function isAgeGateConfirmed(): boolean {
  try {
    return Boolean(localStorage.getItem(AGE_GATE_CONFIRMED_KEY))
  } catch {
    return false
  }
}

function persistAgeGateConfirmation(): void {
  try {
    localStorage.setItem(AGE_GATE_CONFIRMED_KEY, new Date().toISOString())
  } catch {
    // Best-effort client-only flag; gate may reappear if storage is unavailable.
  }
}

function resolveInitialPage(hasSavedLocale: boolean, ageConfirmed: boolean): IntroPage {
  if (hasSavedLocale) {
    return ageConfirmed ? 2 : 1
  }
  return 0
}

function resolveNextPageAfterLanguage(ageConfirmed: boolean): IntroPage {
  return ageConfirmed ? 2 : 1
}

function buildProgressPages(skipLanguageStep: boolean, skipAgeStep: boolean): IntroPage[] {
  const steps: IntroPage[] = []
  if (!skipLanguageStep) steps.push(0)
  if (!skipAgeStep) steps.push(1)
  steps.push(2, 3)
  return steps
}

export default function OnboardingIntroGate({ onStart }: OnboardingIntroGateProps) {
  const { t } = useTranslation()
  const { locale, supported, saving, setLocale } = useLocale()
  const { theme, setTheme } = useTheme()
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoFailed, setVideoFailed] = useState(false)
  const [manifestoOpen, setManifestoOpen] = useState(false)
  const [page, setPage] = useState<IntroPage | null>(null)
  const [skipLanguageStep, setSkipLanguageStep] = useState(false)
  const [skipAgeStep, setSkipAgeStep] = useState(false)
  const [draftLocale, setDraftLocale] = useState<SupportedLocale>(locale)
  const [draftAppearance, setDraftAppearance] = useState<Theme>(theme)
  const [localeError, setLocaleError] = useState<string | null>(null)
  const [dob, setDob] = useState('')
  const [consent18, setConsent18] = useState(false)
  const [ageGateError, setAgeGateError] = useState<AgeGateError>(null)
  const [underageOpen, setUnderageOpen] = useState(false)
  const [deleteStep, setDeleteStep] = useState<DeleteStep>('idle')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleteFeedback, setDeleteFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  )
  const dobInputRef = useRef<HTMLInputElement>(null)
  const deleteInputRef = useRef<HTMLInputElement>(null)

  const maxDob = useMemo(() => maxDobForPicker(), [])

  useEffect(() => {
    setDraftLocale(locale)
  }, [locale])

  useEffect(() => {
    setDraftAppearance(theme)
  }, [theme])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let hasSavedLocale = false
      const ageConfirmed = isAgeGateConfirmed()
      if (ageConfirmed) {
        setSkipAgeStep(true)
      }

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
          setPage(resolveInitialPage(hasSavedLocale, ageConfirmed))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!underageOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [underageOpen])

  useEffect(() => {
    if (!underageOpen || deleteStep !== 'confirm') return
    window.setTimeout(() => {
      deleteInputRef.current?.focus()
    }, 100)
  }, [underageOpen, deleteStep])

  const showVideo = Boolean(videoUrl && !videoFailed) && page === 2
  const manifestoParagraphs = t('onboarding_intro.manifesto', { returnObjects: true }) as string[]
  const progressPages = buildProgressPages(skipLanguageStep, skipAgeStep)

  const handleLanguageContinue = useCallback(async () => {
    setLocaleError(null)
    const result = await setLocale(draftLocale)
    if (!result.persisted) {
      setLocaleError(t('account.language.save_failed'))
      return
    }
    setTheme(draftAppearance)
    setPage(resolveNextPageAfterLanguage(skipAgeStep || isAgeGateConfirmed()))
  }, [draftLocale, draftAppearance, setLocale, setTheme, skipAgeStep, t])

  const handleAgeGateContinue = useCallback(() => {
    setAgeGateError(null)

    if (!dob.trim()) {
      setAgeGateError('dob_required')
      return
    }
    if (!isValidDobIso(dob)) {
      setAgeGateError('dob_invalid')
      return
    }
    if (!consent18) {
      setAgeGateError('consent_required')
      return
    }
    if (!isAtLeast18(dob)) {
      setUnderageOpen(true)
      setDeleteStep('idle')
      setDeleteConfirmation('')
      setDeleteFeedback(null)
      return
    }

    persistAgeGateConfirmation()
    setSkipAgeStep(true)
    setPage(2)
  }, [consent18, dob])

  const handleUnderageTryAgain = useCallback(() => {
    setUnderageOpen(false)
    setDeleteStep('idle')
    setDeleteConfirmation('')
    setDeleteFeedback(null)
    window.setTimeout(() => {
      dobInputRef.current?.focus()
    }, 100)
  }, [])

  const handleDeleteAccount = useCallback(async () => {
    if (deleteConfirmation.trim().toUpperCase() !== 'DELETE') {
      setDeleteFeedback({ type: 'error', text: t('account.danger.confirm_error') })
      return
    }
    setDeleteFeedback(null)
    setDeleteStep('loading')
    try {
      const resp = await fetch('/delete_account', { method: 'POST', credentials: 'include' })
      if (!resp.ok) {
        setDeleteFeedback({ type: 'error', text: t('account.danger.server_error', { status: resp.status }) })
        setDeleteStep('confirm')
        return
      }
      const json = await resp.json().catch(() => null)
      if (json?.success) {
        await clearAllUserData()
        window.location.replace('/signup?cleared=' + Date.now())
      } else {
        setDeleteFeedback({ type: 'error', text: json?.error || t('account.danger.delete_failed') })
        setDeleteStep('confirm')
      }
    } catch {
      setDeleteFeedback({ type: 'error', text: t('errors.network') })
      setDeleteStep('confirm')
    }
  }, [deleteConfirmation, t])

  if (page === null) {
    return (
      <div className="fixed inset-0 z-[1101] bg-c-bg-app text-c-text-primary flex items-center justify-center">
        <div
          className="w-8 h-8 rounded-full border-2 border-c-border border-t-cpoint-turquoise animate-spin"
          aria-hidden
        />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[1101] overflow-y-auto bg-c-bg-app text-c-text-primary">
      <div className="min-h-full px-5 py-8 flex items-center justify-center">
        <div className="w-full max-w-md">
          <div className="rounded-[28px] border border-cpoint-turquoise/45 bg-c-bg-app overflow-hidden">
            <div className="p-6 sm:p-7">
              <BrandLogo className="w-16 h-16 rounded-2xl object-contain mx-auto mb-5" />

              {showVideo && (
                <div className="mb-5 rounded-2xl overflow-hidden border border-cpoint-turquoise/35 bg-c-bg-app">
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
                  <p className="text-sm leading-relaxed text-c-text-tertiary mb-5">
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
                              ? 'border-cpoint-turquoise/60 bg-cpoint-turquoise/10 text-c-text-primary'
                              : 'border-c-border bg-c-hover-bg text-c-text-secondary hover:border-c-border-strong'
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
                  {localeError ? <p className="text-xs text-red-300 mt-2">{localeError}</p> : null}

                  <div className="mt-6 text-left">
                    <h2 className="text-lg font-medium mb-2 text-center">{t('onboarding_intro.appearance_title')}</h2>
                    <p className="text-sm text-c-text-tertiary mb-3 text-center">
                      {t('onboarding_intro.appearance_subtitle')}
                    </p>
                    <div className="space-y-2" role="radiogroup" aria-label={t('onboarding_intro.appearance_title')}>
                      {(['dark', 'light'] as const).map((option) => {
                        const checked = draftAppearance === option
                        return (
                          <label
                            key={option}
                            className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${
                              checked
                                ? 'border-cpoint-turquoise/60 bg-cpoint-turquoise/10 text-c-text-primary'
                                : 'border-c-border bg-c-hover-bg text-c-text-secondary hover:border-c-border-strong'
                            }`}
                          >
                            <input
                              type="radio"
                              name="onboarding-appearance"
                              value={option}
                              checked={checked}
                              onChange={() => setDraftAppearance(option)}
                              className="h-4 w-4 accent-cpoint-turquoise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                            />
                            <span>{t(`onboarding_intro.appearance_${option}`)}</span>
                          </label>
                        )
                      })}
                    </div>
                    <p className="mt-2 text-xs text-c-text-tertiary">{t('onboarding_intro.appearance_change_later')}</p>
                  </div>
                </div>
              ) : page === 1 ? (
                <div className="text-left">
                  <h1 className="text-2xl font-semibold tracking-tight mb-2 text-center text-c-text-primary">
                    {t('onboarding_intro.age_title')}
                  </h1>
                  <p id="onboarding-dob-hint" className="text-sm text-c-text-tertiary mb-4 text-center">
                    {t('onboarding_intro.dob_hint')}
                  </p>

                  <label htmlFor="onboarding-dob" className="block">
                    <span className="text-sm font-medium text-c-text-primary">{t('onboarding_intro.dob_label')}</span>
                    <input
                      ref={dobInputRef}
                      id="onboarding-dob"
                      name="onboarding-dob"
                      type="date"
                      value={dob}
                      min="1900-01-01"
                      max={maxDob}
                      autoComplete="bday"
                      required
                      aria-invalid={ageGateError !== null}
                      aria-describedby={
                        ageGateError ? 'onboarding-dob-hint onboarding-dob-error' : 'onboarding-dob-hint'
                      }
                      onChange={(event) => {
                        setAgeGateError(null)
                        setDob(event.target.value)
                      }}
                      className="mt-1 w-full min-h-[44px] rounded-md bg-c-bg-app border border-c-border px-3 py-2 text-base text-c-text-primary outline-none focus:border-cpoint-turquoise focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                    />
                  </label>

                  <label className="mt-4 flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border border-c-border bg-c-hover-bg px-3 py-3 text-left text-sm">
                    <input
                      type="checkbox"
                      checked={consent18}
                      aria-required="true"
                      onChange={(event) => {
                        setAgeGateError(null)
                        setConsent18(event.target.checked)
                      }}
                      className="mt-0.5 h-5 w-5 min-w-[20px] accent-cpoint-turquoise focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                    />
                    <span className="text-c-text-secondary">{t('onboarding_intro.consent_18plus')}</span>
                  </label>

                  <p className="mt-4 text-xs leading-relaxed text-c-text-tertiary">
                    {t('onboarding_intro.legal_footnote')}
                  </p>

                  {ageGateError ? (
                    <p id="onboarding-dob-error" role="alert" className="mt-3 text-xs text-red-400">
                      {t(`onboarding_intro.${ageGateError}`)}
                    </p>
                  ) : null}
                </div>
              ) : page === 2 ? (
                <div className="text-center">
                  <h1 className="text-2xl font-semibold tracking-tight mb-3">{t('onboarding_intro.welcome_title')}</h1>
                  <p className="text-sm leading-relaxed text-c-text-secondary mb-6">{t('onboarding_intro.summary')}</p>
                </div>
              ) : (
                <div className="text-center">
                  <h1 className="text-2xl font-semibold tracking-tight mb-3">{t('onboarding_intro.steve_title')}</h1>
                  <p className="text-sm leading-relaxed text-c-text-tertiary mb-6">
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
                    disabled={!dob || !consent18 || saving}
                    onClick={handleAgeGateContinue}
                    className="w-full rounded-xl bg-cpoint-turquoise text-black font-semibold py-3 text-sm hover:brightness-110 active:scale-[0.99] transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                  >
                    {t('onboarding_intro.age_continue', { defaultValue: t('onboarding_intro.continue') })}
                  </button>
                ) : page === 2 ? (
                  <button
                    type="button"
                    onClick={() => setPage(3)}
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
                {page === 2 ? (
                  <button
                    type="button"
                    onClick={() => setManifestoOpen(true)}
                    className="w-full rounded-xl bg-cpoint-turquoise/10 text-c-accent-ink border border-cpoint-turquoise/30 font-medium py-3 text-sm hover:bg-cpoint-turquoise/15 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                  >
                    {t('onboarding_intro.read_manifesto')}
                  </button>
                ) : page === 3 ? (
                  <button
                    type="button"
                    onClick={() => setPage(2)}
                    className="w-full rounded-xl bg-cpoint-turquoise/10 text-c-accent-ink border border-cpoint-turquoise/30 font-medium py-3 text-sm hover:bg-cpoint-turquoise/15 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
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
          <div className="absolute inset-0 bg-c-bg-overlay backdrop-blur-sm" onClick={() => setManifestoOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-manifesto-title"
            className="relative w-full max-w-lg overflow-y-auto rounded-2xl border border-cpoint-turquoise/45 bg-c-bg-app p-6 shadow-[0_24px_80px_rgba(0,206,200,0.18)]"
            style={{
              maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2rem)',
            }}
          >
            <BrandLogo className="w-12 h-12 rounded-xl object-contain mx-auto mb-4" />
            <h2 id="onboarding-manifesto-title" className="text-xl font-semibold text-center mb-5">
              {t('onboarding_intro.manifesto_title')}
            </h2>
            <div className="space-y-4 text-sm leading-relaxed text-c-text-secondary">
              {manifestoParagraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setManifestoOpen(false)}
                className="rounded-xl bg-cpoint-turquoise/10 text-c-accent-ink border border-cpoint-turquoise/30 font-medium py-3 text-sm hover:bg-cpoint-turquoise/15 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
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

      {underageOpen && (
        <div
          className="fixed inset-0 z-[1115] flex items-center justify-center px-4"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)',
          }}
        >
          <div className="absolute inset-0 bg-c-bg-overlay backdrop-blur-sm" aria-hidden />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="onboarding-underage-title"
            aria-describedby="onboarding-underage-desc"
            className="relative w-full max-w-lg overflow-y-auto rounded-2xl border border-cpoint-turquoise/45 bg-c-bg-app p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] motion-safe:transition motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
            style={{
              maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2rem)',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {deleteStep === 'confirm' || deleteStep === 'loading' ? (
              <>
                <h2 id="onboarding-underage-title" className="text-xl font-semibold text-c-text-primary">
                  {t('onboarding_intro.underage_delete_confirm_title')}
                </h2>
                <p id="onboarding-underage-desc" className="mt-2 text-sm leading-6 text-c-text-secondary">
                  {t('onboarding_intro.underage_delete_confirm_body')}
                </p>

                {deleteFeedback ? (
                  <div
                    className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
                      deleteFeedback.type === 'success'
                        ? 'border-c-border bg-c-bg-surface text-c-text-secondary'
                        : 'border-red-400/25 bg-red-500/10 text-red-500'
                    }`}
                  >
                    {deleteFeedback.text}
                  </div>
                ) : null}

                <label className="mt-5 block">
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-c-text-tertiary">
                    {t('account.danger.confirm_label')}
                  </span>
                  <input
                    ref={deleteInputRef}
                    type="text"
                    value={deleteConfirmation}
                    onChange={(event) => setDeleteConfirmation(event.target.value)}
                    disabled={deleteStep === 'loading'}
                    className="mt-2 w-full rounded-2xl border border-red-300/20 bg-c-hover-bg px-4 py-3 text-c-text-primary placeholder:text-c-text-tertiary focus:border-red-200/60 focus:outline-none disabled:opacity-50"
                    placeholder="DELETE"
                  />
                </label>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={deleteStep === 'loading'}
                    onClick={() => {
                      setDeleteStep('idle')
                      setDeleteConfirmation('')
                      setDeleteFeedback(null)
                    }}
                    className="rounded-2xl border border-c-border px-4 py-3 font-bold text-c-text-secondary active:bg-c-active-bg disabled:opacity-50"
                  >
                    {t('common.cancel', { defaultValue: 'Cancel' })}
                  </button>
                  <button
                    type="button"
                    disabled={deleteStep === 'loading'}
                    onClick={() => void handleDeleteAccount()}
                    className="rounded-2xl bg-red-500 px-4 py-3 font-bold text-white active:opacity-80 disabled:opacity-50"
                  >
                    {deleteStep === 'loading' ? t('account.danger.deleting') : t('account.danger.delete_button')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 id="onboarding-underage-title" className="text-xl font-semibold text-c-text-primary">
                  {t('onboarding_intro.underage_block_title')}
                </h2>
                <p id="onboarding-underage-desc" className="mt-2 text-sm leading-6 text-c-text-secondary">
                  {t('onboarding_intro.underage_block_body')}
                </p>
                <p className="mt-4 text-sm leading-6 text-c-text-tertiary">{t('onboarding_intro.underage_delete_prompt')}</p>

                <div className="mt-6 space-y-3">
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteStep('confirm')
                      setDeleteConfirmation('')
                      setDeleteFeedback(null)
                    }}
                    className="w-full rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 font-semibold text-red-500 active:opacity-80"
                  >
                    {t('onboarding_intro.underage_delete_cta')}
                  </button>
                  <button
                    type="button"
                    onClick={handleUnderageTryAgain}
                    className="w-full rounded-xl bg-cpoint-turquoise/10 text-c-accent-ink border border-cpoint-turquoise/30 font-medium py-3 text-sm hover:bg-cpoint-turquoise/15 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                  >
                    {t('onboarding_intro.underage_try_again')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
