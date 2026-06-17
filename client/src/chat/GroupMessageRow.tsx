/**
 * Single group-chat message row. Extracted for React.memo so parent state churn
 * (keyboard, polls, composer) does not re-run link/video parsing for every message.
 */
import { memo, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Avatar from '../components/Avatar'
import LongPressActionable from './LongPressActionable'
import { SwipeToReply } from './SwipeToReply'
import { formatDateLabel, normalizeMediaPath, resolveDocUrl, stripReplyMarker } from './index'
import MessageImage from '../components/MessageImage'
import MessageVideo from '../components/MessageVideo'
import VoiceNotePlayer from '../components/VoiceNotePlayer'
import LinkPreview, { stripExtractedUrlsFromText, feedLinkPreviewUrls } from '../components/LinkPreview'
import VideoEmbed from '../components/VideoEmbed'
import { renderBoldText } from '../utils/linkUtils'
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
  file_path?: string | null
  file_name?: string | null
  document?: string | null
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
  renderMessageText: (text: string, isSent?: boolean) => ReactNode
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
  onRemoveMediaItem?: (messageId: number, mediaUrl: string) => void
  /** When false, defer link-preview network until thread list is revealed. */
  linkPreviewReady?: boolean
}

function GroupMessageRowInner(props: GroupMessageRowProps) {
  const { t } = useTranslation()
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
    onRemoveMediaItem,
    linkPreviewReady = true,
  } = props

  const { videoEmbed, bubbleTextWithoutUrls, linkPreviewUrls, replySnippet, replySender } = useMemo(() => {
    let displayText = msg.text
    let rs = msg.replySnippet
    let rsend = msg.replySender
    if (displayText && !rs) {
      const replyMatch = displayText.match(/^\[REPLY:([^:]+):([^\]]+)\](?:\r?\n|\s)*(.*)$/s)
      if (replyMatch) {
        rsend = replyMatch[1]
        rs = stripReplyMarker(replyMatch[2])
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

  const removableMedia =
    isSentByMe &&
    !isOptimistic &&
    !sendFailed &&
    msg.media_paths &&
    msg.media_paths.length >= 2
      ? msg.media_paths
      : []

  const longPressOptionalActions =
    onRemoveMediaItem && removableMedia.length > 0
      ? removableMedia.map((url, i) => ({
          label: removableMedia.length > 1 ? t('chat.remove_item', { number: i + 1 }) : t('chat.remove_attachment'),
          danger: true as const,
          iconClass: 'fa-regular fa-image',
          onClick: () => onRemoveMediaItem(msg.id, url),
        }))
      : undefined

  return (
    <div>
      {showDateSeparator && (
        <div className="flex justify-center my-3">
          <div className="liquid-glass-chip px-3 py-1 text-xs text-c-text-secondary border">{formatDateLabel(msg.created_at)}</div>
        </div>
      )}
      <SwipeToReply
        onReply={onReply}
        disabled={selectionMode || isEditing || (isOptimistic && !sendFailed)}
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
              <span className="text-sm font-medium text-c-text-primary">{msg.sender}</span>
              <span className="text-[11px] text-c-text-tertiary">{formatTime(msg.created_at)}</span>
            </div>
          )}
          <div className={`flex items-end gap-2 ${isSentByMe ? 'flex-row-reverse' : ''}`}>
            {selectionMode && isSentByMe && (
              <button
                type="button"
                onClick={onToggleSelect}
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  isSelected ? 'bg-cpoint-turquoise border-cpoint-turquoise' : 'border-white/40 bg-transparent'
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
              optionalActions={longPressOptionalActions}
              disabled={(isOptimistic && !sendFailed) || isEditing || selectionMode}
            >
              <div className={`relative ${isEditing ? 'w-full' : ''} ${messageReaction ? 'mb-5' : ''}`}>
                {isEditing ? (
                  <div
                    className="flex flex-col gap-2 w-full"
                    onClick={e => e.stopPropagation()}
                    onMouseDown={e => e.stopPropagation()}
                  >
                    <textarea
                      value={editText}
                      onChange={e => onEditTextChange(e.target.value)}
                      className="w-full bg-c-bg-recessed border border-cpoint-turquoise rounded-lg px-3 py-2 text-[14px] text-c-text-primary resize-none focus:outline-none overscroll-contain max-h-[40vh]"
                      style={{ touchAction: 'auto' }}
                      rows={4}
                      autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={onCancelEdit}
                        className="px-3 py-1 text-xs text-c-text-tertiary hover:text-c-text-primary"
                        disabled={editingSaving}
                      >
                        {t('chat.cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={onSaveEdit}
                        disabled={editingSaving || !editText.trim()}
                        className="px-3 py-1 text-xs bg-cpoint-turquoise text-black rounded-lg disabled:opacity-50"
                      >
                        {editingSaving ? <i className="fa-solid fa-spinner fa-spin" /> : t('chat.save')}
                      </button>
                    </div>
                  </div>
                ) : (
                  (bubbleTextWithoutUrls || replySnippet) && (
                    <div
                      className={`rounded-2xl max-w-[280px] ${isSentByMe ? 'rounded-br-lg' : 'rounded-bl-lg'} ${
                        isOptimistic
                          ? 'bg-cpoint-turquoise/40 border border-cpoint-turquoise/30'
                          : `liquid-glass-bubble ${isSentByMe ? 'liquid-glass-bubble--sent' : 'liquid-glass-bubble--received'}`
                      }`}
                    >
                      {replySnippet && (
                        <div className="px-3 pt-2 pb-1 border-b border-c-border">
                          <div className="flex items-stretch gap-0 bg-c-bg-reply rounded overflow-hidden">
                            <div className="w-0.5 bg-cpoint-turquoise flex-shrink-0" />
                            <div className="px-2 py-1 min-w-0">
                              <div className="text-[10px] text-cpoint-turquoise font-medium truncate">{replySender}</div>
                              <div className="text-[11px] text-c-text-secondary whitespace-pre-wrap break-words leading-[1.25]">
                                {(() => {
                                  if (replySnippet.startsWith('📷|') || replySnippet.startsWith('🎥|')) {
                                    const parts = replySnippet.split('|')
                                    const isImage = replySnippet.startsWith('📷|')
                                    const icon = isImage ? 'fa-image' : 'fa-video'
                                    const defaultLabel = isImage ? t('chat.photo') : t('chat.video')
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
                                        {replySnippet.length > 2 ? replySnippet.slice(2).trim() : t('chat.voice_message')}
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
                        <div className={`text-[14px] ${isSentByMe ? 'text-white' : 'text-c-text-primary'} whitespace-pre-wrap break-words px-3 py-2`}>
                          {renderMessageText(bubbleTextWithoutUrls, isSentByMe)}
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
                          <LinkPreview url={u} sent={isSentByMe} deferFetch={!linkPreviewReady} />
                        </div>
                      ))}
                    </div>
                  )
                )}
                {msg.media_paths && msg.media_paths.length > 0 ? (
                  <div className="mt-1 max-w-[280px] min-h-[120px]">
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
                          <MessageVideo src={normalizeMediaPath(msg.media_paths[0])} />
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
                              <i className="fa-solid fa-play text-white text-lg ml-0.5" />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <MessageImage
                          src={normalizeMediaPath(msg.media_paths[0])}
                          alt={t('chat.media_preview_alt')}
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
                          alt={t('chat.shared_image_alt')}
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
                        <MessageVideo src={normalizeMediaPath(msg.video)} />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
                            <i className="fa-solid fa-play text-white text-lg ml-0.5" />
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
                {(msg.file_path || msg.document) && (
                  <a
                    href={resolveDocUrl(msg.file_path || msg.document || '')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 flex items-center gap-3 max-w-[280px] rounded-xl border border-c-border bg-white/[0.06] px-3 py-2.5 hover:bg-c-hover-bg transition-colors"
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="w-10 h-10 rounded-lg bg-cpoint-turquoise/20 flex items-center justify-center flex-shrink-0">
                      <i className="fa-solid fa-file-pdf text-cpoint-turquoise text-lg" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-c-text-primary font-medium truncate">
                        {msg.file_name || t('chat.pdf_document')}
                      </div>
                      <div className="text-[10px] text-c-text-tertiary">PDF</div>
                    </div>
                    <i className="fa-solid fa-arrow-up-right-from-square text-c-text-tertiary text-xs flex-shrink-0" />
                  </a>
                )}
                {msg.voice && (
                  <>
                    <VoiceNotePlayer audioPath={normalizeMediaPath(msg.voice)} durationSeconds={msg.audio_duration_seconds} />
                    {msg.audio_summary ? (
                      <div className="px-2 pb-1 pt-0.5">
                        <div className="text-[11px] text-c-text-tertiary flex items-center gap-1 mb-0.5">
                          <i className="fa-solid fa-wand-magic-sparkles text-[9px]" />
                          <span>{translationForMessage ? t('feed.steve_summary_translated') : t('feed.steve_summary')}</span>
                          <div className="ml-auto flex items-center gap-1">
                            {translationForMessage && (
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation()
                                  onClearTranslation()
                                }}
                                className="text-c-text-disabled hover:text-c-text-tertiary px-0.5"
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
                              className="text-c-text-disabled hover:text-c-text-tertiary px-0.5"
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
                                className="text-c-text-disabled hover:text-c-text-tertiary px-0.5"
                              >
                                <i className="fa-solid fa-pen text-[8px]" />
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="text-[12px] text-c-text-secondary leading-relaxed italic whitespace-pre-wrap">
                          {renderBoldText(translationForMessage || msg.audio_summary || '')}
                        </p>
                      </div>
                    ) : (
                      (() => {
                        try {
                          const createdMs = new Date(msg.created_at).getTime()
                          if (Date.now() - createdMs < 120000)
                            return (
                              <div className="px-2 pb-1 pt-0.5">
                                <div className="flex items-center gap-1">
                                  <i className="fa-solid fa-wand-magic-sparkles text-[9px] text-c-text-tertiary" />
                                  <span className="text-[11px] text-c-text-tertiary">{t('feed.steve_summary_generating')}</span>
                                  <span className="flex gap-0.5 ml-0.5">
                                    <span
                                      className="w-1 h-1 bg-cpoint-turquoise rounded-full animate-bounce"
                                      style={{ animationDelay: '0ms' }}
                                    />
                                    <span
                                      className="w-1 h-1 bg-cpoint-turquoise rounded-full animate-bounce"
                                      style={{ animationDelay: '150ms' }}
                                    />
                                    <span
                                      className="w-1 h-1 bg-cpoint-turquoise rounded-full animate-bounce"
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
                    className="absolute -bottom-5 left-0 bg-c-bg-surface border border-c-border rounded-full px-1.5 py-0.5 text-sm cursor-pointer hover:bg-c-hover-bg chat-reaction-pop"
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
              <span className="text-[10px] text-c-text-tertiary flex-shrink-0 pb-0.5">
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
        </div>
      </SwipeToReply>
    </div>
  )
}

// Compare the message CONTENT fields the row actually renders, instead of relying on
// `a.msg === b.msg`. The thread page rebuilds a fresh `{ ...msg, clientKey, ... }` object on
// every render (renderItem in GroupChatThread.tsx), so reference equality was ALWAYS false —
// which silently defeated this memo and made every row re-render on every parent render
// (~2×/sec under the 1.5s poll, plus every keystroke/keyboard/selection change). Field
// comparison lets unchanged rows skip. Mirrors the proven DM MessageBubble comparator.
function groupMsgContentEqual(a: any, b: any): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (
    a.id !== b.id ||
    a.text !== b.text ||
    a.reaction !== b.reaction ||
    a.replySnippet !== b.replySnippet ||
    a.replySender !== b.replySender ||
    a.sender !== b.sender ||
    a.profile_picture !== b.profile_picture ||
    a.created_at !== b.created_at ||
    a.is_edited !== b.is_edited ||
    a.edited_at !== b.edited_at ||
    a.image !== b.image ||
    a.video !== b.video ||
    a.voice !== b.voice ||
    a.audio_duration_seconds !== b.audio_duration_seconds ||
    a.audio_summary !== b.audio_summary ||
    a.file_path !== b.file_path ||
    a.document !== b.document ||
    a.file_name !== b.file_name
  ) return false
  const am = a.media_paths, bm = b.media_paths
  if (am === bm) return true
  if (!am || !bm || am.length !== bm.length) return false
  for (let i = 0; i < am.length; i++) if (am[i] !== bm[i]) return false
  return true
}

function rowPropsAreEqual(a: GroupMessageRowProps, b: GroupMessageRowProps) {
  return (
    groupMsgContentEqual(a.msg, b.msg) &&
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
    a.canEditSummary === b.canEditSummary &&
    a.onRemoveMediaItem === b.onRemoveMediaItem &&
    a.linkPreviewReady === b.linkPreviewReady
  )
}

export const GroupMessageRow = memo(GroupMessageRowInner, rowPropsAreEqual)
