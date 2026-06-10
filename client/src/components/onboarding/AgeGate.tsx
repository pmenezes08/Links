import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { isAtLeast18, isValidDobIso } from '../../lib/ageGate'
import { clearAllUserData } from '../../utils/clearAllUserData'
import BrandLogo from '../BrandLogo'

// Standalone 18+ gate (compliance Option A — docs/COMPLIANCE_AGE_GATE.md).
// Mounted app-wide for any authenticated account whose server-side gate
// status is still unanswered, so it catches invited members, OAuth signups
// and deep links alike. Reuses the onboarding_intro.* i18n copy that shipped
// with the original intro-gate step.

type AgeGateError = 'dob_required' | 'consent_required' | 'dob_invalid' | null
type DeleteStep = 'idle' | 'confirm' | 'loading'

const AGE_GATE_CONFIRMED_KEY = 'cpoint:age_gate_confirmed_at'

function isAgeGateConfirmedLocally(): boolean {
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
    // Best-effort UX cache; server truth is users.age_confirmed_at.
  }
}

function normalizeDobInput(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (isoMatch) {
    const [, year, month, day] = isoMatch
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  const localMatch = trimmed.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/)
  if (localMatch) {
    const [, day, month, year] = localMatch
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  const compactLocalMatch = trimmed.match(/^(\d{2})(\d{2})(\d{4})$/)
  if (compactLocalMatch) {
    const [, day, month, year] = compactLocalMatch
    return `${year}-${month}-${day}`
  }
  return trimmed
}

export function AgeGate({ onConfirmed }: { onConfirmed: () => void }) {
  const { t } = useTranslation()
  const [dob, setDob] = useState('')
  const [consent18, setConsent18] = useState(false)
  const [ageGateError, setAgeGateError] = useState<AgeGateError>(null)
  const [dobHelpOpen, setDobHelpOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [underageOpen, setUnderageOpen] = useState(false)
  const [deleteStep, setDeleteStep] = useState<DeleteStep>('idle')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleteFeedback, setDeleteFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const dobInputRef = useRef<HTMLInputElement>(null)
  const deleteInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!underageOpen || deleteStep !== 'confirm') return
    window.setTimeout(() => {
      deleteInputRef.current?.focus()
    }, 100)
  }, [underageOpen, deleteStep])

  const handleContinue = useCallback(async () => {
    setAgeGateError(null)
    setSaveError('')

    const normalizedDob = normalizeDobInput(dob)
    if (!normalizedDob) {
      setAgeGateError('dob_required')
      return
    }
    if (!isValidDobIso(normalizedDob)) {
      setAgeGateError('dob_invalid')
      return
    }
    if (!consent18) {
      setAgeGateError('consent_required')
      return
    }
    if (!isAtLeast18(normalizedDob)) {
      setUnderageOpen(true)
      setDeleteStep('idle')
      setDeleteConfirmation('')
      setDeleteFeedback(null)
      return
    }

    // 18+ self-declaration → server records timestamp-only evidence
    // (Option A). DOB never leaves the device.
    setSaving(true)
    try {
      const resp = await fetch('/api/me/age-confirmation', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      })
      const json = await resp.json().catch(() => null)
      if (!resp.ok || !json?.success) {
        setSaveError(t('errors.network'))
        return
      }
      persistAgeGateConfirmation()
      onConfirmed()
    } catch {
      setSaveError(t('errors.network'))
    } finally {
      setSaving(false)
    }
  }, [consent18, dob, onConfirmed, t])

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

  return (
    <div className="fixed inset-0 z-[1300] overflow-y-auto bg-c-bg-app text-c-text-primary">
      <div className="min-h-full px-5 py-8 flex items-center justify-center">
        <div className="w-full max-w-md">
          <div className="rounded-[28px] border border-cpoint-turquoise/45 bg-c-bg-app overflow-hidden">
            <div className="p-6 sm:p-7">
              <BrandLogo className="w-16 h-16 rounded-2xl object-contain mx-auto mb-5" />

              <div className="text-left">
                <h1 className="text-2xl font-semibold tracking-tight mb-2 text-center text-c-text-primary">
                  {t('onboarding_intro.age_title')}
                </h1>
                <p id="age-gate-dob-hint" className="text-sm text-c-text-tertiary mb-4 text-center">
                  {t('onboarding_intro.dob_hint')}
                </p>

                <div className="flex items-center gap-2">
                  <label htmlFor="age-gate-dob" className="text-sm font-medium text-c-text-primary">
                    {t('onboarding_intro.dob_label')}
                  </label>
                  <button
                    type="button"
                    aria-expanded={dobHelpOpen}
                    aria-controls="age-gate-dob-help"
                    aria-label={t('onboarding_intro.dob_help_button_label')}
                    onClick={() => setDobHelpOpen((open) => !open)}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-cpoint-turquoise/40 bg-cpoint-turquoise/10 text-xs font-bold text-cpoint-turquoise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                  >
                    ?
                  </button>
                </div>
                <input
                  ref={dobInputRef}
                  id="age-gate-dob"
                  name="age-gate-dob"
                  type="text"
                  inputMode="numeric"
                  value={dob}
                  placeholder={t('onboarding_intro.dob_placeholder')}
                  autoComplete="bday"
                  required
                  aria-invalid={ageGateError !== null}
                  aria-describedby={
                    ageGateError
                      ? 'age-gate-dob-hint age-gate-dob-format age-gate-dob-error'
                      : 'age-gate-dob-hint age-gate-dob-format'
                  }
                  onChange={(event) => {
                    setAgeGateError(null)
                    setDob(event.target.value)
                  }}
                  className="mt-1 w-full min-h-[44px] rounded-md bg-c-bg-app border border-c-border px-3 py-2 text-base text-c-text-primary outline-none focus:border-cpoint-turquoise focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                />
                <p id="age-gate-dob-format" className="mt-1 text-xs text-c-text-tertiary">
                  {t('onboarding_intro.dob_format_hint')}
                </p>
                {dobHelpOpen ? (
                  <div
                    id="age-gate-dob-help"
                    className="mt-3 rounded-xl border border-cpoint-turquoise/25 bg-cpoint-turquoise/10 px-3 py-2 text-xs leading-relaxed text-c-text-secondary"
                  >
                    {t('onboarding_intro.dob_help_text')}
                  </div>
                ) : null}

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
                  <p id="age-gate-dob-error" role="alert" className="mt-3 text-xs text-red-400">
                    {t(`onboarding_intro.${ageGateError}`)}
                  </p>
                ) : null}
                {saveError ? (
                  <p role="alert" className="mt-3 text-xs text-red-400">
                    {saveError}
                  </p>
                ) : null}
              </div>

              <div className="mt-5">
                <button
                  type="button"
                  disabled={!dob || !consent18 || saving}
                  onClick={() => void handleContinue()}
                  className="w-full rounded-xl bg-cpoint-turquoise text-black font-semibold py-3 text-sm hover:brightness-110 active:scale-[0.99] transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/50"
                >
                  {t('onboarding_intro.age_continue', { defaultValue: t('onboarding_intro.continue') })}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {underageOpen && (
        <div
          className="fixed inset-0 z-[1315] flex items-center justify-center px-4"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)',
          }}
        >
          <div className="absolute inset-0 bg-c-bg-overlay backdrop-blur-sm" aria-hidden />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="age-gate-underage-title"
            aria-describedby="age-gate-underage-desc"
            className="relative w-full max-w-lg overflow-y-auto rounded-2xl border border-cpoint-turquoise/45 bg-c-bg-app p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
            style={{
              maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2rem)',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {deleteStep === 'confirm' || deleteStep === 'loading' ? (
              <>
                <h2 id="age-gate-underage-title" className="text-xl font-semibold text-c-text-primary">
                  {t('onboarding_intro.underage_delete_confirm_title')}
                </h2>
                <p id="age-gate-underage-desc" className="mt-2 text-sm leading-6 text-c-text-secondary">
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
                <h2 id="age-gate-underage-title" className="text-xl font-semibold text-c-text-primary">
                  {t('onboarding_intro.underage_block_title')}
                </h2>
                <p id="age-gate-underage-desc" className="mt-2 text-sm leading-6 text-c-text-secondary">
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

/**
 * App-level controller: shows the gate for any signed-in account whose
 * server-side age-gate status is still unanswered. localStorage acts only
 * as a skip-cache; server truth (users.age_confirmed_at) wins, so a
 * confirmed account never sees the gate again even on a new device.
 */
export default function AgeGateController({ username }: { username: string | null | undefined }) {
  const [required, setRequired] = useState(false)

  useEffect(() => {
    if (!username) {
      setRequired(false)
      return
    }
    if (isAgeGateConfirmedLocally()) {
      setRequired(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const resp = await fetch('/api/me/age-gate', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        if (!resp.ok) return
        const json = await resp.json().catch(() => null)
        if (cancelled || !json?.success) return
        if (json.status === 'confirmed') {
          persistAgeGateConfirmation()
          setRequired(false)
        } else if (json.status === 'pending') {
          setRequired(true)
        }
        // scheduled_deletion / unknown: never show the confirm UI; the
        // server has already revoked access for scheduled accounts.
      } catch {
        // Network failure: fail-open this session; status is re-checked on
        // the next app open because nothing was cached.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [username])

  if (!required) return null
  return <AgeGate onConfirmed={() => setRequired(false)} />
}
