import { describe, expect, it } from 'vitest'
import { formatChatMessagePreview } from './chatMessagePreview'

const t = (key: string, opts?: Record<string, string>) => {
  const map: Record<string, string> = {
    'chat.say_hello': 'Say hello',
    'chat.replied_to_story_with': `Replied to story: ${opts?.message ?? ''}`,
    'chat.replied_to_story': 'Replied to a story',
    'chat.replied_to_user_preview': `Replied to ${opts?.name}: ${opts?.message}`,
    'chat.preview_encrypted': 'Encrypted message',
    'chat.preview_message': 'Message',
    'chat.preview_someone': 'User',
    'chat.photo': 'Photo',
    'chat.video': 'Video',
    'chat.voice_message': 'Voice message',
  }
  return map[key] ?? key
}

describe('formatChatMessagePreview', () => {
  it('shows say hello for empty preview', () => {
    expect(formatChatMessagePreview(null, t)).toBe('Say hello')
  })

  it('formats backend voice label as-is', () => {
    expect(formatChatMessagePreview('Voice message', t)).toBe('Voice message')
  })

  it('formats reply prefix for list display', () => {
    const raw = '[REPLY:alice:🎤|Voice message]\nThanks!'
    expect(formatChatMessagePreview(raw, t)).toBe('Replied to alice: Thanks!')
  })

  it('formats story reply', () => {
    expect(formatChatMessagePreview('[STORY_REPLY:1:image:/x.jpg]\nNice', t)).toBe('Replied to story: Nice')
  })

  it('does not leak a raw nested reply marker into the list preview', () => {
    // Reply-to-a-reply: body wins, and the snippet must never surface raw [REPLY:.
    const raw = '[REPLY:Paulo:[REPLY:diogorbmartins:Já deste]\nYa fiz]\nVou meter'
    const out = formatChatMessagePreview(raw, t)
    expect(out.startsWith('Replied to Paulo:')).toBe(true)
    expect(out).not.toContain('[REPLY:')
  })
})
