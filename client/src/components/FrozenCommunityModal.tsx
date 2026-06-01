import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export interface FrozenCommunityModalProps {
  open: boolean
  communityId: number
  communityName: string
  memberCount: number
  freeMemberCap: number
  frozenAt?: string | null
  onManageMembers: () => void
}

export default function FrozenCommunityModal({
  open,
  communityId,
  communityName,
  memberCount,
  freeMemberCap,
  frozenAt,
  onManageMembers,
}: FrozenCommunityModalProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  if (!open) return null

  const overflow = Math.max(0, memberCount - freeMemberCap)
  const frozenAtDisplay = formatDate(frozenAt || '')

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="frozen-community-modal-title"
      className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/85 backdrop-blur sm:items-center sm:p-6"
    >
      <div className="flex h-full w-full flex-col border-c-border bg-c-bg-app text-c-text-primary shadow-2xl sm:h-auto sm:max-w-lg sm:rounded-2xl sm:border">
        <div className="border-b border-c-border px-5 py-4">
          <div className="text-xs uppercase tracking-[0.22em] text-cpoint-turquoise">
            {t('communities.frozen_subscription_expired')}
          </div>
          <h2
            id="frozen-community-modal-title"
            className="mt-2 text-xl font-semibold"
          >
            {communityName ? t('communities.frozen_title_named', { name: communityName }) : t('communities.frozen_title_generic')}
          </h2>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <p className="text-sm leading-6 text-c-text-secondary">
            {t('communities.frozen_body', { cap: freeMemberCap })}
          </p>

          <div className="rounded-xl border border-c-border bg-white/[0.03] p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-c-text-tertiary">{t('communities.frozen_members_label')}</span>
              <span className="font-semibold text-c-text-primary">{memberCount}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-c-text-tertiary">{t('communities.frozen_limit_label')}</span>
              <span className="font-semibold text-c-text-primary">{freeMemberCap}</span>
            </div>
            {overflow > 0 && (
              <div className="mt-2 flex items-center justify-between">
                <span className="text-c-text-tertiary">{t('communities.frozen_over_limit_label')}</span>
                <span className="font-semibold text-cpoint-turquoise">{overflow}</span>
              </div>
            )}
            {frozenAtDisplay && (
              <div className="mt-2 flex items-center justify-between">
                <span className="text-c-text-tertiary">{t('communities.frozen_suspended_on_label')}</span>
                <span className="font-semibold text-c-text-primary">{frozenAtDisplay}</span>
              </div>
            )}
          </div>

          <p className="text-xs leading-5 text-c-text-tertiary">
            {t('communities.frozen_footer_note')}
          </p>
        </div>

        <div className="flex flex-col gap-3 border-t border-c-border px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onManageMembers}
            className="rounded-full border border-c-border px-5 py-2.5 text-sm text-c-text-secondary transition hover:bg-c-hover-bg"
          >
            {t('communities.frozen_remove_members')}
          </button>
          <button
            type="button"
            onClick={() =>
              navigate(`/subscription_plans?community_id=${communityId}`)
            }
            className="rounded-full bg-cpoint-turquoise px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-cpoint-turquoise/90"
          >
            {t('communities.frozen_renew_subscription')}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatDate(value: string) {
  if (!value) return ''
  const normalized = value.includes(' ') ? value.replace(' ', 'T') : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? value.split(' ')[0] : date.toLocaleDateString()
}
