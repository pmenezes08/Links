import { useCallback, useEffect, useMemo, useRef, useState, Fragment, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'
import { formatSmartTime } from '../utils/time'
import ImageLoader from '../components/ImageLoader'
import VideoEmbed from '../components/VideoEmbed'
import { extractVideoEmbedFromPost, removeVideoUrlFromText } from '../utils/videoEmbed'
import { renderTextWithLinks } from '../utils/linkUtils.tsx'
import { openExternalInApp } from '../utils/openExternalInApp'
import EditableAISummary from '../components/EditableAISummary'
import { readDeviceCache, writeDeviceCache } from '../utils/deviceCache'
import DashboardBottomNav from '../components/DashboardBottomNav'
import { useBadges } from '../contexts/BadgeContext'
const HOME_TIMELINE_CACHE_KEY = 'home-timeline'
const HOME_TIMELINE_CACHE_TTL_MS = 2 * 60 * 1000 // 2 minutes
const HOME_TIMELINE_CACHE_VERSION = 'home-timeline-v1'

type PollOption = { id: number; text: string; votes: number; user_voted?: boolean }
type Poll = { id: number; question: string; is_active: number; options: PollOption[]; user_vote: number|null; total_votes: number; single_vote?: boolean; expires_at?: string }
type MediaItem = { type: 'image' | 'video'; path: string }
type Post = { id:number; username:string; content:string; image_path?:string|null; video_path?: string | null; audio_path?: string | null; audio_summary?: string | null; timestamp:string; display_timestamp?:string; community_id?:number|null; community_name?:string; reactions:Record<string,number>; user_reaction:string|null; poll?:Poll|null; replies_count?:number; profile_picture?:string|null; media_paths?: MediaItem[] | string | null; link_urls?: unknown; has_viewed?: boolean }

function normalizeMediaPath(path?: string | null){
  const raw = (path || '').trim()
  if (!raw) return ''
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  if (raw.startsWith('/uploads') || raw.startsWith('/static')) return raw
  if (raw.startsWith('uploads') || raw.startsWith('static')) return `/${raw}`
  return `/uploads/${raw}`
}

// Helper component for multi-media carousel
function PostMediaCarousel({ post }: { post: Post }) {
  const [index, setIndex] = useState(0)
  
  const mediaPaths = useMemo((): MediaItem[] => {
    if (!post.media_paths) return []
    let raw: unknown[] = []
    if (Array.isArray(post.media_paths)) {
      raw = post.media_paths
    } else if (typeof post.media_paths === 'string') {
      try { raw = JSON.parse(post.media_paths) } catch { return [] }
      if (!Array.isArray(raw)) return []
    }
    return raw.map((item: unknown) => {
      if (typeof item === 'string') {
        const isVideo = /\.(mp4|mov|webm|m4v)$/i.test(item)
        return { type: isVideo ? 'video' : 'image', path: item } as MediaItem
      }
      if (item && typeof item === 'object' && 'path' in item) return item as MediaItem
      return null
    }).filter((x): x is MediaItem => x !== null)
  }, [post.media_paths])
  
  // If no media_paths OR it's empty, fall back to legacy single media
  if (mediaPaths.length === 0) {
    if (post.image_path) {
      return (
        <ImageLoader
          src={normalizeMediaPath(post.image_path)}
          alt="Post image"
          className="w-full h-auto"
        />
      )
    }
    if (post.video_path) {
      return (
        <div className="px-3" onClick={(e) => e.stopPropagation()}>
          <video
            className="w-full max-h-[360px] rounded border border-white/10 bg-black"
            src={normalizeMediaPath(post.video_path) + '#t=0.1'}
            controls
            playsInline
            preload="metadata"
          />
        </div>
      )
    }
    return null
  }
  
  const current = mediaPaths[index]
  const hasMultiple = mediaPaths.length > 1
  
  return (
    <div 
      className="relative overflow-hidden touch-pan-y" 
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => {
        if (!hasMultiple) return
        const touch = e.touches[0]
        ;(e.currentTarget as any)._swipeStartX = touch.clientX
        ;(e.currentTarget as any)._swipeStartY = touch.clientY
      }}
      onTouchEnd={(e) => {
        if (!hasMultiple) return
        const startX = (e.currentTarget as any)._swipeStartX
        const startY = (e.currentTarget as any)._swipeStartY
        if (startX === undefined) return
        const touch = e.changedTouches[0]
        const diffX = touch.clientX - startX
        const diffY = touch.clientY - startY
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
          if (diffX < 0 && index < mediaPaths.length - 1) {
            setIndex(i => i + 1)
          } else if (diffX > 0 && index > 0) {
            setIndex(i => i - 1)
          }
        }
      }}
    >
      {current?.type === 'video' ? (
        <div className="px-3">
          <video
            className="w-full max-h-[360px] rounded border border-white/10 bg-black"
            src={normalizeMediaPath(current.path) + '#t=0.1'}
            controls
            playsInline
            preload="metadata"
          />
        </div>
      ) : (
        <ImageLoader
          src={normalizeMediaPath(current?.path || '')}
          alt={`Post media ${index + 1}`}
          className="w-full h-auto"
        />
      )}
      
      {/* Carousel navigation - only show when multiple items */}
      {hasMultiple && (
        <>
          {/* Left arrow */}
          <button
            type="button"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black/90 disabled:opacity-30 z-20 shadow-lg"
            onClick={(e) => { e.stopPropagation(); setIndex(i => Math.max(0, i - 1)) }}
            disabled={index === 0}
          >
            <i className="fa-solid fa-chevron-left" />
          </button>
          {/* Right arrow */}
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black/90 disabled:opacity-30 z-20 shadow-lg"
            onClick={(e) => { e.stopPropagation(); setIndex(i => Math.min(mediaPaths.length - 1, i + 1)) }}
            disabled={index === mediaPaths.length - 1}
          >
            <i className="fa-solid fa-chevron-right" />
          </button>
          {/* Dot indicators */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-20 bg-black/50 rounded-full px-2 py-1">
            {mediaPaths.map((_, idx) => (
              <button
                key={idx}
                type="button"
                className={`w-2 h-2 rounded-full transition-colors ${idx === index ? 'bg-white' : 'bg-white/40'}`}
                onClick={(e) => { e.stopPropagation(); setIndex(idx) }}
              />
            ))}
          </div>
          {/* Counter badge */}
          <div className="absolute top-3 right-3 bg-black/70 text-white text-xs px-2 py-1 rounded-full z-20">
            {index + 1}/{mediaPaths.length}
          </div>
        </>
      )}
    </div>
  )
}

function dashboardFeedScopeSegment(feedMode: 'unread' | 'recent48h', feedParentId: number | null): string {
  return `${feedMode}:${feedParentId ?? 'all'}`
}

const DASHBOARD_FEED_CACHE_TTL_MS = 2 * 60 * 1000
const DASHBOARD_FEED_LAST_NONEMPTY_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DASHBOARD_FEED_CACHE_VERSION = 'dashboard-feed-v2'
const DASHBOARD_FEED_LAST_NONEMPTY_VERSION = 'dashboard-feed-last-v1'

function dashboardFeedShortCacheKey(scope: string): string {
  return `dashboard-feed:${scope}`
}

function dashboardFeedLastNonemptyKey(scope: string): string {
  return `dashboard-feed-last:${scope}`
}

function DashboardFeedCommunityRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2 my-2" aria-hidden>
      <div className="h-px flex-1 bg-white/10" />
      <span className="text-[10px] uppercase tracking-wider text-[#9fb0b5]/60 font-medium max-w-[min(280px,55vw)] truncate text-center">
        {label}
      </span>
      <div className="h-px flex-1 bg-white/10" />
    </div>
  )
}

type ObservedShellProps = {
  postId: number
  markWhenSeen: boolean
  hasViewed?: boolean
  onMarkViewed: (postId: number, already?: boolean) => Promise<boolean>
  children: ReactNode
}

function DashboardFeedObservedPostShell({
  postId,
  markWhenSeen,
  hasViewed,
  onMarkViewed,
  children,
}: ObservedShellProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!markWhenSeen) return
    if (hasViewed) return
    const el = ref.current
    if (!el) return

    if (typeof IntersectionObserver === 'undefined') {
      void onMarkViewed(postId, hasViewed)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          void onMarkViewed(postId, hasViewed).then((ok) => {
            if (ok) observer.disconnect()
          })
        })
      },
      { threshold: [0, 0.1, 0.25], rootMargin: '0px 0px -5% 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [markWhenSeen, postId, hasViewed, onMarkViewed])

  return <div ref={ref}>{children}</div>
}

type HomeTimelineProps = {
  /** `dashboard_feed` = unread posts across all networks; same UI as home with bottom nav */
  mode?: 'home' | 'dashboard_feed'
}

export default function HomeTimeline({ mode = 'home' }: HomeTimelineProps){
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { refreshBadges } = useBadges()
  const recordedViewsRef = useRef<Set<number>>(new Set())
  const mentionToProfile = useCallback((u: string) => { navigate(`/profile/${encodeURIComponent(u)}`) }, [navigate])
  const openExternalArticle = useCallback((url: string) => {
    void openExternalInApp(url)
  }, [])
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [hasDashboardCommunities, setHasDashboardCommunities] = useState(false)
  const [feedMode, setFeedMode] = useState<'unread' | 'recent48h'>('unread')
  const [feedParentId, setFeedParentId] = useState<number | null>(null)
  const [dashboardParents, setDashboardParents] = useState<{ id: number; name: string }[]>([])
  const [showStaleFeed, setShowStaleFeed] = useState(false)
  const feedFiltersHydrated = useRef(false)

  useEffect(() => {
    let link = document.getElementById('legacy-styles') as HTMLLinkElement | null
    if (!link){
      link = document.createElement('link')
      link.id = 'legacy-styles'
      link.rel = 'stylesheet'
      link.href = '/static/base.css'
      document.head.appendChild(link)
    }
    return () => { link?.remove() }
  }, [])

  useEffect(() => {
    if (mode !== 'dashboard_feed') {
      feedFiltersHydrated.current = false
      return
    }
    if (feedFiltersHydrated.current) return
    feedFiltersHydrated.current = true
    const f = searchParams.get('feed')
    if (f === 'recent48h' || f === 'recent') setFeedMode('recent48h')
    const p = searchParams.get('parent')
    if (p && /^\d+$/.test(p)) setFeedParentId(parseInt(p, 10))
  }, [mode, searchParams])

  useEffect(() => {
    if (mode !== 'dashboard_feed') return
    if (!feedFiltersHydrated.current) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('feed', feedMode)
        if (feedParentId != null) next.set('parent', String(feedParentId))
        else next.delete('parent')
        return next
      },
      { replace: true },
    )
  }, [mode, feedMode, feedParentId, setSearchParams])

  // Refresh data when page becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        setRefreshKey(prev => prev + 1)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  useEffect(() => {
    if (mode !== 'home') return
    let mounted = true
    const cachedData = readDeviceCache<any>(HOME_TIMELINE_CACHE_KEY, HOME_TIMELINE_CACHE_VERSION)
    const hadCache = !!(cachedData?.success)
    if (hadCache) {
      setData(cachedData)
      setLoading(false)
    } else {
      setLoading(true)
    }

    async function load() {
      try {
        const r = await fetch('/api/home_timeline', { credentials: 'include', headers: { Accept: 'application/json' } })
        const j = await r.json()
        if (!mounted) return
        if (j?.success) {
          setData(j)
          writeDeviceCache(HOME_TIMELINE_CACHE_KEY, j, HOME_TIMELINE_CACHE_TTL_MS, HOME_TIMELINE_CACHE_VERSION)
          setError(null)
        } else if (!hadCache) {
          setError(j?.error || 'Error')
        }
      } catch {
        if (mounted && !hadCache) setError('Error loading')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [mode, refreshKey])

  useEffect(() => {
    if (mode !== 'dashboard_feed') return
    if (feedParentId == null || dashboardParents.length === 0) return
    if (!dashboardParents.some((x) => x.id === feedParentId)) setFeedParentId(null)
  }, [mode, dashboardParents, feedParentId])

  useEffect(() => {
    if (mode !== 'dashboard_feed') return
    let mounted = true
    const scope = dashboardFeedScopeSegment(feedMode, feedParentId)
    const shortKey = dashboardFeedShortCacheKey(scope)
    const lastKey = dashboardFeedLastNonemptyKey(scope)
    const cachedData = readDeviceCache<any>(shortKey, DASHBOARD_FEED_CACHE_VERSION)
    const hadCache = !!(cachedData?.success)
    if (hadCache) {
      setData(cachedData)
      setLoading(false)
    } else {
      setLoading(true)
    }

    const feedParams = new URLSearchParams()
    feedParams.set('mode', feedMode)
    if (feedParentId != null) feedParams.set('parent_id', String(feedParentId))

    async function load() {
      try {
        const [parentRes, feedRes] = await Promise.all([
          fetch('/api/user_parent_community', { credentials: 'include', headers: { Accept: 'application/json' } }),
          fetch(`/api/dashboard_unread_feed?${feedParams.toString()}`, {
            credentials: 'include',
            headers: { Accept: 'application/json' },
          }),
        ])
        const parentJ = await parentRes.json().catch(() => null)
        const j = await feedRes.json().catch(() => null)
        if (!mounted) return
        const parents = parentJ?.communities
        setHasDashboardCommunities(Array.isArray(parents) && parents.length > 0)
        if (Array.isArray(parents)) {
          setDashboardParents(
            parents
              .map((c: any) => ({ id: Number(c?.id), name: String(c?.name || '') }))
              .filter((c: { id: number }) => c.id > 0),
          )
        }
        if (j?.success) {
          const list = Array.isArray(j.posts) ? j.posts : []
          if (list.length === 0 && feedMode === 'unread') {
            const fallback = readDeviceCache<any>(lastKey, DASHBOARD_FEED_LAST_NONEMPTY_VERSION)
            const fbPosts = Array.isArray(fallback?.posts) ? fallback.posts : []
            if (fbPosts.length > 0) {
              setData(fallback)
              setShowStaleFeed(true)
              setError(null)
              writeDeviceCache(shortKey, j, DASHBOARD_FEED_CACHE_TTL_MS, DASHBOARD_FEED_CACHE_VERSION)
            } else {
              setData(j)
              setShowStaleFeed(false)
              setError(null)
              writeDeviceCache(shortKey, j, DASHBOARD_FEED_CACHE_TTL_MS, DASHBOARD_FEED_CACHE_VERSION)
            }
          } else {
            setData(j)
            setShowStaleFeed(false)
            setError(null)
            writeDeviceCache(shortKey, j, DASHBOARD_FEED_CACHE_TTL_MS, DASHBOARD_FEED_CACHE_VERSION)
            if (list.length > 0) {
              writeDeviceCache(lastKey, j, DASHBOARD_FEED_LAST_NONEMPTY_TTL_MS, DASHBOARD_FEED_LAST_NONEMPTY_VERSION)
            }
          }
        } else if (!hadCache) {
          setError(j?.error || 'Error')
          setShowStaleFeed(false)
        }
      } catch {
        if (mounted && !hadCache) setError('Error loading')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [mode, refreshKey, feedMode, feedParentId])

  useEffect(() => {
    if (mode !== 'dashboard_feed') return
    recordedViewsRef.current.clear()
  }, [mode, feedMode, feedParentId])

  const posts: Post[] = useMemo(() => data?.posts || [], [data])

  const markPostViewed = useCallback(
    async (postId: number, alreadyViewed?: boolean): Promise<boolean> => {
      if (!postId) return false
      if (alreadyViewed) {
        recordedViewsRef.current.add(postId)
        return true
      }
      if (recordedViewsRef.current.has(postId)) return false
      recordedViewsRef.current.add(postId)
      try {
        const res = await fetch('/api/post_view', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ post_id: postId }),
        })
        const j = await res.json().catch(() => null)
        if (j?.success) {
          setData((prev: any) => {
            if (!prev) return prev
            const pl = Array.isArray(prev.posts) ? prev.posts : []
            const updated = pl.map((post: any) =>
              post.id === postId ? { ...post, has_viewed: true } : post,
            )
            return { ...prev, posts: updated }
          })
          refreshBadges()
          return true
        }
        recordedViewsRef.current.delete(postId)
        return false
      } catch {
        recordedViewsRef.current.delete(postId)
        return false
      }
    },
    [refreshBadges],
  )

  const { setTitle } = useHeader()

  useEffect(() => {
    setTitle(mode === 'dashboard_feed' ? 'Feed' : 'Home')
  }, [setTitle, mode])

  async function handlePollVote(postId: number, pollId: number, optionId: number){
    // Optimistic update for poll vote
    setData((prev:any) => {
      if (!prev) return prev
      const updatedPosts = (prev.posts || []).map((p: any) => {
        if (p.id !== postId || !p.poll) return p
        const poll = p.poll
        
        // Find the option being clicked and check if user already voted on it
        const clickedOption = poll.options.find((opt: any) => opt.id === optionId)
        const hasVotedOnThisOption = clickedOption?.user_voted || false
        
        const updatedOptions = poll.options.map((opt: any) => {
          if (opt.id === optionId) {
            // Toggle: if already voted, remove vote; otherwise add vote
            return { 
              ...opt, 
              votes: hasVotedOnThisOption ? Math.max(0, opt.votes - 1) : opt.votes + 1,
              user_voted: !hasVotedOnThisOption
            }
          }
          // If single vote, reduce previous vote when voting on different option
          if (poll.single_vote !== false && opt.user_voted && opt.id !== optionId) {
            return { ...opt, votes: Math.max(0, opt.votes - 1), user_voted: false }
          }
          return opt
        })
        
        // Update user_vote for single vote polls
        const newUserVote = hasVotedOnThisOption ? null : optionId
        return { ...p, poll: { ...poll, options: updatedOptions, user_vote: poll.single_vote !== false ? newUserVote : poll.user_vote } }
      })
      return { ...prev, posts: updatedPosts }
    })

    // Send vote to server
    try{
      const res = await fetch('/vote_poll', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ poll_id: pollId, option_id: optionId }) })
      const j = await res.json().catch(()=>null)
      if (!j?.success){
        // Reload on error
        setRefreshKey(prev => prev + 1)
      } else {
        // Reload to get correct user_voted state from server
        setRefreshKey(prev => prev + 1)
      }
    }catch{
      setRefreshKey(prev => prev + 1)
    }
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 bg-black text-white"
      style={{ top: 'var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px)))' }}
    >
      <div
        className={`h-full max-w-2xl mx-auto overflow-y-auto px-3 ${mode === 'dashboard_feed' && hasDashboardCommunities ? 'pb-[calc(3.5rem+env(safe-area-inset-bottom,0px)+12px)]' : 'pb-24'}`}
        style={{
          WebkitOverflowScrolling: 'touch' as any,
          // Match main dashboard column: app-content (8px) + py-6 top (24px) → header-to-content breathing room
          paddingTop: 'calc(var(--app-content-gap, 8px) + 1rem)',
        }}
      >
        {mode === 'dashboard_feed' && hasDashboardCommunities ? (
          <div className="mb-4 rounded-2xl border border-white/10 bg-black p-3 shadow-sm shadow-black/20 space-y-4">
            <div className="flex items-center justify-center gap-6 sm:gap-8">
              <button
                type="button"
                className={`text-sm font-medium transition-opacity touch-manipulation ${
                  feedMode === 'unread' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'
                }`}
                onClick={() => setFeedMode('unread')}
              >
                <div className="pt-1 whitespace-nowrap text-center">Unread</div>
                <div
                  className={`h-0.5 rounded-full w-16 mx-auto mt-1 transition-shadow ${
                    feedMode === 'unread' ? 'bg-[#4db6ac] shadow-[0_0_12px_rgba(77,182,172,0.35)]' : 'bg-transparent'
                  }`}
                />
              </button>
              <button
                type="button"
                className={`text-sm font-medium transition-opacity touch-manipulation ${
                  feedMode === 'recent48h' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'
                }`}
                onClick={() => setFeedMode('recent48h')}
              >
                <div className="pt-1 whitespace-nowrap text-center">Last 48 hours</div>
                <div
                  className={`h-0.5 rounded-full w-16 mx-auto mt-1 transition-shadow ${
                    feedMode === 'recent48h' ? 'bg-[#4db6ac] shadow-[0_0_12px_rgba(77,182,172,0.35)]' : 'bg-transparent'
                  }`}
                />
              </button>
            </div>
            <label className="block">
              <span className="sr-only">Filter by community</span>
              <select
                value={feedParentId ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  setFeedParentId(v === '' ? null : parseInt(v, 10))
                }}
                className="w-full rounded-xl border border-white/12 bg-white/[0.06] px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#4db6ac]/50 focus:ring-1 focus:ring-[#4db6ac]/25"
              >
                <option value="">All networks</option>
                {dashboardParents.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {loading ? (
          <div className="p-3 text-[#9fb0b5]">Loading…</div>
        ) : error ? (
          <div className="p-3 text-red-400">{error}</div>
        ) : posts.length === 0 ? (
          <div className="p-3 text-[#9fb0b5]">
            {mode === 'dashboard_feed'
              ? feedMode === 'recent48h'
                ? 'No posts in the last 48 hours.'
                : 'No unread posts.'
              : 'No recent posts'}
          </div>
        ) : (
          <div className="space-y-3">
            {showStaleFeed && mode === 'dashboard_feed' ? (
              <div className="flex flex-col items-center justify-center py-8 px-4 mb-1">
                <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                  <i className="fa-regular fa-comment-dots text-3xl text-white/30" />
                </div>
                <h3 className="text-lg font-medium text-white/80 mb-2 text-center">You&apos;re caught up</h3>
                <p className="text-sm text-white/50 text-center max-w-xs">
                  Showing recent activity from your communities until new posts arrive.
                </p>
              </div>
            ) : null}
            {posts.flatMap((p, i) => {
              const prev = i > 0 ? posts[i - 1] : null
              const prevCid = prev?.community_id ?? null
              const cid = p.community_id ?? null
              const showSep =
                mode === 'dashboard_feed' &&
                prev != null &&
                (prevCid !== cid || String(prev.community_name || '') !== String(p.community_name || ''))
              const cardShell =
                'rounded-2xl border border-white/10 bg-black shadow-sm shadow-black/20 cursor-pointer'
              const cardEl = (
              <div className={cardShell} onClick={p.poll ? undefined : () => navigate(`/post/${p.id}`)}>
                <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2" onClick={(e)=> e.stopPropagation()}>
                  <Avatar username={p.username} url={p.profile_picture || undefined} size={32} linkToProfile />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <div className="font-medium tracking-[-0.01em] truncate">{p.username}</div>
                      {p.community_name ? (
                        <div className="text-xs text-[#9fb0b5] truncate">in {p.community_name}</div>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-xs text-[#9fb0b5] ml-auto tabular-nums">{formatSmartTime(p.display_timestamp || p.timestamp)}</div>
                </div>
                <div className="py-2 space-y-2">
                  {(() => {
                    // Always use fresh content from post object
                    const content = p.content || ''
                    const videoEmbed = extractVideoEmbedFromPost(content, p.link_urls)
                    const displayContent = videoEmbed ? removeVideoUrlFromText(content, videoEmbed) : content
                    
                    if (!videoEmbed && !displayContent) return null
                    return (
                      <>
                        {displayContent && <div className="px-3 whitespace-pre-wrap text-[14px] leading-relaxed">{renderTextWithLinks(displayContent, undefined, mentionToProfile, { sourcesSmallLinks: true, onExternalClick: openExternalArticle })}</div>}
                        {videoEmbed && <VideoEmbed embed={videoEmbed} />}
                      </>
                    )
                  })()}
                  {/* Multi-media carousel or single media */}
                  <PostMediaCarousel post={p} />
                  {p.audio_path ? (
                    <div className="px-3 space-y-2" onClick={(e)=> e.stopPropagation()}>
                      {p.audio_summary && (
                        <EditableAISummary
                          postId={p.id}
                          initialSummary={p.audio_summary}
                          isOwner={p.username === data?.username}
                          onSummaryUpdate={(newSummary) => {
                            setData((prevData: any) => ({
                              ...prevData,
                              posts: prevData.posts.map((post: any) => 
                                post.id === p.id ? {...post, audio_summary: newSummary} : post
                              )
                            }));
                          }}
                        />
                      )}
                      <audio 
                        controls 
                        className="w-full"
                        playsInline
                        webkit-playsinline="true" 
                        src={(() => { 
                          const a = p.audio_path || ''; 
                          if (!a) return ''; 
                          let path = '';
                          if (a.startsWith('http')) path = a;
                          else if (a.startsWith('/uploads')) path = a;
                          else path = a.startsWith('uploads') ? `/${a}` : `/uploads/${a}`;
                          const separator = path.includes('?') ? '&' : '?';
                          return `${path}${separator}_cb=${Date.now()}`;
                        })()}
                        onClick={(e)=> e.stopPropagation()}
                        onPlay={(e)=> e.stopPropagation() as any}
                        onPause={(e)=> e.stopPropagation() as any}
                      />
                    </div>
                  ) : null}
                  {/* Poll display */}
                  {p.poll && (
                    <div className="px-3 space-y-2" onClick={(e)=> e.stopPropagation()}>
                      <div className="flex items-center gap-2 mb-2">
                        <i className="fa-solid fa-chart-bar text-[#4db6ac]" />
                        <div className="font-medium text-sm flex-1">
                          {p.poll.question}
                          {p.poll.expires_at ? (
                            <span className="ml-2 text-[11px] text-[#9fb0b5]">• closes {(() => { try { const d = new Date(p.poll.expires_at as any); if (!isNaN(d.getTime())) return d.toLocaleDateString(); } catch { } return String(p.poll.expires_at) })()}</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="space-y-2">
                        {p.poll.options?.map(option => {
                          const percentage = p.poll?.total_votes ? Math.round((option.votes / p.poll.total_votes) * 100) : 0
                          const isUserVote = option.user_voted || false
                          // Check both is_active flag AND expires_at timestamp
                          const isClosed = p.poll!.is_active === 0
                          const isExpiredByTime = (() => { try { const raw = (p.poll as any)?.expires_at; if (!raw) return false; const d = new Date(raw); return !isNaN(d.getTime()) && Date.now() >= d.getTime(); } catch { return false } })()
                          const isExpired = isClosed || isExpiredByTime
                          return (
                            <button
                              key={option.id}
                              type="button"
                              disabled={isExpired}
                              className={`w-full text-left px-3 py-2 rounded-lg border relative overflow-hidden ${isExpired ? 'opacity-60 cursor-not-allowed' : (isUserVote ? 'border-[#4db6ac] bg-[#4db6ac]/10' : 'border-white/10 hover:bg-white/5')}`}
                              onClick={(e)=> { e.preventDefault(); e.stopPropagation(); if (!isExpired && handlePollVote) handlePollVote(p.id, p.poll!.id, option.id) }}
                            >
                              <div className="absolute inset-0 bg-[#4db6ac]/20" style={{ width: `${percentage}%`, transition: 'width 0.3s ease' }} />
                              <div className="relative flex items-center justify-between">
                                <span className="text-sm">{option.text}</span>
                                <span className="text-xs text-[#9fb0b5] font-medium">{option.votes} {percentage > 0 ? `(${percentage}%)` : ''}</span>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                      <div className="flex items-center justify-between text-xs text-[#9fb0b5] pt-1">
                        <span>{p.poll.total_votes || 0} {p.poll.total_votes === 1 ? 'vote' : 'votes'}</span>
                        {p.community_id && (
                          <button 
                            type="button"
                            onClick={(e)=> { e.preventDefault(); e.stopPropagation(); navigate(`/community/${p.community_id}/polls_react`) }}
                            className="text-[#4db6ac] hover:underline"
                          >
                            View all polls →
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              )
              const markUnread = mode === 'dashboard_feed' && feedMode === 'unread'
              const listItem = markUnread ? (
                <DashboardFeedObservedPostShell
                  key={p.id}
                  postId={p.id}
                  markWhenSeen
                  hasViewed={p.has_viewed}
                  onMarkViewed={markPostViewed}
                >
                  {cardEl}
                </DashboardFeedObservedPostShell>
              ) : (
                <Fragment key={p.id}>{cardEl}</Fragment>
              )
              const sep = showSep ? (
                <DashboardFeedCommunityRule
                  key={`sep-before-${p.id}`}
                  label={String(p.community_name || 'Community')}
                />
              ) : null
              return sep ? [sep, listItem] : [listItem]
            })}
          </div>
        )}
      </div>
      {mode === 'dashboard_feed' && hasDashboardCommunities ? <DashboardBottomNav show /> : null}
    </div>
  )
}
