import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import OwnerSteveMark from './OwnerSteveMark'
import MetricCard from './MetricCard'
import PendingInvitesSheet from './PendingInvitesSheet'
import { STEVE_BRAND } from '../../brand/steveBrand'
import type { OwnerOverview, OwnerSteveAction } from './types'

/**
 * The Overview tab. Everything below the Steve hero is rendered declaratively
 * from `data.metrics` — the order, which metrics appear, and their locked state
 * all come from the backend registry. New metrics need no change here.
 */
export default function OverviewTab({ data, onUpgrade, isOwner = false, communityId = null }: {
  data: OwnerOverview
  onUpgrade: () => void
  isOwner?: boolean
  communityId?: number | null
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { steve, metrics, community } = data
  const actions = steve.actions ?? []
  const [invitesOpen, setInvitesOpen] = useState(false)

  // Steve actions with a behavior id are tappable drill-ins.
  const actionHandler = (a: OwnerSteveAction): (() => void) | null => {
    if (a.action === 'pending_invites' && isOwner && communityId != null) {
      return () => setInvitesOpen(true)
    }
    return null
  }

  const stats = metrics.filter(m => !m.locked && m.format === 'stat')
  const activity = metrics.filter(m => !m.locked && m.format === 'activity')
  // Complement bucket: any unlocked format that isn't a small stat or the
  // activity block renders full-width. New backend formats land here by
  // default instead of silently disappearing.
  const wide = metrics.filter(m => !m.locked && m.format !== 'stat' && m.format !== 'activity')
  const locked = metrics.filter(m => m.locked)

  // One Steve panel — mark once, greeting + read + actions as a single voiced
  // block (the old greeting-header + read-card double-Steve diluted the voice).
  const stevePanel = (
    <div className="mb-3.5 rounded-2xl border border-cpoint-turquoise/25 bg-cpoint-turquoise/[0.06] p-3.5">
      <div className="flex items-start gap-3">
        <OwnerSteveMark size={28} />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cpoint-turquoise">
            {STEVE_BRAND.name}
          </div>
          <div className="mt-1 text-sm leading-relaxed text-c-text-primary">
            {t(steve.greeting_key, { community: community.name })}
          </div>
          <div className="mt-1.5 text-[13px] leading-relaxed text-c-text-primary/90">
            {t(steve.read_key, steve.read_params)}
          </div>
        </div>
      </div>
      {actions.length > 0 && (
        <div className="mt-2.5 space-y-1.5 border-t border-cpoint-turquoise/15 pt-2.5">
          {actions.map(a => {
            const onTap = actionHandler(a)
            const row = (
              <>
                <i className="fa-solid fa-arrow-right mt-0.5 text-[9px] text-cpoint-turquoise" aria-hidden="true" />
                <span className="min-w-0 flex-1">{t(a.key, a.params)}</span>
                {onTap && <i className="fa-solid fa-chevron-right mt-0.5 shrink-0 text-[9px] text-c-text-tertiary" aria-hidden="true" />}
              </>
            )
            return onTap ? (
              <button
                key={a.key}
                type="button"
                onClick={onTap}
                className="flex w-full items-start gap-1.5 text-left text-[12px] leading-relaxed text-c-text-primary/90"
              >
                {row}
              </button>
            ) : (
              <div key={a.key} className="flex items-start gap-1.5 text-[12px] leading-relaxed text-c-text-primary/90">
                {row}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  // Brand-new community: one encouraging Steve panel + a single invite CTA,
  // never a wall of zero-value cards contradicting the empty-state copy.
  if (steve.low_data) {
    const membersCard = metrics.find(m => m.id === 'members' && !m.locked)
    return (
      <div>
        {stevePanel}
        {communityId != null && (
          <button
            type="button"
            onClick={() => navigate(`/community/${communityId}/members`)}
            className="mb-3.5 w-full rounded-2xl bg-cpoint-turquoise px-4 py-3 text-center text-[13px] font-semibold text-c-text-on-accent"
          >
            {t('owner.invite_first')}
          </button>
        )}
        {membersCard && (
          <MetricCard metric={membersCard} onUpgrade={onUpgrade} isOwner={isOwner} communityId={communityId} />
        )}
      </div>
    )
  }

  return (
    <div>
      {stevePanel}

      {stats.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5">
          {stats.map(m => <MetricCard key={m.id} metric={m} onUpgrade={onUpgrade} isOwner={isOwner} communityId={communityId} />)}
        </div>
      )}

      <div className="mt-2.5 space-y-2.5">
        {activity.map(m => <MetricCard key={m.id} metric={m} onUpgrade={onUpgrade} isOwner={isOwner} communityId={communityId} />)}
        {wide.map(m => <MetricCard key={m.id} metric={m} onUpgrade={onUpgrade} isOwner={isOwner} communityId={communityId} />)}
        {locked.map(m => <MetricCard key={m.id} metric={m} onUpgrade={onUpgrade} isOwner={isOwner} communityId={communityId} />)}
      </div>

      {communityId != null && (
        <PendingInvitesSheet
          open={invitesOpen}
          communityId={communityId}
          scope={data.scope}
          onClose={() => setInvitesOpen(false)}
        />
      )}
    </div>
  )
}
