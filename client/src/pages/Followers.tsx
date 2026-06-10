import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { useHeader } from '../contexts/HeaderContext'
import { SkeletonFollowerList } from '../components/SkeletonRow'

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

const TAB_KEYS = ['followers', 'following', 'requests'] as const
const SECTION_KEYS = ['manage', 'feed'] as const

type TabKey = (typeof TAB_KEYS)[number]
type SectionKey = (typeof SECTION_KEYS)[number]

const DEFAULT_SUMMARY: FollowSummary = { followers: 0, following: 0, requests: 0 }
const TAB_BUTTON_BASE =
  'inline-flex w-full items-center justify-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40'

function normalizeTab(value: string | null | undefined): TabKey {
  if (!value) return 'followers'
  const match = TAB_KEYS.find(key => key === value.toLowerCase())
  return match ?? 'followers'
}

function normalizeSection(value: string | null | undefined): SectionKey {
  if (!value) return 'manage'
  const match = SECTION_KEYS.find(key => key === value.toLowerCase())
  return match ?? 'manage'
}

function formatRelative(value: string | undefined | null, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const diffSeconds = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diffSeconds < 60) return t('time.just_now')
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m`
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h`
  if (diffSeconds < 604800) return `${Math.floor(diffSeconds / 86400)}d`
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
  const { t } = useTranslation()
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
    setTitle(t('profile.followers_page.page_title'))
  }, [setTitle, t])

  const tabLabel = (key: TabKey) => {
    if (key === 'followers') return t('profile.followers_page.tab_followers')
    if (key === 'following') return t('profile.followers_page.tab_following')
    return t('profile.followers_page.tab_requests')
  }

  const sectionLabel = (key: SectionKey) =>
    key === 'manage' ? t('profile.followers_page.section_manage') : t('profile.followers_page.section_feed')

  useEffect(() => {
    const params = new URLSearchParams()
    params.set('tab', activeTab)
    params.set('section', activeSection)
    setSearchParams(params, { replace: true })
  }, [activeTab, activeSection, setSearchParams])

  const activeTabRef = useRef(activeTab)

  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])

  useEffect(() => {
    const controller = new AbortController()
    let isCurrent = true
    async function load(tab: TabKey) {
      setLoading(true)
      setError(null)
      setItems([])
      try {
        const response = await fetch(`/api/followers?tab=${tab}`, {
          credentials: 'include',
          signal: controller.signal,
          headers: { 'Accept': 'application/json' },
        })
        const data = await response.json().catch(() => null)
        if (!isCurrent) return
        if (data?.success) {
          const list = (Array.isArray(data.items) ? data.items : []) as FollowEntry[]
          // Only apply results matching the latest selected tab
          if (tab !== activeTabRef.current) return
          setItems(
            list
              .filter(entry => entry && typeof entry.username === 'string')
              .map(entry => ({
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
          setError(data?.error || t('profile.followers_page.load_failed'))
          setItems([])
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        console.error('Failed loading followers tab', err)
        if (isCurrent) {
          setError(t('profile.followers_page.load_failed'))
          setItems([])
        }
      } finally {
        if (isCurrent) setLoading(false)
      }
    }
    load(activeTab)
    return () => {
      isCurrent = false
      controller.abort()
    }
  }, [activeTab])

  useEffect(() => {
    let cancelled = false
    async function loadFeed() {
      setFeedLoading(true)
      setFeedError(null)
      try {
        const resp = await fetch('/api/followers_feed', { credentials: 'include', headers: { 'Accept': 'application/json' } })
        const data = await resp.json().catch(() => null)
        if (cancelled) return
        if (data?.success) {
          setFeedPosts(Array.isArray(data.posts) ? (data.posts as FollowersFeedPost[]) : [])
        } else {
          setFeedError(data?.error || t('profile.followers_page.feed_load_failed'))
          setFeedPosts([])
        }
      } catch (err) {
        console.error('Failed loading followers feed', err)
        if (!cancelled) {
          setFeedError(t('profile.followers_page.feed_load_failed'))
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
        alert(data?.error || t('profile.followers_page.accept_failed'))
      }
    } catch (err) {
      console.error('Accept follow request failed', err)
      alert(t('profile.followers_page.accept_retry'))
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
        alert(data?.error || t('profile.followers_page.decline_failed'))
      }
    } catch (err) {
      console.error('Decline follow request failed', err)
      alert(t('profile.followers_page.decline_retry'))
    } finally {
      setActionLoading(null)
    }
  }

  const renderEmptyState = () => {
    if (loading) {
      return <SkeletonFollowerList />
    }
    if (error) {
      return <div className="text-red-400">{error}</div>
    }
    switch (activeTab) {
      case 'followers':
        return <div className="text-c-text-tertiary">{t('profile.no_followers')}</div>
      case 'following':
        return <div className="text-c-text-tertiary">{t('profile.followers_page.not_following_anyone')}</div>
      case 'requests':
        return <div className="text-c-text-tertiary">{t('profile.no_pending_requests')}</div>
      default:
        return null
    }
  }

  const renderRequestsList = () => (
              <ul className="divide-y divide-c-border rounded-xl border border-c-border bg-transparent">
      {items.map(entry => {
        const actionKeyAccept = `accept:${entry.username.toLowerCase()}`
        const actionKeyDecline = `decline:${entry.username.toLowerCase()}`
        const isAccepting = actionLoading === actionKeyAccept
        const isDeclining = actionLoading === actionKeyDecline
        return (
          <li key={entry.username} className="flex items-center gap-3 px-3.5 py-2.5">
            <Avatar username={entry.username} url={normalizeAvatar(entry.profile_picture)} size={40} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate text-c-text-primary">
                {entry.display_name || entry.username}
                <span className="ml-1 text-xs font-normal text-c-text-tertiary">@{entry.username}</span>
              </div>
              {entry.created_at ? (
                <div className="text-xs text-c-text-tertiary">
                  {t('profile.followers_page.requested', { time: formatRelative(entry.created_at, t) })}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                className="h-8 rounded-full bg-cpoint-turquoise px-3 text-xs font-semibold text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isAccepting}
                onClick={() => handleAccept(entry.username)}
              >
                {isAccepting ? t('profile.followers_page.accepting') : t('profile.followers_page.accept')}
              </button>
              <button
                className="h-8 rounded-full border border-c-border px-3 text-xs font-medium text-c-text-primary hover:bg-c-hover-bg disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isDeclining}
                onClick={() => handleDecline(entry.username)}
              >
                {isDeclining ? t('profile.followers_page.declining') : t('profile.followers_page.decline')}
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
              className="flex items-center gap-3 rounded-xl border border-c-border bg-transparent px-3.5 py-2.5"
        >
          <Avatar username={entry.username} url={normalizeAvatar(entry.profile_picture)} size={44} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate text-c-text-primary">{entry.display_name || entry.username}</div>
            <div className="text-xs text-c-text-tertiary">@{entry.username}</div>
            {entry.created_at ? (
              <div className="text-xs text-c-text-tertiary mt-0.5">
                {activeTab === 'followers'
                  ? t('profile.followers_page.following_since', { time: formatRelative(entry.created_at, t) })
                  : t('profile.followers_page.since', { time: formatRelative(entry.created_at, t) })}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col items-stretch gap-1.5 sm:flex-row sm:items-center">
            <button
              className="rounded-full border border-c-border px-3 py-1 text-xs font-medium text-c-text-primary hover:border-c-border"
              onClick={() => navigate(`/profile/${encodeURIComponent(entry.username)}`)}
            >
              {t('profile.view')}
            </button>
            <button
              className="rounded-full border border-c-border px-3 py-1 text-xs font-medium text-c-text-primary hover:border-c-border"
              onClick={() => navigate(`/user_chat/chat/${encodeURIComponent(entry.username)}`)}
            >
              {t('profile.message')}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
  
  const renderManageSection = () => (
    <section
      id="manage-followers"
      className="rounded-xl border border-c-border bg-c-bg-app p-3 space-y-2.5"
    >
      <div className="space-y-2">
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-c-text-tertiary">{t('profile.followers_page.section_manage')}</p>
          <h1 className="text-xl font-semibold tracking-tight text-c-text-primary">{t('profile.followers_page.manage_headline')}</h1>
          <p className="text-[13px] leading-relaxed text-c-text-secondary">{t('profile.followers_page.manage_subtitle')}</p>
          <div className="text-[11px] text-c-text-tertiary">
            {t('profile.followers_page.counts_summary', {
              followers: counts.followers,
              following: counts.following,
              requests: counts.requests,
            })}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {TAB_KEYS.map(key => {
            const isActive = key === activeTab
            const countValue =
              key === 'followers' ? counts.followers : key === 'following' ? counts.following : counts.requests
            const activeClasses = isActive
              ? 'border-cpoint-turquoise bg-cpoint-turquoise text-black'
              : 'border-c-border text-c-text-tertiary hover:border-c-border hover:text-c-text-primary'
            return (
              <button
                key={key}
                className={`${TAB_BUTTON_BASE} ${activeClasses}`}
                onClick={() => {
                  if (!isActive) setActiveTab(key)
                }}
              >
                <span>{tabLabel(key)}</span>
                <span
                  className={`ml-1 rounded-full px-1 py-0.5 text-[9px] ${isActive ? 'text-black/60' : 'text-c-text-tertiary'}`}
                >
                  {countValue}
                </span>
              </button>
            )
          })}
        </div>

        <div className="rounded-xl border border-c-border bg-c-bg-app p-3">
          {loading && items.length === 0 ? (
            <SkeletonFollowerList />
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
      className="rounded-xl border border-c-border bg-c-bg-app p-3 space-y-2.5"
    >
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-c-text-tertiary">{t('profile.followers_page.section_feed')}</p>
          <h2 className="text-xl font-semibold text-c-text-primary">{t('profile.followers_page.feed_headline')}</h2>
          <p className="text-[13px] text-c-text-secondary">{t('profile.followers_page.feed_subtitle')}</p>
        </div>
        <button
          className="self-start rounded-full border border-c-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-c-text-primary hover:border-c-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-c-border disabled:opacity-60"
          onClick={() => setFeedRefreshKey(prev => prev + 1)}
          disabled={feedLoading}
        >
          {t('profile.followers_page.refresh')}
        </button>
      </div>

      <div className="mt-3">
        {feedLoading ? (
          <div className="text-c-text-tertiary">{t('profile.followers_page.loading_feed')}</div>
        ) : feedError ? (
          <div className="text-red-400">{feedError}</div>
        ) : feedPosts.length === 0 ? (
          <div className="text-c-text-tertiary">{t('profile.no_recent_activity')}</div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {feedPosts.map(post => {
              const timestamp = post.display_timestamp || post.timestamp
              const content = (post.content || '').trim()
              const badges: string[] = []
              if (post.followers_activity?.authored) {
                badges.push(t('profile.followers_page.shared_this', { username: post.username }))
              }
              if (post.followers_activity?.reacted_by?.length) {
                const formatted = formatNameList(post.followers_activity.reacted_by)
                if (formatted) badges.push(t('profile.followers_page.reacted_by', { names: formatted }))
              }
              if (post.followers_activity?.replied_by?.length) {
                const formatted = formatNameList(post.followers_activity.replied_by)
                if (formatted) badges.push(t('profile.followers_page.replied_by', { names: formatted }))
              }
              const image = normalizeMediaPath(post.image_path || undefined)
              const video = normalizeMediaPath(post.video_path || undefined)
              return (
                <article key={post.id} className="rounded-xl border border-c-border bg-c-bg-app p-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar username={post.username} url={normalizeAvatar(post.profile_picture)} size={36} />
                    <div className="min-w-0 flex-1">
                      <button
                        className="text-left text-[13px] font-semibold text-c-text-primary hover:underline"
                        onClick={() => navigate(`/profile/${encodeURIComponent(post.username)}`)}
                      >
                        {post.username}
                      </button>
                      {post.community_name ? (
                        <div className="text-[11px] text-c-text-tertiary">{t('profile.followers_page.in_community', { name: post.community_name })}</div>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-c-text-tertiary whitespace-nowrap">{formatRelative(timestamp, t)}</div>
                  </div>
                  {badges.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {badges.map(badge => (
                        <span key={badge} className="rounded-full bg-c-hover-bg px-2 py-0.5 text-[10px] text-c-text-tertiary">
                          {badge}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {content && (
                    <div className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-c-text-primary">
                      {content}
                    </div>
                  )}
                  {image ? (
                    <img
                      src={image}
                      alt={t('profile.followers_page.post_attachment_alt')}
                      className="mt-2.5 max-h-56 w-full rounded-lg border border-c-border object-cover"
                      loading="lazy"
                    />
                  ) : null}
                  {video ? (
                    <video
                      className="mt-2.5 w-full rounded-lg border border-c-border bg-black"
                      src={video}
                      controls
                      playsInline
                    />
                  ) : null}
                  <div className="mt-2.5 flex flex-wrap gap-2 text-[11px] text-c-text-tertiary">
                    <button className="font-semibold text-cpoint-turquoise hover:underline" onClick={() => navigate(`/post/${post.id}`)}>
                      {t('profile.followers_page.view_post')}
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
    <div className="glass-page min-h-screen bg-c-bg-app text-c-text-primary">
      <div
        className="fixed left-0 right-0 h-10 bg-c-bg-app/70 backdrop-blur z-40"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))' }}
      >
        <div className="max-w-3xl mx-auto h-full flex items-center px-2">
          <div className="flex-1 h-full flex">
            {SECTION_KEYS.map(section => {
              const isActive = section === activeSection
              return (
                <button
                  key={section}
                  type="button"
                  className={`flex-1 text-center text-sm font-medium ${
                    isActive ? 'text-c-text-primary' : 'text-c-text-tertiary hover:text-c-text-primary'
                  }`}
                  onClick={() => setActiveSection(section)}
                >
                  <div className="pt-2">{sectionLabel(section)}</div>
                  <div
                    className={`h-0.5 rounded-full w-20 mx-auto mt-1 ${
                      isActive ? 'bg-cpoint-turquoise' : 'bg-transparent'
                    }`}
                  />
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div
        className="app-subnav-offset max-w-3xl mx-auto px-1 sm:px-3 pb-2 overflow-y-auto overscroll-auto"
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
