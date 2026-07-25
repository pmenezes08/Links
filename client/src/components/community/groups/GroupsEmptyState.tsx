import { useTranslation } from 'react-i18next'

export type GroupsEmptyVariant = 'owner-none' | 'owner-elsewhere' | 'member-none'

/**
 * The one ask of an empty Groups tab. Three variants:
 *  - owner with no groups anywhere in scope → create the first group
 *  - owner with groups deeper in the tree → widen the scope
 *  - member with none visible → no CTA (never show a control the server 403s)
 */
export default function GroupsEmptyState({
  variant,
  communityName,
  elsewhereCount = 0,
  onCreate,
  onIncludeSubs,
}: {
  variant: GroupsEmptyVariant
  communityName: string
  elsewhereCount?: number
  onCreate?: () => void
  onIncludeSubs?: () => void
}) {
  const { t } = useTranslation()
  const title =
    variant === 'owner-none'
      ? t('communities.groups_empty_owner_title')
      : variant === 'owner-elsewhere'
        ? t('communities.groups_empty_elsewhere_title', { name: communityName })
        : t('communities.groups_empty_member_title')
  const body =
    variant === 'owner-none'
      ? t('communities.groups_empty_owner_body', { name: communityName })
      : variant === 'owner-elsewhere'
        ? t('communities.groups_empty_elsewhere_body', { count: elsewhereCount })
        : t('communities.groups_empty_member_body')

  return (
    <div className="flex flex-col items-center py-12 px-4">
      <div className="w-16 h-16 rounded-full bg-c-hover-bg border border-c-border grid place-items-center mb-3">
        <i className="fa-solid fa-users text-2xl text-c-text-tertiary" aria-hidden />
      </div>
      <div className="text-base font-medium text-c-text-secondary mb-1">{title}</div>
      <div className="text-xs text-c-text-tertiary text-center max-w-xs">{body}</div>
      {variant === 'owner-none' && onCreate && (
        <button
          type="button"
          className="mt-4 h-11 px-5 rounded-xl bg-cpoint-turquoise text-black text-sm font-semibold hover:brightness-110"
          onClick={onCreate}
        >
          {t('communities.groups_empty_owner_cta')}
        </button>
      )}
      {variant === 'owner-elsewhere' && onIncludeSubs && (
        <button
          type="button"
          className="mt-4 h-11 px-5 rounded-xl border border-cpoint-turquoise/40 text-cpoint-turquoise text-sm font-semibold hover:bg-cpoint-turquoise/10"
          onClick={onIncludeSubs}
        >
          {t('communities.groups_empty_elsewhere_cta')}
        </button>
      )}
    </div>
  )
}
