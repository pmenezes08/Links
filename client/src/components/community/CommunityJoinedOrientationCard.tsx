import { useTranslation } from 'react-i18next'

type CommunityJoinedOrientationCardProps = {
  communityName: string
  inviterName?: string | null
  introduceThreadPostId?: number | null
  onDismiss: () => void
  onIntroduce?: () => void
}

export default function CommunityJoinedOrientationCard({
  communityName,
  inviterName,
  introduceThreadPostId,
  onDismiss,
  onIntroduce,
}: CommunityJoinedOrientationCardProps) {
  const { t } = useTranslation()
  const name = communityName || t('communities.joined_orientation.community_fallback')
  const inviterLine = inviterName
    ? t('communities.joined_orientation.inviter_line', { name: inviterName })
    : t('communities.joined_orientation.default_line')

  return (
    <section
      role="region"
      aria-label={t('communities.joined_orientation.aria_label')}
      className="rounded-3xl border border-cpoint-turquoise/20 bg-c-bg-surface p-4 shadow-c-card shadow-black/20"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cpoint-turquoise/80">
            {t('communities.joined_orientation.badge')}
          </div>
          <h2 className="mt-1 text-base font-semibold text-c-text-primary">
            {t('communities.joined_orientation.welcome_title', { name })}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-c-text-secondary">
            {inviterLine} {t('communities.joined_orientation.explore_hint')}
          </p>
        </div>
        <button
          type="button"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-c-border bg-c-hover-bg text-c-text-tertiary hover:border-cpoint-turquoise/50 hover:text-cpoint-turquoise"
          aria-label={t('communities.joined_orientation.dismiss_aria')}
          onClick={onDismiss}
        >
          <i className="fa-solid fa-xmark text-xs" />
        </button>
      </div>
      {introduceThreadPostId ? (
        <button
          type="button"
          className="mt-3 text-sm font-medium text-cpoint-turquoise hover:brightness-110"
          onClick={onIntroduce}
        >
          {t('communities.joined_orientation.introduce_cta')}
        </button>
      ) : null}
    </section>
  )
}
