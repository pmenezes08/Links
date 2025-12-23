import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { ChatMessage } from '../types/chat'
import { compressVideo, shouldCompressVideo, formatBytes, type CompressionProgress } from '../utils/videoCompressor'

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
  stage: 'compressing' | 'uploading' | 'done' | 'error'
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
    // Step 1: Compress video if needed (for files > 5MB)
    let videoToUpload = file
    if (shouldCompressVideo(file)) {
      onProgress?.({ stage: 'compressing', progress: 0, message: 'Compressing video...' })
      
      const compressionResult = await compressVideo(file, (progress: CompressionProgress) => {
        onProgress?.({ 
          stage: 'compressing', 
          progress: progress.progress * 0.4, // Compression is 0-40% of total
          message: progress.stage === 'loading' 
            ? 'Loading video...' 
            : `Compressing... ${Math.round(progress.progress)}%`
        })
      })
      
      videoToUpload = compressionResult.file
      
      if (compressionResult.compressionRatio > 1) {
        console.log(`Video compressed: ${formatBytes(compressionResult.originalSize)} → ${formatBytes(compressionResult.compressedSize)} (${compressionResult.compressionRatio.toFixed(1)}x smaller)`)
      }
    }

    // Step 2: Upload with progress tracking
    onProgress?.({ stage: 'uploading', progress: 40, message: 'Uploading...' })
    
    const formData = new FormData()
    formData.append('video', videoToUpload)
    formData.append('recipient_id', String(otherUserId))
    formData.append('message', '')

    // Use XMLHttpRequest for upload progress
    const payload = await new Promise<{ success: boolean; id?: number; video_path?: string; time?: string; error?: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          // Upload is 40-95% of total progress
          const uploadProgress = 40 + (e.loaded / e.total) * 55
          onProgress?.({ 
            stage: 'uploading', 
            progress: uploadProgress,
            message: `Uploading... ${Math.round((e.loaded / e.total) * 100)}%`
          })
        }
      }
      
      xhr.onload = () => {
        try {
          const response = JSON.parse(xhr.responseText)
          resolve(response)
        } catch {
          reject(new Error('Invalid response'))
        }
      }
      
      xhr.onerror = () => reject(new Error('Network error'))
      xhr.ontimeout = () => reject(new Error('Upload timeout'))
      
      xhr.open('POST', '/send_video_message')
      xhr.withCredentials = true
      xhr.timeout = 300000 // 5 minute timeout for large videos
      xhr.send(formData)
    })

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
    onProgress?.({ stage: 'error', progress: 0, message: 'Failed to send' })
    setMessages((prev: ChatMessage[]) => prev.filter((message: ChatMessage) => (message.clientKey || message.id) !== tempId))
    recentOptimisticRef.current.delete(tempId)
    notifyError('Failed to send video. Please try again.')
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
