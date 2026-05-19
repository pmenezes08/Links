// client/src/i18n/fetchHeaders.ts
//
// Attach Accept-Language + X-CPoint-Locale to every same-origin fetch
// the SPA makes. The server uses these (see
// backend/services/user_locale.resolve_request_locale) to localize
// responses for users who have not yet saved a preferred_locale.
//
// We monkey-patch window.fetch once at boot rather than rolling a
// dedicated fetch client because the codebase has dozens of bare
// fetch() call sites and we want headers to be ambient.
//
// Same-origin only: we deliberately skip external hosts (Stripe, R2,
// CDN, Capacitor in-app browser, etc.) to avoid leaking app-specific
// headers into third-party requests.

import i18n, { matchLocale, DEFAULT_LOCALE } from './index'

const ACCEPT_LANGUAGE_HEADER = 'Accept-Language'
const ACTIVE_LOCALE_HEADER = 'X-CPoint-Locale'

let installed = false

function isLikelySameOrigin(url: string): boolean {
  if (!url) return true
  // Bare paths and protocol-relative absolute paths against same host
  // are always same-origin from the SPA's perspective.
  if (url.startsWith('/')) return true
  try {
    const target = new URL(url, window.location.href)
    return target.origin === window.location.origin
  } catch {
    return false
  }
}

function activeLocale(): string {
  return matchLocale(i18n.language) ?? DEFAULT_LOCALE
}

/**
 * Install the global fetch interceptor. Safe to call multiple times;
 * subsequent calls are no-ops.
 */
export function installLocaleFetchHeaders(): void {
  if (installed) return
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return
  installed = true

  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url

      if (!isLikelySameOrigin(url)) {
        return originalFetch(input, init)
      }

      const locale = activeLocale()
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))

      if (!headers.has(ACTIVE_LOCALE_HEADER)) {
        headers.set(ACTIVE_LOCALE_HEADER, locale)
      }
      if (!headers.has(ACCEPT_LANGUAGE_HEADER)) {
        // Send the active locale first, then English as the universal
        // fallback. The server already prefers users.preferred_locale
        // and X-CPoint-Locale before this header, so quality values
        // are mostly cosmetic.
        const accept = locale === DEFAULT_LOCALE ? DEFAULT_LOCALE : `${locale},${DEFAULT_LOCALE};q=0.8`
        headers.set(ACCEPT_LANGUAGE_HEADER, accept)
      }

      const merged: RequestInit = { ...(init ?? {}), headers }
      return originalFetch(input, merged)
    } catch {
      // Never let the locale wrapper turn into a request-blocking bug.
      return originalFetch(input, init)
    }
  }
}
