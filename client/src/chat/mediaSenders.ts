import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { ChatMessage } from '../types/chat'
import { compressImageForUpload } from '../utils/compressImageForUpload'

interface BridgeRef {
  tempToServer: Map<string, string | number>
  serverToTemp: Map<string | number, string>
}

interface OptimisticEntry {
  message: ChatMessage
  timestamp: number
}

type MessagesSetter = Dispatch<SetStateAction<ChatMessage[]>>

export interface UploadProgress {
  stage: 'uploading' | 'done' | 'error'
  progress: number // 0-100
  message?: string
}

/** User-facing label for DM/group media upload progress (avoid internal terms like "batch"). */
export const SENDING_MEDIA_LABEL = 'Sending Media'

interface BaseMediaOptions {
  otherUserId: number | ''
  username?: string
  setMessages: MessagesSetter
  scrollToBottom: () => void
  recentOptimisticRef: MutableRefObject<Map<string, OptimisticEntry>>
  idBridgeRef: MutableRefObject<BridgeRef>
  setSending: (value: boolean) => void
  setPastedImage?: (file: File | null) => void
  notifyError?: (message: string) => void
  cleanup?: () => void
}

interface ImageMediaOptions extends BaseMediaOptions {
  file: File
  kind?: 'photo' | 'gif'
}

interface VideoMediaOptions extends BaseMediaOptions {
  file: File
  onProgress?: (progress: UploadProgress) => void
}

const defaultNotify = (msg: string) => {
  if (typeof window !== 'undefined') {
    window.alert(msg)
  }
}

function finalizeOptimisticEntry(
  recentOptimisticRef: MutableRefObject<Map<string, OptimisticEntry>>,
  tempId: string,
  delayMs = 1000
) {
  setTimeout(() => {
    recentOptimisticRef.current.delete(tempId)
  }, delayMs)
}

export async function sendImageMessage(options: ImageMediaOptions) {
  if (!options.otherUserId) return
  const {
    file,
    kind = 'photo',
    otherUserId,
    setMessages,
    scrollToBottom,
    recentOptimisticRef,
    idBridgeRef,
    setSending,
    setPastedImage,
    notifyError = defaultNotify,
    cleanup,
  } = options

  setSending(true)
  const tempId = `temp_${kind}_${Date.now()}_${Math.random()}`
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const previewUrl = URL.createObjectURL(file)
  const optimisticMessage: ChatMessage = {
    id: tempId,
    text: kind === 'gif' ? '🎞️ GIF' : '📷 Photo',
    image_path: previewUrl,
    sent: true,
    time: now,
    isOptimistic: true,
    clientKey: tempId,
  }

  setMessages((prev: ChatMessage[]) => [...prev, optimisticMessage])
  recentOptimisticRef.current.set(tempId, { message: optimisticMessage, timestamp: Date.now() })
  setTimeout(scrollToBottom, 50)

  const formData = new FormData()
  formData.append('photo', file)
  formData.append('recipient_id', String(otherUserId))
  formData.append('message', '')

  try {
    const response = await fetch('/send_photo_message', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
    const payload = await response.json().catch(() => null)
    if (!payload?.success) {
      throw new Error(payload?.error || 'Failed to send photo')
    }

    if (payload.id) {
      idBridgeRef.current.tempToServer.set(tempId, payload.id)
      idBridgeRef.current.serverToTemp.set(payload.id, tempId)
    }

    setMessages((prev: ChatMessage[]) =>
      prev.map((message: ChatMessage) => {
        if ((message.clientKey || message.id) !== tempId) return message
        return {
          ...message,
          id: payload.id || message.id,
          image_path: payload.image_path || message.image_path,
          isOptimistic: false,
          time: payload.time || message.time,
        }
      })
    )

    finalizeOptimisticEntry(recentOptimisticRef, tempId)
  } catch (error) {
    console.error('Image upload failed', error)
    setMessages((prev: ChatMessage[]) => prev.filter((message: ChatMessage) => (message.clientKey || message.id) !== tempId))
    recentOptimisticRef.current.delete(tempId)
    notifyError(kind === 'gif' ? 'Failed to send GIF. Please try again.' : 'Failed to send photo. Please try again.')
  } finally {
    try {
      URL.revokeObjectURL(previewUrl)
    } catch {
      // ignore
    }
    setPastedImage?.(null)
    cleanup?.()
    setSending(false)
  }
}

export async function sendVideoMessage(options: VideoMediaOptions) {
  if (!options.otherUserId) return
  const {
    file,
    otherUserId,
    setMessages,
    scrollToBottom,
    recentOptimisticRef,
    idBridgeRef,
    setSending,
    notifyError = defaultNotify,
    cleanup,
    onProgress,
  } = options

  setSending(true)
  const tempId = `temp_video_${Date.now()}_${Math.random()}`
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const previewUrl = URL.createObjectURL(file)
  const optimisticMessage: ChatMessage = {
    id: tempId,
    text: '🎬 Video',
    video_path: previewUrl,
    sent: true,
    time: now,
    isOptimistic: true,
    clientKey: tempId,
  }

  setMessages((prev: ChatMessage[]) => [...prev, optimisticMessage])
  recentOptimisticRef.current.set(tempId, { message: optimisticMessage, timestamp: Date.now() })
  setTimeout(scrollToBottom, 50)

  try {
    // Cloud Run has 32MB request limit - use direct R2 upload for videos > 25MB
    const LARGE_VIDEO_THRESHOLD = 25 * 1024 * 1024 // 25MB
    const useDirectUpload = file.size > LARGE_VIDEO_THRESHOLD

    let payload: { success: boolean; id?: number; video_path?: string; time?: string; error?: string }

    if (useDirectUpload) {
      // Step 1: Get presigned URL
      onProgress?.({ stage: 'uploading', progress: 0, message: 'Preparing upload...' })
      const urlRes = await fetch('/api/video_upload_url', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_id: String(otherUserId),
          filename: file.name,
          content_type: file.type || 'video/mp4',
        }),
      })
      const urlData = await urlRes.json().catch(() => null)
      if (!urlData?.success || !urlData.upload_url || !urlData.public_url) {
        throw new Error(urlData?.error || 'Failed to get upload URL')
      }

      // Step 2: Upload directly to R2
      onProgress?.({ stage: 'uploading', progress: 5, message: SENDING_MEDIA_LABEL })
      const putOk = await new Promise<boolean>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = 5 + (e.loaded / e.total) * 90
            onProgress?.({ stage: 'uploading', progress: pct, message: SENDING_MEDIA_LABEL })
          }
        }
        xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300)
        xhr.onerror = () => reject(new Error('Upload failed'))
        xhr.ontimeout = () => reject(new Error('Upload timeout'))
        xhr.open('PUT', urlData.upload_url)
        xhr.setRequestHeader('Content-Type', file.type || 'video/mp4')
        xhr.timeout = 600000 // 10 min for large files
        xhr.send(file)
      })

      if (!putOk) {
        throw new Error('Failed to upload video')
      }

      // Step 3: Notify backend to create message
      onProgress?.({ stage: 'uploading', progress: 98, message: SENDING_MEDIA_LABEL })
      const fd = new FormData()
      fd.append('recipient_id', String(otherUserId))
      fd.append('message', '')
      fd.append('video_url', urlData.public_url)
      const msgRes = await fetch('/send_video_message', { method: 'POST', credentials: 'include', body: fd })
      payload = await msgRes.json().catch(() => null) || {}
    } else {
      // Traditional form upload (smaller videos)
      onProgress?.({ stage: 'uploading', progress: 0, message: SENDING_MEDIA_LABEL })
      const formData = new FormData()
      formData.append('video', file)
      formData.append('recipient_id', String(otherUserId))
      formData.append('message', '')

      payload = await new Promise<{ success: boolean; id?: number; video_path?: string; time?: string; error?: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const uploadProgress = (e.loaded / e.total) * 95
            onProgress?.({ stage: 'uploading', progress: uploadProgress, message: SENDING_MEDIA_LABEL })
          }
        }
        xhr.onload = () => {
          try {
            resolve(JSON.parse(xhr.responseText))
          } catch {
            reject(new Error('Invalid response'))
          }
        }
        xhr.onerror = () => reject(new Error('Network error'))
        xhr.ontimeout = () => reject(new Error('Upload timeout'))
        xhr.open('POST', '/send_video_message')
        xhr.withCredentials = true
        xhr.timeout = 300000 // 5 minute timeout
        xhr.send(formData)
      })
    }

    if (!payload?.success) {
      throw new Error(payload?.error || 'Failed to send video')
    }

    onProgress?.({ stage: 'done', progress: 100, message: 'Sent!' })

    if (payload.id) {
      idBridgeRef.current.tempToServer.set(tempId, payload.id)
      idBridgeRef.current.serverToTemp.set(payload.id, tempId)
    }

    setMessages((prev: ChatMessage[]) =>
      prev.map((message: ChatMessage) => {
        if ((message.clientKey || message.id) !== tempId) return message
        return {
          ...message,
          id: payload.id || message.id,
          video_path: payload.video_path || message.video_path,
          isOptimistic: false,
          time: payload.time || message.time,
        }
      })
    )

    finalizeOptimisticEntry(recentOptimisticRef, tempId)
  } catch (error) {
    console.error('Video upload failed', error)
    const errMsg = error instanceof Error ? error.message : 'Failed to send video'
    onProgress?.({ stage: 'error', progress: 0, message: errMsg })
    setMessages((prev: ChatMessage[]) => prev.filter((message: ChatMessage) => (message.clientKey || message.id) !== tempId))
    recentOptimisticRef.current.delete(tempId)
    notifyError(errMsg.includes('Failed') ? `${errMsg} Please try again.` : errMsg)
  } finally {
    try {
      URL.revokeObjectURL(previewUrl)
    } catch {
      // ignore
    }
    cleanup?.()
    setSending(false)
  }
}

interface MultiMediaOptions extends BaseMediaOptions {
  files: Array<{ file: File; type: 'image' | 'video' }>
  onProgress?: (progress: UploadProgress) => void
  /** When false, do not toggle global sending/composer lock — upload continues in background after preview closes */
  lockComposer?: boolean
}

async function putBlobToPresigned(uploadUrl: string, blob: Blob, contentType: string): Promise<void> {
  const res = await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': contentType } })
  if (!res.ok) throw new Error(`Upload failed (${res.status})`)
}

async function uploadDmImageDirect(file: File, otherUserId: number): Promise<string> {
  const prepared = await compressImageForUpload(file)
  const contentType = prepared.type || 'image/jpeg'
  const urlRes = await fetch('/api/message_image_upload_url', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient_id: String(otherUserId),
      filename: prepared.name || 'photo.jpg',
      content_type: contentType,
    }),
  })
  const urlData = await urlRes.json().catch(() => null)
  if (!urlRes.ok || !urlData?.success || !urlData.upload_url || !urlData.public_url) {
    throw new Error(urlData?.error || 'Failed to get image upload URL')
  }
  await putBlobToPresigned(urlData.upload_url, prepared, contentType)
  return urlData.public_url as string
}

function uploadDmVideoDirect(
  file: File,
  otherUserId: number,
  onSliceProgress?: (loaded: number, total: number) => void,
): Promise<string> {
  return (async () => {
    const urlRes = await fetch('/api/video_upload_url', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient_id: String(otherUserId),
        filename: file.name,
        content_type: file.type || 'video/mp4',
      }),
    })
    const urlData = await urlRes.json().catch(() => null)
    if (!urlRes.ok || !urlData?.success || !urlData.upload_url || !urlData.public_url) {
      throw new Error(urlData?.error || 'Failed to get video upload URL')
    }
    const ok = await new Promise<boolean>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onSliceProgress?.(e.loaded, e.total)
      }
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300)
      xhr.onerror = () => reject(new Error('Video upload failed'))
      xhr.ontimeout = () => reject(new Error('Video upload timeout'))
      xhr.open('PUT', urlData.upload_url)
      xhr.setRequestHeader('Content-Type', file.type || 'video/mp4')
      xhr.timeout = 600000
      xhr.send(file)
    })
    if (!ok) throw new Error('Video upload failed')
    return urlData.public_url as string
  })()
}

export async function sendMultiMediaMessage(options: MultiMediaOptions) {
  if (!options.otherUserId) return
  const {
    files,
    otherUserId,
    setMessages,
    scrollToBottom,
    recentOptimisticRef,
    idBridgeRef,
    setSending,
    notifyError = defaultNotify,
    cleanup,
    onProgress,
    lockComposer = true,
  } = options

  if (files.length === 0) return
  if (lockComposer) setSending(true)

  const tempId = `temp_multi_${Date.now()}_${Math.random()}`
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const previewUrls = files.map(f => URL.createObjectURL(f.file))

  const optimisticMessage: ChatMessage = {
    id: tempId,
    text: files.length > 1 ? `📷 ${files.length} items` : (files[0].type === 'video' ? '🎬 Video' : '📷 Photo'),
    image_path: files[0].type === 'image' ? previewUrls[0] : undefined,
    video_path: files[0].type === 'video' ? previewUrls[0] : undefined,
    media_paths: previewUrls,
    sent: true,
    time: now,
    isOptimistic: true,
    clientKey: tempId,
  }

  setMessages((prev: ChatMessage[]) => [...prev, optimisticMessage])
  recentOptimisticRef.current.set(tempId, { message: optimisticMessage, timestamp: Date.now() })
  setTimeout(scrollToBottom, 50)

  try {
    onProgress?.({ stage: 'uploading', progress: 5, message: SENDING_MEDIA_LABEL })

    const n = files.length
    const sliceFrac = new Array<number>(n).fill(0)
    const report = () => {
      const avg = sliceFrac.reduce((a, b) => a + b, 0) / n
      onProgress?.({ stage: 'uploading', progress: 5 + avg * 90, message: SENDING_MEDIA_LABEL })
    }

    const oid = otherUserId as number
    const tasks = files.map((item, i) =>
      item.type === 'image'
        ? uploadDmImageDirect(item.file, oid).then((url) => {
            sliceFrac[i] = 1
            report()
            return url
          })
        : uploadDmVideoDirect(item.file, oid, (loaded, total) => {
            sliceFrac[i] = total ? loaded / total : 0
            report()
          }).then((url) => {
            sliceFrac[i] = 1
            report()
            return url
          }),
    )

    const orderedUrls = await Promise.all(tasks)

    onProgress?.({ stage: 'uploading', progress: 96, message: SENDING_MEDIA_LABEL })
    const fd = new FormData()
    fd.append('recipient_id', String(otherUserId))
    fd.append('media_urls', JSON.stringify(orderedUrls))

    const res = await fetch('/send_dm_media', { method: 'POST', credentials: 'include', body: fd })
    const payload = await res.json().catch(() => null)
    if (!payload?.success) {
      throw new Error(payload?.error || 'Failed to send media')
    }

    if (payload.id) {
      idBridgeRef.current.tempToServer.set(tempId, payload.id)
      idBridgeRef.current.serverToTemp.set(payload.id, tempId)
    }

    onProgress?.({ stage: 'done', progress: 100, message: 'Sent!' })

    const p = payload
    setMessages((prev: ChatMessage[]) =>
      prev.map((message: ChatMessage) => {
        if ((message.clientKey || message.id) !== tempId) return message
        return {
          ...message,
          id: p?.id ?? message.id,
          media_paths: p?.media_paths ?? message.media_paths,
          image_path: p?.image_path ?? message.image_path,
          video_path: p?.video_path ?? message.video_path,
          isOptimistic: false,
          time: p?.time ?? message.time,
        }
      }),
    )
    finalizeOptimisticEntry(recentOptimisticRef, tempId)
  } catch (error) {
    console.error('Multi-media upload failed', error)
    const errMsg = error instanceof Error ? error.message : 'Failed to send media'
    onProgress?.({ stage: 'error', progress: 0, message: errMsg })
    setMessages((prev: ChatMessage[]) => prev.filter(m => (m.clientKey || m.id) !== tempId))
    recentOptimisticRef.current.delete(tempId)
    notifyError(`Failed to send media: ${errMsg}`)
  } finally {
    previewUrls.forEach(url => { try { URL.revokeObjectURL(url) } catch {} })
    cleanup?.()
    if (lockComposer) setSending(false)
  }
}

interface DocumentMediaOptions extends BaseMediaOptions {
  file: File
}

export async function sendDocumentMessage(options: DocumentMediaOptions) {
  if (!options.otherUserId) return
  const {
    file,
    otherUserId,
    setMessages,
    scrollToBottom,
    recentOptimisticRef,
    idBridgeRef,
    setSending,
    notifyError = defaultNotify,
  } = options

  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    notifyError('Only PDF files are allowed')
    return
  }

  const tempId = `temp-doc-${Date.now()}`
  const displayName = file.name || 'document.pdf'
  setSending(true)
  setMessages(prev => [
    ...prev,
    {
      id: tempId,
      clientKey: tempId,
      text: '',
      file_path: URL.createObjectURL(file),
      file_name: displayName,
      sent: true,
      time: new Date().toISOString(),
      isOptimistic: true,
    },
  ])
  scrollToBottom()
  recentOptimisticRef.current.set(tempId, { message: {} as ChatMessage, timestamp: Date.now() })

  try {
    const fd = new FormData()
    fd.append('recipient_id', String(otherUserId))
    fd.append('document', file, file.name)
    const res = await fetch('/api/chat/dm/send_document', { method: 'POST', credentials: 'include', body: fd })
    const payload = await res.json().catch(() => null)
    if (!payload?.success) {
      throw new Error(payload?.error || 'Failed to send document')
    }
    if (payload.id) {
      idBridgeRef.current.tempToServer.set(tempId, payload.id)
      idBridgeRef.current.serverToTemp.set(payload.id, tempId)
    }
    setMessages(prev =>
      prev.map(message => {
        if ((message.clientKey || message.id) !== tempId) return message
        return {
          ...message,
          id: payload.id ?? message.id,
          file_path: payload.file_path ?? message.file_path,
          file_name: payload.file_name ?? message.file_name,
          isOptimistic: false,
          time: payload.time ?? message.time,
        }
      }),
    )
    finalizeOptimisticEntry(recentOptimisticRef, tempId)
  } catch (error) {
    console.error('Document upload failed', error)
    const errMsg = error instanceof Error ? error.message : 'Failed to send document'
    setMessages(prev => prev.filter(m => (m.clientKey || m.id) !== tempId))
    recentOptimisticRef.current.delete(tempId)
    notifyError(errMsg)
  } finally {
    setSending(false)
  }
}

export async function sendGroupDocumentMessage(options: { file: File; groupId: number | string; notifyError?: (msg: string) => void }) {
  const { file, groupId, notifyError = defaultNotify } = options
  if (!groupId) return null

  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    notifyError('Only PDF files are allowed')
    return null
  }

  const fd = new FormData()
  fd.append('document', file, file.name)
  const res = await fetch(`/api/group_chat/${groupId}/send_document`, {
    method: 'POST',
    credentials: 'include',
    body: fd,
  })
  const payload = await res.json().catch(() => null)
  if (!payload?.success) {
    throw new Error(payload?.error || 'Failed to send document')
  }
  return payload.message as Record<string, unknown>
}
