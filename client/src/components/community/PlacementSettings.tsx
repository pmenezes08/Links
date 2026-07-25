import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type SubCommunity = { id: number; name: string; parent_community_id?: number | null }

type EditorOption = { label: string; target_community_ids: number[] }

type EditorQuestion = { prompt: string; allow_multi: boolean; options: EditorOption[] }

type Limits = {
  max_questions: number
  max_options_per_question: number
  min_options_per_question: number
  prompt_max_len: number
  option_label_max_len: number
}

const DEFAULT_LIMITS: Limits = {
  max_questions: 3,
  max_options_per_question: 6,
  min_options_per_question: 2,
  prompt_max_len: 200,
  option_label_max_len: 80,
}

const EMPTY_OPTION: EditorOption = { label: '', target_community_ids: [] }

/**
 * Guided placement editor — manage-community card, Enterprise roots only.
 * Self-gating: the server answers 403 enterprise_required / 400 root_only
 * for everyone else and the card renders nothing, so no tier probing
 * happens client-side.
 */
export default function PlacementSettings({ communityId }: { communityId: number | string }) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(true)
  const [questions, setQuestions] = useState<EditorQuestion[]>([])
  const [subCommunities, setSubCommunities] = useState<SubCommunity[]>([])
  const [limits, setLimits] = useState<Limits>(DEFAULT_LIMITS)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/community/${communityId}/placement/config`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(async r => {
        const j = await r.json().catch(() => null)
        if (cancelled) return
        if (!r.ok || !j?.success) {
          setVisible(false)
          return
        }
        setVisible(true)
        setSubCommunities(Array.isArray(j.sub_communities) ? j.sub_communities : [])
        if (j.limits) setLimits({ ...DEFAULT_LIMITS, ...j.limits })
        setQuestions(
          (Array.isArray(j.questions) ? j.questions : []).map((q: any) => ({
            prompt: q.prompt || '',
            allow_multi: !!q.allow_multi,
            options: (Array.isArray(q.options) ? q.options : []).map((o: any) => ({
              label: o.label || '',
              target_community_ids: Array.isArray(o.target_community_ids)
                ? o.target_community_ids.map((n: any) => Number(n))
                : [],
            })),
          }))
        )
      })
      .catch(() => {
        if (!cancelled) setVisible(false)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [communityId])

  const patchQuestion = useCallback((index: number, patch: Partial<EditorQuestion>) => {
    setQuestions(prev => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)))
  }, [])

  const patchOption = useCallback(
    (qIndex: number, oIndex: number, patch: Partial<EditorOption>) => {
      setQuestions(prev =>
        prev.map((q, i) =>
          i === qIndex
            ? { ...q, options: q.options.map((o, j) => (j === oIndex ? { ...o, ...patch } : o)) }
            : q
        )
      )
    },
    []
  )

  const toggleTarget = useCallback(
    (qIndex: number, oIndex: number, subId: number) => {
      setQuestions(prev =>
        prev.map((q, i) => {
          if (i !== qIndex) return q
          return {
            ...q,
            options: q.options.map((o, j) => {
              if (j !== oIndex) return o
              const has = o.target_community_ids.includes(subId)
              return {
                ...o,
                target_community_ids: has
                  ? o.target_community_ids.filter(id => id !== subId)
                  : [...o.target_community_ids, subId],
              }
            }),
          }
        })
      )
    },
    []
  )

  const save = useCallback(async () => {
    setSaving(true)
    setError('')
    try {
      const r = await fetch(`/api/community/${communityId}/placement/config`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.success) {
        setError(j?.reason || j?.error || t('communities.placement_settings.save_failed'))
        return
      }
      setQuestions(
        (Array.isArray(j.questions) ? j.questions : []).map((q: any) => ({
          prompt: q.prompt || '',
          allow_multi: !!q.allow_multi,
          options: (Array.isArray(q.options) ? q.options : []).map((o: any) => ({
            label: o.label || '',
            target_community_ids: Array.isArray(o.target_community_ids)
              ? o.target_community_ids.map((n: any) => Number(n))
              : [],
          })),
        }))
      )
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 2000)
    } catch {
      setError(t('communities.placement_settings.save_failed'))
    } finally {
      setSaving(false)
    }
  }, [communityId, questions, t])

  if (loading || !visible) return null

  const canAddQuestion = questions.length < limits.max_questions
  const hasSubCommunities = subCommunities.length > 0

  return (
    <div className="rounded-lg border border-c-border bg-c-bg-app p-4">
      <label className="block text-sm font-medium text-c-text-primary mb-1">
        {t('communities.placement_settings.section_title')}
      </label>
      <p className="text-xs text-c-text-secondary mb-2">
        {t('communities.placement_settings.explainer')}
      </p>
      <p className="text-xs text-c-text-secondary mb-3">
        {t('communities.placement_settings.privacy_note')}
      </p>

      {!hasSubCommunities && (
        <p className="text-xs text-c-text-secondary mb-2">
          {t('communities.placement_settings.no_sub_communities')}
        </p>
      )}

      {questions.map((question, qIndex) => (
        <div key={qIndex} className="rounded-lg border border-c-border p-3 mb-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-medium text-c-text-secondary">
              {t('communities.placement_settings.question_label', { number: qIndex + 1 })}
            </span>
            <button
              type="button"
              onClick={() => setQuestions(prev => prev.filter((_, i) => i !== qIndex))}
              className="text-xs text-c-text-secondary underline"
            >
              {t('communities.placement_settings.remove')}
            </button>
          </div>
          <input
            type="text"
            value={question.prompt}
            maxLength={limits.prompt_max_len}
            onChange={e => patchQuestion(qIndex, { prompt: e.target.value })}
            placeholder={t('communities.placement_settings.prompt_placeholder')}
            className="w-full rounded-lg border border-c-border bg-c-bg-elevated px-3 py-2 text-sm text-c-text-primary mb-2"
          />
          <label className="flex items-center gap-2 text-xs text-c-text-secondary mb-3">
            <input
              type="checkbox"
              checked={question.allow_multi}
              onChange={e => patchQuestion(qIndex, { allow_multi: e.target.checked })}
            />
            {t('communities.placement_settings.multi_toggle')}
          </label>

          {question.options.map((option, oIndex) => (
            <div key={oIndex} className="rounded-lg border border-c-border/60 p-2 mb-2">
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={option.label}
                  maxLength={limits.option_label_max_len}
                  onChange={e => patchOption(qIndex, oIndex, { label: e.target.value })}
                  placeholder={t('communities.placement_settings.option_placeholder')}
                  className="flex-1 rounded-lg border border-c-border bg-c-bg-elevated px-3 py-1.5 text-sm text-c-text-primary"
                />
                {question.options.length > limits.min_options_per_question && (
                  <button
                    type="button"
                    aria-label={t('communities.placement_settings.remove')}
                    onClick={() =>
                      patchQuestion(qIndex, {
                        options: question.options.filter((_, j) => j !== oIndex),
                      })
                    }
                    className="text-xs text-c-text-secondary px-1"
                  >
                    ✕
                  </button>
                )}
              </div>
              <p className="text-[11px] text-c-text-secondary mb-1">
                {t('communities.placement_settings.targets_label')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {subCommunities.map(sub => {
                  const selected = option.target_community_ids.includes(sub.id)
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => toggleTarget(qIndex, oIndex, sub.id)}
                      aria-pressed={selected}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        selected
                          ? 'border-cpoint-turquoise text-cpoint-turquoise bg-cpoint-turquoise/10'
                          : 'border-c-border text-c-text-secondary'
                      }`}
                    >
                      {sub.name}
                    </button>
                  )
                })}
                {!hasSubCommunities && (
                  <span className="text-[11px] text-c-text-secondary">
                    {t('communities.placement_settings.targets_empty')}
                  </span>
                )}
              </div>
            </div>
          ))}
          {question.options.length < limits.max_options_per_question && (
            <button
              type="button"
              onClick={() =>
                patchQuestion(qIndex, { options: [...question.options, { ...EMPTY_OPTION }] })
              }
              className="text-xs text-cpoint-turquoise underline"
            >
              {t('communities.placement_settings.add_option')}
            </button>
          )}
        </div>
      ))}

      <div className="flex items-center gap-3">
        {canAddQuestion && (
          <button
            type="button"
            onClick={() =>
              setQuestions(prev => [
                ...prev,
                { prompt: '', allow_multi: false, options: [{ ...EMPTY_OPTION }, { ...EMPTY_OPTION }] },
              ])
            }
            className="rounded-lg border border-c-border px-3 py-1.5 text-xs text-c-text-primary"
          >
            {t('communities.placement_settings.add_question')}
          </button>
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-cpoint-turquoise px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40"
        >
          {saving
            ? t('communities.placement_settings.saving')
            : savedFlash
              ? t('communities.placement_settings.saved')
              : t('communities.placement_settings.save')}
        </button>
      </div>
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  )
}
