import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'

export default function ChatThread(){
  const { setTitle } = useHeader()
  const { username } = useParams()
  const navigate = useNavigate()
  useEffect(() => { setTitle(username ? `Chat: ${username}` : 'Chat') }, [setTitle, username])

  const [otherUserId, setOtherUserId] = useState<number|''>('')
  const [messages, setMessages] = useState<Array<{ id:number; text:string; sent:boolean; time:string }>>([])
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement|null>(null)
  const textareaRef = useRef<HTMLTextAreaElement|null>(null)
  const [otherProfile, setOtherProfile] = useState<{ display_name:string; profile_picture?:string|null }|null>(null)
  const [typing, setTyping] = useState(false)
  const typingTimer = useRef<any>(null)
  const pollTimer = useRef<any>(null)

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
          // Load brief profile for header avatar
          fetch(`/api/get_user_profile_brief?username=${encodeURIComponent(username)}`, { credentials:'include' })
            .then(r=>r.json()).then(j=>{
              if (j?.success){ setOtherProfile({ display_name: j.display_name, profile_picture: j.profile_picture||null }) }
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

  // Poll for new messages and typing status
  useEffect(() => {
    if (!username || !otherUserId) return
    async function poll(){
      try{
        // Refresh messages (backend marks read)
        const fd = new URLSearchParams({ other_user_id: String(otherUserId) })
        const r = await fetch('/get_messages', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
        const j = await r.json()
        if (j?.success && Array.isArray(j.messages)) setMessages(j.messages)
      }catch{}
      try{
        const t = await fetch(`/api/typing?peer=${encodeURIComponent(username!)}`, { credentials:'include' })
        const tj = await t.json().catch(()=>null)
        setTyping(!!tj?.is_typing)
      }catch{}
    }
    poll()
    pollTimer.current = setInterval(poll, 2000)
    return () => { if (pollTimer.current) clearInterval(pollTimer.current) }
  }, [username, otherUserId])

  // Freeze body scroll (iOS-safe) so only chat pane scrolls; preserves fixed header visibility
  useEffect(() => {
    const scrollY = window.scrollY || window.pageYOffset
    const prevBodyPosition = document.body.style.position
    const prevBodyTop = document.body.style.top
    const prevBodyWidth = document.body.style.width
    const prevHtmlOverflow = document.documentElement.style.overflow

    document.documentElement.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'

    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow
      document.body.style.position = prevBodyPosition
      document.body.style.top = prevBodyTop
      document.body.style.width = prevBodyWidth
      window.scrollTo(0, scrollY)
    }
  }, [])

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
          // stop typing state
          fetch('/api/typing', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ peer: username, is_typing: false }) }).catch(()=>{})
        }
      }).catch(()=>{})
  }

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white">
      <div className="h-full max-w-3xl mx-auto flex flex-col">
        {/* Chat subheader with back button (WhatsApp-style) */}
        <div className="h-12 border-b border-white/10 flex items-center gap-2 px-3 bg-black/70 backdrop-blur z-30">
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> navigate('/user_chat')} aria-label="Back">
            <i className="fa-solid fa-arrow-left" />
          </button>
          <Avatar username={username || ''} url={otherProfile?.profile_picture || undefined} size={28} />
          <div className="font-medium truncate">{otherProfile?.display_name || username}</div>
        </div>
        {/* Messages list (WhatsApp style bubbles) */}
        <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain px-2 sm:px-3 py-3 space-y-1" style={{ WebkitOverflowScrolling: 'touch' as any }}>
          {messages.map(m => (
            <LongPressDeletable key={m.id} onDelete={() => {
              const fd = new URLSearchParams({ message_id: String(m.id) })
              fetch('/delete_message', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
                .then(r=>r.json()).then(j=>{ if (j?.success){ setMessages(prev => prev.filter(x => x.id !== m.id)) } }).catch(()=>{})
            }}>
              <div className={`flex ${m.sent ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[70%] md:max-w-[70%] px-3 py-2 rounded-2xl text-[14px] leading-snug whitespace-pre-wrap break-words shadow-sm border ${m.sent ? 'bg-[#075E54] text-white border-[#075E54]' : 'bg-[#1a1a1a] text-white border-white/10'} ${m.sent ? 'rounded-br-md' : 'rounded-bl-md'}`}
                >
                  <div>{m.text}</div>
                  <div className={`text-[10px] mt-1 ${m.sent ? 'text-white/70' : 'text-white/50'} text-right`}>{new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              </div>
            </LongPressDeletable>
          ))}
        </div>

        {/* Typing indicator row (fixed height to avoid layout shift) */}
        <div className="h-8 px-3 flex items-center gap-2 text-[#9fb0b5] flex-shrink-0">
          {typing ? (
            <>
              <Avatar username={username || ''} url={otherProfile?.profile_picture || undefined} size={18} />
              <span className="text-[12px]">typing...</span>
            </>
          ) : null}
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
            onChange={e=> {
              setDraft(e.target.value)
              // typing start (debounced stop)
              fetch('/api/typing', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ peer: username, is_typing: true }) }).catch(()=>{})
              if (typingTimer.current) clearTimeout(typingTimer.current)
              typingTimer.current = setTimeout(() => {
                fetch('/api/typing', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ peer: username, is_typing: false }) }).catch(()=>{})
              }, 1200)
            }}
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

function LongPressDeletable({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }){
  const [showMenu, setShowMenu] = useState(false)
  const timerRef = useRef<any>(null)
  function handleStart(){
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setShowMenu(true), 3000)
  }
  function handleEnd(){
    if (timerRef.current) clearTimeout(timerRef.current)
  }
  return (
    <div className="relative">
      <div
        onMouseDown={handleStart}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={handleStart}
        onTouchEnd={handleEnd}
      >
        {children}
      </div>
      {showMenu && (
        <div className="absolute z-40 -top-8 right-2 bg-black border border-white/15 rounded-md shadow-lg px-3 py-1">
          <button
            className="text-red-400 text-sm"
            onClick={() => { setShowMenu(false); onDelete() }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}