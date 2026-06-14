import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { OwnerSpaces } from './types'

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-cpoint-turquoise">
      {children}
    </div>
  )
}

function Row({ name, meta, onClick }: { name: string; meta?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition-colors hover:bg-c-hover-bg"
    >
      <span className="min-w-0 truncate text-c-text-primary">{name}</span>
      <span className="flex shrink-0 items-center gap-2 text-c-text-tertiary">
        {meta && <span className="text-[11px]">{meta}</span>}
        <i className="fa-solid fa-chevron-right text-xs" />
      </span>
    </button>
  )
}

/** Sub-communities + groups under the community — tap a row to go straight in. */
export default function SpacesTab({ communityId }: { communityId: number }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [data, setData] = useState<OwnerSpaces | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    fetch(`/api/community/${communityId}/analytics/spaces`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(r => r.json())
      .then(j => { if (mounted) { setData(j); setLoading(false) } })
      .catch(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [communityId])

  if (loading) return <div className="py-10 text-center text-sm text-c-text-tertiary">…</div>

  const subs = data?.subcommunities ?? []
  const groups = data?.groups ?? []
  if (subs.length === 0 && groups.length === 0) {
    return <div className="py-10 text-center text-sm text-c-text-tertiary">{t('owner.spaces_empty')}</div>
  }

  return (
    <div className="space-y-5">
      {subs.length > 0 && (
        <div>
          <SectionLabel>{t('owner.spaces_subcommunities')}</SectionLabel>
          <div className="space-y-1">
            {subs.map(s => (
              <Row
                key={s.id}
                name={s.name}
                meta={t('owner.spaces_members', { n: s.member_count })}
                onClick={() => navigate(`/community_feed_react/${s.id}`)}
              />
            ))}
          </div>
        </div>
      )}
      {groups.length > 0 && (
        <div>
          <SectionLabel>{t('owner.spaces_groups')}</SectionLabel>
          <div className="space-y-1">
            {groups.map(g => (
              <Row key={g.id} name={g.name} onClick={() => navigate(`/group_feed_react/${g.id}`)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
