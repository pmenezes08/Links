import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'
import { formatSmartTime } from '../utils/time'
import MentionTextarea from '../components/MentionTextarea'
import GifPicker from '../components/GifPicker'
import type { GifSelection } from '../components/GifPicker'
import { gifSelectionToFile } from '../utils/gif'

type Reply = {
  id: number
  username: string
  content: string
  timestamp: string
  reactions: Record<string, number>
  user_reaction: string | null
  profile_picture?: string | null
  image_path?: string | null
  audio_path?: string | null
  parent_reply_id?: number | null
  reply_count?: number
  nested_replies?: Reply[]
}

type PostInfo = {
  id: number
  username: string
  content: string
  community_id?: number
  timestamp: string
}

function renderRichText(input: string) {
  const nodes: Array<React.ReactNode> = []
  const markdownRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = markdownRe.exec(input))) {
    if (match.index > lastIndex) {
      nodes.push(...preserveNewlines(input.slice(lastIndex, match.index)))
    }
    const label = match[1]
    const url = match[2]
    nodes.push(
      <a
        key={`md-${match.index}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#4db6ac] underline-offset-2 hover:underline break-words"
      >
        {label}
      </a>
    )
    lastIndex = markdownRe.lastIndex
  }

  const rest = input.slice(lastIndex)
  const urlRe = /(https?:\/\/[^\s]+|www\.[^\s]+)/g
  let urlLast = 0
  let m: RegExpExecArray | null

  while ((m = urlRe.exec(rest))) {
    if (m.index > urlLast) {
      nodes.push(...colorizeMentions(preserveNewlines(rest.slice(urlLast, m.index))))
    }
    const urlText = m[0]
    const href = urlText.startsWith('http') ? urlText : `https://${urlText}`
    nodes.push(
      <a
        key={`u-${lastIndex + m.index}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#4db6ac] underline-offset-2 hover:underline break-words"
      >
        {urlText}
      </a>
    )
    urlLast = urlRe.lastIndex
  }

  if (urlLast < rest.length) {
    nodes.push(...colorizeMentions(preserveNewlines(rest.slice(urlLast))))
  }

  return <>{nodes}</>
}

function preserveNewlines(text: string) {
  const parts = text.split(/\n/)
  const out: Array<React.ReactNode> = []
  parts.forEach((p, i) => {
    if (i > 0) out.push(<br key={`br-${i}-${p.length}-${Math.random()}`} />)
    if (p) out.push(p)
  })
  return out
}

function colorizeMentions(nodes: Array<React.ReactNode>): Array<React.ReactNode> {
  const out: Array<React.ReactNode> = []
  const mentionRe = /(^|\s)(@([a-zA-Z0-9_]{1,30}))/g
  nodes.forEach((n, idx) => {
    if (typeof n !== 'string') {
      out.push(n)
      return
    }
    const segs: Array<React.ReactNode> = []
    let last = 0
    let m: RegExpExecArray | null
    while ((m = mentionRe.exec(n))) {
      const start = m.index
      const lead = m[1]
      const full = m[2]
      if (start > last) segs.push(n.slice(last, start))
      if (lead) segs.push(lead)
      segs.push(
        <span key={`men-${idx}-${start}`} className="text-[#4db6ac]">
          {full}
        </span>
      )
      last = start + lead.length + full.length
    }
    if (last < n.length) segs.push(n.slice(last))
    out.push(...segs)
  })
  return out
}

export default function CommentReply() {
  const { reply_id } = useParams<{ reply_id: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [reply, setReply] = useState<Reply | null>(null)
  const [post, setPost] = useState<PostInfo | null>(null)
  const [parentReply, setParentReply] = useState<Reply | null>(null)
  const [currentUser, setCurrentUser] = useState<string>('')
  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [showGifPicker, setShowGifPicker] = useState(false)
  const [selectedGif, setSelectedGif] = useState<GifSelection | null>(null)

  // Fetch current user
  useEffect(() => {
    fetch('/api/profile_me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.username) setCurrentUser(d.username)
      })
      .catch(() => {})
  }, [])

  // Fetch reply data
  const fetchReply = useCallback(async () => {
    if (!reply_id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/reply/${reply_id}`, { credentials: 'include' })
      const data = await res.json()
      if (data.success) {
        setReply(data.reply)
        setPost(data.post)
        setParentReply(data.parent_reply)
      }
    } catch (err) {
      console.error('Failed to fetch reply:', err)
    } finally {
      setLoading(false)
    }
  }, [reply_id])

  useEffect(() => {
    fetchReply()
  }, [fetchReply])

  // Submit a reply
  const handleSubmitReply = async () => {
    if (!reply || (!replyText.trim() && !selectedGif)) return
    setSendingReply(true)
    try {
      const fd = new FormData()
      fd.append('post_id', String(reply.id))
      fd.append('content', replyText.trim())
      fd.append('parent_reply_id', String(reply.id))
      fd.append('dedupe_token', `${Date.now()}_${Math.random().toString(36).slice(2)}`)
      
      if (selectedGif) {
        const gifFile = await gifSelectionToFile(selectedGif, 'reply-gif')
        fd.append('image', gifFile)
      }

      // Get the post_id from the reply
      if (post) {
        fd.set('post_id', String(post.id))
      }

      const res = await fetch('/post_reply', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      
      if (data.success && data.reply) {
        // Add the new reply to the list
        setReply((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            nested_replies: [...(prev.nested_replies || []), data.reply],
            reply_count: (prev.reply_count || 0) + 1,
          }
        })
        setReplyText('')
        setSelectedGif(null)
      } else {
        alert(data.error || 'Failed to post reply')
      }
    } catch (err) {
      console.error('Failed to submit reply:', err)
      alert('Failed to post reply')
    } finally {
      setSendingReply(false)
    }
  }

  // Handle reaction on a reply
  const handleReaction = async (targetReplyId: number, reaction: string) => {
    try {
      const fd = new FormData()
      fd.append('reply_id', String(targetReplyId))
      fd.append('reaction', reaction)
      const res = await fetch('/add_reply_reaction', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      if (data.success) {
        // Update the reply or nested reply with new reaction counts
        setReply((prev) => {
          if (!prev) return prev
          if (prev.id === targetReplyId) {
            return { ...prev, reactions: data.counts, user_reaction: data.user_reaction }
          }
          return {
            ...prev,
            nested_replies: (prev.nested_replies || []).map((nr) =>
              nr.id === targetReplyId ? { ...nr, reactions: data.counts, user_reaction: data.user_reaction } : nr
            ),
          }
        })
      }
    } catch (err) {
      console.error('Failed to add reaction:', err)
    }
  }

  // Delete a reply
  const handleDelete = async (targetReplyId: number) => {
    if (!confirm('Delete this reply?')) return
    try {
      const fd = new FormData()
      fd.append('reply_id', String(targetReplyId))
      const res = await fetch('/delete_reply', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      if (data.success) {
        if (targetReplyId === reply?.id) {
          // Main reply deleted, go back
          navigate(-1)
        } else {
          // Nested reply deleted
          setReply((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              nested_replies: (prev.nested_replies || []).filter((nr) => nr.id !== targetReplyId),
              reply_count: Math.max(0, (prev.reply_count || 0) - 1),
            }
          })
        }
      }
    } catch (err) {
      console.error('Failed to delete reply:', err)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d1117] text-white flex items-center justify-center">
        <i className="fa-solid fa-spinner fa-spin text-2xl text-[#4db6ac]" />
      </div>
    )
  }

  if (!reply) {
    return (
      <div className="min-h-screen bg-[#0d1117] text-white flex flex-col items-center justify-center gap-4">
        <p className="text-white/60">Reply not found</p>
        <button
          onClick={() => navigate(-1)}
          className="px-4 py-2 rounded-lg bg-[#4db6ac] text-black font-medium"
        >
          Go Back
        </button>
      </div>
    )
  }

  const reactionEmojis = ['👍', '❤️', '😂', '😮', '😢', '🔥']

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0d1117]/95 backdrop-blur border-b border-white/10 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-full hover:bg-white/10">
          <i className="fa-solid fa-arrow-left text-lg" />
        </button>
        <h1 className="font-semibold text-lg">Thread</h1>
      </header>

      <div className="max-w-2xl mx-auto">
        {/* Context: link to original post */}
        {post && (
          <div
            className="px-4 py-3 border-b border-white/10 bg-white/[0.02] cursor-pointer hover:bg-white/[0.04]"
            onClick={() => navigate(`/post/${post.id}`)}
          >
            <div className="flex items-center gap-2 text-sm text-white/60">
              <i className="fa-solid fa-reply fa-flip-horizontal text-xs" />
              <span>
                Replying in <span className="text-[#4db6ac]">@{post.username}</span>'s post
              </span>
            </div>
            <p className="text-sm text-white/50 truncate mt-1">{post.content}</p>
          </div>
        )}

        {/* Parent reply context (if this is a nested reply) */}
        {parentReply && (
          <div
            className="px-4 py-3 border-b border-white/10 bg-white/[0.02] cursor-pointer hover:bg-white/[0.04]"
            onClick={() => navigate(`/reply/${parentReply.id}`)}
          >
            <div className="flex items-center gap-2 text-sm text-white/60">
              <i className="fa-solid fa-reply fa-flip-horizontal text-xs" />
              <span>
                Replying to <span className="text-[#4db6ac]">@{parentReply.username}</span>
              </span>
            </div>
            <p className="text-sm text-white/50 truncate mt-1">{parentReply.content}</p>
          </div>
        )}

        {/* Main Reply */}
        <div className="px-4 py-4 border-b border-white/10">
          <div className="flex gap-3">
            <Avatar username={reply.username} url={reply.profile_picture || undefined} size={44} linkToProfile />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{reply.username}</span>
                <span className="text-sm text-white/50">{formatSmartTime(reply.timestamp)}</span>
                {(reply.username === currentUser || currentUser === 'admin') && (
                  <button
                    onClick={() => handleDelete(reply.id)}
                    className="ml-auto p-1 text-white/40 hover:text-red-400"
                    title="Delete"
                  >
                    <i className="fa-regular fa-trash-can text-sm" />
                  </button>
                )}
              </div>

              {/* Reply content */}
              {reply.content && (
                <div className="mt-2 text-[15px] whitespace-pre-wrap break-words">
                  {renderRichText(reply.content)}
                </div>
              )}

              {/* Reply image */}
              {reply.image_path && (
                <div className="mt-3">
                  <ImageLoader
                    src={
                      reply.image_path.startsWith('http') || reply.image_path.startsWith('/')
                        ? reply.image_path
                        : `/uploads/${reply.image_path}`
                    }
                    alt="Reply image"
                    className="rounded-xl max-h-[400px] object-contain"
                  />
                </div>
              )}

              {/* Reply audio */}
              {reply.audio_path && (
                <div className="mt-3">
                  <audio
                    controls
                    className="w-full"
                    src={
                      reply.audio_path.startsWith('http') || reply.audio_path.startsWith('/')
                        ? reply.audio_path
                        : `/uploads/${reply.audio_path}`
                    }
                  />
                </div>
              )}

              {/* Reactions */}
              <div className="mt-3 flex items-center gap-1 flex-wrap">
                {reactionEmojis.map((emoji) => {
                  const count = reply.reactions?.[emoji] || 0
                  const isActive = reply.user_reaction === emoji
                  return (
                    <button
                      key={emoji}
                      onClick={() => handleReaction(reply.id, emoji)}
                      className={`px-2 py-1 rounded-full text-sm flex items-center gap-1 transition ${
                        isActive
                          ? 'bg-[#4db6ac]/20 text-[#4db6ac]'
                          : 'bg-white/5 text-white/60 hover:bg-white/10'
                      }`}
                    >
                      <span>{emoji}</span>
                      {count > 0 && <span className="text-xs">{count}</span>}
                    </button>
                  )
                })}
                <span className="ml-2 text-sm text-white/50">
                  <i className="fa-regular fa-comment mr-1" />
                  {reply.reply_count || 0} {(reply.reply_count || 0) === 1 ? 'reply' : 'replies'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Reply input */}
        <div className="px-4 py-3 border-b border-white/10 bg-white/[0.02]">
          <div className="flex gap-3">
            <Avatar username={currentUser} size={36} />
            <div className="flex-1">
              <MentionTextarea
                value={replyText}
                onChange={setReplyText}
                placeholder={`Reply to @${reply.username}...`}
                className="w-full bg-transparent border-0 outline-none resize-none text-[15px] placeholder-white/40"
                rows={2}
              />
              {selectedGif && (
                <div className="mt-2 flex items-center gap-2 p-2 bg-white/5 rounded-lg">
                  <img src={selectedGif.previewUrl} alt="GIF" className="h-16 rounded" />
                  <button onClick={() => setSelectedGif(null)} className="ml-auto text-white/60 hover:text-white">
                    <i className="fa-solid fa-xmark" />
                  </button>
                </div>
              )}
              <div className="mt-2 flex items-center justify-between">
                <button
                  onClick={() => setShowGifPicker(true)}
                  className="px-3 py-1.5 rounded-lg bg-white/5 text-white/70 hover:bg-white/10 text-sm"
                >
                  <i className="fa-solid fa-images mr-1" /> GIF
                </button>
                <button
                  onClick={handleSubmitReply}
                  disabled={sendingReply || (!replyText.trim() && !selectedGif)}
                  className="px-4 py-1.5 rounded-full bg-[#4db6ac] text-black font-semibold text-sm disabled:opacity-40"
                >
                  {sendingReply ? <i className="fa-solid fa-spinner fa-spin" /> : 'Reply'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Nested replies */}
        {reply.nested_replies && reply.nested_replies.length > 0 && (
          <div className="divide-y divide-white/10">
            {reply.nested_replies.map((nr) => (
              <div key={nr.id} className="px-4 py-4 hover:bg-white/[0.02]">
                <div className="flex gap-3">
                  <Avatar username={nr.username} url={nr.profile_picture || undefined} size={36} linkToProfile />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{nr.username}</span>
                      <span className="text-sm text-white/50">{formatSmartTime(nr.timestamp)}</span>
                      {(nr.username === currentUser || currentUser === 'admin') && (
                        <button
                          onClick={() => handleDelete(nr.id)}
                          className="ml-auto p-1 text-white/40 hover:text-red-400"
                          title="Delete"
                        >
                          <i className="fa-regular fa-trash-can text-xs" />
                        </button>
                      )}
                    </div>

                    {nr.content && (
                      <div className="mt-1 text-[14px] whitespace-pre-wrap break-words">
                        {renderRichText(nr.content)}
                      </div>
                    )}

                    {nr.image_path && (
                      <div className="mt-2">
                        <ImageLoader
                          src={
                            nr.image_path.startsWith('http') || nr.image_path.startsWith('/')
                              ? nr.image_path
                              : `/uploads/${nr.image_path}`
                          }
                          alt="Reply image"
                          className="rounded-lg max-h-[200px] object-contain"
                        />
                      </div>
                    )}

                    {/* Reactions for nested reply */}
                    <div className="mt-2 flex items-center gap-1 flex-wrap">
                      {reactionEmojis.map((emoji) => {
                        const count = nr.reactions?.[emoji] || 0
                        const isActive = nr.user_reaction === emoji
                        return (
                          <button
                            key={emoji}
                            onClick={() => handleReaction(nr.id, emoji)}
                            className={`px-1.5 py-0.5 rounded-full text-xs flex items-center gap-0.5 transition ${
                              isActive
                                ? 'bg-[#4db6ac]/20 text-[#4db6ac]'
                                : 'bg-white/5 text-white/60 hover:bg-white/10'
                            }`}
                          >
                            <span>{emoji}</span>
                            {count > 0 && <span>{count}</span>}
                          </button>
                        )
                      })}
                      {(nr.reply_count || 0) > 0 && (
                        <button
                          onClick={() => navigate(`/reply/${nr.id}`)}
                          className="ml-2 text-xs text-[#4db6ac] hover:underline"
                        >
                          <i className="fa-regular fa-comment mr-1" />
                          {nr.reply_count} {nr.reply_count === 1 ? 'reply' : 'replies'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {(!reply.nested_replies || reply.nested_replies.length === 0) && (
          <div className="px-4 py-12 text-center text-white/40">
            <i className="fa-regular fa-comments text-4xl mb-3 block" />
            <p>No replies yet. Be the first to reply!</p>
          </div>
        )}
      </div>

      {/* GIF Picker Modal */}
      <GifPicker
        isOpen={showGifPicker}
        onSelect={(gif) => {
          setSelectedGif(gif)
          setShowGifPicker(false)
        }}
        onClose={() => setShowGifPicker(false)}
      />
    </div>
  )
}
