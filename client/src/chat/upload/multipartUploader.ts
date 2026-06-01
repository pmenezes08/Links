import type { CompletedPart, MultipartSession, UploadContext, MediaKind } from './types'

const MAX_PART_RETRIES = 3
const BASE_BACKOFF_MS = 800

export class UploadRequestError extends Error {
  code?: string
  status: number

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'UploadRequestError'
    this.status = status
    this.code = code
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

async function fetchJson(url: string, body: unknown, signal?: AbortSignal): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.success) {
    throw new UploadRequestError(data?.error || `Request failed (${res.status})`, res.status, data?.code)
  }
  return data
}

async function putPart(
  uploadUrl: string,
  blob: Blob,
  contentType: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  for (let attempt = 0; attempt < MAX_PART_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': contentType },
        signal,
      })
      if (!res.ok) throw new Error(`Part upload failed (${res.status})`)
      const etag = res.headers.get('ETag') || res.headers.get('etag') || ''
      // R2 CORS often hides ETag from JS; server lists parts on complete.
      return etag ? etag.replace(/"/g, '') : undefined
    } catch (err) {
      if (signal?.aborted) throw err
      if (attempt === MAX_PART_RETRIES - 1) throw err
      await sleep(BASE_BACKOFF_MS * 2 ** attempt, signal)
    }
  }
  throw new Error('Part upload failed')
}

export async function initMultipartSession(
  context: UploadContext,
  file: File,
  mediaKind: MediaKind,
  signal?: AbortSignal,
): Promise<MultipartSession> {
  const contextPayload =
    context.type === 'dm'
      ? { type: 'dm', recipient_id: String(context.recipientId) }
      : { type: 'group', group_id: Number(context.groupId) }

  const data = await fetchJson(
    '/api/chat/uploads/init',
    {
      context: contextPayload,
      filename: file.name || (mediaKind === 'video' ? 'video.mp4' : 'photo.jpg'),
      content_type: file.type || (mediaKind === 'video' ? 'video/mp4' : 'image/jpeg'),
      expected_bytes: file.size,
      media_kind: mediaKind,
    },
    signal,
  )
  return {
    sessionId: data.session_id,
    uploadId: data.upload_id,
    partSize: data.part_size,
    key: data.key,
    publicUrl: data.public_url,
  }
}

export async function abortMultipartSession(sessionId: string): Promise<void> {
  try {
    await fetchJson('/api/chat/uploads/abort', { session_id: sessionId })
  } catch {
    /* best effort */
  }
}

export interface MultipartUploadOptions {
  file: Blob
  contentType: string
  session: MultipartSession
  resumeParts?: CompletedPart[]
  onPartProgress?: (loaded: number, total: number) => void
  onPartComplete?: (part: CompletedPart) => void
  signal?: AbortSignal
}

export async function uploadMultipartBlob(options: MultipartUploadOptions): Promise<{ publicUrl: string; parts: CompletedPart[] }> {
  const { file, contentType, session, resumeParts = [], onPartProgress, onPartComplete, signal } = options
  const partSize = session.partSize
  const totalSize = file.size
  const totalParts = Math.max(1, Math.ceil(totalSize / partSize))
  const completed = new Map<number, string>()
  for (const p of resumeParts) completed.set(p.partNumber, p.etag)

  let uploadedBytes = 0
  for (const p of resumeParts) {
    const start = (p.partNumber - 1) * partSize
    const end = Math.min(start + partSize, totalSize)
    uploadedBytes += end - start
  }

  const concurrency = 2
  const pending: number[] = []
  for (let i = 1; i <= totalParts; i++) {
    if (!completed.has(i)) pending.push(i)
  }

  async function uploadOne(partNumber: number): Promise<void> {
    const start = (partNumber - 1) * partSize
    const end = Math.min(start + partSize, totalSize)
    const chunk = file.slice(start, end)
    const partData = await fetchJson(
      '/api/chat/uploads/part-url',
      { session_id: session.sessionId, part_number: partNumber },
      signal,
    )
    const etag = await putPart(partData.upload_url, chunk, contentType, signal)
    completed.set(partNumber, etag ?? '')
    onPartComplete?.({ partNumber, etag: etag ?? '' })
    uploadedBytes += chunk.size
    onPartProgress?.(uploadedBytes, totalSize)
  }

  let idx = 0
  async function worker(): Promise<void> {
    while (idx < pending.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const partNumber = pending[idx++]
      await uploadOne(partNumber)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, pending.length || 1) }, () => worker())
  await Promise.all(workers)

  const parts: CompletedPart[] = Array.from(completed.entries())
    .sort(([a], [b]) => a - b)
    .map(([partNumber, etag]) => ({ partNumber, etag }))

  const completeData = await fetchJson(
    '/api/chat/uploads/complete',
    {
      session_id: session.sessionId,
      parts: parts.map(p => ({ part_number: p.partNumber, etag: p.etag || undefined })),
    },
    signal,
  )

  return { publicUrl: completeData.public_url, parts }
}
