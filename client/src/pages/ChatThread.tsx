import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'

export default function ChatThread(){
  const { setTitle } = useHeader()
  const { username } = useParams()
  const navigate = useNavigate()
  useEffect(() => { setTitle(username ? `Chat: ${username}` : 'Chat') }, [setTitle, username])

  const [otherUserId, setOtherUserId] = useState<number|''>('')
  const [messages, setMessages] = useState<Array<{ id:number; text:string; sent:boolean; time:string; reaction?:string; replySnippet?:string }>>([])
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<{ text:string }|null>(null)
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement|null>(null)
  const textareaRef = useRef<HTMLTextAreaElement|null>(null)
  const storageKey = useMemo(() => `chat_meta_${username || ''}`, [username])
  const metaRef = useRef<Record<string, { reaction?: string; replySnippet?: string }>>({})
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
              if (j?.success && Array.isArray(j.messages)) {
                setMessages(j.messages.map((m:any) => {
                  const k = `${m.time}|${m.text}|${m.sent ? 'me' : 'other'}`
                  const meta = metaRef.current[k] || {}
                  return { ...m, reaction: meta.reaction, replySnippet: meta.replySnippet }
                }))
              }
            }).catch(()=>{})
          // Load brief profile for header avatar
          fetch(`/api/get_user_profile_brief?username=${encodeURIComponent(username)}`, { credentials:'include' })
            .then(r=>r.json()).then(j=>{
              if (j?.success){ setOtherProfile({ display_name: j.display_name, profile_picture: j.profile_picture||null }) }
            }).catch(()=>{})
        }
      }).catch(()=>{})
  }, [username])

  // Auto-scroll on first open, then only when already near bottom
  const lastCountRef = useRef(0)
  const didInitialAutoScrollRef = useRef(false)
  const [showScrollDown, setShowScrollDown] = useState(false)
  function scrollToBottom(){
    const el = listRef.current
    if (!el) return
    requestAnimationFrame(() => requestAnimationFrame(() => { el.scrollTop = el.scrollHeight }))
  }
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (!didInitialAutoScrollRef.current) {
      if (messages.length > 0){
        scrollToBottom()
        didInitialAutoScrollRef.current = true
        lastCountRef.current = messages.length
        return
      }
    }
    if (messages.length > lastCountRef.current){
      const near = (el.scrollHeight - el.scrollTop - el.clientHeight) < 120
      if (near){
        scrollToBottom()
        setShowScrollDown(false)
      } else {
        setShowScrollDown(true)
      }
    }
    lastCountRef.current = messages.length
  }, [messages])

  // Load persisted meta
  useEffect(() => {
    try{ const raw = localStorage.getItem(storageKey); if (raw) metaRef.current = JSON.parse(raw) || {} }catch{}
  }, [storageKey])

  // Poll for new messages and typing status
  useEffect(() => {
    if (!username || !otherUserId) return
    async function poll(){
      try{
        // Refresh messages (backend marks read)
        const fd = new URLSearchParams({ other_user_id: String(otherUserId) })
        const r = await fetch('/get_messages', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
        const j = await r.json()
        if (j?.success && Array.isArray(j.messages)){
          setMessages(prev => j.messages.map((m:any) => {
            const existing = prev.find(x => x.id === m.id)
            const k = `${m.time}|${m.text}|${m.sent ? 'me' : 'other'}`
            const meta = metaRef.current[k] || {}
            return existing
              ? { ...m, reaction: existing.reaction ?? meta.reaction, replySnippet: existing.replySnippet ?? meta.replySnippet }
              : { ...m, reaction: meta.reaction, replySnippet: meta.replySnippet }
          }))
        }
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
    if (!otherUserId || !draft.trim() || sending) return
    
    setSending(true)
    const messageText = draft.trim()
    const fd = new URLSearchParams({ recipient_id: String(otherUserId), message: messageText })
    
    fetch('/send_message', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
      .then(r=>r.json()).then(j=>{
        if (j?.success){
          setDraft('')
          const now = new Date().toISOString().slice(0,19).replace('T',' ')
          const replySnippet = replyTo ? (replyTo.text.length > 90 ? replyTo.text.slice(0,90) + '…' : replyTo.text) : undefined
          
          if (replySnippet){
            const k = `${now}|${messageText}|me`
            metaRef.current[k] = { ...(metaRef.current[k]||{}), replySnippet }
            try{ localStorage.setItem(storageKey, JSON.stringify(metaRef.current)) }catch{}
          }
          
          // Only add message if it's not already in the list (prevent duplicates)
          setMessages(prev => {
            const exists = prev.some(m => m.text === messageText && m.sent && Math.abs(new Date(m.time).getTime() - new Date(now).getTime()) < 5000)
            if (exists) return prev
            return [...prev, { id: Math.random(), text: messageText, sent:true, time: now, replySnippet }]
          })
          
          setReplyTo(null)
          // stop typing state
          fetch('/api/typing', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ peer: username, is_typing: false }) }).catch(()=>{})
        }
      }).catch(()=>{})
      .finally(() => setSending(false))
  }

  return (
    <div 
      className="bg-black text-white"
      style={{
        height: '100vh',
        maxHeight: '100vh',
        display: 'grid',
        gridTemplateRows: '3.5rem 3.5rem 1fr 4rem',
        gridTemplateAreas: '"main-header" "chat-header" "messages" "composer"',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10
      }}
    >
      {/* Spacer for main header */}
      <div style={{ gridArea: 'main-header' }} />
      
      {/* Chat header - always visible */}
      <div 
        className="border-b border-white/10 flex items-center gap-3 px-4 bg-black"
        style={{
          gridArea: 'chat-header',
          backgroundColor: 'rgb(0, 0, 0)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          zIndex: 1000
        }}
      >
        <div className="max-w-3xl mx-auto w-full flex items-center gap-3">
          <button 
            className="p-2 rounded-full hover:bg-white/10 transition-colors" 
            onClick={()=> navigate('/user_chat')} 
            aria-label="Back to Messages"
          >
            <i className="fa-solid fa-arrow-left text-white" />
          </button>
          <Avatar 
            username={username || ''} 
            url={otherProfile?.profile_picture || undefined} 
            size={36} 
          />
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate text-white">
              {otherProfile?.display_name || username}
            </div>
            <div className="text-xs text-white/60">
              {typing ? 'typing...' : 'Online'}
            </div>
          </div>
          <button 
            className="p-2 rounded-full hover:bg-white/10 transition-colors" 
            aria-label="More options"
          >
            <i className="fa-solid fa-ellipsis-vertical text-white/70" />
          </button>
        </div>
      </div>
      
      {/* Messages list */}
      <div
        ref={listRef}
        className="overflow-y-auto overscroll-contain px-3 py-2 space-y-1"
        style={{ 
          gridArea: 'messages',
          WebkitOverflowScrolling: 'touch' as any, 
          overscrollBehavior: 'contain' as any,
          maxHeight: '100%',
          paddingBottom: '0.5rem'
        }}
        onScroll={(e)=> {
          const el = e.currentTarget
          const near = (el.scrollHeight - el.scrollTop - el.clientHeight) < 120
          if (near) setShowScrollDown(false)
        }}
      >
        {messages.map(m => (
          <LongPressActionable key={m.id} onDelete={() => {
            const fd = new URLSearchParams({ message_id: String(m.id) })
            fetch('/delete_message', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
              .then(r=>r.json()).then(j=>{ if (j?.success){ setMessages(prev => prev.filter(x => x.id !== m.id)) } }).catch(()=>{})
          }} onReact={(emoji)=> {
            setMessages(msgs => msgs.map(x => x.id===m.id ? { ...x, reaction: emoji } : x))
            const k = `${m.time}|${m.text}|${m.sent ? 'me' : 'other'}`
            metaRef.current[k] = { ...(metaRef.current[k]||{}), reaction: emoji }
            try{ localStorage.setItem(storageKey, JSON.stringify(metaRef.current)) }catch{}
          }} onReply={() => {
            setReplyTo({ text: m.text })
            textareaRef.current?.focus()
          }} onCopy={() => {
            try{ navigator.clipboard && navigator.clipboard.writeText(m.text) }catch{}
          }}>
            <div className={`flex ${m.sent ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[70%] md:max-w-[70%] px-3 py-2 rounded-2xl text-[14px] leading-snug whitespace-pre-wrap break-words shadow-sm border ${m.sent ? 'bg-[#075E54] text-white border-[#075E54]' : 'bg-[#1a1a1a] text-white border-white/10'} ${m.sent ? 'rounded-br-md' : 'rounded-bl-md'}`}
                style={{ position: 'relative', ...(m.reaction ? { paddingRight: '1.75rem', paddingBottom: '1.25rem' } : {}) } as any}
              >
                {m.replySnippet ? (
                  <div className="mb-1 px-2 py-1 rounded bg-white/10 text-[12px] text-[#cfe9e7] border border-white/10">
                    {m.replySnippet}
                  </div>
                ) : null}
                <div>{m.text}</div>
                <div className={`text-[10px] mt-1 ${m.sent ? 'text-white/70' : 'text-white/50'} text-right`}>{new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                {m.reaction ? (
                  <span className="absolute bottom-0.5 right-1 text-base leading-none select-none z-10">
                    {m.reaction}
                  </span>
                ) : null}
              </div>
            </div>
          </LongPressActionable>
        ))}
        
        {showScrollDown && (
          <button
            className="fixed bottom-24 right-4 z-50 w-10 h-10 rounded-full bg-[#4db6ac] text-black shadow-lg border border-[#4db6ac] hover:brightness-110 flex items-center justify-center"
            onClick={() => { scrollToBottom(); setShowScrollDown(false) }}
            aria-label="Scroll to latest"
          >
            <i className="fa-solid fa-arrow-down" />
          </button>
        )}
      </div>

      {/* Composer (WhatsApp-style) */}
      <div 
        className="bg-black px-3 py-2 border-t border-white/10"
        style={{
          gridArea: 'composer',
          backgroundColor: 'rgb(0, 0, 0)',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          zIndex: 1000
        }}
      >
        {/* Reply preview */}
        {replyTo && (
          <div className="mb-2 px-3 py-2 bg-black/80 text-[12px] text-[#cfe9e7] rounded-lg border border-white/10">
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-6 bg-[#4db6ac] rounded" />
              <div className="flex-1 truncate">{replyTo.text.length > 90 ? replyTo.text.slice(0, 90) + '…' : replyTo.text}</div>
              <button className="ml-2 text-[#9fb0b5] text-xs" onClick={()=> setReplyTo(null)}>✕</button>
            </div>
          </div>
        )}

        <div className="max-w-3xl mx-auto flex items-end gap-2">
          {/* Attachment button (left side) */}
          <button className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">
            <i className="fa-solid fa-plus text-white/70 text-lg" />
          </button>
          
          {/* Message input container */}
          <div className="flex-1 flex items-end bg-[#1a1a1a] rounded-3xl border border-white/20 overflow-hidden">
            <textarea
              ref={textareaRef}
              rows={1}
              className="flex-1 bg-transparent px-4 py-3 text-[16px] text-white placeholder-white/50 outline-none resize-none max-h-32 min-h-[44px]"
              placeholder="Message"
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
              style={{
                lineHeight: '1.4',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none'
              }}
            />
            
            {/* Send button (inside input container, right side) */}
            {draft.trim() && (
              <button
                className={`w-10 h-10 m-1 rounded-full flex items-center justify-center transition-all ${
                  sending 
                    ? 'bg-gray-600 text-gray-300 cursor-not-allowed' 
                    : 'bg-[#4db6ac] text-black hover:bg-[#45a99c] active:scale-95'
                }`}
                onClick={send}
                disabled={sending}
                aria-label="Send"
              >
                {sending ? (
                  <i className="fa-solid fa-spinner fa-spin text-sm" />
                ) : (
                  <i className="fa-solid fa-paper-plane text-sm" />
                )}
              </button>
            )}
          </div>
          
          {/* Voice message button (when no text) */}
          {!draft.trim() && (
            <button className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-full bg-[#4db6ac] text-black hover:bg-[#45a99c] active:scale-95 transition-all">
              <i className="fa-solid fa-microphone text-lg" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function LongPressActionable({ children, onDelete, onReact, onReply, onCopy }: { children: React.ReactNode; onDelete: () => void; onReact: (emoji:string)=>void; onReply: ()=>void; onCopy: ()=>void }){
  const [showMenu, setShowMenu] = useState(false)
  const timerRef = useRef<any>(null)
  function handleStart(e?: any){
    try{ e && e.preventDefault && e.preventDefault() }catch{}
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setShowMenu(true), 1000)
  }
  function handleEnd(){
    if (timerRef.current) clearTimeout(timerRef.current)
  }
  return (
    <div className="relative select-none" style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' as any }}>
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
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className="absolute z-50 -top-12 right-2 bg-[#111] border border-white/15 rounded-lg shadow-xl px-2 py-2 min-w-[160px]">
            <div className="flex items-center gap-2 px-2 pb-2 border-b border-white/10">
              {["👍","❤️","😂","🔥","👏"].map(e => (
                <button key={e} className="text-lg" onClick={()=> { setShowMenu(false); onReact(e) }}>{e}</button>
              ))}
            </div>
            <div className="pt-2 flex flex-col">
              <button className="text-left px-2 py-1 text-sm hover:bg-white/5" onClick={()=> { setShowMenu(false); onReply() }}>Reply</button>
              <button className="text-left px-2 py-1 text-sm hover:bg-white/5" onClick={()=> { setShowMenu(false); onCopy() }}>Copy</button>
              <button className="text-left px-2 py-1 text-sm text-red-400 hover:bg-white/5" onClick={()=> { setShowMenu(false); onDelete() }}>Delete</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}