import type { TFunction } from 'i18next'

const REPLY_PREFIX_RE = /^\[REPLY:([^:\]]+):([^\]]*)\](?:\r?\n|\s*)(.*)$/s
const STORY_REPLY_PREFIX_RE = /^\[STORY_REPLY:[^\]]+\](?:\r?\n|\s*)(.*)$/s

function parseReplySnippet(snippet: string, t: TFunction): string {
  const s = (snippet || '').trim()
  if (!s) return t('chat.preview_message')
  if (s.startsWith('📷|')) {
    const parts = s.split('|')
    const caption = (parts[2] || '').trim()
    return caption || t('chat.photo')
  }
  if (s.startsWith('🎥|')) {
    const parts = s.split('|')
    const caption = (parts[2] || '').trim()
    return caption || t('chat.video')
  }
  if (s.startsWith('🎤|')) {
    const summary = s.slice(2).trim()
    return summary || t('chat.voice_message')
  }
  return s
}

/** Human-readable last-message preview for DM and group chat lists. */
export function formatChatMessagePreview(text: string | null | undefined, t: TFunction): string {
  const raw = (text || '').trim()
  if (!raw) return t('chat.say_hello')

  if (raw.startsWith('[STORY_REPLY:')) {
    const storyReplyMatch = raw.match(STORY_REPLY_PREFIX_RE)
    if (storyReplyMatch) {
      const actualMessage = storyReplyMatch[1]?.trim()
      return actualMessage
        ? t('chat.replied_to_story_with', { message: actualMessage })
        : t('chat.replied_to_story')
    }
  }

  if (raw.startsWith('[REPLY:')) {
    const replyMatch = raw.match(REPLY_PREFIX_RE)
    if (replyMatch) {
      const sender = (replyMatch[1] || '').trim() || t('chat.preview_someone')
      const quoted = parseReplySnippet(replyMatch[2] || '', t)
      const body = (replyMatch[3] || '').trim()
      const content = body || quoted
      return t('chat.replied_to_user_preview', { name: sender, message: content })
    }
  }

  if (raw === '🔒 Encrypted message' || raw.toLowerCase() === 'encrypted message') {
    return t('chat.preview_encrypted')
  }

  const mediaLabels: Record<string, string> = {
    'Voice message': t('chat.voice_message'),
    Photo: t('chat.photo'),
    Video: t('chat.video'),
  }
  if (mediaLabels[raw]) return mediaLabels[raw]

  const mediaFilesMatch = raw.match(/^(\d+) media files$/)
  if (mediaFilesMatch) {
    return t('chat.preview_multiple_media', { count: mediaFilesMatch[1] })
  }

  const repliedMatch = raw.match(/^Replied to ([^:]+): (.+)$/s)
  if (repliedMatch) {
    return t('chat.replied_to_user_preview', {
      name: repliedMatch[1].trim(),
      message: repliedMatch[2].trim(),
    })
  }

  const storyMatch = raw.match(/^Replied to story: (.+)$/s)
  if (storyMatch) {
    return t('chat.replied_to_story_with', { message: storyMatch[1].trim() })
  }
  if (raw === 'Replied to a story') {
    return t('chat.replied_to_story')
  }

  return raw
}
