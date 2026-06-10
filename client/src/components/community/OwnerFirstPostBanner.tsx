import { useTranslation } from 'react-i18next'

type OwnerFirstPostBannerProps = {
  communityName: string
  dismissed: boolean
  onDraftWithSteve: () => void
  onWriteSelf: () => void
  onDismiss: () => void
}

export default function OwnerFirstPostBanner({
  communityName,
  dismissed,
  onDraftWithSteve,
  onWriteSelf,
  onDismiss,
}: OwnerFirstPostBannerProps) {
  const { t } = useTranslation()

  if (dismissed) return null

  const displayName = communityName || t('communities.owner_first_post.community_fallback')

  return (
    <section className="rounded-3xl border border-cpoint-turquoise/25 bg-c-bg-surface p-4 shadow-c-card shadow-black/20 backdrop-blur">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cpoint-turquoise/80">
            {t('communities.owner_first_post.badge')}
          </div>
          <h2 className="mt-1 text-lg font-semibold text-c-text-primary">{t('communities.owner_first_post.title')}</h2>
        </div>
        <button
          type="button"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-c-border bg-c-hover-bg text-c-text-tertiary hover:border-cpoint-turquoise/50 hover:text-cpoint-turquoise"
          aria-label={t('communities.owner_first_post.dismiss_aria')}
          onClick={onDismiss}
        >
          <i className="fa-solid fa-xmark text-xs" />
        </button>
      </div>
      <p className="text-sm leading-relaxed text-c-text-secondary">
        {t('communities.owner_first_post.body', { name: displayName })}
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          className="inline-flex h-11 items-center justify-center rounded-full bg-cpoint-turquoise px-4 text-sm font-semibold text-black hover:brightness-110"
          onClick={onDraftWithSteve}
        >
          {t('communities.owner_first_post.draft_with_steve')}
        </button>
        <button
          type="button"
          className="inline-flex h-11 items-center justify-center rounded-full border border-c-border px-4 text-sm font-semibold text-c-text-secondary hover:border-cpoint-turquoise/40 hover:text-cpoint-turquoise"
          onClick={onWriteSelf}
        >
          {t('communities.owner_first_post.write_myself')}
        </button>
      </div>
      <button
        type="button"
        className="mt-3 text-xs font-medium text-c-text-tertiary hover:text-c-text-secondary"
        onClick={onDismiss}
      >
        {t('communities.owner_first_post.maybe_later')}
      </button>
    </section>
  )
}
