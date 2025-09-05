import { useEffect, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'

export default function Messages(){
  const { setTitle } = useHeader()
  useEffect(() => { setTitle('Messages') }, [setTitle])

  const [counts, setCounts] = useState<Array<{ community_id:number; community_name:string; active_chats:number }>>([])
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  useEffect(() => {
    fetch('/get_active_chat_counts', { credentials:'include' })
      .then(r=>r.json()).then(j=>{
        if (j?.success && Array.isArray(j.counts)) setCounts(j.counts)
      }).catch(()=>{})
  }, [])

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white">
      <div className="h-full max-w-3xl mx-auto px-3 py-3">
        <div className="rounded-xl border border-white/10 bg-black">
          <button className="w-full p-3 border-b border-white/10 font-semibold text-left flex items-center justify-between" onClick={()=>{
            const allOpen = Object.values(expanded).some(v=>v)
            if (allOpen){ setExpanded({}) } else {
              const map: Record<number,boolean> = {}
              for (const c of counts) map[c.community_id] = true
              setExpanded(map)
            }
          }}>
            <span>Active Chats</span>
            <i className="fa-solid fa-chevron-down text-xs text-[#9fb0b5]" />
          </button>
          <div className="divide-y divide-white/10">
            {counts.length===0 ? (
              <div className="px-3 py-3 text-[#9fb0b5] text-sm">No active chats yet.</div>
            ) : counts.map(c => (
              <div key={c.community_id}>
                <button className="w-full px-3 py-2 text-left hover:bg-white/5 flex items-center justify-between" onClick={()=> setExpanded(prev=> ({...prev, [c.community_id]: !prev[c.community_id]}))}>
                  <span className="font-medium">{c.community_name}</span>
                  <span className="text-sm text-[#9fb0b5]">{c.active_chats} chats</span>
                </button>
                {expanded[c.community_id] && (
                  <div className="px-3 py-2 text-sm text-[#9fb0b5]">Tap + to start a new chat or open an existing thread.</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}