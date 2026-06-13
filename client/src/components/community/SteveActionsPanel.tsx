import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Owner legibility panel for the Steve Community Package: translates the
 * abstract monthly pool into "actions" with a per-type breakdown, so an owner
 * can reason about what the €49.99 buys. Networking is shown as "coming soon"
 * until its action-weight is decided (it is not a pool surface yet). Replaces
 * the older one-line pool bar in EditCommunity.
 */

const TURQUOISE = '#00CEC8'

type Breakdown = { chat_feed: number; voice_summaries: number; networking: number | null }

type Props = {
  cap: number
  used: number
  remaining: number
  breakdown: Breakdown
  isTrial: boolean
  trialTotalDays: number
  periodEnd: string | null
}

function Row({ color, label, detail, value }: { color: string; label: string; detail?: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-c-text-secondary">
        {label}
        {detail ? <span className="text-c-text-tertiary"> · {detail}</span> : null}
      </span>
      <span className="shrink-0 text-[13px] text-c-text-tertiary">{value}</span>
    </div>
  )
}

export default function SteveActionsPanel({ cap, used, remaining, breakdown, isTrial, trialTotalDays, periodEnd }: Props) {
  const { t } = useTranslation()

  // Trial day derived from the period end (its start is end − total days).
  const trialDay = (() => {
    if (!isTrial || !periodEnd) return null
    const end = new Date(periodEnd).getTime()
    if (Number.isNaN(end)) return null
    const start = end - trialTotalDays * 86_400_000
    const day = Math.floor((Date.now() - start) / 86_400_000) + 1
    return Math.max(1, Math.min(trialTotalDays, day))
  })()

  const pct = (n: number) => (cap > 0 ? Math.max(0, Math.min(100, (n / cap) * 100)) : 0)

  const headerRight = (() => {
    if (isTrial && trialDay != null) {
      return t('communities.steve_actions.trial_day', { day: trialDay, total: trialTotalDays })
    }
    if (periodEnd) {
      const d = new Date(periodEnd)
      if (!Number.isNaN(d.getTime())) {
        return t('communities.steve_actions.renews', { date: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) })
      }
    }
    return null
  })()

  return (
    <div className="rounded-2xl border border-c-border bg-c-bg-elevated p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cpoint-turquoise">
          {t('communities.steve_actions.title')}
        </span>
        {headerRight ? <span className="text-[11px] text-c-text-tertiary">{headerRight}</span> : null}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-semibold leading-none text-c-text-primary">{remaining}</span>
        <span className="text-sm text-c-text-secondary">{t('communities.steve_actions.left_of', { cap })}</span>
      </div>

      <div className="mt-2.5 flex h-2 w-full overflow-hidden rounded-full bg-c-active-bg" role="presentation">
        <div className="h-full" style={{ width: `${pct(breakdown.chat_feed)}%`, background: TURQUOISE }} />
        <div className="h-full" style={{ width: `${pct(breakdown.voice_summaries)}%`, background: 'rgba(0,206,200,0.45)' }} />
      </div>
      <div className="mt-1.5 text-[11px] text-c-text-tertiary">
        {t('communities.steve_actions.used_by_members', { used, cap })}
      </div>

      <div className="mt-4 space-y-2.5 border-t border-c-border pt-3.5">
        <Row
          color={TURQUOISE}
          label={t('communities.steve_actions.chat_feed')}
          value={t('communities.steve_actions.actions_count', { n: breakdown.chat_feed })}
        />
        <Row
          color="rgba(255,255,255,0.22)"
          label={t('communities.steve_actions.networking')}
          value={<span className="text-c-text-tertiary">{t('communities.steve_actions.coming_soon')}</span>}
        />
        <Row
          color="rgba(0,206,200,0.45)"
          label={t('communities.steve_actions.voice')}
          value={t('communities.steve_actions.actions_count', { n: breakdown.voice_summaries })}
        />
      </div>

      <div className="mt-4 rounded-xl bg-cpoint-turquoise/10 px-3.5 py-3 text-xs leading-relaxed text-c-text-secondary">
        {t('communities.steve_actions.footer', { cap })}
      </div>
    </div>
  )
}
