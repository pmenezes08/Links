import { compressImageForUpload } from '../../utils/compressImageForUpload'
import { abortMultipartSession, initMultipartSession, uploadMultipartBlob } from './multipartUploader'
import { removeMediaOutboxRecord, saveMediaOutboxRecord, updateMediaOutboxRecord } from './mediaOutbox'
import { logUploadMetric } from './uploadMetrics'
import { optimizeVideoForUpload } from './videoTranscode'
import type { MediaKind, MultipartSession, UploadBlobResult, UploadKernelOptions, UploadProgress } from './types'

export const SENDING_MEDIA_LABEL = 'Sending...'

async function prepareBlob(file: File, mediaKind: MediaKind, quality: UploadKernelOptions['quality']): Promise<{ blob: Blob; contentType: string }> {
  if (mediaKind === 'image') {
    const prepared = await compressImageForUpload(file)
    return { blob: prepared, contentType: prepared.type || 'image/jpeg' }
  }
  const optimized = await optimizeVideoForUpload(file, quality)
  return {
    blob: optimized,
    contentType: optimized.type || 'video/mp4',
  }
}

export async function uploadChatMediaBlob(options: UploadKernelOptions): Promise<UploadBlobResult> {
  const { context, file, mediaKind, quality = 'standard', onProgress, signal, clientKey = `upload_${Date.now()}`, resumeRecord } = options
  const started = Date.now()
  let outboxId: number | undefined = resumeRecord?.id
  let sessionId: string | undefined = resumeRecord?.sessionId
  let heartbeatId: ReturnType<typeof setInterval> | undefined

  const report = (progress: UploadProgress) => onProgress?.(progress)

  try {
    if (resumeRecord?.uploadedUrl && resumeRecord.key) {
      report({ stage: 'sending', progress: 96, message: SENDING_MEDIA_LABEL })
      return { publicUrl: resumeRecord.uploadedUrl, key: resumeRecord.key, outboxId }
    }

    report({ stage: 'compressing', progress: 2, message: mediaKind === 'video' ? 'Preparing video...' : 'Preparing...' })
    const { blob, contentType } = resumeRecord
      ? { blob: file, contentType: resumeRecord.contentType || file.type || (mediaKind === 'video' ? 'video/mp4' : 'image/jpeg') }
      : await prepareBlob(file, mediaKind, quality)

    if (!outboxId) {
      outboxId = await saveMediaOutboxRecord(
        {
          clientKey,
          context,
          mediaKind,
          quality,
          filename: file.name,
          contentType,
          blobSize: blob.size,
          completedParts: [],
          status: 'pending',
          createdAt: Date.now(),
          retries: 0,
          hasBlob: true,
        },
        blob,
      )
    }
    // Outbox is best-effort (iOS WebKit may reject Blob in IndexedDB); upload continues without it.

    logUploadMetric({
      event: 'start',
      mediaKind,
      contextType: context.type,
      bytes: blob.size,
    })

    report({ stage: 'uploading', progress: 5, message: SENDING_MEDIA_LABEL })
    if (outboxId) await updateMediaOutboxRecord(outboxId, { status: 'uploading' })

    let session: MultipartSession | null =
      resumeRecord?.sessionId && resumeRecord.partSize && resumeRecord.key && resumeRecord.publicUrl
        ? {
            sessionId: resumeRecord.sessionId,
            uploadId: resumeRecord.uploadId || '',
            partSize: resumeRecord.partSize,
            key: resumeRecord.key,
            publicUrl: resumeRecord.publicUrl,
          }
        : null
    if (!session) {
      session = await initMultipartSession(context, new File([blob], file.name, { type: contentType }), mediaKind, signal)
    }
    sessionId = session.sessionId
    if (outboxId) {
      await updateMediaOutboxRecord(outboxId, {
        sessionId: session.sessionId,
        uploadId: session.uploadId,
        partSize: session.partSize,
        key: session.key,
        publicUrl: session.publicUrl,
        status: 'uploading',
        error: undefined,
      })
      heartbeatId = setInterval(() => {
        if (outboxId) void updateMediaOutboxRecord(outboxId, { lockedAt: Date.now() })
      }, 20_000)
    }

    let lastReport = Date.now()
    let lastLoaded = 0
    const completedParts: { partNumber: number; etag: string }[] = [...(resumeRecord?.completedParts || [])]
    const { publicUrl, parts } = await uploadMultipartBlob({
      file: blob,
      contentType,
      session,
      resumeParts: completedParts,
      onPartProgress: (loaded, total) => {
        const now = Date.now()
        const dt = (now - lastReport) / 1000
        const bytesPerSecond = dt > 0 ? (loaded - lastLoaded) / dt : undefined
        lastReport = now
        lastLoaded = loaded
        const pct = total ? 5 + (loaded / total) * 90 : 5
        const etaSeconds = bytesPerSecond && bytesPerSecond > 0 ? (total - loaded) / bytesPerSecond : undefined
        report({
          stage: 'uploading',
          progress: pct,
          message: SENDING_MEDIA_LABEL,
          bytesPerSecond,
          etaSeconds,
        })
        if (outboxId && completedParts.length) {
          void updateMediaOutboxRecord(outboxId, { completedParts: [...completedParts] })
        }
      },
      onPartComplete: part => {
        completedParts.push(part)
        if (outboxId) void updateMediaOutboxRecord(outboxId, { completedParts: [...completedParts] })
      },
      signal,
    })

    if (outboxId) {
      await updateMediaOutboxRecord(outboxId, { status: 'committing', completedParts: parts, uploadedUrl: publicUrl })
    }

    logUploadMetric({
      event: 'complete',
      mediaKind,
      contextType: context.type,
      bytes: blob.size,
      parts: parts.length,
      durationMs: Date.now() - started,
    })

    report({ stage: 'done', progress: 100, message: 'Sent' })
    return { publicUrl, key: session.key, outboxId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Upload failed'
    if (signal?.aborted) {
      if (sessionId) await abortMultipartSession(sessionId)
      if (outboxId) await removeMediaOutboxRecord(outboxId, clientKey)
      report({ stage: 'cancelled', progress: 0, message: 'Cancelled' })
      logUploadMetric({ event: 'abort', mediaKind, contextType: context.type })
      throw err
    }
    if (outboxId) await updateMediaOutboxRecord(outboxId, { status: 'failed', retries: (resumeRecord?.retries || 0) + 1, error: msg })
    report({ stage: 'failed', progress: 0, message: msg })
    logUploadMetric({
      event: 'fail',
      mediaKind,
      contextType: context.type,
      failureReason: msg,
      durationMs: Date.now() - started,
    })
    throw err
  } finally {
    if (heartbeatId) clearInterval(heartbeatId)
  }
}

export async function uploadChatMediaBatch(
  items: Array<{ file: File; mediaKind: MediaKind }>,
  context: UploadKernelOptions['context'],
  onProgress?: (index: number, total: number, progress: UploadProgress) => void,
  signal?: AbortSignal,
  quality: UploadKernelOptions['quality'] = 'standard',
  parentClientKey = `batch_${Date.now()}`,
): Promise<string[]> {
  const urls: string[] = []
  const n = items.length
  for (let i = 0; i < n; i++) {
    const item = items[i]
    const result = await uploadChatMediaBlob({
      context,
      file: item.file,
      mediaKind: item.mediaKind,
      quality,
      signal,
      clientKey: `${parentClientKey}_${i}`,
      onProgress: p => onProgress?.(i, n, p),
    })
    urls.push(result.publicUrl)
  }
  return urls
}
