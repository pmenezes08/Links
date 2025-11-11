import { useEffect, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'

export default function NewMessage(){
  const { setTitle } = useHeader()
  useEffect(() => { setTitle('New Message') }, [setTitle])

  type Community = { id:number; name:string }
  type Member = { username:string; profile_picture?:string|null }

  const [communities, setCommunities] = useState<Community[]>([])
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [membersByCommunity, setMembersByCommunity] = useState<Record<number, Member[]>>({})

  useEffect(() => {
    fetch('/get_user_communities', { credentials:'include' })
      .then(r=>r.json()).then(j=>{
        if (j?.success && Array.isArray(j.communities)){
          const mapped = j.communities.map((c:any)=>({ id:c.id, name:c.name })) as Community[]
          setCommunities(mapped)
        }
      }).catch(()=>{})
  }, [])

  function resolveAvatar(url?:string|null){
    if (!url) return null
    if (url.startsWith('http') || url.startsWith('/static')) return url
    return `/static/${url}`
  }

  function toggleCommunity(comm:Community){
    setExpanded(prev => ({ ...prev, [comm.id]: !prev[comm.id] }))
    if (!membersByCommunity[comm.id]){
      const fd = new URLSearchParams({ community_id: String(comm.id) })
      fetch('/get_community_members', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
        .then(r=>r.json()).then(j=>{
          if (j?.success && Array.isArray(j.members)){
            const list = j.members.map((m:any)=> ({ username: m.username, profile_picture: m.profile_picture ?? null })) as Member[]
            setMembersByCommunity(prev => ({ ...prev, [comm.id]: list }))
          }
        }).catch(()=>{})
    }
  }

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white overflow-y-auto">
      <div className="max-w-3xl mx-auto px-3 py-3">
        <div className="rounded-xl border border-white/10 bg-black">
          <div className="p-3 border-b border-white/10 font-semibold">Select a Community</div>
          <div className="divide-y divide-white/10">
            {communities.map(c => (
              <div key={c.id}>
                <button className="w-full px-3 py-2 text-left hover:bg-white/5 flex items-center justify-between" onClick={()=> toggleCommunity(c)}>
                  <span className="font-medium">{c.name}</span>
                  <i className={`fa-solid ${expanded[c.id] ? 'fa-chevron-down' : 'fa-chevron-right'} text-xs text-[#9fb0b5]`} />
                </button>
                {expanded[c.id] && (
                  <div className="px-3 py-2 space-y-1">
                    {(membersByCommunity[c.id]||[]).map((m, idx) => (
                      <a key={idx} className="block px-3 py-2 rounded-md hover:bg-white/5 flex items-center gap-2" href={`/user_chat/chat/${encodeURIComponent(m.username)}`}>
                        <Avatar username={m.username} url={resolveAvatar(m.profile_picture)} size={32} linkToProfile />
                        <span className="truncate">{m.username}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}