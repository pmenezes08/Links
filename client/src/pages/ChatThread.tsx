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
}

export default function ChatThread(){
  const { setTitle } = useHeader()
  const { username } = useParams()
  const navigate = useNavigate()
  useEffect(() => { setTitle(username ? `Chat: ${username}` : 'Chat') }, [setTitle, username])

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
  const [recordLocked, setRecordLocked] = useState(false)
  const gestureStartYRef = useRef<number|null>(null)
  const audioCtxRef = useRef<AudioContext|null>(null)
  const analyserRef = useRef<AnalyserNode|null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode|null>(null)
  const visRafRef = useRef<number| null>(null)
  const visualizerCanvasRef = useRef<HTMLCanvasElement|null>(null)
  const [previewImage, setPreviewImage] = useState<string|null>(null)
  const [recordingPreview, setRecordingPreview] = useState<{ blob: Blob; url: string; duration: number } | null>(null)
  const lastFetchTime = useRef<number>(0)
  const pendingDeletions = useRef<Set<number|string>>(new Set())

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
                isOptimistic: false 
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
    setTimeout(poll, 500)
    
    // Poll every 3 seconds (slightly less aggressive)
    pollTimer.current = setInterval(poll, 3000)
    
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
        // Message sent successfully - the polling will pick up the real message
        // Stop typing indicator
        fetch('/api/typing', { 
          method:'POST', 
          credentials:'include', 
          headers:{ 'Content-Type':'application/json' }, 
          body: JSON.stringify({ peer: username, is_typing: false }) 
        }).catch(()=>{})
      } else {
        // If sending failed, remove the optimistic message
        setMessages(prev => prev.filter(m => m.id !== tempId))
        setDraft(messageText) // Restore the draft
        alert('Failed to send message. Please try again.')
      }
    })
    .catch(()=>{
      // Network error - remove optimistic message and restore draft
      setMessages(prev => prev.filter(m => m.id !== tempId))
      setDraft(messageText)
      alert('Network error. Please check your connection and try again.')
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

  function startVisualizer(stream: MediaStream){
    try{
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      audioCtxRef.current = ctx
      analyserRef.current = analyser
      sourceRef.current = source
      const canvas = visualizerCanvasRef.current
      if (!canvas) return
      const c2d = canvas.getContext('2d')
      if (!c2d) return
      const bufferLength = analyser.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)
      const draw = () => {
        if (!analyserRef.current || !canvas) return
        analyserRef.current.getByteTimeDomainData(dataArray)
        c2d.clearRect(0,0,canvas.width,canvas.height)
        c2d.fillStyle = '#0b0f10'
        c2d.fillRect(0,0,canvas.width,canvas.height)
        c2d.strokeStyle = '#4db6ac'
        c2d.lineWidth = 2
        c2d.beginPath()
        const sliceWidth = canvas.width / bufferLength
        let x = 0
        for (let i=0;i<bufferLength;i++){
          const v = dataArray[i] / 128.0
          const y = (v * canvas.height) / 2
          if (i === 0) c2d.moveTo(x, y)
          else c2d.lineTo(x, y)
          x += sliceWidth
        }
        c2d.lineTo(canvas.width, canvas.height/2)
        c2d.stroke()
        visRafRef.current = requestAnimationFrame(draw)
      }
      visRafRef.current = requestAnimationFrame(draw)
    }catch{}
  }

  async function startRecording(){
    try{
      console.log('🎤 Starting recording...')
      
      // Check browser support
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Voice messages are not supported in this browser. Please use a modern browser like Chrome, Firefox, or Safari.')
        return
      }
      
      if (!('MediaRecorder' in window)){
        alert('Voice recording is not supported in this browser.')
        audioInputRef.current?.click()
        return
      }
      
      // Request microphone permission
      console.log('🎤 Requesting microphone permission...')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      console.log('🎤 Microphone permission granted, starting recorder...')
      
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        console.log('🎤 Recording stopped, processing audio...')
        try{
          const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
          console.log('🎤 Audio blob created, size:', blob.size)
          
          // Don't auto-send, show preview instead
          if (blob.size > 0) {
            const url = URL.createObjectURL(blob)
            setRecordingPreview({ blob, url, duration: Math.round(recordMs/1000) })
          }
        } finally {
          setRecording(false)
          setRecorder(null)
          setRecordMs(0)
          setRecordLocked(false)
          try{ stream.getTracks().forEach(t=> t.stop()) }catch{}
          if (recordTimerRef.current) clearInterval(recordTimerRef.current)
          if (visRafRef.current) cancelAnimationFrame(visRafRef.current)
          try{ analyserRef.current && analyserRef.current.disconnect() }catch{}
          try{ sourceRef.current && sourceRef.current.disconnect() }catch{}
          try{ audioCtxRef.current && audioCtxRef.current.close() }catch{}
          analyserRef.current = null; sourceRef.current = null; audioCtxRef.current = null
        }
      }
      mr.start()
      setRecorder(mr)
      setRecording(true)
      recordStartRef.current = Date.now()
      setRecordMs(0)
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      recordTimerRef.current = setInterval(()=> setRecordMs(Date.now() - recordStartRef.current), 200)
      setTimeout(()=> { try{ mr.state !== 'inactive' && mr.stop() }catch{} }, 60000)
      // Start visualizer
      startVisualizer(stream)
      console.log('🎤 Recording started successfully')
    }catch(err){
      console.error('🎤 Recording error:', err)
      const error = err as Error
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        alert('Microphone permission was denied. Please allow microphone access in your browser settings to send voice messages.')
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        alert('No microphone found. Please connect a microphone to send voice messages.')
      } else {
        alert('Could not access microphone: ' + error.message)
      }
    }
  }

  function stopRecording(){ 
    console.log('🎤 Stopping recording and sending...')
    try{ recorder && recorder.state !== 'inactive' && recorder.stop() }catch{} 
  }
  
  function cancelRecording(){
    console.log('🎤 Canceling recording...')
    try{
      // Clear chunks before stopping to prevent upload
      chunksRef.current = []
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop()
      }
      setRecording(false)
      setRecorder(null)
      setRecordMs(0)
      setRecordLocked(false)
    }catch{}
  }
  
  function sendRecordingPreview(){
    if (!recordingPreview) return
    uploadAudioBlob(recordingPreview.blob)
    setRecordingPreview(null)
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

  function onMicPointerDown(e: React.MouseEvent | React.TouchEvent){
    console.log('🎤 Mic button pressed')
    try{ e.preventDefault() }catch{}
    
    // Prevent accidental recordings during other interactions
    if (recording) return
    
    setRecordLocked(false)
    const y = 'touches' in e ? (e as React.TouchEvent).touches[0]?.clientY : (e as React.MouseEvent).clientY
    gestureStartYRef.current = y || 0
    
    // Add small delay to distinguish between tap and hold
    setTimeout(() => {
      if (gestureStartYRef.current !== null) {
        startRecording()
      }
    }, 100)
  }
  
  function onMicPointerMove(e: React.TouchEvent){
    if (!recording || recordLocked) return
    const startY = gestureStartYRef.current
    if (startY == null) return
    const curY = e.touches?.[0]?.clientY || startY
    const dy = curY - startY
    if (dy < -40){ 
      setRecordLocked(true)
      console.log('🎤 Recording locked by gesture')
    }
  }
  
  function onMicPointerUp(){ 
    console.log('🎤 Mic button released, recording:', recording, 'locked:', recordLocked)
    
    // Clear gesture start to prevent delayed recording start
    gestureStartYRef.current = null
    
    // Only stop recording if it's active and not locked
    if (recording && !recordLocked) {
      console.log('🎤 Stopping recording (not locked)')
      stopRecording() 
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
                        <div className="mb-2">
                          <audio controls preload="none" src={m.audio_path.startsWith('blob:') ? m.audio_path : `/uploads/${m.audio_path}`} className="w-full" />
                          {typeof m.audio_duration_seconds === 'number' ? (
                            <div className="text-[11px] text-white/60 mt-1">{Math.max(0, m.audio_duration_seconds)}s</div>
                          ) : null}
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
                      
                      {/* Text content with linkification */}
                      {m.text && (
                        <div>
                          {linkifyText(m.text)}
                        </div>
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
          
          {/* Message input container */}
          <div className="flex-1 flex items-center bg-[#1a1a1a] rounded-3xl border border-white/20 overflow-hidden relative">
            {/* Recording sound bar - replaces text input during recording */}
            {recording && (
              <div className="flex-1 flex items-center px-4 py-2.5 gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <span className="inline-block w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                  <div className="flex-1 h-8 bg-black/50 rounded-full flex items-center px-3 gap-1 relative overflow-hidden">
                    {/* Sound bars animation */}
                    {Array.from({length: 20}).map((_, i) => (
                      <div 
                        key={i}
                        className="flex-1 bg-gradient-to-t from-[#4db6ac] to-[#66d9c2] rounded-full transition-all duration-150 animate-pulse"
                        style={{
                          height: `${4 + Math.sin((Date.now() / 200 + i * 0.5)) * 12 + Math.random() * 8}px`,
                          opacity: 0.4 + Math.sin((Date.now() / 300 + i * 0.3)) * 0.3 + 0.3,
                          animationDelay: `${i * 30}ms`,
                          animationDuration: `${800 + Math.random() * 400}ms`
                        }}
                      />
                    ))}
                    {/* Animated wave effect */}
                    <div 
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-[#4db6ac]/20 to-transparent"
                      style={{
                        animation: 'wave 2s ease-in-out infinite',
                        transform: 'translateX(-100%)'
                      }}
                    />
                  </div>
                  <span className="text-sm text-white font-mono min-w-[50px]">
                    {new Date(recordMs).toISOString().substr(14,5)}
                  </span>
                </div>
              </div>
            )}
            
            {/* Regular text input - hidden during recording */}
            {!recording && (
              <textarea
                ref={textareaRef}
                rows={1}
                className="flex-1 bg-transparent px-4 py-2.5 text-[16px] text-white placeholder-white/50 outline-none resize-none max-h-24 min-h-[36px]"
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
            
            {/* Recording UI */}
            {recording && recordLocked && (
              <div className="absolute left-2 -top-10 flex items-center gap-2 bg-black/90 px-3 py-2 rounded-full border border-white/20">
                <span className="inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-sm text-white font-mono">{new Date(recordMs).toISOString().substr(14,5)}</span>
                <button 
                  className="ml-2 w-6 h-6 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors"
                  onClick={cancelRecording}
                  title="Cancel recording"
                >
                  <i className="fa-solid fa-trash text-white text-[10px]" />
                </button>
                <button 
                  className="ml-1 w-6 h-6 rounded-full bg-[#4db6ac] hover:bg-[#45a99c] flex items-center justify-center transition-colors"
                  onClick={()=>{ try{ recorder && recorder.state!=='inactive' && recorder.stop() }catch{} }}
                  title="Send voice message"
                >
                  <i className="fa-solid fa-paper-plane text-white text-[10px]" />
                </button>
              </div>
            )}
            {recording && !recordLocked && (
              <div className="absolute left-2 -top-10 flex items-center gap-2 bg-black/90 px-3 py-2 rounded-full border border-white/20 animate-pulse">
                <span className="inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-sm text-white font-mono">{new Date(recordMs).toISOString().substr(14,5)}</span>
                <i className="fa-solid fa-arrow-up ml-2 text-white/70 text-xs animate-bounce" />
                <span className="text-xs text-white/70">Slide up to lock</span>
              </div>
            )}
            {/* Mic + Send */}
            <div className="absolute right-1 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
              <button
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-150 ease-out ${
                  (recording||recordLocked) 
                    ? 'bg-red-600 text-white scale-110 shadow-lg shadow-red-500/50 animate-pulse' 
                    : 'bg-[#4db6ac] text-white hover:bg-[#45a99c] hover:scale-110 active:scale-95 shadow-md'
                }`}
                onMouseDown={onMicPointerDown as any}
                onMouseUp={onMicPointerUp}
                onMouseLeave={onMicPointerUp}
                onTouchStart={onMicPointerDown as any}
                onTouchMove={onMicPointerMove}
                onTouchEnd={onMicPointerUp}
                aria-label="Voice message"
                title={recording ? "Recording... Release to stop" : "Hold to record voice message"}
                style={{
                  touchAction: 'manipulation',
                  WebkitTapHighlightColor: 'transparent',
                  userSelect: 'none'
                }}
              >
                <i className={`fa-solid ${
                  (recording||recordLocked) ? 'fa-microphone' : 'fa-microphone'
                } text-xs`} />
              </button>
              <button
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 ease-out ${
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
                  <i className="fa-solid fa-spinner fa-spin text-xs" />
                ) : (
                  <i className="fa-solid fa-paper-plane text-xs" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

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

function LongPressActionable({ 
  children, 
  onDelete, 
  onReact, 
  onReply, 
  onCopy 
}: { 
  children: React.ReactNode
  onDelete: () => void
  onReact: (emoji:string)=>void
  onReply: ()=>void
  onCopy: ()=>void
}){
  const [showMenu, setShowMenu] = useState(false)
  const [isPressed, setIsPressed] = useState(false)
  const timerRef = useRef<any>(null)
  
  function handleStart(e?: any){
    try{ e && e.preventDefault && e.preventDefault() }catch{}
    setIsPressed(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setShowMenu(true)
      setIsPressed(false)
    }, 500) // 500ms for better UX
  }
  
  function handleEnd(){
    setIsPressed(false)
    if (timerRef.current) clearTimeout(timerRef.current)
  }
  
  return (
    <div className="relative select-none" style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' as any }}>
      <div
        className={`transition-opacity ${isPressed ? 'opacity-70' : 'opacity-100'}`}
        onMouseDown={handleStart}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={handleStart}
        onTouchEnd={handleEnd}
        onContextMenu={(e) => {
          e.preventDefault()
          setShowMenu(true)
        }}
        title="Hold for options or right-click"
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