import { useEffect, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'

type Thread = {
  other_username: string
  display_name: string
  profile_picture_url: string | null
  last_sent_text: string | null
  last_sent_time: string | null
  last_activity_time: string | null
}

export default function Messages(){
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  useEffect(() => { setTitle('Messages') }, [setTitle])

  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/chat_threads', { credentials:'include' })
      .then(r=>r.json()).then(j=>{
        if (j?.success && Array.isArray(j.threads)) setThreads(j.threads)
      }).catch(()=>{})
      .finally(()=> setLoading(false))
  }, [])

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white">
      <div className="h-full max-w-3xl mx-auto px-1 sm:px-3 py-2">
        <div className="h-full overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-black divide-y divide-white/10" style={{ WebkitOverflowScrolling: 'touch' as any }}>
          {loading ? (
            <div className="px-4 py-4 text-sm text-[#9fb0b5]">Loading chats...</div>
          ) : threads.length === 0 ? (
            <div className="px-4 py-4 text-sm text-[#9fb0b5]">No chats yet.</div>
          ) : (
            threads.map((t) => (
              <button
                key={t.other_username}
                onClick={() => navigate(`/user_chat/chat/${encodeURIComponent(t.other_username)}`)}
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
                    {t.last_sent_text ? t.last_sent_text : 'Say hello'}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}