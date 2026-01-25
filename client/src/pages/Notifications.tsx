import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { useHeader } from '../contexts/HeaderContext'

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

type TabType = 'notifications' | 'calendar' | 'polls' | 'tasks'

function iconFor(type?: string){
  const normalized = type?.split(':')[0]
  switch(normalized){
      case 'admin_broadcast': return 'fa-solid fa-bullhorn'
      case 'community_post': return 'fa-solid fa-bullhorn'
      case 'announcement': return 'fa-solid fa-bullhorn'
      case 'task_assigned': return 'fa-solid fa-list-check'
      case 'reaction': return 'fa-regular fa-heart'
      case 'reply': return 'fa-regular fa-comment'
      case 'mention_post': return 'fa-solid fa-at'
      case 'mention_reply': return 'fa-solid fa-at'
      case 'follow': return 'fa-solid fa-user-plus'
      case 'follow_request': return 'fa-solid fa-user-plus'
      case 'follow_accept': return 'fa-solid fa-user-check'
    case 'poll': return 'fa-solid fa-chart-bar'
    case 'poll_vote': return 'fa-solid fa-square-poll-vertical'
    case 'event_invitation': return 'fa-solid fa-calendar-check'
    case 'new_member': return 'fa-solid fa-user-plus'
    default: return 'fa-regular fa-bell'
  }
}

function timeAgo(ts?: string){
  if (!ts) return ''
  const d = new Date(ts)
  const s = Math.floor((Date.now() - d.getTime())/1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s/60)+'m'
  if (s < 86400) return Math.floor(s/3600)+'h'
  if (s < 604800) return Math.floor(s/86400)+'d'
  return d.toLocaleDateString()
}

export default function Notifications(){
  const { setTitle } = useHeader()
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
  const [eventsLoading, setEventsLoading] = useState(false)
  const [pollsLoading, setPollsLoading] = useState(false)
  const [tasksLoading, setTasksLoading] = useState(false)

  useEffect(() => { setTitle('Notifications') }, [setTitle])

  async function load(){
    try{
      setLoading(true)
      const r = await fetch('/api/notifications?all=true', { credentials:'include' })
      console.log('📋 Notifications API status:', r.status)
      const j = await r.json()
      console.log('📋 Raw notifications response:', j)
      if (j?.success){
        console.log('📋 Total notifications received:', j.notifications?.length || 0)
        console.log('📋 Notification types:', j.notifications?.map((n: Notif) => n?.type))
        const filtered = (j.notifications as Notif[]).filter(n => n?.type !== 'message' && n?.type !== 'reaction')
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
    } finally { setLoading(false) }
  }

  useEffect(() => { 
    load()
    // Clear badge when viewing notifications page
    clearIOSNotifications()
  }, [])
  
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
      const r = await fetch('/api/all_calendar_events', { credentials: 'include' })
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
      const r = await fetch('/api/all_active_polls', { credentials: 'include' })
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
      const r = await fetch('/api/all_my_tasks', { credentials: 'include' })
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

  // Clear iOS notification center and badge
  async function clearIOSNotifications() {
    if (Capacitor.isNativePlatform()) {
      try {
        // Remove all delivered notifications from iOS Notification Center
        await PushNotifications.removeAllDeliveredNotifications()
        console.log('✅ Cleared iOS notification center')
      } catch (e) {
        console.warn('Could not clear iOS notifications:', e)
      }
    }
    // Tell server to reset badge count via silent push
    try {
      console.log('📛 Calling /api/notifications/clear-badge...')
      const resp = await fetch('/api/notifications/clear-badge', { method: 'POST', credentials: 'include' })
      const result = await resp.json()
      console.log('📛 Clear badge response:', result)
    } catch (e) {
      console.warn('Could not clear badge via server:', e)
    }
  }

  async function markAll(){
    await fetch('/api/notifications/mark-all-read', { method:'POST', credentials:'include' })
    // Clear iOS notification center when marking all as read
    await clearIOSNotifications()
    load()
  }

  async function clearAll(){
    if (clearing) return
    if (!confirm('Clear all notifications? This cannot be undone.')) return
    try{
      setClearing(true)
      await fetch('/api/notifications/mark-all-read', { method:'POST', credentials:'include' })
      await fetch('/api/notifications/delete-read', { method:'POST', credentials:'include' })
      // Clear iOS notification center when clearing all
      await clearIOSNotifications()
      await load()
    } finally {
      setClearing(false)
    }
  }

  async function onClick(n: Notif){
    // Mark read (fire and forget)
    fetch(`/api/notifications/${n.id}/read`, { method:'POST', credentials:'include' }).catch(()=>{})
    
    // For poll notifications, navigate to polls page
    let url = n.link
    const typeKey = n.type?.split(':')[0] ?? n.type
    if (typeKey === 'admin_broadcast') {
      setBroadcastNotif(n)
      setBroadcastOpen(true)
      return
    }
    const isPollNotification = typeKey === 'poll' || typeKey === 'poll_reminder' || typeKey === 'poll_closed'
    if (!url && isPollNotification && n.community_id) {
      url = `/community/${n.community_id}/polls_react`
    } else if (!url) {
      url = n.post_id ? `/post/${n.post_id}` : (n.community_id ? `/community_feed_react/${n.community_id}` : '/notifications')
    }
    
    console.log('Notification clicked:', { id: n.id, type: n.type, link: n.link, url })
    if (url.startsWith('http') || url.startsWith('/')){
      // Use SPA navigation for known in-app routes
      if (url.startsWith('/post/') || url.startsWith('/reply/') || url.startsWith('/community_feed_react/') || url.startsWith('/community/') || url.startsWith('/event/') || url.includes('/tasks_react') || url.includes('/polls_react') || url.includes('/useful_links_react') || url.startsWith('/admin_dashboard')){
        console.log('Using SPA navigation to:', url)
        navigate(url)
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
                  return (
                    <button
                      key={n.id}
                      onClick={() => onClick(n)}
                      className={`text-left w-full px-3 py-2.5 rounded-xl border ${n.is_read ? 'border-white/10 bg-white/[0.03]' : 'border-[#4db6ac]/40 bg-[#4db6ac]/10'}`}
                    >
                      <div className="flex items-start gap-3">
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
                                    typeKey === 'reply' ? 'replied to your post' :
                                    typeKey === 'mention_post' ? 'mentioned you in a post' :
                                    typeKey === 'mention_reply' ? 'mentioned you in a reply' : 'interacted with you'}
                                  </span>
                                </>
                              )
                            )}
                          </div>
                          <div className="text-[11px] text-[#9fb0b5] mt-0.5">{timeAgo(n.created_at)}</div>
                        </div>
                        {!n.is_read && (
                          <div className="w-2 h-2 rounded-full bg-[#4db6ac] flex-shrink-0 mt-2" />
                        )}
                      </div>
                    </button>
                  )
                })}
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
