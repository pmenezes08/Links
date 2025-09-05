import { useEffect, useMemo, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'

export default function Messages(){
  const { setTitle } = useHeader()
  useEffect(() => { setTitle('Messages') }, [setTitle])

  const [communities, setCommunities] = useState<Array<{ id:number; name:string }>>([])
  const [membersByCommunity, setMembersByCommunity] = useState<Record<number, string[]>>({})
  const [selectedCommunityId, setSelectedCommunityId] = useState<number|''>('')
  const [otherUserId, setOtherUserId] = useState<number|''>('')
  const [otherUsername, setOtherUsername] = useState('')
  const [messages, setMessages] = useState<Array<{ id:number; text:string; sent:boolean; time:string }>>([])
  const [draft, setDraft] = useState('')

  useEffect(() => {
    fetch('/get_user_communities', { credentials:'include' })
      .then(r=>r.json()).then(j=>{
        if (j?.success && Array.isArray(j.communities)){
          const mapped = j.communities.map((c:any)=>({ id:c.id, name:c.name }))
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
          setMembersByCommunity(prev => ({ ...prev, [Number(selectedCommunityId)]: j.members.map((m:any)=> m.username || m) }))
        }
      }).catch(()=>{})
  }, [selectedCommunityId])

  function openThread(memberUsername:string){
    // We need the user rowid for get_messages; request it via a small helper
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
    <div className="fixed inset-x-0 top-14 bottom-0 bg-[#0b0f10] text-white">
      <div className="h-full grid grid-cols-3 max-w-5xl mx-auto">
        <div className="col-span-1 border-r border-white/10 overflow-y-auto">
          <div className="p-3 border-b border-white/10 font-semibold">Communities</div>
          <div className="p-2 space-y-1">
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
                ) : members.map((m:string, idx:number) => (
                  <button key={idx} className="w-full text-left px-3 py-2 rounded-md hover:bg-white/5" onClick={()=> openThread(m)}>
                    {m}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="col-span-2 flex flex-col">
          <div className="p-3 border-b border-white/10">
            <div className="font-semibold">{otherUsername || 'Select a conversation'}</div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.map(m => (
              <div key={m.id} className={`max-w-[80%] px-3 py-2 rounded-lg ${m.sent ? 'ml-auto bg-[#4db6ac] text-black' : 'bg-white/10'}`}>
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