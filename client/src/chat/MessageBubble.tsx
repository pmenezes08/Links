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
  /** Handler to update edit text */
  onEditTextChange: (text: string) => void
  /** Handler to commit edit */
  onCommitEdit: () => void
  /** Handler to cancel edit */
  onCancelEdit: () => void
  /** Handler for image preview */
  onImageClick: (imagePath: string) => void
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
  onEditTextChange,
  onCommitEdit,
  onCancelEdit,
  onImageClick,
  linkifyText,
}: MessageBubbleProps) {
  return (
    <LongPressActionable
      onDelete={onDelete}
      onReact={onReact}
      onReply={onReply}
      onCopy={onCopy}
      onEdit={onEdit}
      disabled={isEditing}
    >
      <div className={`flex ${m.sent ? 'justify-end' : 'justify-start'}`}>
        <div
          className={`liquid-glass-bubble ${m.sent ? 'liquid-glass-bubble--sent text-white' : 'liquid-glass-bubble--received text-white'} max-w-[82%] md:max-w-[65%] px-2.5 py-1.5 rounded-2xl text-[14px] leading-tight whitespace-pre-wrap break-words ${
            m.sent ? 'rounded-br-xl' : 'rounded-bl-xl'
          } ${m.isOptimistic ? 'opacity-70' : 'opacity-100'}`}
          style={{
            position: 'relative',
            ...(m.reaction ? { paddingRight: '1.75rem', paddingBottom: '1.25rem' } : {}),
          } as React.CSSProperties}
        >
          {/* Reply snippet */}
          {m.replySnippet ? (
            <div className="mb-2 flex items-stretch gap-0 bg-black/20 rounded-lg overflow-hidden">
              {/* WhatsApp-style left accent bar */}
              <div className={`w-1 flex-shrink-0 ${m.sent ? 'bg-white/40' : 'bg-[#4db6ac]'}`} />
              <div className="flex-1 px-2.5 py-1.5 min-w-0">
                <div className={`text-[11px] font-medium truncate ${m.sent ? 'text-white/70' : 'text-[#4db6ac]'}`}>
                  {m.sent ? otherDisplayName : 'You'}
                </div>
                <div className="text-[12px] text-white/60 line-clamp-1 mt-0.5">
                  {m.replySnippet}
                </div>
              </div>
            </div>
          ) : null}

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
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-white/60">
                <i className="fa-regular fa-pen-to-square" />
                <span>Edit message</span>
              </div>
              <div
                className="relative group"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                <textarea
                  className="w-full bg-black/30 border border-white/15 rounded-xl px-3 py-2 text-sm pr-10 focus:outline-none focus:border-[#4db6ac] shadow-inner"
                  value={editText}
                  onChange={(e) => onEditTextChange(e.target.value)}
                  rows={3}
                  placeholder="Edit your message..."
                />
                <button
                  className={`absolute top-2 right-2 w-8 h-8 rounded-lg flex items-center justify-center ${
                    editingSaving
                      ? 'bg-gray-600 text-gray-300'
                      : 'bg-[#4db6ac] text-black hover:brightness-110'
                  }`}
                  onClick={editingSaving ? undefined : onCommitEdit}
                  disabled={editingSaving}
                  title="Save"
                >
                  {editingSaving ? (
                    <i className="fa-solid fa-spinner fa-spin" />
                  ) : (
                    <i className="fa-solid fa-check" />
                  )}
                </button>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  className="px-3 py-1.5 text-xs bg-white/10 border border-white/20 rounded-lg hover:bg-white/15"
                  onClick={onCancelEdit}
                >
                  Cancel
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
            </div>
          ) : (
            <span className={`text-[10px] ${m.sent ? 'text-white/60' : 'text-white/45'}`}>
              {formatMessageTime(m.time)}
            </span>
          )}

          {/* Reaction emoji */}
          {m.reaction ? (
            <span className="absolute bottom-0.5 right-1 text-base leading-none select-none z-10">
              {m.reaction}
            </span>
          ) : null}
        </div>
      </div>
    </LongPressActionable>
  )
}
