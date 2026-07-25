import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatSmartTime } from '../../../utils/time'
import { groupAccentHue, type CommunityGroup } from './types'
import GroupJoinRequests from './GroupJoinRequests'

/**
 * One card type for every group; membership, pending, join, and owner
 * powers are all trailing-slot states — no more Joined/Available page
 * split. The whole card opens the group for members; Join and the
 * overflow menu stop propagation.
 */
export default function GroupCard({
  group,
  locusName,
  canManage,
  isMember,
  isPending,
  hasNewActivity,
  highlight,
  joining,
  onOpen,
  onJoin,
  onManage,
  onLeave,
  onDelete,
  onRequestsChanged,
  onError,
}: {
  group: CommunityGroup
  /** Owning community name — shown only when scope includes sub-communities. */
  locusName?: string | null
  canManage: boolean
  isMember: boolean
  isPending: boolean
  hasNewActivity: boolean
  highlight: boolean
  joining: boolean
  onOpen: () => void
  onJoin: () => void
  onManage: () => void
  onLeave: () => void
  onDelete: () => void
  onRequestsChanged: () => void
  onError: (message: string) => void
}) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [requestsOpen, setRequestsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
    }
  }, [menuOpen])

  const hue = groupAccentHue(group.group_id)
  const iconStyle = isMember
    ? { backgroundColor: `hsla(${hue}, 65%, 55%, 0.16)`, color: `hsl(${hue}, 70%, 62%)` }
    : undefined

  const metaParts: string[] = []
  if (typeof group.member_count === 'number') {
    metaParts.push(t('communities.group_members_count', { count: group.member_count }))
  }
  if (isMember && group.last_activity_at) {
    metaParts.push(t('communities.group_active', { time: formatSmartTime(group.last_activity_at) }))
  } else if (!isMember && group.approval_required) {
    metaParts.push(t('communities.approval_required_short'))
  }

  const pendingCount = canManage ? group.pending_count || 0 : 0

  return (
    <div
      className={`rounded-2xl border bg-c-bg-elevated transition-[background-color,transform] duration-150 ${
        isMember ? 'border-cpoint-turquoise/20' : 'border-c-border'
      } ${highlight ? 'ring-2 ring-cpoint-turquoise/60' : ''}`}
    >
      <div
        role={isMember ? 'link' : undefined}
        tabIndex={isMember ? 0 : undefined}
        aria-label={t('communities.group_card_aria', {
          name: group.name,
          community: group.community_name,
          count: group.member_count ?? 0,
        })}
        className={`px-4 py-3 flex items-start gap-3 min-h-[72px] ${
          isMember ? 'cursor-pointer hover:bg-c-hover-bg active:scale-[0.99] rounded-2xl' : ''
        }`}
        onClick={isMember ? onOpen : undefined}
        onKeyDown={isMember ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } } : undefined}
      >
        <div
          className={`w-10 h-10 rounded-full grid place-items-center shrink-0 ${isMember ? '' : 'bg-c-hover-bg'}`}
          style={iconStyle}
          aria-hidden
        >
          <i className={`fa-solid fa-users text-sm ${isMember ? '' : 'text-c-text-tertiary'}`} />
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            {hasNewActivity && (
              <span className="w-1.5 h-1.5 rounded-full bg-cpoint-turquoise shrink-0" aria-hidden />
            )}
            <span className="text-sm font-medium text-c-text-primary truncate">{group.name}</span>
            {group.steve_agent_enabled && (
              <span
                className="inline-flex items-center gap-1 px-1.5 h-5 rounded-full bg-cpoint-turquoise/10 text-cpoint-turquoise text-[10px] shrink-0"
                aria-hidden
              >
                <i className="fa-solid fa-robot text-[9px]" />
                Steve
              </span>
            )}
          </div>
          <div className="text-[11px] text-c-text-tertiary mt-0.5 truncate">
            {metaParts.join(' · ')}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            {locusName && (
              <span className="px-1.5 h-5 inline-flex items-center rounded bg-white/[0.05] text-[10px] text-c-text-tertiary max-w-[60%] truncate">
                {locusName}
              </span>
            )}
            {pendingCount > 0 && (
              <button
                type="button"
                className="px-1.5 h-5 inline-flex items-center rounded-full bg-amber-300/10 text-amber-300/90 text-[10px] font-medium hover:bg-amber-300/20"
                onClick={e => { e.stopPropagation(); setRequestsOpen(v => !v) }}
              >
                {t('communities.groups_pending_requests', { count: pendingCount })}
              </button>
            )}
          </div>
        </div>

        {/* Trailing slot: state, one control max */}
        {isPending ? (
          <span className="text-[11px] text-amber-300/90 pt-2 shrink-0">{t('communities.pending_status')}</span>
        ) : !isMember ? (
          <button
            type="button"
            disabled={joining}
            className="h-8 px-3 mt-1 rounded-lg border border-cpoint-turquoise/40 text-cpoint-turquoise text-xs font-medium hover:bg-cpoint-turquoise/10 disabled:opacity-50 shrink-0"
            onClick={e => { e.stopPropagation(); onJoin() }}
          >
            {joining ? <i className="fa-solid fa-spinner fa-spin" aria-hidden /> : t('communities.join')}
          </button>
        ) : canManage ? (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              aria-label={t('communities.group_options_aria')}
              className="h-9 w-9 rounded-full grid place-items-center text-c-text-tertiary hover:bg-c-hover-bg focus-visible:ring-2 focus-visible:ring-cpoint-turquoise/60"
              onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }}
            >
              <i className="fa-solid fa-ellipsis" aria-hidden />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-10 z-20 w-44 rounded-xl border border-c-border bg-c-bg-elevated shadow-lg p-1">
                <button
                  type="button"
                  className="w-full text-left px-3 py-2.5 rounded-lg text-xs text-c-text-primary hover:bg-c-hover-bg"
                  onClick={e => { e.stopPropagation(); setMenuOpen(false); onManage() }}
                >
                  {t('communities.manage_group')}
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2.5 rounded-lg text-xs text-c-text-secondary hover:bg-c-hover-bg"
                  onClick={e => { e.stopPropagation(); setMenuOpen(false); onLeave() }}
                >
                  {t('communities.leave_group')}
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2.5 rounded-lg text-xs text-red-400 hover:bg-c-hover-bg"
                  onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete() }}
                >
                  {t('communities.delete_group')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <i className="fa-solid fa-chevron-right text-xs text-c-text-tertiary pt-2.5 shrink-0" aria-hidden />
        )}
      </div>
      {requestsOpen && pendingCount > 0 && (
        <GroupJoinRequests
          groupId={group.group_id}
          onDecided={onRequestsChanged}
          onError={onError}
        />
      )}
    </div>
  )
}
