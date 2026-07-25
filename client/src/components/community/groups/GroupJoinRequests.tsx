import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type PendingRequest = { username: string; requested_at: string | null }

/**
 * Inline approve/deny panel for an approval-required group's pending join
 * requests. Rendered expanded under the owner's GroupCard.
 */
export default function GroupJoinRequests({
  groupId,
  onDecided,
  onError,
}: {
  groupId: number
  /** Called after any approve/deny so the parent can refresh counts. */
  onDecided: () => void
  onError: (message: string) => void
}) {
  const { t } = useTranslation()
  const [requests, setRequests] = useState<PendingRequest[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(`/api/groups/${groupId}/requests`, { credentials: 'include', headers: { Accept: 'application/json' } })
        const j = await r.json().catch(() => null)
        if (alive) setRequests(j?.success ? j.requests || [] : [])
      } catch {
        if (alive) setRequests([])
      }
    })()
    return () => { alive = false }
  }, [groupId])

  const decide = async (username: string, decision: 'approve' | 'deny') => {
    setBusy(username)
    try {
      const r = await fetch(`/api/groups/${groupId}/requests/decide`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, decision }),
      })
      const j = await r.json().catch(() => null)
      if (j?.success) {
        setRequests(prev => (prev || []).filter(p => p.username !== username))
        onDecided()
      } else {
        onError(j?.error || t('communities.group_request_failed'))
      }
    } catch {
      onError(t('communities.network_error'))
    } finally {
      setBusy(null)
    }
  }

  if (requests === null) {
    return <div className="px-4 py-2 text-[11px] text-c-text-tertiary">{t('communities.loading')}</div>
  }
  if (!requests.length) {
    return <div className="px-4 py-2 text-[11px] text-c-text-tertiary">{t('communities.group_requests_none')}</div>
  }
  return (
    <div className="px-3 pb-2 space-y-1">
      {requests.map(req => (
        <div key={req.username} className="flex items-center gap-2 rounded-lg bg-c-hover-bg px-3 py-2">
          <span className="flex-1 min-w-0 truncate text-xs text-c-text-primary">@{req.username}</span>
          <button
            type="button"
            disabled={busy === req.username}
            className="h-8 px-3 rounded-lg bg-cpoint-turquoise/15 text-cpoint-turquoise text-xs font-medium hover:bg-cpoint-turquoise/25 disabled:opacity-50"
            onClick={() => decide(req.username, 'approve')}
          >
            {t('communities.group_request_approve')}
          </button>
          <button
            type="button"
            disabled={busy === req.username}
            className="h-8 px-3 rounded-lg border border-c-border text-c-text-tertiary text-xs font-medium hover:bg-c-hover-bg disabled:opacity-50"
            onClick={() => decide(req.username, 'deny')}
          >
            {t('communities.group_request_deny')}
          </button>
        </div>
      ))}
    </div>
  )
}
