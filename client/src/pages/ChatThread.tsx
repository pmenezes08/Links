import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'
import MessageImage from '../components/MessageImage'

export default function ChatThread(){
  const { setTitle } = useHeader()
  const { username } = useParams()
  const navigate = useNavigate()
  useEffect(() => { setTitle(username ? `Chat: ${username}` : 'Chat') }, [setTitle, username])

  const [otherUserId, setOtherUserId] = useState<number|''>('')
  const [messages, setMessages] = useState<Array<{ id:number; text:string; image_path?:string; sent:boolean; time:string; reaction?:string; replySnippet?:string }>>([])
  const [optimisticMessages, setOptimisticMessages] = useState<Array<{ id:string; text:string; sent:boolean; time:string; replySnippet?:string }>>([])



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
  const [currentDateLabel, setCurrentDateLabel] = useState<string>('')
  const [showDateFloat, setShowDateFloat] = useState(false)
  const dateFloatTimer = useRef<any>(null)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const fileInputRef = useRef<HTMLInputElement|null>(null)
  const cameraInputRef = useRef<HTMLInputElement|null>(null)
  const [previewImage, setPreviewImage] = useState<string|null>(null)


  // Date formatting functions
  function formatDateLabel(dateStr: string): string {
    const messageDate = new Date(dateStr)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    
    const msgDateOnly = new Date(messageDate.getFullYear(), messageDate.getMonth(), messageDate.getDate())
    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const yesterdayOnly = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate())
    
    if (msgDateOnly.getTime() === todayOnly.getTime()) {
      return 'Today'
    } else if (msgDateOnly.getTime() === yesterdayOnly.getTime()) {
      return 'Yesterday'
    } else {
      const daysDiff = Math.floor((todayOnly.getTime() - msgDateOnly.getTime()) / (1000 * 60 * 60 * 24))
      if (daysDiff <= 6) {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        return days[messageDate.getDay()]
      } else {
        return messageDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      }
    }
  }

  function getDateKey(dateStr: string): string {
    return new Date(dateStr).toDateString()
  }

  useEffect(() => {
    if (!username) return
    fetch('/api/get_user_id_by_username', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username }) })
      .then(r=>r.json()).then(j=>{
        if (j?.success && j.user_id){
          setOtherUserId(j.user_id)
          const fd = new URLSearchParams({ other_user_id: String(j.user_id) })
          fetch('/get_messages', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
            .then(r=>r.json()).then(j=>{
              if (j?.success && Array.isArray(j.messages)) {
                const serverMsgs = j.messages.map((m:any) => {
                  const k = `${m.time}|${m.text}|${m.sent ? 'me' : 'other'}`
                  const meta = metaRef.current[k] || {}
                  return { ...m, reaction: meta.reaction, replySnippet: meta.replySnippet }
                })
                setMessages(serverMsgs)
              }
            }).catch(()=>{})
          fetch(`/api/get_user_profile_brief?username=${encodeURIComponent(username)}`, { credentials:'include' })
            .then(r=>r.json()).then(j=>{
              if (j?.success){ setOtherProfile({ display_name: j.display_name, profile_picture: j.profile_picture||null }) }
            }).catch(()=>{})
        }
      }).catch(()=>{})
  }, [username])

  // Auto-scroll logic
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

  useEffect(() => {
    try{ const raw = localStorage.getItem(storageKey); if (raw) metaRef.current = JSON.parse(raw) || {} }catch{}
  }, [storageKey])

  useEffect(() => {
    if (!username || !otherUserId) return
    async function poll(){
      try{
        const fd = new URLSearchParams({ other_user_id: String(otherUserId) })
        const r = await fetch('/get_messages', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
        const j = await r.json()
        if (j?.success && Array.isArray(j.messages)){
          const serverMessages = j.messages.map((m:any) => {
            const k = `${m.time}|${m.text}|${m.sent ? 'me' : 'other'}`
            const meta = metaRef.current[k] || {}
            return { ...m, reaction: meta.reaction, replySnippet: meta.replySnippet }
          })


          // Update server messages only if different
          setMessages(prevMessages => {
            // Only update if messages actually changed
            if (prevMessages.length !== serverMessages.length || 
                JSON.stringify(prevMessages) !== JSON.stringify(serverMessages)) {
              return serverMessages
            }
            return prevMessages
          })

          // Remove optimistic messages that are now in server response
          setOptimisticMessages(prevOptimistic => {
            const stillOptimistic = prevOptimistic.filter(opt => {
              const isConfirmed = serverMessages.some(server =>
                server.text.trim() === opt.text.trim() &&
                server.sent === opt.sent &&
                Math.abs(new Date(server.time).getTime() - new Date(opt.time).getTime()) < 10000 // Increased to 10 seconds
              )
              return !isConfirmed
            })
            return stillOptimistic
          })
        }
      }catch(err){
        // Silent error handling
      }
      try{
        const t = await fetch(`/api/typing?peer=${encodeURIComponent(username!)}`, { credentials:'include' })
        const tj = await t.json().catch(()=>null)
        setTyping(!!tj?.is_typing)
      }catch{}
    }
    poll()
    pollTimer.current = setInterval(poll, 2000) // Reduced from 5000ms to 2000ms for faster updates
    return () => { if (pollTimer.current) clearInterval(pollTimer.current) }
  }, [username, otherUserId])

  // Cleanup stale optimistic messages (older than 30 seconds)
  useEffect(() => {
    const cleanupTimer = setInterval(() => {
      const now = Date.now()
      setOptimisticMessages(prev => {
        const valid = prev.filter(opt => {
          const age = now - new Date(opt.time).getTime()
          return age < 30000 // Remove messages older than 30 seconds
        })
        return valid.length !== prev.length ? valid : prev
      })
    }, 10000) // Check every 10 seconds

    return () => clearInterval(cleanupTimer)
  }, [])

  function adjustTextareaHeight(){
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const maxPx = 160
    ta.style.height = Math.min(ta.scrollHeight, maxPx) + 'px'
  }
  useEffect(() => { adjustTextareaHeight() }, [])
  useEffect(() => { adjustTextareaHeight() }, [draft])

  function send(){
    if (!otherUserId || !draft.trim() || sending) {
      return
    }
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

          // Add to optimistic messages (separate from server messages)
          const optimisticId = `opt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
          const optimisticMessage = { id: optimisticId, text: messageText, sent: true, time: now, replySnippet }

          setOptimisticMessages(prev => [...prev, optimisticMessage])

          // Don't touch the main messages state - let polling handle server updates

          setReplyTo(null)
          fetch('/api/typing', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ peer: username, is_typing: false }) }).catch(()=>{})
        }
      }).catch(()=>{})
      .finally(() => setSending(false))
  }

  function handlePhotoSelect() {
    setShowAttachMenu(false)
    fileInputRef.current?.click()
  }

  function handleCameraOpen() {
    setShowAttachMenu(false)
    cameraInputRef.current?.click()
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !otherUserId) return
    
    setSending(true)
    
    // Create FormData for photo upload
    const formData = new FormData()
    formData.append('photo', file)
    formData.append('recipient_id', String(otherUserId))
    formData.append('message', '') // Optional text with photo
    
    fetch('/send_photo_message', { 
      method: 'POST', 
      credentials: 'include', 
      body: formData 
    })
    .then(r => r.json())
    .then(j => {
      if (j?.success) {
        const now = new Date().toISOString().slice(0,19).replace('T',' ')
        
        // Add photo message to UI
        setMessages(prev => {
          const photoMessage = {
            id: Math.random(),
            text: '📷 Photo',
            image_path: j.image_path,
            sent: true,
            time: now
          }
          return [...prev, photoMessage]
        })
        
        // Stop typing state
        fetch('/api/typing', { 
          method:'POST', 
          credentials:'include', 
          headers:{ 'Content-Type':'application/json' }, 
          body: JSON.stringify({ peer: username, is_typing: false }) 
        }).catch(()=>{})
      } else {
        alert('Failed to send photo: ' + (j.error || 'Unknown error'))
      }
    })
    .catch(() => {
      alert('Error sending photo. Please try again.')
    })
    .finally(() => setSending(false))
    
    // Reset input
    event.target.value = ''
  }

  return (
    <div 
      className="bg-black text-white flex flex-col" 
      style={{ 
        height: '100vh',
        minHeight: '100vh',
        maxHeight: '100vh',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        paddingTop: '3.5rem'
      }}
    >
      {/* Chat header */}
      <div 
        className="h-14 border-b border-white/10 flex items-center gap-3 px-4 flex-shrink-0"
        style={{
          backgroundColor: 'rgb(0, 0, 0)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          zIndex: 9999,
          position: 'sticky',
          top: 0,
          minHeight: '3.5rem',
          maxHeight: '3.5rem'
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
            <div className="font-semibold truncate text-white text-lg">
              {otherProfile?.display_name || username || 'Chat'}
            </div>
            <div className="text-sm text-[#4db6ac] font-medium">
              {typing ? 'typing...' : 'Online'}
            </div>
          </div>
        </div>
      </div>
      
      {/* Floating date indicator */}
      {currentDateLabel && showDateFloat && (
        <div 
          className="fixed left-1/2 z-50 pointer-events-none"
          style={{ 
            top: '7rem',
            transform: `translateX(-50%) translateY(${showDateFloat ? '0' : '-10px'})`,
            opacity: showDateFloat ? 1 : 0,
            transition: 'all 0.3s ease-in-out'
          }}
        >
          <div className="bg-black/90 backdrop-blur-md px-4 py-2 rounded-full border border-white/20 text-sm text-white shadow-lg">
            {currentDateLabel}
          </div>
        </div>
      )}
      
      {/* Messages list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto overscroll-contain px-3 py-2 space-y-1"
        style={{ 
          WebkitOverflowScrolling: 'touch' as any, 
          overscrollBehavior: 'contain' as any,
          paddingBottom: '1rem'
        }}
        onScroll={(e)=> {
          const el = e.currentTarget
          const near = (el.scrollHeight - el.scrollTop - el.clientHeight) < 120
          if (near) setShowScrollDown(false)
          
          setShowDateFloat(true)
          
          const messageElements = el.querySelectorAll('[data-message-date]')
          let visibleDate = ''
          
          for (let i = 0; i < messageElements.length; i++) {
            const msgEl = messageElements[i] as HTMLElement
            const rect = msgEl.getBoundingClientRect()
            const headerHeight = 112
            
            if (rect.top >= headerHeight && rect.top <= headerHeight + 100) {
              visibleDate = msgEl.getAttribute('data-message-date') || ''
              break
            }
          }
          
          if (visibleDate) {
            setCurrentDateLabel(formatDateLabel(visibleDate))
          }
          
          if (dateFloatTimer.current) clearTimeout(dateFloatTimer.current)
          dateFloatTimer.current = setTimeout(() => {
            setShowDateFloat(false)
          }, 1500)
        }}
      >
        {/* Combine server messages and optimistic messages, sorted by time */}
        {[...messages, ...optimisticMessages.map(m => ({ ...m, id: Math.random() * 1000000 }))].sort((a, b) =>
          new Date(a.time).getTime() - new Date(b.time).getTime()
        ).map((m, index, allMessages) => {
          const messageDate = getDateKey(m.time)
          const prevMessageDate = index > 0 ? getDateKey(allMessages[index - 1].time) : null
          const showDateSeparator = messageDate !== prevMessageDate
          
          return (
            <div key={m.id}>
              {showDateSeparator && (
                <div className="flex justify-center my-4">
                  <div className="bg-black/60 backdrop-blur-sm px-3 py-1 rounded-lg text-xs text-white/70 border border-white/10">
                    {formatDateLabel(m.time)}
                  </div>
                </div>
              )}
              
              <div data-message-date={m.time}>
                <LongPressActionable onDelete={() => {
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
                      
                      {/* Image display with loader */}
                      {m.image_path ? (
                        <div className="mb-2">
                          <MessageImage
                            src={`/uploads/${m.image_path}`}
                            alt="Shared photo"
                            className="max-w-full max-h-64 cursor-pointer"
                            onClick={() => {
                              setPreviewImage(`/uploads/${m.image_path}`)
                            }}
                          />
                        </div>
                      ) : null}
                      
                      {/* Text content */}
                      {m.text && <div>{m.text}</div>}
                      <div className={`text-[10px] mt-1 ${m.sent ? 'text-white/70' : 'text-white/50'} text-right`}>{new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      {m.reaction ? (
                        <span className="absolute bottom-0.5 right-1 text-base leading-none select-none z-10">
                          {m.reaction}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </LongPressActionable>
              </div>
            </div>
          )
        })}
        
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

      {/* Composer */}
      <div className="bg-black px-3 py-2 border-t border-white/10 flex-shrink-0 mb-4">
        {replyTo && (
          <div className="mb-2 px-3 py-2 bg-black/80 text-[12px] text-[#cfe9e7] rounded-lg border border-white/10">
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-6 bg-[#4db6ac] rounded" />
              <div className="flex-1 truncate">{replyTo.text.length > 90 ? replyTo.text.slice(0, 90) + '…' : replyTo.text}</div>
              <button className="ml-2 text-[#9fb0b5] text-xs" onClick={()=> setReplyTo(null)}>✕</button>
            </div>
          </div>
        )}

        <div className="flex items-end gap-2 relative">
          {/* Attachment button */}
          <button 
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
            onClick={() => setShowAttachMenu(!showAttachMenu)}
          >
            <i className={`fa-solid text-white/70 text-base transition-transform duration-200 ${
              showAttachMenu ? 'fa-times rotate-90' : 'fa-plus'
            }`} />
          </button>

          {/* Attachment menu */}
          {showAttachMenu && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setShowAttachMenu(false)} 
              />
              <div className="absolute bottom-10 left-0 z-50 bg-[#1a1a1a] border border-white/20 rounded-2xl shadow-xl overflow-hidden">
                <button
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors text-left"
                  onClick={handlePhotoSelect}
                >
                  <div className="w-10 h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center">
                    <i className="fa-solid fa-image text-[#4db6ac]" />
                  </div>
                  <div>
                    <div className="text-white font-medium">Photos</div>
                    <div className="text-white/60 text-xs">Send from gallery</div>
                  </div>
                </button>
                <button
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors text-left"
                  onClick={handleCameraOpen}
                >
                  <div className="w-10 h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center">
                    <i className="fa-solid fa-camera text-[#4db6ac]" />
                  </div>
                  <div>
                    <div className="text-white font-medium">Camera</div>
                    <div className="text-white/60 text-xs">Take a photo</div>
                  </div>
                </button>
              </div>
            </>
          )}

          {/* Hidden file inputs */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className="hidden"
          />
          
          {/* Message input container */}
          <div className="flex-1 flex items-center bg-[#1a1a1a] rounded-3xl border border-white/20 overflow-hidden relative">
            <textarea
              ref={textareaRef}
              rows={1}
              className="flex-1 bg-transparent px-4 py-2.5 text-[16px] text-white placeholder-white/50 outline-none resize-none max-h-24 min-h-[36px]"
              placeholder="Message"
              value={draft}
              onChange={e=> {
                setDraft(e.target.value)
                fetch('/api/typing', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ peer: username, is_typing: true }) }).catch(()=>{})
                if (typingTimer.current) clearTimeout(typingTimer.current)
                typingTimer.current = setTimeout(() => {
                  fetch('/api/typing', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ peer: username, is_typing: false }) }).catch(()=>{})
                }, 1200)
              }}
              onKeyDown={e=> {
                if (e.key === 'Enter' && !e.shiftKey && draft.trim()) {
                  e.preventDefault()
                  console.log('Enter key pressed, calling send()')
                  send()
                }
              }}
              onFocus={() => {
                setTimeout(() => {
                  const header = document.querySelector('.h-14.border-b') as HTMLElement
                  if (header) {
                    header.style.position = 'fixed'
                    header.style.top = '3.5rem'
                    header.style.left = '0'
                    header.style.right = '0'
                    header.style.zIndex = '10000'
                    header.style.backgroundColor = 'rgb(0, 0, 0)'
                  }
                }, 100)
              }}
              onBlur={() => {
                setTimeout(() => {
                  const header = document.querySelector('.h-14.border-b') as HTMLElement
                  if (header) {
                    header.style.position = 'sticky'
                    header.style.top = '0'
                    header.style.left = ''
                    header.style.right = ''
                  }
                }, 100)
              }}
              style={{
                lineHeight: '1.4',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none'
              }}
            />
            
            {/* Send button - always visible */}
            <div className="absolute right-1 top-1/2 transform -translate-y-1/2 w-8 h-8 flex items-center justify-center">
              <button
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 ease-out ${
                  sending 
                    ? 'bg-gray-600 text-gray-300 cursor-not-allowed' 
                    : draft.trim()
                      ? 'bg-[#4db6ac] text-black hover:bg-[#45a99c] hover:scale-105 active:scale-95'
                      : 'bg-white/20 text-white/70 cursor-not-allowed'
                }`}
                onClick={() => {
                  console.log('Send button clicked')
                  console.log('draft.trim():', draft.trim())
                  if (draft.trim()) {
                    console.log('Calling send() from button click')
                    send()
                  } else {
                    console.log('Send blocked - draft is empty')
                  }
                }}
                disabled={sending || !draft.trim()}
                aria-label="Send"
                style={{
                  transform: 'scale(1)',
                  transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)'
                }}
              >
                {sending ? (
                  <i className="fa-solid fa-spinner fa-spin text-xs" />
                ) : (
                  <i className="fa-solid fa-paper-plane text-xs" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>


      {/* Photo preview modal */}
      {previewImage && (
        <div 
          className="fixed inset-0 bg-black z-[9999] flex flex-col"
          onClick={() => setPreviewImage(null)}
        >
          {/* Header with back button */}
          <div className="h-14 flex items-center px-4 flex-shrink-0">
            <button 
              className="p-2 rounded-full hover:bg-white/10 transition-colors"
              onClick={() => setPreviewImage(null)}
              aria-label="Back to chat"
            >
              <i className="fa-solid fa-arrow-left text-white text-lg" />
            </button>
            <div className="flex-1 text-center">
              <div className="text-white font-medium">Photo</div>
            </div>
            <div className="w-10"></div> {/* Spacer for centering */}
          </div>

          {/* Image container */}
          <div 
            className="flex-1 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <ImageLoader
              src={previewImage}
              alt="Photo preview"
              className="max-w-full max-h-full object-contain"
              style={{ maxHeight: 'calc(100vh - 8rem)' }}
            />
          </div>

          {/* Bottom back button */}
          <div className="h-16 flex items-center justify-center px-4 flex-shrink-0">
            <button 
              className="px-4 py-2 border border-white/30 text-white rounded-lg hover:border-white/50 hover:bg-white/5 transition-colors text-sm flex items-center gap-2"
              onClick={() => setPreviewImage(null)}
            >
              <i className="fa-solid fa-arrow-left text-sm" />
              Back to Chat
            </button>
          </div>
        </div>
      )}
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