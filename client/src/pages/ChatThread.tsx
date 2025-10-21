import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'
import MessageImage from '../components/MessageImage'

interface Message {
  id: number | string
  text: string
  image_path?: string
  audio_path?: string
  audio_duration_seconds?: number
  sent: boolean
  time: string
  reaction?: string
  replySnippet?: string
  isOptimistic?: boolean // Track if this is an optimistic update
  edited_at?: string | null
}

export default function ChatThread(){
  const { setTitle } = useHeader()
  const { username } = useParams()
  const navigate = useNavigate()
  useEffect(() => { setTitle(username ? `Chat: ${username}` : 'Chat') }, [setTitle, username])

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                            (navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && /MacIntel/.test(navigator.platform))
      setIsMobile(Boolean(isMobileDevice))
      console.log('📱 Mobile device detected:', isMobileDevice)
    }
    checkMobile()
  }, [])

  // Add wave animation styles
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `
      @keyframes wave {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
      }
    `
    document.head.appendChild(style)
    return () => {
      document.head.removeChild(style)
    }
  }, [])

  const [otherUserId, setOtherUserId] = useState<number|''>('')
  const [messages, setMessages] = useState<Message[]>([])
  const [editingId, setEditingId] = useState<number|string| null>(null)
  const [editText, setEditText] = useState('')
  const [editingSaving, setEditingSaving] = useState(false)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<{ text:string; sender?:string }|null>(null)
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement|null>(null)
  const textareaRef = useRef<HTMLTextAreaElement|null>(null)
  const storageKey = useMemo(() => `chat_meta_${username || ''}`, [username])
  const metaRef = useRef<Record<string, { reaction?: string; replySnippet?: string }>>({})
  const [otherProfile, setOtherProfile] = useState<{ display_name:string; profile_picture?:string|null }|null>(null)
  const [, setTyping] = useState(false) // keep setter for API calls; UI label removed
  const typingTimer = useRef<any>(null)
  const pollTimer = useRef<any>(null)
  const [currentDateLabel, setCurrentDateLabel] = useState<string>('')
  const [showDateFloat, setShowDateFloat] = useState(false)
  const dateFloatTimer = useRef<any>(null)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const fileInputRef = useRef<HTMLInputElement|null>(null)
  const cameraInputRef = useRef<HTMLInputElement|null>(null)
  const audioInputRef = useRef<HTMLInputElement|null>(null)
  const [recording, setRecording] = useState(false)
  const [recorder, setRecorder] = useState<MediaRecorder|null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const recordStartRef = useRef<number>(0)
  const [recordMs, setRecordMs] = useState(0)
  const recordTimerRef = useRef<any>(null)
  const audioCtxRef = useRef<AudioContext|null>(null)
  const analyserRef = useRef<AnalyserNode|null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode|null>(null)
  const visRafRef = useRef<number| null>(null)
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(25).fill(0))
  const stoppedRef = useRef(false)
  const finalizedRef = useRef(false)
  const finalizeTimerRef = useRef<any>(null)
  // const twoSecondCheckRef = useRef<any>(null)
  const finalizeAttemptRef = useRef(0)
  const [recordLockActive, setRecordLockActive] = useState(false)
  const [showLockHint, setShowLockHint] = useState(false)
  const touchStartYRef = useRef<number|null>(null)
  const lockActiveRef = useRef(false)
  const suppressClickRef = useRef(false)
  const [previewImage, setPreviewImage] = useState<string|null>(null)
  const [recordingPreview, setRecordingPreview] = useState<{ blob: Blob; url: string; duration: number } | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [showMicPermissionModal, setShowMicPermissionModal] = useState(false)
  const [showPermissionGuide, setShowPermissionGuide] = useState(false)
  const lastFetchTime = useRef<number>(0)
  const pendingDeletions = useRef<Set<number|string>>(new Set())

  // Mic gating by build flag: enable by default in dev; disabled in prod unless VITE_MIC_ENABLED=true
  const envVars: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  const micFlag = envVars.VITE_MIC_ENABLED
  const MIC_ENABLED = typeof micFlag !== 'undefined' 
    ? (micFlag === 'true' || micFlag === true)
    : Boolean(envVars.DEV)

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

  function parseMessageTime(s: string | undefined): Date | null {
    if (!s) return null
    try {
      // Normalize "YYYY-MM-DD HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SS"
      const norm = s.includes('T') ? s : s.replace(' ', 'T')
      const d = new Date(norm)
      return isNaN(d.getTime()) ? null : d
    } catch { return null }
  }

  async function commitEdit(){
    if (!editingId) return
    const newBody = editText.trim()
    if (!newBody) { alert('Message cannot be empty'); return }
    const prev = messages
    setEditingSaving(true)
    setMessages(list => list.map(m => m.id===editingId ? ({ ...m, text: newBody, edited_at: new Date().toISOString() }) : m))
    try{
      const res = await fetch('/api/chat/edit_message', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ message_id: editingId, text: newBody }) })
      const j = await res.json().catch(()=>null)
      if (!j?.success){
        alert(j?.error || 'Edit failed')
        setMessages(prev)
      } else {
        setEditingId(null); setEditText('')
      }
    }catch{
      alert('Network error while editing')
      setMessages(prev)
    } finally { setEditingSaving(false) }
  }

  // Convert URLs in plain text into clickable links
  function linkifyText(text: string) {
    const nodes: any[] = []
    const regex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/[^\s]*)?)/gi
    let lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const start = match.index
      const end = start + match[0].length
      if (start > lastIndex) nodes.push(text.slice(lastIndex, start))
      const raw = match[0]
      const href = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
      nodes.push(
        <a key={`${start}-${end}`} href={href} target="_blank" rel="noopener noreferrer" className="underline text-[#4db6ac] hover:text-[#45a99c]">
          {raw}
        </a>
      )
      lastIndex = end
    }
    if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
    return nodes
  }

  // Initial load of messages and other user info
  useEffect(() => {
    if (!username) return
    
    // Get other user ID
    fetch('/api/get_user_id_by_username', { 
      method:'POST', 
      credentials:'include', 
      headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, 
      body: new URLSearchParams({ username }) 
    })
    .then(r=>r.json())
    .then(j=>{
      if (j?.success && j.user_id){
        setOtherUserId(j.user_id)
        
        // Load initial messages
        const fd = new URLSearchParams({ other_user_id: String(j.user_id) })
        fetch('/get_messages', { 
          method:'POST', 
          credentials:'include', 
          headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, 
          body: fd 
        })
        .then(r=>r.json())
        .then(j=>{
          if (j?.success && Array.isArray(j.messages)) {
            const processedMessages = j.messages.map((m:any) => {
              // Parse reply information from message text
              let messageText = m.text
              let replySnippet = undefined
              const replyMatch = messageText.match(/^\[REPLY:([^:]+):([^\]]+)\]\n(.*)$/s)
              if (replyMatch) {
                // Extract reply info and actual message
                // const replySender = replyMatch[1] // Can use this later if needed
                replySnippet = replyMatch[2]
                messageText = replyMatch[3]
              }
              
              const k = `${m.time}|${messageText}|${m.sent ? 'me' : 'other'}`
              const meta = metaRef.current[k] || {}
              return { 
                ...m,
                text: messageText,
                reaction: meta.reaction, 
                replySnippet: replySnippet || meta.replySnippet,
                isOptimistic: false,
                edited_at: m.edited_at || null
              }
            })
            setMessages(processedMessages)
            lastFetchTime.current = Date.now()
          }
        }).catch(()=>{})
        
        // Load user profile
        fetch(`/api/get_user_profile_brief?username=${encodeURIComponent(username)}`, { credentials:'include' })
          .then(r=>r.json())
          .then(j=>{
            if (j?.success){ 
              setOtherProfile({ 
                display_name: j.display_name, 
                profile_picture: j.profile_picture||null 
              }) 
            }
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
    requestAnimationFrame(() => requestAnimationFrame(() => { 
      el.scrollTop = el.scrollHeight 
    }))
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

  // Load metadata from localStorage
  useEffect(() => {
    try{ 
      const raw = localStorage.getItem(storageKey)
      if (raw) metaRef.current = JSON.parse(raw) || {} 
    }catch{}
  }, [storageKey])

  // Polling for new messages and typing status
  useEffect(() => {
    if (!username || !otherUserId) return
    
    async function poll(){
      try{
        const fd = new URLSearchParams({ other_user_id: String(otherUserId) })
        const r = await fetch('/get_messages', { 
          method:'POST', 
          credentials:'include', 
          headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, 
          body: fd 
        })
        const j = await r.json()
        
        if (j?.success && Array.isArray(j.messages)){
          setMessages(prev => {
            // Create a map of all existing messages by ID for quick lookup
            const existingById = new Map()
            prev.forEach(m => {
              if (!m.isOptimistic && m.id) {
                existingById.set(m.id, m)
              }
            })
            
            // Keep optimistic messages separate
            const optimisticMessages = prev.filter(m => m.isOptimistic === true)
            
            // Process server messages, preserving local state
            const serverMessages = j.messages.map((m:any) => {
              // Skip if pending deletion
              if (pendingDeletions.current.has(m.id)) {
                return null
              }
              
              const existing = existingById.get(m.id)
              
              // Parse reply information from message text
              let messageText = m.text
              let replySnippet = undefined
              const replyMatch = messageText.match(/^\[REPLY:([^:]+):([^\]]+)\]\n(.*)$/s)
              if (replyMatch) {
                // Extract reply info and actual message
                // const replySender = replyMatch[1] // Can use this later if needed
                replySnippet = replyMatch[2]
                messageText = replyMatch[3]
              }
              
              const k = `${m.time}|${messageText}|${m.sent ? 'me' : 'other'}`
              const meta = metaRef.current[k] || {}
              
              return {
                ...m,
                text: messageText,
                reaction: existing?.reaction ?? meta.reaction,
                replySnippet: replySnippet || existing?.replySnippet || meta.replySnippet,
                isOptimistic: false
              }
            }).filter(Boolean)
            
            // Keep optimistic messages that don't have a server match yet
            // Be more lenient with matching to avoid duplicates
            const remainingOptimistic = optimisticMessages.filter(opt => {
              const serverMatch = serverMessages.some((srv:any) => {
                // Match by text and sender, with a reasonable time window
                if (srv.sent === opt.sent && srv.text === opt.text) {
                  const timeDiff = Math.abs(new Date(srv.time).getTime() - new Date(opt.time).getTime())
                  return timeDiff < 60000 // Within 60 seconds
                }
                return false
              })
              
              // Also remove old optimistic messages (older than 2 minutes)
              const optAge = Date.now() - new Date(opt.time).getTime()
              if (optAge > 120000) {
                return false // Remove stale optimistic messages
              }
              
              return !serverMatch
            })
            
            // Combine and sort
            const allMessages = [...serverMessages, ...remainingOptimistic]
            return allMessages.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
          })
        }
      }catch(e){
        console.error('Polling error:', e)
      }
      
      // Check typing status
      try{
        const t = await fetch(`/api/typing?peer=${encodeURIComponent(username!)}`, { credentials:'include' })
        const tj = await t.json().catch(()=>null)
        setTyping(!!tj?.is_typing)
      }catch{}

      // Presence: tell server I'm actively viewing this chat (used to suppress pushes)
      try{
        await fetch('/api/active_chat', {
          method:'POST',
          credentials:'include',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ peer: username })
        })
      }catch{}
    }
    
    // Initial poll after a short delay to let optimistic messages show
    setTimeout(poll, 250)
    
    // Poll more frequently for snappier delivery
    pollTimer.current = setInterval(poll, 1200)
    
    return () => { 
      if (pollTimer.current) clearInterval(pollTimer.current) 
    }
  }, [username, otherUserId])

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
    if (!otherUserId || !draft.trim() || sending) return
    
    const messageText = draft.trim()
    const now = new Date().toISOString().slice(0,19).replace('T',' ')
    const tempId = `temp_${Date.now()}_${Math.random()}`
    const replySnippet = replyTo ? (replyTo.text.length > 90 ? replyTo.text.slice(0,90) + '…' : replyTo.text) : undefined
    
    // Format message with reply if needed
    let formattedMessage = messageText
    if (replyTo) {
      // Add a special format that we can parse later
      // Using a format that won't interfere with normal messages
      formattedMessage = `[REPLY:${replyTo.sender}:${replyTo.text.slice(0,90)}]\n${messageText}`
    }
    
    // Create optimistic message
    const optimisticMessage: Message = { 
      id: tempId, 
      text: messageText, 
      sent: true, 
      time: now, 
      replySnippet,
      isOptimistic: true
    }
    
    // Clear input immediately for better UX
    setDraft('')
    setReplyTo(null)
    setSending(true)
    
    // Add optimistic message immediately
    setMessages(prev => [...prev, optimisticMessage])
    
    // Force scroll to bottom for sent messages
    setTimeout(scrollToBottom, 50)
    
    // Store reply snippet in metadata if needed
    if (replySnippet){
      const k = `${now}|${messageText}|me`
      metaRef.current[k] = { ...(metaRef.current[k]||{}), replySnippet }
      try{ localStorage.setItem(storageKey, JSON.stringify(metaRef.current)) }catch{}
    }
    
    // Send to server with formatted message
    const fd = new URLSearchParams({ recipient_id: String(otherUserId), message: formattedMessage })
    
    fetch('/send_message', { 
      method:'POST', 
      credentials:'include', 
      headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, 
      body: fd 
    })
    .then(r=>r.json())
    .then(j=>{
      if (j?.success){
        // Stop typing indicator
        fetch('/api/typing', { 
          method:'POST', 
          credentials:'include', 
          headers:{ 'Content-Type':'application/json' }, 
          body: JSON.stringify({ peer: username, is_typing: false }) 
        }).catch(()=>{})
        // Replace optimistic bubble immediately with server-confirmed data if present
        if (j.message_id){
          const confirmedId = j.message_id
          const confirmedTime = j.time || new Date().toISOString().slice(0,19).replace('T',' ')
          setMessages(prev => prev.map(m => m.id === tempId ? ({ ...m, id: confirmedId, time: confirmedTime, isOptimistic: false }) : m))
        } else {
          // Fallback: mark acknowledged; polling will reconcile
          setMessages(prev => prev.map(m => m.id === tempId ? ({ ...m, isOptimistic: false }) : m))
        }
      } else {
        // Mark as retryable instead of removing immediately
        setMessages(prev => prev.map(m => m.id === tempId ? ({ ...m, text: m.text, isOptimistic: true }) : m))
        setDraft(messageText)
      }
    })
    .catch(()=>{
      // Keep optimistic bubble to avoid flicker; allow resend by tapping send again
      setMessages(prev => prev.map(m => m.id === tempId ? ({ ...m, text: m.text, isOptimistic: true }) : m))
      setDraft(messageText)
    })
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
        
        // Add photo message as optimistic update
        const photoMessage: Message = {
          id: `temp_photo_${Date.now()}`,
          text: '📷 Photo',
          image_path: j.image_path,
          sent: true,
          time: now,
          isOptimistic: true
        }
        setMessages(prev => [...prev, photoMessage])
        
        // Force poll to get real message
        lastFetchTime.current = 0
        
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

  async function uploadAudioBlob(blob: Blob){
    if (!otherUserId) return
    
    // Don't send if blob is empty (cancelled recording)
    if (!blob || blob.size === 0) {
      console.log('🎤 Empty audio blob, not sending')
      return
    }
    
    setSending(true)
    try{
      console.log('🎤 Uploading audio blob, size:', blob.size)
      const url = URL.createObjectURL(blob)
      const now = new Date().toISOString().slice(0,19).replace('T',' ')
      const optimistic: Message = { id: `temp_audio_${Date.now()}`, text: '🎤 Voice message', audio_path: url, sent: true, time: now, isOptimistic: true }
      setMessages(prev => [...prev, optimistic])
      setTimeout(scrollToBottom, 50)
      const fd = new FormData()
      fd.append('recipient_id', String(otherUserId))
      fd.append('duration_seconds', String(Math.round(recordMs/1000)))
      fd.append('audio', blob, 'voice.webm')
      const r = await fetch('/send_audio_message', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (!j?.success){
        setMessages(prev => prev.filter(m => m.id !== optimistic.id))
        alert(j?.error || 'Failed to send audio')
      } else {
        console.log('🎤 Audio sent successfully')
      }
    }catch(err){
      console.error('🎤 Upload error:', err)
      alert('Failed to send audio')
    }finally{
      setSending(false)
    }
  }

  async function startVisualizer(stream: MediaStream){
    try{
      console.log('🎤 Starting visualizer...')
      
      // Create audio context with mobile compatibility
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioContextClass) {
        console.warn('🎤 AudioContext not supported, skipping visualizer')
        return
      }
      
      const ctx = new AudioContextClass()
      console.log('🎤 AudioContext state:', ctx.state)
      
      // Resume context if suspended (required on mobile)
      if (ctx.state === 'suspended') {
        await ctx.resume()
        console.log('🎤 AudioContext resumed')
      }
      
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      
      // Mobile-optimized settings - more sensitive for mobile
      analyser.fftSize = isMobile ? 64 : 256
      analyser.smoothingTimeConstant = isMobile ? 0.1 : 0.8
      analyser.minDecibels = isMobile ? -100 : -90
      analyser.maxDecibels = isMobile ? 0 : -10
      
      source.connect(analyser)
      audioCtxRef.current = ctx
      analyserRef.current = analyser
      sourceRef.current = source
      
      console.log('🎤 Analyser setup - fftSize:', analyser.fftSize, 'mobile:', isMobile)
      
      const bufferLength = analyser.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)
      
      const updateAudioLevels = () => {
        if (!analyserRef.current) return
        
        analyserRef.current.getByteFrequencyData(dataArray)
        
        // Create 25 bars from frequency data
        const barCount = 25
        const levels: number[] = []
        const samplesPerBar = Math.floor(bufferLength / barCount)
        
        let maxLevel = 0
        for (let i = 0; i < barCount; i++) {
          let sum = 0
          const start = i * samplesPerBar
          const end = Math.min(start + samplesPerBar, bufferLength)
          
          for (let j = start; j < end; j++) {
            sum += dataArray[j]
          }
          
          const average = sum / (end - start)
          // Much higher sensitivity for mobile
          const sensitivity = isMobile ? 8 : 2
          const level = Math.min(1, (average / 255) * sensitivity)
          levels.push(level)
          maxLevel = Math.max(maxLevel, level)
        }
        
        // Log audio levels periodically for debugging
        if (Date.now() % 2000 < 100) { // Every ~2 seconds
          console.log('🎤 Max audio level:', maxLevel.toFixed(3), 'levels sample:', levels.slice(0, 5).map(l => l.toFixed(2)))
        }
        
        setAudioLevels(levels)
        visRafRef.current = requestAnimationFrame(updateAudioLevels)
      }
      
      updateAudioLevels()
    }catch(err){
      console.error('🎤 Visualizer error:', err)
    }
  }

  // resetRecordingState utility not used currently (native fallback disabled)

  // Note: native audio capture fallback currently disabled

  async function startRecording(){
    try{
      console.log('🎤 Starting recording...', 'mobile:', isMobile)
      
      // Check browser support
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Voice messages are not supported in this browser. Please use a modern browser like Chrome, Firefox, or Safari.')
        return
      }
      
      if (!('MediaRecorder' in window)){
        alert('Voice recording is not supported in this browser.')
        return
      }
      
      // For mobile, try to initialize audio context early with user gesture
      if (isMobile) {
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
          if (AudioContextClass) {
            const testCtx = new AudioContextClass()
            if (testCtx.state === 'suspended') {
              await testCtx.resume()
              console.log('🎤 Mobile: Pre-initialized AudioContext')
            }
            testCtx.close()
          }
        } catch (err) {
          console.log('🎤 Mobile: Could not pre-initialize AudioContext:', err)
        }
      }
      
      // Request microphone permission with mobile-optimized constraints
      console.log('🎤 Requesting microphone permission...')
      const constraints = {
        audio: isMobile ? 
          // Very basic constraints for mobile - just request audio
          true : 
          {
            // Full constraints for desktop
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 44100,
            channelCount: 1
          }
      }
      
      console.log('🎤 Using constraints:', constraints)
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      console.log('🎤 Microphone permission granted, starting recorder...')
      console.log('🎤 Audio tracks:', stream.getAudioTracks().map(t => ({ label: t.label, enabled: t.enabled, readyState: t.readyState })))
      
      // Check for mobile-compatible MIME types - prioritize mobile formats
      let mimeType = ''
      const supportedTypes = isMobile ? [
        // Mobile-prioritized formats
        'audio/mp4',
        'audio/webm',
        'audio/wav',
        'audio/ogg'
      ] : [
        // Desktop formats
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/wav'
      ]
      
      for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type
          break
        }
      }
      
      console.log('🎤 Supported MIME types:', supportedTypes.filter(t => MediaRecorder.isTypeSupported(t)))
      console.log('🎤 Using MIME type:', mimeType || 'browser default')
      
      const options = mimeType ? { mimeType } : {}
      
      // Add mobile-specific options
      if (isMobile && !mimeType) {
        // Let mobile browser choose the best format
        console.log('🎤 Mobile device: letting browser choose format')
      }
      
      const mr = new MediaRecorder(stream, options)
      console.log('🎤 MediaRecorder created with state:', mr.state)
      chunksRef.current = []
      stoppedRef.current = false
      finalizedRef.current = false
      if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current)

      mr.onerror = (evt) => {
        console.error('🎤 MediaRecorder error:', (evt as any).error || evt)
      }
      mr.ondataavailable = (e) => { 
        console.log('🎤 Data available:', e.data.size, 'bytes', 'type:', e.data.type, 'mobile:', isMobile)
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data)
          console.log('🎤 Total chunks so far:', chunksRef.current.length, 'total size:', chunksRef.current.reduce((sum, chunk) => sum + (chunk as Blob).size, 0))
        } else {
          console.warn('🎤 Empty or invalid data chunk received')
        }
        // If we've already requested stop, schedule a short finalize after last chunk
        if (stoppedRef.current) {
          if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current)
          finalizeTimerRef.current = setTimeout(() => {
            try { (mr.state === 'inactive') && finalizeRecording() } catch { finalizeRecording() }
          }, 150)
        }
      }
      const finalizeRecording = async () => {
        if (finalizedRef.current) return
        console.log('🎤 Recording stopped, processing audio...')
        console.log('🎤 Chunks collected:', chunksRef.current.length)
        // If chunks have not arrived yet, retry a couple of times
        if (chunksRef.current.length === 0 && stoppedRef.current) {
          if (finalizeAttemptRef.current < 2) {
            finalizeAttemptRef.current += 1
            console.log('🎤 No chunks yet, retrying finalize in 400ms (attempt', finalizeAttemptRef.current, ')')
            if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current)
            finalizeTimerRef.current = setTimeout(finalizeRecording, 400)
            return
          }
        }
        try{
          // On some iOS/Safari builds, mimeType may be empty; fall back to common types
          const preferredType = mr.mimeType || (isMobile ? 'audio/mp4' : 'audio/webm')
          let blob = new Blob(chunksRef.current, { type: preferredType })

          // iOS Safari sometimes produces empty-type blobs even with data; try rewrap
          if (blob.size > 0 && (!blob.type || blob.type === '')) {
            try {
              blob = new Blob([blob], { type: preferredType })
            } catch {}
          }
          console.log('🎤 Audio blob created, size:', blob.size, 'duration:', Math.round(recordMs/1000))
          
          // Check minimum recording duration (especially important for mobile)
          const timerDuration = Math.round(recordMs/1000)
          console.log('🎤 Timer duration:', timerDuration, 'seconds, blob size:', blob.size)
          
          if (blob.size === 0) {
            console.error('🎤 Empty blob after stop — treating as failure')
            // Ensure UI resets so mic button remains responsive
            setRecording(false)
            setRecorder(null)
            setRecordMs(0)
            setAudioLevels(Array(25).fill(0))
            return
          }
          
          // For mobile, accept any non-zero blob (some browsers produce small initial chunks)
          if (!isMobile) {
            // Desktop: keep normal validation
            if (timerDuration < 1) {
              console.warn('🎤 Desktop: Recording too short:', timerDuration, 'seconds')
              alert('Recording is too short. Please record for at least 1 second.')
              return
            }
          }
          
          // Use actual duration or fallback to timer duration
          let actualDuration = timerDuration
          
          // Try to get actual duration from the blob
          try {
            const tempUrl = URL.createObjectURL(blob)
            const tempAudio = new Audio(tempUrl)
            tempAudio.addEventListener('loadedmetadata', () => {
              if (tempAudio.duration && isFinite(tempAudio.duration)) {
                const blobDuration = Math.round(tempAudio.duration)
                console.log('🎤 Actual blob duration:', blobDuration, 'vs timer:', timerDuration)
                if (blobDuration > timerDuration) {
                  actualDuration = blobDuration
                  console.log('🎤 Using blob duration instead of timer duration')
                }
              }
              URL.revokeObjectURL(tempUrl)
            })
          } catch (err) {
            console.log('🎤 Could not get blob duration, using timer duration')
          }
          
          // Don't auto-send, show preview instead
          const url = URL.createObjectURL(blob)
          console.log('🎤 Setting recording preview - final duration:', actualDuration, 'blob size:', blob.size, 'blob type:', blob.type)
          setRecordingPreview({ blob, url, duration: actualDuration })
          finalizedRef.current = true
        } finally {
          setRecording(false)
          setRecorder(null)
          setRecordMs(0)
          setAudioLevels(Array(25).fill(0))
          try{ stream.getTracks().forEach(t=> t.stop()) }catch{}
          if (recordTimerRef.current) clearInterval(recordTimerRef.current)
          if (visRafRef.current) cancelAnimationFrame(visRafRef.current)
          try{ analyserRef.current && analyserRef.current.disconnect() }catch{}
          try{ sourceRef.current && sourceRef.current.disconnect() }catch{}
          try{ audioCtxRef.current && audioCtxRef.current.close() }catch{}
          analyserRef.current = null; sourceRef.current = null; audioCtxRef.current = null
          // Reset lock state after finalize
          lockActiveRef.current = false
          setRecordLockActive(false)
        }
      }
      mr.onstop = () => {
        // Give a tiny delay to allow the final dataavailable to fire
        stoppedRef.current = true
        if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current)
        finalizeAttemptRef.current = 0
        finalizeTimerRef.current = setTimeout(finalizeRecording, 400)
      }
      // Start recording with mobile-specific handling
      try {
        // Detect iOS device (any browser)
        const ua = navigator.userAgent
        const isIOSDevice = /iPad|iPhone|iPod/.test(ua) || ((navigator.platform === 'MacIntel') && (navigator.maxTouchPoints || 0) > 1)

        if (isMobile && isIOSDevice) {
          // iOS: avoid timeslice to ensure data arrives only on stop
          mr.start()
          console.log('🎤 iOS: Starting without timeslice')
        } else if (isMobile) {
          // Other mobile browsers: use short timeslice to flush data
          mr.start(500)
          console.log('🎤 Mobile: Starting with 500ms intervals')
        } else {
          mr.start(1000) // 1s intervals for desktop
          console.log('🎤 Desktop: Starting with 1s intervals')
        }
        
        setRecorder(mr)
        setRecording(true)
        recordStartRef.current = Date.now()
        setRecordMs(0)
        if (recordTimerRef.current) clearInterval(recordTimerRef.current)
        recordTimerRef.current = setInterval(()=> setRecordMs(Date.now() - recordStartRef.current), 200)
        // Safety auto-stop at 60s
        setTimeout(()=> { try{ mr.state !== 'inactive' && mr.stop() }catch{} }, 60000)
        
        // Start visualizer
        startVisualizer(stream)
        console.log('🎤 Recording started successfully, state:', mr.state)
        
        // Skip mid-recording fallback checks; many mobile browsers only flush data on stop
        
      } catch (startError) {
        console.error('🎤 Failed to start recording:', startError)
        throw startError
      }
    }catch(err){
      console.error('🎤 Recording error:', err)
      const error = err as Error
      
      // Show the permission guide for denied permissions
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        console.log('🎤 Permission denied, showing guide')
        setShowPermissionGuide(true)
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        alert('No microphone found. Please check your device settings and ensure microphone access is enabled.')
      } else if (error.name === 'NotSupportedError') {
        alert('Voice recording is not supported on this device or browser. Please try using a different browser.')
      } else if (error.name === 'AbortError') {
        console.log('🎤 Access aborted, showing guide')
        setShowPermissionGuide(true)
      } else {
        alert('Could not access microphone: ' + error.message + '. This may be due to browser security restrictions on mobile devices.')
      }
    }
  }

  function stopRecording(){ 
    console.log('🎤 Stopping recording and sending...', 'mobile:', isMobile, 'chunks so far:', chunksRef.current.length)
    
    try{ 
      if (recorder && recorder.state !== 'inactive') {
        // For mobile, request data before stopping to ensure we get everything
        if (isMobile) {
          console.log('🎤 Mobile: Requesting final data before stop')
          stoppedRef.current = true
          recorder.requestData()
          // Small delay to allow data collection
          setTimeout(() => {
            if (recorder.state !== 'inactive') {
              recorder.stop()
            }
          }, 120)
        } else {
          recorder.stop()
        }
      }
    }catch(e){ 
      console.error('🎤 Error stopping recorder:', e)
    } 
    // Always schedule a UI reset safeguard in case onstop doesn't arrive on mobile
    setTimeout(() => {
      try {
        setRecording(false)
        setRecorder(null)
      } catch {}
    }, 800)
  }
  
  
  function sendRecordingPreview(){
    if (!recordingPreview) {
      console.log('🎤 No recording preview to send')
      return
    }
    console.log('🎤 Sending recording preview, duration:', recordingPreview.duration, 'blob size:', recordingPreview.blob.size)
    uploadAudioBlobWithDuration(recordingPreview.blob, recordingPreview.duration)
    setRecordingPreview(null)
  }
  
  async function uploadAudioBlobWithDuration(blob: Blob, durationSeconds: number){
    if (!otherUserId) return
    
    // Don't send if blob is empty (cancelled recording)
    if (!blob || blob.size === 0) {
      console.log('🎤 Empty audio blob, not sending')
      return
    }
    
    setSending(true)
    try{
      console.log('🎤 Uploading audio blob, size:', blob.size, 'duration:', durationSeconds)
      const url = URL.createObjectURL(blob)
      const now = new Date().toISOString().slice(0,19).replace('T',' ')
      const optimistic: Message = { id: `temp_audio_${Date.now()}`, text: '🎤 Voice message', audio_path: url, sent: true, time: now, isOptimistic: true }
      setMessages(prev => [...prev, optimistic])
      setTimeout(scrollToBottom, 50)
      const fd = new FormData()
      fd.append('recipient_id', String(otherUserId))
      fd.append('duration_seconds', String(durationSeconds))
      
      // Determine file extension based on blob type
      let filename = 'voice.webm'
      if (blob.type.includes('mp4')) {
        filename = 'voice.mp4'
      } else if (blob.type.includes('wav')) {
        filename = 'voice.wav'
      } else if (blob.type.includes('ogg')) {
        filename = 'voice.ogg'
      }
      
      console.log('🎤 Uploading with filename:', filename, 'blob type:', blob.type)
      fd.append('audio', blob, filename)
      const r = await fetch('/send_audio_message', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (!j?.success){
        console.error('🎤 Send failed:', j?.error)
        setMessages(prev => prev.filter(m => m.id !== optimistic.id))
        alert(j?.error || 'Failed to send audio message')
      } else {
        console.log('🎤 Audio sent successfully')
      }
    }catch(err){
      console.error('🎤 Upload error:', err)
      alert('Failed to send voice message: ' + (err as Error).message)
    } finally {
      setSending(false)
    }
  }
  
  function cancelRecordingPreview(){
    if (recordingPreview) {
      URL.revokeObjectURL(recordingPreview.url)
      setRecordingPreview(null)
    }
  }

  function handleAudioFileChange(event: React.ChangeEvent<HTMLInputElement>){
    const file = event.target.files?.[0]
    if (!file) return
    uploadAudioBlob(file)
    event.target.value = ''
  }

  function handleMicClick(e: React.MouseEvent | React.TouchEvent){
    console.log('🎤 Mic button clicked, recording:', recording, 'mobile:', isMobile)
    try{ e.preventDefault(); e.stopPropagation() }catch{}
    if (suppressClickRef.current) {
      // Suppress click caused by touchend
      suppressClickRef.current = false
      return
    }
    if (recording) {
      console.log('🎤 Click stop (no lock)')
      stopRecording()
    } else {
      checkMicrophonePermission()
    }
  }

  async function checkMicrophonePermission() {
    try {
      // Check current permission state
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName })
      console.log('🎤 Current microphone permission:', permissionStatus.state)
      
      if (permissionStatus.state === 'granted') {
        // Permission already granted, start recording directly
        startRecording()
      } else if (permissionStatus.state === 'denied') {
        // Permission denied, show help modal
        setShowMicPermissionModal(true)
      } else {
        // Permission not yet requested, show pre-permission modal
        setShowMicPermissionModal(true)
      }
    } catch (error) {
      // Fallback for browsers that don't support permissions API
      console.log('🎤 Permissions API not supported, showing modal')
      setShowMicPermissionModal(true)
    }
  }

  function requestMicrophoneAccess() {
    setShowMicPermissionModal(false)
    // Start recording which will trigger the browser's permission dialog
    if (isMobile) {
      setTimeout(() => startRecording(), 0)
    } else {
      startRecording()
    }
  }

  function handleDeleteMessage(messageId: number | string, messageData: Message) {
    // Show confirmation dialog
    if (!confirm('Are you sure you want to delete this message?')) {
      return
    }
    
    // Add to pending deletions
    pendingDeletions.current.add(messageId)
    
    // Optimistically remove the message
    setMessages(prev => prev.filter(x => x.id !== messageId))
    
    // Send delete request
    const fd = new URLSearchParams({ message_id: String(messageId) })
    
    fetch('/delete_message', { 
      method:'POST', 
      credentials:'include', 
      headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, 
      body: fd 
    })
    .then(r=>r.json())
    .then(j=>{ 
      if (!j?.success) { 
        // Remove from pending deletions
        pendingDeletions.current.delete(messageId)
        
        // Restore the message if deletion failed
        setMessages(prev => {
          // Check if message still exists (might have been re-added by polling)
          if (prev.some(x => x.id === messageId)) {
            return prev
          }
          // Re-add the message in the correct position
          const newMessages = [...prev, messageData]
          return newMessages.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
        })
        
        // Show error
        if (j?.error) {
          alert(j.error === 'Premium subscription required!' 
            ? 'Premium subscription required to delete messages' 
            : `Failed to delete message: ${j.error}`)
        } else {
          alert('Failed to delete message')
        }
      } else {
        // Success - keep in pending deletions for a while to prevent re-appearing
        setTimeout(() => {
          pendingDeletions.current.delete(messageId)
        }, 5000)
      }
    })
    .catch(()=>{
      // Network error
      pendingDeletions.current.delete(messageId)
      
      // Restore the message
      setMessages(prev => {
        if (prev.some(x => x.id === messageId)) {
          return prev
        }
        const newMessages = [...prev, messageData]
        return newMessages.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
      })
      
      alert('Network error. Could not delete message.')
    })
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
      {/* Chat header (fixed below global header for iOS focus stability) */}
      <div 
        className="h-14 border-b border-white/10 flex items-center gap-3 px-4 flex-shrink-0"
        style={{
          backgroundColor: 'rgb(0, 0, 0)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          zIndex: 10010,
          position: 'fixed',
          top: '56px',
          left: 0,
          right: 0,
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
            <div className="font-semibold truncate text-white text-sm">
              {otherProfile?.display_name || username || 'Chat'}
            </div>
            {/* Online/typing label removed as requested */}
          </div>
          <button 
            className="p-2 rounded-full hover:bg-white/10 transition-colors" 
            aria-label="More options"
          >
            <i className="fa-solid fa-ellipsis-vertical text-white/70" />
          </button>
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
          paddingTop: '56px',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 6rem)'
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
        {messages.map((m, index) => {
          const messageDate = getDateKey(m.time)
          const prevMessageDate = index > 0 ? getDateKey(messages[index - 1].time) : null
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
                <LongPressActionable 
                  onDelete={() => handleDeleteMessage(m.id, m)}
                  onReact={(emoji)=> {
                    setMessages(msgs => msgs.map(x => x.id===m.id ? { ...x, reaction: emoji } : x))
                    const k = `${m.time}|${m.text}|${m.sent ? 'me' : 'other'}`
                    metaRef.current[k] = { ...(metaRef.current[k]||{}), reaction: emoji }
                    try{ localStorage.setItem(storageKey, JSON.stringify(metaRef.current)) }catch{}
                  }} 
                  onReply={() => {
                    setReplyTo({ 
                      text: m.text,
                      sender: m.sent ? 'You' : (otherProfile?.display_name || username || 'User')
                    })
                    textareaRef.current?.focus()
                  }} 
                  onCopy={() => {
                    try{ navigator.clipboard && navigator.clipboard.writeText(m.text) }catch{}
                  }}
                  onEdit={m.sent ? () => {
                    const dt = parseMessageTime(m.time)
                    if (dt && (Date.now() - dt.getTime()) > 5*60*1000) return
                    setEditingId(m.id); setEditText(m.text)
                  } : undefined}
                  disabled={editingId === m.id}
                >
                  <div className={`flex ${m.sent ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[70%] md:max-w-[70%] px-3 py-2 rounded-2xl text-[14px] leading-snug whitespace-pre-wrap break-words shadow-sm border ${
                        m.sent 
                          ? 'bg-[#075E54] text-white border-[#075E54]' 
                          : 'bg-[#1a1a1a] text-white border-white/10'
                      } ${m.sent ? 'rounded-br-md' : 'rounded-bl-md'} ${
                        m.isOptimistic ? 'opacity-70' : 'opacity-100'
                      }`}
                      style={{ 
                        position: 'relative', 
                        ...(m.reaction ? { paddingRight: '1.75rem', paddingBottom: '1.25rem' } : {}) 
                      } as any}
                    >
                      {m.replySnippet ? (
                        <div className="mb-2 px-2 py-1.5 rounded-lg bg-white/5 border-l-2 border-[#4db6ac]">
                          <div className="text-[11px] text-[#4db6ac] font-medium mb-0.5">
                            {m.sent ? 'You' : (otherProfile?.display_name || username || 'User')}
                          </div>
                          <div className="text-[12px] text-white/70 line-clamp-2">
                            {m.replySnippet}
                          </div>
                        </div>
                      ) : null}
                      
                      {/* Audio message */}
                      {m.audio_path && !m.image_path ? (
                        <AudioMessage 
                          message={m}
                          audioPath={m.audio_path.startsWith('blob:') ? m.audio_path : `/uploads/${m.audio_path}`}
                        />
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
                      
                      {/* Text content or editor */}
                      {editingId === m.id ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs text-white/60">
                            <i className="fa-regular fa-pen-to-square" />
                            <span>Edit message</span>
                          </div>
                          <div className="relative group" onClick={(e)=> e.stopPropagation()} onMouseDown={(e)=> e.stopPropagation()} onTouchStart={(e)=> e.stopPropagation()}>
                            <textarea
                              className="w-full bg-black/30 border border-white/15 rounded-xl px-3 py-2 text-sm pr-10 focus:outline-none focus:border-[#4db6ac] shadow-inner"
                              value={editText}
                              onChange={e=> setEditText(e.target.value)}
                              rows={3}
                              placeholder="Edit your message..."
                            />
                            <button
                              className={`absolute top-2 right-2 w-8 h-8 rounded-lg flex items-center justify-center ${editingSaving ? 'bg-gray-600 text-gray-300' : 'bg-[#4db6ac] text-black hover:brightness-110'}`}
                              onClick={editingSaving ? undefined : commitEdit}
                              disabled={editingSaving}
                              title="Save"
                            >
                              {editingSaving ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-check" />}
                            </button>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <button className="px-3 py-1.5 text-xs bg-white/10 border border-white/20 rounded-lg hover:bg-white/15" onClick={()=> { setEditingId(null); setEditText('') }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        m.text ? (
                          <div onDoubleClick={()=> {
                            if (!m.sent) return
                            // Enforce 5-minute window on client: hide editor entry if expired
                            const dt = parseMessageTime(m.time)
                            if (dt && (Date.now() - dt.getTime()) > 5*60*1000) return
                            setEditingId(m.id); setEditText(m.text)
                          }}>
                            {linkifyText(m.text)}
                            {m.edited_at ? (
                              <div className="text-[10px] text-white/50 mt-0.5">edited</div>
                            ) : null}
                          </div>
                        ) : null
                      )}
                      <div className={`text-[10px] mt-1 ${m.sent ? 'text-white/70' : 'text-white/50'} text-right`}>
                        {new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
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
      <div className="bg-black px-3 py-2 border-t border-white/10 flex-shrink-0" style={{ marginBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)', position:'sticky', bottom:0, zIndex:10005 }}>
        {replyTo && (
          <div className="mb-2 px-3 py-2 bg-[#1a1a1a] rounded-lg border-l-4 border-[#4db6ac]">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] text-[#4db6ac] font-semibold">
                Replying to {replyTo.sender === 'You' ? 'yourself' : (otherProfile?.display_name || username || 'User')}
              </div>
              <button 
                className="text-white/50 hover:text-white/80 transition-colors" 
                onClick={()=> setReplyTo(null)}
              >
                <i className="fa-solid fa-xmark text-sm" />
              </button>
            </div>
            <div className="text-[13px] text-white/70 line-clamp-2">
              {replyTo.text.length > 100 ? replyTo.text.slice(0, 100) + '…' : replyTo.text}
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
                {/* Voice message moved next to Send button */}
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
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*"
            capture
            onChange={handleAudioFileChange}
            className="hidden"
          />
          
          {/* Recording counter - visible above text box */}
          {MIC_ENABLED && recording && (
            <div className="mb-2 flex justify-center">
              <div className="bg-red-600/90 px-3 py-1.5 rounded-full border border-red-500/40 shadow-md">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 bg-white rounded-full animate-pulse" />
                  <div className="text-white font-mono font-medium text-sm">
                    {new Date(recordMs).toISOString().substr(14,5)}
                  </div>
                  <span className="text-white/90 text-xs">REC</span>
                </div>
              </div>
            </div>
          )}

          {/* Message input container */}
          <div className="flex-1 flex items-center bg-[#1a1a1a] rounded-3xl border border-white/20 overflow-hidden relative">
            {/* Recording sound bar - replaces text input during recording */}
            {MIC_ENABLED && recording && (
              <div className="flex-1 flex items-center px-4 py-2.5 gap-3">
                <div className="flex items-center gap-3 flex-1">
                  <span className="inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  <div className="flex-1 h-6 bg-gray-800/80 rounded-full flex items-center justify-center px-2 gap-0.5 relative overflow-hidden">
                    {/* Audio-reactive sound bars */}
                    {audioLevels.map((level, i) => (
                      <div 
                        key={i}
                        className="w-0.5 bg-gray-400 rounded-full transition-all duration-100"
                        style={{
                          height: `${4 + level * 16}px`,
                          opacity: 0.3 + level * 0.7,
                          backgroundColor: level > 0.1 ? '#9ca3af' : '#6b7280'
                        }}
                      />
                    ))}
                  </div>
                  {recordLockActive && (
                    <div className="text-xs text-white/70 ml-2 flex items-center gap-1">
                      <i className="fa-solid fa-lock" />
                      <span>Locked</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Regular text input - hidden during recording */}
            {!(MIC_ENABLED && recording) && (
              <textarea
                ref={textareaRef}
                rows={1}
                className="flex-1 bg-transparent px-4 pr-20 py-2.5 text-[16px] text-white placeholder-white/50 outline-none resize-none max-h-24 min-h-[36px]"
                placeholder="Message"
                value={draft}
                onChange={e=> {
                  setDraft(e.target.value)
                  fetch('/api/typing', { 
                    method:'POST', 
                    credentials:'include', 
                    headers:{ 'Content-Type':'application/json' }, 
                    body: JSON.stringify({ peer: username, is_typing: true }) 
                  }).catch(()=>{})
                  if (typingTimer.current) clearTimeout(typingTimer.current)
                  typingTimer.current = setTimeout(() => {
                    fetch('/api/typing', { 
                      method:'POST', 
                      credentials:'include', 
                      headers:{ 'Content-Type':'application/json' }, 
                      body: JSON.stringify({ peer: username, is_typing: false }) 
                    }).catch(()=>{})
                  }, 1200)
                }}
                style={{
                  lineHeight: '1.4',
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none'
                }}
              />
            )}
            
            {/* Mic + Send */}
            <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-2">
              {/* Send button first */}
              <button
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 ease-out ${
                  sending 
                    ? 'bg-gray-600 text-gray-300 cursor-not-allowed' 
                    : draft.trim()
                      ? 'bg-[#4db6ac] text-black hover:bg-[#45a99c] hover:scale-105 active:scale-95'
                      : 'bg-white/20 text-white/70 cursor-not-allowed'
                }`}
                onClick={draft.trim() ? send : undefined}
                disabled={sending || !draft.trim()}
                aria-label="Send"
                style={{
                  transform: 'scale(1)',
                  transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)'
                }}
              >
                {sending ? (
                  <i className="fa-solid fa-spinner fa-spin text-[11px]" />
                ) : (
                  <i className="fa-solid fa-paper-plane text-[11px]" />
                )}
              </button>
              {/* Mic button to the right of Send and outside textbox area */}
              {MIC_ENABLED && (
              <button
                className={`w-10 h-10 md:w-8 md:h-8 rounded-full flex items-center justify-center transition-all duration-200 ease-out ${
                  recording 
                    ? 'bg-red-600 text-white scale-105 shadow-lg shadow-red-500/50 animate-pulse' 
                    : 'bg-[#4db6ac] text-white hover:bg-[#45a99c] hover:scale-105 active:scale-95 shadow-md'
                }`}
                onClick={handleMicClick}
                onTouchStart={(e) => {
                  try{ e.preventDefault(); e.stopPropagation() }catch{}
                  suppressClickRef.current = true
                  touchStartYRef.current = (e.touches && e.touches[0]?.clientY) || null
                  setShowLockHint(true)
                  if (!recording) checkMicrophonePermission()
                }}
                onTouchMove={(e) => {
                  try{ e.preventDefault(); e.stopPropagation() }catch{}
                  const startY = touchStartYRef.current
                  if (startY == null) return
                  const dy = startY - (e.touches && e.touches[0]?.clientY || startY)
                  // Lock when user swipes up by 40px
                  const shouldLock = dy > 40
                  if (shouldLock && !lockActiveRef.current) {
                    lockActiveRef.current = true
                    setRecordLockActive(true)
                    setShowLockHint(false)
                    console.log('🔒 Recording locked')
                  }
                }}
                onTouchEnd={(e) => {
                  try{ e.preventDefault(); e.stopPropagation() }catch{}
                  // If locked, do not stop; user must press stop icon
                  if (!lockActiveRef.current) {
                    console.log('🛑 Touch end - stopping (no lock)')
                    stopRecording()
                  }
                  // reset gesture state
                  touchStartYRef.current = null
                  setShowLockHint(false)
                  // leave lockActiveRef as-is; cleared when finalize
                  suppressClickRef.current = false
                }}
                aria-label="Voice message"
                title={recording ? "Tap to stop recording" : "Tap to start recording"}
                style={{
                  touchAction: 'manipulation',
                  WebkitTapHighlightColor: 'transparent',
                  userSelect: 'none',
                  WebkitUserSelect: 'none'
                }}
              >
                <i className={`fa-solid ${
                  recording && !recordLockActive ? 'fa-stop' : 'fa-microphone'
                } text-[13px]`} />
              </button>
              )}
              {MIC_ENABLED && showLockHint && !recordLockActive && (
                <div className="absolute right-14 -top-4 bg-white/10 text-white text-[10px] px-2 py-1 rounded-md border border-white/20">
                  Swipe up to lock
                </div>
              )}
            </div>
          </div>
        </div>
      </div>


      {/* Permission guide modal */}
      {showPermissionGuide && (
        <div className="fixed inset-0 bg-black/90 z-[9999] flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] rounded-2xl border border-white/20 p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-red-600/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <i className="fa-solid fa-microphone-slash text-red-400 text-2xl" />
              </div>
              <h3 className="text-white text-lg font-medium mb-2">Microphone Access Needed</h3>
              <p className="text-white/70 text-sm">
                To enable voice messages, please allow microphone access in your browser settings.
              </p>
            </div>

            {/* Instructions based on device/browser */}
            <div className="space-y-4 mb-6">
              {/* Safari on iPhone */}
              <div className="bg-gray-800/50 rounded-lg p-4">
                <h4 className="text-white font-medium mb-3 flex items-center gap-2">
                  <i className="fa-brands fa-safari text-blue-400" />
                  Safari (iPhone/iPad)
                </h4>
                <ol className="text-sm text-white/80 space-y-2 list-decimal list-inside">
                  <li>Tap the <strong>AA</strong> icon in the address bar</li>
                  <li>Select <strong>"Website Settings"</strong></li>
                  <li>Tap <strong>"Microphone"</strong></li>
                  <li>Choose <strong>"Allow"</strong></li>
                  <li>Refresh this page and try again</li>
                </ol>
              </div>

              {/* Chrome on mobile */}
              <div className="bg-gray-800/50 rounded-lg p-4">
                <h4 className="text-white font-medium mb-3 flex items-center gap-2">
                  <i className="fa-brands fa-chrome text-blue-400" />
                  Chrome (Mobile)
                </h4>
                <ol className="text-sm text-white/80 space-y-2 list-decimal list-inside">
                  <li>Tap the <strong>lock icon</strong> or <strong>three dots</strong> in the address bar</li>
                  <li>Tap <strong>"Site settings"</strong> or <strong>"Permissions"</strong></li>
                  <li>Find <strong>"Microphone"</strong></li>
                  <li>Change to <strong>"Allow"</strong></li>
                  <li>Refresh this page and try again</li>
                </ol>
              </div>

              {/* General mobile */}
              <div className="bg-gray-800/50 rounded-lg p-4">
                <h4 className="text-white font-medium mb-3 flex items-center gap-2">
                  <i className="fa-solid fa-mobile-alt text-green-400" />
                  Other Mobile Browsers
                </h4>
                <ol className="text-sm text-white/80 space-y-2 list-decimal list-inside">
                  <li>Look for a <strong>microphone icon</strong> or <strong>lock icon</strong> in the address bar</li>
                  <li>Tap it and select <strong>"Allow microphone"</strong></li>
                  <li>Or go to browser <strong>Settings → Site Permissions → Microphone</strong></li>
                  <li>Refresh this page and try again</li>
                </ol>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowPermissionGuide(false)}
                className="flex-1 px-4 py-3 bg-gray-700/50 text-gray-300 border border-gray-600/50 rounded-xl hover:bg-gray-700/70 transition-colors font-medium"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setShowPermissionGuide(false)
                  // Try again after user has potentially changed settings
                  setTimeout(() => checkMicrophonePermission(), 500)
                }}
                className="flex-1 px-4 py-3 bg-[#4db6ac] text-black rounded-xl hover:bg-[#45a99c] transition-colors font-medium"
              >
                <i className="fa-solid fa-refresh mr-2" />
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Microphone permission modal */}
      {showMicPermissionModal && (
        <div className="fixed inset-0 bg-black/90 z-[9999] flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] rounded-2xl border border-white/20 p-6 max-w-sm w-full mx-4">
            {/* Header */}
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-[#4db6ac]/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <i className="fa-solid fa-microphone text-[#4db6ac] text-2xl" />
              </div>
              <h3 className="text-white text-lg font-medium mb-2">Microphone Access</h3>
              <p className="text-white/70 text-sm leading-relaxed">
                To send voice messages, we need access to your microphone. 
                {isMobile ? ' Your browser will ask for permission.' : ' Click "Allow" when your browser asks for permission.'}
              </p>
            </div>

            {/* Features list */}
            <div className="mb-6 space-y-2">
              <div className="flex items-center gap-3 text-sm text-white/80">
                <i className="fa-solid fa-check text-[#4db6ac] text-xs" />
                <span>Record voice messages</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-white/80">
                <i className="fa-solid fa-check text-[#4db6ac] text-xs" />
                <span>Preview before sending</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-white/80">
                <i className="fa-solid fa-check text-[#4db6ac] text-xs" />
                <span>Your audio stays private</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowMicPermissionModal(false)}
                className="flex-1 px-4 py-3 bg-gray-700/50 text-gray-300 border border-gray-600/50 rounded-xl hover:bg-gray-700/70 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={requestMicrophoneAccess}
                className="flex-1 px-4 py-3 bg-[#4db6ac] text-black rounded-xl hover:bg-[#45a99c] transition-colors font-medium"
              >
                <i className="fa-solid fa-microphone mr-2" />
                Allow Access
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Voice message preview modal */}
      {recordingPreview && (
        <div className="fixed inset-0 bg-black/90 z-[9999] flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] rounded-2xl border border-white/20 p-6 max-w-sm w-full mx-4">
            {/* Header */}
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-[#4db6ac]/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <i className="fa-solid fa-microphone text-[#4db6ac] text-2xl" />
              </div>
              <h3 className="text-white text-lg font-medium">Voice Message</h3>
              <p className="text-white/60 text-sm">Duration: {recordingPreview.duration}s</p>
            </div>

            {/* Audio player */}
            <div className="mb-6">
              <audio 
                controls 
                src={recordingPreview.url}
                className="w-full"
                style={{
                  background: '#2a2a2a',
                  borderRadius: '8px',
                  outline: 'none'
                }}
              />
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={cancelRecordingPreview}
                className="flex-1 px-4 py-3 bg-red-600/20 text-red-400 border border-red-600/30 rounded-xl hover:bg-red-600/30 transition-colors font-medium"
              >
                <i className="fa-solid fa-trash mr-2" />
                Delete
              </button>
              <button
                onClick={sendRecordingPreview}
                className="flex-1 px-4 py-3 bg-[#4db6ac] text-black rounded-xl hover:bg-[#45a99c] transition-colors font-medium"
              >
                <i className="fa-solid fa-paper-plane mr-2" />
                Send
              </button>
            </div>
          </div>
        </div>
      )}

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

function AudioMessage({ message, audioPath }: { message: Message; audioPath: string }) {
  const [duration, setDuration] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    console.log('🎵 AudioMessage - message data:', {
      id: message.id,
      audio_duration_seconds: message.audio_duration_seconds,
      type: typeof message.audio_duration_seconds,
      text: message.text,
      audioPath: audioPath,
      isBlob: audioPath.startsWith('blob:')
    })
    
    // First try to use the duration from the message
    if (typeof message.audio_duration_seconds === 'number' && message.audio_duration_seconds > 0) {
      console.log('🎵 Using duration from message:', message.audio_duration_seconds)
      setDuration(message.audio_duration_seconds)
      setLoading(false)
      return
    }

    // Test if audio file exists (for non-blob URLs)
    if (!audioPath.startsWith('blob:')) {
      fetch(audioPath, { method: 'HEAD' })
        .then(response => {
          console.log('🎵 Audio file check:', response.status, response.statusText, 'for', audioPath)
          if (!response.ok) {
            setError(`Audio file not found (${response.status})`)
            setLoading(false)
            return
          }
        })
        .catch(err => {
          console.error('🎵 Audio file check failed:', err, 'for', audioPath)
          setError('Audio file not accessible')
          setLoading(false)
          return
        })
    }

    // If no duration in message, try to get it from the audio element
    const audio = audioRef.current
    if (!audio) return

    const handleLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        console.log('🎵 Got duration from audio element:', audio.duration)
        setDuration(Math.round(audio.duration))
        setLoading(false)
      }
    }

    const handleError = (e: Event) => {
      console.error('🎵 Audio loading error:', e, 'src:', audio.src)
      const target = e.target as HTMLAudioElement
      let errorMsg = 'Audio file could not be loaded'
      
      if (target.error) {
        switch (target.error.code) {
          case target.error.MEDIA_ERR_ABORTED:
            errorMsg = 'Audio loading was aborted'
            break
          case target.error.MEDIA_ERR_NETWORK:
            errorMsg = 'Network error while loading audio'
            break
          case target.error.MEDIA_ERR_DECODE:
            errorMsg = 'Audio file format not supported'
            break
          case target.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
            errorMsg = 'Audio file not found or not supported'
            break
        }
      }
      
      setError(errorMsg)
      setLoading(false)
    }

    const handleCanPlay = () => {
      console.log('🎵 Audio can play:', audio.src)
      // Ensure volume is set correctly
      if (audio.volume === 0) {
        audio.volume = 1.0
        console.log('🎵 Fixed volume from 0 to 1.0')
      }
    }

    const handleLoadStart = () => {
      console.log('🎵 Audio load started:', audio.src)
    }

    const handlePlay = () => {
      console.log('🎵 Audio play event - volume:', audio.volume, 'muted:', audio.muted)
      // Ensure audio context is resumed (required on some mobile browsers)
      if (typeof window !== 'undefined' && 'AudioContext' in window) {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
        if (audioContext.state === 'suspended') {
          audioContext.resume().then(() => {
            console.log('🎵 AudioContext resumed for playback')
          })
        }
      }
    }

    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('error', handleError)
    audio.addEventListener('canplay', handleCanPlay)
    audio.addEventListener('loadstart', handleLoadStart)
    audio.addEventListener('play', handlePlay)

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('error', handleError)
      audio.removeEventListener('canplay', handleCanPlay)
      audio.removeEventListener('loadstart', handleLoadStart)
      audio.removeEventListener('play', handlePlay)
    }
  }, [message.audio_duration_seconds, audioPath])

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${String(secs).padStart(2, '0')}`
  }

  const retryAudio = () => {
    setError(null)
    setLoading(true)
    if (audioRef.current) {
      audioRef.current.load()
    }
  }

  const testPlayAudio = async () => {
    if (!audioRef.current) return
    
    try {
      console.log('🎵 Manual play test - volume:', audioRef.current.volume, 'muted:', audioRef.current.muted)
      
      // Ensure volume is up and not muted
      audioRef.current.volume = 1.0
      audioRef.current.muted = false
      
      // Try to play
      await audioRef.current.play()
      console.log('🎵 Manual play successful')
    } catch (err) {
      console.error('🎵 Manual play failed:', err)
      alert('Audio playback failed. Please check your device volume and try again.')
    }
  }

  return (
    <div className="mb-2">
      <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
        <div className="flex items-center gap-2 mb-2">
          <i className="fa-solid fa-microphone text-[#4db6ac] text-sm" />
          <span className="text-white/80 text-sm font-medium">Voice Message</span>
          <div className="ml-auto flex items-center gap-2">
            {duration !== null ? (
              <span className="text-xs text-white/60 bg-gray-700/50 px-2 py-1 rounded-full font-mono">
                {formatDuration(duration)}
              </span>
            ) : loading ? (
              <span className="text-xs text-white/40 bg-gray-700/30 px-2 py-1 rounded-full">
                --:--
              </span>
            ) : error ? (
              <button 
                onClick={retryAudio}
                className="text-xs text-red-400 bg-red-900/30 px-2 py-1 rounded-full hover:bg-red-900/50 transition-colors"
              >
                Retry
              </button>
            ) : null}
            
            {/* Manual play button for troubleshooting */}
            {!error && duration !== null && (
              <button
                onClick={testPlayAudio}
                className="text-xs text-[#4db6ac] bg-[#4db6ac]/20 px-2 py-1 rounded-full hover:bg-[#4db6ac]/30 transition-colors"
                title="Test audio playback"
              >
                <i className="fa-solid fa-play text-[10px]" />
              </button>
            )}
          </div>
        </div>
        
        {error ? (
          <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-3 text-center">
            <i className="fa-solid fa-exclamation-triangle text-red-400 mb-2" />
            <div className="text-red-300 text-sm mb-2">{error}</div>
            <button 
              onClick={retryAudio}
              className="text-xs text-red-400 hover:text-red-300 underline"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <audio 
              ref={audioRef}
              controls 
              preload="metadata"
              className="w-full h-8"
              playsInline
              controlsList="nodownload"
              onPlay={() => console.log('🎵 Audio started playing:', audioPath)}
              onPause={() => console.log('🎵 Audio paused')}
              onEnded={() => console.log('🎵 Audio ended')}
              onVolumeChange={(e) => console.log('🎵 Volume changed:', (e.target as HTMLAudioElement).volume)}
              onLoadedData={() => console.log('🎵 Audio data loaded')}
              style={{
                background: 'transparent',
                borderRadius: '6px'
              }}
            >
              <source src={audioPath} type="audio/webm" />
              <source src={audioPath} type="audio/mp4" />
              <source src={audioPath} type="audio/wav" />
              <source src={audioPath} type="audio/ogg" />
              Your browser does not support audio playback.
            </audio>
          </div>
        )}
      </div>
    </div>
  )
}

function LongPressActionable({ 
  children, 
  onDelete, 
  onReact, 
  onReply, 
  onCopy, 
  onEdit, 
  disabled 
}: { 
  children: React.ReactNode
  onDelete: () => void
  onReact: (emoji:string)=>void
  onReply: ()=>void
  onCopy: ()=>void
  onEdit?: ()=>void
  disabled?: boolean
}){
  const [showMenu, setShowMenu] = useState(false)
  const [isPressed, setIsPressed] = useState(false)
  const timerRef = useRef<any>(null)
  
  function handleStart(e?: any){
    if (disabled) return
    try{ e && e.preventDefault && e.preventDefault() }catch{}
    setIsPressed(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setShowMenu(true)
      setIsPressed(false)
    }, 500) // 500ms for better UX
  }
  
  function handleEnd(){
    if (disabled) return
    setIsPressed(false)
    if (timerRef.current) clearTimeout(timerRef.current)
  }
  
  return (
    <div className="relative" style={{ userSelect: disabled ? 'text' : 'none', WebkitUserSelect: disabled ? 'text' : 'none', WebkitTouchCallout: 'none' as any }}>
      <div
        className={`transition-opacity ${!disabled && isPressed ? 'opacity-70' : 'opacity-100'}`}
        onMouseDown={disabled ? undefined : handleStart}
        onMouseUp={disabled ? undefined : handleEnd}
        onMouseLeave={disabled ? undefined : handleEnd}
        onTouchStart={disabled ? undefined : handleStart}
        onTouchEnd={disabled ? undefined : handleEnd}
        onContextMenu={(e) => {
          if (disabled) return
          e.preventDefault()
          setShowMenu(true)
        }}
        title="Hold for options or right-click"
      >
        {children}
      </div>
      {!disabled && showMenu && (
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
              {onEdit && <button className="text-left px-2 py-1 text-sm hover:bg-white/5" onClick={()=> { setShowMenu(false); onEdit() }}>Edit</button>}
              <button className="text-left px-2 py-1 text-sm text-red-400 hover:bg-white/5" onClick={()=> { setShowMenu(false); onDelete() }}>Delete</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}