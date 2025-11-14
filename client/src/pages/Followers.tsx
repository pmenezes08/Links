import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { useHeader } from '../contexts/HeaderContext'

type FollowEntry = {
  username: string
  display_name?: string
  profile_picture?: string | null
  status?: string | null
  created_at?: string | null
}

type FollowSummary = {
  followers: number
  following: number
  requests: number
}

const TAB_DEFINITIONS = [
  { key: 'followers', label: 'Followers' },
  { key: 'following', label: 'Following' },
  { key: 'requests', label: 'Follow Requests' },
] as const

type TabKey = (typeof TAB_DEFINITIONS)[number]['key']

const DEFAULT_SUMMARY: FollowSummary = { followers: 0, following: 0, requests: 0 }

function normalizeTab(value: string | null | undefined): TabKey {
  if (!value) return 'followers'
  const match = TAB_DEFINITIONS.find(def => def.key === value.toLowerCase())
  return match ? match.key : 'followers'
}

function formatRelative(value?: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const diffSeconds = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diffSeconds < 60) return 'just now'
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`
  if (diffSeconds < 604800) return `${Math.floor(diffSeconds / 86400)}d ago`
  return d.toLocaleDateString()
}

function normalizeAvatar(pic?: string | null): string | undefined {
  if (!pic) return undefined
  if (pic.startsWith('http') || pic.startsWith('/')) return pic
  return `/static/${pic}`
}

export default function Followers() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = useMemo(() => normalizeTab(searchParams.get('tab')), [searchParams])

  const [activeTab, setActiveTab] = useState<TabKey>(initialTab)
  const [items, setItems] = useState<FollowEntry[]>([])
  const [counts, setCounts] = useState<FollowSummary>(DEFAULT_SUMMARY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => {
    setTitle('Followers')
  }, [setTitle])

  useEffect(() => {
    setSearchParams({ tab: activeTab }, { replace: true })
  }, [activeTab, setSearchParams])

  useEffect(() => {
    let cancelled = false
    async function load(tab: TabKey) {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/followers?tab=${tab}`, { credentials: 'include' })
        const data = await response.json().catch(() => null)
        if (cancelled) return
        if (data?.success) {
          const list = (Array.isArray(data.items) ? data.items : []) as FollowEntry[]
          setItems(
            list
              .filter((entry) => entry && typeof entry.username === 'string')
              .map((entry) => ({
                username: entry.username,
                display_name: entry.display_name || entry.username,
                profile_picture: entry.profile_picture || null,
                status: entry.status,
                created_at: entry.created_at || null,
              })),
          )
          const nextCounts = data.counts || {}
          setCounts({
            followers: Number(nextCounts.followers ?? 0),
            following: Number(nextCounts.following ?? 0),
            requests: Number(nextCounts.requests ?? 0),
          })
        } else {
          setError(data?.error || 'Failed to load followers')
          setItems([])
        }
      } catch (err) {
        console.error('Failed loading followers tab', err)
        if (!cancelled) {
          setError('Failed to load followers')
          setItems([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load(activeTab)
    return () => {
      cancelled = true
    }
  }, [activeTab])

  const updateCounts = (next: Partial<FollowSummary>) => {
    setCounts(prev => ({
      followers: Number(next.followers ?? prev.followers ?? 0),
      following: Number(next.following ?? prev.following ?? 0),
      requests: Number(next.requests ?? prev.requests ?? 0),
    }))
  }

  const handleAccept = async (username: string) => {
    if (!username) return
    const key = `accept:${username.toLowerCase()}`
    if (actionLoading === key) return
    setActionLoading(key)
    try {
      const resp = await fetch(`/api/follow_requests/${encodeURIComponent(username)}/accept`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await resp.json().catch(() => null)
      if (data?.success) {
        if (data.counts) updateCounts(data.counts as FollowSummary)
        setItems(prev => prev.filter(item => item.username.toLowerCase() !== username.toLowerCase()))
      } else {
        alert(data?.error || 'Unable to accept follow request')
      }
    } catch (err) {
      console.error('Accept follow request failed', err)
      alert('Unable to accept follow request. Please try again.')
    } finally {
      setActionLoading(null)
    }
  }

  const handleDecline = async (username: string) => {
    if (!username) return
    const key = `decline:${username.toLowerCase()}`
    if (actionLoading === key) return
    setActionLoading(key)
    try {
      const resp = await fetch(`/api/follow_requests/${encodeURIComponent(username)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await resp.json().catch(() => null)
      if (data?.success) {
        if (data.counts) updateCounts(data.counts as FollowSummary)
        setItems(prev => prev.filter(item => item.username.toLowerCase() !== username.toLowerCase()))
      } else {
        alert(data?.error || 'Unable to decline follow request')
      }
    } catch (err) {
      console.error('Decline follow request failed', err)
      alert('Unable to decline follow request. Please try again.')
    } finally {
      setActionLoading(null)
    }
  }

  const renderEmptyState = () => {
    if (loading) {
      return <div className="text-[#9fb0b5]">Loading…</div>
    }
    if (error) {
      return <div className="text-red-400">{error}</div>
    }
    switch (activeTab) {
      case 'followers':
        return <div className="text-[#9fb0b5]">No followers yet.</div>
      case 'following':
        return <div className="text-[#9fb0b5]">You are not following anyone yet.</div>
      case 'requests':
        return <div className="text-[#9fb0b5]">No pending follow requests.</div>
      default:
        return null
    }
  }

  return (
    <div className="min-h-screen bg-black text-white pt-16 pb-12">
      <div className="max-w-2xl mx-auto px-4 space-y-6">
        <header className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold">Followers</h1>
          <div className="flex gap-2">
            {TAB_DEFINITIONS.map(def => {
              const isActive = def.key === activeTab
              const countValue =
                def.key === 'followers'
                  ? counts.followers
                  : def.key === 'following'
                    ? counts.following
                    : counts.requests
              return (
                <button
                  key={def.key}
                  className={
                    isActive
                      ? 'flex-1 rounded-full border border-[#4db6ac] bg-[#4db6ac] text-black font-semibold py-2'
                      : 'flex-1 rounded-full border border-white/15 bg-white/5 text-[#9fb0b5] py-2 hover:border-white/30'
                  }
                  onClick={() => {
                    if (!isActive) setActiveTab(def.key)
                  }}
                >
                  {def.label}
                  <span className="ml-2 text-sm font-normal text-[#9fb0b5]">
                    {countValue}
                  </span>
                </button>
              )
            })}
          </div>
        </header>

        <section className="rounded-2xl border border-white/10 bg-[#040708]">
          <div className="p-4 space-y-3">
            {loading && items.length === 0 ? (
              <div className="text-[#9fb0b5]">Loading…</div>
            ) : error ? (
              <div className="text-red-400">{error}</div>
            ) : items.length === 0 ? (
              renderEmptyState()
            ) : (
              <div className="flex flex-col gap-3">
                {items.map(entry => {
                  const actionKeyAccept = `accept:${entry.username.toLowerCase()}`
                  const actionKeyDecline = `decline:${entry.username.toLowerCase()}`
                  const isAccepting = actionLoading === actionKeyAccept
                  const isDeclining = actionLoading === actionKeyDecline
                  return (
                    <div
                      key={entry.username}
                      className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/40 p-3"
                    >
                      <Avatar username={entry.username} url={normalizeAvatar(entry.profile_picture)} size={48} />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate">{entry.display_name || entry.username}</div>
                        <div className="text-sm text-[#9fb0b5] truncate">@{entry.username}</div>
                        {entry.created_at ? (
                          <div className="text-xs text-[#6f7c81] mt-0.5">
                            {activeTab === 'requests' ? 'Requested' : 'Since'} {formatRelative(entry.created_at)}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
                        <button
                          className="px-3 py-1.5 rounded-md border border-white/15 text-sm hover:bg-white/10"
                          onClick={() => navigate(`/profile/${encodeURIComponent(entry.username)}`)}
                        >
                          View profile
                        </button>
                        {activeTab === 'requests' ? (
                          <>
                            <button
                              className="px-3 py-1.5 rounded-md bg-[#4db6ac] text-black text-sm font-semibold hover:brightness-110 disabled:opacity-60"
                              disabled={isAccepting}
                              onClick={() => handleAccept(entry.username)}
                            >
                              {isAccepting ? 'Accepting…' : 'Accept'}
                            </button>
                            <button
                              className="px-3 py-1.5 rounded-md border border-white/15 text-sm hover:bg-white/10 disabled:opacity-60"
                              disabled={isDeclining}
                              onClick={() => handleDecline(entry.username)}
                            >
                              {isDeclining ? 'Declining…' : 'Decline'}
                            </button>
                          </>
                        ) : (
                          <button
                            className="px-3 py-1.5 rounded-md border border-white/15 text-sm hover:bg-white/10"
                            onClick={() => navigate(`/user_chat/chat/${encodeURIComponent(entry.username)}`)}
                          >
                            Message
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
