/**
 * Background chat media upload queue — delegates to the shared upload kernel.
 */
import type { UploadContext, MediaKind, UploadProgress } from './upload/types'
import { uploadChatMediaBlob } from './upload/uploadKernel'

interface UploadTask {
  chatType: 'dm' | 'group'
  chatId: string | number
  tempId: string
  files: Array<{ file: File; type: 'image' | 'video' }>
  recipientId?: string | number
  onProgress?: (progress: UploadProgress) => void
  onComplete?: (payload: { success: boolean; tempId: string; urls?: string[] }) => void
  onError?: (error: unknown) => void
}

class UploadQueue {
  private queue: UploadTask[] = []
  private isProcessing = false

  enqueue(task: UploadTask): string {
    this.queue.push(task)
    void this.processQueue()
    return task.tempId
  }

  private buildContext(task: UploadTask): UploadContext {
    if (task.chatType === 'group') {
      return { type: 'group', groupId: task.chatId }
    }
    return { type: 'dm', recipientId: task.recipientId ?? task.chatId }
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return
    this.isProcessing = true
    const task = this.queue.shift()!

    try {
      const context = this.buildContext(task)
      const urls: string[] = []
      for (const item of task.files) {
        const mediaKind: MediaKind = item.type === 'video' ? 'video' : 'image'
        const result = await uploadChatMediaBlob({
          context,
          file: item.file,
          mediaKind,
          clientKey: `${task.tempId}_${urls.length}`,
          onProgress: task.onProgress,
        })
        urls.push(result.publicUrl)
      }
      const payload = { success: true, tempId: task.tempId, urls }
      task.onComplete?.(payload)
      window.dispatchEvent(new CustomEvent('upload-complete', { detail: { ...payload, chatType: task.chatType, chatId: task.chatId } }))
    } catch (error) {
      task.onError?.(error)
      window.dispatchEvent(new CustomEvent('upload-error', { detail: { tempId: task.tempId, error } }))
    } finally {
      this.isProcessing = false
      void this.processQueue()
    }
  }

  onUploadComplete(callback: (detail: unknown) => void) {
    const listener = (e: Event) => callback((e as CustomEvent).detail)
    window.addEventListener('upload-complete', listener)
    return () => window.removeEventListener('upload-complete', listener)
  }

  onUploadError(callback: (detail: unknown) => void) {
    const listener = (e: Event) => callback((e as CustomEvent).detail)
    window.addEventListener('upload-error', listener)
    return () => window.removeEventListener('upload-error', listener)
  }
}

export const uploadQueue = new UploadQueue()
