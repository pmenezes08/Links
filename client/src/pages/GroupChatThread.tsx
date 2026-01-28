import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'

type Message = {
  id: number
  sender: string
  text: string | null
  image: string | null
  created_at: string
  profile_picture: string | null
}

type Member = {
  username: string
  is_admin: boolean
  joined_at: string
  profile_picture: string | null
}

type GroupInfo = {
  id: number
  name: string
  creator: string
  created_at: string
  is_admin: boolean
  members: Member[]
}

export default function GroupChatThread() {
  const { group_id } = useParams()
  const navigate = useNavigate()
  const [group, setGroup] = useState<GroupInfo | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const lastMessageIdRef = useRef<number>(0)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const loadGroup = useCallback(async () => {
    try {
      const response = await fetch(`/api/group_chat/${group_id}`, { credentials: 'include' })
      const data = await response.json()
      if (data.success) {
        setGroup(data.group)
      } else {
        setError(data.error || 'Failed to load group')
      }
    } catch (err) {
      console.error('Error loading group:', err)
      setError('Failed to load group')
    }
  }, [group_id])

  const loadMessages = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await fetch(`/api/group_chat/${group_id}/messages`, { credentials: 'include' })
      const data = await response.json()
      if (data.success) {
        const newMessages = data.messages as Message[]
        
        // Check if there are new messages
        const newMaxId = newMessages.length > 0 ? Math.max(...newMessages.map(m => m.id)) : 0
        const hasNewMessages = newMaxId > lastMessageIdRef.current
        
        setMessages(newMessages)
        lastMessageIdRef.current = newMaxId
        
        // Scroll to bottom on new messages
        if (hasNewMessages && !silent) {
          setTimeout(scrollToBottom, 100)
        }
      }
    } catch (err) {
      console.error('Error loading messages:', err)
      if (!silent) setError('Failed to load messages')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [group_id, scrollToBottom])

  useEffect(() => {
    loadGroup()
    loadMessages()

    // Poll for new messages
    pollingRef.current = setInterval(() => {
      loadMessages(true)
    }, 3000)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [loadGroup, loadMessages])

  const handleSend = async () => {
    const text = newMessage.trim()
    if (!text || sending) return

    setSending(true)
    setNewMessage('')

    try {
      const response = await fetch(`/api/group_chat/${group_id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: text }),
      })
      const data = await response.json()
      
      if (data.success) {
        setMessages(prev => [...prev, data.message])
        lastMessageIdRef.current = data.message.id
        setTimeout(scrollToBottom, 100)
      } else {
        setNewMessage(text) // Restore message on error
        console.error('Failed to send:', data.error)
      }
    } catch (err) {
      setNewMessage(text)
      console.error('Error sending message:', err)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleLeave = async () => {
    if (!confirm('Are you sure you want to leave this group chat?')) return

    try {
      const response = await fetch(`/api/group_chat/${group_id}/leave`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json()
      
      if (data.success) {
        navigate('/user_chat')
      } else {
        alert(data.error || 'Failed to leave group')
      }
    } catch (err) {
      console.error('Error leaving group:', err)
      alert('Failed to leave group')
    }
  }

  const formatTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      const now = new Date()
      const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
      
      if (diffDays === 0) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      } else if (diffDays === 1) {
        return 'Yesterday'
      } else if (diffDays < 7) {
        return date.toLocaleDateString([], { weekday: 'short' })
      }
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    } catch {
      return ''
    }
  }

  if (loading && !group) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-[#9fb0b5]">
          <i className="fa-solid fa-spinner fa-spin mr-2" />
          Loading...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 mb-4">{error}</div>
          <button
            onClick={() => navigate('/user_chat')}
            className="px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20"
          >
            Back to Messages
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <div
        className="fixed left-0 right-0 h-14 bg-black/95 backdrop-blur border-b border-white/10 z-40 flex items-center px-3 gap-3"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))' }}
      >
        <button
          onClick={() => navigate('/user_chat')}
          className="p-2 rounded-full hover:bg-white/5"
          aria-label="Back"
        >
          <i className="fa-solid fa-arrow-left" />
        </button>
        
        <button
          onClick={() => setShowMembers(true)}
          className="flex-1 min-w-0 flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center">
            <i className="fa-solid fa-users text-[#4db6ac]" />
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="font-semibold truncate">{group?.name}</div>
            <div className="text-xs text-[#9fb0b5] truncate">
              {group?.members.length} members
            </div>
          </div>
        </button>
        
        <button
          onClick={() => setShowMembers(true)}
          className="p-2 rounded-full hover:bg-white/5"
          aria-label="Group info"
        >
          <i className="fa-solid fa-ellipsis-vertical" />
        </button>
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-3 pb-20"
        style={{
          paddingTop: 'calc(var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px))) + 56px + 16px)',
        }}
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#9fb0b5]">
            <i className="fa-solid fa-comments text-4xl mb-3 opacity-50" />
            <div className="text-sm">No messages yet</div>
            <div className="text-xs mt-1">Send a message to start the conversation</div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg, idx) => {
              // Message display (could be extended to show different styles for current user)
              const showAvatar = idx === 0 || messages[idx - 1].sender !== msg.sender
              
              return (
                <div key={msg.id} className={`flex gap-2 ${showAvatar ? 'mt-4' : 'mt-1'}`}>
                  <div className="w-8 flex-shrink-0">
                    {showAvatar && (
                      <Avatar
                        username={msg.sender}
                        url={msg.profile_picture || undefined}
                        size={32}
                        linkToProfile
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    {showAvatar && (
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-sm font-medium text-white/90">{msg.sender}</span>
                        <span className="text-xs text-[#9fb0b5]">{formatTime(msg.created_at)}</span>
                      </div>
                    )}
                    {msg.text && (
                      <div className="text-[14px] text-white/90 whitespace-pre-wrap break-words">
                        {msg.text}
                      </div>
                    )}
                    {msg.image && (
                      <img
                        src={msg.image.startsWith('http') ? msg.image : `/uploads/${msg.image}`}
                        alt="Shared image"
                        className="mt-2 max-w-[280px] rounded-lg border border-white/10"
                      />
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Message Input */}
      <div className="fixed bottom-0 left-0 right-0 bg-black border-t border-white/10 p-3 pb-safe">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white resize-none focus:outline-none focus:border-[#4db6ac]/50"
            style={{ maxHeight: '120px' }}
          />
          <button
            onClick={handleSend}
            disabled={!newMessage.trim() || sending}
            className="p-3 rounded-full bg-[#4db6ac] text-black disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 transition"
          >
            {sending ? (
              <i className="fa-solid fa-spinner fa-spin" />
            ) : (
              <i className="fa-solid fa-paper-plane" />
            )}
          </button>
        </div>
      </div>

      {/* Members Modal */}
      {showMembers && group && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center"
          onClick={() => setShowMembers(false)}
        >
          <div
            className="w-full sm:max-w-md bg-[#1a1a1a] rounded-t-2xl sm:rounded-2xl border border-white/10 max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <div className="font-semibold">{group.name}</div>
                <div className="text-xs text-[#9fb0b5]">{group.members.length} members</div>
              </div>
              <button
                onClick={() => setShowMembers(false)}
                className="p-2 rounded-full hover:bg-white/5"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            
            <div className="p-4 max-h-[50vh] overflow-y-auto">
              <div className="text-xs text-[#9fb0b5] uppercase tracking-wide mb-3">Members</div>
              <div className="space-y-2">
                {group.members.map((member) => (
                  <div
                    key={member.username}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5"
                  >
                    <Avatar
                      username={member.username}
                      url={member.profile_picture || undefined}
                      size={40}
                      linkToProfile
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{member.username}</div>
                      {member.is_admin && (
                        <div className="text-xs text-[#4db6ac]">Admin</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="p-4 border-t border-white/10">
              <button
                onClick={handleLeave}
                className="w-full px-4 py-3 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition"
              >
                <i className="fa-solid fa-arrow-right-from-bracket mr-2" />
                Leave Group
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
