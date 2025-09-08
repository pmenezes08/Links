import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

export default function ChatThread(){
  const { setTitle } = useHeader()
  const { username } = useParams()
  useEffect(() => { setTitle(username ? `Chat: ${username}` : 'Chat') }, [setTitle, username])

  const [otherUserId, setOtherUserId] = useState<number|''>('')
  const [messages, setMessages] = useState<Array<{ id:number; text:string; sent:boolean; time:string }>>([])
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement|null>(null)
  const textareaRef = useRef<HTMLTextAreaElement|null>(null)

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

  // Scroll to bottom whenever messages change
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    // slight delay to ensure DOM paints
    const t = setTimeout(() => { el.scrollTop = el.scrollHeight }, 0)
    return () => clearTimeout(t)
  }, [messages])

  // Auto-size composer textarea
  function adjustTextareaHeight(){
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const maxPx = 160 // ~10rem
    ta.style.height = Math.min(ta.scrollHeight, maxPx) + 'px'
  }
  useEffect(() => { adjustTextareaHeight() }, [])
  useEffect(() => { adjustTextareaHeight() }, [draft])

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
        {/* Messages list (WhatsApp style bubbles) */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-2 sm:px-3 py-3 space-y-1">
          {messages.map(m => (
            <div key={m.id} className={`flex ${m.sent ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[82%] md:max-w-[70%] px-3 py-2 rounded-2xl text-[14px] leading-snug whitespace-pre-wrap break-words shadow-sm border ${m.sent ? 'bg-[#075E54] text-white border-[#075E54]' : 'bg-[#1a1a1a] text-white border-white/10'} ${m.sent ? 'rounded-br-md' : 'rounded-bl-md'}`}
              >
                <div>{m.text}</div>
                <div className={`text-[10px] mt-1 ${m.sent ? 'text-white/70' : 'text-white/50'} text-right`}>{new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Composer (sticky bottom) */}
        <div className="p-2 sm:p-3 border-t border-white/10 flex items-end gap-2 bg-black">
          <button className="hidden sm:inline-flex w-9 h-9 flex-shrink-0 items-center justify-center rounded-full bg-white/5 border border-white/10">
            <i className="fa-solid fa-paperclip text-white/70 text-sm" />
          </button>
          <textarea
            ref={textareaRef}
            rows={1}
            className="flex-1 rounded-2xl bg-[#0b0f10] border border-white/15 px-4 py-2 text-[16px] leading-snug outline-none focus:border-[#4db6ac] resize-none max-h-40 min-h-[42px]"
            placeholder="Type a message"
            value={draft}
            onChange={e=> setDraft(e.target.value)}
            // Enter inserts newline by default; no auto-send on Enter
          />
          <button
            className="px-4 py-2 rounded-full bg-[#4db6ac] text-black font-medium hover:brightness-110"
            onClick={send}
            aria-label="Send"
          >
            <i className="fa-solid fa-paper-plane" />
          </button>
        </div>
      </div>
    </div>
  )
}