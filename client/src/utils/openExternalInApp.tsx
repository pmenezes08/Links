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

/** Short label for toolbar before/around load (hostname); avoids default "New Window". */
function toolbarTitleFromUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname || url
  } catch {
    return url
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
        title: toolbarTitleFromUrl(url),
        toolbarType: ToolBarType.COMPACT,
        backgroundColor: BackgroundColor.BLACK,
        visibleTitle: true,
        showArrow: true,
        activeNativeNavigationForWebview: true,
      })
    } catch (e) {
      console.error('openExternalInApp: InAppBrowser failed', e)
      // Production binaries without @capgo/inappbrowser (or other native errors): still open the link.
      try {
        window.open(url, '_blank', 'noopener,noreferrer')
      } catch (openErr) {
        console.error('openExternalInApp: window.open fallback failed', openErr)
      }
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

/**
 * Prefer OS-level URL open (Universal Links / App Links via @capacitor/app), then in-app browser.
 * Use for chat links and other taps where nested youtube.com WebViews fight with the YouTube app.
 */
export async function openExternalNativeLink(rawUrl: string): Promise<void> {
  const url = normalizeUrlForOpen(rawUrl)
  if (!url) {
    console.warn('openExternalNativeLink: invalid URL', rawUrl)
    return
  }

  if (!Capacitor.isNativePlatform()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }

  try {
    const { App: CapApp } = await import('@capacitor/app')
    const anyApp = CapApp as unknown as {
      openUrl?: (opts: { url: string }) => Promise<{ completed?: boolean }>
    }
    if (anyApp.openUrl) {
      const res = await anyApp.openUrl({ url })
      if (res && res.completed === false) {
        await openExternalInApp(url)
      }
      return
    }
  } catch {
    // fall through to in-app browser
  }
  await openExternalInApp(url)
}
