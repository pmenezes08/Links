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
    // Single request - upload and send in one call (like ChatThread)
    const result = await sendGroupMedia(file, groupId, 'photo', onProgress)
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to send image')
    }

    // Remove from pending, server message will come via loadMessages
    setPendingMessages(prev => prev.filter(m => m.clientKey !== tempId))
    
    // Refresh messages to get the confirmed message
    loadMessages(true)
    
    return true
  } catch (error) {
    console.error('[GroupMedia] Image send failed:', error)
    
    // Remove optimistic message on failure
    setPendingMessages(prev => prev.filter(m => m.clientKey !== tempId))
    
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
    // Single request - upload and send in one call (like ChatThread)
    const result = await sendGroupMedia(file, groupId, 'video', onProgress)
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to send video')
    }

    // Remove from pending, server message will come via loadMessages
    setPendingMessages(prev => prev.filter(m => m.clientKey !== tempId))
    
    // Refresh messages to get the confirmed message
    loadMessages(true)
    
    return true
  } catch (error) {
    console.error('[GroupMedia] Video send failed:', error)
    
    // Remove optimistic message on failure
    setPendingMessages(prev => prev.filter(m => m.clientKey !== tempId))
    
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
