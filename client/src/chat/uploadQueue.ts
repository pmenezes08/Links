interface UploadTask {
  chatType: 'dm' | 'group';
  chatId: string | number;
  tempId: string;
  files: Array<{file: File; type: 'image' | 'video'}>;
  onProgress?: (progress: any) => void;
  onComplete?: (payload: any) => void;
  onError?: (error: any) => void;
}

class UploadQueue {
  private queue: UploadTask[] = [];
  private isProcessing = false;

  enqueue(task: UploadTask): string {
    this.queue.push(task);
    this.processQueue();
    return task.tempId;
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const task = this.queue.shift()!;

    try {
      task.onProgress?.({ stage: 'uploading', progress: 20 });

      // Note: The actual upload logic (R2, /send_dm_media, etc.) would be refactored here in a full implementation.
      // For this plan, we simulate the server response. In practice, the sendMultiMediaMessage logic would be moved here.
      const mockPayload = {
        success: true,
        id: Date.now(),
        media_paths: task.files.map((f, i) => `uploads/mock/${task.tempId}_${i}.jpg`),
        image_path: task.files[0].type === 'image' ? `uploads/mock/${task.tempId}_0.jpg` : undefined,
        video_path: task.files[0].type === 'video' ? `uploads/mock/${task.tempId}_0.mp4` : undefined,
        time: new Date().toISOString(),
      };

      task.onProgress?.({ stage: 'done', progress: 100, message: 'Sent!' });
      task.onComplete?.(mockPayload);

      // Fire global event so mounted chat components can update their optimistic message
      const event = new CustomEvent('upload-complete', {
        detail: {
          tempId: task.tempId,
          chatType: task.chatType,
          chatId: task.chatId,
          payload: mockPayload,
        },
      });
      window.dispatchEvent(event);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Upload failed';
      task.onProgress?.({ stage: 'error', progress: 0, message: errMsg });
      task.onError?.(error);

      const event = new CustomEvent('upload-error', {
        detail: {
          tempId: task.tempId,
          error,
        },
      });
      window.dispatchEvent(event);
    } finally {
      this.isProcessing = false;
      this.processQueue(); // process next in queue
    }
  }

  // Helper to listen for uploads in chat components
  onUploadComplete(callback: (detail: any) => void) {
    const listener = (e: CustomEvent) => callback(e.detail);
    window.addEventListener('upload-complete', listener as EventListener);
    return () => window.removeEventListener('upload-complete', listener as EventListener);
  }

  onUploadError(callback: (detail: any) => void) {
    const listener = (e: CustomEvent) => callback(e.detail);
    window.addEventListener('upload-error', listener as EventListener);
    return () => window.removeEventListener('upload-error', listener as EventListener);
  }
}

// Module-level singleton
export const uploadQueue = new UploadQueue();
