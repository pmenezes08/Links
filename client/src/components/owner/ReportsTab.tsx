import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OwnerSteveMark from './OwnerSteveMark'
import type { OwnerReport } from './types'

type Filter = 'pending' | 'reviewed' | 'dismissed'
const FILTERS: Filter[] = ['pending', 'reviewed', 'dismissed']

function ReportCard({
  rep,
  filter,
  busy,
  onRemove,
  onKeep,
}: {
  rep: OwnerReport
  filter: Filter
  busy: boolean
  onRemove: () => void
  onKeep: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="rounded-2xl border border-c-border bg-c-bg-elevated p-3.5">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] text-c-text-secondary">
          {t('owner.reports_type_post')}
        </span>
        <span className="truncate text-[11px] text-c-text-tertiary">
          {t('owner.reports_flagged_as', { reason: rep.reason })}
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-c-text-tertiary">
          {rep.report_count > 1 ? t('owner.reports_count', { n: rep.report_count }) : `@${rep.reporter_username}`}
        </span>
      </div>
      <div className="rounded-xl bg-white/[0.04] p-3">
        <div className="mb-1 text-[11px] text-c-text-tertiary">@{rep.post_author}</div>
        <div className="whitespace-pre-wrap break-words text-[13px] leading-snug text-c-text-primary/90">
          {rep.post_content}
        </div>
      </div>
      {filter === 'pending' && (
        <div className="mt-3 flex gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            className="flex-1 rounded-full border border-red-400/45 py-2 text-[12px] font-medium text-red-400 disabled:opacity-50"
          >
            <i className="fa-solid fa-trash mr-1.5 text-[11px]" />
            {t('owner.reports_action_remove')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onKeep}
            className="flex-1 rounded-full border border-c-border py-2 text-[12px] font-medium text-c-text-secondary disabled:opacity-50"
          >
            {t('owner.reports_action_keep')}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Reports tab — Steve as a calm gatekeeper over the community's flagged posts.
 * Remove this (delete the content) or Keep it up (dismiss the report). Acting
 * removes the card from the queue. Posts only for now.
 */
export default function ReportsTab({ communityId }: { communityId: number }) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<Filter>('pending')
  const [reports, setReports] = useState<OwnerReport[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback((f: Filter) => {
    setLoading(true)
    fetch(`/api/community/${communityId}/reports?status=${f}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(r => r.json())
      .then(j => { setReports(Array.isArray(j?.reports) ? j.reports : []); setLoading(false) })
      .catch(() => { setReports([]); setLoading(false) })
  }, [communityId])

  useEffect(() => { load(filter) }, [filter, load])

  const remove = async (rep: OwnerReport) => {
    if (!window.confirm(t('owner.reports_confirm_body'))) return
    setBusy(rep.report_id)
    try {
      await fetch(`/api/community/${communityId}/reports/remove`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: rep.post_id }),
      })
      setReports(prev => prev.filter(r => r.post_id !== rep.post_id))
    } finally {
      setBusy(null)
    }
  }

  const keep = async (rep: OwnerReport) => {
    setBusy(rep.report_id)
    try {
      await fetch(`/api/community/${communityId}/reports/review`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_id: rep.report_id, action: 'dismiss' }),
      })
      setReports(prev => prev.filter(r => r.report_id !== rep.report_id))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <div className="mb-3.5 flex items-start gap-3 rounded-2xl border border-cpoint-turquoise/25 bg-cpoint-turquoise/[0.06] p-3.5">
        <OwnerSteveMark size={30} />
        <div className="text-[13px] leading-relaxed text-c-text-primary/90">{t('owner.reports_intro')}</div>
      </div>

      <div className="mb-3.5 flex gap-2">
        {FILTERS.map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-[11px] ${
              filter === f ? 'bg-cpoint-turquoise text-[#063b39]' : 'border border-c-border text-c-text-secondary'
            }`}
          >
            {t(`owner.reports_filter_${f}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-c-text-tertiary">…</div>
      ) : reports.length === 0 ? (
        <div className="py-12 text-center">
          <div className="text-base font-medium text-c-text-primary">{t('owner.reports_soon_title')}</div>
          <div className="mx-auto mt-1.5 max-w-xs text-[13px] text-c-text-tertiary">{t('owner.reports_soon_body')}</div>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map(rep => (
            <ReportCard
              key={rep.report_id}
              rep={rep}
              filter={filter}
              busy={busy === rep.report_id}
              onRemove={() => remove(rep)}
              onKeep={() => keep(rep)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
