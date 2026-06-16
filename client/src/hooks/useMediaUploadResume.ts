import { useEffect, useRef } from 'react'
import { registerBackgroundUploadResume } from '../chat/upload/nativeBackgroundUpload'
import {
  claimMediaOutboxRecord,
  getMediaOutboxBlob,
  listPendingMediaOutbox,
  releaseMediaOutboxRecord,
  removeMediaOutboxRecord,
  updateMediaOutboxRecord,
} from '../chat/upload/mediaOutbox'
import { uploadChatMediaBlob } from '../chat/upload/uploadKernel'
import type { MediaOutboxRecord } from '../chat/upload/types'

function announceUploadStatus(message: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('chat-media-upload-status', { detail: { message } }))
}

async function commitUploadedMedia(record: MediaOutboxRecord & { id: number }, publicUrl: string): Promise<void> {
  const fd = new FormData()
  fd.append('client_key', record.clientKey)
  if (record.context.type === 'dm') {
    fd.append('recipient_id', String(record.context.recipientId))
    fd.append('media_urls', JSON.stringify([publicUrl]))
    const res = await fetch('/send_dm_media', { method: 'POST', credentials: 'include', body: fd })
    const payload = await res.json().catch(() => null)
    if (!payload?.success) throw new Error(payload?.error || 'Could not send media')
  } else {
    fd.append('media_urls', JSON.stringify([publicUrl]))
    const res = await fetch(`/api/group_chat/${record.context.groupId}/send_media`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    })
    const payload = await res.json().catch(() => null)
    if (!payload?.success) throw new Error(payload?.error || 'Could not send media')
  }
  await removeMediaOutboxRecord(record.id, record.clientKey)
}

/** Resume failed/pending media uploads when the app returns to foreground. */
export function useMediaUploadResume(enabled = true): void {
  // Guards against overlapping drains when focus / online / appStateChange fire together.
  const drainingRef = useRef(false)
  useEffect(() => {
    if (!enabled) return

    const resume = () => {
      // Don't drain (and burn retries) while offline — the 'online' listener re-triggers
      // us on reconnect, so an interrupted upload waits instead of failing out.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      if (drainingRef.current) return
      drainingRef.current = true
      void listPendingMediaOutbox().then(async records => {
        for (const record of records) {
          if (!['failed', 'pending', 'uploading', 'committing'].includes(record.status)) continue
          if ((record.retries || 0) >= 5) {
            await updateMediaOutboxRecord(record.id, { status: 'failed', error: 'chat.upload_interrupted_retry' })
            announceUploadStatus('chat.upload_interrupted_retry')
            await removeMediaOutboxRecord(record.id, record.clientKey)
            continue
          }
          const claimed = await claimMediaOutboxRecord(record.id)
          if (!claimed) continue
          const blob = await getMediaOutboxBlob(record.clientKey)
          if (!blob && !claimed.uploadedUrl) {
            await removeMediaOutboxRecord(claimed.id, claimed.clientKey)
            continue
          }
          try {
            announceUploadStatus('chat.upload_resuming')
            const result = claimed.uploadedUrl
              ? { publicUrl: claimed.uploadedUrl }
              : await uploadChatMediaBlob({
                  context: claimed.context,
                  file: new File([blob as Blob], claimed.filename, { type: claimed.contentType }),
                  mediaKind: claimed.mediaKind,
                  quality: claimed.quality,
                  clientKey: claimed.clientKey,
                  resumeRecord: claimed,
                })
            await updateMediaOutboxRecord(claimed.id, { status: 'committing', uploadedUrl: result.publicUrl })
            await commitUploadedMedia(claimed, result.publicUrl)
          } catch {
            await updateMediaOutboxRecord(claimed.id, { status: 'failed', retries: (claimed.retries || 0) + 1 })
            await releaseMediaOutboxRecord(claimed.id)
          }
        }
      }).finally(() => { drainingRef.current = false })
    }

    resume()
    const unregisterNativeResume = registerBackgroundUploadResume(resume)
    window.addEventListener('focus', resume)
    window.addEventListener('online', resume)
    return () => {
      unregisterNativeResume()
      window.removeEventListener('focus', resume)
      window.removeEventListener('online', resume)
    }
  }, [enabled])
}
