import { useEffect, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'

export default function Messages(){
  const { setTitle } = useHeader()
  useEffect(() => { setTitle('Messages') }, [setTitle])

  const [counts, setCounts] = useState<Array<{ community_id:number; community_name:string; active_chats:number }>>([])

  useEffect(() => {
    fetch('/get_active_chat_counts', { credentials:'include' })
      .then(r=>r.json()).then(j=>{
        if (j?.success && Array.isArray(j.counts)) setCounts(j.counts)
      }).catch(()=>{})
  }, [])

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-[#0b0f10] text-white">
      <div className="h-full max-w-3xl mx-auto px-3 py-3">
        <div className="rounded-xl border border-white/10 bg-white/5">
          <div className="p-3 border-b border-white/10 font-semibold">Your Active Chats</div>
          <div className="divide-y divide-white/10">
            {counts.length===0 ? (
              <div className="px-3 py-3 text-[#9fb0b5] text-sm">No active chats yet.</div>
            ) : counts.map(c => (
              <div key={c.community_id} className="px-3 py-2 flex items-center justify-between">
                <div className="font-medium">{c.community_name}</div>
                <div className="text-sm text-[#9fb0b5]">{c.active_chats} chats</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}