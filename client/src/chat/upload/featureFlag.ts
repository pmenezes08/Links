/** Feature flag for Chat Media Upload v2 (multipart + outbox). Enabled by default. */
export function isChatUploadV2Enabled(): boolean {
  try {
    const env = import.meta.env.VITE_CHAT_UPLOAD_V2
    if (env === 'false' || env === '0') return false
    const stored = localStorage.getItem('cpoint.chatUploadV2')
    if (stored === '0') return false
    return true
  } catch {
    return true
  }
}

export function setChatUploadV2Enabled(enabled: boolean): void {
  try {
    localStorage.setItem('cpoint.chatUploadV2', enabled ? '1' : '0')
  } catch {
    /* ignore */
  }
}
