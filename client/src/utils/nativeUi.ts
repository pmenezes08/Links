// Native dialogs + toasts on iOS/Android (Capacitor), with graceful web fallbacks.
// The SAME dist bundle serves the web app and the native WebView, so every call is
// gated on Capacitor.isNativePlatform(); plugins are lazy-imported so the web bundle
// isn't forced to load them. `alert`/`confirm` here are ASYNC — callers in a
// synchronous handler must `await` inside an async function.
import { Capacitor } from '@capacitor/core'

export async function nativeAlert(message: string, title = 'C-Point'): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Dialog } = await import('@capacitor/dialog')
      await Dialog.alert({ title, message })
      return
    } catch {
      /* fall through to web */
    }
  }
  if (typeof window !== 'undefined') window.alert(message)
}

export async function nativeConfirm(message: string, title = 'C-Point'): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Dialog } = await import('@capacitor/dialog')
      const { value } = await Dialog.confirm({ title, message })
      return value
    } catch {
      /* fall through to web */
    }
  }
  return typeof window !== 'undefined' ? window.confirm(message) : true
}

export async function nativeToast(message: string, duration: 'short' | 'long' = 'short'): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Toast } = await import('@capacitor/toast')
      await Toast.show({ text: message, duration, position: 'bottom' })
      return
    } catch {
      /* fall through to web */
    }
  }
  showWebToast(message, duration === 'long' ? 3500 : 2200)
}

// Minimal non-blocking web toast so migrating a blocking `alert()` to `nativeToast`
// doesn't make web feedback disappear. Self-contained; no dependency.
let webToastHost: HTMLDivElement | null = null
function showWebToast(message: string, ms: number): void {
  if (typeof document === 'undefined' || !document.body) return
  if (!webToastHost) {
    webToastHost = document.createElement('div')
    webToastHost.style.cssText =
      'position:fixed;left:0;right:0;bottom:24px;z-index:2147483647;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;'
    document.body.appendChild(webToastHost)
  }
  const el = document.createElement('div')
  el.textContent = message
  el.style.cssText =
    'max-width:88%;padding:10px 16px;border-radius:9999px;background:rgba(20,20,20,0.95);color:#fff;font-size:13px;line-height:1.3;box-shadow:0 4px 20px rgba(0,0,0,.4);opacity:0;transition:opacity .2s;'
  webToastHost.appendChild(el)
  requestAnimationFrame(() => {
    el.style.opacity = '1'
  })
  setTimeout(() => {
    el.style.opacity = '0'
    setTimeout(() => el.remove(), 250)
  }, ms)
}
