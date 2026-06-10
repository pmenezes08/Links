import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type DraftVariant = 'default' | 'shorter' | 'question' | 'warmer'

type AIDraftFirstPostModalProps = {
  open: boolean
  communityName: string
  communityType?: string | null
  ownerName?: string | null
  publishing?: boolean
  error?: string | null
  onClose: () => void
  onPublish: (content: string) => void
}

function categoryFor(type?: string | null, name?: string | null) {
  const raw = `${type || ''} ${name || ''}`.toLowerCase()
  if (/(gym|fitness|sport|sports|crossfit|training|bodybuilding)/.test(raw)) return 'fitness'
  if (/(business|professional|founder|investor|alumni|work|company)/.test(raw)) return 'professional'
  return 'general'
}

function buildDraftKey(variant: DraftVariant, category: string): string {
  if (variant === 'shorter') return 'communities.first_post_draft.shorter'
  if (variant === 'question') return 'communities.first_post_draft.question'
  if (variant === 'warmer') return 'communities.first_post_draft.warmer'
  if (category === 'professional') return 'communities.first_post_draft.professional'
  if (category === 'fitness') return 'communities.first_post_draft.fitness'
  return 'communities.first_post_draft.default'
}

export default function AIDraftFirstPostModal({
  open,
  communityName,
  communityType,
  ownerName,
  publishing = false,
  error,
  onClose,
  onPublish,
}: AIDraftFirstPostModalProps) {
  const { t } = useTranslation()

  const makeDraft = (variant: DraftVariant) => {
    const name = communityName || t('communities.joined_orientation.community_fallback')
    const ownerIntro = ownerName
      ? t('communities.first_post_draft.owner_intro_named', { name: ownerName })
      : t('communities.first_post_draft.owner_intro_generic')
    const category = categoryFor(communityType, communityName)
    const key = buildDraftKey(variant, category)
    return t(key, { name, ownerIntro })
  }

  const initialDraft = useMemo(
    () => makeDraft('default'),
    [communityName, communityType, ownerName, t],
  )
  const [draft, setDraft] = useState(initialDraft)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(initialDraft)
    setDirty(false)
  }, [initialDraft, open])

  if (!open) return null

  function regenerate(variant: DraftVariant) {
    if (dirty && !window.confirm(t('communities.owner_first_post.replace_confirm'))) return
    setDraft(makeDraft(variant))
    setDirty(false)
  }

  const canPublish = draft.trim().length > 0 && !publishing

  const regenerateOptions: Array<[DraftVariant, string]> = [
    ['warmer', t('communities.owner_first_post.regenerate_warmer')],
    ['shorter', t('communities.owner_first_post.regenerate_shorter')],
    ['question', t('communities.owner_first_post.regenerate_question')],
    ['default', t('communities.owner_first_post.regenerate_default')],
  ]

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-start justify-center overflow-y-auto bg-black/60 px-3 pb-6 pt-[calc(env(safe-area-inset-top,0px)+16px)] sm:px-4 sm:pt-10"
      role="dialog"
      aria-modal="true"
    >
      <button
        className="absolute inset-0 cursor-default"
        aria-label={t('communities.owner_first_post.modal_close_overlay_aria')}
        onClick={onClose}
      />
      <div className="relative w-full max-w-xl rounded-3xl border border-c-border bg-c-bg-elevated p-4 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cpoint-turquoise/80">
              {t('communities.owner_first_post.modal_badge')}
            </div>
            <h2 className="mt-1 text-lg font-semibold text-c-text-primary">{t('communities.owner_first_post.modal_title')}</h2>
            <p className="mt-1 text-sm text-c-text-secondary">{t('communities.owner_first_post.modal_subtitle')}</p>
          </div>
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-c-border bg-c-hover-bg text-c-text-tertiary hover:text-cpoint-turquoise"
            aria-label={t('communities.owner_first_post.modal_close_aria')}
            onClick={onClose}
          >
            <i className="fa-solid fa-xmark text-xs" />
          </button>
        </div>

        <textarea
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setDirty(true)
          }}
          className="min-h-[220px] max-h-[40dvh] w-full resize-none rounded-2xl border border-c-border bg-c-composer-input px-4 py-3 text-[16px] leading-relaxed text-c-text-primary outline-none placeholder-c-text-tertiary focus:border-cpoint-turquoise/70 focus:ring-2 focus:ring-cpoint-turquoise/20"
        />
        <div className="mt-2 flex items-center justify-between text-xs text-c-text-tertiary">
          <span>{t('communities.owner_first_post.characters', { count: draft.trim().length })}</span>
          {error ? <span className="text-red-300">{error}</span> : null}
        </div>

        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-c-text-tertiary">
            {t('communities.owner_first_post.regenerate_label')}
          </div>
          <div className="flex flex-wrap gap-2">
            {regenerateOptions.map(([variant, label]) => (
              <button
                key={variant}
                type="button"
                className="rounded-full border border-c-border px-3 py-1.5 text-xs text-c-text-secondary hover:border-cpoint-turquoise/40 hover:text-cpoint-turquoise"
                onClick={() => regenerate(variant)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="h-11 rounded-full border border-c-border px-4 text-sm font-semibold text-c-text-secondary hover:bg-c-hover-bg"
            onClick={onClose}
            disabled={publishing}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="h-11 rounded-full bg-cpoint-turquoise px-5 text-sm font-semibold text-black disabled:opacity-60"
            disabled={!canPublish}
            onClick={() => onPublish(draft.trim())}
          >
            {publishing ? t('communities.owner_first_post.publishing') : t('communities.owner_first_post.publish')}
          </button>
        </div>
      </div>
    </div>
  )
}
