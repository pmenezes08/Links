import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import OverviewTab from '../components/owner/OverviewTab'
import SpacesTab from '../components/owner/SpacesTab'
import type { OwnerOverview } from '../components/owner/types'

type Tab = 'overview' | 'reports' | 'spaces'
const TABS: Tab[] = ['overview', 'reports', 'spaces']

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 py-2.5 text-[13px] transition-colors ${
        active ? 'border-cpoint-turquoise font-medium text-cpoint-turquoise' : 'border-transparent text-c-text-secondary'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * Owner Dashboard shell — one route, internal tabs (Overview / Reports /
 * Spaces). Read-only analytics narrated by Steve. Access is enforced
 * server-side; a 404 here means "not yours" and we send the owner back.
 */
export default function OwnerDashboard() {
  const { t } = useTranslation()
  const { community_id } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const communityId = community_id ? Number(community_id) : null

  const requested = searchParams.get('tab') as Tab | null
  const [tab, setTab] = useState<Tab>(requested && TABS.includes(requested) ? requested : 'overview')
  const [data, setData] = useState<OwnerOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!communityId) return
    let mounted = true
    setLoading(true)
    setError(false)
    fetch(`/api/community/${communityId}/analytics/overview`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(async r => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json()
      })
      .then(j => { if (mounted) { setData(j); setLoading(false) } })
      .catch(() => { if (mounted) { setError(true); setLoading(false) } })
    return () => { mounted = false }
  }, [communityId])

  const changeTab = (next: Tab) => {
    setTab(next)
    const sp = new URLSearchParams(searchParams)
    sp.set('tab', next)
    setSearchParams(sp, { replace: true })
  }

  const onUpgrade = () => navigate('/subscription_plans')

  return (
    <div className="min-h-screen bg-c-bg-app text-c-text-primary">
      <div
        className="sticky top-0 z-10 flex items-center gap-3 border-b border-c-border bg-c-bg-app/80 px-4 py-3 backdrop-blur"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
      >
        <button type="button" onClick={() => navigate(-1)} aria-label={t('navigation.back')} className="text-c-text-secondary">
          <i className="fa-solid fa-chevron-left" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{data?.community?.name || t('owner.header')}</div>
          <div className="text-[11px] text-c-text-tertiary">{t('navigation.owner_tools')}</div>
        </div>
        {data && (
          <span className="rounded-full border border-cpoint-turquoise/40 px-2 py-0.5 text-[10px] text-cpoint-turquoise">
            Owner
          </span>
        )}
      </div>

      <div className="flex gap-5 border-b border-c-border px-4">
        <TabButton active={tab === 'overview'} onClick={() => changeTab('overview')}>{t('owner.tab_overview')}</TabButton>
        <TabButton active={tab === 'reports'} onClick={() => changeTab('reports')}>{t('owner.tab_reports')}</TabButton>
        <TabButton active={tab === 'spaces'} onClick={() => changeTab('spaces')}>{t('owner.tab_spaces')}</TabButton>
      </div>

      <div className="mx-auto max-w-2xl px-3 py-4">
        {loading && <div className="py-10 text-center text-sm text-c-text-tertiary">…</div>}

        {error && !loading && (
          <div className="py-10 text-center text-sm text-c-text-secondary">{t('owner.error')}</div>
        )}

        {!loading && !error && data && (
          <>
            {tab === 'overview' && <OverviewTab data={data} onUpgrade={onUpgrade} />}
            {tab === 'reports' && (
              <div className="py-12 text-center">
                <div className="text-base font-medium text-c-text-primary">{t('owner.reports_soon_title')}</div>
                <div className="mx-auto mt-1.5 max-w-xs text-[13px] text-c-text-tertiary">{t('owner.reports_soon_body')}</div>
              </div>
            )}
            {tab === 'spaces' && communityId != null && <SpacesTab communityId={communityId} />}
          </>
        )}
      </div>
    </div>
  )
}
