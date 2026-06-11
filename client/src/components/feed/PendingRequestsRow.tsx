import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import Avatar from '../Avatar'

/**
 * Admin-only "people at the door" row at the top of the community feed.
 * Count-gated: renders nothing for members, nothing at zero pending —
 * zero permanent chrome. A door, not a console: tapping navigates to the
 * Notifications inbox where the accept/decline logic lives in one place.
 */
export default function PendingRequestsRow({
  communityId,
  isAdmin,
}: {
  communityId: number | string
  isAdmin: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [count, setCount] = useState(0)
  const [requesters, setRequesters] = useState<Array<{ username: string; profile_picture?: string | null }>>([])

  useEffect(() => {
    if (!isAdmin) return
    let mounted = true
    fetch(`/api/community/${communityId}/join_requests/count`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(r => r.json())
      .then(data => {
        if (!mounted || !data?.success) return
        setCount(Number(data.count) || 0)
        setRequesters(Array.isArray(data.requesters) ? data.requesters : [])
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [communityId, isAdmin])

  if (!isAdmin || count <= 0) return null

  return (
    <button
      type="button"
      onClick={() => navigate('/notifications?tab=invites')}
      aria-label={t('feed.pending_requests_aria')}
      className="flex h-11 w-full items-center gap-3 rounded-2xl border border-c-border bg-c-bg-elevated px-3 text-left transition hover:bg-c-hover-bg active:scale-[0.99]"
    >
      <span className="flex -space-x-1.5">
        {requesters.slice(0, 3).map(r => (
          <span key={r.username} className="rounded-full ring-2 ring-c-bg-elevated">
            <Avatar username={r.username} url={r.profile_picture || undefined} size={20} />
          </span>
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-c-text-primary">
        {t(count === 1 ? 'feed.pending_requests_one' : 'feed.pending_requests_other', { count })}
      </span>
      <i className="fa-solid fa-chevron-right text-xs text-c-text-tertiary" aria-hidden="true" />
    </button>
  )
}
