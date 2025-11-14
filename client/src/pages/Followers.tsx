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

type FollowersActivity = {
  authored?: boolean
  reacted_by?: string[]
  replied_by?: string[]
}

type FollowersFeedPost = {
  id: number
  username: string
  content?: string | null
  image_path?: string | null
  video_path?: string | null
  timestamp?: string | null
  display_timestamp?: string | null
  profile_picture?: string | null
  community_name?: string | null
  followers_activity?: FollowersActivity
}

const TAB_DEFINITIONS = [
  { key: 'followers', label: 'Followers' },
  { key: 'following', label: 'Following' },
  { key: 'requests', label: 'Requests' },
] as const

const SECTION_DEFINITIONS = [
  { key: 'manage', label: 'Manage Followers' },
  { key: 'feed', label: 'Followers Feed' },
] as const

type TabKey = (typeof TAB_DEFINITIONS)[number]['key']
type SectionKey = (typeof SECTION_DEFINITIONS)[number]['key']

const DEFAULT_SUMMARY: FollowSummary = { followers: 0, following: 0, requests: 0 }
const TAB_BUTTON_BASE =
  'inline-flex w-full items-center justify-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40'

function normalizeTab(value: string | null | undefined): TabKey {
  if (!value) return 'followers'
  const match = TAB_DEFINITIONS.find(def => def.key === value.toLowerCase())
  return match ? match.key : 'followers'
}

function normalizeSection(value: string | null | undefined): SectionKey {
  if (!value) return 'manage'
  const match = SECTION_DEFINITIONS.find(def => def.key === value.toLowerCase())
  return match ? match.key : 'manage'
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

function formatNameList(names?: string[], limit = 2): string {
  if (!names || names.length === 0) return ''
  const unique = Array.from(new Set(names.map(name => name?.trim()).filter(Boolean))) as string[]
  if (unique.length === 0) return ''
  if (unique.length <= limit) return unique.join(', ')
  const remaining = unique.length - limit
  return `${unique.slice(0, limit).join(', ')} +${remaining}`
}

function normalizeMediaPath(path?: string | null): string | undefined {
  if (!path) return undefined
  const clean = path.trim()
  if (!clean) return undefined
  if (clean.startsWith('http://') || clean.startsWith('https://')) return clean
  if (clean.startsWith('/')) return clean
  if (clean.startsWith('uploads') || clean.startsWith('static')) return `/${clean}`
  return `/uploads/${clean}`
}

export default function Followers() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = useMemo(() => normalizeTab(searchParams.get('tab')), [searchParams])
  const initialSection = useMemo(() => normalizeSection(searchParams.get('section')), [searchParams])

  const [activeTab, setActiveTab] = useState<TabKey>(initialTab)
  const [activeSection, setActiveSection] = useState<SectionKey>(initialSection)
  const [items, setItems] = useState<FollowEntry[]>([])
  const [counts, setCounts] = useState<FollowSummary>(DEFAULT_SUMMARY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [feedPosts, setFeedPosts] = useState<FollowersFeedPost[]>([])
  const [feedLoading, setFeedLoading] = useState(true)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [feedRefreshKey, setFeedRefreshKey] = useState(0)

  useEffect(() => {
    setTitle('Followers')
  }, [setTitle])

  useEffect(() => {
    const params = new URLSearchParams()
    params.set('tab', activeTab)
    params.set('section', activeSection)
    setSearchParams(params, { replace: true })
  }, [activeTab, activeSection, setSearchParams])

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

  useEffect(() => {
    let cancelled = false
    async function loadFeed() {
      setFeedLoading(true)
      setFeedError(null)
      try {
        const resp = await fetch('/api/followers_feed', { credentials: 'include' })
        const data = await resp.json().catch(() => null)
        if (cancelled) return
        if (data?.success) {
          setFeedPosts(Array.isArray(data.posts) ? (data.posts as FollowersFeedPost[]) : [])
        } else {
          setFeedError(data?.error || 'Failed to load followers feed')
          setFeedPosts([])
        }
      } catch (err) {
        console.error('Failed loading followers feed', err)
        if (!cancelled) {
          setFeedError('Failed to load followers feed')
          setFeedPosts([])
        }
      } finally {
        if (!cancelled) setFeedLoading(false)
      }
    }
    loadFeed()
    return () => {
      cancelled = true
    }
  }, [feedRefreshKey])

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

  const renderRequestsList = () => (
    <ul className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/[0.02]">
      {items.map(entry => {
        const actionKeyAccept = `accept:${entry.username.toLowerCase()}`
        const actionKeyDecline = `decline:${entry.username.toLowerCase()}`
        const isAccepting = actionLoading === actionKeyAccept
        const isDeclining = actionLoading === actionKeyDecline
        return (
          <li key={entry.username} className="flex items-center gap-3 px-3.5 py-2.5">
            <Avatar username={entry.username} url={normalizeAvatar(entry.profile_picture)} size={40} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate text-white">
                {entry.display_name || entry.username}
                <span className="ml-1 text-xs font-normal text-[#6f7c81]">@{entry.username}</span>
              </div>
              {entry.created_at ? (
                <div className="text-xs text-[#6f7c81]">Requested {formatRelative(entry.created_at)}</div>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                className="h-8 rounded-full bg-[#4db6ac] px-3 text-xs font-semibold text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isAccepting}
                onClick={() => handleAccept(entry.username)}
              >
                {isAccepting ? 'Accepting…' : 'Accept'}
              </button>
              <button
                className="h-8 rounded-full border border-white/20 px-3 text-xs font-medium text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isDeclining}
                onClick={() => handleDecline(entry.username)}
              >
                {isDeclining ? 'Declining…' : 'Decline'}
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )

  const renderPeopleList = () => (
    <div className="flex flex-col gap-2.5">
      {items.map(entry => (
        <div
          key={entry.username}
          className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2.5"
        >
          <Avatar username={entry.username} url={normalizeAvatar(entry.profile_picture)} size={44} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate text-white">{entry.display_name || entry.username}</div>
            <div className="text-xs text-[#6f7c81]">@{entry.username}</div>
            {entry.created_at ? (
              <div className="text-xs text-[#6f7c81] mt-0.5">
                {activeTab === 'followers' ? 'Following since' : 'Since'} {formatRelative(entry.created_at)}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col items-stretch gap-1.5 sm:flex-row sm:items-center">
            <button
              className="rounded-full border border-white/15 px-3 py-1 text-xs font-medium text-white hover:border-white/40"
              onClick={() => navigate(`/profile/${encodeURIComponent(entry.username)}`)}
            >
              View
            </button>
            <button
              className="rounded-full border border-white/15 px-3 py-1 text-xs font-medium text-white hover:border-white/40"
              onClick={() => navigate(`/user_chat/chat/${encodeURIComponent(entry.username)}`)}
            >
              Message
            </button>
          </div>
        </div>
      ))}
    </div>
  )
  
  const renderManageSection = () => (
    <section
      id="manage-followers"
      className="rounded-xl border border-white/10 bg-black p-3 space-y-2.5"
    >
      <div className="space-y-2">
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8ca0a8]">Manage Followers</p>
          <h1 className="text-xl font-semibold tracking-tight text-white">Stay in control of your network</h1>
          <p className="text-[13px] leading-relaxed text-[#a7b8be]">
            Approve follow requests, review your followers, and keep tabs on who you follow.
          </p>
          <div className="text-[11px] text-[#6f7c81]">
            {counts.followers} followers · {counts.following} following · {counts.requests} requests
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {TAB_DEFINITIONS.map(def => {
            const isActive = def.key === activeTab
            const countValue =
              def.key === 'followers'
                ? counts.followers
                : def.key === 'following'
                  ? counts.following
                  : counts.requests
            const activeClasses = isActive
              ? 'border-white bg-white text-black shadow-[0_8px_20px_rgba(255,255,255,0.18)]'
              : 'border-white/15 text-[#9fb0b5] hover:border-white/35 hover:text-white'
            return (
              <button
                key={def.key}
                className={`${TAB_BUTTON_BASE} ${activeClasses}`}
                onClick={() => {
                  if (!isActive) setActiveTab(def.key)
                }}
              >
                <span>{def.label}</span>
                <span
                  className={`ml-1 rounded-full px-1 py-0.5 text-[9px] ${isActive ? 'text-black/60' : 'text-[#8ca0a8]'}`}
                >
                  {countValue}
                </span>
              </button>
            )
          })}
        </div>

        <div className="rounded-xl border border-white/10 bg-black/50 p-3">
          {loading && items.length === 0 ? (
            <div className="text-[#9fb0b5]">Loading…</div>
          ) : error ? (
            <div className="text-red-400">{error}</div>
          ) : items.length === 0 ? (
            renderEmptyState()
          ) : activeTab === 'requests' ? (
            renderRequestsList()
          ) : (
            renderPeopleList()
          )}
        </div>
      </div>
    </section>
  )

  const renderFeedSection = () => (
    <section
      id="followers-feed"
      className="rounded-xl border border-white/10 bg-black p-3 space-y-2.5"
    >
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8ca0a8]">Followers Feed</p>
          <h2 className="text-xl font-semibold text-white">See what your circle is up to</h2>
          <p className="text-[13px] text-[#a7b8be]">
            Browse posts your followers created or recently reacted to.
          </p>
        </div>
        <button
          className="self-start rounded-full border border-white/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white hover:border-white/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-60"
          onClick={() => setFeedRefreshKey(prev => prev + 1)}
          disabled={feedLoading}
        >
          Refresh
        </button>
      </div>

      <div className="mt-3">
        {feedLoading ? (
          <div className="text-[#9fb0b5]">Loading feed…</div>
        ) : feedError ? (
          <div className="text-red-400">{feedError}</div>
        ) : feedPosts.length === 0 ? (
          <div className="text-[#9fb0b5]">No recent activity from the people you follow.</div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {feedPosts.map(post => {
              const timestamp = post.display_timestamp || post.timestamp
              const content = (post.content || '').trim()
              const badges: string[] = []
              if (post.followers_activity?.authored) {
                badges.push(`${post.username} shared this`)
              }
              if (post.followers_activity?.reacted_by?.length) {
                const formatted = formatNameList(post.followers_activity.reacted_by)
                if (formatted) badges.push(`Reacted by ${formatted}`)
              }
              if (post.followers_activity?.replied_by?.length) {
                const formatted = formatNameList(post.followers_activity.replied_by)
                if (formatted) badges.push(`Replied by ${formatted}`)
              }
              const image = normalizeMediaPath(post.image_path || undefined)
              const video = normalizeMediaPath(post.video_path || undefined)
              return (
                <article key={post.id} className="rounded-xl border border-white/10 bg-black/50 p-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar username={post.username} url={normalizeAvatar(post.profile_picture)} size={36} />
                    <div className="min-w-0 flex-1">
                      <button
                        className="text-left text-[13px] font-semibold text-white hover:underline"
                        onClick={() => navigate(`/profile/${encodeURIComponent(post.username)}`)}
                      >
                        {post.username}
                      </button>
                      {post.community_name ? (
                        <div className="text-[11px] text-[#9fb0b5]">in {post.community_name}</div>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-[#7d8a91] whitespace-nowrap">{formatRelative(timestamp)}</div>
                  </div>
                  {badges.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {badges.map(badge => (
                        <span key={badge} className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-[#9fb0b5]">
                          {badge}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {content && (
                    <div className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-white/90">
                      {content}
                    </div>
                  )}
                  {image ? (
                    <img
                      src={image}
                      alt="Post attachment"
                      className="mt-2.5 max-h-56 w-full rounded-lg border border-white/10 object-cover"
                      loading="lazy"
                    />
                  ) : null}
                  {video ? (
                    <video
                      className="mt-2.5 w-full rounded-lg border border-white/10 bg-black"
                      src={video}
                      controls
                      playsInline
                    />
                  ) : null}
                  <div className="mt-2.5 flex flex-wrap gap-2 text-[11px] text-[#9fb0b5]">
                    <button className="font-semibold text-[#4db6ac] hover:underline" onClick={() => navigate(`/post/${post.id}`)}>
                      View post →
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )

  return (
    <div className="h-screen overflow-hidden bg-black text-white">
      <div className="fixed left-0 right-0 top-14 h-10 bg-black/70 backdrop-blur z-40">
        <div className="max-w-3xl mx-auto h-full flex items-center px-2">
          <div className="flex-1 h-full flex">
            {SECTION_DEFINITIONS.map(section => {
              const isActive = section.key === activeSection
              return (
                <button
                  key={section.key}
                  type="button"
                  className={`flex-1 text-center text-sm font-medium ${
                    isActive ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'
                  }`}
                  onClick={() => setActiveSection(section.key)}
                >
                  <div className="pt-2">{section.label}</div>
                  <div
                    className={`h-0.5 rounded-full w-20 mx-auto mt-1 ${
                      isActive ? 'bg-[#4db6ac]' : 'bg-transparent'
                    }`}
                  />
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div
        className="max-w-3xl mx-auto pt-[70px] h-[calc(100vh-70px)] px-1 sm:px-3 pb-2 overflow-y-auto overscroll-contain"
        style={{ WebkitOverflowScrolling: 'touch' as any }}
      >
        {activeSection === 'manage' ? (
          <div className="space-y-3">{renderManageSection()}</div>
        ) : (
          <div className="space-y-3">{renderFeedSection()}</div>
        )}
      </div>
    </div>
  )
}
