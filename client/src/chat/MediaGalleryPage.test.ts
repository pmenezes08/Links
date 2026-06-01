import { describe, expect, it } from 'vitest'
import { buildMediaDeletePayload } from './MediaGalleryPage'

describe('buildMediaDeletePayload', () => {
  it('builds the backend bulk delete payload without UI-only fields', () => {
    expect(buildMediaDeletePayload([
      { message_id: 123, url: 'https://cdn.example/photo.jpg' },
      { message_id: 456, url: '/uploads/video.mp4' },
    ])).toEqual({
      items: [
        { message_id: 123, media_url: 'https://cdn.example/photo.jpg' },
        { message_id: 456, media_url: '/uploads/video.mp4' },
      ],
    })
  })
})
