import { useCallback, useEffect, useRef, useState } from 'react'
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
  profile_picture?: string | null
  image_path?: string | null
}

type ParentReply = {
  id: number
  username: string
  content: string
  timestamp: string
  profile_picture?: string | null
  image_path?: string | null
  parent_reply_id?: number | null
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
  const mainReplyRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [reply, setReply] = useState<Reply | null>(null)
  const [post, setPost] = useState<PostInfo | null>(null)
  const [parentChain, setParentChain] = useState<ParentReply[]>([])
  const [currentUser, setCurrentUser] = useState<string>('')
  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [showGifPicker, setShowGifPicker] = useState(false)
  const [selectedGif, setSelectedGif] = useState<GifSelection | null>(null)
  
  // Edit state for main reply
  const [isEditingMain, setIsEditingMain] = useState(false)
  const [editMainText, setEditMainText] = useState('')
  
  // Edit state for nested replies (keyed by reply id)
  const [editingNestedId, setEditingNestedId] = useState<number | null>(null)
  const [editNestedText, setEditNestedText] = useState('')

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
        setParentChain(data.parent_chain || [])
        setEditMainText(data.reply.content)
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

  // Scroll to main reply on load
  useEffect(() => {
    if (!loading && mainReplyRef.current) {
      setTimeout(() => {
        mainReplyRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' })
      }, 100)
    }
  }, [loading, reply_id])

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

      if (post) {
        fd.set('post_id', String(post.id))
      }

      const res = await fetch('/post_reply', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      
      if (data.success && data.reply) {
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

  // Handle reaction on a reply (heart only)
  const handleReaction = async (targetReplyId: number) => {
    try {
      const fd = new FormData()
      fd.append('reply_id', String(targetReplyId))
      fd.append('reaction', '❤️')
      const res = await fetch('/add_reply_reaction', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      if (data.success) {
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
          navigate(-1)
        } else {
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

  // Edit main reply
  const handleEditMain = async () => {
    if (!reply) return
    try {
      const fd = new FormData()
      fd.append('reply_id', String(reply.id))
      fd.append('content', editMainText)
      const res = await fetch('/edit_reply', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      if (data.success) {
        setReply((prev) => prev ? { ...prev, content: editMainText } : prev)
        setIsEditingMain(false)
      } else {
        alert(data.error || 'Failed to edit')
      }
    } catch (err) {
      console.error('Failed to edit reply:', err)
      alert('Failed to edit reply')
    }
  }

  // Edit nested reply
  const handleEditNested = async (nestedId: number) => {
    try {
      const fd = new FormData()
      fd.append('reply_id', String(nestedId))
      fd.append('content', editNestedText)
      const res = await fetch('/edit_reply', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json()
      if (data.success) {
        setReply((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            nested_replies: (prev.nested_replies || []).map((nr) =>
              nr.id === nestedId ? { ...nr, content: editNestedText } : nr
            ),
          }
        })
        setEditingNestedId(null)
        setEditNestedText('')
      } else {
        alert(data.error || 'Failed to edit')
      }
    } catch (err) {
      console.error('Failed to edit reply:', err)
      alert('Failed to edit reply')
    }
  }

  // Check if user can edit/delete a reply
  const canEditDelete = (username: string) => {
    return currentUser === username || currentUser === 'admin'
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <i className="fa-solid fa-spinner fa-spin text-2xl text-[#4db6ac]" />
      </div>
    )
  }

  if (!reply) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-4">
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

  const heartCount = reply.reactions?.['❤️'] || 0
  const isHeartActive = reply.user_reaction === '❤️'

  return (
    <div
      className="min-h-screen bg-black text-white flex flex-col overflow-hidden"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
      {/* Fixed Header - same style as PostDetail */}
      <div
        className="flex-shrink-0 border-b border-white/10"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          background: '#000',
        }}
      >
        <div className="h-14 flex items-center gap-2 px-3">
          <button 
            className="p-2 rounded-full hover:bg-white/10 transition-colors" 
            onClick={() => navigate(-1)} 
            aria-label="Back"
          >
            <i className="fa-solid fa-arrow-left text-white" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="font-semibold tracking-[-0.01em] text-sm">Thread</div>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div 
        className="flex-1 overflow-y-auto"
        style={{ paddingBottom: '120px' }}
      >
        <div className="max-w-2xl mx-auto">
          
          {/* Original Post Context */}
          {post && (
            <div
              className="px-4 py-4 border-b border-white/10 cursor-pointer hover:bg-white/[0.02]"
              onClick={() => navigate(`/post/${post.id}`)}
            >
              <div className="flex gap-3">
                <div className="flex flex-col items-center">
                  <Avatar username={post.username} url={post.profile_picture || undefined} size={40} />
                  {/* Connector line to next item */}
                  <div className="flex-1 w-0.5 bg-white/20 mt-2 min-h-[20px]" />
                </div>
                <div className="flex-1 min-w-0 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{post.username}</span>
                    <span className="text-xs text-white/40">{formatSmartTime(post.timestamp)}</span>
                  </div>
                  <div className="mt-1 text-[14px] text-white/70 line-clamp-3">
                    {renderRichText(post.content)}
                  </div>
                  {post.image_path && (
                    <div className="mt-2">
                      <ImageLoader
                        src={post.image_path.startsWith('http') || post.image_path.startsWith('/') ? post.image_path : `/uploads/${post.image_path}`}
                        alt="Post image"
                        className="rounded-lg max-h-[150px] object-contain"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Parent Chain Context (ancestors from root comment to immediate parent) */}
          {parentChain.map((parent) => (
            <div
              key={parent.id}
              className="px-4 py-3 border-b border-white/10 cursor-pointer hover:bg-white/[0.02]"
              onClick={() => navigate(`/reply/${parent.id}`)}
            >
              <div className="flex gap-3">
                <div className="flex flex-col items-center">
                  <Avatar username={parent.username} url={parent.profile_picture || undefined} size={36} />
                  {/* Connector line to next item */}
                  <div className="flex-1 w-0.5 bg-white/20 mt-2 min-h-[16px]" />
                </div>
                <div className="flex-1 min-w-0 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{parent.username}</span>
                    <span className="text-xs text-white/40">{formatSmartTime(parent.timestamp)}</span>
                  </div>
                  <div className="mt-1 text-[13px] text-white/60 line-clamp-2">
                    {renderRichText(parent.content)}
                  </div>
                  {parent.image_path && (
                    <div className="mt-2">
                      <ImageLoader
                        src={parent.image_path.startsWith('http') || parent.image_path.startsWith('/') ? parent.image_path : `/uploads/${parent.image_path}`}
                        alt="Reply image"
                        className="rounded-lg max-h-[100px] object-contain"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Main Reply (the focus of this page) */}
          <div ref={mainReplyRef} className="px-4 py-4 border-b border-white/10 bg-white/[0.02]">
            <div className="flex gap-3">
              <Avatar username={reply.username} url={reply.profile_picture || undefined} size={44} linkToProfile />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{reply.username}</span>
                  <span className="text-sm text-white/40">{formatSmartTime(reply.timestamp)}</span>
                  {/* Edit/Delete buttons for main reply */}
                  {canEditDelete(reply.username) && (
                    <div className="ml-auto flex items-center">
                      <button
                        onClick={() => {
                          setEditMainText(reply.content)
                          setIsEditingMain(true)
                        }}
                        className="p-2 text-white/50 hover:text-[#4db6ac] transition-colors"
                        title="Edit reply"
                      >
                        <i className="fa-regular fa-pen-to-square" />
                      </button>
                      <button
                        onClick={() => handleDelete(reply.id)}
                        className="p-2 text-white/50 hover:text-red-400 transition-colors"
                        title="Delete reply"
                      >
                        <i className="fa-regular fa-trash-can" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Reply content or edit form */}
                {!isEditingMain ? (
                  <>
                    {reply.content && (
                      <div className="mt-2 text-[15px] whitespace-pre-wrap break-words text-white/90">
                        {renderRichText(reply.content)}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="mt-2">
                    <textarea
                      className="w-full resize-none max-h-60 min-h-[100px] px-3 py-2 rounded-md bg-black border border-[#4db6ac] text-[14px] focus:outline-none focus:ring-1 focus:ring-[#4db6ac]"
                      value={editMainText}
                      onChange={(e) => setEditMainText(e.target.value)}
                      autoFocus
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        className="px-3 py-1.5 rounded-md bg-[#4db6ac] text-black text-sm font-medium"
                        onClick={handleEditMain}
                      >
                        Save
                      </button>
                      <button
                        className="px-3 py-1.5 rounded-md border border-white/10 text-sm"
                        onClick={() => {
                          setIsEditingMain(false)
                          setEditMainText(reply.content)
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Reply image */}
                {reply.image_path && !isEditingMain && (
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
                {reply.audio_path && !isEditingMain && (
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

                {/* Heart + Reply count - same line */}
                {!isEditingMain && (
                  <div className="mt-3 flex items-center gap-4">
                    <button
                      onClick={() => handleReaction(reply.id)}
                      className={`flex items-center gap-1.5 text-sm transition ${
                        isHeartActive ? 'text-red-400' : 'text-white/40 hover:text-red-400'
                      }`}
                    >
                      <i className={`${isHeartActive ? 'fa-solid' : 'fa-regular'} fa-heart`} />
                      {heartCount > 0 && <span>{heartCount}</span>}
                    </button>
                    <span className="flex items-center gap-1.5 text-sm text-white/40">
                      <i className="fa-regular fa-comment" />
                      {reply.reply_count || 0}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Nested replies */}
          {reply.nested_replies && reply.nested_replies.length > 0 && (
            <div className="divide-y divide-white/5">
              {reply.nested_replies.map((nr) => {
                const nrHeartCount = nr.reactions?.['❤️'] || 0
                const nrIsHeartActive = nr.user_reaction === '❤️'
                const nrReplyCount = nr.reply_count || 0
                const isEditingThis = editingNestedId === nr.id

                return (
                  <div
                    key={nr.id}
                    className="px-4 py-4 hover:bg-white/[0.02] cursor-pointer"
                    onClick={() => !isEditingThis && navigate(`/reply/${nr.id}`)}
                  >
                    <div className="flex gap-3">
                      <div onClick={(e) => e.stopPropagation()}>
                        <Avatar username={nr.username} url={nr.profile_picture || undefined} size={36} linkToProfile />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{nr.username}</span>
                          <span className="text-xs text-white/40">{formatSmartTime(nr.timestamp)}</span>
                          {/* Edit/Delete buttons for nested reply */}
                          {canEditDelete(nr.username) && (
                            <div className="ml-auto flex items-center" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => {
                                  setEditNestedText(nr.content)
                                  setEditingNestedId(nr.id)
                                }}
                                className="p-1.5 text-white/50 hover:text-[#4db6ac] transition-colors"
                                title="Edit reply"
                              >
                                <i className="fa-regular fa-pen-to-square text-sm" />
                              </button>
                              <button
                                onClick={() => handleDelete(nr.id)}
                                className="p-1.5 text-white/50 hover:text-red-400 transition-colors"
                                title="Delete reply"
                              >
                                <i className="fa-regular fa-trash-can text-sm" />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Content or edit form */}
                        {!isEditingThis ? (
                          <>
                            {nr.content && (
                              <div className="mt-1 text-[14px] whitespace-pre-wrap break-words text-white/80">
                                {renderRichText(nr.content)}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                            <textarea
                              className="w-full resize-none max-h-40 min-h-[80px] px-3 py-2 rounded-md bg-black border border-[#4db6ac] text-[13px] focus:outline-none focus:ring-1 focus:ring-[#4db6ac]"
                              value={editNestedText}
                              onChange={(e) => setEditNestedText(e.target.value)}
                              autoFocus
                            />
                            <div className="mt-2 flex gap-2">
                              <button
                                className="px-3 py-1 rounded-md bg-[#4db6ac] text-black text-xs font-medium"
                                onClick={() => handleEditNested(nr.id)}
                              >
                                Save
                              </button>
                              <button
                                className="px-3 py-1 rounded-md border border-white/10 text-xs"
                                onClick={() => {
                                  setEditingNestedId(null)
                                  setEditNestedText('')
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {nr.image_path && !isEditingThis && (
                          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
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

                        {/* Heart + Reply count - same line */}
                        {!isEditingThis && (
                          <div className="mt-2 flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => handleReaction(nr.id)}
                              className={`flex items-center gap-1 text-xs transition ${
                                nrIsHeartActive ? 'text-red-400' : 'text-white/40 hover:text-red-400'
                              }`}
                            >
                              <i className={`${nrIsHeartActive ? 'fa-solid' : 'fa-regular'} fa-heart`} />
                              {nrHeartCount > 0 && <span>{nrHeartCount}</span>}
                            </button>
                            <span className="flex items-center gap-1 text-xs text-white/40">
                              <i className="fa-regular fa-comment" />
                              {nrReplyCount}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Empty state */}
          {(!reply.nested_replies || reply.nested_replies.length === 0) && (
            <div className="px-4 py-16 text-center text-white/30">
              <i className="fa-regular fa-comments text-3xl mb-3 block" />
              <p className="text-sm">No replies yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Fixed bottom reply composer */}
      <div 
        className="fixed left-0 right-0 z-50 bg-black border-t border-white/10"
        style={{ bottom: 0 }}
      >
        <div className="max-w-2xl mx-auto px-3 py-3">
          {selectedGif && (
            <div className="mb-2 flex items-center gap-2 p-2 bg-white/5 rounded-lg">
              <img src={selectedGif.previewUrl} alt="GIF" className="h-12 rounded" />
              <button onClick={() => setSelectedGif(null)} className="ml-auto text-white/60 hover:text-white">
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <button
              onClick={() => setShowGifPicker(true)}
              className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/15"
            >
              <i className="fa-solid fa-images text-sm text-white/70" />
            </button>
            <div className="flex-1 flex items-center rounded-lg border border-white/20 bg-white/5 overflow-hidden">
              <MentionTextarea
                value={replyText}
                onChange={setReplyText}
                placeholder={`Reply to @${reply.username}...`}
                className="flex-1 bg-transparent px-3 py-2 text-[15px] text-white placeholder-white/40 outline-none resize-none max-h-24 min-h-[36px]"
                rows={1}
                autoExpand
              />
            </div>
            <button
              onClick={handleSubmitReply}
              disabled={sendingReply || (!replyText.trim() && !selectedGif)}
              className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg bg-[#4db6ac] text-white disabled:opacity-40"
            >
              {sendingReply ? <i className="fa-solid fa-spinner fa-spin text-sm" /> : <i className="fa-solid fa-paper-plane text-sm" />}
            </button>
          </div>
        </div>
        {/* Safe area spacer for iOS */}
        <div style={{ height: 'env(safe-area-inset-bottom, 0px)' }} />
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
