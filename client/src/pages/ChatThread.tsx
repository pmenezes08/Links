import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useAudioRecorder } from '../components/useAudioRecorder'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'
import MessageImage from '../components/MessageImage'
import ZoomableImage from '../components/ZoomableImage'
import { encryptionService } from '../services/simpleEncryption'
import GifPicker from '../components/GifPicker'
import type { GifSelection } from '../components/GifPicker'
import { gifSelectionToFile } from '../utils/gif'

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
  clientKey?: string | number
  is_encrypted?: boolean
  encrypted_body?: string // Encrypted for recipient
  encrypted_body_for_sender?: string // Encrypted for sender
  decryption_error?: boolean
}

export default function ChatThread(){
  const { setTitle } = useHeader()
  const { username } = useParams()
  const navigate = useNavigate()
  const profilePath = username ? `/profile/${encodeURIComponent(username)}` : null
  useEffect(() => { setTitle(username ? `Chat: ${username}` : 'Chat') }, [setTitle, username])

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      const ua = navigator.userAgent || ''
      const isiOSMatch = /iPad|iPhone|iPod/i.test(ua) ||
        ((navigator.platform === 'MacIntel' || navigator.platform === 'Macintosh') && (navigator.maxTouchPoints || 0) > 2)
      const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
                            (navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && /MacIntel/.test(navigator.platform))
      setIsMobile(Boolean(isMobileDevice))
      setIsIOS(Boolean(isiOSMatch))
    }
    checkMobile()
  }, [])

  // (wave animation CSS no longer required for unified recorder)

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
  const [gifPickerOpen, setGifPickerOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement|null>(null)
  const cameraInputRef = useRef<HTMLInputElement|null>(null)
  const audioInputRef = useRef<HTMLInputElement|null>(null)
  const { recording, recordMs, preview: recordingPreview, start: startVoiceRecording, stop: stopVoiceRecording, clearPreview: cancelRecordingPreview, level } = useAudioRecorder() as any
  const [previewImage, setPreviewImage] = useState<string|null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [showMicPermissionModal, setShowMicPermissionModal] = useState(false)
  const [showPermissionGuide, setShowPermissionGuide] = useState(false)
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const lastFetchTime = useRef<number>(0)
  const [pastedImage, setPastedImage] = useState<File | null>(null)
  const pendingDeletions = useRef<Set<number|string>>(new Set())
  const headerMenuRef = useRef<HTMLDivElement | null>(null)
  // Bridge between temp ids and server ids to avoid flicker and keep stable keys
  const idBridgeRef = useRef<{ tempToServer: Map<string, string|number>; serverToTemp: Map<string|number, string> }>({
    tempToServer: new Map(),
    serverToTemp: new Map(),
  })
  // Track recently sent optimistic messages to prevent poll from removing them
  const recentOptimisticRef = useRef<Map<string, { message: Message; timestamp: number }>>(new Map())
  // Pause polling briefly after sending to avoid race condition with server confirmation
  const skipNextPollsUntil = useRef<number>(0)

  const viewportStyles = useMemo<CSSProperties>(() => {
    const positionStyles = isIOS
      ? { position: 'relative' as const, overflow: 'visible' as const }
      : { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0 }
    return {
      height: '100dvh',
      minHeight: '100dvh',
      maxHeight: '100dvh',
      paddingTop: 'calc(3.5rem + env(safe-area-inset-top, 0px))',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      ...positionStyles,
    }
  }, [isIOS])

  useEffect(() => {
    if (!headerMenuOpen) return
    const handleDocumentClick = (event: globalThis.PointerEvent) => {
      if (!headerMenuRef.current) return
      if (!headerMenuRef.current.contains(event.target as Node)) {
        setHeaderMenuOpen(false)
      }
    }
    const handleDocumentKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHeaderMenuOpen(false)
      }
    }
    const captureOptions: AddEventListenerOptions = { capture: true }
    document.addEventListener('pointerdown', handleDocumentClick, captureOptions)
    document.addEventListener('keydown', handleDocumentKey)
    return () => {
      document.removeEventListener('pointerdown', handleDocumentClick, captureOptions)
      document.removeEventListener('keydown', handleDocumentKey)
    }
  }, [headerMenuOpen])

  // Mic always enabled for audio messages
  const MIC_ENABLED = true
  
  // E2E Encryption is initialized globally in App.tsx, so it's always ready

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

  // Track messages that have been processed (don't decrypt multiple times)
  const decryptionCache = useRef<Map<number | string, { text: string; error: boolean }>>(new Map())

  // Decrypt message if it's encrypted
  async function decryptMessageIfNeeded(message: any): Promise<any> {
    if (!message.is_encrypted) {
      return message
    }
    
    // Check cache first - don't decrypt the same message multiple times!
    const cached = decryptionCache.current.get(message.id)
    if (cached) {
      return {
        ...message,
        text: cached.text,
        decryption_error: cached.error,
      }
    }
    
    // TRUE E2E ENCRYPTION:
    // - Sent messages: decrypt encrypted_body_for_sender (encrypted with YOUR public key)
    // - Received messages: decrypt encrypted_body (encrypted with YOUR public key)
    
    let encryptedData: string | null = null
    
    if (message.sent) {
      // You sent this - decrypt the copy encrypted for you
      encryptedData = message.encrypted_body_for_sender
      if (!encryptedData) {
        // Backward compatibility: old messages might have plaintext
        if (message.text && message.text.trim()) {
          return { ...message, decryption_error: false }
        }
        return {
          ...message,
          text: '[🔒 Encrypted message - missing sender copy]',
          decryption_error: true,
        }
      }
    } else {
      // You received this - decrypt the copy encrypted for you
      encryptedData = message.encrypted_body
      if (!encryptedData) {
        return {
          ...message,
          text: '[🔒 Encrypted message - missing data]',
          decryption_error: true,
        }
      }
    }
    
    try {
      const decryptedText = await encryptionService.decryptMessage(encryptedData)
      
      // Cache the decrypted text
      decryptionCache.current.set(message.id, { text: decryptedText, error: false })
      
      return {
        ...message,
        text: decryptedText,
        decryption_error: false,
      }
    } catch (error) {
      console.error('🔐 ❌ Failed to decrypt message:', message.id, error)
      
      // Cache the failure
      decryptionCache.current.set(message.id, { text: '[🔒 Encrypted - decryption failed]', error: true })
      
      return {
        ...message,
        text: '[🔒 Encrypted - decryption failed]',
        decryption_error: true,
      }
    }
  }

  // Encryption is initialized globally in App.tsx - no need for per-chat init

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
        .then(async (j) => {
          if (j?.success && Array.isArray(j.messages)) {
            // Decrypt encrypted messages first
            const decryptedMessages = await Promise.all(
              j.messages.map(async (m: any) => await decryptMessageIfNeeded(m))
            )
            
            const processedMessages = decryptedMessages.map((m:any) => {
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
          .then(r => r.json())
          .then(j => {
            if (j?.success) {
              setOtherProfile({ 
                display_name: j.display_name, 
                profile_picture: j.profile_picture || null 
              }) 
            }
          })
          .catch(()=>{})
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
      // Skip polling if we're waiting for server confirmation after sending
      if (Date.now() < skipNextPollsUntil.current) {
        return
      }
      
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
          // Decrypt encrypted messages before processing
          const decryptedMessages = await Promise.all(
            j.messages.map(async (m: any) => await decryptMessageIfNeeded(m))
          )
          
          setMessages(prev => {
            // Build map of existing messages by their stable key (clientKey or id)
            const messagesByKey = new Map()
            prev.forEach(m => {
              const key = String(m.clientKey || m.id)
              messagesByKey.set(key, m)
            })
            
            // CRITICAL: Add recent optimistic messages that might not be in prev yet
            // This handles React state batching race condition
            recentOptimisticRef.current.forEach((entry, key) => {
              if (!messagesByKey.has(key)) {
                messagesByKey.set(key, entry.message)
              }
            })
            
            // Process server messages (now decrypted)
            const serverMessageKeys = new Set()
            decryptedMessages.forEach((m: any) => {
              // Skip if pending deletion
              if (pendingDeletions.current.has(m.id)) return
              
              // Parse reply information from message text
              let messageText = m.text
              let replySnippet = undefined
              const replyMatch = messageText.match(/^\[REPLY:([^:]+):([^\]]+)\]\n(.*)$/s)
              if (replyMatch) {
                replySnippet = replyMatch[2]
                messageText = replyMatch[3]
              }
              
              const k = `${m.time}|${messageText}|${m.sent ? 'me' : 'other'}`
              const meta = metaRef.current[k] || {}
              
              // Determine 'sent' strictly from server sender match
              const isSentByMe = m.sender === undefined ? (m.sent === true) : (m.sender === username)
              
              // Check if we have a bridge mapping or matching optimistic message
              let stableKey = idBridgeRef.current.serverToTemp.get(m.id)
              
              if (!stableKey) {
                // Try to find matching optimistic by content
                for (const [key, existing] of messagesByKey.entries()) {
                  if (!existing.isOptimistic) continue
                  if (existing.sent !== isSentByMe) continue
                  if (existing.text !== messageText) continue
                  const timeDiff = Math.abs(new Date(m.time).getTime() - new Date(existing.time).getTime())
                  if (timeDiff < 5000) {
                    stableKey = key
                    // Set up bridge for future
                    idBridgeRef.current.serverToTemp.set(m.id, key)
                    idBridgeRef.current.tempToServer.set(key, m.id)
                    break
                  }
                }
              }
              
              // Use stable key if found, otherwise use server id
              const finalKey = stableKey || String(m.id)
              serverMessageKeys.add(finalKey)
              
              // Get existing message to preserve local state
              const existing = messagesByKey.get(finalKey)
              
              // Update or create message
              messagesByKey.set(finalKey, {
                id: m.id, // Use server ID now
                text: messageText,
                image_path: m.image_path,
                audio_path: m.audio_path,
                audio_duration_seconds: m.audio_duration_seconds,
                sent: isSentByMe,
                time: m.time,
                reaction: existing?.reaction ?? meta.reaction,
                replySnippet: replySnippet || existing?.replySnippet || meta.replySnippet,
                isOptimistic: false, // No longer optimistic
                edited_at: m.edited_at || null,
                clientKey: finalKey, // Keep stable key
                // CRITICAL: Include encryption fields from server!
                is_encrypted: m.is_encrypted,
                encrypted_body: m.encrypted_body,
                encrypted_body_for_sender: m.encrypted_body_for_sender,
                decryption_error: m.decryption_error
              })
            })
            
            // Clean up very old UNCONFIRMED optimistic messages (30s timeout)
            // CRITICAL: Never remove confirmed messages (isOptimistic=false) even if server doesn't return them
            // This handles server-side caching where newly sent messages don't appear in polls immediately
            const now = Date.now()
            for (const [key, msg] of messagesByKey.entries()) {
              if (msg.isOptimistic) {
                const age = now - new Date(msg.time).getTime()
                if (age > 30000) {
                  messagesByKey.delete(key)
                }
              }
              // Never remove confirmed messages (isOptimistic=false), even if not in latest server response
              // The server confirmed it exists via send response, so trust that over stale poll data
            }
            
            // Convert map to array and sort
            const allMessages = Array.from(messagesByKey.values())
            
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
    
    // Poll for updates, but not too aggressively to avoid race conditions
    pollTimer.current = setInterval(poll, 2500)
    
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

  async function send(){
    if (!otherUserId || !draft.trim() || sending) return
    
    const messageText = draft.trim()
    
    try {
      // Pause polling for 2 seconds to avoid race condition with server confirmation
      skipNextPollsUntil.current = Date.now() + 2000
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
      
      // Try to encrypt message TWICE (for recipient AND sender)
      let isEncrypted = false
      let encryptedBodyForRecipient = ''
      let encryptedBodyForSender = ''
      
      if (username) {
        try {
          // Encrypt for recipient with 3 second timeout
          const encryptForRecipientPromise = encryptionService.encryptMessage(username, formattedMessage)
          const timeoutPromise1 = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Encryption timeout (recipient)')), 3000)
          )
          encryptedBodyForRecipient = await Promise.race([encryptForRecipientPromise, timeoutPromise1])
          
          // Encrypt for sender (yourself) with 3 second timeout
          const encryptForSenderPromise = encryptionService.encryptMessageForSender(formattedMessage)
          const timeoutPromise2 = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Encryption timeout (sender)')), 3000)
          )
          encryptedBodyForSender = await Promise.race([encryptForSenderPromise, timeoutPromise2])
          
          isEncrypted = true
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          console.warn('🔐 ⚠️ Encryption failed, sending unencrypted:', errorMsg)
          // Continue with unencrypted - this is perfectly fine!
        }
      }
      
      // Create optimistic message WITH encryption flags
      const optimisticMessage: Message = { 
        id: tempId, 
        text: formattedMessage, 
        sent: true, 
        time: now, 
        replySnippet,
        isOptimistic: true,
        is_encrypted: isEncrypted,
        encrypted_body: isEncrypted ? encryptedBodyForRecipient : undefined,
        encrypted_body_for_sender: isEncrypted ? encryptedBodyForSender : undefined
      }
      
      // Clear input immediately for better UX
      setDraft('')
      setReplyTo(null)
      setSending(true)
      
      // Add optimistic message immediately
      const optimisticWithKey = { ...optimisticMessage, clientKey: tempId }
      setMessages(prev => [...prev, optimisticWithKey])
      
      // Register in recent optimistic to prevent poll from removing it due to stale state
      recentOptimisticRef.current.set(tempId, {
        message: optimisticWithKey,
        timestamp: Date.now()
      })
      
      // Force scroll to bottom for sent messages
      setTimeout(scrollToBottom, 50)
      
      // Store reply snippet in metadata if needed
      if (replySnippet){
        const k = `${now}|${messageText}|me`
        metaRef.current[k] = { ...(metaRef.current[k]||{}), replySnippet }
        try{ localStorage.setItem(storageKey, JSON.stringify(metaRef.current)) }catch{}
      }
      
      // Send to server
      const fd = new URLSearchParams({ recipient_id: String(otherUserId) })
      
      if (isEncrypted) {
        fd.append('message', '') // NO plaintext stored!
        fd.append('is_encrypted', '1')
        fd.append('encrypted_body', encryptedBodyForRecipient) // Encrypted for recipient
        fd.append('encrypted_body_for_sender', encryptedBodyForSender) // Encrypted for sender
      } else {
        fd.append('message', formattedMessage)
      }
      
      fetch('/send_message', { 
        method:'POST', 
        credentials:'include', 
        headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, 
        body: fd 
      })
        .then(r => r.json())
        .then(j => {
          if (j?.success) {
            // Stop typing indicator
            fetch('/api/typing', { 
              method:'POST', 
              credentials:'include', 
              headers:{ 'Content-Type':'application/json' }, 
              body: JSON.stringify({ peer: username, is_typing: false }) 
            }).catch(()=>{})
            
            // CRITICAL: Update optimistic message immediately with server confirmation
            if (j.message_id) {
              // Set up bridge mapping
              idBridgeRef.current.tempToServer.set(tempId, j.message_id)
              idBridgeRef.current.serverToTemp.set(j.message_id, tempId)
              
              // Immediately update the optimistic message to be confirmed
              // Keep the same clientKey (tempId) so React doesn't remount
              // PRESERVE encryption flags!
              setMessages(prev => prev.map(m => {
                if ((m.clientKey || m.id) === tempId) {
                  return {
                    ...m,
                    id: j.message_id, // Update to server ID
                    isOptimistic: false, // No longer optimistic
                    time: j.time || m.time, // Use server time if available
                    clientKey: tempId, // Keep stable key for React
                    // Keep encryption flags from optimistic message
                    is_encrypted: m.is_encrypted,
                    encrypted_body: m.encrypted_body,
                    encrypted_body_for_sender: m.encrypted_body_for_sender
                  }
                }
                return m
              }))
              
              // Clean up ref
              setTimeout(() => recentOptimisticRef.current.delete(tempId), 1000)
            }
          } else {
            console.error('Send failed:', j?.error)
            // Keep optimistic message, restore draft for retry
            setDraft(messageText)
          }
        })
        .catch(err => {
          console.error('Send error:', err)
          // Keep optimistic message, restore draft for retry
          setDraft(messageText)
        })
        .finally(() => setSending(false))
    } catch (error) {
      console.error('❌ Send function error:', error)
      setSending(false)
      // Restore draft on error
      setDraft(messageText)
    }
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
    handleImageFile(file)
  }

  async function handleGifSelection(gif: GifSelection) {
    if (!otherUserId) return
    try {
      const file = await gifSelectionToFile(gif, 'chat-gif')
      handleImageFile(file, 'gif')
    } catch (err) {
      console.error('Failed to prepare GIF for chat', err)
      alert('Unable to attach GIF. Please try again.')
    }
  }

function handleImageFile(file: File, kind: 'photo' | 'gif' = 'photo') {
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

        const photoMessage: Message = {
          id: j.id || `photo_${Date.now()}`,
          text: kind === 'gif' ? '🎞️ GIF' : '📷 Photo',
          image_path: j.image_path,
          sent: true,
          time: now,
          isOptimistic: false
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
    .finally(() => {
      setSending(false)
      setPastedImage(null)
      // Clear the input so user can select the same file again
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (cameraInputRef.current) cameraInputRef.current.value = ''
    })
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    // Try the modern Clipboard API first (works on native apps and desktop)
    if (navigator.clipboard && navigator.clipboard.read) {
      try {
        const clipboardItems = await navigator.clipboard.read()

        for (const clipboardItem of clipboardItems) {
          for (const type of clipboardItem.types) {
            if (type.startsWith('image/')) {
              event.preventDefault()
              const blob = await clipboardItem.getType(type)
              const file = new File([blob], `pasted-image.${type.split('/')[1]}`, { type })
              setPastedImage(file)
              setPreviewImage(URL.createObjectURL(file))
              return
            }
          }
        }
      } catch (error) {
        // Fall back to legacy method
      }
    }

    // Fallback to legacy clipboardData method (limited support)
    const items = event.clipboardData?.items
    if (!items) return

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.indexOf('image') !== -1) {
        event.preventDefault()
        const file = item.getAsFile()
        if (file) {
          setPastedImage(file)
          setPreviewImage(URL.createObjectURL(file))
        }
        break
      }
    }
  }

  async function uploadAudioBlob(blob: Blob){
    if (!otherUserId) return
    
    // Don't send if blob is empty (cancelled recording)
    if (!blob || blob.size === 0) {
      return
    }
    
    setSending(true)
    try{
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
        // Revoke blob URL on failure
        URL.revokeObjectURL(url)
        alert(j?.error || 'Failed to send audio')
      } else {
        // Revoke blob URL after successful upload to free memory
        setTimeout(() => URL.revokeObjectURL(url), 100)
      }
    }catch(err){
      alert('Failed to send audio')
    }finally{
      setSending(false)
    }
  }

  // startVisualizer removed; shared recorder handles visualizer internally

  // resetRecordingState utility not used currently (native fallback disabled)

  // Note: native audio capture fallback removed; using shared recorder
  
  
  function sendRecordingPreview(){
    if (!recordingPreview) return
    uploadAudioBlobWithDuration(recordingPreview.blob, (recordingPreview as any).duration || Math.round((recordMs||0)/1000))
    // CRITICAL iOS FIX: Add small delay before cleanup to ensure blob is sent
    setTimeout(() => {
      cancelRecordingPreview()
    }, 100)
  }
  
  async function uploadAudioBlobWithDuration(blob: Blob, durationSeconds: number){
    if (!otherUserId) return
    
    // Don't send if blob is empty (cancelled recording)
    if (!blob || blob.size === 0) {
      return
    }
    
    setSending(true)
    try{
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
      
      fd.append('audio', blob, filename)
      const r = await fetch('/send_audio_message', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (!j?.success){
        setMessages(prev => prev.filter(m => m.id !== optimistic.id))
        // Revoke blob URL on failure
        URL.revokeObjectURL(url)
        alert(j?.error || 'Failed to send audio message')
      } else {
        // Revoke blob URL after successful upload to free memory
        setTimeout(() => URL.revokeObjectURL(url), 100)
      }
    }catch(err){
      alert('Failed to send voice message: ' + (err as Error).message)
    } finally {
      setSending(false)
    }
  }
  
  // cancelRecordingPreview comes from shared hook

  function handleAudioFileChange(event: React.ChangeEvent<HTMLInputElement>){
    const file = event.target.files?.[0]
    if (!file) return
    uploadAudioBlob(file)
    event.target.value = ''
  }

  async function checkMicrophonePermission() {
    try {
      // Check current permission state
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName })
      
      if (permissionStatus.state === 'granted') {
        // Permission already granted, start recording directly
        startVoiceRecording()
      } else if (permissionStatus.state === 'denied') {
        // Permission denied, show help modal
        setShowMicPermissionModal(true)
      } else {
        // Permission not yet requested, show pre-permission modal
        setShowMicPermissionModal(true)
      }
    } catch (error) {
      // Fallback for browsers that don't support permissions API
      startVoiceRecording()
    }
  }

  function requestMicrophoneAccess() {
    setShowMicPermissionModal(false)
    // Start recording which will trigger the browser's permission dialog
    startVoiceRecording()
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
      style={viewportStyles}
    >
      {/* Chat header (fixed below global header for iOS focus stability) */}
      <div 
        className="h-14 border-b border-white/10 flex items-center gap-3 px-4 flex-shrink-0"
        style={{
          backgroundColor: 'rgb(0, 0, 0)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          zIndex: 10010,
          position: 'fixed',
          top: 'calc(56px + env(safe-area-inset-top, 0px))',
          left: 0,
          right: 0,
          minHeight: '3.5rem',
          maxHeight: '3.5rem'
        }}
      >
        <div className="max-w-3xl mx-auto w-full flex items-center gap-3 relative">
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
              linkToProfile
            />
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate text-white text-sm">
              {otherProfile?.display_name || username || 'Chat'}
            </div>
            {/* Online/typing label removed as requested */}
          </div>
          <button 
            type="button"
            className="p-2 rounded-full hover:bg-white/10 transition-colors" 
            aria-label="More options"
            aria-haspopup="true"
            aria-expanded={headerMenuOpen}
            onMouseDown={(event)=> event.stopPropagation()}
            onClick={(event)=> {
              event.stopPropagation()
              setHeaderMenuOpen(prev => !prev)
            }}
          >
            <i className="fa-solid fa-ellipsis-vertical text-white/70" />
          </button>
          {headerMenuOpen && (
            <div
              ref={headerMenuRef}
              className="absolute right-0 top-full mt-2 z-[10020] w-48"
              onMouseDown={(event)=> event.stopPropagation()}
              onClick={(event)=> event.stopPropagation()}
            >
              <div className="rounded-xl border border-white/10 bg-[#111111] shadow-lg shadow-black/40 py-1">
                <Link
                  to={profilePath || '/profile'}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/10 transition-colors"
                  onClick={() => setHeaderMenuOpen(false)}
                >
                  <i className="fa-solid fa-user text-xs text-[#4db6ac]" />
                  <span>View Profile</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Floating date indicator */}
      {currentDateLabel && showDateFloat && (
        <div 
          className="fixed left-1/2 z-50 pointer-events-none"
          style={{ 
            top: 'calc(7rem + env(safe-area-inset-top, 0px))',
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
          position: 'relative',
          WebkitOverflowScrolling: 'touch' as any, 
          overscrollBehavior: 'contain' as any,
          paddingTop: '56px',
          paddingBottom: isIOS ? '120px' : '8px'
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
            <div key={m.clientKey ?? m.id}>
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
                      
                      {/* Encryption indicator - BIGGER AND MORE VISIBLE */}
                      {m.is_encrypted && !m.decryption_error && (
                        <div className="flex items-center gap-1.5 mb-2 text-[11px] text-[#4db6ac]">
                          <i className="fa-solid fa-lock text-[10px]" />
                          <span className="font-medium">End-to-end encrypted</span>
                        </div>
                      )}
                      
                      {/* Decryption error indicator */}
                      {m.decryption_error && (
                        <div className="flex items-center gap-1.5 mb-2 text-[11px] text-red-400">
                          <i className="fa-solid fa-triangle-exclamation text-[10px]" />
                          <span className="font-medium">Decryption failed</span>
                        </div>
                      )}
                      
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
            className="absolute right-4 bottom-4 z-50 w-10 h-10 rounded-full bg-[#4db6ac] text-black shadow-lg border border-[#4db6ac] hover:brightness-110 flex items-center justify-center"
            onClick={() => { scrollToBottom(); setShowScrollDown(false) }}
            aria-label="Scroll to latest"
          >
            <i className="fa-solid fa-arrow-down" />
          </button>
        )}
      </div>

      {/* DEBUG: Full screen red overlay to test if ANYTHING renders */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: '200px',
          backgroundColor: 'red',
          zIndex: 99999,
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '24px',
          fontWeight: 'bold',
          color: 'white'
        }}
        onClick={() => console.log('🎯 RED OVERLAY CLICKED!')}
        onTouchStart={(e) => {
          console.log('🎯 RED OVERLAY TOUCHED!')
          console.log('Touch coords:', e.touches[0].clientX, e.touches[0].clientY)
        }}
      >
        TAP HERE - COMPOSE BAR TEST
      </div>
      
      {/* Composer - flex child at bottom */}
      <div 
        className="bg-blue-500 px-2 sm:px-3 pb-4 pt-3 border-t border-white/10 flex-shrink-0" 
        onClick={() => console.log('🎯 COMPOSER CONTAINER CLICKED!')}
        onTouchStart={(e) => {
          console.log('🎯 COMPOSER CONTAINER TOUCHED!')
          console.log('Touch coords:', e.touches[0].clientX, e.touches[0].clientY)
        }}
        style={{ 
          zIndex: 10000, 
          position: 'relative', 
          pointerEvents: 'auto',
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
          minHeight: '80px'
        }}
      >
        <div className="max-w-3xl mx-auto">
          {replyTo && (
            <div className="mb-2 px-3 py-2 bg-[#1a1a1a] rounded-lg border-l-4 border-[#4db6ac]">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] text-[#4db6ac] font-semibold">
                  Replying to {replyTo.sender === 'You' ? 'yourself' : (otherProfile?.display_name || username || 'User')}
                </div>
                <button 
                  className="text-white/50 hover:text-white/80 transition-colors p-1" 
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

          <div className="flex items-end gap-1.5 sm:gap-2">
            {/* Attachment button */}
            <button 
              className="w-9 h-9 sm:w-10 sm:h-10 flex-shrink-0 flex items-center justify-center rounded-full hover:bg-white/10 active:bg-white/20 transition-colors"
              onClick={() => {
                console.log('✅ Attachment button clicked!')
                setShowAttachMenu(!showAttachMenu)
              }}
              onTouchStart={() => console.log('✅ Attachment button touched!')}
              style={{
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              <i className={`fa-solid text-white/70 text-base sm:text-lg transition-transform duration-200 ${
                showAttachMenu ? 'fa-times rotate-90' : 'fa-plus'
              }`} />
            </button>

          {/* Attachment menu */}
          {showAttachMenu && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setShowAttachMenu(false)}
                style={{ 
                  pointerEvents: 'auto',
                  touchAction: 'manipulation'
                }}
              />
              <div 
                className="absolute bottom-12 left-0 z-50 bg-[#1a1a1a] border border-white/20 rounded-2xl shadow-xl overflow-hidden min-w-[180px]"
                style={{
                  touchAction: 'manipulation'
                }}
              >
                <button
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2.5 sm:gap-3 hover:bg-white/5 active:bg-white/10 transition-colors text-left"
                  onClick={handlePhotoSelect}
                >
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-image text-[#4db6ac] text-sm sm:text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-white font-medium text-sm sm:text-base">Photos</div>
                    <div className="text-white/60 text-[10px] sm:text-xs">Send from gallery</div>
                  </div>
                </button>
                <button
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2.5 sm:gap-3 hover:bg-white/5 active:bg-white/10 transition-colors text-left"
                  onClick={handleCameraOpen}
                >
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-camera text-[#4db6ac] text-sm sm:text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-white font-medium text-sm sm:text-base">Camera</div>
                    <div className="text-white/60 text-[10px] sm:text-xs">Take a photo</div>
                  </div>
                </button>
                <button
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2.5 sm:gap-3 hover:bg-white/5 active:bg-white/10 transition-colors text-left"
                  onClick={() => { setShowAttachMenu(false); setGifPickerOpen(true) }}
                >
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-images text-[#4db6ac] text-sm sm:text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-white font-medium text-sm sm:text-base">GIF</div>
                    <div className="text-white/60 text-[10px] sm:text-xs">Powered by GIPHY</div>
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
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*"
            capture
            onChange={handleAudioFileChange}
            className="hidden"
          />

          {/* Message input container */}
          <div 
            className="flex-1 flex items-center bg-[#1a1a1a] rounded-3xl border border-white/20 overflow-hidden relative"
            style={{
              minHeight: '48px',
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            {/* Recording sound bar - replaces text input during recording */}
            {MIC_ENABLED && recording && (
              <div className="flex-1 flex items-center px-4 py-2.5 gap-3 pr-16">
                <div className="flex items-center gap-3 flex-1">
                  <span className="inline-block w-2 h-2 bg-[#4db6ac] rounded-full animate-pulse" />
                  {/* Unified level bar (simple) */}
                  <div className="flex-1 h-2 bg-white/10 rounded overflow-hidden">
                    <div className="h-full bg-[#7fe7df] transition-all" style={{ width: `${Math.max(6, Math.min(96, (level||0)*100))}%` }} />
                  </div>
                  <div className="text-xs text-white/70 ml-2">
                    Recording...
                  </div>
                </div>
              </div>
            )}
            
            {/* Regular text input - hidden during recording */}
            {!(MIC_ENABLED && recording) && (
              <textarea
                ref={textareaRef}
                rows={1}
                className="flex-1 bg-transparent px-3 sm:px-4 pr-[70px] sm:pr-20 py-2.5 text-[16px] text-white placeholder-white/50 outline-none resize-none max-h-24 min-h-[40px]"
                placeholder="Message"
                value={draft}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="sentences"
                spellCheck="true"
                onPaste={handlePaste}
                onFocus={() => {
                  console.log('✅ Textarea focused!')
                }}
                onClick={(e) => {
                  console.log('✅ Textarea clicked!')
                  // iOS fix: ensure textarea gets focus on tap
                  e.currentTarget.focus()
                }}
                onTouchStart={(e) => {
                  console.log('✅ Textarea touch started!')
                  // iOS fix: ensure touch events are recognized
                  e.stopPropagation()
                }}
                onTouchEnd={() => {
                  console.log('✅ Textarea touch ended!')
                }}
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
                  msOverflowStyle: 'none',
                  WebkitUserSelect: 'text',
                  userSelect: 'text',
                  touchAction: 'manipulation',
                  pointerEvents: 'auto',
                  zIndex: 1
                }}
              />
            )}
            
            {/* Mic + Send - Conditional based on recording state */}
            <div 
              className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-2"
              style={{ 
                pointerEvents: 'auto',
                zIndex: 2,
                touchAction: 'manipulation'
              }}
            >
              {/* When recording: Show STOP + visualizer (consistent with posts) */}
              {MIC_ENABLED && recording ? (
                <button
                  className="w-9 h-9 rounded-full flex items-center justify-center bg-[#4db6ac] text-white"
                  onClick={stopVoiceRecording}
                  aria-label="Stop recording"
                  style={{
                    touchAction: 'manipulation',
                    WebkitTapHighlightColor: 'transparent'
                  }}
                >
                  <i className="fa-solid fa-stop text-sm" />
                </button>
              ) : (
                <>
                  {/* Send button */}
                  <button
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      sending 
                        ? 'bg-gray-600 text-gray-300' 
                        : draft.trim()
                          ? 'bg-[#4db6ac] text-black'
                          : 'bg-white/20 text-white/70'
                    }`}
                    onClick={draft.trim() ? send : undefined}
                    disabled={sending || !draft.trim()}
                    aria-label="Send"
                    style={{
                      touchAction: 'manipulation',
                      WebkitTapHighlightColor: 'transparent'
                    }}
                  >
                    {sending ? (
                      <i className="fa-solid fa-spinner fa-spin text-xs" />
                    ) : (
                      <i className="fa-solid fa-paper-plane text-xs" />
                    )}
                  </button>
                  
                  {/* Mic icon */}
                  {MIC_ENABLED && (
                  <button
                    className="w-9 h-9 flex items-center justify-center text-white/70"
                    onClick={() => {
                      console.log('✅ Microphone button clicked!')
                      checkMicrophonePermission()
                    }}
                    onTouchStart={() => console.log('✅ Microphone button touched!')}
                    aria-label="Start voice message"
                    style={{
                      touchAction: 'manipulation',
                      WebkitTapHighlightColor: 'transparent'
                    }}
                  >
                    <i className="fa-solid fa-microphone text-lg" />
                  </button>
                  )}
                </>
              )}
              {MIC_ENABLED && recording && (
                <div className="hidden sm:flex items-center gap-2 ml-2">
                  <div className="text-xs text-white/70 whitespace-nowrap">{Math.min(60, Math.round((recordMs||0)/1000))}s</div>
                  <div className="h-2 w-24 bg-white/10 rounded overflow-hidden">
                    <div className="h-full bg-[#4db6ac] transition-all" style={{ width: `${Math.min(100, ((recordMs||0)/600) )}%` }} />
                  </div>
                  <div className="h-6 w-16 bg-white/10 rounded items-center hidden md:flex">
                    <div className="h-2 bg-[#7fe7df] rounded transition-all" style={{ width: `${Math.max(6, Math.min(96, (level||0)*100))}%`, marginLeft: '2%' }} />
                  </div>
                </div>
              )}
            </div>
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
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && cancelRecordingPreview()}>
          <div className="w-[92%] max-w-[480px] rounded-2xl border border-white/10 bg-[#0b0b0b] p-4 shadow-[0_0_40px_rgba(77,182,172,0.12)]">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-white">Preview voice message</div>
              <button className="px-2 py-1 rounded-full border border-white/10 text-white/70 hover:text-white" onClick={cancelRecordingPreview} aria-label="Close">✕</button>
            </div>
            <div className="mb-3 text-sm text-white/70">Duration: {Math.min(60, (recordingPreview as any).duration || Math.round((recordMs||0)/1000))}s</div>
            <div className="mb-4">
              <audio controls src={recordingPreview.url} className="w-full" playsInline webkit-playsinline="true" />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={cancelRecordingPreview} className="px-2.5 py-1.5 rounded-lg border border-white/10 text-white/70 hover:bg-white/5 text-sm">
                <i className="fa-regular fa-trash-can mr-2" />Discard
              </button>
              <button onClick={sendRecordingPreview} className="px-3.5 py-1.5 rounded-lg bg-[#4db6ac] text-black hover:brightness-110 text-sm">
                <i className="fa-solid fa-paper-plane mr-2" />Send
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

          {/* Image container with zoom */}
          <div 
            className="flex-1 flex items-center justify-center p-2 md:p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full h-full" style={{ maxHeight: 'calc(100vh - 8rem)', touchAction: 'none' }}>
              <ZoomableImage
                src={previewImage}
                alt="Photo preview"
                className="w-full h-full"
                onRequestClose={() => setPreviewImage(null)}
              />
            </div>
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
            {pastedImage && (
              <>
                <button
                  onClick={() => {
                    // CRITICAL iOS FIX: Revoke blob URL before clearing
                    if (previewImage && previewImage.startsWith('blob:')) {
                      try {
                        URL.revokeObjectURL(previewImage)
                      } catch {}
                    }
                    setPreviewImage(null)
                    setPastedImage(null)
                  }}
                  className="px-3 py-2 rounded-lg border border-white/10 text-white/70 hover:bg-white/5 text-sm"
                >
                  <i className="fa-regular fa-trash-can mr-2" />
                  Discard
                </button>
                <button
                  onClick={() => {
                    if (pastedImage) {
                      handleImageFile(pastedImage)
                      setPreviewImage(null)
                    }
                  }}
                  className="px-3 py-2 rounded-lg bg-[#4db6ac] text-black hover:brightness-110 text-sm"
                >
                  <i className="fa-solid fa-paper-plane mr-2" />
                  Send
                </button>
              </>
            )}
          </div>
        </div>
      )}
      <GifPicker
        isOpen={gifPickerOpen}
        onClose={()=> setGifPickerOpen(false)}
        onSelect={async (gif) => {
          setGifPickerOpen(false)
          await handleGifSelection(gif)
        }}
      />
    </div>
  )
}

function AudioMessage({ message, audioPath }: { message: Message; audioPath: string }) {
  const [debugText, setDebugText] = useState<string>('')

  // Detect Safari browser
  const isSafari = typeof navigator !== 'undefined' &&
    /^((?!chrome|android).)*safari/i.test(navigator.userAgent)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)

  // Add cache-busting to prevent Safari caching issues
  const cacheBustedPath = useMemo(() => {
    if (!audioPath) return ''
    // Add timestamp only on first load and retries to bust cache
    const separator = audioPath.includes('?') ? '&' : '?'
    return `${audioPath}${separator}_cb=${Date.now()}_${retryCount}`
  }, [audioPath, retryCount])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    // CRITICAL iOS FIX: Force load on iOS to prevent stuck state
    try {
      audio.load()
    } catch (e) {
      console.error('🎵 Audio load error:', e)
    }
    setDebugText(`Mounted: ${message.id}`)

    const handleError = (e: Event) => {
      const target = e.target as HTMLAudioElement
      const errorCode = target.error?.code
      const errorMessage = target.error?.message
      console.error('🎵 Audio load error:', {
        audioPath: cacheBustedPath,
        errorCode,
        errorMessage,
        networkState: target.networkState,
        readyState: target.readyState
      })
      setDebugText(`Load error: ${errorCode || 'unknown'}`)
      setError('Could not load audio')
    }

    const handleCanPlay = () => {
      setDebugText(`Loaded OK: ${message.id}`)
      setError(null)
    }

    const handleLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration)
      }
    }

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
    }

    audio.addEventListener('error', handleError)
    audio.addEventListener('canplay', handleCanPlay)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('timeupdate', handleTimeUpdate)

    return () => {
      audio.removeEventListener('error', handleError)
      audio.removeEventListener('canplay', handleCanPlay)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
    }
  }, [cacheBustedPath, message.id])

  const togglePlay = async () => {
    if (!audioRef.current) return

    try {
      if (playing) {
        audioRef.current.pause()
        setPlaying(false)
        setDebugText(`Paused: ${message.id}`)
      } else {
        // Force reload if there was an error
        if (error) {
          audioRef.current.load()
          setError(null)
        }

        if (isSafari) {
          // Safari blocks autoplay completely - just try to play directly
          setDebugText(`Safari play attempt: ${message.id}`)
        } else {
          setDebugText(`Playing: ${message.id}`)
        }

        // Clear any previous error state for fresh attempt
        if (error === 'Tap play to enable audio') {
          setError(null)
          setDebugText(`Fresh play attempt: ${message.id}`)
        }

        await audioRef.current.play()

        // Check if we're actually playing after a short delay
        setTimeout(() => {
          if (audioRef.current && !audioRef.current.paused && audioRef.current.currentTime > 0) {
            setDebugText(`Audio working: ${message.id}`)
            setPlaying(true)
          } else {
            // Playback was blocked
            if (isSafari) {
              setDebugText(`Safari blocked audio: ${message.id}`)
            } else {
              setDebugText(`Playback blocked - tap red button: ${message.id}`)
            }
            setPlaying(false)
            setError('Tap play to enable audio')
          }
        }, isSafari ? 500 : 200) // Longer delay for Safari

        // Optimistically set playing state
        setPlaying(true)
      }
    } catch (err) {
      console.error('🎵 Playback error:', err, 'for:', cacheBustedPath)
      setDebugText(`Play failed: ${err instanceof Error ? err.message : 'Unknown'}`)

      // If autoplay failed, show appropriate message
      if (err instanceof Error && err.name === 'NotAllowedError') {
        if (isSafari) {
          setDebugText(`Safari requires user interaction: ${message.id}`)
          setError('Safari blocks audio - try a different browser')
        } else {
          setDebugText(`Tap play again to start: ${message.id}`)
          setError('Tap play to enable audio')
        }
      }
      setPlaying(false)
    }
  }
  
  const handleRetry = () => {
    setError(null)
    setRetryCount(prev => prev + 1)
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${String(secs).padStart(2, '0')}`
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="px-2 py-1">
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            error === 'Tap play to enable audio'
              ? isSafari
                ? 'bg-orange-500 hover:bg-orange-600 animate-pulse'
                : 'bg-red-500 hover:bg-red-600 animate-pulse'
              : 'bg-[#4db6ac] hover:bg-[#45a99c]'
          }`}
          disabled={false}
          title={isSafari ? 'Safari blocks audio autoplay - tap to play' : 'Play audio'}
        >
          <i className={`fa-solid ${playing ? 'fa-pause' : 'fa-play'} text-white text-xs`} />
        </button>
        <div className="flex-1">
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-white/50 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-white/60">
            <span>{playing && duration > 0 ? formatDuration(currentTime) : duration > 0 ? formatDuration(duration) : (message.audio_duration_seconds ? formatDuration(message.audio_duration_seconds) : '--:--')}</span>
            {error ? (
              <button 
                onClick={handleRetry}
                className="text-red-400 hover:text-red-300 underline"
              >
                Tap to retry
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <audio
        ref={audioRef}
        src={cacheBustedPath}
        preload="metadata"
        playsInline
        webkit-playsinline="true"
        onEnded={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="hidden"
      />

      {/* Debug info for this specific audio message */}
      {debugText && (
        <div className="mt-1 text-xs text-red-400 font-mono bg-red-900/20 px-2 py-1 rounded">
          🎵 {debugText}
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