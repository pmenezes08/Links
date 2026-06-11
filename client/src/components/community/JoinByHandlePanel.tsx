import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { normalizeHandleInput } from './HandleSettings'

/**
 * Find a community by its @handle and ask to join — the knock on the
 * door. Exact-match only: the not-found state is one neutral line,
 * identical for nonexistent and non-findable handles (the server
 * guarantees the responses match; this component guarantees the pixels
 * do). The pending state never promises a reply — declines are silent
 * by design, so the copy only commits to the positive path.
 */

type FoundCommunity = {
  id: number
  name: string
  handle: string
  description: string
  member_bucket: string
  already_member: boolean
  request_status: 'pending' | null
}

export default function JoinByHandlePanel({ onJoinedNavigate }: { onJoinedNavigate?: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [found, setFound] = useState<FoundCommunity | null>(null)
  const [requesting, setRequesting] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  const runLookup = useCallback((handle: string) => {
    setSearching(true)
    setNotFound(false)
    fetch(`/api/community/by_handle/${encodeURIComponent(handle)}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(r => r.json())
      .then(data => {
        setQuery(current => {
          if (current === handle) {
            if (data?.success && data.community) {
              setFound(data.community)
              setNotFound(false)
            } else {
              setFound(null)
              setNotFound(true)
            }
          }
          return current
        })
      })
      .catch(() => setNotFound(false))
      .finally(() => setSearching(false))
  }, [])

  const onQueryChange = useCallback(
    (raw: string) => {
      const normalized = normalizeHandleInput(raw)
      setQuery(normalized)
      setFound(null)
      setNotFound(false)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (normalized.length < 3) return
      debounceRef.current = setTimeout(() => runLookup(normalized), 400)
    },
    [runLookup],
  )

  const askToJoin = useCallback(() => {
    if (!found || requesting) return
    setRequesting(true)
    fetch(`/api/community/${found.id}/join_requests`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(r => r.json())
      .then(data => {
        if (data?.success) {
          setFound(prev => (prev ? { ...prev, request_status: 'pending' } : prev))
        }
      })
      .catch(() => {})
      .finally(() => setRequesting(false))
  }, [found, requesting])

  const withdraw = useCallback(() => {
    if (!found) return
    fetch(`/api/community/${found.id}/join_requests/mine`, {
      method: 'DELETE',
      credentials: 'include',
    })
      .then(r => r.json())
      .then(data => {
        if (data?.success) {
          setFound(prev => (prev ? { ...prev, request_status: null } : prev))
        }
      })
      .catch(() => {})
  }, [found])

  return (
    <div className="space-y-2">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-c-text-tertiary text-sm">@</span>
        <input
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          placeholder={t('communities.find_placeholder')}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          className="w-full pl-7 pr-3 py-2 rounded-md bg-c-bg-app border border-c-border text-sm text-c-text-primary focus:border-cpoint-turquoise outline-none"
        />
      </div>
      {!found && !notFound && (
        <p className="text-[11px] text-c-text-tertiary">
          {searching ? t('communities.handle_checking') : t('communities.find_helper')}
        </p>
      )}
      {notFound && (
        <p className="text-[11px] text-c-text-tertiary">
          {t('communities.find_not_found', { handle: query })}
        </p>
      )}
      {found && (
        <div className="rounded-xl border border-c-border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-c-text-primary truncate">{found.name}</div>
              <div className="text-xs text-c-text-tertiary truncate">
                @{found.handle} · {t('communities.member_bucket', { bucket: found.member_bucket })}
              </div>
            </div>
          </div>
          {found.description && (
            <p className="text-xs text-c-text-secondary line-clamp-2">{found.description}</p>
          )}
          {found.already_member ? (
            <button
              type="button"
              onClick={() => {
                onJoinedNavigate?.()
                navigate(`/community_feed_react/${found.id}`)
              }}
              className="h-11 w-full rounded-full border border-cpoint-turquoise/30 text-sm font-semibold text-c-accent-ink transition hover:bg-cpoint-turquoise/10"
            >
              {t('communities.find_open')}
            </button>
          ) : found.request_status === 'pending' ? (
            <div className="space-y-1.5">
              <div className="flex h-11 w-full items-center justify-center rounded-full border border-c-border text-sm font-medium text-c-text-secondary">
                {t('communities.find_requested')}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-c-text-tertiary">{t('communities.find_pending_hint')}</span>
                <button
                  type="button"
                  onClick={withdraw}
                  className="text-[11px] font-medium text-c-text-tertiary transition hover:text-c-text-primary"
                >
                  {t('communities.find_withdraw')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={askToJoin}
              disabled={requesting}
              className="h-11 w-full rounded-full bg-cpoint-turquoise text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {requesting ? t('notifications_page.working') : t('communities.find_ask_to_join')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
