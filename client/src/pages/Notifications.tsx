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
  switch(type){
    case 'reaction': return 'fa-regular fa-heart'
    case 'reply': return 'fa-regular fa-comment'
    case 'mention': return 'fa-solid fa-at'
    case 'follow': return 'fa-solid fa-user-plus'
    case 'poll_vote': return 'fa-solid fa-square-poll-vertical'
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

  useEffect(() => { setTitle('Notifications') }, [setTitle])

  async function load(){
    try{
      setLoading(true)
      const r = await fetch('/api/notifications?all=true', { credentials:'include' })
      const j = await r.json()
      if (j?.success){ setItems(j.notifications as Notif[]) }
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function markAll(){
    await fetch('/api/notifications/mark-all-read', { method:'POST', credentials:'include' })
    load()
  }

  async function onClick(n: Notif){
    // Mark read (fire and forget)
    fetch(`/api/notifications/${n.id}/read`, { method:'POST', credentials:'include' }).catch(()=>{})
    const url = n.link || (n.post_id ? `/post/${n.post_id}` : (n.community_id ? `/community_feed_react/${n.community_id}` : '/notifications'))
    if (url.startsWith('http') || url.startsWith('/')){
      // Use SPA navigation for known in-app routes
      if (url.startsWith('/post/') || url.startsWith('/community_feed_react/')){
        navigate(url)
      } else {
        window.location.href = url
      }
    } else {
      window.location.href = url
    }
  }

  if (loading || !items) return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white overflow-y-auto">
      <div className="max-w-xl mx-auto p-3 text-[#9fb0b5]">Loading…</div>
    </div>
  )

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white overflow-y-auto">
      <div className="max-w-xl mx-auto p-3">
        <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
          <div className="text-lg font-semibold">Notifications</div>
          <button onClick={markAll} className="px-3 py-1.5 rounded-full text-sm border border-white/15 hover:border-[#4db6ac]">Mark all read</button>
        </div>
        {items.length === 0 ? (
          <div className="text-[#9fb0b5] py-10 text-center">
            <i className="fa-regular fa-bell" />
            <div className="mt-2">No notifications</div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map(n => (
              <button key={n.id}
                onClick={() => onClick(n)}
                className={`text-left w-full px-3 py-2 rounded-lg border ${n.is_read ? 'border-white/10 bg-white/[0.03]' : 'border-[#4db6ac]/40 bg-[#4db6ac]/10'}`}
              >
                <div className="flex items-start gap-2">
                  <i className={`${iconFor(n.type)} text-[#4db6ac] mt-0.5`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">
                      {n.type === 'event_invitation' ? (n.message || 'Event invitation') : (
                        <>
                          <strong>@{n.from_user}</strong> {n.type === 'reaction' ? 'reacted to your post' : n.type === 'reply' ? 'replied to your post' : 'interacted with you'}
                        </>
                      )}
                    </div>
                    <div className="text-[11px] text-[#9fb0b5]">{timeAgo(n.created_at)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

