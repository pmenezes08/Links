import { useEffect, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'

type Thread = {
  other_username: string
  display_name: string
  profile_picture_url: string | null
  last_message_text: string | null
  last_activity_time: string | null
  last_sender?: string | null
  unread_count?: number
}

export default function Messages(){
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  useEffect(() => { setTitle('Messages') }, [setTitle])

  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)

  function load(silent:boolean=false){
    if (!silent) setLoading(true)
    fetch('/api/chat_threads', { credentials:'include' })
      .then(r=>r.json()).then(j=>{
        if (j?.success && Array.isArray(j.threads)){
          setThreads(prev => {
            const a = prev
            const b = j.threads as Thread[]
            if (a.length !== b.length) return b
            const changed = a.some((x, idx) => {
              const y = b[idx]
              return !y || x.other_username !== y.other_username || x.last_message_text !== y.last_message_text || x.last_activity_time !== y.last_activity_time || (x.unread_count||0) !== (y.unread_count||0)
            })
            return changed ? b : a
          })
        }
      }).catch(()=>{})
      .finally(()=> { if (!silent) setLoading(false) })
  }

  useEffect(() => {
    load(false)
    const onVis = () => { if (!document.hidden) load(true) }
    document.addEventListener('visibilitychange', onVis)
    const t = setInterval(() => load(true), 5000)
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(t) }
  }, [])

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white">
      <div className="h-full max-w-3xl mx-auto px-1 sm:px-3 py-2">
        <div className="h-full overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-black divide-y divide-white/10" style={{ WebkitOverflowScrolling: 'touch' as any }}>
          {loading ? (
            <div className="px-4 py-4 text-sm text-[#9fb0b5]">Loading chats...</div>
          ) : threads.length === 0 ? (
            <div className="px-4 py-4 text-sm text-[#9fb0b5]">No chats yet. Start a new one from the + button.</div>
          ) : (
            threads.map((t) => (
              <button
                key={t.other_username}
                onClick={() => {
                  setThreads(prev => prev.map(x => x.other_username===t.other_username ? { ...x, unread_count: 0 } : x))
                  try{ (window as any).__header_do_poll && (window as any).__header_do_poll() }catch{}
                  navigate(`/user_chat/chat/${encodeURIComponent(t.other_username)}`)
                }}
                className="w-full px-3 py-2 hover:bg-white/5 flex items-center gap-3"
              >
                <Avatar username={t.other_username} url={t.profile_picture_url || undefined} size={48} />
                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center justify-between">
                    <div className="font-medium truncate">{t.display_name}</div>
                    {t.last_activity_time && (
                      <div className="ml-3 flex-shrink-0 text-[11px] text-[#9fb0b5]">
                        {new Date(t.last_activity_time).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <div className="text-[13px] text-[#9fb0b5] truncate">
                    {t.last_message_text ? t.last_message_text : 'Say hello'}
                  </div>
                </div>
                {t.unread_count && t.unread_count > 0 ? (
                  <div className="ml-2 px-2 h-5 rounded-full bg-[#4db6ac] text-black text-[11px] flex items-center justify-center">
                    {t.unread_count > 99 ? '99+' : t.unread_count}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!confirm(`Delete chat with ${t.display_name || t.other_username}? This cannot be undone.`)) return
                    const fd = new URLSearchParams({ other_username: t.other_username })
                    fetch('/delete_chat_thread', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
                      .then(r=>r.json()).then(j=>{
                        if (j?.success){
                          setThreads(prev => prev.filter(x => x.other_username !== t.other_username))
                          try{ (window as any).__header_do_poll && (window as any).__header_do_poll() }catch{}
                        }
                      }).catch(()=>{})
                  }}
                  className="ml-2 px-2 py-1 rounded-md text-[11px] bg-red-500/20 text-red-300 hover:bg-red-500/30"
                  aria-label="Delete chat"
                >
                  Delete
                </button>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}