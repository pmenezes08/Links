export { isChatUploadV2Enabled, setChatUploadV2Enabled } from './featureFlag'
export { uploadChatMediaBlob, uploadChatMediaBatch, SENDING_MEDIA_LABEL } from './uploadKernel'
export { optimizeVideoForUpload } from './videoTranscode'
export { UploadRequestError } from './multipartUploader'
export { logUploadMetric } from './uploadMetrics'
export { getStoredMediaQuality, setStoredMediaQuality } from './mediaQuality'
export { createUploadController, cancelUpload, removeUploadController, hasUploadController } from './uploadControllers'
export {
  saveMediaOutboxRecord,
  updateMediaOutboxRecord,
  claimMediaOutboxRecord,
  releaseMediaOutboxRecord,
  removeMediaOutboxRecordsByPrefix,
  listPendingMediaOutbox,
  resumeOutboxUploads,
  clearMediaOutbox,
} from './mediaOutbox'
export {
  uploadChatMediaWithBackground,
  isNativeBackgroundUploadAvailable,
  registerBackgroundUploadResume,
} from './nativeBackgroundUpload'
export type { UploadContext, UploadProgress, UploadStage, MediaKind, MediaQuality } from './types'
