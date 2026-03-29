import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { ChatMessage } from '../types/chat'

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
      onProgress?.({ stage: 'uploading', progress: 5, message: 'Uploading...' })
      const putOk = await new Promise<boolean>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = 5 + (e.loaded / e.total) * 90
            onProgress?.({ stage: 'uploading', progress: pct, message: `Uploading... ${Math.round((e.loaded / e.total) * 100)}%` })
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
      onProgress?.({ stage: 'uploading', progress: 98, message: 'Sending...' })
      const fd = new FormData()
      fd.append('recipient_id', String(otherUserId))
      fd.append('message', '')
      fd.append('video_url', urlData.public_url)
      const msgRes = await fetch('/send_video_message', { method: 'POST', credentials: 'include', body: fd })
      payload = await msgRes.json().catch(() => null) || {}
    } else {
      // Traditional form upload (smaller videos)
      onProgress?.({ stage: 'uploading', progress: 0, message: 'Uploading...' })
      const formData = new FormData()
      formData.append('video', file)
      formData.append('recipient_id', String(otherUserId))
      formData.append('message', '')

      payload = await new Promise<{ success: boolean; id?: number; video_path?: string; time?: string; error?: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const uploadProgress = (e.loaded / e.total) * 95
            onProgress?.({ stage: 'uploading', progress: uploadProgress, message: `Uploading... ${Math.round((e.loaded / e.total) * 100)}%` })
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
  } = options

  if (files.length === 0) return
  setSending(true)

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
    onProgress?.({ stage: 'uploading', progress: 5, message: `Uploading ${files.length} items...` })

    const LARGE_VIDEO_THRESHOLD = 25 * 1024 * 1024
    const directUploadFiles: Array<{ file: File; type: 'image' | 'video' }> = []
    const formUploadFiles: Array<{ file: File; type: 'image' | 'video' }> = []

    for (const item of files) {
      if (item.type === 'video' && item.file.size > LARGE_VIDEO_THRESHOLD) {
        directUploadFiles.push(item)
      } else {
        formUploadFiles.push(item)
      }
    }

    const allUploadedUrls: string[] = []

    for (let i = 0; i < directUploadFiles.length; i++) {
      const item = directUploadFiles[i]
      onProgress?.({ stage: 'uploading', progress: 5 + (i / files.length) * 40, message: `Uploading video ${i + 1}...` })

      const urlRes = await fetch('/api/video_upload_url', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_id: String(otherUserId), filename: item.file.name, content_type: item.file.type || 'video/mp4' }),
      })
      const urlData = await urlRes.json().catch(() => null)
      if (!urlData?.success || !urlData.upload_url || !urlData.public_url) {
        throw new Error(urlData?.error || 'Failed to get upload URL for video')
      }

      const putOk = await new Promise<boolean>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const base = 5 + (i / files.length) * 40
            const pct = base + (e.loaded / e.total) * (40 / files.length)
            onProgress?.({ stage: 'uploading', progress: pct, message: `Uploading video... ${Math.round((e.loaded / e.total) * 100)}%` })
          }
        }
        xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300)
        xhr.onerror = () => reject(new Error('Video upload failed'))
        xhr.ontimeout = () => reject(new Error('Video upload timeout'))
        xhr.open('PUT', urlData.upload_url)
        xhr.setRequestHeader('Content-Type', item.file.type || 'video/mp4')
        xhr.timeout = 600000
        xhr.send(item.file)
      })

      if (!putOk) throw new Error('Failed to upload video to storage')
      allUploadedUrls.push(urlData.public_url)
    }

    const MAX_BATCH_FILES = 3
    const MAX_BATCH_BYTES = 15 * 1024 * 1024
    const batches: Array<Array<{ file: File; type: 'image' | 'video' }>> = []
    let currentBatch: Array<{ file: File; type: 'image' | 'video' }> = []
    let currentBatchSize = 0

    for (const item of formUploadFiles) {
      if (currentBatch.length >= MAX_BATCH_FILES || (currentBatch.length > 0 && currentBatchSize + item.file.size > MAX_BATCH_BYTES)) {
        batches.push(currentBatch)
        currentBatch = []
        currentBatchSize = 0
      }
      currentBatch.push(item)
      currentBatchSize += item.file.size
    }
    if (currentBatch.length > 0) batches.push(currentBatch)

    const progressBase = 50
    const progressRange = 45
    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi]
      const isLastBatch = bi === batches.length - 1
      const batchProgress = progressBase + (bi / Math.max(batches.length, 1)) * progressRange
      onProgress?.({ stage: 'uploading', progress: batchProgress, message: `Uploading batch ${bi + 1}/${batches.length}...` })

      const fd = new FormData()
      for (const item of batch) {
        fd.append('media', item.file)
      }
      fd.append('recipient_id', String(otherUserId))

      if (isLastBatch && allUploadedUrls.length > 0) {
        fd.append('media_urls', JSON.stringify(allUploadedUrls))
      }
      if (!isLastBatch) {
        fd.append('upload_only', '1')
      }

      const res = await fetch('/send_dm_media', { method: 'POST', credentials: 'include', body: fd })
      const batchPayload = await res.json().catch(() => null)
      if (!batchPayload?.success) {
        throw new Error(batchPayload?.error || `Batch ${bi + 1} failed`)
      }

      if (!isLastBatch) {
        const batchUrls: string[] = batchPayload.media_paths || []
        allUploadedUrls.push(...batchUrls)
      } else if (batchPayload.id) {
        idBridgeRef.current.tempToServer.set(tempId, batchPayload.id)
        idBridgeRef.current.serverToTemp.set(batchPayload.id, tempId)
      }
    }

    if (batches.length === 0 && allUploadedUrls.length > 0) {
      const fd = new FormData()
      fd.append('recipient_id', String(otherUserId))
      fd.append('media_urls', JSON.stringify(allUploadedUrls))
      const res = await fetch('/send_dm_media', { method: 'POST', credentials: 'include', body: fd })
      const payload = await res.json().catch(() => null)
      if (!payload?.success) throw new Error(payload?.error || 'Failed to send media')
      if (payload.id) {
        idBridgeRef.current.tempToServer.set(tempId, payload.id)
        idBridgeRef.current.serverToTemp.set(payload.id, tempId)
      }
    }

    onProgress?.({ stage: 'done', progress: 100, message: 'Sent!' })

    setMessages((prev: ChatMessage[]) => prev.filter(m => (m.clientKey || m.id) !== tempId))
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
    setSending(false)
  }
}
