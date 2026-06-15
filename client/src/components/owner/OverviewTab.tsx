import { useTranslation } from 'react-i18next'
import OwnerSteveMark from './OwnerSteveMark'
import MetricCard from './MetricCard'
import { STEVE_BRAND } from '../../brand/steveBrand'
import type { OwnerOverview } from './types'

/**
 * The Overview tab. Everything below the Steve hero is rendered declaratively
 * from `data.metrics` — the order, which metrics appear, and their locked state
 * all come from the backend registry. New metrics need no change here.
 */
export default function OverviewTab({ data, onUpgrade }: { data: OwnerOverview; onUpgrade: () => void }) {
  const { t } = useTranslation()
  const { steve, metrics, community } = data

  const stats = metrics.filter(m => !m.locked && m.format === 'stat')
  const activity = metrics.filter(m => !m.locked && m.format === 'activity')
  const wide = metrics.filter(m => !m.locked && (m.format === 'funnel' || m.format === 'segments'))
  const locked = metrics.filter(m => m.locked)

  return (
    <div>
      <div className="flex items-start gap-3 px-1 pb-3">
        <OwnerSteveMark size={38} />
        <div className="min-w-0 flex-1">
          <div className="text-sm leading-relaxed text-c-text-primary">
            {t(steve.greeting_key, { community: community.name })}
          </div>
          <div className="mt-0.5 text-[11px] text-c-text-tertiary">{STEVE_BRAND.name}</div>
        </div>
      </div>

      <div className="mb-3.5 rounded-2xl border border-cpoint-turquoise/25 bg-cpoint-turquoise/[0.06] p-3.5">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-cpoint-turquoise">
          {STEVE_BRAND.name}
        </div>
        <div className="text-[13px] leading-relaxed text-c-text-primary/90">
          {t(steve.read_key, steve.read_params)}
        </div>
      </div>

      {stats.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5">
          {stats.map(m => <MetricCard key={m.id} metric={m} onUpgrade={onUpgrade} />)}
        </div>
      )}

      <div className="mt-2.5 space-y-2.5">
        {activity.map(m => <MetricCard key={m.id} metric={m} onUpgrade={onUpgrade} />)}
        {wide.map(m => <MetricCard key={m.id} metric={m} onUpgrade={onUpgrade} />)}
        {locked.map(m => <MetricCard key={m.id} metric={m} onUpgrade={onUpgrade} />)}
      </div>
    </div>
  )
}
