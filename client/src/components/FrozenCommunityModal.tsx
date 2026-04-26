import { useNavigate } from 'react-router-dom'

export interface FrozenCommunityModalProps {
  open: boolean
  communityId: number
  communityName: string
  memberCount: number
  freeMemberCap: number
  frozenAt?: string | null
  onManageMembers: () => void
}

/**
 * Owner-facing modal that locks the community feed when a paid
 * subscription has expired and the community still has more members than
 * the Free tier allows.
 *
 * The modal is intentionally non-dismissable — the only ways out are to
 * renew the subscription or to remove members until the community fits
 * within the Free cap. Both options are surfaced as primary actions.
 */
export default function FrozenCommunityModal({
  open,
  communityId,
  communityName,
  memberCount,
  freeMemberCap,
  frozenAt,
  onManageMembers,
}: FrozenCommunityModalProps) {
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
      <div className="flex h-full w-full flex-col border-white/10 bg-black text-white shadow-2xl sm:h-auto sm:max-w-lg sm:rounded-2xl sm:border">
        <div className="border-b border-white/10 px-5 py-4">
          <div className="text-xs uppercase tracking-[0.22em] text-cpoint-turquoise">
            Subscription expired
          </div>
          <h2
            id="frozen-community-modal-title"
            className="mt-2 text-xl font-semibold"
          >
            {communityName ? `"${communityName}" is suspended` : 'This community is suspended'}
          </h2>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <p className="text-sm leading-6 text-white/75">
            This community was suspended because the paid subscription
            ended and the community has more members than the Free tier
            allows. To restore access, either renew the subscription or
            remove members until the community fits within the
            <span className="font-semibold text-white"> {freeMemberCap}-member </span>
            Free limit.
          </p>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-white/60">Members</span>
              <span className="font-semibold text-white">{memberCount}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-white/60">Free tier limit</span>
              <span className="font-semibold text-white">{freeMemberCap}</span>
            </div>
            {overflow > 0 && (
              <div className="mt-2 flex items-center justify-between">
                <span className="text-white/60">Members over limit</span>
                <span className="font-semibold text-cpoint-turquoise">{overflow}</span>
              </div>
            )}
            {frozenAtDisplay && (
              <div className="mt-2 flex items-center justify-between">
                <span className="text-white/60">Suspended on</span>
                <span className="font-semibold text-white">{frozenAtDisplay}</span>
              </div>
            )}
          </div>

          <p className="text-xs leading-5 text-white/50">
            Members keep read-only access to other communities. Once the
            subscription is active again, or the community fits within
            the Free limit, access is restored automatically.
          </p>
        </div>

        <div className="flex flex-col gap-3 border-t border-white/10 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onManageMembers}
            className="rounded-full border border-white/15 px-5 py-2.5 text-sm text-white/85 transition hover:bg-white/5"
          >
            Remove members
          </button>
          <button
            type="button"
            onClick={() =>
              navigate(`/subscription_plans?community_id=${communityId}`)
            }
            className="rounded-full bg-cpoint-turquoise px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-cpoint-turquoise/90"
          >
            Renew subscription
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
