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
  // The native App listener resolves async; track removal so a cleanup that runs before
  // it registers still tears it down (otherwise every hook re-enable leaks a listener and
  // stacks redundant onResume calls).
  let removed = false
  let removeNative: (() => void) | null = null
  if (Capacitor.isNativePlatform()) {
    void import('@capacitor/app').then(({ App }) =>
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) onResume()
      }).then(listener => {
        if (removed) void listener.remove()
        else removeNative = () => { void listener.remove() }
      }),
    ).catch(() => {})
  }
  return () => {
    removed = true
    document.removeEventListener('visibilitychange', handler)
    removeNative?.()
  }
}
