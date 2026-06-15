import { describe, expect, it } from 'vitest'
import { stripReplyMarker } from './utils'

describe('stripReplyMarker', () => {
  it('passes plain text through unchanged', () => {
    expect(stripReplyMarker('hello there')).toBe('hello there')
  })

  it('returns empty string for null/undefined/empty', () => {
    expect(stripReplyMarker(null)).toBe('')
    expect(stripReplyMarker(undefined)).toBe('')
    expect(stripReplyMarker('')).toBe('')
  })

  it('strips a single-level reply marker, leaving the body (producer path)', () => {
    expect(stripReplyMarker('[REPLY:diogorbmartins:Já deste]\nYa fiz aqui')).toBe('Ya fiz aqui')
  })

  it('strips a story-reply marker', () => {
    expect(stripReplyMarker('[STORY_REPLY:1:image:/x.jpg]\nNice')).toBe('Nice')
  })

  it('cleans a truncated nested snippet (parser path, no closing bracket)', () => {
    // What a first-`]`-stop capture yields for a reply-to-a-reply.
    expect(stripReplyMarker('[REPLY:diogorbmartins:Já deste uma atualização')).toBe(
      'Já deste uma atualização',
    )
  })

  it('does not strip media snippets', () => {
    expect(stripReplyMarker('📷|/x.jpg|caption')).toBe('📷|/x.jpg|caption')
    expect(stripReplyMarker('🎤|Voice note summary')).toBe('🎤|Voice note summary')
  })

  it('leaves bracketed non-reply text alone', () => {
    expect(stripReplyMarker('check [this] out')).toBe('check [this] out')
  })

  it('yields empty string for a marker with no body', () => {
    expect(stripReplyMarker('[REPLY:alice:hi]')).toBe('')
  })
})
