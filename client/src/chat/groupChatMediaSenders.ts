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
  setServerMessages?: Dispatch<SetStateAction<GroupMessage[]>> // Optional, not currently used
  setPendingMessages: Dispatch<SetStateAction<(GroupMessage & { clientKey: string })[]>>
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

const defaultErrorHandler = (msg: string) => {
  if (typeof window !== 'undefined') {
    window.alert(msg)
  }
}

/**
 * Upload media file (image or video) to R2 CDN via backend
 */
async function uploadMedia(
  file: File, 
  type: 'image' | 'video',
  onProgress?: (progress: UploadProgress) => void
): Promise<{ success: boolean; path?: string; error?: string }> {
  const formData = new FormData()
  formData.append(type, file)

  onProgress?.({ stage: 'uploading', progress: 0, message: 'Uploading...' })

  try {
    // Use XMLHttpRequest for upload progress
    return await new Promise((resolve) => {
      const xhr = new XMLHttpRequest()
      
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const uploadProgress = Math.round((e.loaded / e.total) * 95)
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
          if (response.success && response.path) {
            onProgress?.({ stage: 'done', progress: 100, message: 'Uploaded!' })
            resolve({ success: true, path: response.path })
          } else {
            onProgress?.({ stage: 'error', progress: 0, message: 'Upload failed' })
            resolve({ success: false, error: response.error || 'Upload failed' })
          }
        } catch {
          onProgress?.({ stage: 'error', progress: 0, message: 'Invalid response' })
          resolve({ success: false, error: 'Invalid response' })
        }
      }
      
      xhr.onerror = () => {
        onProgress?.({ stage: 'error', progress: 0, message: 'Network error' })
        resolve({ success: false, error: 'Network error' })
      }
      
      xhr.ontimeout = () => {
        onProgress?.({ stage: 'error', progress: 0, message: 'Upload timeout' })
        resolve({ success: false, error: 'Upload timeout' })
      }
      
      xhr.open('POST', '/api/upload_chat_media')
      xhr.withCredentials = true
      xhr.timeout = 300000 // 5 minute timeout for large files
      xhr.send(formData)
    })
  } catch (error) {
    onProgress?.({ stage: 'error', progress: 0, message: 'Upload failed' })
    return { success: false, error: 'Upload failed' }
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
    setServerMessages: _setServerMessages,
    setPendingMessages,
    loadMessages,
    onProgress,
    onError = defaultErrorHandler,
    onComplete,
  } = options
  void _setServerMessages // Intentionally unused - loadMessages handles refresh

  const tempId = `temp_${kind}_${Date.now()}_${Math.random()}`
  const now = new Date().toISOString()
  const previewUrl = URL.createObjectURL(file)

  // Create optimistic message
  const optimisticMessage: GroupMessage & { clientKey: string } = {
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

  // Add to pending messages immediately
  setPendingMessages(prev => [...prev, optimisticMessage])

  try {
    // Upload to R2 CDN
    const uploadResult = await uploadMedia(file, 'image', onProgress)
    
    if (!uploadResult.success || !uploadResult.path) {
      throw new Error(uploadResult.error || 'Upload failed')
    }

    // Send message to group
    const response = await fetch(`/api/group_chat/${groupId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ image_path: uploadResult.path }),
    })
    
    const data = await response.json()
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to send image')
    }

    // Remove from pending, server message will come via loadMessages
    setPendingMessages(prev => prev.filter(m => m.clientKey !== tempId))
    
    // Refresh messages to get the confirmed message
    loadMessages(true)
    
    return true
  } catch (error) {
    console.error('Group image upload failed:', error)
    
    // Remove optimistic message on failure
    setPendingMessages(prev => prev.filter(m => m.clientKey !== tempId))
    
    onError(kind === 'gif' ? 'Failed to send GIF. Please try again.' : 'Failed to send photo. Please try again.')
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
    setServerMessages: _setServerMessages,
    setPendingMessages,
    loadMessages,
    onProgress,
    onError = defaultErrorHandler,
    onComplete,
  } = options
  void _setServerMessages // Intentionally unused - loadMessages handles refresh

  const tempId = `temp_video_${Date.now()}_${Math.random()}`
  const now = new Date().toISOString()
  const previewUrl = URL.createObjectURL(file)

  // Create optimistic message
  const optimisticMessage: GroupMessage & { clientKey: string } = {
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

  // Add to pending messages immediately
  setPendingMessages(prev => [...prev, optimisticMessage])

  try {
    // Upload to R2 CDN
    const uploadResult = await uploadMedia(file, 'video', onProgress)
    
    if (!uploadResult.success || !uploadResult.path) {
      throw new Error(uploadResult.error || 'Upload failed')
    }

    // Send message to group
    const response = await fetch(`/api/group_chat/${groupId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ video_path: uploadResult.path }),
    })
    
    const data = await response.json()
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to send video')
    }

    // Remove from pending, server message will come via loadMessages
    setPendingMessages(prev => prev.filter(m => m.clientKey !== tempId))
    
    // Refresh messages to get the confirmed message
    loadMessages(true)
    
    return true
  } catch (error) {
    console.error('Group video upload failed:', error)
    
    // Remove optimistic message on failure
    setPendingMessages(prev => prev.filter(m => m.clientKey !== tempId))
    
    onError('Failed to send video. Please try again.')
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
