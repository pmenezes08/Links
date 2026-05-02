/**
 * Service-worker cache routing policy (testable mirror of `client/public/sw.js`).
 *
 * Service-worker scripts cannot be imported by vitest, so we keep the prefix
 * list as the single source of truth here and mirror it verbatim into
 * `sw.js`. The vitest suite asserts that representative authenticated and
 * public URLs hit the right branch — any drift between this file and `sw.js`
 * shows up immediately as a failing test.
 *
 * SECURITY: every prefix below describes a route family that is user-scoped
 * or otherwise must never be served from a URL-keyed cache. Adding a new
 * authenticated prefix? Add it here AND in `client/public/sw.js`'s
 * `NEVER_CACHE_PREFIXES` array.
 */

export const NEVER_CACHE_PREFIXES: readonly string[] = [
  '/api/',
  '/get_',
  '/check_',
  '/update_',
  '/delete_',
  '/add_',
  '/upload_',
  '/admin', // matches /admin, /admin_*, /admin/...
  '/profile/',
  '/notifications',
  '/event/',
  '/account_',
  '/edit_',
  '/business_',
  '/remove_',
  '/resend_',
  '/clear_',
  '/verify_',
  '/logout',
  '/login', // matches /login, /login_password, /login_back
  '/signup', // matches /signup, /signup_react
] as const

/** Return true when the SW must stay out of this request entirely. */
export function shouldBypassCache(pathname: string): boolean {
  for (const prefix of NEVER_CACHE_PREFIXES) {
    if (pathname.startsWith(prefix)) return true
  }
  return false
}
