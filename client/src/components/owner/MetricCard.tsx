import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { OwnerMetric } from './types'

const TURQUOISE = '#00CEC8'

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-c-border bg-c-bg-elevated p-3.5">{children}</div>
}

function num(value: Record<string, unknown> | null, key: string): number {
  const v = value?.[key]
  return typeof v === 'number' ? v : 0
}

type LeaderRow = { username: string; count: number }

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

function ChampionName({ username, onThank }: { username: string; onThank: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => navigate(`/profile/${username}`)}
        className="min-w-0 truncate text-left text-c-text-primary underline-offset-2 hover:underline"
      >
        {username}
      </button>
      {onThank && (
        <button
          type="button"
          onClick={() => navigate(`/user_chat/chat/${username}`)}
          aria-label={t('owner.thank_champion', { username })}
          title={t('owner.thank_champion', { username })}
          className="shrink-0 text-[10px] text-cpoint-turquoise"
        >
          <i className="fa-regular fa-hand-peace" aria-hidden="true" />
        </button>
      )}
    </span>
  )
}

/**
 * Renders one metric descriptor. The vocabulary of `format`s is fixed; adding a
 * metric of an existing format is purely a backend change (it appears here with
 * no edit). Locked (paid-on-free) metrics render the upgrade teaser shell.
 */
export default function MetricCard({ metric, onUpgrade, isOwner = false, communityId = null }: {
  metric: OwnerMetric
  onUpgrade: () => void
  isOwner?: boolean
  communityId?: number | null
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
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
    const capWarning = v?.cap_warning === true
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
              <div
                className="h-full"
                style={{
                  width: `${Math.min(100, Math.round((count / cap) * 100))}%`,
                  background: capWarning ? '#E8A33D' : TURQUOISE,
                }}
              />
            </div>
            <div className={`mt-1 text-[10px] ${capWarning ? 'text-[#E8A33D]' : 'text-c-text-tertiary'}`}>
              {capWarning ? t('owner.members_cap_warning', { count, cap }) : t('owner.members_cap', { count, cap })}
            </div>
            {capWarning && isOwner && (
              <button
                type="button"
                onClick={onUpgrade}
                className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-cpoint-turquoise"
              >
                {t('owner.upgrade_cta')}
                <i className="fa-solid fa-chevron-right text-[9px]" aria-hidden="true" />
              </button>
            )}
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
        {Array.isArray(v?.top_active) && (v.top_active as LeaderRow[]).length > 0 && (
          <div className="mt-3 border-t border-c-border pt-2.5">
            <div className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-cpoint-turquoise">{t('owner.most_active')}</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {(v.top_active as LeaderRow[]).map((u, i) => (
                <span key={u.username} className="inline-flex items-center gap-1 text-[12px]">
                  <span className="text-c-text-tertiary">{i + 1}.</span>
                  <ChampionName username={u.username} onThank={false} />
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-c-text-tertiary">{t('owner.most_active_note')}</p>
          </div>
        )}
      </Card>
    )
  }

  if (metric.format === 'comm') {
    const count = num(v, 'count')
    const members = num(v, 'total')
    const pct = members > 0 ? Math.round((count / members) * 100) : 0
    return (
      <Card>
        <div className="flex items-center justify-between">
          <span className="text-xs text-c-text-secondary">{label}</span>
          {metric.owner_only && <span className="text-[10px] text-c-text-tertiary">{t('owner.owner_only')}</span>}
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold text-c-text-primary">{count}</span>
          <span className="text-[12px] text-c-text-tertiary">{t('owner.comm_value', { pct })}</span>
        </div>
      </Card>
    )
  }

  if (metric.format === 'leaderboards') {
    const groups = [
      { title: t('owner.top_posters'), rows: (v?.posters as LeaderRow[]) || [] },
      { title: t('owner.top_repliers'), rows: (v?.repliers as LeaderRow[]) || [] },
      { title: t('owner.top_reactors'), rows: (v?.reactors as LeaderRow[]) || [] },
    ]
    return (
      <Card>
        <div className="mb-2 text-xs text-c-text-secondary">{label}</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {groups.map(g => (
            <div key={g.title}>
              <div className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-cpoint-turquoise">{g.title}</div>
              {g.rows.length === 0 ? (
                <div className="text-[11px] text-c-text-tertiary">{t('owner.leaderboard_empty')}</div>
              ) : (
                <div className="space-y-1">
                  {g.rows.map((r, i) => (
                    <div key={r.username} className="flex items-center justify-between text-[12px]">
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <span className="text-c-text-tertiary">{i + 1}.</span>
                        <ChampionName username={r.username} onThank={isOwner} />
                      </span>
                      <span className="ml-2 shrink-0 text-c-text-tertiary">{r.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-c-text-tertiary">{t('owner.leaderboard_windows')}</p>
      </Card>
    )
  }

  if (metric.format === 'funnel') {
    const hasActivated = typeof v?.activated === 'number'
    return (
      <Card>
        <div className="text-xs text-c-text-secondary">{label}</div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold text-c-text-primary">{num(v, 'accepted')}</span>
          <span className="text-[12px] text-c-text-tertiary">
            {t('owner.invites_value', { accepted: num(v, 'accepted'), sent: num(v, 'sent') })}
          </span>
        </div>
        {hasActivated && (
          <div className="mt-1 text-[11px] text-c-text-tertiary">
            {t('owner.invites_activated', { n: num(v, 'activated') })}
          </div>
        )}
        {communityId != null && (
          <button
            type="button"
            onClick={() => navigate(`/community/${communityId}/members`)}
            className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-cpoint-turquoise"
          >
            {t('owner.invite_more')}
            <i className="fa-solid fa-chevron-right text-[9px]" aria-hidden="true" />
          </button>
        )}
      </Card>
    )
  }

  if (metric.format === 'ratio') {
    const count = num(v, 'count')
    const total = num(v, 'total')
    const pct = total > 0 ? Math.round((count / total) * 100) : 0
    const windowDays = num(v, 'window_days')
    return (
      <Card>
        <div className="text-xs text-c-text-secondary">{label}</div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold text-c-text-primary">{total > 0 ? `${pct}%` : '—'}</span>
          {total > 0 && <span className="text-[12px] text-c-text-tertiary">{t('owner.ratio_of', { count, total })}</span>}
        </div>
        {windowDays > 0 && (
          <p className="mt-1.5 text-[10px] leading-relaxed text-c-text-tertiary">
            {t('owner.activation_window_note', { days: windowDays })}
          </p>
        )}
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

  // Unknown format: degrade VISIBLY (label + em-dash), never vanish. A
  // backend-only metric addition with a new format must show up as a stub —
  // a silently dropped card looks like a paid feature that doesn't exist.
  return (
    <Card>
      <div className="text-xs text-c-text-secondary">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-c-text-tertiary">—</div>
    </Card>
  )
}
