/**
 * Group Chat Media Senders - modular media upload handling for group chats.
 * V2 migration complete: now uses upload kernel (multipart R2, outbox, resume) instead of legacy direct uploads.
 * Mirrors the pattern from mediaSenders.ts but adapted for group chat API.
 */

import type { Dispatch, SetStateAction } from 'react'
import { SENDING_MEDIA_LABEL } from './mediaSenders'
import {
  createUploadController,
  removeUploadController,
  uploadChatMediaBlob,
  uploadChatMediaBatch,
  UploadRequestError,
  type MediaQuality,
} from './upload'
import { removeMediaOutboxRecordsByPrefix } from './upload/mediaOutbox'
import type { UploadContext, MediaKind } from './upload/types'
import type { EntitlementsError } from '../utils/entitlementsError'

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
  onLimitReached?: (err: EntitlementsError) => void
  onCancelReady?: (cancel: (() => void) | null) => void
  onComplete?: () => void
  quality?: MediaQuality
}

interface ImageMediaOptions extends BaseMediaOptions {
  file: File
  kind?: 'photo' | 'gif'
}

interface MultiMediaOptions extends BaseMediaOptions {
  files: Array<{ file: File; type: 'image' | 'video' }>
}

const defaultErrorHandler = (msg: string) => {
  if (typeof window !== 'undefined') {
    window.alert(msg)
  }
}

function uploadLimitError(err: unknown): EntitlementsError | null {
  if (!(err instanceof UploadRequestError)) return null
  if (err.code !== 'upload_size_limit' && err.code !== 'upload_daily_limit') return null
  return {
    success: false,
    error: 'entitlements_error',
    reason: err.code,
    message:
      err.code === 'upload_size_limit'
        ? 'This file is larger than your current chat media limit.'
        : 'You have reached today\'s chat media upload limit.',
    cta: { type: 'manage', label: 'View plans', url: '/subscription-plans' },
    usage: {},
  }
}

/**
 * Send image/video message to group chat - single request like ChatThread
 * Uses the same pattern as /send_photo_message for DMs
 */
/**
 * V2 single-file send for group media.
 * Uses uploadChatMediaBlob (multipart R2 + outbox) then commits via media_urls.
 * Replaces the legacy direct file POST path.
 */
async function sendGroupMedia(
  file: File,
  groupId: number | string,
  mediaType: 'photo' | 'video',
  onProgress?: (progress: UploadProgress) => void,
  clientKey?: string,
): Promise<{ success: boolean; message?: GroupMessage; error?: string }> {
  const mediaKind: MediaKind = mediaType === 'photo' ? 'image' : 'video'
  const context: UploadContext = { type: 'group', groupId }

  onProgress?.({ stage: 'uploading', progress: 5, message: SENDING_MEDIA_LABEL })

  try {
    const result = await uploadChatMediaBlob({
      context,
      file,
      mediaKind,
      quality: 'standard',
      clientKey: clientKey || `group_${Date.now()}`,
      onProgress: p => onProgress?.({ stage: p.stage as any, progress: p.progress, message: p.message }),
    })

    // Commit via media_urls (backend supports this path)
    const fd = new FormData()
    fd.append('media_urls', JSON.stringify([result.publicUrl]))
    const res = await fetch(`/api/group_chat/${groupId}/send_media`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    })
    const payload = await res.json().catch(() => null)
    if (!payload?.success) {
      onProgress?.({ stage: 'error', progress: 0, message: payload?.error || 'Failed to commit' })
      return { success: false, error: payload?.error || 'Failed to send' }
    }

    onProgress?.({ stage: 'done', progress: 100, message: 'Sent!' })
    return { success: true, message: payload.message }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Upload failed'
    onProgress?.({ stage: 'error', progress: 0, message: msg })
    return { success: false, error: msg }
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
    onLimitReached,
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
    const result = await sendGroupMedia(file, groupId, 'photo', onProgress, tempId)
    
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
    const limitErr = uploadLimitError(error)
    if (limitErr && onLimitReached) onLimitReached(limitErr)
    else onError(kind === 'gif' ? "Couldn't send GIF. Try again." : "Couldn't send photo. Try again.")
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
    onLimitReached,
    onCancelReady,
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
  const controller = createUploadController(tempId)
  onCancelReady?.(() => controller.abort())

  try {
    onProgress?.({ stage: 'uploading', progress: 5, message: SENDING_MEDIA_LABEL })

    let orderedUrls = await uploadChatMediaBatch(
      files.map(f => ({ file: f.file, mediaKind: f.type })),
      { type: 'group', groupId },
      (index, total, p) => {
        const slice = (index + p.progress / 100) / total
        const stage = p.stage === 'failed' || p.stage === 'cancelled' ? 'error' : p.stage === 'done' ? 'done' : 'uploading'
        onProgress?.({ stage, progress: 5 + slice * 90, message: p.message || SENDING_MEDIA_LABEL })
      },
      controller.signal,
      options.quality,
      tempId,
    )

    onProgress?.({ stage: 'uploading', progress: 96, message: SENDING_MEDIA_LABEL })
    const fd = new FormData()
    fd.append('media_urls', JSON.stringify(orderedUrls))
    fd.append('client_key', tempId)

    const res = await fetch(`/api/group_chat/${groupId}/send_media`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    })
    const payload = await res.json().catch(() => null)
    if (!payload?.success) {
      throw new Error(payload?.error || 'Failed to send media')
    }

    await removeMediaOutboxRecordsByPrefix(tempId)
    onProgress?.({ stage: 'done', progress: 100, message: 'Sent' })

    setServerMessages(prev => prev.filter(m => (m as any).clientKey !== tempId))

    loadMessages(true)
    setTimeout(() => loadMessages(true), 2000)

    return true
  } catch (error) {
    console.error('[GroupMedia] Multi-media send failed:', error)
    setServerMessages(prev => prev.filter(m => (m as any).clientKey !== tempId))
    
    const errorMsg = controller.signal.aborted ? 'Upload cancelled' : "Couldn't send media. Try again."
    onProgress?.({ stage: 'error', progress: 0, message: errorMsg })
    const limitErr = uploadLimitError(error)
    if (controller.signal.aborted) {
      // Cancelled by the user.
    } else if (limitErr && onLimitReached) onLimitReached(limitErr)
    else onError(errorMsg)
    return false
  } finally {
    // Cleanup preview URLs
    previewUrls.forEach(url => {
      try { URL.revokeObjectURL(url) } catch {}
    })
    removeUploadController(tempId)
    onCancelReady?.(null)
    onComplete?.()
  }
}
