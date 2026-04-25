import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import { useBadges } from '../contexts/BadgeContext'
import { renderTextWithLinks } from '../utils/linkUtils'

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
}

type TabType = 'notifications' | 'invites' | 'calendar' | 'polls' | 'tasks'

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
    case 'poll': return 'fa-solid fa-chart-bar'
    case 'poll_vote': return 'fa-solid fa-square-poll-vertical'
    case 'event_invitation': return 'fa-solid fa-calendar-check'
    case 'new_member': return 'fa-solid fa-user-plus'
    default: return 'fa-regular fa-bell'
  }
}

function timeAgo(ts?: string){
  if (!ts) return ''
  // Server stores timestamps in UTC — ensure JS parses them as UTC
  let normalized = ts
  if (!ts.endsWith('Z') && !ts.includes('+')) {
    normalized = ts.replace(' ', 'T') + 'Z'
  }
  const d = new Date(normalized)
  const s = Math.floor((Date.now() - d.getTime())/1000)
  if (s < 0) return 'just now'
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s/60)+'m'
  if (s < 86400) return Math.floor(s/3600)+'h'
  if (s < 604800) return Math.floor(s/86400)+'d'
  return d.toLocaleDateString()
}

export default function Notifications(){
  const { setTitle } = useHeader()
  const { unreadNotifs, refreshBadges, adjustBadges } = useBadges()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<TabType>('notifications')
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
  const [inviteActionLoading, setInviteActionLoading] = useState<number | null>(null)
  const [inviteActionError, setInviteActionError] = useState('')
  const [eventsLoading, setEventsLoading] = useState(false)
  const [pollsLoading, setPollsLoading] = useState(false)
  const [tasksLoading, setTasksLoading] = useState(false)

  const [swipeNotifId, setSwipeNotifId] = useState<number | null>(null)
  const [notifDragX, setNotifDragX] = useState(0)
  const notifGestureRef = useRef<{ startX: number; startY: number; wasOpen: boolean } | null>(null)
  const notifLiveXRef = useRef(0)
  const notifDraggingIdRef = useRef<number | null>(null)
  const lastUnreadNotifsRef = useRef<number | null>(null)

  useEffect(() => { setTitle('Notifications') }, [setTitle])

  // ``load`` accepts ``{ silent: true }`` so background refreshes (badge
  // poll, focus / visibility, foreground push) repopulate ``items``
  // without flipping the page back to the "Loading…" placeholder.
  // Without this guard, every ``adjustBadges`` call from a tap or
  // delete cascades into the badge watcher below and flashes the page
  // — on Android the focus/visibility events also fire often enough
  // to make the list feel stuck in a loading loop.
  const load = useCallback(async function load(opts: { silent?: boolean } = {}){
    const silent = !!opts.silent
    try{
      if (!silent) setLoading(true)
      const r = await fetch('/api/notifications?all=true', { credentials:'include', headers: { 'Accept': 'application/json' } })
      console.log('📋 Notifications API status:', r.status)
      const j = await r.json()
      console.log('📋 Raw notifications response:', j)
      if (j?.success){
        console.log('📋 Total notifications received:', j.notifications?.length || 0)
        console.log('📋 Notification types:', j.notifications?.map((n: Notif) => n?.type))
        const filtered = (j.notifications as Notif[]).filter(n => {
          const typeKey = n?.type?.split(':')[0] ?? n?.type
          return n?.type !== 'message' && n?.type !== 'reaction' && !INVITE_NOTIFICATION_TYPES.has(typeKey || '')
        })
        console.log('📋 After filtering out messages and reactions:', filtered.length)
        setItems(filtered)
      } else {
        console.error('📋 Notifications API error:', j?.error || 'Unknown error')
        // Still set items to empty array so page doesn't get stuck on "Loading..."
        setItems([])
      }
    } catch (err) {
      console.error('📋 Notifications fetch error:', err)
      setItems([])
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  const loadPendingInvites = useCallback(async function loadPendingInvites(){
    try {
      const r = await fetch('/api/community/invites/pending', {
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

  useEffect(() => {
    load()
    loadPendingInvites()
    refreshBadges()
  }, [load, loadPendingInvites, refreshBadges])

  useEffect(() => {
    const previous = lastUnreadNotifsRef.current
    lastUnreadNotifsRef.current = unreadNotifs

    if (previous === null) return
    if (activeTab !== 'notifications' && activeTab !== 'invites') return
    if (previous === unreadNotifs) return

    // Silent so the page doesn't flash "Loading…" each time a tap /
    // delete decrements the badge.
    if (activeTab === 'notifications') load({ silent: true })
    loadPendingInvites()
  }, [activeTab, load, loadPendingInvites, unreadNotifs])

  useEffect(() => {
    const refreshVisibleNotifications = () => {
      if (document.hidden) return
      if (activeTab === 'notifications') load({ silent: true })
      loadPendingInvites()
      refreshBadges()
    }

    document.addEventListener('visibilitychange', refreshVisibleNotifications)
    window.addEventListener('focus', refreshVisibleNotifications)
    window.addEventListener('cpoint:push-notification-received', refreshVisibleNotifications)

    return () => {
      document.removeEventListener('visibilitychange', refreshVisibleNotifications)
      window.removeEventListener('focus', refreshVisibleNotifications)
      window.removeEventListener('cpoint:push-notification-received', refreshVisibleNotifications)
    }
  }, [activeTab, load, loadPendingInvites, refreshBadges])
  
  // Load events, polls, tasks when switching tabs
  useEffect(() => {
    if (activeTab === 'calendar' && events.length === 0 && !eventsLoading) {
      loadEvents()
    } else if (activeTab === 'polls' && polls.length === 0 && !pollsLoading) {
      loadPolls()
    } else if (activeTab === 'tasks' && tasks.length === 0 && !tasksLoading) {
      loadTasks()
    }
  }, [activeTab])
  
  async function loadEvents() {
    try {
      setEventsLoading(true)
      const r = await fetch('/api/all_calendar_events', { credentials: 'include', headers: { 'Accept': 'application/json' } })
      const j = await r.json()
      if (j?.success) {
        setEvents(j.events || [])
      }
    } catch (err) {
      console.error('Failed to load events:', err)
    } finally {
      setEventsLoading(false)
    }
  }
  
  async function loadPolls() {
    try {
      setPollsLoading(true)
      const r = await fetch('/api/all_active_polls', { credentials: 'include', headers: { 'Accept': 'application/json' } })
      const j = await r.json()
      if (j?.success) {
        setPolls(j.polls || [])
      }
    } catch (err) {
      console.error('Failed to load polls:', err)
    } finally {
      setPollsLoading(false)
    }
  }
  
  async function loadTasks() {
    try {
      setTasksLoading(true)
      const r = await fetch('/api/all_my_tasks', { credentials: 'include', headers: { 'Accept': 'application/json' } })
      const j = await r.json()
      if (j?.success) {
        setTasks(j.tasks || [])
      }
    } catch (err) {
      console.error('Failed to load tasks:', err)
    } finally {
      setTasksLoading(false)
    }
  }

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
    if (!confirm('Delete this notification?')) return
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
    if (!confirm('Clear all notifications? This cannot be undone.')) return
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
      } else {
        setInviteActionError(j?.error || `Failed to ${action} invite`)
      }
    } catch {
      setInviteActionError(`Failed to ${action} invite`)
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
    const isReplyNotification = typeKey === 'reply' || typeKey === 'mention_reply' || typeKey === 'story_comment' || typeKey === 'story_reaction'
    const isStoryNotification = typeKey === 'story_reaction' || typeKey === 'story_comment'

    if (!url && isPollNotification && n.community_id) {
      url = `/community/${n.community_id}/polls_react`
    } else if (!url) {
      url = n.post_id ? `/post/${n.post_id}` : (n.community_id ? `/community_feed_react/${n.community_id}` : '/notifications')
    }

    console.log('Notification clicked:', { id: n.id, type: n.type, link: n.link, url, isReplyNotification, isStoryNotification })

    // Enhanced navigation with state for better back button behavior
    if (url.startsWith('http') || url.startsWith('/')){
      // Use SPA navigation for known in-app routes
      if (url.startsWith('/post/') || url.startsWith('/reply/') || url.startsWith('/community_feed_react/') || url.startsWith('/community/') || url.startsWith('/event/') || url.includes('/tasks_react') || url.includes('/polls_react') || url.includes('/useful_links_react') || url.startsWith('/admin_dashboard')){
        console.log('Using SPA navigation to:', url)

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
        console.log('Using window.location.href to:', url)
        window.location.href = url
      }
    } else {
      console.log('Using window.location.href (no prefix) to:', url)
      window.location.href = url
    }
  }

  // Format date for display
  function formatEventDate(dateStr: string) {
    try {
      const d = new Date(dateStr)
      const today = new Date()
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)
      
      if (d.toDateString() === today.toDateString()) return 'Today'
      if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    } catch {
      return dateStr
    }
  }

  return (
    <div className="min-h-screen bg-black text-white pb-safe">
      <div className="app-content max-w-xl mx-auto px-3 pb-20">
        {/* Tab Navigation */}
        <div className="flex gap-1 mb-4 overflow-x-auto scrollbar-hide border-b border-white/10 pb-2">
          {[
            { key: 'notifications' as TabType, label: 'Notifications', icon: 'fa-regular fa-bell' },
            { key: 'invites' as TabType, label: 'Invites', icon: 'fa-solid fa-user-plus' },
            { key: 'calendar' as TabType, label: 'Calendar', icon: 'fa-regular fa-calendar' },
            { key: 'polls' as TabType, label: 'Polls', icon: 'fa-solid fa-chart-bar' },
            { key: 'tasks' as TabType, label: 'Tasks', icon: 'fa-solid fa-list-check' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
                activeTab === tab.key 
                  ? 'bg-[#4db6ac] text-black font-semibold' 
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <i className={tab.icon} />
              {tab.label}
            </button>
          ))}
        </div>
        
        {/* Notifications Tab */}
        {activeTab === 'notifications' && (
          <>
            <div className="flex items-center justify-center gap-3 mb-3 border-b border-white/10 pb-2">
              <button
                onClick={markAll}
                className="px-3 py-1.5 rounded-full text-sm border border-white/15 hover:border-[#4db6ac]"
              >
                Mark all read
              </button>
              <button
                onClick={clearAll}
                disabled={clearing}
                className="px-3 py-1.5 rounded-full text-sm border border-white/15 hover:border-[#e53935] disabled:opacity-50"
              >
                Clear all
              </button>
            </div>
            {loading || !items ? (
              <div className="text-[#9fb0b5] py-10 text-center">Loading…</div>
            ) : items.length === 0 ? (
              <div className="text-[#9fb0b5] py-10 text-center">
                <i className="fa-regular fa-bell text-2xl" />
                <div className="mt-2">No notifications</div>
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
                          className="my-1 h-[calc(100%-0.5rem)] min-h-[44px] w-[52px] rounded-md bg-[#4db6ac]/25 text-[#4db6ac] hover:bg-[#4db6ac]/35 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center"
                          aria-label="Mark as read"
                        >
                          <i className="fa-regular fa-eye" />
                        </button>
                        <button
                          type="button"
                          onClick={e => void deleteOneNotif(n, e)}
                          className="my-1 h-[calc(100%-0.5rem)] min-h-[44px] w-[52px] rounded-md bg-red-500/20 text-red-300 hover:bg-red-500/30 flex items-center justify-center"
                          aria-label="Delete notification"
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
                        className={`text-left w-full px-3 py-2.5 rounded-xl border touch-pan-y ${n.is_read ? 'border-white/10 bg-white/[0.03]' : 'border-[#4db6ac]/40 bg-[#4db6ac]/10'}`}
                        style={{ transform: `translateX(${tx}px)`, transition }}
                      >
                        <div className="flex items-start gap-3 pointer-events-none">
                          <div className="relative flex-shrink-0">
                            {avatarUrl ? (
                              <img 
                                src={avatarUrl} 
                                alt={n.from_user || ''} 
                                className="w-10 h-10 rounded-full object-cover bg-white/10"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                  (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                                }}
                              />
                            ) : null}
                            <div className={`w-10 h-10 rounded-full bg-[#1a2526] flex items-center justify-center ${avatarUrl ? 'hidden' : ''}`}>
                              <i className={`${iconFor(n.type)} text-[#4db6ac] text-lg`} />
                            </div>
                            <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-[#0b0f10] border border-white/10 flex items-center justify-center">
                              <i className={`${iconFor(n.type)} text-[#4db6ac] text-[10px]`} />
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm">
                              {typeKey === 'event_invitation' ? (n.message || 'Event invitation') :
                               typeKey === 'community_post' ? (n.message || `@${n.from_user} made a new post`) :
                               typeKey === 'new_member' ? (n.message || `@${n.from_user} joined the community`) :
                               typeKey === 'poll' ? (n.message || `@${n.from_user} created a new poll`) :
                               typeKey === 'admin_broadcast' ? (n.message || 'Administrator announcement') : (
                                n.message ? (n.message) : (
                                  <>
                                    <span className="font-medium text-white">@{n.from_user}</span>{' '}
                                    <span className="text-white/70">
                                      {typeKey === 'task_assigned' ? 'assigned you a task' :
                                      typeKey === 'reaction' ? 'reacted to your post' :
                                      typeKey === 'story_reaction' ? 'reacted to your story' :
                                      typeKey === 'reply' ? 'replied to your post' :
                                      typeKey === 'story_comment' ? 'commented on your story' :
                                      typeKey === 'mention_post' ? 'mentioned you in a post' :
                                      typeKey === 'mention_reply' ? 'mentioned you in a reply' : 'interacted with you'}
                                    </span>
                                  </>
                                )
                              )}
                            </div>
                            {n.preview ? (
                              <div className="text-xs text-white/55 mt-1 line-clamp-2 break-words">
                                {renderTextWithLinks(n.preview, undefined, undefined)}
                              </div>
                            ) : null}
                            <div className="text-[11px] text-[#9fb0b5] mt-0.5">{timeAgo(n.created_at)}</div>
                          </div>
                          {!n.is_read && (
                            <div className="w-2 h-2 rounded-full bg-[#4db6ac] flex-shrink-0 mt-2" />
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
            {pendingInvites.length === 0 ? (
              <div className="text-[#9fb0b5] py-10 text-center">
                <i className="fa-solid fa-user-plus text-2xl" />
                <div className="mt-2">No invites</div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-white/50">Community invites</div>
                {pendingInvites.map(invite => (
                  <div key={`community-${invite.id}`} className="rounded-xl border border-[#4db6ac]/35 bg-[#4db6ac]/10 p-3">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center text-[#4db6ac]">
                        <i className="fa-solid fa-user-plus" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white">
                          You've been invited to community <span className="font-semibold">{invite.community_name}</span> by username <span className="font-semibold">{invite.invited_by_username}</span>
                        </div>
                        {invite.invited_at ? (
                          <div className="text-[11px] text-[#9fb0b5] mt-0.5">{timeAgo(invite.invited_at)}</div>
                        ) : null}
                        <div className="mt-3 flex gap-2">
                          <button
                            className="flex-1 rounded-lg bg-[#4db6ac] px-3 py-2 text-sm font-semibold text-black disabled:opacity-50"
                            disabled={inviteActionLoading === invite.id}
                            onClick={() => respondToCommunityInvite(invite, 'accept')}
                          >
                            {inviteActionLoading === invite.id ? 'Working...' : 'Accept'}
                          </button>
                          <button
                            className="flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white disabled:opacity-50"
                            disabled={inviteActionLoading === invite.id}
                            onClick={() => respondToCommunityInvite(invite, 'decline')}
                          >
                            Decline
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
              <div className="text-[#9fb0b5] py-10 text-center">Loading events…</div>
            ) : events.length === 0 ? (
              <div className="text-[#9fb0b5] py-10 text-center">
                <i className="fa-regular fa-calendar text-2xl" />
                <div className="mt-2">No upcoming events</div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {events.map(event => (
                  <button
                    key={event.id}
                    onClick={() => navigate(`/event/${event.id}`)}
                    className="text-left w-full px-4 py-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl bg-[#4db6ac]/20 flex flex-col items-center justify-center flex-shrink-0">
                        <div className="text-[10px] text-[#4db6ac] uppercase font-medium">
                          {new Date(event.date).toLocaleDateString('en-US', { month: 'short' })}
                        </div>
                        <div className="text-lg font-bold text-white">
                          {new Date(event.date).getDate()}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-white truncate">{event.title}</div>
                        <div className="text-xs text-[#9fb0b5] mt-0.5">
                          {formatEventDate(event.date)}
                          {event.start_time && ` • ${event.start_time}`}
                        </div>
                        <div className="text-xs text-[#4db6ac] mt-1 truncate">{event.community_name}</div>
                      </div>
                      {event.user_rsvp && (
                        <div className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          event.user_rsvp === 'going' ? 'bg-green-500/20 text-green-400' :
                          event.user_rsvp === 'maybe' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-red-500/20 text-red-400'
                        }`}>
                          {event.user_rsvp === 'going' ? 'Going' : event.user_rsvp === 'maybe' ? 'Maybe' : 'Not going'}
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
              <div className="text-[#9fb0b5] py-10 text-center">Loading polls…</div>
            ) : polls.length === 0 ? (
              <div className="text-[#9fb0b5] py-10 text-center">
                <i className="fa-solid fa-chart-bar text-2xl" />
                <div className="mt-2">No active polls</div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {polls.map(poll => (
                  <button
                    key={poll.id}
                    onClick={() => navigate(`/community/${poll.community_id}/polls_react`)}
                    className="text-left w-full px-4 py-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                        <i className="fa-solid fa-chart-bar text-purple-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-white">{poll.question}</div>
                        <div className="text-xs text-[#9fb0b5] mt-1">
                          {poll.total_votes} vote{poll.total_votes !== 1 ? 's' : ''} • {poll.options.length} options
                        </div>
                        <div className="text-xs text-[#4db6ac] mt-1 truncate">{poll.community_name}</div>
                      </div>
                      {poll.user_vote !== null && poll.user_vote !== undefined && (
                        <div className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#4db6ac]/20 text-[#4db6ac]">
                          Voted
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
              <div className="text-[#9fb0b5] py-10 text-center">Loading tasks…</div>
            ) : tasks.length === 0 ? (
              <div className="text-[#9fb0b5] py-10 text-center">
                <i className="fa-solid fa-list-check text-2xl" />
                <div className="mt-2">No pending tasks</div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {tasks.map(task => (
                  <button
                    key={task.id}
                    onClick={() => navigate(`/community/${task.community_id}/tasks_react`)}
                    className="text-left w-full px-4 py-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
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
                        <div className="font-medium text-white">{task.title}</div>
                        {task.due_date && (
                          <div className="text-xs text-[#9fb0b5] mt-0.5">
                            Due: {formatEventDate(task.due_date)}
                          </div>
                        )}
                        <div className="text-xs text-[#4db6ac] mt-1 truncate">{task.community_name}</div>
                      </div>
                      <div className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        task.status === 'ongoing' ? 'bg-blue-500/20 text-blue-400' : 'bg-orange-500/20 text-orange-400'
                      }`}>
                        {task.status === 'ongoing' ? 'In Progress' : 'Not Started'}
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
  if (!notif) return null
  const messageLines = notif.message ? notif.message.split(/\n+/) : []
  const link = notif.link

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => e.currentTarget === e.target && onClose()}>
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b0f10] p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-lg font-semibold text-white">
            <i className="fa-solid fa-bullhorn text-[#4db6ac]" />
            Platform Announcement
          </div>
          <button className="p-2 rounded-lg hover:bg-white/10" onClick={onClose} aria-label="Close announcement modal">
            <i className="fa-solid fa-xmark text-white" />
          </button>
        </div>

        <div className="space-y-3 text-sm text-white/80 max-h-[50vh] overflow-y-auto pr-1">
          {messageLines.length > 0
            ? messageLines.map((line, idx) => (
                <p key={idx} className="leading-relaxed whitespace-pre-line">
                  {line}
                </p>
              ))
            : (
              <p className="leading-relaxed">
                {notif.message || 'No additional message provided.'}
              </p>
            )}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {link && (
            <button
              className="px-3 py-2 text-sm rounded-lg border border-white/15 bg-white/10 hover:bg-white/15"
              onClick={() => {
                try {
                  window.open(link, '_blank', 'noopener');
                } catch {
                  window.location.href = link;
                }
              }}
            >
              Open Link
            </button>
          )}
          <button
            className="px-3 py-2 text-sm rounded-lg bg-[#4db6ac] text-black font-semibold hover:brightness-110"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
