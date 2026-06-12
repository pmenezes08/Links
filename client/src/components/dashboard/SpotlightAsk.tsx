import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import SteveAvatar from '../steve/SteveAvatar'
import { CPOINT_EASE_OUT } from '../../design/motion'

/**
 * Steve's spotlight question — a quiet door-row on the dashboard that
 * expands in place. One question ever visible, no counter, no framing
 * line (the question IS the card); "Add to my profile" is itself the
 * confirmation; skip is one guilt-free tap. The card vanishes entirely
 * after either, and the server decides when (if ever) the next question
 * appears. Renders null when there's nothing to ask.
 */

const QUESTION_KEYS: Record<string, string> = {
  five_minutes: 'profile.spotlight.five_minutes',
  outside_work: 'profile.spotlight.outside_work',
  cpoint_goals: 'profile.spotlight.cpoint_goals',
}

type Phase = 'closed' | 'answering' | 'saving' | 'saved' | 'gone'

export default function SpotlightAsk() {
  const { t } = useTranslation()
  const [questionId, setQuestionId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('closed')
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const goneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let mounted = true
    fetch('/api/me/spotlight-ask', { credentials: 'include', headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(data => {
        if (mounted && data?.success && data.ask?.id && QUESTION_KEYS[data.ask.id]) {
          setQuestionId(data.ask.id)
        }
      })
      .catch(() => {})
    return () => {
      mounted = false
      if (goneTimerRef.current) clearTimeout(goneTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (phase === 'answering') textareaRef.current?.focus()
  }, [phase])

  const resolve = useCallback(
    (action: 'answer' | 'skip') => {
      if (!questionId) return
      if (action === 'answer') {
        if (!text.trim()) return
        setPhase('saving')
      } else {
        // Skip disappears immediately — fire and forget.
        setPhase('gone')
      }
      fetch('/api/me/spotlight-ask', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: questionId, action, text: action === 'answer' ? text.trim() : undefined }),
      })
        .then(r => r.json())
        .then(data => {
          if (action === 'answer') {
            if (data?.success) {
              setPhase('saved')
              goneTimerRef.current = setTimeout(() => setPhase('gone'), 1200)
            } else {
              setPhase('answering')
            }
          }
        })
        .catch(() => {
          if (action === 'answer') setPhase('answering')
        })
    },
    [questionId, text],
  )

  if (!questionId || phase === 'gone') return null
  const question = t(QUESTION_KEYS[questionId])

  return (
    <div
      className="overflow-hidden rounded-2xl border border-c-border bg-c-bg-elevated transition-all duration-200"
      style={{ transitionTimingFunction: CPOINT_EASE_OUT }}
    >
      {phase === 'closed' ? (
        <button
          type="button"
          onClick={() => setPhase('answering')}
          aria-label={t('dashboard.spotlight_open_aria')}
          className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-c-hover-bg active:scale-[0.99]"
        >
          <SteveAvatar size={28} />
          <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-c-text-primary">
            {question}
          </span>
          <i className="fa-solid fa-chevron-down text-xs text-c-text-tertiary" aria-hidden="true" />
        </button>
      ) : (
        <div className="px-3 py-3">
          <div className="flex items-start gap-3">
            <SteveAvatar size={28} className="mt-0.5" />
            <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-c-text-primary">{question}</p>
          </div>
          {phase === 'saved' ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-c-accent-ink">
              <i className="fa-solid fa-check text-xs" aria-hidden="true" />
              {t('dashboard.spotlight_saved')}
            </p>
          ) : (
            <>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={e => {
                  setText(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 132) + 'px'
                }}
                rows={1}
                maxLength={5000}
                disabled={phase === 'saving'}
                className="mt-3 w-full resize-none overflow-y-auto rounded-md border border-c-border bg-c-bg-app px-3 py-2 text-sm text-c-text-primary outline-none focus:border-cpoint-turquoise"
              />
              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => resolve('skip')}
                  disabled={phase === 'saving'}
                  className="min-h-11 px-1 text-xs text-c-text-tertiary transition hover:text-c-text-secondary disabled:opacity-50"
                >
                  {t('dashboard.spotlight_skip')}
                </button>
                <button
                  type="button"
                  onClick={() => resolve('answer')}
                  disabled={!text.trim() || phase === 'saving'}
                  className="min-h-11 rounded-full bg-cpoint-turquoise px-4 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
                >
                  {phase === 'saving' ? t('dashboard.spotlight_saving') : t('dashboard.spotlight_add')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
