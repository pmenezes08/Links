/**
 * Google Identity Services (gsi/client) for web — required for new OAuth clients;
 * legacy iframe/iframerpc flows fail with access_denied for new Google Cloud clients.
 */
import { GOOGLE_WEB_CLIENT_ID } from '../constants/googleOAuth'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
          disableAutoSelect: () => void
        }
      }
    }
  }
}

let scriptPromise: Promise<void> | null = null

export function loadGsiScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.google?.accounts?.id) return Promise.resolve()

  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(
        'script[src="https://accounts.google.com/gsi/client"]',
      ) as HTMLScriptElement | null
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true })
        existing.addEventListener('error', () => reject(new Error('GSI script error')), {
          once: true,
        })
        return
      }
      const s = document.createElement('script')
      s.src = 'https://accounts.google.com/gsi/client'
      s.async = true
      s.defer = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('Failed to load Google Identity Services'))
      document.head.appendChild(s)
    })
  }
  return scriptPromise
}

/** Delivers JWT id-token strings from GIS `initialize` callback. */
export type GsiIdTokenHandler = (idToken: string) => void

let gsiInitialized = false
let lastHandler: GsiIdTokenHandler | null = null

export function setGsiIdTokenHandler(handler: GsiIdTokenHandler | null): void {
  lastHandler = handler
}

/** Call once after GSI script loads; safe to call multiple times (handler updates via setGsiIdTokenHandler). */
export function initializeGoogleIdentityOnce(): void {
  if (typeof window === 'undefined' || !window.google?.accounts?.id) return
  if (gsiInitialized) return
  gsiInitialized = true
  window.google.accounts.id.initialize({
    client_id: GOOGLE_WEB_CLIENT_ID,
    callback: (resp: { credential?: string }) => {
      const c = resp.credential
      if (c) lastHandler?.(c)
    },
    auto_select: false,
    cancel_on_tap_outside: true,
  })
}

export function renderGoogleSignInButton(
  parent: HTMLElement,
  options?: { theme?: 'outline' | 'filled_blue' | 'filled_black'; width?: number },
): void {
  if (!window.google?.accounts?.id) return
  parent.innerHTML = ''
  const width = options?.width ?? Math.min(400, Math.floor(parent.getBoundingClientRect().width) || 380)
  window.google.accounts.id.renderButton(parent, {
    type: 'standard',
    theme: options?.theme ?? 'filled_black',
    size: 'large',
    text: 'signin_with',
    shape: 'rectangular',
    logo_alignment: 'left',
    width,
  })
}
