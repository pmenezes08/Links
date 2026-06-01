export interface UploadMetricPayload {
  event: 'start' | 'part' | 'complete' | 'fail' | 'abort' | 'retry'
  mediaKind: string
  contextType: string
  bytes?: number
  parts?: number
  durationMs?: number
  retries?: number
  failureReason?: string
}

export function logUploadMetric(payload: UploadMetricPayload): void {
  try {
    if (import.meta.env.DEV) {
      console.info('[chat_upload_metric]', payload)
    }
    window.dispatchEvent(new CustomEvent('chat-upload-metric', { detail: payload }))
  } catch {
    /* ignore */
  }
}
