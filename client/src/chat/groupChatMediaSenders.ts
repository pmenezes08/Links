/**
 * Group Chat Media Senders - modular media upload handling for group chats.
 * Mirrors the pattern from mediaSenders.ts but adapted for group chat API.
 */

import type { Dispatch, SetStateAction } from 'react'

export interface GroupMessage {
  id: number
  sender: string
  text: string | null
  image: string | null
  voice: string | null
  video?: string | null
  media_paths?: string[] | null  // For grouped media
  created_at: string
  profile_picture: string | null
  clientKey?: string
  isOptimistic?: boolean
}

export interface UploadProgress {
  stage: 'uploading' | 'done' | 'error'
  progress: number // 0-100
  message?: string
}

interface BaseMediaOptions {
  groupId: number | string
  currentUsername: string
  setServerMessages: Dispatch<SetStateAction<GroupMessage[]>>
  setPendingMessages?: Dispatch<SetStateAction<(GroupMessage & { clientKey: string })[]>>
  loadMessages: (force?: boolean) => void
  onProgress?: (progress: UploadProgress) => void
  onError?: (message: string) => void
  onComplete?: () => void
}

interface ImageMediaOptions extends BaseMediaOptions {
  file: File
  kind?: 'photo' | 'gif'
}

interface VideoMediaOptions extends BaseMediaOptions {
  file: File
}

interface MultiMediaOptions extends BaseMediaOptions {
  files: Array<{ file: File; type: 'image' | 'video' }>
}

const defaultErrorHandler = (msg: string) => {
  if (typeof window !== 'undefined') {
    window.alert(msg)
  }
}

/**
 * Send image/video message to group chat - single request like ChatThread
 * Uses the same pattern as /send_photo_message for DMs
 */
async function sendGroupMedia(
  file: File,
  groupId: number | string,
  mediaType: 'photo' | 'video',
  onProgress?: (progress: UploadProgress) => void
): Promise<{ success: boolean; message?: GroupMessage; error?: string }> {
  const formData = new FormData()
  formData.append(mediaType, file)
  formData.append('group_id', String(groupId))

  onProgress?.({ stage: 'uploading', progress: 10, message: 'Uploading...' })

  try {
    console.log('[GroupMedia] Sending', mediaType, 'to group', groupId)
    
    // Use simple fetch like ChatThread does - more reliable on iOS
    const response = await fetch(`/api/group_chat/${groupId}/send_media`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
    
    const payload = await response.json().catch(() => null)
    console.log('[GroupMedia] Response:', payload)
    
    if (!payload?.success) {
      onProgress?.({ stage: 'error', progress: 0, message: payload?.error || 'Upload failed' })
      return { success: false, error: payload?.error || 'Failed to send' }
    }
    
    onProgress?.({ stage: 'done', progress: 100, message: 'Sent!' })
    return { success: true, message: payload.message }
    
  } catch (error) {
    console.error('[GroupMedia] Error:', error)
    onProgress?.({ stage: 'error', progress: 0, message: 'Network error' })
    return { success: false, error: 'Network error' }
  }
}

/**
 * Send an image message to a group chat with optimistic UI
 */
export async function sendGroupImageMessage(options: ImageMediaOptions): Promise<boolean> {
  const {
    file,
    kind = 'photo',
    groupId,
    currentUsername,
    setServerMessages,
    loadMessages,
    onProgress,
    onError = defaultErrorHandler,
    onComplete,
  } = options

  const tempId = `temp_${kind}_${Date.now()}_${Math.random()}`
  const now = new Date().toISOString()
  const previewUrl = URL.createObjectURL(file)

  const optimisticMessage: GroupMessage & { clientKey: string; isOptimistic: boolean } = {
    id: -Date.now(),
    sender: currentUsername,
    text: kind === 'gif' ? '🎞️ GIF' : '📷 Photo',
    image: previewUrl,
    voice: null,
    created_at: now,
    profile_picture: null,
    clientKey: tempId,
    isOptimistic: true,
  }

  setServerMessages(prev => [...prev, optimisticMessage as any])

  try {
    const result = await sendGroupMedia(file, groupId, 'photo', onProgress)
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to send image')
    }

    // Replace optimistic in-place with server message
    setServerMessages(prev => prev.map(m =>
      (m as any).clientKey === tempId
        ? { ...result.message!, clientKey: tempId, isOptimistic: false }
        : m
    ))
    
    loadMessages(true)
    setTimeout(() => loadMessages(true), 2000)
    
    return true
  } catch (error) {
    console.error('[GroupMedia] Image send failed:', error)
    setServerMessages(prev => prev.filter(m => (m as any).clientKey !== tempId))
    
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    onError(kind === 'gif' ? `Failed to send GIF: ${errorMsg}` : `Failed to send photo: ${errorMsg}`)
    return false
  } finally {
    try {
      URL.revokeObjectURL(previewUrl)
    } catch {
      // ignore
    }
    onComplete?.()
  }
}

/**
 * Send a video message to a group chat with optimistic UI
 */
export async function sendGroupVideoMessage(options: VideoMediaOptions): Promise<boolean> {
  const {
    file,
    groupId,
    currentUsername,
    setServerMessages,
    loadMessages,
    onProgress,
    onError = defaultErrorHandler,
    onComplete,
  } = options

  const tempId = `temp_video_${Date.now()}_${Math.random()}`
  const now = new Date().toISOString()
  const previewUrl = URL.createObjectURL(file)

  const optimisticMessage: GroupMessage & { clientKey: string; isOptimistic: boolean } = {
    id: -Date.now(),
    sender: currentUsername,
    text: '🎬 Video',
    image: null,
    video: previewUrl,
    voice: null,
    created_at: now,
    profile_picture: null,
    clientKey: tempId,
    isOptimistic: true,
  }

  setServerMessages(prev => [...prev, optimisticMessage as any])

  try {
    const result = await sendGroupMedia(file, groupId, 'video', onProgress)
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to send video')
    }

    setServerMessages(prev => prev.map(m =>
      (m as any).clientKey === tempId
        ? { ...result.message!, clientKey: tempId, isOptimistic: false }
        : m
    ))
    
    loadMessages(true)
    setTimeout(() => loadMessages(true), 2000)
    
    return true
  } catch (error) {
    console.error('[GroupMedia] Video send failed:', error)
    setServerMessages(prev => prev.filter(m => (m as any).clientKey !== tempId))
    
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    onError(`Failed to send video: ${errorMsg}`)
    return false
  } finally {
    try {
      URL.revokeObjectURL(previewUrl)
    } catch {
      // ignore
    }
    onComplete?.()
  }
}

/**
 * Send multiple media files as a grouped message
 */
export async function sendGroupMultiMedia(options: MultiMediaOptions): Promise<boolean> {
  const {
    files,
    groupId,
    currentUsername,
    setServerMessages,
    loadMessages,
    onProgress,
    onError = defaultErrorHandler,
    onComplete,
  } = options

  if (files.length === 0) return false

  const tempId = `temp_multi_${Date.now()}_${Math.random()}`
  const now = new Date().toISOString()
  
  const previewUrls = files.map(f => URL.createObjectURL(f.file))

  const optimisticMessage: GroupMessage & { clientKey: string; isOptimistic: boolean } = {
    id: -Date.now(),
    sender: currentUsername,
    text: files.length > 1 ? `📷 ${files.length} items` : (files[0].type === 'video' ? '🎬 Video' : '📷 Photo'),
    image: files[0].type === 'image' ? previewUrls[0] : null,
    video: files[0].type === 'video' ? previewUrls[0] : null,
    voice: null,
    media_paths: previewUrls,
    created_at: now,
    profile_picture: null,
    clientKey: tempId,
    isOptimistic: true,
  }

  setServerMessages(prev => [...prev, optimisticMessage as any])

  try {
    onProgress?.({ stage: 'uploading', progress: 5, message: `Uploading ${files.length} items...` })
    
    const LARGE_VIDEO_THRESHOLD = 25 * 1024 * 1024 // 25MB - Cloud Run limit is 32MB
    
    // Separate large videos that need R2 direct upload
    const directUploadFiles: Array<{ file: File; type: 'image' | 'video' }> = []
    const formUploadFiles: Array<{ file: File; type: 'image' | 'video' }> = []
    
    for (const item of files) {
      if (item.type === 'video' && item.file.size > LARGE_VIDEO_THRESHOLD) {
        directUploadFiles.push(item)
      } else {
        formUploadFiles.push(item)
      }
    }
    
    // Step 1: Upload large videos directly to R2 via presigned URLs
    const preUploadedUrls: string[] = []
    for (let i = 0; i < directUploadFiles.length; i++) {
      const item = directUploadFiles[i]
      console.log(`[GroupMedia] Direct R2 upload for large video: ${item.file.name} (${(item.file.size / 1024 / 1024).toFixed(1)}MB)`)
      
      onProgress?.({ stage: 'uploading', progress: 5 + (i / files.length) * 40, message: `Uploading video ${i + 1}...` })
      
      // Get presigned URL
      const urlRes = await fetch(`/api/group_chat/${groupId}/video_upload_url`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: item.file.name, content_type: item.file.type || 'video/mp4' }),
      })
      const urlData = await urlRes.json().catch(() => null)
      if (!urlData?.success || !urlData.upload_url || !urlData.public_url) {
        throw new Error(urlData?.error || 'Failed to get upload URL for video')
      }
      
      // Upload directly to R2
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
        xhr.timeout = 600000 // 10 min
        xhr.send(item.file)
      })
      
      if (!putOk) throw new Error('Failed to upload video to storage')
      preUploadedUrls.push(urlData.public_url)
    }
    
    // Step 2: Upload form-uploadable files in sequential batches (max 3 files / ~15MB per batch)
    const MAX_BATCH_FILES = 3
    const MAX_BATCH_BYTES = 15 * 1024 * 1024
    const allUploadedUrls: string[] = [...preUploadedUrls]

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

      if (isLastBatch && allUploadedUrls.length > 0) {
        fd.append('media_urls', JSON.stringify(allUploadedUrls))
      }
      if (!isLastBatch) {
        fd.append('upload_only', '1')
      }

      console.log(`[GroupMedia] Batch ${bi + 1}/${batches.length}: ${batch.length} files${isLastBatch && allUploadedUrls.length > 0 ? ` + ${allUploadedUrls.length} pre-uploaded URLs` : ''}${!isLastBatch ? ' (upload_only)' : ''}`)

      const res = await fetch(`/api/group_chat/${groupId}/send_media`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      })

      const batchPayload = await res.json().catch(() => null)
      if (!batchPayload?.success) {
        throw new Error(batchPayload?.error || `Batch ${bi + 1} failed`)
      }

      if (!isLastBatch) {
        const batchUrls: string[] = batchPayload.media_paths || []
        allUploadedUrls.push(...batchUrls)
      }
    }

    if (batches.length === 0 && allUploadedUrls.length > 0) {
      const fd = new FormData()
      fd.append('media_urls', JSON.stringify(allUploadedUrls))
      const res = await fetch(`/api/group_chat/${groupId}/send_media`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      })
      const payload = await res.json().catch(() => null)
      if (!payload?.success) throw new Error(payload?.error || 'Failed to send media')
    }

    onProgress?.({ stage: 'done', progress: 100, message: 'Sent!' })

    // Remove optimistic message — polling will pick up the real one
    setServerMessages(prev => prev.filter(m => (m as any).clientKey !== tempId))
    
    loadMessages(true)
    setTimeout(() => loadMessages(true), 2000)
    
    return true
  } catch (error) {
    console.error('[GroupMedia] Multi-media send failed:', error)
    setServerMessages(prev => prev.filter(m => (m as any).clientKey !== tempId))
    
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    onError(`Failed to send media: ${errorMsg}`)
    return false
  } finally {
    // Cleanup preview URLs
    previewUrls.forEach(url => {
      try { URL.revokeObjectURL(url) } catch {}
    })
    onComplete?.()
  }
}
