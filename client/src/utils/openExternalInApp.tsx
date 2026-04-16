import { Capacitor } from '@capacitor/core'
import { InAppBrowser, ToolBarType, BackgroundColor } from '@capgo/inappbrowser'
import { createRoot, type Root } from 'react-dom/client'
import WebArticleFallback from '../components/WebArticleFallback'

let webOverlayRoot: Root | null = null
let webOverlayHost: HTMLDivElement | null = null

function normalizeUrlForOpen(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.href
  } catch {
    return null
  }
}

function closeWebOverlay() {
  if (webOverlayRoot && webOverlayHost) {
    webOverlayRoot.unmount()
    webOverlayHost.remove()
    webOverlayRoot = null
    webOverlayHost = null
  }
}

/**
 * Opens an external https URL in-app: native WebView (Capacitor) or full-screen iframe on web.
 * Does not re-host HTML (ToS-safe).
 */
export async function openExternalInApp(rawUrl: string): Promise<void> {
  const url = normalizeUrlForOpen(rawUrl)
  if (!url) {
    console.warn('openExternalInApp: invalid URL', rawUrl)
    return
  }

  if (Capacitor.isNativePlatform()) {
    try {
      await InAppBrowser.openWebView({
        url,
        toolbarType: ToolBarType.COMPACT,
        backgroundColor: BackgroundColor.BLACK,
        visibleTitle: false,
        showArrow: true,
        activeNativeNavigationForWebview: true,
      })
    } catch (e) {
      console.error('openExternalInApp: InAppBrowser failed', e)
    }
    return
  }

  closeWebOverlay()
  const host = document.createElement('div')
  host.setAttribute('data-web-in-app-browser', '')
  document.body.appendChild(host)
  webOverlayHost = host
  webOverlayRoot = createRoot(host)
  webOverlayRoot.render(
    <WebArticleFallback url={url} onClose={closeWebOverlay} />,
  )
}
