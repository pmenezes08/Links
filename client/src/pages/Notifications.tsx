import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
}

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
  const [items, setItems] = useState<Notif[]|null>(null)
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [broadcastOpen, setBroadcastOpen] = useState(false)
  const [broadcastNotif, setBroadcastNotif] = useState<Notif|null>(null)

  useEffect(() => { setTitle('Notifications') }, [setTitle])

  async function load(){
    try{
      setLoading(true)
      const r = await fetch('/api/notifications?all=true', { credentials:'include' })
      const j = await r.json()
      if (j?.success){
        const filtered = (j.notifications as Notif[]).filter(n => n?.type !== 'message')
        setItems(filtered)
      }
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function markAll(){
    await fetch('/api/notifications/mark-all-read', { method:'POST', credentials:'include' })
    load()
  }

  async function clearAll(){
    if (clearing) return
    if (!confirm('Clear all notifications? This cannot be undone.')) return
    try{
      setClearing(true)
      await fetch('/api/notifications/mark-all-read', { method:'POST', credentials:'include' })
      await fetch('/api/notifications/delete-read', { method:'POST', credentials:'include' })
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
      if (url.startsWith('/post/') || url.startsWith('/community_feed_react/') || url.startsWith('/event/') || url.includes('/tasks_react') || url.includes('/polls_react')){
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

  if (loading || !items) {
    return (
      <div className="min-h-screen bg-black text-white pb-safe">
        <div className="max-w-xl mx-auto px-3 pb-20 text-[#9fb0b5]">Loading…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white pb-safe">
      <div className="max-w-xl mx-auto px-3 pb-20">
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
        {items.length === 0 ? (
          <div className="text-[#9fb0b5] py-10 text-center">
            <i className="fa-regular fa-bell" />
            <div className="mt-2">No notifications</div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map(n => {
              const typeKey = n.type?.split(':')[0] ?? n.type
              return (
                <button
                  key={n.id}
                  onClick={() => onClick(n)}
                  className={`text-left w-full px-3 py-2 rounded-lg border ${n.is_read ? 'border-white/10 bg-white/[0.03]' : 'border-[#4db6ac]/40 bg-[#4db6ac]/10'}`}
                >
                  <div className="flex items-start gap-2">
                    <i className={`${iconFor(n.type)} text-[#4db6ac] mt-0.5`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">
                        {typeKey === 'event_invitation' ? (n.message || 'Event invitation') :
                         typeKey === 'community_post' ? (n.message || `@${n.from_user} made a new post`) :
                         typeKey === 'new_member' ? (n.message || `@${n.from_user} joined the community`) :
                         typeKey === 'poll' ? (n.message || `@${n.from_user} created a new poll`) :
                         typeKey === 'admin_broadcast' ? (n.message || 'Administrator announcement') : (
                          n.message ? (n.message) : (
                            <>
                              <strong>@{n.from_user}</strong> {
                                typeKey === 'task_assigned' ? 'assigned you a task' :
                                typeKey === 'reaction' ? 'reacted to your post' :
                                typeKey === 'reply' ? 'replied to your post' :
                                typeKey === 'mention_post' ? 'mentioned you in a post' :
                                typeKey === 'mention_reply' ? 'mentioned you in a reply' : 'interacted with you'
                              }
                            </>
                          )
                        )}
                      </div>
                      <div className="text-[11px] text-[#9fb0b5]">{timeAgo(n.created_at)}</div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
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
