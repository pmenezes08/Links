import { useEffect, useMemo, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'

export default function Messages(){
  const { setTitle } = useHeader()
  useEffect(() => { setTitle('Messages') }, [setTitle])

  type Community = { id:number; name:string }
  type Member = { username:string; profile_picture?:string|null }

  const [communities, setCommunities] = useState<Community[]>([])
  const [membersByCommunity, setMembersByCommunity] = useState<Record<number, Member[]>>({})
  const [selectedCommunityId, setSelectedCommunityId] = useState<number|''>('')
  const [otherUserId, setOtherUserId] = useState<number|''>('')
  const [otherUsername, setOtherUsername] = useState('')
  const [otherUserAvatar, setOtherUserAvatar] = useState<string|null>(null)
  const [messages, setMessages] = useState<Array<{ id:number; text:string; sent:boolean; time:string }>>([])
  const [draft, setDraft] = useState('')

  useEffect(() => {
    fetch('/get_user_communities', { credentials:'include' })
      .then(r=>r.json()).then(j=>{
        if (j?.success && Array.isArray(j.communities)){
          const mapped = j.communities.map((c:any)=>({ id:c.id, name:c.name })) as Community[]
          setCommunities(mapped)
        }
      }).catch(()=>{})
  }, [])

  useEffect(() => {
    if (!selectedCommunityId) return
    const fd = new URLSearchParams({ community_id: String(selectedCommunityId) })
    fetch('/get_community_members', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
      .then(r=>r.json()).then(j=>{
        if (j?.success && Array.isArray(j.members)){
          const list = j.members.map((m:any)=> ({ username: m.username, profile_picture: m.profile_picture ?? null })) as Member[]
          setMembersByCommunity(prev => ({ ...prev, [Number(selectedCommunityId)]: list }))
        }
      }).catch(()=>{})
  }, [selectedCommunityId])

  function resolveAvatar(url?:string|null){
    if (!url) return null
    if (url.startsWith('http') || url.startsWith('/static')) return url
    return `/static/${url}`
  }

  function openThread(member:Member){
    const memberUsername = member.username
    setOtherUserAvatar(resolveAvatar(member.profile_picture || null))
    fetch('/api/get_user_id_by_username', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: memberUsername }) })
      .then(r=>r.json()).then(j=>{
        if (j?.success && j.user_id){
          setOtherUserId(j.user_id)
          setOtherUsername(memberUsername)
          const fd = new URLSearchParams({ other_user_id: String(j.user_id) })
          fetch('/get_messages', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
            .then(r=>r.json()).then(j=>{
              if (j?.success && Array.isArray(j.messages)) setMessages(j.messages)
              else setMessages([])
            }).catch(()=> setMessages([]))
        }
      }).catch(()=>{})
  }

  function send(){
    if (!otherUserId || !draft.trim()) return
    const fd = new URLSearchParams({ recipient_id: String(otherUserId), message: draft.trim() })
    fetch('/send_message', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
      .then(r=>r.json()).then(j=>{
        if (j?.success){
          setDraft('')
          const now = new Date().toISOString().slice(0,19).replace('T',' ')
          setMessages(prev => [...prev, { id: Math.random(), text: fd.get('message') || '', sent:true, time: now }])
        }
      }).catch(()=>{})
  }

  const members = useMemo(()=> membersByCommunity[Number(selectedCommunityId)] || [], [membersByCommunity, selectedCommunityId])

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-[#0b0f10] text-white overflow-hidden">
      <div className="h-full max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3">
        {/* Left column: communities + members (scrollable) */}
        <div className="md:col-span-1 border-b md:border-b-0 md:border-r border-white/10 overflow-y-auto">
          <div className="p-3 border-b border-white/10 font-semibold">Communities</div>
          <div className="p-2 grid grid-cols-2 md:block gap-2">
            {communities.map(c => (
              <button key={c.id} className={`w-full text-left px-3 py-2 rounded-md hover:bg-white/5 ${selectedCommunityId===c.id? 'bg-white/5' : ''}`} onClick={()=> setSelectedCommunityId(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
          {selectedCommunityId && (
            <>
              <div className="p-3 border-y border-white/10 font-semibold">Members</div>
              <div className="p-2 space-y-1">
                {members.length===0 ? (
                  <div className="text-[#9fb0b5] text-sm px-3">No members</div>
                ) : members.map((m, idx) => (
                  <button key={idx} className="w-full text-left px-3 py-2 rounded-md hover:bg-white/5 flex items-center gap-2" onClick={()=> openThread(m)}>
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 flex items-center justify-center">
                      {resolveAvatar(m.profile_picture) ? (
                        <img src={resolveAvatar(m.profile_picture)!} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs opacity-80">{m.username.slice(0,2).toUpperCase()}</span>
                      )}
                    </div>
                    <span className="truncate">{m.username}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right column: thread */}
        <div className="md:col-span-2 flex flex-col min-h-0">
          <div className="p-3 border-b border-white/10 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 flex items-center justify-center">
              {otherUserAvatar ? (
                <img src={otherUserAvatar} alt="" className="w-full h-full object-cover" />
              ) : otherUsername ? (
                <span className="text-xs opacity-80">{otherUsername.slice(0,2).toUpperCase()}</span>
              ) : null}
            </div>
            <div className="font-semibold truncate">{otherUsername || 'Select a conversation'}</div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.map(m => (
              <div key={m.id} className={`max-w-[85%] px-3 py-2 rounded-lg break-words ${m.sent ? 'ml-auto bg-[#4db6ac] text-black' : 'bg-white/10'}`}>
                <div className="text-sm whitespace-pre-wrap break-words">{m.text}</div>
                <div className="text-[10px] opacity-70 mt-1 text-right">{m.time}</div>
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-white/10 flex gap-2">
            <input className="flex-1 rounded-md bg-black border border-white/15 px-3 py-2" placeholder="Type a message" value={draft} onChange={e=> setDraft(e.target.value)} />
            <button className="px-4 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110" onClick={send}>Send</button>
          </div>
        </div>
      </div>
    </div>
  )
}