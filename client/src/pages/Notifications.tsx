import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useHeader } from '../contexts/HeaderContext'
import { useBadges } from '../contexts/BadgeContext'
import { renderTextWithLinks } from '../utils/linkUtils'
import { SkeletonNotificationList } from '../components/SkeletonRow'
import { apiFetch } from '../utils/apiFetch'

type Notif = {
  id: number
  from_user?: string
  type?: string
  post_id?: number|null
  community_id?: number|null
  message?: string
  is_read: boolean
  created_at?: string
  link?: string|null
  avatar?: string|null
  /** Short snippet of post/reply when server stored preview_text and user allows previews */
  preview?: string|null
}

type CalendarEvent = {
  id: number
  title: string
  date: string
  end_date?: string
  start_time?: string
  end_time?: string
  community_id: number
  community_name: string
  user_rsvp?: string | null
  rsvp_counts?: { going: number; maybe: number; not_going: number }
}

type Poll = {
  id: number
  post_id: number
  question: string
  community_id: number
  community_name: string
  total_votes: number
  user_vote?: number | null
  options: { id: number; text: string; votes: number }[]
}

type Task = {
  id: number
  title: string
  description?: string
  due_date?: string
  community_id: number
  community_name: string
  status?: string
}

type PendingCommunityInvite = {
  id: number
  community_id: number
  community_name: string
  invited_by_username: string
  invited_at?: string
  expires_at?: string
  expired?: boolean
}

type PendingJoinRequest = {
  id: number
  community_id: number
  community_name: string
  username: string
  display_name: string
  profile_picture?: string | null
  created_at?: string
}

type TabType = 'notifications' | 'invites' | 'calendar' | 'polls' | 'tasks'

function tabFromSearch(search: string): TabType {
  const tab = new URLSearchParams(search).get('tab')
  return tab === 'invites' || tab === 'calendar' || tab === 'polls' || tab === 'tasks'
    ? tab
    : 'notifications'
}

const INVITE_NOTIFICATION_TYPES = new Set(['community_invite', 'dm_invite'])

/** Width uncovered when row is swiped left: two action buttons + gap (matches Messages list). */
const NOTIF_SWIPE_ACTION_WIDTH = 116

function iconFor(type?: string){
  const normalized = type?.split(':')[0]
  switch(normalized){
      case 'admin_broadcast': return 'fa-solid fa-bullhorn'
      case 'community_post': return 'fa-solid fa-bullhorn'
      case 'announcement': return 'fa-solid fa-bullhorn'
      case 'task_assigned': return 'fa-solid fa-list-check'
      case 'reaction': return 'fa-regular fa-heart'
      case 'story_reaction': return 'fa-regular fa-heart'
      case 'reply': return 'fa-regular fa-comment'
      case 'story_comment': return 'fa-regular fa-comment'
      case 'mention_post': return 'fa-solid fa-at'
      case 'mention_reply': return 'fa-solid fa-at'
      case 'follow': return 'fa-solid fa-user-plus'
      case 'follow_request': return 'fa-solid fa-user-plus'
      case 'follow_accept': return 'fa-solid fa-user-check'
      case 'community_invite': return 'fa-solid fa-user-plus'
      case 'community_join_request': return 'fa-solid fa-user-plus'
      case 'community_join_request_accepted': return 'fa-solid fa-user-check'
    case 'poll': return 'fa-solid fa-chart-bar'
    case 'poll_vote': return 'fa-solid fa-square-poll-vertical'
    case 'event_invitation': return 'fa-solid fa-calendar-check'
    case 'new_member': return 'fa-solid fa-user-plus'
    default: return 'fa-regular fa-bell'
  }
}

function formatTimeAgo(ts: string | undefined, t: TFunction) {
  if (!ts) return ''
  let normalized = ts
  if (!ts.endsWith('Z') && !ts.includes('+')) {
    normalized = ts.replace(' ', 'T') + 'Z'
  }
  const d = new Date(normalized)
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 0) return t('notifications_page.time_just_now')
  if (s < 60) return t('notifications_page.time_just_now')
  if (s < 3600) return t('notifications_page.time_minutes', { count: Math.floor(s / 60) })
  if (s < 86400) return t('notifications_page.time_hours', { count: Math.floor(s / 3600) })
  if (s < 604800) return t('notifications_page.time_days', { count: Math.floor(s / 86400) })
  return d.toLocaleDateString()
}

function notificationSummary(n: Notif, typeKey: string | undefined, t: TFunction) {
  const user = n.from_user || ''
  if (typeKey === 'event_invitation') return n.message || t('notifications_page.type_event_invitation')
  if (typeKey === 'community_post') return n.message || t('notifications_page.type_community_post', { user })
  if (typeKey === 'new_member') return n.message || t('notifications_page.type_new_member', { user })
  if (typeKey === 'poll') return n.message || t('notifications_page.type_poll', { user })
  if (typeKey === 'admin_broadcast') return n.message || t('notifications_page.type_admin_broadcast')
  if (n.message) return n.message
  const actionKey =
    typeKey === 'task_assigned' ? 'notifications_page.type_task_assigned'
    : typeKey === 'reaction' ? 'notifications_page.type_reaction_post'
    : typeKey === 'story_reaction' ? 'notifications_page.type_story_reaction'
    : typeKey === 'reply' ? 'notifications_page.type_reply_post'
    : typeKey === 'story_comment' ? 'notifications_page.type_story_comment'
    : typeKey === 'mention_post' ? 'notifications_page.type_mention_post'
    : typeKey === 'mention_reply' ? 'notifications_page.type_mention_reply'
    : 'notifications_page.type_interacted'
  return (
    <>
      <span className="font-medium text-c-text-primary">@{user}</span>{' '}
      <span className="text-c-text-secondary">{t(actionKey)}</span>
    </>
  )
}

function formatEventDateLabel(dateStr: string, t: TFunction) {
  try {
    const d = new Date(dateStr)
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    if (d.toDateString() === today.toDateString()) return t('notifications_page.event_today')
    if (d.toDateString() === tomorrow.toDateString()) return t('notifications_page.event_tomorrow')
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

export default function Notifications(){
  const { t } = useTranslation()
  const { setTitle } = useHeader()
  const { unreadNotifs, refreshBadges, adjustBadges } = useBadges()
  const navigate = useNavigate()
  const location = useLocation()
  const [activeTab, setActiveTab] = useState<TabType>(() => tabFromSearch(location.search))
  const [items, setItems] = useState<Notif[]|null>(null)
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [broadcastOpen, setBroadcastOpen] = useState(false)
  const [broadcastNotif, setBroadcastNotif] = useState<Notif|null>(null)
  
  // New data for tabs
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [polls, setPolls] = useState<Poll[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [pendingInvites, setPendingInvites] = useState<PendingCommunityInvite[]>([])
  const [unreadInviteCount, setUnreadInviteCount] = useState(0)
  const [inviteActionLoading, setInviteActionLoading] = useState<number | null>(null)
  const [inviteActionError, setInviteActionError] = useState('')
  const [joinRequests, setJoinRequests] = useState<PendingJoinRequest[]>([])
  const [joinRequestActionLoading, setJoinRequestActionLoading] = useState<number | null>(null)
  const [eventsLoading, setEventsLoading] = useState(false)
  const [pollsLoading, setPollsLoading] = useState(false)
  const [tasksLoading, setTasksLoading] = useState(false)

  const [swipeNotifId, setSwipeNotifId] = useState<number | null>(null)
  const [notifDragX, setNotifDragX] = useState(0)
  const notifGestureRef = useRef<{ startX: number; startY: number; wasOpen: boolean } | null>(null)
  const notifLiveXRef = useRef(0)
  const notifDraggingIdRef = useRef<number | null>(null)
  const lastUnreadNotifsRef = useRef<number | null>(null)
  const unreadBadgeReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visibleRefreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setTitle(t('notifications_page.page_title')) }, [setTitle, t])
  useEffect(() => {
    setActiveTab(tabFromSearch(location.search))
  }, [location.search])

  // ``load`` accepts ``{ silent: true }`` so background refreshes (badge
  // poll, focus / visibility, foreground push) repopulate ``items``
  // without flipping the page back to the "Loading…" placeholder.
  // Without this guard, every ``adjustBadges`` call from a tap or
  // delete cascades into the badge watcher below and flashes the page
  // — on Android the focus/visibility events also fire often enough
  // to make the list feel stuck in a loading loop.
  const load = useCallback(async function load(opts: { silent?: boolean } = {}){
    const silent = !!opts.silent
    const devLog = (...args: unknown[]) => {
      if (import.meta.env.DEV) console.log(...args)
    }
    try{
      if (!silent) setLoading(true)
      const r = await apiFetch('/api/notifications?all=true', { credentials:'include', headers: { 'Accept': 'application/json' } })
      devLog('📋 Notifications API status:', r.status)
      const j = await r.json()
      devLog('📋 Raw notifications response:', j)
      if (j?.success){
        devLog('📋 Total notifications received:', j.notifications?.length || 0)
        devLog('📋 Notification types:', j.notifications?.map((n: Notif) => n?.type))
        const notifications = (j.notifications as Notif[]) || []
        const unreadInvites = notifications.filter(n => {
          const typeKey = n?.type?.split(':')[0] ?? n?.type
          return !n?.is_read && INVITE_NOTIFICATION_TYPES.has(typeKey || '')
        })
        setUnreadInviteCount(unreadInvites.length)

        const filtered = notifications.filter(n => {
          const typeKey = n?.type?.split(':')[0] ?? n?.type
          return n?.type !== 'message' && n?.type !== 'reaction' && !INVITE_NOTIFICATION_TYPES.has(typeKey || '')
        })
        devLog('📋 After filtering out messages and reactions:', filtered.length)
        setItems(filtered)
      } else {
        console.error('📋 Notifications API error:', j?.error || 'Unknown error')
        // Still set items to empty array so page doesn't get stuck on "Loading..."
        setItems([])
        setUnreadInviteCount(0)
      }
    } catch (err) {
      console.error('📋 Notifications fetch error:', err)
      setItems([])
      setUnreadInviteCount(0)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  const loadPendingInvites = useCallback(async function loadPendingInvites(){
    try {
      const r = await apiFetch('/api/community/invites/pending?include_email=true', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      })
      const j = await r.json().catch(() => null)
      if (j?.success && Array.isArray(j.invites)) {
        setPendingInvites(j.invites)
      }
    } catch (err) {
      console.error('Failed to load pending community invites:', err)
    }
  }, [])

  const loadJoinRequests = useCallback(async function loadJoinRequests(){
    try {
      const r = await apiFetch('/api/community/join_requests/pending', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      })
      const j = await r.json().catch(() => null)
      if (j?.success && Array.isArray(j.requests)) {
        setJoinRequests(j.requests)
      }
    } catch (err) {
      console.error('Failed to load join requests:', err)
    }
  }, [])

  const respondToJoinRequest = useCallback(async (req: PendingJoinRequest, action: 'accept' | 'reject') => {
    setJoinRequestActionLoading(req.id)
    setInviteActionError('')
    try {
      const r = await fetch(`/api/community/${req.community_id}/join_requests/decide`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: req.username, action }),
      })
      const j = await r.json().catch(() => null)
      if (j?.success) {
        setJoinRequests(prev => prev.filter(item => item.id !== req.id))
      } else {
        setInviteActionError(j?.error || j?.message || t('notifications_page.invite_action_failed', { action }))
      }
    } catch {
      setInviteActionError(t('notifications_page.invite_action_failed', { action }))
    } finally {
      setJoinRequestActionLoading(null)
    }
  }, [t])

  useEffect(() => {
    void load()
    void loadPendingInvites()
    void loadJoinRequests()
  }, [load, loadPendingInvites, loadJoinRequests])

  useEffect(() => {
    const previous = lastUnreadNotifsRef.current
    lastUnreadNotifsRef.current = unreadNotifs

    if (previous === null) return
    if (activeTab !== 'notifications' && activeTab !== 'invites') return
    if (previous === unreadNotifs) return

    if (unreadBadgeReloadTimerRef.current) {
      clearTimeout(unreadBadgeReloadTimerRef.current)
      unreadBadgeReloadTimerRef.current = null
    }
    unreadBadgeReloadTimerRef.current = setTimeout(() => {
      unreadBadgeReloadTimerRef.current = null
      if (activeTab === 'notifications' || activeTab === 'invites') load({ silent: true })
      loadPendingInvites()
    }, 250)

    return () => {
      if (unreadBadgeReloadTimerRef.current) {
        clearTimeout(unreadBadgeReloadTimerRef.current)
        unreadBadgeReloadTimerRef.current = null
      }
    }
  }, [activeTab, load, loadPendingInvites, unreadNotifs])

  const loadEvents = useCallback(async () => {
    try {
      setEventsLoading(true)
      const r = await apiFetch('/api/all_calendar_events', { credentials: 'include', headers: { Accept: 'application/json' } })
      const j = await r.json()
      if (j?.success) {
        setEvents(j.events || [])
      }
    } catch (err) {
      console.error('Failed to load events:', err)
    } finally {
      setEventsLoading(false)
    }
  }, [])

  const loadPolls = useCallback(async () => {
    try {
      setPollsLoading(true)
      const r = await apiFetch('/api/all_active_polls', { credentials: 'include', headers: { Accept: 'application/json' } })
      const j = await r.json()
      if (j?.success) {
        setPolls(j.polls || [])
      }
    } catch (err) {
      console.error('Failed to load polls:', err)
    } finally {
      setPollsLoading(false)
    }
  }, [])

  const loadTasks = useCallback(async () => {
    try {
      setTasksLoading(true)
      const r = await apiFetch('/api/all_my_tasks', { credentials: 'include', headers: { Accept: 'application/json' } })
      const j = await r.json()
      if (j?.success) {
        setTasks(j.tasks || [])
      }
    } catch (err) {
      console.error('Failed to load tasks:', err)
    } finally {
      setTasksLoading(false)
    }
  }, [])

  useEffect(() => {
    const scheduleVisibleRefresh = () => {
      if (visibleRefreshDebounceRef.current) {
        clearTimeout(visibleRefreshDebounceRef.current)
      }
      visibleRefreshDebounceRef.current = setTimeout(() => {
        visibleRefreshDebounceRef.current = null
        if (document.hidden) return
        if (activeTab === 'notifications' || activeTab === 'invites') void load({ silent: true })
        void loadPendingInvites()
      }, 380)
    }

    const onVisibility = () => scheduleVisibleRefresh()
    const onFocus = () => scheduleVisibleRefresh()
    const onPush = () => scheduleVisibleRefresh()

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('cpoint:push-notification-received', onPush)

    return () => {
      if (visibleRefreshDebounceRef.current) {
        clearTimeout(visibleRefreshDebounceRef.current)
        visibleRefreshDebounceRef.current = null
      }
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('cpoint:push-notification-received', onPush)
    }
  }, [activeTab, load, loadPendingInvites])

  // Calendar / polls / tasks: refetch whenever that tab is selected (badge poller keeps counts; this keeps lists fresh).
  useEffect(() => {
    if (activeTab === 'calendar') void loadEvents()
    else if (activeTab === 'polls') void loadPolls()
    else if (activeTab === 'tasks') void loadTasks()
  }, [activeTab, loadEvents, loadPolls, loadTasks])

  async function markAll(){
    setSwipeNotifId(null)
    // Pre-sync the badge watcher ref so the post-adjustBadges effect
    // run sees ``previous === unreadNotifs`` and skips an extra silent
    // load — markAll already does its own explicit ``load()`` below.
    lastUnreadNotifsRef.current = 0
    adjustBadges({ notifs: -Infinity })
    await fetch('/api/notifications/mark-all-read', { method:'POST', credentials:'include' })
    refreshBadges()
    load()
  }

  async function markOneRead(n: Notif, e?: React.MouseEvent<HTMLButtonElement>) {
    e?.stopPropagation()
    const wasUnread = !n.is_read
    if (wasUnread) {
      // Skip the badge watcher's silent reload; ``setItems`` below
      // already flips this row to ``is_read=true`` locally.
      lastUnreadNotifsRef.current = Math.max(0, unreadNotifs - 1)
      adjustBadges({ notifs: -1 })
    }
    try {
      const r = await fetch(`/api/notifications/${n.id}/read`, { method: 'POST', credentials: 'include' })
      const j = await r.json()
      if (j?.success) {
        setItems(prev => (prev ? prev.map(x => (x.id === n.id ? { ...x, is_read: true } : x)) : prev))
        setSwipeNotifId(null)
        refreshBadges()
      } else if (wasUnread) {
        adjustBadges({ notifs: 1 })
        refreshBadges()
      }
    } catch {
      if (wasUnread) adjustBadges({ notifs: 1 })
      refreshBadges()
    }
  }

  async function deleteOneNotif(n: Notif, e?: React.MouseEvent<HTMLButtonElement>) {
    e?.stopPropagation()
    if (!confirm(t('notifications_page.delete_confirm'))) return
    const wasUnread = !n.is_read
    if (wasUnread) {
      lastUnreadNotifsRef.current = Math.max(0, unreadNotifs - 1)
      adjustBadges({ notifs: -1 })
    }
    try {
      const r = await fetch(`/api/notifications/${n.id}`, { method: 'DELETE', credentials: 'include' })
      const j = await r.json()
      if (r.ok && j?.success) {
        setItems(prev => (prev ? prev.filter(x => x.id !== n.id) : prev))
        setSwipeNotifId(null)
        refreshBadges()
      } else {
        if (wasUnread) adjustBadges({ notifs: 1 })
        refreshBadges()
      }
    } catch {
      if (wasUnread) adjustBadges({ notifs: 1 })
      refreshBadges()
    }
  }

  async function clearAll(){
    if (clearing) return
    if (!confirm(t('notifications_page.clear_all_confirm'))) return
    try{
      setClearing(true)
      setSwipeNotifId(null)
      lastUnreadNotifsRef.current = 0
      adjustBadges({ notifs: -Infinity })
      await fetch('/api/notifications/mark-all-read', { method:'POST', credentials:'include' })
      await fetch('/api/notifications/delete-read', { method:'POST', credentials:'include' })
      refreshBadges()
      await load()
    } finally {
      setClearing(false)
    }
  }

  async function respondToCommunityInvite(invite: PendingCommunityInvite, action: 'accept' | 'decline') {
    if (inviteActionLoading) return
    setInviteActionLoading(invite.id)
    setInviteActionError('')
    try {
      const r = await fetch(`/api/community/invites/${invite.id}/${action}`, {
        method: 'POST',
        credentials: 'include',
      })
      const j = await r.json().catch(() => null)
      if (r.ok && j?.success) {
        setPendingInvites(prev => prev.filter(x => x.id !== invite.id))
        await load({ silent: true })
        refreshBadges()
        if (action === 'accept') {
          navigate(j.next_url || `/community_feed_react/${j.community_id || invite.community_id}`)
        }
      } else {
        setInviteActionError(j?.error || t('notifications_page.invite_action_failed', { action }))
      }
    } catch {
      setInviteActionError(t('notifications_page.invite_action_failed', { action }))
    } finally {
      setInviteActionLoading(null)
    }
  }

  async function onClick(n: Notif){
    setSwipeNotifId(null)
    if (!n.is_read) {
      lastUnreadNotifsRef.current = Math.max(0, unreadNotifs - 1)
      adjustBadges({ notifs: -1 })
    }
    try {
      await fetch(`/api/notifications/${n.id}/read`, { method:'POST', credentials:'include' })
      refreshBadges()
    } catch {}
    
    // For poll notifications, navigate to polls page
    let url = n.link
    const typeKey = n.type?.split(':')[0] ?? n.type
    if (typeKey === 'admin_broadcast') {
      setBroadcastNotif(n)
      setBroadcastOpen(true)
      return
    }
    const isPollNotification = typeKey === 'poll' || typeKey === 'poll_reminder' || typeKey === 'poll_closed'
    const isReplyNotification = typeKey === 'reply' || typeKey === 'mention_reply' || typeKey === 'group_feed_reply' || typeKey === 'story_comment' || typeKey === 'story_reaction'
    const isStoryNotification = typeKey === 'story_reaction' || typeKey === 'story_comment'

    if (!url && isPollNotification && n.community_id) {
      url = `/community/${n.community_id}/polls_react`
    } else if (!url) {
      url = n.post_id ? `/post/${n.post_id}` : (n.community_id ? `/community_feed_react/${n.community_id}` : '/notifications')
    }

    if (import.meta.env.DEV) {
      console.log('Notification clicked:', { id: n.id, type: n.type, link: n.link, url, isReplyNotification, isStoryNotification })
    }

    // Enhanced navigation with state for better back button behavior
    if (url.startsWith('http') || url.startsWith('/')){
      // Use SPA navigation for known in-app routes
      if (url.startsWith('/post/') || url.startsWith('/reply/') || url.startsWith('/group_reply/') || url.startsWith('/group_feed_react/') || url.startsWith('/community_feed_react/') || url.startsWith('/community/') || url.startsWith('/event/') || url.includes('/tasks_react') || url.includes('/polls_react') || url.includes('/useful_links_react') || url.startsWith('/admin_dashboard')){
        if (import.meta.env.DEV) console.log('Using SPA navigation to:', url)

        const navigationState = {
          from: 'notification',
          postId: n.post_id,
          communityId: n.community_id,
          // For story notifications, backend sets post_id = story_id and link = feed URL.
          // Passing openStoryId triggers CommunityFeed.tsx useEffect (~lines 1520-1547)
          // to automatically open the specific story viewer (see also ChatThread.tsx:2959).
          openStoryId: (isStoryNotification && n.post_id) ? Number(n.post_id) : undefined,
          isColdStart: true, // Will be overridden by actual navigation context
          returnToCommunity: isReplyNotification && !!n.community_id,
          communityFeedUrl: n.community_id ? `/community_feed_react/${n.community_id}` : undefined,
          cameFromNotification: true
        }

        navigate(url, { state: navigationState })
      } else {
        if (import.meta.env.DEV) console.log('Using window.location.href to:', url)
        window.location.href = url
      }
    } else {
      if (import.meta.env.DEV) console.log('Using window.location.href (no prefix) to:', url)
      window.location.href = url
    }
  }

  // Format date for display
  function formatEventDate(dateStr: string) {
    return formatEventDateLabel(dateStr, t)
  }

  const tabItems: { key: TabType; label: string; icon: string }[] = [
    { key: 'notifications', label: t('notifications_page.tab_notifications'), icon: 'fa-regular fa-bell' },
    { key: 'invites', label: t('notifications_page.tab_invites'), icon: 'fa-solid fa-user-plus' },
    { key: 'calendar', label: t('notifications_page.tab_calendar'), icon: 'fa-regular fa-calendar' },
    { key: 'polls', label: t('notifications_page.tab_polls'), icon: 'fa-solid fa-chart-bar' },
    { key: 'tasks', label: t('notifications_page.tab_tasks'), icon: 'fa-solid fa-list-check' },
  ]

  return (
    <div className="min-h-screen bg-c-bg-app text-c-text-primary pb-safe">
      <div className="app-content max-w-xl mx-auto px-3 pb-20">
        {/* Tab Navigation */}
        <div className="flex gap-1 mb-4 overflow-x-auto scrollbar-hide border-b border-c-border pb-2">
          {tabItems.map(tab => {
            const showInviteDot = tab.key === 'invites' && unreadInviteCount > 0
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
                  activeTab === tab.key 
                    ? 'bg-cpoint-turquoise text-black font-semibold' 
                    : 'text-c-text-tertiary hover:text-c-text-primary hover:bg-c-hover-bg'
                }`}
              >
                {showInviteDot ? (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#7fffd4] ring-2 ring-c-bg-app" />
                ) : null}
                <i className={tab.icon} />
                {tab.label}
              </button>
            )
          })}
        </div>
        
        {/* Notifications Tab */}
        {activeTab === 'notifications' && (
          <>
            <div className="flex items-center justify-center gap-3 mb-3 border-b border-c-border pb-2">
              <button
                onClick={markAll}
                className="px-3 py-1.5 rounded-full text-sm border border-c-border hover:border-cpoint-turquoise"
              >
                {t('notifications_page.mark_all_read')}
              </button>
              <button
                onClick={clearAll}
                disabled={clearing}
                className="px-3 py-1.5 rounded-full text-sm border border-c-border hover:border-[#e53935] disabled:opacity-50"
              >
                {t('notifications_page.clear_all')}
              </button>
            </div>
            {loading || !items ? (
              <SkeletonNotificationList />
            ) : items.length === 0 ? (
              <div className="text-c-text-tertiary py-10 text-center">
                <i className="fa-regular fa-bell text-2xl" />
                <div className="mt-2">{t('notifications_page.no_notifications')}</div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {items.map(n => {
                  const typeKey = n.type?.split(':')[0] ?? n.type
                  const avatarUrl = n.avatar && (n.avatar.startsWith('http') || n.avatar.startsWith('/')) 
                    ? n.avatar 
                    : n.avatar ? `/static/${n.avatar}` : null
                  const isDragging = notifDraggingIdRef.current === n.id
                  const tx = isDragging ? notifDragX : (swipeNotifId === n.id ? -NOTIF_SWIPE_ACTION_WIDTH : 0)
                  const transition = isDragging ? 'none' : 'transform 150ms ease-out'
                  const showActions = isDragging ? notifDragX < -12 : swipeNotifId === n.id
                  return (
                    <div key={n.id} className="relative w-full overflow-hidden rounded-xl">
                      <div
                        className="absolute inset-y-0 right-0 flex items-stretch gap-1 pr-2"
                        style={{
                          opacity: showActions ? 1 : 0,
                          pointerEvents: showActions ? 'auto' : 'none',
                          transition: 'opacity 150ms ease-out',
                        }}
                      >
                        <button
                          type="button"
                          onClick={e => void markOneRead(n, e)}
                          disabled={n.is_read}
                          className="my-1 h-[calc(100%-0.5rem)] min-h-[44px] w-[52px] rounded-md bg-cpoint-turquoise/25 text-cpoint-turquoise hover:bg-cpoint-turquoise/35 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center"
                          aria-label={t('notifications_page.mark_as_read_aria')}
                        >
                          <i className="fa-regular fa-eye" />
                        </button>
                        <button
                          type="button"
                          onClick={e => void deleteOneNotif(n, e)}
                          className="my-1 h-[calc(100%-0.5rem)] min-h-[44px] w-[52px] rounded-md bg-red-500/20 text-red-300 hover:bg-red-500/30 flex items-center justify-center"
                          aria-label={t('notifications_page.delete_notification_aria')}
                        >
                          <i className="fa-solid fa-trash" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => onClick(n)}
                        onTouchStart={e => {
                          notifGestureRef.current = {
                            startX: e.touches[0].clientX,
                            startY: e.touches[0].clientY,
                            wasOpen: swipeNotifId === n.id,
                          }
                          notifDraggingIdRef.current = n.id
                          const startX = notifGestureRef.current.wasOpen ? -NOTIF_SWIPE_ACTION_WIDTH : 0
                          notifLiveXRef.current = startX
                          setNotifDragX(startX)
                        }}
                        onTouchMove={e => {
                          if (notifDraggingIdRef.current !== n.id || !notifGestureRef.current) return
                          const dx = e.touches[0].clientX - notifGestureRef.current.startX
                          const dy = e.touches[0].clientY - notifGestureRef.current.startY
                          if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) return
                          const base = notifGestureRef.current.wasOpen ? -NOTIF_SWIPE_ACTION_WIDTH : 0
                          const x = Math.max(-NOTIF_SWIPE_ACTION_WIDTH, Math.min(0, base + dx))
                          notifLiveXRef.current = x
                          setNotifDragX(x)
                        }}
                        onTouchEnd={() => {
                          if (notifDraggingIdRef.current !== n.id) return
                          const x = notifLiveXRef.current
                          setSwipeNotifId(x < -NOTIF_SWIPE_ACTION_WIDTH / 2 ? n.id : null)
                          setNotifDragX(0)
                          notifDraggingIdRef.current = null
                          notifGestureRef.current = null
                        }}
                        onTouchCancel={() => {
                          if (notifDraggingIdRef.current !== n.id) return
                          setNotifDragX(0)
                          notifDraggingIdRef.current = null
                          notifGestureRef.current = null
                        }}
                        className={`text-left w-full px-3 py-2.5 rounded-xl border touch-pan-y ${n.is_read ? 'border-c-border bg-transparent' : 'border-cpoint-turquoise/40 bg-cpoint-turquoise/10'}`}
                        style={{ transform: `translateX(${tx}px)`, transition }}
                      >
                        <div className="flex items-start gap-3 pointer-events-none">
                          <div className="relative flex-shrink-0">
                            {avatarUrl ? (
                              <img 
                                src={avatarUrl} 
                                alt={n.from_user || ''} 
                                className="w-10 h-10 rounded-full object-cover bg-c-active-bg"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                  (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                                }}
                              />
                            ) : null}
                            <div className={`w-10 h-10 rounded-full bg-c-bg-elevated flex items-center justify-center ${avatarUrl ? 'hidden' : ''}`}>
                              <i className={`${iconFor(n.type)} text-cpoint-turquoise text-lg`} />
                            </div>
                            <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-c-bg-elevated border border-c-border flex items-center justify-center">
                              <i className={`${iconFor(n.type)} text-cpoint-turquoise text-[10px]`} />
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm">
                              {notificationSummary(n, typeKey, t)}
                            </div>
                            {n.preview ? (
                              <div className="text-xs text-c-text-tertiary mt-1 line-clamp-2 break-words">
                                {renderTextWithLinks(n.preview, undefined, undefined)}
                              </div>
                            ) : null}
                            <div className="text-[11px] text-c-text-tertiary mt-0.5">{formatTimeAgo(n.created_at, t)}</div>
                          </div>
                          {!n.is_read && (
                            <div className="w-2 h-2 rounded-full bg-cpoint-turquoise flex-shrink-0 mt-2" />
                          )}
                        </div>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* Invites Tab */}
        {activeTab === 'invites' && (
          <>
            {inviteActionError ? (
              <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {inviteActionError}
              </div>
            ) : null}
            {joinRequests.length > 0 && (
              <div className="space-y-2 mb-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-c-text-tertiary">{t('notifications_page.join_requests_heading')}</div>
                {joinRequests.map(req => (
                  <div key={`join-req-${req.id}`} className="rounded-xl border border-cpoint-turquoise/35 bg-cpoint-turquoise/10 p-3">
                    <div className="flex items-start gap-3">
                      {req.profile_picture ? (
                        <img
                          src={req.profile_picture.startsWith('http') || req.profile_picture.startsWith('/') ? req.profile_picture : `/${req.profile_picture}`}
                          alt=""
                          className="w-10 h-10 rounded-full object-cover bg-c-active-bg"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-cpoint-turquoise/20 flex items-center justify-center text-cpoint-turquoise">
                          <i className="fa-solid fa-user-plus" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-c-text-primary">
                          {t('notifications_page.join_request_body', {
                            user: req.display_name,
                            community: req.community_name,
                          })}
                        </div>
                        <div className="text-[11px] text-c-text-tertiary mt-0.5">@{req.username}{req.created_at ? ` · ${formatTimeAgo(req.created_at, t)}` : ''}</div>
                        <div className="mt-3 flex gap-2">
                          <button
                            className="flex-1 min-h-[44px] rounded-lg bg-cpoint-turquoise px-3 py-2 text-sm font-semibold text-black disabled:opacity-50"
                            disabled={joinRequestActionLoading === req.id}
                            onClick={() => respondToJoinRequest(req, 'accept')}
                          >
                            {joinRequestActionLoading === req.id ? t('notifications_page.working') : t('notifications_page.join_request_accept')}
                          </button>
                          <button
                            className="flex-1 min-h-[44px] rounded-lg border border-c-border bg-c-hover-bg px-3 py-2 text-sm text-c-text-primary disabled:opacity-50"
                            disabled={joinRequestActionLoading === req.id}
                            onClick={() => respondToJoinRequest(req, 'reject')}
                          >
                            {t('notifications_page.join_request_decline')}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {pendingInvites.length === 0 && joinRequests.length === 0 ? (
              <div className="text-c-text-tertiary py-10 text-center">
                <i className="fa-solid fa-user-plus text-2xl" />
                <div className="mt-2">{t('notifications_page.no_invites')}</div>
              </div>
            ) : pendingInvites.length === 0 ? null : (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-c-text-tertiary">{t('notifications_page.community_invites_heading')}</div>
                {pendingInvites.map(invite => (
                  <div key={`community-${invite.id}`} className={`rounded-xl border p-3 ${invite.expired ? 'border-c-border bg-c-hover-bg/40 opacity-75' : 'border-cpoint-turquoise/35 bg-cpoint-turquoise/10'}`}>
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-cpoint-turquoise/20 flex items-center justify-center text-cpoint-turquoise">
                        <i className="fa-solid fa-user-plus" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-c-text-primary">
                          {t('notifications_page.invite_body', {
                            community: invite.community_name,
                            username: invite.invited_by_username,
                          })}
                        </div>
                        {invite.invited_at ? (
                          <div className="text-[11px] text-c-text-tertiary mt-0.5">{formatTimeAgo(invite.invited_at, t)}</div>
                        ) : null}
                        {invite.expires_at ? (
                          <div className="text-[11px] text-c-text-tertiary mt-0.5">
                            {invite.expired ? 'Expired' : 'Valid until'} {new Date(String(invite.expires_at).replace(' ', 'T')).toLocaleString()}
                          </div>
                        ) : null}
                        <div className="mt-3 flex gap-2">
                          <button
                            className="flex-1 rounded-lg bg-cpoint-turquoise px-3 py-2 text-sm font-semibold text-black disabled:opacity-50"
                            disabled={invite.expired || inviteActionLoading === invite.id}
                            onClick={() => respondToCommunityInvite(invite, 'accept')}
                          >
                            {invite.expired ? 'Expired' : inviteActionLoading === invite.id ? t('notifications_page.working') : t('notifications_page.accept')}
                          </button>
                          <button
                            className="flex-1 rounded-lg border border-c-border bg-c-hover-bg px-3 py-2 text-sm text-c-text-primary disabled:opacity-50"
                            disabled={inviteActionLoading === invite.id}
                            onClick={() => respondToCommunityInvite(invite, 'decline')}
                          >
                            {t('notifications_page.decline')}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        
        {/* Calendar Tab */}
        {activeTab === 'calendar' && (
          <>
            {eventsLoading ? (
              <div className="text-c-text-tertiary py-10 text-center">{t('notifications_page.loading_events')}</div>
            ) : events.length === 0 ? (
              <div className="text-c-text-tertiary py-10 text-center">
                <i className="fa-regular fa-calendar text-2xl" />
                <div className="mt-2">{t('notifications_page.no_upcoming_events')}</div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {events.map(event => (
                  <button
                    key={event.id}
                    onClick={() => navigate(`/event/${event.id}`)}
                    className="text-left w-full px-4 py-3 rounded-xl border border-c-border bg-transparent hover:bg-c-hover-bg transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl bg-cpoint-turquoise/20 flex flex-col items-center justify-center flex-shrink-0">
                        <div className="text-[10px] text-cpoint-turquoise uppercase font-medium">
                          {new Date(event.date).toLocaleDateString('en-US', { month: 'short' })}
                        </div>
                        <div className="text-lg font-bold text-c-text-primary">
                          {new Date(event.date).getDate()}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-c-text-primary truncate">{event.title}</div>
                        <div className="text-xs text-c-text-tertiary mt-0.5">
                          {formatEventDate(event.date)}
                          {event.start_time && ` • ${event.start_time}`}
                        </div>
                        <div className="text-xs text-cpoint-turquoise mt-1 truncate">{event.community_name}</div>
                      </div>
                      {event.user_rsvp && (
                        <div className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          event.user_rsvp === 'going' ? 'bg-green-500/20 text-green-400' :
                          event.user_rsvp === 'maybe' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-red-500/20 text-red-400'
                        }`}>
                          {event.user_rsvp === 'going' ? t('calendar.going') : event.user_rsvp === 'maybe' ? t('calendar.maybe') : t('calendar.not_going')}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        
        {/* Polls Tab */}
        {activeTab === 'polls' && (
          <>
            {pollsLoading ? (
              <div className="text-c-text-tertiary py-10 text-center">{t('notifications_page.loading_polls')}</div>
            ) : polls.length === 0 ? (
              <div className="text-c-text-tertiary py-10 text-center">
                <i className="fa-solid fa-chart-bar text-2xl" />
                <div className="mt-2">{t('notifications_page.no_active_polls')}</div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {polls.map(poll => (
                  <button
                    key={poll.id}
                    onClick={() => navigate(`/community/${poll.community_id}/polls_react`)}
                    className="text-left w-full px-4 py-3 rounded-xl border border-c-border bg-transparent hover:bg-c-hover-bg transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                        <i className="fa-solid fa-chart-bar text-purple-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-c-text-primary">{poll.question}</div>
                        <div className="text-xs text-c-text-tertiary mt-1">
                          {t(poll.total_votes === 1 ? 'notifications_page.poll_votes_one' : 'notifications_page.poll_votes_other', { count: poll.total_votes })} • {t('notifications_page.poll_options_count', { count: poll.options.length })}
                        </div>
                        <div className="text-xs text-cpoint-turquoise mt-1 truncate">{poll.community_name}</div>
                      </div>
                      {poll.user_vote !== null && poll.user_vote !== undefined && (
                        <div className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-cpoint-turquoise/20 text-cpoint-turquoise">
                          {t('notifications_page.poll_voted')}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        
        {/* Tasks Tab */}
        {activeTab === 'tasks' && (
          <>
            {tasksLoading ? (
              <div className="text-c-text-tertiary py-10 text-center">{t('notifications_page.loading_tasks')}</div>
            ) : tasks.length === 0 ? (
              <div className="text-c-text-tertiary py-10 text-center">
                <i className="fa-solid fa-list-check text-2xl" />
                <div className="mt-2">{t('notifications_page.no_pending_tasks')}</div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {tasks.map(task => (
                  <button
                    key={task.id}
                    onClick={() => navigate(`/community/${task.community_id}/tasks_react`)}
                    className="text-left w-full px-4 py-3 rounded-xl border border-c-border bg-transparent hover:bg-c-hover-bg transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        task.status === 'ongoing' ? 'bg-blue-500/20' : 'bg-orange-500/20'
                      }`}>
                        <i className={`fa-solid ${task.status === 'ongoing' ? 'fa-spinner' : 'fa-circle-dot'} ${
                          task.status === 'ongoing' ? 'text-blue-400' : 'text-orange-400'
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-c-text-primary">{task.title}</div>
                        {task.due_date && (
                          <div className="text-xs text-c-text-tertiary mt-0.5">
                            {t('notifications_page.task_due', { date: formatEventDate(task.due_date) })}
                          </div>
                        )}
                        <div className="text-xs text-cpoint-turquoise mt-1 truncate">{task.community_name}</div>
                      </div>
                      <div className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        task.status === 'ongoing' ? 'bg-blue-500/20 text-blue-400' : 'bg-orange-500/20 text-orange-400'
                      }`}>
                        {task.status === 'ongoing' ? t('notifications_page.task_in_progress') : t('notifications_page.task_not_started')}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {broadcastOpen && (
        <BroadcastModal
          notif={broadcastNotif}
          onClose={() => {
            setBroadcastOpen(false)
            setBroadcastNotif(null)
          }}
        />
      )}
    </div>
  )
}

function BroadcastModal({ notif, onClose }: { notif: Notif | null; onClose: () => void }) {
  const { t } = useTranslation()
  if (!notif) return null
  const messageLines = notif.message ? notif.message.split(/\n+/) : []
  const link = notif.link

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => e.currentTarget === e.target && onClose()}>
      <div className="w-full max-w-lg rounded-2xl border border-c-border bg-c-bg-elevated p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-lg font-semibold text-c-text-primary">
            <i className="fa-solid fa-bullhorn text-cpoint-turquoise" />
            {t('notifications_page.broadcast_title')}
          </div>
          <button className="p-2 rounded-lg hover:bg-c-hover-bg" onClick={onClose} aria-label={t('common.close')}>
            <i className="fa-solid fa-xmark text-c-text-primary" />
          </button>
        </div>

          <div className="space-y-3 text-sm text-c-text-secondary max-h-[50vh] overflow-y-auto pr-1">
          {messageLines.length > 0
            ? messageLines.map((line, idx) => (
                <p key={idx} className="leading-relaxed whitespace-pre-line">
                  {line}
                </p>
              ))
            : (
              <p className="leading-relaxed">
                {notif.message || t('notifications_page.broadcast_no_message')}
              </p>
            )}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {link && (
            <button
                className="px-3 py-2 text-sm rounded-lg border border-c-border bg-c-active-bg hover:bg-c-active-bg"
              onClick={() => {
                try {
                  window.open(link, '_blank', 'noopener');
                } catch {
                  window.location.href = link;
                }
              }}
            >
              {t('notifications_page.open_link')}
            </button>
          )}
          <button
            className="px-3 py-2 text-sm rounded-lg bg-cpoint-turquoise text-black font-semibold hover:brightness-110"
            onClick={onClose}
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
