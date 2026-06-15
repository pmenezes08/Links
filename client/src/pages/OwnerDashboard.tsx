import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import OverviewTab from '../components/owner/OverviewTab'
import SpacesTab from '../components/owner/SpacesTab'
import ReportsTab from '../components/owner/ReportsTab'
import CommunitySwitcher from '../components/owner/CommunitySwitcher'
import type { OwnerOverview, OwnerManagedCommunity, OwnerScope } from '../components/owner/types'

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

function ScopeChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-[11px] ${
        active ? 'bg-cpoint-turquoise text-[#063b39]' : 'border border-c-border text-c-text-secondary'
      }`}
    >
      {children}
    </button>
  )
}

function NetworkLockedCard({ teaser, onUpgrade }: { teaser: number | null; onUpgrade: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onUpgrade}
      className="mb-3.5 w-full rounded-2xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/[0.06] p-4 text-left"
    >
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cpoint-turquoise">
        <i className="fa-solid fa-lock text-[11px]" />
        {t('owner.scope_network')}
      </div>
      {typeof teaser === 'number' && (
        <div className="mt-1.5 text-[15px] text-c-text-primary">{t('owner.network_teaser', { count: teaser })}</div>
      )}
      <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-cpoint-turquoise">
        {t('owner.locked_cta')}
        <i className="fa-solid fa-chevron-right text-[9px]" />
      </div>
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
  const [managed, setManaged] = useState<OwnerManagedCommunity[]>([])
  const [scope, setScope] = useState<OwnerScope>('network')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let mounted = true
    fetch('/api/owner/communities', { credentials: 'include', headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(j => { if (mounted && Array.isArray(j?.communities)) setManaged(j.communities) })
      .catch(() => {})
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!communityId) return
    let mounted = true
    setLoading(true)
    setError(false)
    fetch(`/api/community/${communityId}/analytics/overview?scope=${scope}`, {
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
  }, [communityId, scope])

  const changeTab = (next: Tab) => {
    setTab(next)
    const sp = new URLSearchParams(searchParams)
    sp.set('tab', next)
    setSearchParams(sp, { replace: true })
  }

  const onUpgrade = () => navigate('/subscription_plans')

  return (
    <div className="min-h-screen bg-c-bg-app text-c-text-primary">
      {/* No safe-area padding here: the global <main> already offsets content
          below the fixed HeaderBar + notch via --app-header-offset. Re-adding
          env(safe-area-inset-top) double-counts the inset and opens a gap
          between the global header and this sub-header. */}
      <div
        className="sticky top-0 z-10 flex items-center gap-3 border-b border-c-border bg-c-bg-app/80 px-4 py-3 backdrop-blur"
      >
        <button type="button" onClick={() => navigate(-1)} aria-label={t('navigation.back')} className="text-c-text-secondary">
          <i className="fa-solid fa-chevron-left" />
        </button>
        <CommunitySwitcher
          communities={managed}
          currentId={communityId}
          fallbackName={data?.community?.name || t('owner.header')}
        />
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

      <div className="mx-auto max-w-2xl px-3 pt-2 pb-4">
        {loading && <div className="py-10 text-center text-sm text-c-text-tertiary">…</div>}

        {error && !loading && (
          <div className="py-10 text-center text-sm text-c-text-secondary">{t('owner.error')}</div>
        )}

        {!loading && !error && data && (
          <>
            {tab === 'overview' && (
              <>
                {data.network?.available && (
                  <div className="mb-3.5 flex gap-2">
                    <ScopeChip active={scope === 'network'} onClick={() => setScope('network')}>{t('owner.scope_network')}</ScopeChip>
                    <ScopeChip active={scope === 'self'} onClick={() => setScope('self')}>{t('owner.scope_self')}</ScopeChip>
                  </div>
                )}
                {data.network?.locked && scope === 'network' && (
                  <NetworkLockedCard teaser={data.network.teaser_members} onUpgrade={onUpgrade} />
                )}
                <OverviewTab data={data} onUpgrade={onUpgrade} />
              </>
            )}
            {tab === 'reports' && communityId != null && <ReportsTab communityId={communityId} />}
            {tab === 'spaces' && communityId != null && <SpacesTab communityId={communityId} />}
          </>
        )}
      </div>
    </div>
  )
}
