/**
 * MessageBubble component
 * Renders a single chat message with all its features:
 * - Reply snippets, audio/image/video content
 * - Encryption indicators, edit mode, reactions
 * - Long press actions (react, reply, copy, edit, delete)
 */

import type { ChatMessage } from '../types/chat'
import MessageImage from '../components/MessageImage'
import MessageVideo from '../components/MessageVideo'
import { normalizeMediaPath, formatMessageTime, parseMessageTime } from './utils'
import AudioMessage from './AudioMessage'
import LongPressActionable from './LongPressActionable'

export interface MessageBubbleProps {
  message: ChatMessage & {
    reaction?: string
    replySnippet?: string
    storyReply?: {
      id: string
      mediaType: string
      mediaPath: string
    }
    isOptimistic?: boolean
    edited_at?: string | null
    decryption_error?: boolean
  }
  /** Whether this message is being edited */
  isEditing: boolean
  /** Current edit text value */
  editText: string
  /** Whether edit is being saved */
  editingSaving: boolean
  /** Other user's display name */
  otherDisplayName: string
  /** Handler to delete message */
  onDelete: () => void
  /** Handler for reaction */
  onReact: (emoji: string) => void
  /** Handler for reply */
  onReply: () => void
  /** Handler for copy */
  onCopy: () => void
  /** Handler to start editing (only for sent messages) */
  onEdit?: () => void
  /** Handler to enter multi-select mode */
  onSelect?: () => void
  /** Handler to update edit text */
  onEditTextChange: (text: string) => void
  /** Handler to commit edit */
  onCommitEdit: () => void
  /** Handler to cancel edit */
  onCancelEdit: () => void
  /** Handler for image preview */
  onImageClick: (imagePath: string) => void
  /** Handler for story reply click - navigates to story */
  onStoryReplyClick?: (storyId: string, username: string) => void
  /** Username of the other person in the chat (for story navigation) */
  otherUsername?: string
  /** Function to render linkified text */
  linkifyText: (text: string) => React.ReactNode[]
}

export default function MessageBubble({
  message: m,
  isEditing,
  editText,
  editingSaving,
  otherDisplayName,
  onDelete,
  onReact,
  onReply,
  onCopy,
  onEdit,
  onSelect,
  onEditTextChange,
  onCommitEdit,
  onCancelEdit,
  onImageClick,
  onStoryReplyClick,
  otherUsername,
  linkifyText,
}: MessageBubbleProps) {
  return (
    <LongPressActionable
      onDelete={onDelete}
      onReact={onReact}
      onReply={onReply}
      onCopy={onCopy}
      onEdit={onEdit}
      onSelect={onSelect}
      disabled={isEditing}
    >
      <div className={`flex ${m.sent ? 'justify-end' : 'justify-start'}`}>
        <div
          className={`liquid-glass-bubble ${m.sent ? 'liquid-glass-bubble--sent text-white' : 'liquid-glass-bubble--received text-white'} max-w-[82%] md:max-w-[65%] px-2.5 py-1.5 rounded-2xl text-[14px] leading-tight whitespace-pre-wrap break-words ${
            m.sent ? 'rounded-br-xl' : 'rounded-bl-xl'
          } ${m.isOptimistic ? 'opacity-70' : 'opacity-100'}`}
          style={{
            position: 'relative',
          } as React.CSSProperties}
        >
          {/* Story reply - shows a preview of the story being replied to */}
          {m.storyReply ? (() => {
            const isVideo = m.storyReply.mediaType === '🎥'
            const mediaPath = m.storyReply.mediaPath
            const storyId = m.storyReply.id
            
            return (
              <button
                type="button"
                className="mb-2 w-full flex items-stretch gap-0 bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-lg overflow-hidden border border-white/10 hover:from-purple-500/30 hover:to-pink-500/30 active:from-purple-500/40 active:to-pink-500/40 transition-colors cursor-pointer text-left"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  console.log('🎬 Story reply clicked, storyId:', storyId)
                  if (onStoryReplyClick) {
                    onStoryReplyClick(storyId, otherUsername || '')
                  }
                }}
              >
                {/* Story indicator accent bar with gradient */}
                <div className="w-1 flex-shrink-0 bg-gradient-to-b from-purple-400 to-pink-400" />
                <div className="flex-1 px-2.5 py-1.5 min-w-0 flex items-center gap-2">
                  {/* Story thumbnail */}
                  {mediaPath && !isVideo && (
                    <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0 bg-black/30">
                      <img 
                        src={normalizeMediaPath(mediaPath)} 
                        alt="Story" 
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  {mediaPath && isVideo && (
                    <div className="w-10 h-10 rounded bg-black/40 flex items-center justify-center flex-shrink-0 relative overflow-hidden">
                      <video 
                        src={normalizeMediaPath(mediaPath)} 
                        className="absolute inset-0 w-full h-full object-cover"
                        muted
                        playsInline
                      />
                      <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                        <i className="fa-solid fa-play text-white/80 text-xs" />
                      </div>
                    </div>
                  )}
                  {!mediaPath && (
                    <div className="w-10 h-10 rounded bg-gradient-to-br from-purple-500/30 to-pink-500/30 flex items-center justify-center flex-shrink-0">
                      <i className="fa-solid fa-circle-play text-white/50 text-sm" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <i className="fa-solid fa-circle-play text-[10px] text-purple-400" />
                      <span className={`text-[11px] font-medium ${m.sent ? 'text-white/70' : 'text-purple-400'}`}>
                        Replied to {m.sent ? 'their' : 'your'} story
                      </span>
                    </div>
                    <div className="text-[12px] text-white/50 mt-0.5 flex items-center gap-1">
                      {isVideo ? (
                        <><i className="fa-solid fa-video text-[10px]" /> Video</>
                      ) : (
                        <><i className="fa-solid fa-image text-[10px]" /> Photo</>
                      )}
                    </div>
                  </div>
                  {/* Tap indicator */}
                  <div className="flex-shrink-0 text-white/30">
                    <i className="fa-solid fa-chevron-right text-xs" />
                  </div>
                </div>
              </button>
            )
          })() : null}

          {/* Reply snippet */}
          {m.replySnippet ? (() => {
            // Parse media reply format: "📷|path|caption" or "🎥|path|caption" or "🎤|text" or plain text
            const isImageReply = m.replySnippet.startsWith('📷|')
            const isVideoReply = m.replySnippet.startsWith('🎥|')
            const isAudioReply = m.replySnippet.startsWith('🎤|')
            
            let mediaPath: string | null = null
            let displayText = m.replySnippet
            
            if (isImageReply || isVideoReply) {
              const parts = m.replySnippet.split('|')
              if (parts.length >= 3) {
                mediaPath = parts[1]
                displayText = parts.slice(2).join('|') || (isImageReply ? 'Photo' : 'Video')
              }
            } else if (isAudioReply) {
              displayText = m.replySnippet.substring(2) || 'Voice message'
            }
            
            return (
              <div className="mb-2 flex items-stretch gap-0 bg-black/20 rounded-lg overflow-hidden">
                {/* WhatsApp-style left accent bar */}
                <div className={`w-1 flex-shrink-0 ${m.sent ? 'bg-white/40' : 'bg-[#4db6ac]'}`} />
                <div className="flex-1 px-2.5 py-1.5 min-w-0 flex items-center gap-2">
                  {/* Media thumbnail for image/video replies */}
                  {mediaPath && isImageReply && (
                    <div className="w-9 h-9 rounded overflow-hidden flex-shrink-0 bg-black/30">
                      <img 
                        src={normalizeMediaPath(mediaPath)} 
                        alt="" 
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  {mediaPath && isVideoReply && (
                    <div className="w-9 h-9 rounded bg-black/40 flex items-center justify-center flex-shrink-0">
                      <i className="fa-solid fa-play text-white/60 text-xs" />
                    </div>
                  )}
                  {isAudioReply && (
                    <div className="w-7 h-7 rounded-full bg-black/30 flex items-center justify-center flex-shrink-0">
                      <i className="fa-solid fa-microphone text-white/50 text-[10px]" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={`text-[11px] font-medium truncate ${m.sent ? 'text-white/70' : 'text-[#4db6ac]'}`}>
                      {m.sent ? otherDisplayName : 'You'}
                    </div>
                    <div className="text-[12px] text-white/60 line-clamp-1 mt-0.5 flex items-center gap-1">
                      {isImageReply && <i className="fa-solid fa-camera text-[10px] text-white/40" />}
                      {isVideoReply && <i className="fa-solid fa-video text-[10px] text-white/40" />}
                      <span className="truncate">{displayText}</span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })() : null}

          {/* Audio message */}
          {m.audio_path && !m.image_path ? (
            <AudioMessage
              message={m}
              audioPath={normalizeMediaPath(m.audio_path)}
            />
          ) : null}

          {/* Image display */}
          {m.image_path ? (
            <div className="mb-1.5">
              <MessageImage
                src={normalizeMediaPath(m.image_path)}
                alt="Shared photo"
                className="max-w-full max-h-64 cursor-pointer"
                onClick={() => onImageClick(normalizeMediaPath(m.image_path!))}
              />
            </div>
          ) : null}

          {/* Video display */}
          {m.video_path ? (
            <div className="mb-1.5" onClick={(e) => e.stopPropagation()}>
              <MessageVideo
                src={normalizeMediaPath(m.video_path)}
                className="max-h-64"
              />
            </div>
          ) : null}

          {/* Encryption indicator */}
          {Boolean(m.is_encrypted) && !m.decryption_error && (
            <div className="flex items-center gap-1.5 mb-1.5 text-[11px] text-[#7fe7df]">
              <i className="fa-solid fa-lock text-[10px]" />
              <span className="font-medium">End-to-end encrypted</span>
            </div>
          )}

          {/* Decryption error indicator */}
          {m.decryption_error && (
            <div className="flex items-center gap-1.5 mb-1.5 text-[11px] text-red-400">
              <i className="fa-solid fa-triangle-exclamation text-[10px]" />
              <span className="font-medium">Decryption failed</span>
            </div>
          )}

          {/* Text content or editor */}
          {isEditing ? (
            <div 
              className="min-w-[280px] sm:min-w-[320px]"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <textarea
                className="w-full bg-black/30 border border-white/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#4db6ac] resize-none"
                value={editText}
                onChange={(e) => onEditTextChange(e.target.value)}
                rows={2}
                autoFocus
                placeholder="Edit message..."
              />
              <div className="flex gap-2 justify-end mt-1.5">
                <button
                  className="px-2.5 py-1 text-xs text-white/60 hover:text-white/80 transition-colors"
                  onClick={onCancelEdit}
                >
                  Cancel
                </button>
                <button
                  className={`px-3 py-1 text-xs rounded-md flex items-center gap-1.5 ${
                    editingSaving
                      ? 'bg-gray-600 text-gray-300'
                      : 'bg-[#4db6ac] text-black hover:brightness-110'
                  }`}
                  onClick={editingSaving ? undefined : onCommitEdit}
                  disabled={editingSaving}
                >
                  {editingSaving ? (
                    <i className="fa-solid fa-spinner fa-spin text-[10px]" />
                  ) : (
                    <i className="fa-solid fa-check text-[10px]" />
                  )}
                  <span>Save</span>
                </button>
              </div>
            </div>
          ) : m.text ? (
            <div
              className="inline"
              onDoubleClick={() => {
                if (!m.sent || !onEdit) return
                // Enforce 5-minute window on client
                const dt = parseMessageTime(m.time)
                if (dt && Date.now() - dt.getTime() > 5 * 60 * 1000) return
                onEdit()
              }}
            >
              {linkifyText(m.text)}
              {m.edited_at ? (
                <span className="text-[10px] text-white/50 ml-1">edited</span>
              ) : null}
              <span className={`text-[10px] ml-2 ${m.sent ? 'text-white/60' : 'text-white/45'}`}>
                {formatMessageTime(m.time)}
              </span>
              {/* Reaction emoji - inline with timestamp */}
              {m.reaction ? (
                <span className="text-sm ml-1 select-none align-middle">
                  {m.reaction}
                </span>
              ) : null}
            </div>
          ) : (
            <span className={`text-[10px] ${m.sent ? 'text-white/60' : 'text-white/45'}`}>
              {formatMessageTime(m.time)}
              {/* Reaction emoji - inline with timestamp */}
              {m.reaction ? (
                <span className="text-sm ml-1 select-none align-middle">
                  {m.reaction}
                </span>
              ) : null}
            </span>
          )}
        </div>
      </div>
    </LongPressActionable>
  )
}
