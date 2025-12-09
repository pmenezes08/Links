import { type ChangeEvent, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Keyboard } from '@capacitor/keyboard'
import { Geolocation } from '@capacitor/geolocation'
import Avatar from '../components/Avatar'
import MentionTextarea from '../components/MentionTextarea'
import { formatSmartTime } from '../utils/time'
import ImageLoader from '../components/ImageLoader'
import ZoomableImage from '../components/ZoomableImage'
import { useHeader } from '../contexts/HeaderContext'
import VideoEmbed from '../components/VideoEmbed'
import { extractVideoEmbed, removeVideoUrlFromText } from '../utils/videoEmbed'
import { renderTextWithLinks, detectLinks, replaceLinkInText, type DetectedLink } from '../utils/linkUtils.tsx'
import EditableAISummary from '../components/EditableAISummary'
import GifPicker from '../components/GifPicker'
import type { GifSelection } from '../components/GifPicker'
import { gifSelectionToFile } from '../utils/gif'
import LazyVideo from '../components/LazyVideo'
import { readDeviceCache, writeDeviceCache, clearDeviceCache } from '../utils/deviceCache'

type PollOption = { id: number; text: string; votes: number; user_voted?: boolean }
type Poll = { id: number; question: string; is_active: number; options: PollOption[]; user_vote: number|null; total_votes: number; single_vote?: boolean; expires_at?: string | null }
type Reply = { id: number; username: string; content: string; timestamp: string; reactions: Record<string, number>; user_reaction: string|null, profile_picture?: string|null, image_path?: string|null, audio_path?: string|null, parent_reply_id?: number | null }
type Post = { id: number; username: string; content: string; image_path?: string|null; video_path?: string|null; audio_path?: string|null; audio_summary?: string|null; timestamp: string; reactions: Record<string, number>; user_reaction: string|null; poll?: Poll|null; replies: Reply[], profile_picture?: string|null, is_starred?: boolean, is_community_starred?: boolean, view_count?: number, has_viewed?: boolean }
type ReactionGroup = { reaction_type: string; users: Array<{ username: string; profile_picture?: string | null }> }
type PostViewer = { username: string; profile_picture?: string | null; viewed_at?: string | null }
type TextOverlay = {
  id: string
  text: string
  x: number
  y: number
  fontSize: number
  color: string
  fontFamily: string
  rotation: number
}
type LocationData = {
  name: string
  x: number
  y: number
}
type Story = {
  id: number
  community_id: number
  username: string
  media_type: string
  media_url?: string | null
  media_path?: string | null
  caption?: string | null
  duration_seconds?: number | null
  created_at?: string | null
  expires_at?: string | null
  view_count?: number
  has_viewed?: boolean
  profile_picture?: string | null
  reactions?: Record<string, number>
  user_reaction?: string | null
  text_overlays?: TextOverlay[] | null
  location_data?: LocationData | null
}
type StoryGroup = {
  username: string
  profile_picture?: string | null
  stories: Story[]
  has_unseen: boolean
}
type StoryViewer = { username: string; profile_picture?: string | null; viewed_at?: string | null }
const COMMUNITY_FEED_CACHE_TTL_MS = 2 * 60 * 1000
const COMMUNITY_FEED_CACHE_VERSION = 'community-feed-v3'
const STORY_REACTIONS = ['❤️', '🔥', '👏', '😂', '😮', '👍']

function normalizeMediaPath(p?: string | null){
  if (!p) return ''
  if (p.startsWith('http')) return p
  if (p.startsWith('/uploads') || p.startsWith('/static')) return p
  return p.startsWith('uploads') ? `/${p}` : `/uploads/${p}`
}

// old formatTimestamp removed; using formatSmartTime

export default function CommunityFeed() {
  let { community_id } = useParams()
  if (!community_id){
    try{ community_id = window.location.pathname.split('/').filter(Boolean).pop() as any }catch{}
  }
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const deviceFeedCacheKey = useMemo(() => (community_id ? `community-feed:${community_id}` : null), [community_id])
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)
  const [hasUnseenAnnouncements, setHasUnseenAnnouncements] = useState(false)
  const [hasUnansweredPolls, setHasUnansweredPolls] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [showAnnouncements, _setShowAnnouncements] = useState(false)
  const [_announcements, _setAnnouncements] = useState<Array<{id:number, content:string, created_by:string, created_at:string}>>([])
  const [newAnnouncement, setNewAnnouncement] = useState('')
  const [savingAnn, setSavingAnn] = useState(false)
  // Ads removed
  const [moreOpen, setMoreOpen] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [q, setQ] = useState('#')
  const [results, setResults] = useState<Array<{id:number, username:string, content:string, timestamp:string}>>([])
  const scrollRef = useRef<HTMLDivElement|null>(null)
  const [refreshHint, setRefreshHint] = useState(false)
  const [pullPx, setPullPx] = useState(0)
  const [previewImageSrc, setPreviewImageSrc] = useState<string|null>(null)
  // Voters modal state
  const [viewingVotersPollId, setViewingVotersPollId] = useState<number|null>(null)
  const [votersLoading, setVotersLoading] = useState(false)
  const [votersData, setVotersData] = useState<Array<{ id:number; option_text:string; voters:Array<{ username:string; profile_picture?:string|null; voted_at?:string }> }>>([])
  // Reaction details modal state
  const [reactorsPostId, setReactorsPostId] = useState<number|null>(null)
  const [reactorsLoading, setReactorsLoading] = useState(false)
  const [reactorGroups, setReactorGroups] = useState<ReactionGroup[]>([])
  const [reactorViewers, setReactorViewers] = useState<PostViewer[]>([])
  const [reactorViewCount, setReactorViewCount] = useState<number | null>(null)
  const communityTypeLower = (data?.community?.type || '').toLowerCase()
  const communityNameLower = (data?.community?.name || '').toLowerCase()
  const showTasks = communityTypeLower === 'general' || communityTypeLower.includes('university') || communityNameLower.includes('university')
  const showResourcesSection = communityTypeLower !== 'business'
  const recordedViewsRef = useRef<Set<number>>(new Set())
  const storyFileInputRef = useRef<HTMLInputElement | null>(null)
  const viewedStoriesRef = useRef<Set<number>>(new Set())
  const [storyGroups, setStoryGroups] = useState<StoryGroup[]>([])
  const [storiesLoading, setStoriesLoading] = useState(false)
  const [storyError, setStoryError] = useState<string | null>(null)
  const [storyUploading, setStoryUploading] = useState(false)
  const [storyRefreshKey, setStoryRefreshKey] = useState(0)
  const [activeStoryPointer, setActiveStoryPointer] = useState<{ groupIndex: number; storyIndex: number } | null>(null)
  const storyContentRef = useRef<HTMLDivElement | null>(null)
  const storySwipeRef = useRef<{ startX: number; startY: number; time: number; pointerId?: number | null } | null>(null)
  const [storyViewersState, setStoryViewersState] = useState<{
    open: boolean
    storyId: number | null
    viewers: StoryViewer[]
    loading: boolean
    error: string | null
  }>({
    open: false,
    storyId: null,
    viewers: [],
    loading: false,
    error: null,
  })
  // Story editor modal state
  type StoryEditorFile = {
    file: File
    preview: string
    type: 'image' | 'video'
    caption: string
    textOverlays: TextOverlay[]
    locationData: LocationData | null
  }
  const [storyEditorOpen, setStoryEditorOpen] = useState(false)
  const [storyEditorFiles, setStoryEditorFiles] = useState<StoryEditorFile[]>([])
  const [storyEditorActiveIndex, setStoryEditorActiveIndex] = useState(0)
  const [storyEditorDragging, setStoryEditorDragging] = useState<{ type: 'text' | 'location'; id?: string } | null>(null)
  const storyEditorMediaRef = useRef<HTMLDivElement | null>(null)
  const [showLocationInput, setShowLocationInput] = useState(false)
  const [locationInputValue, setLocationInputValue] = useState('')
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  // const [storyEditorAddingText, setStoryEditorAddingText] = useState(false)
  // const [storyEditorNewText, setStoryEditorNewText] = useState('')

  const formatViewerRelative = (value?: string | null) => {
    if (!value) return ''
    try {
      const normalized = value.includes('T') ? value : value.replace(' ', 'T')
      const date = new Date(normalized)
      if (Number.isNaN(date.getTime())) return ''
      const diffMs = Date.now() - date.getTime()
      const diffSeconds = Math.floor(diffMs / 1000)
      if (diffSeconds < 60) return 'just now'
      const diffMinutes = Math.floor(diffSeconds / 60)
      if (diffMinutes < 60) return `${diffMinutes}m ago`
      const diffHours = Math.floor(diffMinutes / 60)
      if (diffHours < 24) return `${diffHours}h ago`
      const diffDays = Math.floor(diffHours / 24)
      if (diffDays < 7) return `${diffDays}d ago`
      return date.toLocaleDateString()
    } catch {
      return ''
    }
  }
  
  const markPostViewed = useCallback(async (postId: number, alreadyViewed?: boolean) => {
    if (!postId) return
    if (alreadyViewed) {
      recordedViewsRef.current.add(postId)
      return
    }
    if (recordedViewsRef.current.has(postId)) return
    recordedViewsRef.current.add(postId)
    try {
      const res = await fetch('/api/post_view', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId })
      })
      const j = await res.json().catch(() => null)
      if (j?.success) {
        const nextCount = typeof j.view_count === 'number' ? j.view_count : undefined
        setData((prev: any) => {
          if (!prev) return prev
          const posts = Array.isArray(prev.posts) ? prev.posts : []
          const updated = posts.map((p: any) => {
            if (p.id !== postId) return p
            return {
              ...p,
              has_viewed: true,
              view_count: typeof nextCount === 'number' ? nextCount : (typeof p.view_count === 'number' ? p.view_count : 0)
            }
          })
          return { ...prev, posts: updated }
        })
      } else {
        recordedViewsRef.current.delete(postId)
      }
    } catch {
      recordedViewsRef.current.delete(postId)
    }
  }, [])

  const openStoryViewers = useCallback((storyId: number) => {
    if (!storyId) return
    setStoryViewersState({
      open: true,
      storyId,
      viewers: [],
      loading: true,
      error: null,
    })
    fetch(`/api/community_stories/${storyId}/viewers`, { credentials: 'include' })
      .then(res => res.json())
      .then(json => {
        if (json?.success) {
          setStoryViewersState(prev => ({
            ...prev,
            loading: false,
            error: null,
            viewers: Array.isArray(json.viewers) ? json.viewers : [],
          }))
        } else {
          setStoryViewersState(prev => ({
            ...prev,
            loading: false,
            error: json?.error || 'Unable to load viewers',
          }))
        }
      })
      .catch(() => {
        setStoryViewersState(prev => ({
          ...prev,
          loading: false,
          error: 'Unable to load viewers',
        }))
      })
  }, [])

  const closeStoryViewersModal = useCallback(() => {
    setStoryViewersState(prev => ({ ...prev, open: false }))
  }, [])

  const updateStoryInGroups = useCallback((storyId: number, updates: Partial<Story>) => {
    setStoryGroups(prev =>
      prev.map(group => {
        let touched = false
        const updatedStories = group.stories.map(story => {
          if (story.id !== storyId) return story
          touched = true
          return { ...story, ...updates }
        })
        if (!touched) return group
        return {
          ...group,
          stories: updatedStories,
          has_unseen: updatedStories.some(story => !story.has_viewed),
        }
      })
    )
  }, [])

  const reactToStory = useCallback(
    async (storyId: number, nextReaction: string | null) => {
      if (!storyId) return
      try {
        const res = await fetch('/api/community_stories/react', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            story_id: storyId,
            reaction: nextReaction || '',
          }),
        })
        const json = await res.json().catch(() => null)
        if (json?.success) {
          updateStoryInGroups(storyId, {
            reactions: json.reactions || {},
            user_reaction: json.user_reaction || null,
          })
        } else if (json?.error) {
          alert(json.error)
        }
      } catch (err) {
        console.error('Failed to react to story', err)
        alert('Unable to react to this story right now.')
      }
    },
    [updateStoryInGroups]
  )

  const handleStoryReaction = useCallback(
    (story: Story, reaction: string) => {
      if (!story?.id) return
      const current = story.user_reaction || null
      const next = current === reaction ? null : reaction
      reactToStory(story.id, next)
    },
    [reactToStory]
  )
  
  // Check if we should highlight from onboarding
  const [highlightStep, setHighlightStep] = useState<'reaction' | 'post' | null>(null)
    useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('highlight_post') === 'true') {
      setHighlightStep('reaction') // Start with reaction
    }
  }, [])
  // Modal removed in favor of dedicated PostDetail route

  // Set header title consistently
  const { setTitle } = useHeader()
  useEffect(() => { if (data?.community?.name) setTitle(data.community.name) }, [setTitle, data?.community?.name])

  useEffect(() => {
    if (!deviceFeedCacheKey) return
    // Skip cache read if we're navigating back with a refresh signal
    const state = routerLocation.state as { refresh?: number } | null
    if (state?.refresh) {
      // Don't read from cache - we'll fetch fresh data
      return
    }
    const cached = readDeviceCache<any>(deviceFeedCacheKey, COMMUNITY_FEED_CACHE_VERSION)
    if (cached?.success) {
      setData(cached)
      setLoading(false)
    }
  }, [deviceFeedCacheKey, routerLocation.state])

  const [isRefreshing, setIsRefreshing] = useState(false)
  const lastRefreshRef = useRef(0)

  const refreshFeed = useCallback(async () => {
    if (isRefreshing) return
    const now = Date.now()
    if (now - lastRefreshRef.current < 5000) return // Debounce 5s
    
    setIsRefreshing(true)
    lastRefreshRef.current = now
    
    try {
      // Clear device cache first
      if (deviceFeedCacheKey) {
        clearDeviceCache(deviceFeedCacheKey)
      }
      
      // Fetch fresh data
      const r = await fetch(`/api/community_feed/${community_id}`, { 
        credentials: 'include',
        cache: 'reload'
      })
      const json = await r.json().catch(() => null)
      
      if (json?.success) {
        setData(json)
        if (deviceFeedCacheKey) {
          writeDeviceCache(deviceFeedCacheKey, json, COMMUNITY_FEED_CACHE_TTL_MS, COMMUNITY_FEED_CACHE_VERSION)
        }
      }
      
      // Also refresh stories
      setStoryRefreshKey(prev => prev + 1)
    } catch (err) {
      console.warn('Feed refresh failed', err)
    } finally {
      setIsRefreshing(false)
    }
  }, [community_id, deviceFeedCacheKey, isRefreshing])

  useEffect(() => {
    // Pull-to-refresh behavior on overscroll at top with a small elastic offset
    const el = scrollRef.current
    if (!el) return
    let startY = 0
    const threshold = 64
    
    function onTS(ev: TouchEvent){
      try{ startY = ev.touches[0]?.clientY || 0 }catch{ startY = 0 }
      setPullPx(0)
      if (!isRefreshing) setRefreshHint(false)
    }
    function onTM(ev: TouchEvent){
      if (isRefreshing) return
      try{
        const y = (el ? el.scrollTop : 0) || 0
        const curY = ev.touches[0]?.clientY || 0
        const dy = curY - startY
        if (y <= 0 && dy > 0){
          const px = Math.min(100, Math.max(0, dy * 0.5))
          setPullPx(px)
          setRefreshHint(px > 8)
          if (px >= threshold) {
            refreshFeed()
          }
        } else {
          setPullPx(0)
          if (!isRefreshing) setRefreshHint(false)
        }
      }catch{}
    }
    function onTE(){ 
      setPullPx(0)
      if (!isRefreshing) setRefreshHint(false)
    }
    el.addEventListener('touchstart', onTS, { passive: true })
    el.addEventListener('touchmove', onTM, { passive: true })
    el.addEventListener('touchend', onTE, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTS as any)
      el.removeEventListener('touchmove', onTM as any)
      el.removeEventListener('touchend', onTE as any)
    }
  }, [isRefreshing, refreshFeed])

  useEffect(() => {
    // Ensure legacy css is attached once to avoid flashes between pages
    let link = document.getElementById('legacy-styles') as HTMLLinkElement | null
    if (!link){
      link = document.createElement('link')
      link.id = 'legacy-styles'
      link.rel = 'stylesheet'
      link.href = '/static/styles.css'
      document.head.appendChild(link)
    }
  }, [])

  // Remember last visited community for quick return from Communities tab
  useEffect(() => {
    if (community_id) {
      try { localStorage.setItem('last_community_id', String(community_id)) } catch {}
    }
  }, [community_id])

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

  // Refresh when navigating back with refresh state (needed for Capacitor apps)
  useEffect(() => {
    const state = routerLocation.state as { refresh?: number } | null
    if (state?.refresh) {
      // Clear the device cache
      if (deviceFeedCacheKey) {
        clearDeviceCache(deviceFeedCacheKey)
      }
      // Reset data to force a clean fetch (prevents showing stale optimistic state)
      setData(null)
      setLoading(true)
      // Trigger a fresh fetch
      setRefreshKey(prev => prev + 1)
      // Clear the state to prevent re-triggering on future renders
      navigate(routerLocation.pathname, { replace: true, state: {} })
    }
  }, [routerLocation.state, routerLocation.pathname, navigate, deviceFeedCacheKey])

  useEffect(() => {
    let isMounted = true
    
    // CACHE-FIRST STRATEGY: Show cached data immediately, then fetch fresh in background
    if (deviceFeedCacheKey) {
      const cachedData = readDeviceCache<any>(deviceFeedCacheKey, COMMUNITY_FEED_CACHE_VERSION)
      if (cachedData?.success) {
        // Show cached data immediately - no loading spinner!
        setData(cachedData)
        setLoading(false)
      } else {
        setLoading(true)
      }
    } else {
      setLoading(true)
    }
    
    // Fetch fresh data in background
    fetch(`/api/community_feed/${community_id}`, { 
      credentials: 'include'
    })
      .then(r => r.json().catch(() => ({ success: false, error: 'Invalid response' })))
      .then(json => { 
        if (!isMounted) return; 
        if (json?.success){ 
          setData(json) 
          if (deviceFeedCacheKey) {
            writeDeviceCache(deviceFeedCacheKey, json, COMMUNITY_FEED_CACHE_TTL_MS, COMMUNITY_FEED_CACHE_VERSION)
          }
        }
        else if (!data) {
          // Only set error if we don't have cached data to show
          setError(json?.error || 'Error loading feed')
        }
      })
      .catch(() => { 
        if (isMounted && !data){
          setError('Error loading feed')
        }
      })
      .finally(() => isMounted && setLoading(false))
    return () => { isMounted = false }
  }, [community_id, refreshKey, deviceFeedCacheKey])

  useEffect(() => {
    if (!deviceFeedCacheKey) return
    if (!data?.success) return
    writeDeviceCache(deviceFeedCacheKey, data, COMMUNITY_FEED_CACHE_TTL_MS, COMMUNITY_FEED_CACHE_VERSION)
  }, [data, deviceFeedCacheKey])

  // Ads removed

  useEffect(() => {
    // Check for unseen announcements (highlight icon)
    let mounted = true
    async function check(){
      try{
        const r = await fetch(`/get_community_announcements?community_id=${community_id}`, { credentials: 'include' })
        const j = await r.json()
        if (!mounted) return
        if (j?.success){
          const key = `ann_last_seen_${community_id}`
          const lastSeenStr = localStorage.getItem(key)
          const lastSeen = lastSeenStr ? Date.parse(lastSeenStr) : 0
          const hasNew = (j.announcements || []).some((a:any) => Date.parse(a.created_at) > lastSeen)
          setHasUnseenAnnouncements(hasNew)
        }
      }catch{}
    }
    check()
    return () => { mounted = false }
  }, [community_id])

  // Derive unanswered polls flag from feed data to avoid extra network roundtrip
  useEffect(() => {
    try{
      const posts = Array.isArray(data?.posts) ? data.posts : []
      const hasUnanswered = posts.some((p:any) => p?.poll && (p.poll.user_vote == null))
      setHasUnansweredPolls(hasUnanswered)
    }catch{ setHasUnansweredPolls(false) }
  }, [data])

  async function fetchAnnouncements(){
    try{
      const r = await fetch(`/get_community_announcements?community_id=${community_id}`, { credentials: 'include' })
      const j = await r.json()
      if (j?.success){
        _setAnnouncements(j.announcements || [])
        _setShowAnnouncements(true)
        try{
          const key = `ann_last_seen_${community_id}`
          localStorage.setItem(key, new Date().toISOString())
          setHasUnseenAnnouncements(false)
        }catch{}
      }
    }catch{}
  }

  // inline voters loader lives in onClick handler below

  async function saveAnnouncement(){
    if (!community_id) return
    const content = (newAnnouncement || '').trim()
    if (!content) return
    setSavingAnn(true)
    try{
      const fd = new URLSearchParams({ community_id: String(community_id), content })
      const r = await fetch('/save_community_announcement', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (j?.success){
        setNewAnnouncement('')
        fetchAnnouncements()
      } else {
        alert(j?.error || 'Failed to save announcement')
      }
    } finally {
      setSavingAnn(false)
    }
  }

  async function deleteAnnouncement(announcementId: number){
    if (!community_id) return
    const ok = confirm('Delete this announcement?')
    if (!ok) return
    try{
      const fd = new URLSearchParams({ community_id: String(community_id), announcement_id: String(announcementId) })
      const r = await fetch('/delete_community_announcement', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (j?.success){ fetchAnnouncements() }
      else alert(j?.error || 'Failed to delete')
    }catch{}
  }

  async function openVoters(pollId: number){
    try{
      setViewingVotersPollId(pollId)
      setVotersLoading(true)
      const r = await fetch(`/get_poll_voters/${pollId}`, { credentials:'include' })
      const j = await r.json().catch(()=>null)
      if (j?.success){ setVotersData(j.options || []) } else { setVotersData([]) }
    } finally { setVotersLoading(false) }
  }

  function onAddReply(postId: number, reply: Reply){
    setData((prev:any) => {
      if (!prev) return prev
      const posts = Array.isArray(prev.posts) ? prev.posts : []
      const updated = posts.map((p:any) => {
        if (p.id !== postId) return p
        const existing = Array.isArray(p.replies) ? p.replies : []
        // Prepend newest reply (API returns newest first elsewhere)
        const newReplies = [reply, ...existing]
        return { ...p, replies: newReplies }
      })
      return { ...prev, posts: updated }
    })
  }

  const normalizeStoryGroups = useCallback((rawGroups: any, fallbackStories?: any): StoryGroup[] => {
    const toStory = (raw: any): Story | null => {
      if (!raw) return null
      const id = Number(raw.id ?? raw.story_id)
      if (!id) return null
      const username = String(raw.username ?? raw.author ?? '').trim()
      if (!username) return null
      const mediaUrl: string | null = typeof raw.media_url === 'string' && raw.media_url.length > 0
        ? raw.media_url
        : normalizeMediaPath(raw.media_path || raw.mediaUrl || '')
      const profileUrl: string | null = typeof raw.profile_picture === 'string' && raw.profile_picture.length > 0
        ? raw.profile_picture
        : null
      // Parse text_overlays and location_data from JSON if string
      let textOverlays: TextOverlay[] | null = null
      if (raw.text_overlays) {
        try {
          textOverlays = typeof raw.text_overlays === 'string' 
            ? JSON.parse(raw.text_overlays) 
            : raw.text_overlays
          if (!Array.isArray(textOverlays)) textOverlays = null
        } catch { textOverlays = null }
      }
      let locationData: LocationData | null = null
      if (raw.location_data) {
        try {
          locationData = typeof raw.location_data === 'string'
            ? JSON.parse(raw.location_data)
            : raw.location_data
          if (typeof locationData !== 'object' || !locationData?.name) locationData = null
        } catch { locationData = null }
      }
      return {
        id,
        community_id: Number(raw.community_id ?? community_id ?? 0),
        username,
        media_type: typeof raw.media_type === 'string' ? raw.media_type : 'image',
        media_url: mediaUrl,
        media_path: raw.media_path ?? null,
        caption: raw.caption ?? null,
        duration_seconds: typeof raw.duration_seconds === 'number' ? raw.duration_seconds : null,
        created_at: raw.created_at ?? null,
        expires_at: raw.expires_at ?? null,
        view_count: typeof raw.view_count === 'number' ? raw.view_count : 0,
        has_viewed: !!raw.has_viewed,
        profile_picture: profileUrl,
        reactions: typeof raw.reactions === 'object' && raw.reactions !== null ? raw.reactions : {},
        user_reaction: typeof raw.user_reaction === 'string'
          ? raw.user_reaction
          : (typeof raw.userReaction === 'string' ? raw.userReaction : null),
        text_overlays: textOverlays,
        location_data: locationData,
      }
    }
    const groups: StoryGroup[] = []
    if (Array.isArray(rawGroups) && rawGroups.length > 0) {
      rawGroups.forEach((group: any) => {
        const stories = Array.isArray(group?.stories) ? group.stories.map(toStory).filter(Boolean) as Story[] : []
        if (!stories.length) return
        // Sort oldest first (left) to newest (right) for chronological viewing
        stories.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
        groups.push({
          username: String(group?.username || stories[0].username),
          profile_picture: group?.profile_picture ?? stories[0].profile_picture ?? null,
          stories,
          has_unseen: typeof group?.has_unseen === 'boolean' ? group.has_unseen : stories.some(story => !story.has_viewed),
        })
      })
      if (groups.length) return groups
    }
    if (Array.isArray(fallbackStories) && fallbackStories.length > 0) {
      const grouped = new Map<string, Story[]>()
      fallbackStories.forEach((entry: any) => {
        const story = toStory(entry)
        if (!story) return
        if (!grouped.has(story.username)) grouped.set(story.username, [])
        grouped.get(story.username)!.push(story)
      })
      grouped.forEach((stories, usernameKey) => {
        // Sort oldest first (left) to newest (right) for chronological viewing
        stories.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
        groups.push({
          username: usernameKey,
          profile_picture: stories[0]?.profile_picture ?? null,
          stories,
          has_unseen: stories.some(story => !story.has_viewed),
        })
      })
    }
    return groups
  }, [community_id])

  useEffect(() => {
    let active = true
    async function loadStories(){
      if (!community_id){
        if (active){
          setStoryGroups([])
          viewedStoriesRef.current = new Set()
        }
        return
      }
      setStoriesLoading(true)
      setStoryError(null)
      try{
        const res = await fetch(`/api/community_stories/${community_id}`, { credentials: 'include' })
        const json = await res.json().catch(() => null)
        if (!active) return
        if (!json?.success){
          setStoryGroups([])
          setStoryError(json?.error || 'Failed to load stories')
          viewedStoriesRef.current = new Set()
        } else {
          const groups = normalizeStoryGroups(json.groups, json.stories)
          viewedStoriesRef.current = new Set(
            groups.flatMap(group => group.stories.filter(story => story.has_viewed).map(story => story.id))
          )
          setStoryGroups(groups)
        }
      }catch{
        if (!active) return
        setStoryGroups([])
        setStoryError('Failed to load stories')
        viewedStoriesRef.current = new Set()
      }finally{
        if (active) setStoriesLoading(false)
      }
    }
    loadStories()
    return () => { active = false }
  }, [community_id, refreshKey, storyRefreshKey, normalizeStoryGroups])

  const handleStoryUploadClick = useCallback(() => {
    if (!community_id){
      alert('Select a community before sharing a story.')
      return
    }
    storyFileInputRef.current?.click()
  }, [community_id])

  const handleStoryFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) {
      return
    }
    if (!community_id) {
      alert('Community not available.')
      event.target.value = ''
      return
    }
    
    // Convert FileList to array and create preview data
    const validFiles: StoryEditorFile[] = []
    Array.from(files).forEach(file => {
      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)
      const isVideo = ['mp4', 'mov', 'webm', 'avi'].includes(ext)
      if (!isImage && !isVideo) return
      
      validFiles.push({
        file,
        preview: URL.createObjectURL(file),
        type: isImage ? 'image' : 'video',
        caption: '',
        textOverlays: [],
        locationData: null,
      })
    })
    
    if (validFiles.length === 0) {
      alert('No valid media files selected')
      event.target.value = ''
      return
    }
    
    setStoryEditorFiles(validFiles)
    setStoryEditorActiveIndex(0)
    setStoryEditorOpen(true)
    event.target.value = ''
  }, [community_id])

  const handleStoryEditorClose = useCallback(() => {
    // Revoke object URLs to free memory
    storyEditorFiles.forEach(f => URL.revokeObjectURL(f.preview))
    setStoryEditorFiles([])
    setStoryEditorOpen(false)
    setStoryEditorActiveIndex(0)
    setStoryEditorDragging(null)
    setShowLocationInput(false)
    setLocationInputValue('')
    setKeyboardHeight(0)
    // setStoryEditorAddingText(false)
    // setStoryEditorNewText('')
  }, [storyEditorFiles])

  // Keyboard event listeners for story editor
  useEffect(() => {
    if (!storyEditorOpen) return

    const handleKeyboardShow = (info: any) => {
      setKeyboardHeight(info.keyboardHeight || 0)
    }

    const handleKeyboardHide = () => {
      setKeyboardHeight(0)
    }

    Keyboard.addListener('keyboardWillShow', handleKeyboardShow)
    Keyboard.addListener('keyboardDidShow', handleKeyboardShow)
    Keyboard.addListener('keyboardWillHide', handleKeyboardHide)
    Keyboard.addListener('keyboardDidHide', handleKeyboardHide)

    return () => {
      Keyboard.removeAllListeners()
    }
  }, [storyEditorOpen])

  const handleStoryEditorPublish = useCallback(async () => {
    if (!community_id || storyEditorFiles.length === 0) return
    
    setStoryUploading(true)
    try {
      const fd = new FormData()
      fd.append('community_id', String(community_id))
      
      // Add all files
      storyEditorFiles.forEach(item => {
        fd.append('media', item.file)
      })
      
      // Add per-file metadata
      const perFileMeta = storyEditorFiles.map(item => ({
        caption: item.caption,
        text_overlays: item.textOverlays,
        location_data: item.locationData,
      }))
      fd.append('per_file_metadata', JSON.stringify(perFileMeta))
      
      const res = await fetch('/api/community_stories', {
        method: 'POST',
        body: fd,
        credentials: 'include'
      })
      const json = await res.json().catch(() => null)
      if (!json?.success) {
        throw new Error(json?.error || 'Failed to upload story')
      }
      setStoryRefreshKey(key => key + 1)
      handleStoryEditorClose()
    } catch (err) {
      console.error(err)
      alert((err as Error)?.message || 'Failed to upload story')
    } finally {
      setStoryUploading(false)
    }
  }, [community_id, storyEditorFiles, handleStoryEditorClose])

  const updateActiveStoryEditorFile = useCallback((updates: Partial<StoryEditorFile>) => {
    setStoryEditorFiles(prev => prev.map((f, i) => 
      i === storyEditorActiveIndex ? { ...f, ...updates } : f
    ))
  }, [storyEditorActiveIndex])

  const removeStoryEditorFile = useCallback((index: number) => {
    setStoryEditorFiles(prev => {
      const newFiles = prev.filter((_, i) => i !== index)
      // If removed the last file, close the editor
      if (newFiles.length === 0) {
        URL.revokeObjectURL(prev[index].preview)
        setStoryEditorOpen(false)
        return []
      }
      // Revoke the URL for the removed file
      URL.revokeObjectURL(prev[index].preview)
      // Adjust active index if needed
      if (index === storyEditorActiveIndex) {
        setStoryEditorActiveIndex(Math.max(0, index - 1))
      } else if (index < storyEditorActiveIndex) {
        setStoryEditorActiveIndex(storyEditorActiveIndex - 1)
      }
      return newFiles
    })
  }, [storyEditorActiveIndex])

  // Text overlay functions removed - feature disabled
  /* const addTextOverlay = useCallback(() => {
    if (!storyEditorNewText.trim()) return
    const newOverlay: TextOverlay = {
      id: `text-${Date.now()}`,
      text: storyEditorNewText.trim(),
      x: 50,
      y: 50,
      fontSize: 24,
      color: '#ffffff',
      fontFamily: 'sans-serif',
      rotation: 0,
    }
    updateActiveStoryEditorFile({
      textOverlays: [...(storyEditorFiles[storyEditorActiveIndex]?.textOverlays || []), newOverlay]
    })
    setStoryEditorNewText('')
    setStoryEditorAddingText(false)
  }, [storyEditorNewText, storyEditorFiles, storyEditorActiveIndex, updateActiveStoryEditorFile])

  const removeTextOverlay = useCallback((id: string) => {
    const current = storyEditorFiles[storyEditorActiveIndex]
    if (!current) return
    updateActiveStoryEditorFile({
      textOverlays: current.textOverlays.filter(t => t.id !== id)
    })
  }, [storyEditorFiles, storyEditorActiveIndex, updateActiveStoryEditorFile]) */

  const setLocationData = useCallback((location: LocationData | null) => {
    updateActiveStoryEditorFile({ locationData: location })
  }, [updateActiveStoryEditorFile])

  const fetchDeviceLocation = useCallback(async () => {
    try {
      // Request permission and get current position
      const permission = await Geolocation.requestPermissions()
      if (permission.location !== 'granted') {
        alert('Location permission is required to add location to your story')
        return
      }

      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000
      })

      const { latitude, longitude } = position.coords

      // Use reverse geocoding to get location name
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=14`
      )
      const data = await response.json()

      // Extract city, town, or village name
      const locationName = 
        data.address?.city || 
        data.address?.town || 
        data.address?.village || 
        data.address?.county ||
        data.display_name?.split(',')[0] ||
        `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`

      setLocationData({ name: locationName, x: 50, y: 85 })
    } catch (error) {
      console.error('Error fetching location:', error)
      alert('Could not get your location. Please try again.')
    }
  }, [setLocationData])

  const handleOverlayDrag = useCallback((e: React.PointerEvent, type: 'text' | 'location', id?: string) => {
    e.preventDefault()
    e.stopPropagation()
    setStoryEditorDragging({ type, id })
    const container = storyEditorMediaRef.current
    if (!container) return
    
    const overlay = e.currentTarget as HTMLElement
    const rect = container.getBoundingClientRect()
    let lastX = 0
    let lastY = 0
    
    const moveHandler = (moveE: PointerEvent) => {
      const x = ((moveE.clientX - rect.left) / rect.width) * 100
      const y = ((moveE.clientY - rect.top) / rect.height) * 100
      lastX = Math.max(0, Math.min(100, x))
      lastY = Math.max(0, Math.min(100, y))
      
      // Update DOM directly for smooth dragging
      overlay.style.left = `${lastX}%`
      overlay.style.top = `${lastY}%`
    }
    
    const upHandler = () => {
      setStoryEditorDragging(null)
      
      // Update React state only when drag ends
      if (type === 'location') {
        setStoryEditorFiles(prev => prev.map((f, i) => 
          i === storyEditorActiveIndex && f.locationData
            ? { ...f, locationData: { ...f.locationData, x: lastX, y: lastY } }
            : f
        ))
      } else if (type === 'text' && id) {
        setStoryEditorFiles(prev => prev.map((f, i) => 
          i === storyEditorActiveIndex
            ? { ...f, textOverlays: f.textOverlays.map(t => t.id === id ? { ...t, x: lastX, y: lastY } : t) }
            : f
        ))
      }
      
      window.removeEventListener('pointermove', moveHandler)
      window.removeEventListener('pointerup', upHandler)
      window.removeEventListener('pointercancel', upHandler)
    }
    
    window.addEventListener('pointermove', moveHandler)
    window.addEventListener('pointerup', upHandler)
    window.addEventListener('pointercancel', upHandler)
  }, [storyEditorActiveIndex])

  const markStoryAsViewed = useCallback((storyId: number) => {
    if (!storyId || viewedStoriesRef.current.has(storyId)) return
    viewedStoriesRef.current.add(storyId)
    fetch('/api/community_stories/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ story_id: storyId })
    })
      .then(res => res.json().catch(() => null))
      .then(json => {
        if (!json?.success) return
        const nextCount = typeof json.view_count === 'number' ? json.view_count : undefined
        setStoryGroups(prev => prev.map(group => {
          const stories = group.stories.map(story => {
            if (story.id !== storyId) return story
            return {
              ...story,
              has_viewed: true,
              view_count: typeof nextCount === 'number' ? nextCount : story.view_count,
            }
          })
          return {
            ...group,
            stories,
            has_unseen: stories.some(story => !story.has_viewed),
          }
        }))
      })
      .catch(() => {})
  }, [])

  const openStory = useCallback((groupIndex: number, storyIndex = 0) => {
    const targetStory = storyGroups[groupIndex]?.stories?.[storyIndex]
    if (!targetStory) return
    setStoryViewersState(prev => ({ ...prev, open: false }))
    setActiveStoryPointer({ groupIndex, storyIndex })
    markStoryAsViewed(targetStory.id)
  }, [storyGroups, markStoryAsViewed])

  const closeStoryViewer = useCallback(() => {
    storySwipeRef.current = null
    setActiveStoryPointer(null)
    setStoryViewersState(prev => ({ ...prev, open: false }))
  }, [])

  const goToNextStory = useCallback(() => {
    if (!activeStoryPointer) return
    const { groupIndex, storyIndex } = activeStoryPointer
    const group = storyGroups[groupIndex]
    if (!group) return
    if (storyIndex + 1 < group.stories.length) {
      openStory(groupIndex, storyIndex + 1)
      return
    }
    if (groupIndex + 1 < storyGroups.length) {
      openStory(groupIndex + 1, 0)
      return
    }
    closeStoryViewer()
  }, [activeStoryPointer, storyGroups, openStory, closeStoryViewer])

  const goToPrevStory = useCallback(() => {
    if (!activeStoryPointer) return
    const { groupIndex, storyIndex } = activeStoryPointer
    if (storyIndex > 0) {
      openStory(groupIndex, storyIndex - 1)
      return
    }
    if (groupIndex > 0) {
      const prevGroup = storyGroups[groupIndex - 1]
      if (prevGroup && prevGroup.stories.length > 0) {
        openStory(groupIndex - 1, prevGroup.stories.length - 1)
        return
      }
    }
    closeStoryViewer()
  }, [activeStoryPointer, storyGroups, openStory, closeStoryViewer])

  const handleStoryBackdropClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!storyContentRef.current) {
        closeStoryViewer()
        return
      }
      if (!storyContentRef.current.contains(event.target as Node)) {
        closeStoryViewer()
      }
    },
    [closeStoryViewer]
  )

  const handleStoryPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    storySwipeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      time: Date.now(),
      pointerId: event.pointerId,
    }
  }, [])

  const handleStoryPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const swipe = storySwipeRef.current
      if (!swipe || (swipe.pointerId != null && swipe.pointerId !== event.pointerId)) {
        storySwipeRef.current = null
        return
      }
      
      // Don't navigate if clicking on interactive elements (buttons, links, etc)
      const target = event.target as HTMLElement
      if (target.closest('button') || target.closest('a') || target.closest('video[controls]')) {
        storySwipeRef.current = null
        return
      }
      
      const dx = event.clientX - swipe.startX
      const dy = event.clientY - swipe.startY
      const distance = Math.sqrt(dx * dx + dy * dy)
      
      // If pointer moved less than 10px, treat it as a tap
      if (distance < 10) {
        const rect = event.currentTarget.getBoundingClientRect()
        const tapX = event.clientX - rect.left
        const containerWidth = rect.width
        
        // Tap on left 40% = previous story, right 40% = next story, middle 20% = do nothing
        if (tapX < containerWidth * 0.4) {
          goToPrevStory()
        } else if (tapX > containerWidth * 0.6) {
          goToNextStory()
        }
      }
      
      storySwipeRef.current = null
    },
    [goToNextStory, goToPrevStory]
  )

  const handleStoryPointerCancel = useCallback(() => {
    storySwipeRef.current = null
  }, [])

  const currentStory = useMemo(() => {
    if (!activeStoryPointer) return null
    return storyGroups[activeStoryPointer.groupIndex]?.stories?.[activeStoryPointer.storyIndex] ?? null
  }, [activeStoryPointer, storyGroups])

  const currentStoryGroup = useMemo(() => {
    if (!activeStoryPointer) return null
    return storyGroups[activeStoryPointer.groupIndex] ?? null
  }, [activeStoryPointer, storyGroups])

  const hasPrevStory = useMemo(() => {
    if (!activeStoryPointer) return false
    if (activeStoryPointer.storyIndex > 0) return true
    return activeStoryPointer.groupIndex > 0
  }, [activeStoryPointer])

  const hasNextStory = useMemo(() => {
    if (!activeStoryPointer) return false
    const group = storyGroups[activeStoryPointer.groupIndex]
    if (!group) return false
    if (activeStoryPointer.storyIndex + 1 < group.stories.length) return true
    return activeStoryPointer.groupIndex + 1 < storyGroups.length
  }, [activeStoryPointer, storyGroups])

  const resolveStoryMediaSrc = useCallback((story?: Story | null) => {
    if (!story) return ''
    return story.media_url || normalizeMediaPath(story.media_path || '')
  }, [])

  const [deletingStory, setDeletingStory] = useState(false)

  const handleDeleteStory = useCallback(async (storyId: number) => {
    if (!storyId || deletingStory) return
    
    if (!confirm('Delete this story?')) return
    
    setDeletingStory(true)
    try {
      const res = await fetch(`/api/community_stories/${storyId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const json = await res.json()
      
      if (json.success) {
        // Remove story from local state
        setStoryGroups(prev => {
          const updated = prev
            .map(group => {
              const stories = group.stories.filter(s => s.id !== storyId)
              return {
                ...group,
                stories,
                has_unseen: stories.some(story => !story.has_viewed),
              }
            })
            .filter(group => group.stories.length > 0)
          return updated
        })
        
        // Close viewer or move to next story
        if (hasNextStory) {
          goToNextStory()
        } else if (hasPrevStory) {
          goToPrevStory()
        } else {
          closeStoryViewer()
        }
      } else {
        alert(json.error || 'Failed to delete story')
      }
    } catch (err) {
      console.error('Failed to delete story:', err)
      alert('Failed to delete story')
    } finally {
      setDeletingStory(false)
    }
  }, [deletingStory, hasNextStory, hasPrevStory, goToNextStory, goToPrevStory, closeStoryViewer])

  // Optimistic delete - removes post from UI immediately, syncs with server in background
  async function handleDeletePost(postId: number) {
    // Store the post in case we need to restore it
    const deletedPost = postsOnly.find((p: Post) => p.id === postId)
    if (!deletedPost) return

    // Optimistically remove from state
    setData((prev: any) => {
      if (!prev) return prev
      const posts = Array.isArray(prev.posts) ? prev.posts : []
      return { ...prev, posts: posts.filter((p: any) => p.id !== postId) }
    })

    // Call API in background
    try {
      const fd = new FormData()
      fd.append('post_id', String(postId))
      const res = await fetch('/delete_post', { method: 'POST', credentials: 'include', body: fd })
      const j = await res.json().catch(() => null)
      if (!j?.success) {
        const errorMsg = j?.error || ''
        // If post is already gone on server ("not found"), keep it removed from UI - don't restore
        const alreadyDeleted = errorMsg.toLowerCase().includes('not found') || errorMsg.toLowerCase().includes('does not exist')
        if (!alreadyDeleted) {
          // Only restore the post if it's a real failure (not "already deleted")
          setData((prev: any) => {
            if (!prev) return prev
            const posts = Array.isArray(prev.posts) ? prev.posts : []
            return { ...prev, posts: [deletedPost, ...posts] }
          })
          alert(errorMsg || 'Failed to delete post')
        }
        // If already deleted, silently succeed (post stays removed from UI)
      }
    } catch {
      // Restore on network error
      setData((prev: any) => {
        if (!prev) return prev
        const posts = Array.isArray(prev.posts) ? prev.posts : []
        return { ...prev, posts: [deletedPost, ...posts] }
      })
      alert('Network error. Could not delete post.')
    }
  }

  // Optimistic poll delete
  async function handleDeletePoll(postId: number, pollId: number) {
    const originalPost = postsOnly.find((p: Post) => p.id === postId)
    if (!originalPost) return

    // Optimistically remove poll from post
    setData((prev: any) => {
      if (!prev) return prev
      const posts = Array.isArray(prev.posts) ? prev.posts : []
      return {
        ...prev,
        posts: posts.map((p: any) => p.id === postId ? { ...p, poll: null } : p)
      }
    })

    try {
      const res = await fetch('/delete_poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ poll_id: pollId })
      })
      const j = await res.json().catch(() => null)
      if (!j?.success) {
        // Restore poll
        setData((prev: any) => {
          if (!prev) return prev
          const posts = Array.isArray(prev.posts) ? prev.posts : []
          return {
            ...prev,
            posts: posts.map((p: any) => p.id === postId ? { ...p, poll: originalPost.poll } : p)
          }
        })
        alert(j?.error || 'Failed to delete poll')
      }
    } catch {
      // Restore on error
      setData((prev: any) => {
        if (!prev) return prev
        const posts = Array.isArray(prev.posts) ? prev.posts : []
        return {
          ...prev,
          posts: posts.map((p: any) => p.id === postId ? { ...p, poll: originalPost.poll } : p)
        }
      })
      alert('Error deleting poll')
    }
  }

  async function openReactors(postId: number){
    try{
      setReactorsPostId(postId)
      setReactorsLoading(true)
      setReactorGroups([])
      setReactorViewers([])
      setReactorViewCount(null)
      const targetPost = postsOnly.find((p: Post) => p.id === postId)
      markPostViewed(postId, targetPost?.has_viewed)
      const r = await fetch(`/get_post_reactors/${postId}`, { credentials:'include' })
      const j = await r.json().catch(()=>null)
      if (j?.success){
        setReactorGroups(Array.isArray(j.groups) ? j.groups : [])
        const viewerList: PostViewer[] = Array.isArray(j.viewers)
          ? (j.viewers as Array<any>)
              .map((v) => ({
                username: v?.username,
                profile_picture: v?.profile_picture ?? null,
                viewed_at: v?.viewed_at ?? null,
              }))
              .filter((v) => typeof v.username === 'string' && v.username.length > 0)
          : []
        setReactorViewers(viewerList)
        if (typeof j.view_count === 'number') {
          setReactorViewCount(j.view_count)
        } else if (viewerList.length > 0) {
          setReactorViewCount(viewerList.length)
        } else {
          setReactorViewCount(null)
        }
      } else {
        setReactorGroups([])
        setReactorViewers([])
        setReactorViewCount(null)
      }
    } finally {
      setReactorsLoading(false)
    }
  }

  function closeReactorsModal(){
    setReactorsPostId(null)
    setReactorGroups([])
    setReactorViewers([])
    setReactorViewCount(null)
  }

  async function handleToggleReaction(postId: number, reaction: string){
    // Optimistic update: toggle user reaction and adjust counts immediately
    setData((prev:any) => {
      if (!prev) return prev
      const updatedPosts = (prev.posts || []).map((p: any) => {
        if (p.id !== postId) return p
        const prevUserReaction = p.user_reaction
        const nextUserReaction = prevUserReaction === reaction ? null : reaction
        const counts = { ...(p.reactions || {}) }
        if (prevUserReaction){
          counts[prevUserReaction] = Math.max(0, (counts[prevUserReaction] || 0) - 1)
        }
        if (nextUserReaction){
          counts[nextUserReaction] = (counts[nextUserReaction] || 0) + 1
        }
        return { ...p, user_reaction: nextUserReaction, reactions: counts }
      })
      return { ...prev, posts: updatedPosts }
    })

    try{
      const form = new URLSearchParams({ post_id: String(postId), reaction })
      const r = await fetch('/add_reaction', { method: 'POST', credentials: 'include', headers: { 'Content-Type':'application/x-www-form-urlencoded' }, body: form })
      const j = await r.json().catch(()=>null)
      if (!j?.success) return
      // Reconcile with server counts
      setData((prev:any) => {
        if (!prev) return prev
        const updatedPosts = (prev.posts || []).map((p: any) => {
          if (p.id !== postId) return p
          const nextPost: any = { ...p, reactions: { ...p.reactions, ...j.counts }, user_reaction: j.user_reaction }
          if (typeof j.view_count === 'number') {
            nextPost.view_count = j.view_count
            nextPost.has_viewed = true
          }
          return nextPost
        })
        return { ...prev, posts: updatedPosts }
      })
    }catch{}
  }

  // Reply reactions handled inside PostDetail page

  async function handlePollVote(postId: number, pollId: number, optionId: number){
    // Optimistic update for poll vote
    setData((prev:any) => {
      if (!prev) return prev
      const updatedPosts = (prev.posts || []).map((p: any) => {
        if (p.id !== postId || !p.poll) return p
        const poll = p.poll
        
        // Find the option being clicked
        const clickedOption = poll.options.find((opt: any) => opt.id === optionId)
        const hasVotedOnThisOption = clickedOption?.user_voted || false
        
        const sv = (poll as any)?.single_vote
        const isSingle = (sv === true || sv === 1 || sv === '1' || sv === 'true')
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
          if (isSingle && opt.user_voted && opt.id !== optionId) {
            return { ...opt, votes: Math.max(0, opt.votes - 1), user_voted: false }
          }
          return opt
        })
        
        // Update user_vote for single vote polls
        const newUserVote = hasVotedOnThisOption ? null : optionId
        return { ...p, poll: { ...poll, options: updatedOptions, user_vote: isSingle ? newUserVote : poll.user_vote } }
      })
      return { ...prev, posts: updatedPosts }
    })

    // Send vote to server
    try{
      const res = await fetch('/vote_poll', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ poll_id: pollId, option_id: optionId }) })
      const j = await res.json().catch(()=>null)
      if (!j?.success) return
      if (Array.isArray(j.poll_results)){
        // Reconcile this post's poll counts with server truth without full reload
        setData((prev:any) => {
          if (!prev) return prev
          const updatedPosts = (prev.posts || []).map((p: any) => {
            if (p.id !== postId || !p.poll) return p
            const rows = j.poll_results as Array<any>
            const newOptions = p.poll.options.map((opt:any) => {
              const row = rows.find(r => r.id === opt.id)
              return row ? { ...opt, votes: row.votes, user_voted: (row.user_voted ? true : false) } : opt
            })
            const newUserVote = typeof rows[0]?.user_vote !== 'undefined' ? (rows[0].user_vote || null) : p.poll.user_vote
            const totalVotes = rows[0]?.total_votes ?? newOptions.reduce((a:number, b:any) => a + (b.votes||0), 0)
            return { ...p, poll: { ...p.poll, options: newOptions, user_vote: newUserVote, total_votes: totalVotes } }
          })
          return { ...prev, posts: updatedPosts }
        })
      }
    }catch{}
  }

  const postsOnly = useMemo(() => Array.isArray(data?.posts) ? data.posts : [], [data])
  const INITIAL_POST_LIMIT = 40
  const LOAD_MORE_STEP = 20
  const [visiblePostCount, setVisiblePostCount] = useState(INITIAL_POST_LIMIT)
  useEffect(() => {
    setVisiblePostCount(INITIAL_POST_LIMIT)
    recordedViewsRef.current.clear()
  }, [data?.posts])
  const visiblePosts = useMemo(() => postsOnly.slice(0, visiblePostCount), [postsOnly, visiblePostCount])

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading</div>
  if (error) return <div className="p-4 text-red-400">{error || 'Failed to load feed.'}</div>
  if (!data) return <div className="p-4 text-[#9fb0b5]">No posts yet.</div>

  async function runSearch(){
    const term = (q || '').trim()
    if (!term || !community_id) { setResults([]); return }
    try{
      const r = await fetch(`/api/community_posts_search?community_id=${community_id}&q=${encodeURIComponent(term)}`, { credentials:'include' })
      const j = await r.json().catch(()=>null)
      if (j?.success) setResults(j.posts||[])
      else setResults([])
    }catch{ setResults([]) }
  }

  function scrollToPost(postId: number){
    try{
      const el = document.getElementById(`post-${postId}`)
      if (el){ el.scrollIntoView({ behavior:'smooth', block:'start' }) }
      setShowSearch(false)
    }catch{}
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white pb-safe flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 px-4">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-white/10 rounded-full"></div>
            <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-[#4db6ac] rounded-full animate-spin"></div>
          </div>
          <div className="text-center">
            <div className="text-lg font-medium text-white/90 mb-1">Loading Community Feed</div>
            <div className="text-sm text-white/50">Please wait...</div>
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-black text-white pb-safe flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 px-4 text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/10 border-2 border-red-500/30 flex items-center justify-center">
            <i className="fa-solid fa-exclamation-triangle text-2xl text-red-400" />
          </div>
          <div>
            <div className="text-lg font-medium text-white/90 mb-1">Failed to Load Feed</div>
            <div className="text-sm text-white/50">{error}</div>
          </div>
          <button 
            onClick={() => window.location.reload()} 
            className="px-4 py-2 rounded-lg bg-[#4db6ac] text-black font-medium hover:brightness-110"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white pb-safe">
      {(refreshHint || isRefreshing) && (
        <div 
          className="fixed top-[72px] left-0 right-0 z-50 flex items-center justify-center pointer-events-none transition-transform duration-150"
          style={{ transform: `translateY(${Math.min(pullPx * 0.3, 20)}px)` }}
        >
            <div className="px-3 py-1.5 text-xs rounded-full bg-black/80 border border-white/15 text-white/80 flex items-center gap-2">
              {isRefreshing ? (
                <>
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Refreshing…</span>
                </>
              ) : (
                <>
                  <i className="fa-solid fa-arrow-down text-[10px]" />
                  <span>Release to refresh</span>
                </>
              )}
            </div>
        </div>
      )}
      {/* Scrollable content area below fixed global header */}
      <div
        ref={scrollRef}
        className={`app-content max-w-2xl mx-auto ${highlightStep === 'reaction' ? 'overflow-hidden' : ''} no-scrollbar pb-24 px-3`}
        style={{
          WebkitOverflowScrolling: 'touch' as any,
          overflowY: highlightStep === 'reaction' ? 'hidden' : 'auto',
          overscrollBehaviorY: 'auto',
          touchAction: highlightStep === 'reaction' ? 'none' : 'pan-y',
          paddingTop: `calc(var(--app-content-gap, 8px) + ${pullPx}px)`,
        }}
      >
        <div className="space-y-3">
          {/* Back button + Search */}
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-sm hover:bg-white/10"
              onClick={()=> {
                // Navigate to the root parent's timeline page
                // Use root_parent_id to always go to the top-level parent community
                const rootParentId = data?.root_parent_id
                const targetId = rootParentId || data?.community?.parent_community_id || community_id
                navigate(`/communities?parent_id=${targetId}`)
              }}
            >
              <i className="fa-solid fa-arrow-left mr-1" /> Back to Community
            </button>
            <button className="ml-auto p-2 rounded-full border border-white/10 hover:bg-white/10" aria-label="Search"
              onClick={()=> { setShowSearch(true); setTimeout(()=>{ try{ (document.getElementById('hashtag-input') as HTMLInputElement)?.focus() }catch{} }, 50) }}>
              <i className="fa-solid fa-magnifying-glass" />
            </button>
          </div>
          <input
            ref={storyFileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={handleStoryFileChange}
          />
          {/* Top header image from legacy template */}
          {data.community?.background_path ? (
            <div className="community-header-image overflow-hidden rounded-xl border border-white/10 mb-3 relative">
              {/* Dark overlay during reaction highlight */}
              {highlightStep === 'reaction' && (
                <div className="absolute inset-0 bg-black/90 z-[45] pointer-events-none" />
              )}
              <img 
                src={
                  (() => {
                    const p = String(data.community.background_path || '').trim()
                    if (!p) return ''
                    if (p.startsWith('http')) return p
                    if (p.startsWith('/uploads') || p.startsWith('uploads/')) return p.startsWith('/') ? p : `/${p}`
                    if (p.startsWith('/static')) return p
                    if (p.startsWith('static/')) return `/${p}`
                    const fname = p.split('/').slice(-1)[0]
                    return `/static/community_backgrounds/${fname}`
                  })()
                }
                alt={data.community?.name + ' Header'}
                className="block w-full h-auto header-image transition-transform duration-300 hover:scale-[1.015]"
                onError={(e:any)=>{ e.currentTarget.style.display='none' }}
                style={{ 
                  opacity: 1,
                  transition: 'opacity 0.3s ease-in-out'
                }}
                onLoad={(e) => {
                  // Hide loading overlay when image loads
                  const loadingOverlay = e.currentTarget.parentElement?.querySelector('.loading-overlay')
                  if (loadingOverlay) {
                    (loadingOverlay as HTMLElement).style.display = 'none'
                  }
                }}
              />
              
              {/* Loading overlay - same size as image container */}
              <div className="loading-overlay absolute inset-0 bg-white/5 flex items-center justify-center">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin"></div>
                  <div className="text-xs text-white/50">Loading header...</div>
                </div>
              </div>
            </div>
          ) : null}
          {/* Stories panel - below community header image */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 mb-3">
            <div className="flex gap-4 overflow-x-auto no-scrollbar">
              <button
                className="flex flex-col items-center gap-1 min-w-[60px] text-white/80"
                onClick={handleStoryUploadClick}
                disabled={storyUploading || !community_id}
              >
                <span className="w-14 h-14 rounded-full border-[3px] border-dashed border-white/25 flex items-center justify-center">
                  <i className="fa-solid fa-plus text-base" />
                </span>
                <span className="text-[11px] text-[#9fb0b5]">{storyUploading ? '...' : 'Add'}</span>
              </button>
              {storiesLoading && storyGroups.length === 0 ? (
                <div className="text-[10px] text-[#9fb0b5] flex items-center">Loading...</div>
              ) : storyGroups.length === 0 ? (
                <div className="text-[10px] text-[#9fb0b5] flex items-center">No stories</div>
              ) : storyGroups.map((group, idx) => (
                <button
                  key={`${group.username}-${idx}`}
                  className="flex flex-col items-center gap-1 min-w-[60px]"
                  onClick={() => openStory(idx, 0)}
                >
                  <span className={`w-14 h-14 rounded-full border-[3px] ${group.has_unseen ? 'border-[#4db6ac]' : 'border-white/20'} p-0.5`}>
                    <Avatar
                      username={group.username}
                      url={group.profile_picture || undefined}
                      size={48}
                      linkToProfile={false}
                    />
                  </span>
                  <span className="text-[11px] text-[#cfd8dc] truncate max-w-[56px]">@{group.username}</span>
                </button>
              ))}
            </div>
            {storyError && (
              <div className="text-[10px] text-red-400 mt-1">{storyError}</div>
            )}
          </div>

            {/* Feed items */}
            {postsOnly.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4">
                <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                  <i className="fa-regular fa-comment-dots text-3xl text-white/30" />
                </div>
                <h3 className="text-lg font-medium text-white/80 mb-2">No posts yet</h3>
                <p className="text-sm text-white/50 text-center max-w-xs mb-6">
                  Be the first to share something with this community!
                </p>
                <button
                  onClick={() => navigate(`/compose?community_id=${community_id}`)}
                  className="px-4 py-2 bg-[#4db6ac] text-black rounded-lg text-sm font-medium hover:brightness-110"
                >
                  <i className="fa-solid fa-plus mr-2" />
                  Create First Post
                </button>
              </div>
            ) : visiblePosts.map((p: Post, idx: number) => (
              <div key={p.id} className="relative">
                <PostCard
                  post={p}
                  idx={idx}
                  currentUser={data.username}
                  isAdmin={!!(data?.is_community_admin || data?.community?.creator_username === data?.username || data?.username === 'admin')}
                  highlightStep={highlightStep}
                  onOpen={() => {
                    markPostViewed(p.id, p.has_viewed)
                    navigate(`/post/${p.id}`)
                  }}
                  onToggleReaction={handleToggleReaction}
                  onPollVote={handlePollVote}
                  communityId={community_id}
                  navigate={navigate}
                  onSummaryUpdate={(postId, summary) => {
                    setData((prevData: any) => ({
                      ...prevData,
                      posts: prevData.posts.map((postEntry: any) =>
                        postEntry.id === postId ? { ...postEntry, audio_summary: summary } : postEntry,
                      ),
                    }))
                  }}
                  onPollClick={() => navigate(`/community/${community_id}/polls_react`)}
                  onOpenVoters={openVoters}
                  onAddReply={onAddReply}
                  onOpenReactions={() => {
                    markPostViewed(p.id, p.has_viewed)
                    openReactors(p.id)
                  }}
                  onPreviewImage={setPreviewImageSrc}
                  onMarkViewed={markPostViewed}
                  onDeletePost={handleDeletePost}
                  onDeletePoll={handleDeletePoll}
                />
                {/* Dark overlay for all posts except first one during reaction highlight */}
                {highlightStep === 'reaction' && idx !== 0 && (
                  <div className="absolute inset-0 bg-black/90 z-[45] pointer-events-none" />
                )}
              </div>
            ))}
            {visiblePostCount < postsOnly.length && (
              <div className="flex justify-center py-6">
                <button
                  className="px-4 py-2 rounded-full border border-white/20 text-sm hover:bg-white/5"
                  onClick={() => setVisiblePostCount(count => Math.min(count + LOAD_MORE_STEP, postsOnly.length))}
                >
                  Load older posts
                </button>
              </div>
            )}
        </div>
      </div>

      {/* Members modal removed: dedicated page now */}

      {/* Image preview overlay for feed/replies */}
      {previewImageSrc && (
        <div className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-sm flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && setPreviewImageSrc(null)}>
          <button className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white flex items-center justify-center" onClick={()=> setPreviewImageSrc(null)} aria-label="Close preview">
            <i className="fa-solid fa-xmark" />
          </button>
          <div className="w-[94vw] h-[86vh] max-w-4xl" style={{ touchAction: 'none' }}>
            <ZoomableImage src={previewImageSrc} alt="preview" className="w-full h-full" onRequestClose={()=> setPreviewImageSrc(null)} />
          </div>
        </div>
      )}
      {activeStoryPointer && currentStory && (
        <div
          className="fixed inset-0 z-[120] bg-black/95 flex flex-col"
          onClick={handleStoryBackdropClick}
        >
          <button
            className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/10 border border-white/20 text-white hover:bg-white/20 flex items-center justify-center z-[130]"
            onClick={closeStoryViewer}
            aria-label="Close story"
          >
            <i className="fa-solid fa-xmark text-lg" />
          </button>
          <div className="flex-1 flex items-center justify-center p-4 pt-16 pb-6">
            <div ref={storyContentRef} className="w-full max-w-md">
              <div className="flex gap-1 mb-3">
                {(currentStoryGroup?.stories || []).map((story, idx) => (
                  <div
                    key={story.id}
                    className={`flex-1 h-1 rounded-full ${idx <= (activeStoryPointer?.storyIndex ?? 0) ? 'bg-white' : 'bg-white/30'}`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-3 mb-3">
                <Avatar
                  username={currentStory.username}
                  url={currentStory.profile_picture || undefined}
                  size={36}
                  linkToProfile
                />
                <div className="flex-1">
                  <div className="font-semibold tracking-tight text-sm">{currentStory.username}</div>
                  <div className="text-xs text-[#9fb0b5]">
                    {currentStory.created_at ? formatSmartTime(currentStory.created_at) : null}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="text-xs text-[#cfd8dc] flex items-center gap-1 hover:text-white transition-colors"
                    onClick={() => openStoryViewers(currentStory.id)}
                  >
                    <i className="fa-regular fa-eye" />
                    <span>{currentStory.view_count ?? 0}</span>
                  </button>
                  {(currentStory.username?.toLowerCase() === data?.username?.toLowerCase()) && (
                    <button
                      className="w-8 h-8 rounded-full bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 flex items-center justify-center disabled:opacity-50"
                      onClick={() => handleDeleteStory(currentStory.id)}
                      disabled={deletingStory}
                      aria-label="Delete story"
                    >
                      <i className={`fa-solid ${deletingStory ? 'fa-spinner fa-spin' : 'fa-trash'} text-sm`} />
                    </button>
                  )}
                </div>
              </div>
              <div
                className="group relative rounded-2xl border border-white/10 overflow-hidden bg-black/40 min-h-[200px] flex items-center justify-center mt-6"
                onPointerDown={handleStoryPointerDown}
                onPointerUp={handleStoryPointerUp}
                onPointerLeave={handleStoryPointerCancel}
                onPointerCancel={handleStoryPointerCancel}
              >
                {currentStory.media_type === 'video' ? (
                  <>
                    <video
                      key={currentStory.id}
                      src={resolveStoryMediaSrc(currentStory)}
                      className="w-full max-h-[50vh] object-contain relative z-[1]"
                      autoPlay
                      playsInline
                      muted
                      controls
                      preload="auto"
                      onLoadedData={(e) => {
                        const container = e.currentTarget.parentElement
                        const loader = container?.querySelector('.video-loader') as HTMLElement
                        if (loader) loader.style.display = 'none'
                      }}
                      onWaiting={(e) => {
                        const container = e.currentTarget.parentElement
                        const loader = container?.querySelector('.video-loader') as HTMLElement
                        if (loader) loader.style.display = 'flex'
                      }}
                      onPlaying={(e) => {
                        const container = e.currentTarget.parentElement
                        const loader = container?.querySelector('.video-loader') as HTMLElement
                        if (loader) loader.style.display = 'none'
                      }}
                    />
                    <div className="video-loader absolute inset-0 flex items-center justify-center bg-black/60 z-[2]">
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
                        <span className="text-xs text-white/60">Loading video...</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <img
                    key={currentStory.id}
                    src={resolveStoryMediaSrc(currentStory)}
                    alt="Story media"
                    className="w-full max-h-[50vh] object-contain"
                    loading="eager"
                  />
                )}
                {/* Text overlays */}
                {currentStory.text_overlays && currentStory.text_overlays.map(overlay => (
                  <div
                    key={overlay.id}
                    className="absolute pointer-events-none z-[4]"
                    style={{
                      left: `${overlay.x}%`,
                      top: `${overlay.y}%`,
                      transform: `translate(-50%, -50%) rotate(${overlay.rotation}deg)`,
                      fontSize: `${overlay.fontSize}px`,
                      color: overlay.color,
                      fontFamily: overlay.fontFamily,
                      textShadow: '0 2px 4px rgba(0,0,0,0.5)',
                      WebkitTextStroke: '0.5px rgba(0,0,0,0.3)',
                    }}
                  >
                    <span className="whitespace-nowrap">{overlay.text}</span>
                  </div>
                ))}
                {/* Location overlay */}
                {currentStory.location_data && (
                  <div
                    className="absolute pointer-events-none z-[4] bg-black/50 backdrop-blur-sm px-3 py-1.5 rounded-full border border-white/20"
                    style={{
                      left: `${currentStory.location_data.x}%`,
                      top: `${currentStory.location_data.y}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    <span className="text-white text-sm flex items-center gap-1.5">
                      <i className="fa-solid fa-location-dot text-[#4db6ac]" />
                      {currentStory.location_data.name}
                    </span>
                  </div>
                )}
                {/* Subtle tap zone indicators */}
                {hasPrevStory && (
                  <div className="absolute left-0 top-0 bottom-0 w-[40%] z-[3] pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-black/20 to-transparent" />
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center">
                      <i className="fa-solid fa-chevron-left text-white text-sm" />
                    </div>
                  </div>
                )}
                {hasNextStory && (
                  <div className="absolute right-0 top-0 bottom-0 w-[40%] z-[3] pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="absolute inset-y-0 right-0 w-full bg-gradient-to-l from-black/20 to-transparent" />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center">
                      <i className="fa-solid fa-chevron-right text-white text-sm" />
                    </div>
                  </div>
                )}
              </div>
              {currentStory.caption && (
                <div className="mt-3 text-sm text-white/90 whitespace-pre-wrap break-words max-h-20 overflow-y-auto">{currentStory.caption}</div>
              )}
              <div className="mt-4">
                <div className="flex flex-wrap justify-center gap-2">
                  {STORY_REACTIONS.map(reaction => {
                    const count = currentStory.reactions?.[reaction] ?? 0
                    const isActive = currentStory.user_reaction === reaction
                    return (
                      <button
                        key={reaction}
                        type="button"
                        className={`px-3 py-1 rounded-full border flex items-center gap-1 text-sm transition-colors ${
                          isActive ? 'bg-white text-black border-white' : 'border-white/20 text-white/80 hover:bg-white/10'
                        }`}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleStoryReaction(currentStory, reaction)
                        }}
                      >
                        <span className="text-base leading-none">{reaction}</span>
                        {count > 0 && <span className="text-xs font-semibold">{count}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {storyViewersState.open && (
        <div
          className="fixed inset-0 z-[130] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeStoryViewersModal()
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b0b0b] p-5 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <div className="text-white font-semibold text-lg">Story viewers</div>
              <button
                className="w-8 h-8 rounded-full border border-white/20 text-white/70 hover:bg-white/10 flex items-center justify-center"
                onClick={closeStoryViewersModal}
                aria-label="Close viewers modal"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            {storyViewersState.loading ? (
              <div className="flex items-center justify-center py-6 text-white/70 gap-2">
                <i className="fa-solid fa-spinner fa-spin" />
                Loading viewers...
              </div>
            ) : storyViewersState.error ? (
              <div className="text-sm text-red-300">{storyViewersState.error}</div>
            ) : storyViewersState.viewers.length === 0 ? (
              <div className="text-sm text-white/70">No viewers yet.</div>
            ) : (
              <div className="space-y-3">
                {storyViewersState.viewers.map(viewer => (
                  <div key={`${viewer.username}-${viewer.viewed_at || ''}`} className="flex items-center gap-3">
                    <Avatar username={viewer.username} url={viewer.profile_picture || undefined} size={36} />
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-sm font-medium truncate">{viewer.username}</div>
                      <div className="text-xs text-white/60">{formatViewerRelative(viewer.viewed_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Story Editor Modal */}
      {storyEditorOpen && storyEditorFiles.length > 0 && (
        <div 
          className="fixed left-0 right-0 z-[1100] bg-black" 
          style={{ 
            top: 'var(--app-header-height, 56px)', 
            bottom: 0,
            display: 'flex', 
            flexDirection: 'column',
            paddingBottom: keyboardHeight ? `${keyboardHeight}px` : 'env(safe-area-inset-bottom, 0px)'
          }}
        >
          {/* Header - compact and black */}
          <div 
            className="w-full bg-black px-4 py-3 flex items-center justify-between flex-shrink-0 border-b border-white/10"
          >
            <button
              onClick={handleStoryEditorClose}
              className="text-white font-medium text-sm"
            >
              Cancel
            </button>
            {!storyEditorFiles[storyEditorActiveIndex]?.locationData && (
              <button
                type="button"
                onClick={fetchDeviceLocation}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white/90 hover:bg-white/15 text-xs"
              >
                <i className="fa-solid fa-location-dot text-sm" />
              </button>
            )}
            <button
              onClick={handleStoryEditorPublish}
              disabled={storyUploading}
              className="px-4 py-1.5 rounded-xl bg-[#4db6ac] text-black font-semibold text-sm hover:brightness-110 disabled:opacity-50"
            >
              {storyUploading ? 'Posting...' : 'Share'}
            </button>
          </div>
          
          {/* Media preview with overlays */}
          <div className="flex items-center justify-center overflow-hidden px-6" style={{ flex: '1 1 0%', minHeight: 0, pointerEvents: 'none', paddingTop: '48px', paddingBottom: keyboardHeight ? '20px' : (storyEditorFiles.length > 1 ? '30px' : '120px') }}>
            <div 
              ref={storyEditorMediaRef}
              className="relative aspect-[9/16] bg-black/50 rounded-2xl overflow-hidden border border-white/10"
              style={{ 
                touchAction: storyEditorDragging ? 'none' : 'auto', 
                pointerEvents: 'auto',
                width: 'min(100%, 500px)',
                maxHeight: '100%'
              }}
            >
              {storyEditorFiles[storyEditorActiveIndex]?.type === 'video' ? (
                <video
                  src={storyEditorFiles[storyEditorActiveIndex]?.preview}
                  className="w-full h-full object-contain"
                  autoPlay
                  muted
                  loop
                  playsInline
                />
              ) : (
                <img
                  src={storyEditorFiles[storyEditorActiveIndex]?.preview}
                  alt="Story preview"
                  className="w-full h-full object-contain"
                />
              )}
              
              {/* Text overlays - feature disabled */}
              {/* {storyEditorFiles[storyEditorActiveIndex]?.textOverlays.map(overlay => (...))} */}
              
              {/* Location overlay */}
              {storyEditorFiles[storyEditorActiveIndex]?.locationData && (
                <div
                  className="absolute cursor-move select-none bg-black/70 backdrop-blur-md px-4 py-2 rounded-md shadow-lg"
                  style={{
                    left: `${storyEditorFiles[storyEditorActiveIndex].locationData!.x}%`,
                    top: `${storyEditorFiles[storyEditorActiveIndex].locationData!.y}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  onPointerDown={(e) => handleOverlayDrag(e, 'location')}
                >
                  <span className="text-white font-medium text-sm flex items-center gap-2">
                    <i className="fa-solid fa-location-dot text-[#4db6ac] text-base" />
                    {storyEditorFiles[storyEditorActiveIndex].locationData!.name}
                  </span>
                  <button
                    className="absolute -top-2 -right-8 w-6 h-6 rounded-full bg-black/80 border border-white/30 text-white/90 text-xs flex items-center justify-center hover:bg-black hover:border-white/50 transition-colors"
                    onClick={(e) => { 
                      e.stopPropagation()
                      setLocationInputValue(storyEditorFiles[storyEditorActiveIndex].locationData!.name)
                      setShowLocationInput(true)
                    }}
                  >
                    <i className="fa-solid fa-pencil" />
                  </button>
                  <button
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-black/80 border border-white/30 text-white/90 text-xs flex items-center justify-center hover:bg-black hover:border-white/50 transition-colors"
                    onClick={(e) => { e.stopPropagation(); setLocationData(null); }}
                  >
                    <i className="fa-solid fa-xmark" />
                  </button>
                </div>
              )}
            </div>
          </div>
          
          {/* Thumbnails strip for multiple files */}
          {storyEditorFiles.length > 1 && (
            <div className="px-4 py-2 border-t border-white/10 bg-black" style={{ flexShrink: 0, marginBottom: 'env(safe-area-inset-bottom, 0px)' }}>
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {storyEditorFiles.map((file, idx) => (
                  <div key={idx} className="relative flex-shrink-0">
                    <button
                      onClick={() => setStoryEditorActiveIndex(idx)}
                      className={`relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 border-2 ${
                        idx === storyEditorActiveIndex ? 'border-[#4db6ac]' : 'border-white/20'
                      }`}
                    >
                      {file.type === 'video' ? (
                        <video src={file.preview} className="w-full h-full object-cover" muted />
                      ) : (
                        <img src={file.preview} alt="" className="w-full h-full object-cover" />
                      )}
                      {file.type === 'video' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
                          <i className="fa-solid fa-play text-white text-xs" />
                        </div>
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        removeStoryEditorFile(idx)
                      }}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/80 text-white/90 text-xs flex items-center justify-center hover:bg-black border border-white/30"
                      style={{ zIndex: 10 }}
                    >
                      <i className="fa-solid fa-xmark" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Tools panel */}
          <div className="px-4 border-t border-white/10 space-y-4 absolute left-0 right-0 bg-black" style={{ bottom: keyboardHeight ? `${keyboardHeight}px` : '0', zIndex: 9999, paddingTop: '20px', paddingBottom: keyboardHeight ? '8px' : 'max(20px, env(safe-area-inset-bottom, 0px))', pointerEvents: 'auto' }}>
            {/* Caption input */}
            <div>
              <input
                type="text"
                value={storyEditorFiles[storyEditorActiveIndex]?.caption || ''}
                onChange={(e) => updateActiveStoryEditorFile({ caption: e.target.value })}
                placeholder="Add a caption..."
                maxLength={500}
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 text-sm focus:outline-none focus:border-[#4db6ac]/50"
              />
            </div>
            
            {storyEditorFiles[storyEditorActiveIndex]?.locationData && (
              <p className="text-xs text-white/40 text-center">
                Drag location to reposition it on the image
              </p>
            )}
          </div>

          {/* Location Input Modal */}
          {showLocationInput && (
            <div className="fixed inset-0 z-[1200] bg-black/80 backdrop-blur-sm flex items-center justify-center px-4">
              <div className="bg-[#1a1a1a] rounded-2xl border border-white/10 p-6 w-full max-w-sm">
                <h3 className="text-white font-semibold text-lg mb-4">Add Location</h3>
                <input
                  type="text"
                  value={locationInputValue}
                  onChange={(e) => setLocationInputValue(e.target.value)}
                  placeholder="Enter location name..."
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl bg-black/50 border border-white/20 text-white placeholder:text-white/40 text-sm focus:outline-none focus:border-[#4db6ac]/50 mb-4"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && locationInputValue.trim()) {
                      setLocationData({ name: locationInputValue.trim(), x: 50, y: 85 })
                      setLocationInputValue('')
                      setShowLocationInput(false)
                    }
                    if (e.key === 'Escape') {
                      setLocationInputValue('')
                      setShowLocationInput(false)
                    }
                  }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setLocationInputValue('')
                      setShowLocationInput(false)
                    }}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 text-sm font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (locationInputValue.trim()) {
                        setLocationData({ name: locationInputValue.trim(), x: 50, y: 85 })
                        setLocationInputValue('')
                        setShowLocationInput(false)
                      }
                    }}
                    disabled={!locationInputValue.trim()}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-[#4db6ac] text-black font-semibold text-sm hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Announcements modal */}
      {showAnnouncements && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && _setShowAnnouncements(false)}>
            <div className="w-[92%] max-w-[560px] rounded-2xl border border-white/10 bg-black p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">Announcements</div>
                <button className="px-2 py-1 rounded-full border border-white/10" onClick={()=> _setShowAnnouncements(false)}>Close</button>
              </div>
              {(data?.is_community_admin || data?.community?.creator_username === data?.username || data?.username === 'admin') && (
                <div className="mb-3 p-2 rounded-xl border border-white/10 bg-white/[0.02]">
                  <textarea value={newAnnouncement} onChange={(e)=> setNewAnnouncement(e.target.value)} placeholder="Write an announcement..." className="w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm focus:border-teal-400/70 outline-none min-h-[72px]" />
                  <div className="text-right mt-2">
                    <button disabled={savingAnn || !newAnnouncement.trim()} onClick={saveAnnouncement} className="px-3 py-1.5 rounded-md bg-[#4db6ac] disabled:opacity-50 text-black text-sm hover:brightness-110">Post</button>
                  </div>
                </div>
              )}
              <div className="space-y-3 max-h-[420px] overflow-y-auto">
                {_announcements.length === 0 ? (
                  <div className="text-sm text-[#9fb0b5]">No announcements.</div>
                ) : _announcements.map((a:any)=> (
                  <div key={a.id} className="rounded-xl border border-white/10 p-3 bg-white/[0.03]">
                    <div className="text-xs text-[#9fb0b5] mb-1">{a.created_by} - {(() => { try { const d = new Date(a.created_at); if (!isNaN(d.getTime())) return d.toLocaleDateString(); } catch { } const s = String(a.created_at||'').split(' '); return s[0] || String(a.created_at||''); })()}</div>
                    <div className="whitespace-pre-wrap text-sm">{a.content}</div>
                    {(data?.is_community_admin || data?.community?.creator_username === data?.username || data?.username === 'admin') && (
                      <div className="mt-2 text-right">
                        <button className="px-2 py-1 rounded-full border border-white/10 text-xs hover:bg-white/5" onClick={()=> deleteAnnouncement(a.id)}>Delete</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
        </div>
      )}

      {/* Search modal */}
      {showSearch && (
        <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && setShowSearch(false)}>
          <div className="w-[92%] max-w-[560px] rounded-2xl border border-white/10 bg-black p-3">
            <div className="flex items-center gap-2 mb-2">
              <i className="fa-solid fa-hashtag text-[#4db6ac]" />
              <input id="hashtag-input" value={q} onChange={(e)=> setQ(e.target.value)} placeholder="#hashtag" className="flex-1 rounded-md bg-black border border-white/10 px-3 py-2 text-sm focus:border-teal-400/70 outline-none" />
              <button className="px-3 py-2 rounded-md bg-[#4db6ac] text-black text-sm hover:brightness-110" onClick={runSearch}>Search</button>
            </div>
              <div className="max-h-[320px] overflow-y-auto space-y-2">
                {results.length === 0 ? (
                  <div className="text-[#9fb0b5] text-sm">No results</div>
                ) : results.map(r => (
                  <button key={r.id} className="w-full text-left rounded-xl border border-white/10 p-2 hover:bg-white/5" onClick={()=> scrollToPost(r.id)}>
                    <div className="text-sm text-white/90 truncate">{r.content}</div>
                    <div className="text-xs text-[#9fb0b5]">{r.username} - {formatSmartTime(r.timestamp)}</div>
                  </button>
                ))}
              </div>
          </div>
        </div>
      )}

      {/* Highlight overlay - Reaction Step */}
      {highlightStep === 'reaction' && (
        <>
          {/* Full-screen blocker - blocks all clicks except specific elements */}
          <div className="fixed inset-0 z-[48] pointer-events-auto" onClick={(e)=> e.stopPropagation()} />
          
          {/* Dark cover above the highlighted post (covers back button and community logo) */}
          <div className="fixed top-[56px] left-0 right-0 h-[30vh] z-[50] bg-black/90 pointer-events-none" />
          
          {/* Instruction prompt and Next button */}
          <div className="fixed top-[15%] left-1/2 transform -translate-x-1/2 z-[51] text-center w-[90%] max-w-sm pointer-events-auto">
            <div className="text-white text-base font-medium px-6 py-3 rounded-xl bg-black/70 backdrop-blur-md border border-[#4db6ac]/30 shadow-lg mb-3">
              React to a post <span className="text-[#4db6ac] text-sm ml-2">(1/2)</span>
            </div>
            <div className="flex gap-3 justify-center">
              <button 
                className="px-6 py-2 rounded-full bg-[#4db6ac]/50 text-white text-sm font-medium hover:bg-[#4db6ac]/70 shadow-[0_0_20px_rgba(77,182,172,0.6)] hover:shadow-[0_0_30px_rgba(77,182,172,0.8)]"
                onClick={()=> setHighlightStep('post')}
              >
                Next
              </button>
              <button 
                className="px-6 py-2 rounded-full border border-white/20 bg-white/[0.08] text-white text-sm font-medium hover:bg-white/[0.12]"
                onClick={()=> {
                  setHighlightStep(null);
                  try { 
                    const username = data?.username || '';
                    const doneKey = username ? `onboarding_done:${username}` : 'onboarding_done';
                    localStorage.setItem(doneKey, '1');
                  } catch {}
                }}
              >
                Skip
              </button>
            </div>
          </div>
        </>
      )}

      {/* Highlight overlay - Post Creation Step */}
      {highlightStep === 'post' && (
        <div className="fixed inset-0 z-[39] bg-black/85">
          {/* Description near the glowing button at bottom */}
          <div className="fixed bottom-32 left-1/2 transform -translate-x-1/2 text-center w-[90%] max-w-sm">
            <div className="text-white text-base font-medium px-6 py-3 rounded-xl bg-black/70 backdrop-blur-md border border-[#4db6ac]/30 shadow-lg">
              Click here to Create Your First Post <span className="text-[#4db6ac] text-sm ml-2">(2/2)</span>
            </div>
            <div className="w-1 h-12 mx-auto bg-gradient-to-b from-[#4db6ac]/50 to-transparent" />
          </div>
          
          {/* Action buttons at top */}
          <div className="absolute top-[15%] left-1/2 transform -translate-x-1/2 w-[90%] max-w-sm">
            <div className="flex justify-center">
              <button 
                className="px-8 py-2.5 rounded-full border border-white/20 bg-white/[0.08] text-white font-medium hover:bg-white/[0.12]"
                onClick={()=> {
                  setHighlightStep(null);
                  // Mark onboarding as complete
                  try { 
                    const username = data?.username || '';
                    const doneKey = username ? `onboarding_done:${username}` : 'onboarding_done';
                    localStorage.setItem(doneKey, '1');
                  } catch {}
                }}
              >
                Skip for now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom navigation bar - fixed at bottom like WhatsApp */}
      <div 
        className="fixed bottom-0 left-0 right-0 z-[100] px-3 sm:px-6"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)', touchAction: 'manipulation' }}
      >
        <div className="liquid-glass-surface border border-white/10 rounded-2xl shadow-[0_-10px_40px_rgba(0,0,0,0.45)] max-w-2xl mx-auto mb-2">
          <div className="h-14 px-2 sm:px-6 flex items-center justify-between text-[#cfd8dc]">
            <button className="p-3 rounded-full hover:bg-white/10 active:bg-white/15 transition-colors" aria-label="Home" onClick={()=> scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
            <i className="fa-solid fa-house text-lg" />
          </button>
            <button className="p-3 rounded-full hover:bg-white/10 active:bg-white/15 transition-colors" aria-label="Members" onClick={()=> navigate(`/community/${community_id}/members`)}>
            <i className="fa-solid fa-users text-lg" />
          </button>
          <button 
              className={`w-10 h-10 rounded-md bg-[#4db6ac] text-black hover:brightness-110 grid place-items-center transition-all ${highlightStep === 'post' ? 'ring-[6px] ring-[#4db6ac] shadow-[0_0_40px_rgba(77,182,172,0.8)] animate-pulse scale-125 z-[40] relative' : ''}`}
            aria-label="New Post" 
            onClick={()=> { 
              const isFromOnboarding = highlightStep === 'post'
              if (isFromOnboarding) {
                setHighlightStep(null);
                // Mark onboarding as complete
                try { 
                  const username = data?.username || '';
                  const doneKey = username ? `onboarding_done:${username}` : 'onboarding_done';
                  localStorage.setItem(doneKey, '1');
                } catch {}
              }
              // Add first_post param if from onboarding
              navigate(`/compose?community_id=${community_id}${isFromOnboarding ? '&first_post=true' : ''}`);
            }}
          >
            <i className="fa-solid fa-plus" />
          </button>
            <button className="relative p-3 rounded-full hover:bg-white/10 active:bg-white/15 transition-colors" aria-label="Announcements" onClick={()=> { fetchAnnouncements() }}>
            <span className="relative inline-block">
              <i className="fa-solid fa-bullhorn text-lg" style={hasUnseenAnnouncements ? { color:'#4db6ac' } : undefined} />
              {hasUnseenAnnouncements ? (<span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[#4db6ac] rounded-full" />) : null}
            </span>
          </button>
            <button className="p-3 rounded-full hover:bg-white/10 active:bg-white/15 transition-colors" aria-label="More" onClick={()=> setMoreOpen(true)}>
            <i className="fa-solid fa-ellipsis text-lg" />
          </button>
          </div>
        </div>
      </div>

      {/* Bottom sheet for More - appears above bottom nav */}
      {moreOpen && (
        <div className="fixed inset-0 z-[110] bg-black/30 flex items-end justify-end" onClick={(e)=> e.currentTarget===e.target && setMoreOpen(false)}>
          <div className="w-[75%] max-w-sm mr-2 bg-black/95 backdrop-blur border border-white/10 rounded-2xl p-2 space-y-2 transition-transform duration-200 ease-out translate-y-0" style={{ marginBottom: 'calc(70px + env(safe-area-inset-bottom))' }}>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/key_posts`) }}>
              Key Posts
            </button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5 flex items-center justify-end gap-2" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/polls_react`) }}>
              Polls
              {hasUnansweredPolls && <span className="w-2 h-2 bg-[#4db6ac] rounded-full" />}
            </button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/calendar_react`) }}>Calendar</button>
            {showTasks && (
              <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/tasks_react`) }}>Tasks</button>
            )}
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/photos_react`) }}>Photos</button>
            {/* Forum/Useful Links visibility */}
            {showResourcesSection && (
              <>
                <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/resources_react`) }}>Forum</button>
                <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${community_id}/useful_links_react`) }}>Useful Links & Docs</button>
              </>
            )}
            <EditCommunityButton communityId={String(community_id)} onClose={()=> setMoreOpen(false)} />
          </div>
        </div>
      )}

      {/* Voters modal */}
      {viewingVotersPollId && (
        <div className="fixed inset-0 z-[95] bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && setViewingVotersPollId(null)}>
            <div className="w-[92%] max-w-[560px] rounded-2xl border border-white/10 bg-black p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">Voters</div>
                <button className="px-2 py-1 rounded-full border border-white/10" onClick={()=> setViewingVotersPollId(null)}>Close</button>
              </div>
              {votersLoading ? (
                <div className="text-[#9fb0b5] text-sm">Loading voters...</div>
              ) : (
              <div className="space-y-3 max-h-[420px] overflow-y-auto">
                {votersData.length === 0 ? (
                  <div className="text-sm text-[#9fb0b5]">No voters yet.</div>
                ) : votersData.map(opt => (
                  <div key={opt.id} className="rounded-lg border border-white/10 p-2">
                    <div className="text-xs text-white/80 mb-1">{opt.option_text}</div>
                    <div className="flex flex-col gap-1">
                      {(opt.voters||[]).map(v => (
                        <div key={`${opt.id}-${v.username}-${v.voted_at||''}`} className="flex items-center gap-2 text-xs text-[#9fb0b5]">
                          <Avatar username={v.username} url={v.profile_picture || undefined} size={18} linkToProfile />
                          <div className="flex-1 truncate">@{v.username}</div>
                          {/* remove timestamp in feed voters modal */}
                          <div className="tabular-nums" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reaction details modal */}
      {reactorsPostId && (
        <div
          className="fixed inset-0 z-[95] bg-black/70 backdrop-blur flex items-center justify-center"
          onClick={(e)=> e.currentTarget===e.target && closeReactorsModal()}
        >
          <div className="w-[92%] max-w-[560px] rounded-2xl border border-white/10 bg-black p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">Reactions</div>
                <button
                  className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-sm text-white/80 hover:bg-white/10"
                  onClick={closeReactorsModal}
                  aria-label="Close reactions"
                >
                  <span className="leading-none">X</span>
                </button>
              </div>
            {reactorsLoading ? (
              <div className="text-[#9fb0b5] text-sm">Loading</div>
            ) : (
              <div className="space-y-3 max-h-[420px] overflow-y-auto">
                <div className="rounded-lg border border-white/10 p-2">
                  <div className="flex items-center justify-between text-xs text-white/80 uppercase tracking-wide">
                    <span>Views</span>
                    <span className="text-sm font-semibold text-white">{reactorViewCount ?? 0}</span>
                  </div>
                  {reactorViewers.length === 0 ? (
                    <div className="mt-2 text-xs text-[#9fb0b5]">No views yet.</div>
                  ) : (
                    <div className="mt-2 flex flex-col gap-1">
                      {reactorViewers.map((viewer) => {
                        const viewedLabel = formatViewerRelative(viewer.viewed_at)
                        return (
                          <div
                            key={`viewer-${viewer.username}-${viewer.viewed_at ?? ''}`}
                            className="flex items-center gap-2 text-xs text-[#9fb0b5]"
                          >
                            <Avatar
                              username={viewer.username}
                              url={viewer.profile_picture || undefined}
                              size={18}
                              linkToProfile
                            />
                            <div className="flex-1 truncate">@{viewer.username}</div>
                            {viewedLabel ? <div className="text-[10px] text-white/40">{viewedLabel}</div> : null}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
                {reactorGroups.length === 0 ? (
                  <div className="text-sm text-[#9fb0b5]">No reactions yet.</div>
                ) : reactorGroups.map((group) => (
                  <div key={group.reaction_type} className="rounded-lg border border-white/10 p-2">
                    <div className="text-xs text-white/80 mb-1 capitalize">{group.reaction_type.replace('-', ' ')}</div>
                    <div className="flex flex-col gap-1">
                      {(group.users || []).map((u) => (
                        <div key={`${group.reaction_type}-${u.username}`} className="flex items-center gap-2 text-xs text-[#9fb0b5]">
                          <Avatar username={u.username} url={u.profile_picture || undefined} size={18} linkToProfile />
                          <div className="flex-1 truncate">@{u.username}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ActionPill removed from UI in this layout

// Ad components removed

function PostCard({ post, idx, currentUser, isAdmin, highlightStep, onOpen, onToggleReaction, onPollVote, onPollClick, onOpenVoters, communityId, navigate, onAddReply, onOpenReactions, onPreviewImage, onSummaryUpdate, onMarkViewed, onDeletePost, onDeletePoll }: { post: Post & { display_timestamp?: string }, idx: number, currentUser: string, isAdmin: boolean, highlightStep: 'reaction' | 'post' | null, onOpen: ()=>void, onToggleReaction: (postId:number, reaction:string)=>void, onPollVote?: (postId:number, pollId:number, optionId:number)=>void, onPollClick?: ()=>void, onOpenVoters?: (pollId:number)=>void, communityId?: string, navigate?: any, onAddReply?: (postId:number, reply: Reply)=>void, onOpenReactions?: ()=>void, onPreviewImage?: (src:string)=>void, onSummaryUpdate?: (postId: number, summary: string) => void, onMarkViewed?: (postId: number, alreadyViewed?: boolean) => void, onDeletePost?: (postId: number) => void, onDeletePoll?: (postId: number, pollId: number) => void }) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const mediaInputRef = useRef<HTMLInputElement | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(post.content)
  const [editMediaFile, setEditMediaFile] = useState<File | null>(null)
  const [editMediaPreview, setEditMediaPreview] = useState<string | null>(null)
  const [removeMedia, setRemoveMedia] = useState(false)
  const [starring, setStarring] = useState(false)
  const [detectedLinks, setDetectedLinks] = useState<DetectedLink[]>([])
  const [renamingLink, setRenamingLink] = useState<DetectedLink | null>(null)
  const [linkDisplayName, setLinkDisplayName] = useState('')
  const [replyText, setReplyText] = useState('')
  const [replyGif, setReplyGif] = useState<GifSelection | null>(null)
  const [sendingReply, setSendingReply] = useState(false)
  const [activeChildReplyFor, setActiveChildReplyFor] = useState<number|null>(null)
  const [childReplyText, setChildReplyText] = useState('')
  useEffect(() => {
    if (!onMarkViewed) return
    if (post.has_viewed) return
    const el = cardRef.current
    if (!el) return

    if (typeof IntersectionObserver === 'undefined') {
      onMarkViewed(post.id, post.has_viewed)
      return
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          onMarkViewed(post.id, post.has_viewed)
          observer.disconnect()
        }
      })
    }, { threshold: 0.4 })

    observer.observe(el)
    return () => observer.disconnect()
  }, [onMarkViewed, post.id, post.has_viewed])
  const [childReplyGif, setChildReplyGif] = useState<GifSelection | null>(null)
  const [sendingChildReply, setSendingChildReply] = useState(false)
  const [gifPickerTarget, setGifPickerTarget] = useState<'main' | number | null>(null)

  // Detect links when editing
  useEffect(() => {
    if (!isEditing) {
      setDetectedLinks([])
      return
    }
    const links = detectLinks(editText)
    // Filter out video embed URLs (YouTube, Vimeo, TikTok)
    // Instagram is treated as regular link (can be renamed)
    const nonVideoLinks = links.filter(link => {
      const url = link.url.toLowerCase()
      return !url.includes('youtube.com') && 
             !url.includes('youtu.be') && 
             !url.includes('vimeo.com') &&
             !url.includes('tiktok.com')
    })
    setDetectedLinks(nonVideoLinks)
  }, [editText, isEditing])

  function startRenamingLink(link: DetectedLink) {
    setRenamingLink(link)
    setLinkDisplayName(link.displayText)
  }

  function saveRenamedLink() {
    if (!renamingLink) return
    const newContent = replaceLinkInText(editText, renamingLink.url, linkDisplayName)
    setEditText(newContent)
    setRenamingLink(null)
    setLinkDisplayName('')
  }

  function cancelRenaming() {
    setRenamingLink(null)
    setLinkDisplayName('')
  }

  function handleMediaSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setEditMediaFile(file)
    setRemoveMedia(false)
    // Create preview
    const url = URL.createObjectURL(file)
    setEditMediaPreview(url)
  }

  function clearEditMedia() {
    setEditMediaFile(null)
    if (editMediaPreview) {
      URL.revokeObjectURL(editMediaPreview)
      setEditMediaPreview(null)
    }
    if (mediaInputRef.current) mediaInputRef.current.value = ''
  }

  function cancelEdit() {
    setEditText(post.content)
    clearEditMedia()
    setRemoveMedia(false)
    setIsEditing(false)
  }

  useEffect(() => {
    setChildReplyGif(null)
  }, [activeChildReplyFor])

  async function toggleStar(e: React.MouseEvent){
    e.stopPropagation()
    if (starring) return
    setStarring(true)
    try{
      // Optimistic flip
      const prev = post.is_starred
      ;(post as any).is_starred = !prev
      const fd = new URLSearchParams({ post_id: String(post.id) })
      const r = await fetch('/api/toggle_key_post', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
      const j = await r.json().catch(()=>null)
      if (!j?.success){
        ;(post as any).is_starred = prev
        alert(j?.error || 'Failed to update')
      } else {
        ;(post as any).is_starred = !!j.starred
      }
    } finally {
      setStarring(false)
    }
  }
  async function toggleCommunityStar(e: React.MouseEvent){
    e.stopPropagation()
    if (starring) return
    setStarring(true)
    try{
      const prev = post.is_community_starred
      ;(post as any).is_community_starred = !prev
      const fd = new URLSearchParams({ post_id: String(post.id) })
      const r = await fetch('/api/toggle_community_key_post', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
      const j = await r.json().catch(()=>null)
      if (!j?.success){
        ;(post as any).is_community_starred = prev
        alert(j?.error || 'Failed to update')
      } else {
        ;(post as any).is_community_starred = !!j.starred
      }
    } finally {
      setStarring(false)
    }
  }
  async function saveEdit(){
    // Use FormData to support file uploads
    const fd = new FormData()
    fd.append('post_id', String(post.id))
    fd.append('content', editText)
    
    if (editMediaFile) {
      fd.append('media', editMediaFile)
    } else if (removeMedia) {
      fd.append('remove_media', 'true')
    }
    
    try {
      const r = await fetch('/edit_post', { method: 'POST', credentials: 'include', body: fd })
      const j = await r.json().catch(() => null)
      if (j?.success) {
        // Update post object with new media paths if returned
        if (j.image_path) {
          ;(post as any).image_path = j.image_path
          ;(post as any).video_path = null
        } else if (j.video_path) {
          ;(post as any).video_path = j.video_path
          ;(post as any).image_path = null
        } else if (removeMedia) {
          ;(post as any).image_path = null
          ;(post as any).video_path = null
        }
        clearEditMedia()
        setRemoveMedia(false)
        setIsEditing(false)
        if (communityId) clearDeviceCache(`community-feed:${communityId}`)
        // Reload to show updated content
        try { (window as any).location.reload() } catch {}
      } else {
        alert(j?.error || 'Failed to update post')
      }
    } catch {
      alert('Failed to update post')
    }
  }
  return (
    <div ref={cardRef} id={`post-${post.id}`} className="rounded-2xl border border-white/10 bg-black shadow-sm shadow-black/20" onClick={post.poll ? undefined : onOpen}>
      {!post.poll && (
        <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
          <Avatar username={post.username} url={post.profile_picture || undefined} size={32} linkToProfile />
          <div className="font-medium tracking-[-0.01em]">{post.username}</div>
          <div className="ml-auto flex items-center gap-2">
            <div className="text-xs text-[#9fb0b5] tabular-nums">{formatSmartTime((post as any).display_timestamp || post.timestamp)}</div>
            <div className="flex items-center gap-2">
              {/* Personal star (turquoise when selected) */}
              <button className="px-2 py-1 rounded-full" title={post.is_starred ? 'Unstar (yours)' : 'Star (yours)'} onClick={toggleStar} aria-label="Star post (yours)">
                <i className={`${post.is_starred ? 'fa-solid' : 'fa-regular'} fa-star`} style={{ color: post.is_starred ? '#4db6ac' : '#6c757d' }} />
              </button>
              {/* Community star (yellow) for owner/admins */}
              {(isAdmin || currentUser === 'admin') && (
                <button className="px-2 py-1 rounded-full" title={post.is_community_starred ? 'Unfeature (community)' : 'Feature (community)'} onClick={toggleCommunityStar} aria-label="Star post (community)">
                  <i className={`${post.is_community_starred ? 'fa-solid' : 'fa-regular'} fa-star`} style={{ color: post.is_community_starred ? '#ffd54f' : '#6c757d' }} />
                </button>
              )}
              {(post.username === currentUser || isAdmin || currentUser === 'admin') && (
                <button className="px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]" title="Delete"
                  onClick={(e)=> { e.stopPropagation(); const ok = confirm('Delete this post?'); if(!ok) return; onDeletePost?.(post.id) }}>
                  <i className="fa-regular fa-trash-can" style={{ color: 'inherit' }} />
                </button>
              )}
              {(post.username === currentUser || isAdmin || currentUser === 'admin') && (
                <button className="px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]" title="Edit"
                  onClick={(e)=> { e.stopPropagation(); setIsEditing(true) }}>
                  <i className="fa-regular fa-pen-to-square" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="py-2 space-y-2">
        {!isEditing ? (
          <>
            {(() => {
              const videoEmbed = extractVideoEmbed(post.content)
              const displayContent = videoEmbed ? removeVideoUrlFromText(post.content, videoEmbed) : post.content
              return (
                <>
                  {displayContent && <div className="px-3 whitespace-pre-wrap text-[14px] leading-relaxed tracking-[0]">{renderTextWithLinks(displayContent)}</div>}
                  {videoEmbed && <VideoEmbed embed={videoEmbed} />}
                </>
              )
            })()}
          </>
        ) : (
          <div className="px-3 space-y-2" onClick={(e)=> e.stopPropagation()}>
            <textarea className="w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none min-h-[100px]" value={editText} onChange={(e)=> setEditText(e.target.value)} />
            
            {/* Current/New Media Preview */}
            {!removeMedia && (editMediaPreview || post.image_path || post.video_path) && (
              <div style={{ position: 'relative' }} className="rounded-lg border border-white/10 overflow-hidden">
                {editMediaPreview ? (
                  // New media preview
                  editMediaFile?.type.startsWith('video/') ? (
                    <video src={editMediaPreview} className="w-full max-h-48 object-contain bg-black block" controls />
                  ) : (
                    <img src={editMediaPreview} alt="New media" className="w-full max-h-48 object-contain bg-black block" />
                  )
                ) : post.image_path ? (
                  <img src={normalizeMediaPath(post.image_path)} alt="Current" className="w-full max-h-48 object-contain bg-black block" />
                ) : post.video_path ? (
                  <video src={normalizeMediaPath(post.video_path)} className="w-full max-h-48 object-contain bg-black block" controls />
                ) : null}
                <button
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    backgroundColor: 'rgba(0,0,0,0.7)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: 'rgba(255,255,255,0.8)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10,
                  }}
                  onClick={() => {
                    if (editMediaPreview) {
                      clearEditMedia()
                    } else {
                      setRemoveMedia(true)
                    }
                  }}
                  title="Remove media"
                >
                  <i className="fa-solid fa-xmark text-sm" />
                </button>
              </div>
            )}
            
            {/* Media Actions */}
            <div className="flex items-center gap-2">
              <input
                ref={mediaInputRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={handleMediaSelect}
              />
              <button
                className="px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/5 text-sm flex items-center gap-2"
                onClick={() => mediaInputRef.current?.click()}
              >
                <i className="fa-solid fa-image" />
                {post.image_path || post.video_path || editMediaPreview ? 'Replace Media' : 'Add Media'}
              </button>
              {removeMedia && (
                <span className="text-xs text-red-400">Media will be removed</span>
              )}
            </div>
            
            {/* Detected links */}
            {detectedLinks.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-[#9fb0b5] font-medium">Detected Links:</div>
                {detectedLinks.map((link, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 rounded-lg border border-white/10 bg-white/5">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-[#4db6ac] truncate">{link.displayText}</div>
                      {link.displayText !== link.url && (
                        <div className="text-xs text-white/50 truncate">{link.url}</div>
                      )}
                    </div>
                    <button
                      className="px-2 py-1 rounded text-xs border border-[#4db6ac]/30 text-[#4db6ac] hover:bg-[#4db6ac]/10"
                      onClick={() => startRenamingLink(link)}
                    >
                      Rename
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="flex gap-2 justify-end">
              <button className="px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/5 text-sm" onClick={cancelEdit}>Cancel</button>
              <button className="px-3 py-1.5 rounded-md bg-[#4db6ac] text-black text-sm hover:brightness-110" onClick={saveEdit}>Save</button>
            </div>
          </div>
        )}
        {post.image_path ? (
          <div className="px-0">
            <ImageLoader
              src={normalizeMediaPath(post.image_path || '')}
              alt="Post image"
              className="block mx-auto max-w-full max-h-[520px] rounded border border-white/10 cursor-zoom-in"
              onClick={() => onPreviewImage && onPreviewImage(normalizeMediaPath(post.image_path || ''))}
            />
          </div>
        ) : post.video_path ? (
          <div className="px-3" onClick={(e)=> e.stopPropagation()}>
            <LazyVideo
              src={normalizeMediaPath(post.video_path)}
              className="w-full max-h-[420px] rounded border border-white/10 bg-black"
              playsInline
            />
          </div>
        ) : null}
        {post.audio_path ? (
          <div className="px-3 space-y-2" onClick={(e)=> { e.stopPropagation(); }}>
            {post.audio_summary && onSummaryUpdate && (
              <EditableAISummary
                postId={post.id}
                initialSummary={post.audio_summary}
                isOwner={post.username === currentUser}
                onSummaryUpdate={(newSummary) => onSummaryUpdate(post.id, newSummary)}
              />
            )}
            <audio 
              controls 
              className="w-full"
              playsInline
              webkit-playsinline="true" 
              src={(() => { 
                const p = post.audio_path || ''; 
                if (!p) return ''; 
                let path = '';
                if (p.startsWith('http')) path = p;
                else if (p.startsWith('/uploads')) path = p;
                else path = p.startsWith('uploads') ? `/${p}` : `/uploads/${p}`;
                // Add cache-busting to prevent Safari caching issues
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
        {post.poll && (
          <div className="px-3 space-y-2" onClick={(e)=> e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <i className="fa-solid fa-chart-bar text-[#4db6ac]" />
              <div className="font-medium text-sm flex-1">
                {post.poll.question}
                {post.poll.expires_at ? (
                  <span className="ml-2 text-[11px] text-[#9fb0b5]">Closes {(() => { try { const d = new Date(post.poll.expires_at as any); if (!isNaN(d.getTime())) return d.toLocaleDateString(); } catch { } return String(post.poll.expires_at) })()}</span>
                ) : null}
              </div>
              {(post.username === currentUser || isAdmin || currentUser === 'admin') && (
                <>
                  <button 
                    className="px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]" 
                    title="Edit poll"
                    onClick={(e)=> { e.preventDefault(); e.stopPropagation(); if (navigate && communityId) navigate(`/community/${communityId}/polls_react?edit=${post.poll?.id}`) }}
                  >
                    <i className="fa-regular fa-pen-to-square" />
                  </button>
                  <button 
                    className="px-2 py-1 rounded-full text-red-400 hover:text-red-300" 
                    title="Delete poll"
                    onClick={(e)=> { 
                      e.preventDefault()
                      e.stopPropagation()
                      if (!confirm('Delete this poll? This cannot be undone.')) return
                      if (post.poll?.id) onDeletePoll?.(post.id, post.poll.id)
                    }}
                  >
                    <i className="fa-regular fa-trash-can" />
                  </button>
                </>
              )}
              <button 
                className="ml-1 px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]" 
                title="Voters"
                onClick={(e)=> { 
                  e.preventDefault()
                  e.stopPropagation()
                  if (onOpenVoters) {
                    onOpenVoters(post.poll!.id)
                  }
                }}
              >
                <i className="fa-solid fa-users" />
              </button>
            </div>
            <div className="space-y-2">
              {post.poll.options?.map(option => {
                const percentage = post.poll?.total_votes ? Math.round((option.votes / post.poll.total_votes) * 100) : 0
                const isUserVote = option.user_voted || false
                // Check both is_active flag AND expires_at timestamp
                const isClosed = post.poll!.is_active === 0
                const isExpiredByTime = (() => { try { const raw = (post.poll as any)?.expires_at; if (!raw) return false; const d = new Date(raw); return !isNaN(d.getTime()) && Date.now() >= d.getTime(); } catch { return false } })()
                const isExpired = isClosed || isExpiredByTime
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={isExpired}
                    className={`w-full text-left px-3 py-2 rounded-lg border relative overflow-hidden ${isExpired ? 'opacity-60 cursor-not-allowed' : (isUserVote ? 'border-[#4db6ac] bg-[#4db6ac]/10' : 'border-white/10 hover:bg-white/5')}`}
                    onClick={(e)=> { e.preventDefault(); e.stopPropagation(); if (!isExpired && onPollVote) onPollVote(post.id, post.poll!.id, option.id) }}
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
              {(() => { const sv = (post.poll as any)?.single_vote; const isSingle = !(sv === false || sv === 0 || sv === '0' || sv === 'false'); return isSingle })() && (
                <span>{post.poll.total_votes || 0} {post.poll.total_votes === 1 ? 'vote' : 'votes'}</span>
              )}
                <button 
                  type="button"
                  onClick={(e)=> { e.preventDefault(); e.stopPropagation(); if (onPollClick) onPollClick() }}
                  className="text-[#4db6ac] hover:underline"
                >
                  View all polls
                </button>
            </div>
          </div>
        )}
        {/* Hide reactions and comments for poll posts */}
        {!post.poll && (
          <div className={`flex items-center gap-2 text-xs ${highlightStep === 'reaction' && idx === 0 ? 'relative z-[9999] pointer-events-auto' : ''}`} onClick={(e)=> e.stopPropagation()}>
            <div className={`${highlightStep === 'reaction' && idx === 0 ? 'ring-[3px] ring-[#4db6ac] shadow-[0_0_25px_rgba(77,182,172,1),0_0_50px_rgba(77,182,172,0.8)] rounded-lg bg-[#4db6ac]/10 animate-pulse' : ''}`}>
              <ReactionFA 
                icon="fa-regular fa-heart" 
                count={post.reactions?.['heart']||0} 
                active={post.user_reaction==='heart'} 
                onClick={()=> onToggleReaction(post.id, 'heart')}
                isHighlighted={highlightStep === 'reaction' && idx === 0}
              />
            </div>
            <ReactionFA icon="fa-regular fa-thumbs-up" count={post.reactions?.['thumbs-up']||0} active={post.user_reaction==='thumbs-up'} onClick={()=> onToggleReaction(post.id, 'thumbs-up')} />
            <ReactionFA icon="fa-regular fa-thumbs-down" count={post.reactions?.['thumbs-down']||0} active={post.user_reaction==='thumbs-down'} onClick={()=> onToggleReaction(post.id, 'thumbs-down')} />
            <button className="px-2 py-1 rounded-full text-[#9fb0b5] hover:text-white" title="View reactions" onClick={(e)=> { 
              e.stopPropagation()
              if (onOpenReactions) {
                onOpenReactions()
              }
            }}>
              <i className="fa-solid fa-users" />
            </button>
            <button className="ml-auto px-2.5 py-1 rounded-full text-[#cfd8dc]"
              onClick={(e)=> { e.stopPropagation(); onOpen() }}>
              <i className="fa-regular fa-comment" />
              <span className="ml-1">{post.replies?.length || 0}</span>
            </button>
          </div>
        )}
        </div>
        {/* Inline recent replies (last 1-2) */}
        {!post.poll && Array.isArray(post.replies) && post.replies.length > 0 && (
          <div className="px-3 pb-2 pt-2 mt-2 border-t border-white/10 space-y-2" onClick={(e)=> e.stopPropagation()}>
            {(() => {
            const ordered = (() => {
              const pair = post.replies.slice(0, 2)
              if (pair.length === 2){
                const [a, b] = pair
                if (a && b){
                  // If one is the parent of the other, ensure parent appears first
                  if ((a as any).parent_reply_id === b.id) return [b, a]
                  if ((b as any).parent_reply_id === a.id) return [a, b]
                }
              }
              return pair
            })()
            return ordered.map(r => (
              <div key={r.id} className="flex items-start gap-2 text-sm">
                <Avatar username={r.username} url={r.profile_picture || undefined} size={22} linkToProfile />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.username}</span>
                    <span className="text-[11px] text-[#9fb0b5]">{formatSmartTime(r.timestamp)}</span>
                    <button
                      className="ml-auto px-2 py-0.5 rounded-full text-[11px] text-[#9fb0b5] hover:text-[#4db6ac]"
                      onClick={(e)=> { e.stopPropagation(); setActiveChildReplyFor(id => id === r.id ? null : r.id); setChildReplyText('') }}
                    >
                      Reply
                    </button>
                  </div>
                  {r.parent_reply_id ? (() => {
                    try {
                      const parent = (post.replies || []).find((p:any) => p.id === r.parent_reply_id)
                      const handle = parent?.username ? `@${parent.username}` : 'a comment'
                      return (
                        <div className="mb-1 text-[11px] text-white/60">
                          <span className="opacity-70">Replying to</span> <span className="opacity-90">{handle}</span>
                        </div>
                      )
                    } catch {
                      return (
                        <div className="mb-1 text-[11px] text-white/60">
                          <span className="opacity-70">Replying to</span> <span className="opacity-90">a comment</span>
                        </div>
                      )
                    }
                  })() : null}
                  {r.content ? (
                    <div className="text-[#dfe6e9] whitespace-pre-wrap break-words">{r.content}</div>
                  ) : null}
                  {r.image_path ? (
                    <div className="mt-1 flex justify-center">
                      {(() => {
                        const replySrc = (r.image_path && (r.image_path.startsWith('http') || r.image_path.startsWith('/')) ? r.image_path : `/uploads/${r.image_path}`) as string
                        return (
                          <ImageLoader 
                            src={replySrc}
                            alt="Reply image" 
                            className="block mx-auto max-h-[200px] rounded border border-white/10 cursor-zoom-in"
                            onClick={() => onPreviewImage && onPreviewImage(replySrc)}
                          />
                        )
                      })()}
                    </div>
                  ) : null}
                  {(r as any).audio_path ? (
                    <div className="mt-1" onClick={(e)=> e.stopPropagation()}>
                      <audio
                        controls
                        className="w-full"
                        playsInline
                        webkit-playsinline="true"
                        src={(() => { 
                          const p = (r as any).audio_path || ''; 
                          if (!p) return ''; 
                          let path = '';
                          if (p.startsWith('http') || p.startsWith('/')) path = p;
                          else path = `/uploads/${p}`;
                          // Add cache-busting to prevent Safari caching issues
                          const separator = path.includes('?') ? '&' : '?';
                          return `${path}${separator}_cb=${Date.now()}`;
                        })()}
                        onClick={(e)=> e.stopPropagation()}
                        onPlay={(e)=> e.stopPropagation() as any}
                        onPause={(e)=> e.stopPropagation() as any}
                      />
                    </div>
                  ) : null}

                  {activeChildReplyFor === r.id && (
                    <div className="mt-2 rounded-lg border border-white/5 bg-white/[0.03] px-2 pt-2 pb-2 space-y-2" onClick={(e)=> e.stopPropagation()}>
                      <MentionTextarea
                        value={childReplyText}
                        onChange={setChildReplyText}
                        communityId={communityId as any}
                        postId={post.id}
                        replyId={r.id as any}
                        placeholder={`Reply to @${r.username}`}
                        className="w-full resize-none rounded-lg bg-transparent border-0 outline-none text-[14px] placeholder-white/40 px-1"
                        rows={2}
                      />
                      {childReplyGif && (
                        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2">
                          <img src={childReplyGif.previewUrl} alt="Selected GIF" className="h-16 w-16 rounded object-cover" loading="lazy" />
                          <button
                            type="button"
                            className="ml-auto text-white/60 hover:text-white"
                            onClick={(ev)=> { ev.stopPropagation(); setChildReplyGif(null) }}
                            aria-label="Remove GIF"
                          >
                            <i className="fa-solid fa-xmark" />
                          </button>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg bg-white/5 border border-white/10 text-white/70 hover:text-white uppercase tracking-wide transition"
                          onClick={(ev)=> { ev.stopPropagation(); setGifPickerTarget(r.id) }}
                        >
                          <i className="fa-solid fa-images" />
                          GIF
                        </button>
                          <button
                          type="button"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#4db6ac] text-black font-semibold hover:brightness-110 disabled:opacity-40 uppercase tracking-wide text-[11px]"
                          disabled={sendingChildReply || (!childReplyText.trim() && !childReplyGif)}
                            onClick={async (ev)=>{
                              ev.stopPropagation()
                              if (sendingChildReply || (!childReplyText.trim() && !childReplyGif)) return
                              try{
                                setSendingChildReply(true)
                                const fd = new FormData()
                                fd.append('post_id', String(post.id))
                                fd.append('content', childReplyText.trim())
                                fd.append('parent_reply_id', String(r.id))
                                fd.append('dedupe_token', `${Date.now()}_${Math.random().toString(36).slice(2)}`)
                                if (childReplyGif){
                                  const gifFile = await gifSelectionToFile(childReplyGif, 'community-reply')
                                  fd.append('image', gifFile)
                                }
                                const resp = await fetch('/post_reply', { method:'POST', credentials:'include', body: fd })
                                const j = await resp.json().catch(()=>null)
                                if (j?.success && j.reply){
                                  if (onAddReply) {
                                    onAddReply(post.id, j.reply as any)
                                  }
                                  setChildReplyText('')
                                  setChildReplyGif(null)
                                  setActiveChildReplyFor(null)
                                } else {
                                  alert(j?.error || 'Failed to reply')
                                }
                              }catch (_err){
                                console.error('Failed to send reply with GIF', _err)
                                alert('Failed to send reply. Please try again.')
                              }finally{
                                setSendingChildReply(false)
                              }
                            }}
                          aria-label="Send reply"
                        >
                          {sendingChildReply ? <i className="fa-solid fa-spinner fa-spin" /> : <><i className="fa-solid fa-paper-plane text-[11px]" /><span className="uppercase tracking-[0.2em] text-[10px] font-semibold">Send</span></>}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          })()}
          {post.replies.length > 2 && (
            <button className="text-xs text-[#4db6ac] hover:underline" onClick={()=> onOpen()}>View all replies</button>
          )}
        </div>
      )}
      {/* Inline quick reply composer - sleek, full-width, low-distraction */}
      {!post.poll && (
        <div className="px-3 pb-3" onClick={(e)=> e.stopPropagation()}>
          <div className="rounded-xl border border-white/5 bg-white/[0.03] px-2 pt-2 pb-2 space-y-2">
              <MentionTextarea
                value={replyText}
                onChange={setReplyText}
                communityId={communityId as any}
                postId={post.id}
                placeholder="Write a reply..."
                className="w-full resize-none rounded-xl bg-transparent border-0 outline-none text-[14px] placeholder-white/40 px-1"
                rows={2}
              />
            {replyGif && (
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2">
                <img src={replyGif.previewUrl} alt="Selected GIF" className="h-20 w-20 rounded object-cover" loading="lazy" />
                <button
                  type="button"
                  className="ml-auto text-white/60 hover:text-white"
                  onClick={()=> setReplyGif(null)}
                  aria-label="Remove GIF"
                >
                  <i className="fa-solid fa-xmark" />
                </button>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] uppercase tracking-wide rounded-lg bg-white/5 border border-white/10 text-white/70 hover:text-white transition"
                onClick={()=> setGifPickerTarget('main')}
              >
                <i className="fa-solid fa-images" />
                GIF
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#4db6ac] text-black font-semibold uppercase tracking-wide text-[11px] hover:brightness-110 disabled:opacity-40"
                disabled={sendingReply || (!replyText.trim() && !replyGif)}
                onClick={async ()=>{
                  if (sendingReply || (!replyText.trim() && !replyGif)) return
                    try{
                      setSendingReply(true)
                      const fd = new FormData()
                      fd.append('post_id', String(post.id))
                      fd.append('content', replyText.trim())
                      fd.append('dedupe_token', `${Date.now()}_${Math.random().toString(36).slice(2)}`)
                      if (replyGif){
                        const gifFile = await gifSelectionToFile(replyGif, 'community-reply')
                        fd.append('image', gifFile)
                      }
                      const r = await fetch('/post_reply', { method:'POST', credentials:'include', body: fd })
                      const j = await r.json().catch(()=>null)
                      if (j?.success && j.reply){
                        if (onAddReply) {
                          onAddReply(post.id, j.reply as any)
                        }
                        setReplyText('')
                        setReplyGif(null)
                      } else {
                        alert(j?.error || 'Failed to reply')
                      }
                    }catch (_err){
                      console.error('Failed to send reply with GIF', _err)
                      alert('Failed to send reply. Please try again.')
                    }finally{
                      setSendingReply(false)
                    }
                }}
                aria-label="Send reply"
              >
                {sendingReply ? <i className="fa-solid fa-spinner fa-spin" /> : <><i className="fa-solid fa-paper-plane text-[11px]" /><span className="uppercase tracking-[0.2em] text-[10px] font-semibold">Reply</span></>}
              </button>
            </div>
          </div>
        </div>
      )}
      
      <GifPicker
        isOpen={gifPickerTarget !== null}
        onClose={()=> setGifPickerTarget(null)}
        onSelect={(gif) => {
          if (gifPickerTarget === 'main'){
            setReplyGif(gif)
          }else if (typeof gifPickerTarget === 'number'){
            setChildReplyGif(gif)
            if (gifPickerTarget !== activeChildReplyFor) {
              setActiveChildReplyFor(gifPickerTarget)
            }
          }
          setGifPickerTarget(null)
        }}
      />

      {/* Rename link modal */}
      {renamingLink && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm" onClick={(e)=> e.stopPropagation()}>
          <div className="w-[90%] max-w-md rounded-2xl border border-[#4db6ac]/30 bg-[#0b0b0b] p-6 shadow-[0_0_40px_rgba(77,182,172,0.3)]">
            <h3 className="text-lg font-bold text-white mb-4">Rename Link</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#9fb0b5] mb-1 block">Original URL:</label>
                <div className="text-xs text-white/70 truncate p-2 rounded bg-white/5 border border-white/10">
                  {renamingLink.url}
                </div>
              </div>
              <div>
                <label className="text-xs text-[#9fb0b5] mb-1 block">Display as:</label>
                <input
                  type="text"
                  value={linkDisplayName}
                  onChange={(e) => setLinkDisplayName(e.target.value)}
                  className="w-full p-2 rounded bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#4db6ac]"
                  placeholder="Enter display name"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                className="flex-1 px-4 py-2 rounded-lg border border-white/20 text-white/80 text-sm hover:bg-white/5"
                onClick={(e)=> { e.stopPropagation(); cancelRenaming() }}
              >
                Cancel
              </button>
              <button
                className="flex-1 px-4 py-2 rounded-lg bg-[#4db6ac] text-black font-medium hover:brightness-110"
                onClick={(e)=> { e.stopPropagation(); saveRenamedLink() }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ReactionFA({ icon, count, active, onClick, isHighlighted }:{ icon: string, count: number, active: boolean, onClick: ()=>void, isHighlighted?: boolean }){
  // Border-only turquoise for active icon (stroke/outline vibe); neutral grey. No pill/border backgrounds.
  const [popping, setPopping] = useState(false)
  const iconStyle: React.CSSProperties = isHighlighted 
    ? { color: '#5ffff0', filter: 'brightness(1.5) saturate(1.5)' }
    : active
    ? { color: '#4db6ac', WebkitTextStroke: '1px #4db6ac' }
    : { color: '#6c757d' }
  const handleClick = () => {
    setPopping(true)
    try { onClick() } finally { setTimeout(() => setPopping(false), 140) }
  }
  return (
    <button className={`px-2 py-1 rounded transition-colors`} onClick={handleClick}>
      <i className={`${icon} ${popping ? 'scale-125' : 'scale-100'} transition-transform duration-150`} style={iconStyle} />
      <span className="ml-1" style={{ color: isHighlighted ? '#5ffff0' : (active ? '#cfe9e7' : '#9fb0b5'), filter: isHighlighted ? 'brightness(1.5)' : undefined }}>{count}</span>
    </button>
  )
}

function EditCommunityButton({ communityId, onClose }:{ communityId: string, onClose: ()=>void }){
  const navigate = useNavigate()
  const [allowed, setAllowed] = useState<boolean>(false)
  useEffect(() => {
    let mounted = true
    async function check(){
      try{
        const fd = new URLSearchParams({ community_id: String(communityId) })
        const r = await fetch('/get_community_members', { method:'POST', credentials:'include', body: fd })
        const j = await r.json()
        if (!mounted) return
        const role = (j?.current_user_role || '').toLowerCase()
        const can = role === 'app_admin' || role === 'owner' || role === 'admin'
        setAllowed(!!can)
      }catch{ setAllowed(false) }
    }
    check()
    return () => { mounted = false }
  }, [communityId])
  if (!allowed) return null
  return (
    <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { onClose(); navigate(`/community/${communityId}/edit`) }}>
      Manage Community
    </button>
  )
}

