/**
 * Single group-chat message row. Extracted for React.memo so parent state churn
 * (keyboard, polls, composer) does not re-run link/video parsing for every message.
 */
import { memo, useMemo, type ReactNode } from 'react'
import Avatar from '../components/Avatar'
import LongPressActionable from './LongPressActionable'
import { formatDateLabel, normalizeMediaPath } from './index'
import MessageImage from '../components/MessageImage'
import VoiceNotePlayer from '../components/VoiceNotePlayer'
import LinkPreview, { stripExtractedUrlsFromText, feedLinkPreviewUrls } from '../components/LinkPreview'
import VideoEmbed from '../components/VideoEmbed'
import YouTubeChatSnippet from '../components/YouTubeChatSnippet'
import { extractVideoEmbedFromPost, removeVideoUrlFromText } from '../utils/videoEmbed'

export type GroupChatMessageRowModel = {
  id: number
  sender: string
  text: string | null
  image: string | null
  voice: string | null
  video?: string | null
  media_paths?: string[] | null
  client_key?: string | null
  audio_duration_seconds?: number
  audio_summary?: string | null
  created_at: string
  profile_picture: string | null
  replySnippet?: string
  replySender?: string
  is_edited?: boolean
  reaction?: string | null
}

export type GroupMessageRowProps = {
  msg: GroupChatMessageRowModel & {
    clientKey?: string
    replySnippet?: string
    replySender?: string
    isOptimistic?: boolean
    sendFailed?: boolean
  }
  showAvatar: boolean
  showTime: boolean
  showDateSeparator: boolean
  messageReaction?: string
  isSentByMe: boolean
  isOptimistic: boolean
  sendFailed: boolean
  clientKey?: string
  selectionMode: boolean
  isSelected: boolean
  onToggleSelect: () => void
  onReact: (emoji: string) => void
  onReply: () => void
  onCopy: () => void
  onDelete: () => void
  onEdit?: () => void
  onEnterSelectMode?: () => void
  isEditing: boolean
  editText: string
  onEditTextChange: (v: string) => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  editingSaving: boolean
  formatTime: (dateStr: string) => string
  renderMessageText: (text: string) => ReactNode
  currentUsername: string
  translationForMessage?: string
  translatingThis: boolean
  onTranslatePress: () => void
  onClearTranslation: () => void
  canEditSummary: boolean
  onEditSummaryPress: () => void
  onOpenMediaGroup: (urls: string[]) => void
  onOpenImage: (path: string) => void
  onOpenVideo: (path: string) => void
  onRetry?: () => void
}

function GroupMessageRowInner(props: GroupMessageRowProps) {
  const {
    msg,
    showAvatar,
    showTime,
    showDateSeparator,
    messageReaction,
    isSentByMe,
    isOptimistic,
    sendFailed,
    clientKey,
    selectionMode,
    isSelected,
    onToggleSelect,
    onReact,
    onReply,
    onCopy,
    onDelete,
    onEdit,
    onEnterSelectMode,
    isEditing,
    editText,
    onEditTextChange,
    onCancelEdit,
    onSaveEdit,
    editingSaving,
    formatTime,
    renderMessageText,
    translationForMessage,
    translatingThis,
    onTranslatePress,
    onClearTranslation,
    canEditSummary,
    onEditSummaryPress,
    onOpenMediaGroup,
    onOpenImage,
    onOpenVideo,
    onRetry,
  } = props

  const { videoEmbed, bubbleTextWithoutUrls, linkPreviewUrls, replySnippet, replySender } = useMemo(() => {
    let displayText = msg.text
    let rs = msg.replySnippet
    let rsend = msg.replySender
    if (displayText && !rs) {
      const replyMatch = displayText.match(/^\[REPLY:([^:]+):([^\]]+)\](?:\r?\n|\s)*(.*)$/s)
      if (replyMatch) {
        rsend = replyMatch[1]
        rs = replyMatch[2]
        displayText = replyMatch[3]
      }
    }
    const ve = extractVideoEmbedFromPost(displayText || '', undefined)
    const textAfterVideo = ve ? removeVideoUrlFromText(displayText || '', ve) : (displayText || '')
    const urls = textAfterVideo ? feedLinkPreviewUrls(textAfterVideo, ve?.embedUrl ?? null) : []
    const bubbleText =
      urls.length > 0 && textAfterVideo ? stripExtractedUrlsFromText(textAfterVideo, urls) : textAfterVideo
    return { videoEmbed: ve, bubbleTextWithoutUrls: bubbleText, linkPreviewUrls: urls, replySnippet: rs, replySender: rsend }
  }, [msg.text, msg.replySnippet, msg.replySender])

  return (
    <div>
      {showDateSeparator && (
        <div className="flex justify-center my-3">
          <div className="liquid-glass-chip px-3 py-1 text-xs text-white/80 border">{formatDateLabel(msg.created_at)}</div>
        </div>
      )}
      <div
        className={`flex gap-2 ${showAvatar ? 'mt-4 first:mt-0' : 'mt-0.5'} ${isSentByMe ? 'flex-row-reverse' : ''} ${sendFailed ? 'opacity-60' : isOptimistic ? 'opacity-70' : ''}`}
      >
        <div className="w-8 flex-shrink-0">
          {showAvatar && msg.sender && !isSentByMe && (
            <Avatar username={msg.sender} url={msg.profile_picture || undefined} size={32} linkToProfile />
          )}
        </div>
        <div className={`flex-1 min-w-0 ${isSentByMe ? 'flex flex-col items-end' : ''}`}>
          {showAvatar && msg.sender && !isSentByMe && (
            <div className="flex items-baseline gap-2 mb-0.5">
              <span className="text-sm font-medium text-white/90">{msg.sender}</span>
              <span className="text-[11px] text-[#9fb0b5]">{formatTime(msg.created_at)}</span>
            </div>
          )}
          <div className={`flex items-end gap-2 ${isSentByMe ? 'flex-row-reverse' : ''}`}>
            {selectionMode && isSentByMe && (
              <button
                type="button"
                onClick={onToggleSelect}
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  isSelected ? 'bg-[#4db6ac] border-[#4db6ac]' : 'border-white/40 bg-transparent'
                }`}
              >
                {isSelected && <i className="fa-solid fa-check text-black text-xs" />}
              </button>
            )}
            <LongPressActionable
              onReact={onReact}
              onReply={onReply}
              onCopy={onCopy}
              onDelete={onDelete}
              onEdit={onEdit}
              onSelect={onEnterSelectMode}
              disabled={(isOptimistic && !sendFailed) || isEditing || selectionMode}
            >
              <div className={`relative ${messageReaction ? 'mb-5' : ''}`}>
                {isEditing ? (
                  <div className="flex flex-col gap-2 max-w-[280px]">
                    <textarea
                      value={editText}
                      onChange={e => onEditTextChange(e.target.value)}
                      className="w-full bg-white/10 border border-[#4db6ac] rounded-lg px-3 py-2 text-[14px] text-white resize-none focus:outline-none"
                      rows={3}
                      autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={onCancelEdit}
                        className="px-3 py-1 text-xs text-white/60 hover:text-white"
                        disabled={editingSaving}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={onSaveEdit}
                        disabled={editingSaving || !editText.trim()}
                        className="px-3 py-1 text-xs bg-[#4db6ac] text-black rounded-lg disabled:opacity-50"
                      >
                        {editingSaving ? <i className="fa-solid fa-spinner fa-spin" /> : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  (bubbleTextWithoutUrls || replySnippet) && (
                    <div
                      className={`rounded-2xl max-w-[280px] ${isSentByMe ? 'rounded-br-lg' : 'rounded-bl-lg'} ${
                        isOptimistic
                          ? 'bg-[#4db6ac]/40 border border-[#4db6ac]/30'
                          : `liquid-glass-bubble ${isSentByMe ? 'liquid-glass-bubble--sent' : 'liquid-glass-bubble--received'}`
                      }`}
                    >
                      {replySnippet && (
                        <div className="px-3 pt-2 pb-1 border-b border-white/10">
                          <div className="flex items-stretch gap-0 bg-black/20 rounded overflow-hidden">
                            <div className="w-0.5 bg-[#4db6ac] flex-shrink-0" />
                            <div className="px-2 py-1 min-w-0">
                              <div className="text-[10px] text-[#4db6ac] font-medium truncate">{replySender}</div>
                              <div className="text-[11px] text-white/60 whitespace-pre-wrap break-words leading-[1.25]">
                                {(() => {
                                  if (replySnippet.startsWith('📷|') || replySnippet.startsWith('🎥|')) {
                                    const parts = replySnippet.split('|')
                                    const isImage = replySnippet.startsWith('📷|')
                                    const icon = isImage ? 'fa-image' : 'fa-video'
                                    const defaultLabel = isImage ? 'Photo' : 'Video'
                                    const caption =
                                      parts.length > 2 ? parts.slice(2).join('|').trim() || defaultLabel : defaultLabel
                                    return (
                                      <span className="inline-flex items-center gap-1">
                                        <i className={`fa-solid ${icon} text-[9px]`} /> {caption}
                                      </span>
                                    )
                                  }
                                  if (replySnippet.startsWith('🎤|')) {
                                    return (
                                      <>
                                        <i className="fa-solid fa-microphone text-[9px]" />
                                        {replySnippet.length > 2 ? replySnippet.slice(2).trim() : 'Voice message'}
                                      </>
                                    )
                                  }
                                  return replySnippet
                                })()}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {bubbleTextWithoutUrls?.trim() && (
                        <div className="text-[14px] text-white whitespace-pre-wrap break-words px-3 py-2">
                          {renderMessageText(bubbleTextWithoutUrls)}
                          {isOptimistic && (
                            <span className="ml-2 text-[10px] text-white/60">
                              <i className="fa-solid fa-clock text-[8px] mr-1" />
                            </span>
                          )}
                          {msg.is_edited && !isOptimistic && (
                            <span className="ml-2 text-[10px] text-white/40 italic">(edited)</span>
                          )}
                        </div>
                      )}
                      {videoEmbed && (
                        <div className="px-2 pb-2 w-full min-w-0">
                          {videoEmbed.type === 'youtube' ? (
                            <YouTubeChatSnippet videoId={videoEmbed.videoId} />
                          ) : (
                            <VideoEmbed embed={videoEmbed} />
                          )}
                        </div>
                      )}
                      {linkPreviewUrls.map(u => (
                        <div key={u} className="px-2 pb-2">
                          <LinkPreview url={u} sent={isSentByMe} />
                        </div>
                      ))}
                    </div>
                  )
                )}
                {msg.media_paths && msg.media_paths.length > 0 ? (
                  <div className="mt-1 max-w-[280px]">
                    <div
                      className="relative cursor-pointer"
                      role="presentation"
                      onClick={e => {
                        e.stopPropagation()
                        onOpenMediaGroup(msg.media_paths!.map(normalizeMediaPath))
                      }}
                    >
                      {msg.media_paths[0].match(/\.(mp4|mov|webm|m4v)$/i) ? (
                        <div className="relative">
                          <video
                            src={normalizeMediaPath(msg.media_paths[0]) + '#t=0.1'}
                            className="w-full rounded-lg"
                            muted
                            preload="metadata"
                            playsInline
                          />
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
                              <i className="fa-solid fa-play text-white text-lg ml-0.5" />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <MessageImage
                          src={normalizeMediaPath(msg.media_paths[0])}
                          alt="Media"
                          className="w-full rounded-lg"
                        />
                      )}
                      {msg.media_paths.length > 1 && (
                        <div className="absolute inset-0 bg-black/30 rounded-lg flex items-center justify-center">
                          <span className="text-white text-2xl font-semibold">{msg.media_paths.length}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {msg.image && (
                      <div
                        className="mt-1 max-w-[280px] cursor-pointer"
                        role="presentation"
                        onClick={e => {
                          e.stopPropagation()
                          onOpenImage(normalizeMediaPath(msg.image!))
                        }}
                      >
                        <MessageImage
                          src={normalizeMediaPath(msg.image)}
                          alt="Shared image"
                          className="w-full rounded-lg"
                        />
                      </div>
                    )}
                    {msg.video && (
                      <div
                        className="relative mt-1 max-w-[280px] cursor-pointer"
                        role="presentation"
                        onClick={e => {
                          e.stopPropagation()
                          onOpenVideo(normalizeMediaPath(msg.video!))
                        }}
                      >
                        <video
                          src={normalizeMediaPath(msg.video) + '#t=0.1'}
                          preload="metadata"
                          playsInline
                          muted
                          className="w-full rounded-lg"
                        />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
                            <i className="fa-solid fa-play text-white text-lg ml-0.5" />
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
                {msg.voice && (
                  <>
                    <VoiceNotePlayer audioPath={normalizeMediaPath(msg.voice)} durationSeconds={msg.audio_duration_seconds} />
                    {msg.audio_summary ? (
                      <div className="px-2 pb-1 pt-0.5">
                        <div className="text-[11px] text-white/50 flex items-center gap-1 mb-0.5">
                          <i className="fa-solid fa-wand-magic-sparkles text-[9px]" />
                          <span>{translationForMessage ? 'Steve summary (translated)' : 'Steve summary'}</span>
                          <div className="ml-auto flex items-center gap-1">
                            {translationForMessage && (
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation()
                                  onClearTranslation()
                                }}
                                className="text-white/30 hover:text-white/50 px-0.5"
                              >
                                <i className="fa-solid fa-rotate-left text-[8px]" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation()
                                onTranslatePress()
                              }}
                              className="text-white/30 hover:text-white/50 px-0.5"
                              disabled={translatingThis}
                            >
                              {translatingThis ? (
                                <i className="fa-solid fa-spinner fa-spin text-[9px]" />
                              ) : (
                                <i className="fa-solid fa-globe text-[9px]" />
                              )}
                            </button>
                            {canEditSummary && (
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation()
                                  onEditSummaryPress()
                                }}
                                className="text-white/30 hover:text-white/50 px-0.5"
                              >
                                <i className="fa-solid fa-pen text-[8px]" />
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="text-[12px] text-white/80 leading-relaxed italic">
                          {translationForMessage || msg.audio_summary}
                        </p>
                      </div>
                    ) : (
                      (() => {
                        try {
                          const t = new Date(msg.created_at).getTime()
                          if (Date.now() - t < 120000)
                            return (
                              <div className="px-2 pb-1 pt-0.5">
                                <div className="flex items-center gap-1">
                                  <i className="fa-solid fa-wand-magic-sparkles text-[9px] text-white/40" />
                                  <span className="text-[11px] text-white/40">Steve summary generating</span>
                                  <span className="flex gap-0.5 ml-0.5">
                                    <span
                                      className="w-1 h-1 bg-[#4db6ac] rounded-full animate-bounce"
                                      style={{ animationDelay: '0ms' }}
                                    />
                                    <span
                                      className="w-1 h-1 bg-[#4db6ac] rounded-full animate-bounce"
                                      style={{ animationDelay: '150ms' }}
                                    />
                                    <span
                                      className="w-1 h-1 bg-[#4db6ac] rounded-full animate-bounce"
                                      style={{ animationDelay: '300ms' }}
                                    />
                                  </span>
                                </div>
                              </div>
                            )
                        } catch {
                          /* ignore */
                        }
                        return null
                      })()
                    )}
                  </>
                )}
                {messageReaction && (
                  <div
                    className="absolute -bottom-5 left-0 bg-[#1a1a1a] border border-white/10 rounded-full px-1.5 py-0.5 text-sm cursor-pointer hover:bg-white/10"
                    role="presentation"
                    onClick={e => {
                      e.stopPropagation()
                      onReact(messageReaction)
                    }}
                  >
                    {messageReaction}
                  </div>
                )}
              </div>
            </LongPressActionable>
            {!showAvatar && showTime && (
              <span className="text-[10px] text-[#9fb0b5]/60 flex-shrink-0 pb-0.5">
                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          {sendFailed && isSentByMe && clientKey && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1.5 mt-1 text-[11px] text-red-400 hover:text-red-300 self-end"
            >
              <i className="fa-solid fa-circle-exclamation text-[10px]" />
              Not delivered — tap to retry
            </button>
          )}
          {isOptimistic && !sendFailed && isSentByMe && (
            <div className="flex items-center gap-1 mt-0.5 self-end">
              <i className="fa-solid fa-clock text-[9px] text-white/30" />
              <span className="text-[10px] text-white/30">Sending…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function rowPropsAreEqual(a: GroupMessageRowProps, b: GroupMessageRowProps) {
  return (
    a.msg === b.msg &&
    a.showAvatar === b.showAvatar &&
    a.showTime === b.showTime &&
    a.showDateSeparator === b.showDateSeparator &&
    a.messageReaction === b.messageReaction &&
    a.isSentByMe === b.isSentByMe &&
    a.isOptimistic === b.isOptimistic &&
    a.sendFailed === b.sendFailed &&
    a.clientKey === b.clientKey &&
    a.selectionMode === b.selectionMode &&
    a.isSelected === b.isSelected &&
    a.isEditing === b.isEditing &&
    a.editText === b.editText &&
    a.editingSaving === b.editingSaving &&
    a.formatTime === b.formatTime &&
    a.renderMessageText === b.renderMessageText &&
    a.currentUsername === b.currentUsername &&
    a.translationForMessage === b.translationForMessage &&
    a.translatingThis === b.translatingThis &&
    a.canEditSummary === b.canEditSummary
  )
}

export const GroupMessageRow = memo(GroupMessageRowInner, rowPropsAreEqual)
