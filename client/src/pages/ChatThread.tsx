import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

export default function ChatThread(){
  const { setTitle } = useHeader()
  const { username } = useParams()
  useEffect(() => { setTitle(username ? `Chat: ${username}` : 'Chat') }, [setTitle, username])

  const [otherUserId, setOtherUserId] = useState<number|''>('')
  const [messages, setMessages] = useState<Array<{ id:number; text:string; sent:boolean; time:string }>>([])
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!username) return
    // Resolve user id then load messages
    fetch('/api/get_user_id_by_username', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username }) })
      .then(r=>r.json()).then(j=>{
        if (j?.success && j.user_id){
          setOtherUserId(j.user_id)
          const fd = new URLSearchParams({ other_user_id: String(j.user_id) })
          fetch('/get_messages', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
            .then(r=>r.json()).then(j=>{
              if (j?.success && Array.isArray(j.messages)) setMessages(j.messages)
            }).catch(()=>{})
        }
      }).catch(()=>{})
  }, [username])

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

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white">
      <div className="h-full max-w-3xl mx-auto flex flex-col">
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
  )
}