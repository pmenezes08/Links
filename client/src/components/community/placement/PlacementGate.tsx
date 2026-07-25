import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import SteveAvatar from '../../steve/SteveAvatar'
import { refreshDashboardCommunities } from '../../../utils/dashboardCache'
import { triggerDashboardServerPull } from '../../../utils/serverPull'

export const PLACEMENT_REFRESH_EVENT = 'cpoint:placement-refresh'
/** Reopen the questionnaire for a community (detail: { communityId }) —
 * dispatched by the pending card in the community feed. Clears the snooze. */
export const PLACEMENT_OPEN_EVENT = 'cpoint:placement-open'

const FOCUS_REFRESH_THROTTLE_MS = 20_000
const SNOOZE_PREFIX = 'cpoint:placement_snooze:'

function isSnoozed(communityId: number): boolean {
  try {
    return sessionStorage.getItem(`${SNOOZE_PREFIX}${communityId}`) === '1'
  } catch {
    return false
  }
}

function setSnoozed(communityId: number) {
  try {
    sessionStorage.setItem(`${SNOOZE_PREFIX}${communityId}`, '1')
  } catch {
    /* storage unavailable: the modal just stays reopenable */
  }
}

function clearSnooze(communityId: number) {
  try {
    sessionStorage.removeItem(`${SNOOZE_PREFIX}${communityId}`)
  } catch {
    /* ignore */
  }
}

type PlacementOption = { id: number; label: string }

type PlacementQuestion = {
  id: number
  prompt: string
  allow_multi: boolean
  options: PlacementOption[]
}

type PendingPlacement = {
  community_id: number
  community_name: string
  inviter_username?: string | null
  questions: PlacementQuestion[]
}

type Step = 'welcome' | 'questions' | 'later' | 'done'

/**
 * Post-accept questionnaire for Enterprise networks: persistent, not
 * blocking. "I'll do this later" snoozes for the current app session only —
 * the server keeps the pending state, the feed card stays pinned, and the
 * modal returns on the next app open until answered. Steve fronts the flow,
 * but every answer resolves through the owner's deterministic mapping on the
 * server — no AI involved.
 */
export default function PlacementGateController({ username }: { username: string | null }) {
  const { t } = useTranslation()
  const [pending, setPending] = useState<PendingPlacement[]>([])
  const [snoozeVersion, setSnoozeVersion] = useState(0)
  const [step, setStep] = useState<Step>('welcome')
  const [answers, setAnswers] = useState<Record<number, number[]>>({})
  const [allocated, setAllocated] = useState<{ id: number; name: string }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(false)
  const lastFetchAt = useRef(0)
  const inflight = useRef(false)

  const active = useMemo(() => {
    void snoozeVersion
    return pending.find(p => !isSnoozed(p.community_id)) || null
  }, [pending, snoozeVersion])

  const refresh = useCallback(async () => {
    if (!username || inflight.current) return
    inflight.current = true
    lastFetchAt.current = Date.now()
    try {
      const r = await fetch('/api/me/placement/pending', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      const j = await r.json().catch(() => null)
      if (r.ok && j?.success && Array.isArray(j.pending)) {
        setPending(prev => {
          const prevFirst = prev[0]?.community_id
          const next = j.pending as PendingPlacement[]
          // Keep the in-progress questionnaire stable across refetches.
          if (prevFirst && next.some(p => p.community_id === prevFirst)) {
            return [
              ...prev.filter(p => p.community_id === prevFirst),
              ...next.filter(p => p.community_id !== prevFirst),
            ]
          }
          return next
        })
      }
    } catch {
      // Offline or transient failure: stay quiet, retry on next trigger.
    } finally {
      inflight.current = false
    }
  }, [username])

  useEffect(() => {
    if (!username) {
      setPending([])
      return
    }
    void refresh()
    const onFocus = () => {
      if (Date.now() - lastFetchAt.current >= FOCUS_REFRESH_THROTTLE_MS) void refresh()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onFocus()
    }
    const onManualRefresh = () => void refresh()
    const onOpen = (event: Event) => {
      const communityId = Number((event as CustomEvent)?.detail?.communityId)
      if (communityId) {
        clearSnooze(communityId)
        setSnoozeVersion(v => v + 1)
      }
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener(PLACEMENT_REFRESH_EVENT, onManualRefresh)
    window.addEventListener(PLACEMENT_OPEN_EVENT, onOpen)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener(PLACEMENT_REFRESH_EVENT, onManualRefresh)
      window.removeEventListener(PLACEMENT_OPEN_EVENT, onOpen)
    }
  }, [username, refresh])

  useEffect(() => {
    setStep('welcome')
    setAnswers({})
    setAllocated([])
    setError(false)
  }, [active?.community_id])

  const canSubmit = useMemo(() => {
    if (!active) return false
    return active.questions.every(q => {
      const picked = answers[q.id] || []
      return q.allow_multi ? true : picked.length === 1
    })
  }, [active, answers])

  const toggleOption = useCallback((question: PlacementQuestion, optionId: number) => {
    setAnswers(prev => {
      const picked = prev[question.id] || []
      if (question.allow_multi) {
        const next = picked.includes(optionId)
          ? picked.filter(id => id !== optionId)
          : [...picked, optionId]
        return { ...prev, [question.id]: next }
      }
      return { ...prev, [question.id]: [optionId] }
    })
  }, [])

  const submit = useCallback(async () => {
    if (!active || submitting) return
    setSubmitting(true)
    setError(false)
    try {
      const body: Record<string, number[]> = {}
      for (const q of active.questions) body[String(q.id)] = answers[q.id] || []
      const r = await fetch(`/api/community/${active.community_id}/placement/respond`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: body }),
      })
      const j = await r.json().catch(() => null)
      if (r.ok && j?.success) {
        setAllocated(Array.isArray(j.allocated) ? j.allocated : [])
        setStep('done')
        void triggerDashboardServerPull()
        void refreshDashboardCommunities(undefined, true)
      } else if (j?.reason === 'already_completed' || j?.reason === 'not_found') {
        setPending(prev => prev.filter(p => p.community_id !== active.community_id))
      } else {
        setError(true)
      }
    } catch {
      setError(true)
    } finally {
      setSubmitting(false)
    }
  }, [active, answers, submitting])

  const finish = useCallback(() => {
    if (!active) return
    setPending(prev => prev.filter(p => p.community_id !== active.community_id))
    window.dispatchEvent(new Event(PLACEMENT_REFRESH_EVENT))
  }, [active])

  const snoozeActive = useCallback(() => {
    if (!active) return
    setSnoozed(active.community_id)
    setSnoozeVersion(v => v + 1)
    window.dispatchEvent(new Event(PLACEMENT_REFRESH_EVENT))
  }, [active])

  if (!username || !active) return null

  const inviter = (active.inviter_username || '').trim()

  const laterLink = (
    <button
      type="button"
      onClick={() => setStep('later')}
      className="w-full text-center text-xs text-c-text-secondary underline mt-3"
    >
      {t('communities.placement.later_link')}
    </button>
  )

  return createPortal(
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/65 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('communities.placement.aria_label')}
    >
      <section className="w-full max-w-md max-h-[85dvh] overflow-y-auto overscroll-contain rounded-3xl border border-c-border bg-c-bg-elevated p-5 shadow-2xl shadow-black/40">
        <div className="flex items-center gap-3 mb-3">
          <SteveAvatar size={32} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-c-text-primary">Steve</p>
            <p className="text-xs text-c-text-secondary truncate">{active.community_name}</p>
          </div>
        </div>

        {step === 'welcome' && (
          <div>
            <h2 className="text-lg font-semibold text-c-text-primary mb-2">
              {t('communities.placement.welcome_title', { community: active.community_name })}
            </h2>
            <p className="text-sm text-c-text-secondary mb-3">
              {inviter
                ? t('communities.placement.welcome_body', {
                    community: active.community_name,
                    inviter,
                  })
                : t('communities.placement.welcome_body_generic', {
                    community: active.community_name,
                  })}
            </p>
            <p className="text-sm text-c-text-secondary mb-5">
              {t('communities.placement.questions_intro')}
            </p>
            <button
              type="button"
              onClick={() => setStep('questions')}
              className="w-full rounded-xl bg-cpoint-turquoise text-black font-semibold py-2.5 active:scale-[0.98] transition-transform"
            >
              {t('communities.placement.continue')}
            </button>
            {laterLink}
          </div>
        )}

        {step === 'questions' && (
          <div>
            {active.questions.map(question => {
              const picked = answers[question.id] || []
              return (
                <div key={question.id} className="mb-4">
                  <p className="text-sm font-medium text-c-text-primary mb-1">
                    {question.prompt}
                    {question.allow_multi && (
                      <span className="text-c-text-secondary font-normal">
                        {' '}
                        {t('communities.placement.multi_hint')}
                      </span>
                    )}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {question.options.map(option => {
                      const selected = picked.includes(option.id)
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => toggleOption(question, option.id)}
                          aria-pressed={selected}
                          className={`text-left rounded-xl border px-3 py-2 text-sm transition-colors ${
                            selected
                              ? 'border-cpoint-turquoise text-cpoint-turquoise bg-cpoint-turquoise/10'
                              : 'border-c-border text-c-text-primary'
                          }`}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {error && (
              <p className="text-xs text-red-400 mb-2">{t('communities.placement.error_generic')}</p>
            )}
            <button
              type="button"
              disabled={!canSubmit || submitting}
              onClick={() => void submit()}
              className="w-full rounded-xl bg-cpoint-turquoise text-black font-semibold py-2.5 disabled:opacity-40 active:scale-[0.98] transition-transform"
            >
              {submitting
                ? t('communities.placement.submitting')
                : t('communities.placement.confirm')}
            </button>
            {laterLink}
          </div>
        )}

        {step === 'later' && (
          <div>
            <h2 className="text-lg font-semibold text-c-text-primary mb-2">
              {t('communities.placement.later_title')}
            </h2>
            <p className="text-sm text-c-text-secondary mb-5">
              {t('communities.placement.later_body', { community: active.community_name })}
            </p>
            <button
              type="button"
              onClick={() => setStep('questions')}
              className="w-full rounded-xl bg-cpoint-turquoise text-black font-semibold py-2.5 active:scale-[0.98] transition-transform"
            >
              {t('communities.placement.later_back_cta')}
            </button>
            <button
              type="button"
              onClick={snoozeActive}
              className="w-full text-center text-xs text-c-text-secondary underline mt-3"
            >
              {t('communities.placement.later_confirm_cta')}
            </button>
          </div>
        )}

        {step === 'done' && (
          <div>
            <h2 className="text-lg font-semibold text-c-text-primary mb-2">
              {t('communities.placement.done_title')}
            </h2>
            {allocated.length > 0 ? (
              <div className="mb-4">
                <p className="text-sm text-c-text-secondary mb-2">
                  {t('communities.placement.done_added_intro')}
                </p>
                <div className="flex flex-col gap-1.5">
                  {allocated.map(item => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-c-border px-3 py-2 text-sm text-c-text-primary"
                    >
                      {item.name}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-c-text-secondary mb-4">
                {t('communities.placement.done_none')}
              </p>
            )}
            <button
              type="button"
              onClick={finish}
              className="w-full rounded-xl bg-cpoint-turquoise text-black font-semibold py-2.5 active:scale-[0.98] transition-transform"
            >
              {t('communities.placement.done_cta')}
            </button>
          </div>
        )}
      </section>
    </div>,
    document.body
  )
}
