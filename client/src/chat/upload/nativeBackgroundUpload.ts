import { Capacitor } from '@capacitor/core'
import type { UploadBlobResult, UploadKernelOptions } from './types'
import { uploadChatMediaBlob } from './uploadKernel'

/**
 * Native background upload bridge (Phase 3).
 * Falls back to the web multipart kernel until a native plugin is wired.
 */
export function isNativeBackgroundUploadAvailable(): boolean {
  return Capacitor.isNativePlatform()
}

export async function uploadChatMediaWithBackground(options: UploadKernelOptions): Promise<UploadBlobResult> {
  // Future: delegate to Capacitor URLSession / WorkManager plugin.
  return uploadChatMediaBlob(options)
}

/** Resume pending outbox uploads when app returns to foreground (web + native). */
export function registerBackgroundUploadResume(onResume: () => void): () => void {
  const handler = () => {
    if (document.visibilityState === 'visible') onResume()
  }
  document.addEventListener('visibilitychange', handler)
  if (Capacitor.isNativePlatform()) {
    void import('@capacitor/app').then(({ App }) => {
      void App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) onResume()
      })
    }).catch(() => {})
  }
  return () => document.removeEventListener('visibilitychange', handler)
}
