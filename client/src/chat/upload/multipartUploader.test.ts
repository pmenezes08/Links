import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadMultipartBlob } from './multipartUploader'

describe('uploadMultipartBlob resume', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('skips already completed parts and completes with the full part list', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/chat/uploads/part-url') {
        const body = JSON.parse(String(init?.body || '{}'))
        return Response.json({ success: true, upload_url: `https://r2.example/part-${body.part_number}` })
      }
      if (url === 'https://r2.example/part-2') {
        return new Response(null, { status: 200, headers: { ETag: '"etag-2"' } })
      }
      if (url === '/api/chat/uploads/complete') {
        const body = JSON.parse(String(init?.body || '{}'))
        expect(body.parts).toEqual([
          { part_number: 1, etag: 'etag-1' },
          { part_number: 2, etag: 'etag-2' },
        ])
        return Response.json({ success: true, public_url: 'https://cdn.example/video.mp4' })
      }
      throw new Error(`Unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const blob = new Blob([new Uint8Array(10)], { type: 'video/mp4' })
    const result = await uploadMultipartBlob({
      file: blob,
      contentType: 'video/mp4',
      session: {
        sessionId: 's1',
        uploadId: 'u1',
        partSize: 5,
        key: 'message_videos/video.mp4',
        publicUrl: 'https://cdn.example/video.mp4',
      },
      resumeParts: [{ partNumber: 1, etag: 'etag-1' }],
    })

    expect(result.publicUrl).toBe('https://cdn.example/video.mp4')
    expect(fetchMock).not.toHaveBeenCalledWith('https://r2.example/part-1', expect.anything())
  })
})
