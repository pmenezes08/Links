export type UploadContext =
  | { type: 'dm'; recipientId: string | number }
  | { type: 'group'; groupId: string | number }

export type MediaKind = 'image' | 'video'
export type MediaQuality = 'standard' | 'hd'

export type UploadStage =
  | 'queued'
  | 'compressing'
  | 'uploading'
  | 'sending'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface UploadProgress {
  stage: UploadStage
  progress: number
  message?: string
  bytesPerSecond?: number
  etaSeconds?: number
}

export interface CompletedPart {
  partNumber: number
  etag: string
}

export interface MultipartSession {
  sessionId: string
  uploadId: string
  partSize: number
  key: string
  publicUrl: string
}

export interface MediaOutboxRecord {
  id?: number
  clientKey: string
  context: UploadContext
  mediaKind: MediaKind
  quality?: MediaQuality
  filename: string
  contentType: string
  blobSize: number
  sessionId?: string
  uploadId?: string
  partSize?: number
  key?: string
  publicUrl?: string
  uploadedUrl?: string
  completedParts: CompletedPart[]
  status: 'pending' | 'uploading' | 'committing' | 'failed' | 'completed' | 'cancelled'
  error?: string
  lockedAt?: number
  createdAt: number
  updatedAt?: number
  retries: number
  /** Serialized blob in IndexedDB when available */
  hasBlob: boolean
}

export interface UploadBlobResult {
  publicUrl: string
  key: string
  outboxId?: number
}

export interface UploadKernelOptions {
  context: UploadContext
  file: File
  mediaKind: MediaKind
  quality?: MediaQuality
  onProgress?: (progress: UploadProgress) => void
  signal?: AbortSignal
  clientKey?: string
  resumeRecord?: MediaOutboxRecord & { id: number }
}
