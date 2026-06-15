import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { OwnerMetric } from './types'

const TURQUOISE = '#00CEC8'

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-c-border bg-c-bg-elevated p-3.5">{children}</div>
}

function num(value: Record<string, number | null> | null, key: string): number {
  const v = value?.[key]
  return typeof v === 'number' ? v : 0
}

function ActiveStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-lg font-semibold text-c-text-primary">{value}</div>
      <div className="text-[10px] text-c-text-tertiary">{label}</div>
    </div>
  )
}

function SegRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: color }} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-c-text-secondary">{label}</span>
      <span className="shrink-0 text-c-text-tertiary">{value}</span>
    </div>
  )
}

/**
 * Renders one metric descriptor. The vocabulary of `format`s is fixed; adding a
 * metric of an existing format is purely a backend change (it appears here with
 * no edit). Locked (paid-on-free) metrics render the upgrade teaser shell.
 */
export default function MetricCard({ metric, onUpgrade }: { metric: OwnerMetric; onUpgrade: () => void }) {
  const { t } = useTranslation()
  const label = t(metric.label_key)
  const v = metric.value

  if (metric.locked) {
    return (
      <button
        type="button"
        onClick={onUpgrade}
        className="w-full rounded-2xl border border-c-border bg-c-bg-elevated/60 p-3.5 text-left"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs text-c-text-secondary">{label}</span>
          <i className="fa-solid fa-lock text-[11px] text-cpoint-turquoise" />
        </div>
        <div className="mt-2.5 space-y-1.5" aria-hidden="true">
          <div className="h-1.5 w-[70%] rounded-full bg-white/10" />
          <div className="h-1.5 w-[52%] rounded-full bg-white/[0.06]" />
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-cpoint-turquoise">
          <span>{metric.hint_key ? t(metric.hint_key) : t('owner.locked_cta')}</span>
          <i className="fa-solid fa-chevron-right text-[9px]" />
        </div>
      </button>
    )
  }

  if (metric.format === 'stat' && metric.id === 'members') {
    const count = num(v, 'count')
    const delta = num(v, 'delta_7d')
    const cap = v?.cap ?? null
    return (
      <Card>
        <div className="text-xs text-c-text-secondary">{label}</div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold text-c-text-primary">{count}</span>
          {delta > 0 && <span className="text-[11px] text-cpoint-turquoise">{t('owner.members_delta', { n: delta })}</span>}
        </div>
        {typeof cap === 'number' && cap > 0 && (
          <>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-c-active-bg">
              <div className="h-full" style={{ width: `${Math.min(100, Math.round((count / cap) * 100))}%`, background: TURQUOISE }} />
            </div>
            <div className="mt-1 text-[10px] text-c-text-tertiary">{t('owner.members_cap', { count, cap })}</div>
          </>
        )}
      </Card>
    )
  }

  if (metric.format === 'stat' && metric.id === 'spaces') {
    return (
      <Card>
        <div className="text-xs text-c-text-secondary">{label}</div>
        <div className="mt-1.5 text-[15px] font-medium text-c-text-primary">
          {t('owner.spaces_value', { subs: num(v, 'subcommunities'), groups: num(v, 'groups') })}
        </div>
      </Card>
    )
  }

  if (metric.format === 'activity') {
    const total = num(v, 'members')
    const wau = num(v, 'wau')
    const pct = total > 0 ? Math.round((wau / total) * 100) : 0
    return (
      <Card>
        <div className="text-xs text-c-text-secondary">{label}</div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <ActiveStat label={t('owner.active_today')} value={num(v, 'dau')} />
          <ActiveStat label={t('owner.active_week')} value={wau} />
          <ActiveStat label={t('owner.active_month')} value={num(v, 'mau')} />
        </div>
        {total > 0 && <div className="mt-2 text-[11px] text-c-text-tertiary">{t('owner.active_pct', { pct })}</div>}
      </Card>
    )
  }

  if (metric.format === 'funnel') {
    return (
      <Card>
        <div className="text-xs text-c-text-secondary">{label}</div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold text-c-text-primary">{num(v, 'accepted')}</span>
          <span className="text-[12px] text-c-text-tertiary">
            {t('owner.invites_value', { accepted: num(v, 'accepted'), sent: num(v, 'sent') })}
          </span>
        </div>
      </Card>
    )
  }

  if (metric.format === 'segments') {
    const total = num(v, 'total')
    const complete = num(v, 'complete')
    const partial = num(v, 'partial')
    const none = num(v, 'none')
    const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0)
    return (
      <Card>
        <div className="flex items-center justify-between">
          <span className="text-xs text-c-text-secondary">{label}</span>
          {metric.owner_only && <span className="text-[10px] text-c-text-tertiary">{t('owner.owner_only')}</span>}
        </div>
        <div className="mt-2.5 flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
          <div className="h-full" style={{ width: `${pct(complete)}%`, background: TURQUOISE }} />
          <div className="h-full" style={{ width: `${pct(partial)}%`, background: 'rgba(0,206,200,0.4)' }} />
          <div className="h-full" style={{ width: `${pct(none)}%`, background: 'rgba(255,255,255,0.12)' }} />
        </div>
        <div className="mt-2.5 space-y-1 text-[11px]">
          <SegRow color={TURQUOISE} label={t('owner.completion_full')} value={complete} />
          <SegRow color="rgba(0,206,200,0.4)" label={t('owner.completion_partial')} value={partial} />
          <SegRow color="rgba(255,255,255,0.18)" label={t('owner.completion_none')} value={none} />
        </div>
      </Card>
    )
  }

  return null
}
