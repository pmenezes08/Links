# iOS Logout Session Persistence Audit

**Date:** 2026-05-28
**Scope:** iOS Capacitor shell — why sessions survive the logout flow
**Status:** Investigation only — no code changes

---

## 1. Persistence-Layer Matrix

| # | Layer | What it stores | Cleared by current logout? | Risk if not cleared |
|---|-------|---------------|---------------------------|---------------------|
| 1 | **WKWebView cookies** (`WKHTTPCookieStore`) | `cpoint_session`, `remember_token`, `native_push_install_id` | Partially — relies on `Set-Cookie` headers in a **302 redirect** response from `/logout` | **HIGH** — if any Set-Cookie header is dropped by WKWebView during the redirect, the session cookie persists in the WebView cookie jar and every subsequent JS `fetch(…, {credentials:'include'})` re-authenticates |
| 2 | **`URLSession.shared` cookies** (`HTTPCookieStorage.shared`) | Copies of `cpoint_session` (if badge-sync request created them) | **NO** — logout only clears WKWebView-side cookies; `URLSession.shared` has a **separate cookie jar** | **CRITICAL** — `AppDelegate.syncBadgeWithServer()` uses `URLSession.shared`, which may already hold a valid `cpoint_session`. On next `applicationDidBecomeActive`, this jar sends the stale cookie to `/api/notifications/badge-count`, potentially refreshing a server-side session or at minimum proving the old cookie was never invalidated from this jar |
| 3 | **Capacitor Preferences** (`@capacitor/preferences` → `UserDefaults` suite `CapacitorStorage`) | App-level key-value pairs | **YES** — `Preferences.clear()` is called | Low |
| 4 | **Standard `UserDefaults`** | `launchUniversalLink`, `lastUniversalLink` | **NO** — no code clears these keys | **MEDIUM** — stale deep-link URL survives logout; if app is killed and cold-launched via universal link, the old URL is in `UserDefaults` but the WebView navigates to the new one, so minimal auth risk; however it is dead data |
| 5 | **App Group container** (`group.co.cpoint.app`) | Share Extension manifest + media files in `IncomingShare/` | **NO** — only `clearPending()` (JS call from share-incoming page) removes these | Low — share payloads are media blobs, not session tokens |
| 6 | **iOS Keychain** — Google Sign-In | GIDSignIn OAuth tokens (access token, ID token, refresh token) | **Partially** — `GoogleAuth.signOut()` calls `GIDSignIn.sharedInstance.signOut()` which clears the in-memory `currentUser` and its keychain entry, but does **not** call `disconnect()`, so the user's Google account remains associated with the app | **MEDIUM** — next sign-in shows the previously used Google account as a quick-pick, but does not auto-authenticate without user tap |
| 7 | **iOS Keychain** — Apple Sign In | ASAuthorization credential (managed by OS, not app) | **NO** — there is no `ASAuthorizationAppleIDProvider.revokeToken()` in the logout flow | Low — Apple Sign In is stateless per-request; no stored refresh token in app scope |
| 8 | **iOS Keychain** — Firebase Installations | Firebase Instance ID / Installations data | **NO** — `Messaging.deleteToken()` invalidates the FCM token at Firebase's server but does **not** clear the Firebase Installations ID from Keychain | **MEDIUM** — on next launch, Firebase SDK auto-generates a new token and fires `messaging:didReceiveRegistrationToken:`. If `PushInit.tsx` runs before the welcome screen gate, the new token gets cached in `window.__fcmToken` and `__reregisterPushToken` is set up, potentially allowing a stale session (if cookies also persisted) to re-register push |
| 9 | **`NSUserDefaults`** — Firebase SDK | Firebase Analytics app-instance ID, FCM auto-init flag, APNS token cache | **NO** — not addressed by logout | Low — no session material |
| 10 | **WKWebView localStorage / sessionStorage** | Account-scoped keys (`signal_*`, `chat_*`, `community_*`, etc.) | **YES** — `resetAccountScopedState` iterates known prefixes + keys | Low (thorough) |
| 11 | **WKWebView IndexedDB** | `chat-encryption`, `signal-protocol`, `signal-store`, `cpoint-offline-db` | **YES** — explicitly deleted | Low |
| 12 | **WKWebView Cache Storage** | Service worker runtime caches (`cp-*`) | **YES** — `caches.delete()` for matching names | Low |
| 13 | **Service Worker registrations** | Push subscription, SW script | **YES** — `unregisterServiceWorkersForAccount()` | Low |

---

## 2. Top 3 iOS-Specific Root-Cause Candidates

### RC-1 (Critical): Dual cookie jar — `URLSession.shared` retains session cookie

**Evidence:**

`AppDelegate.swift:137–176` — `syncBadgeWithServer()` fires on every `applicationDidBecomeActive` (including the first foreground after logout). It uses `URLSession.shared.dataTask(with: request)` to `GET /api/notifications/badge-count`.

`URLSession.shared` uses `HTTPCookieStorage.shared`, which is a **completely separate** cookie store from WKWebView's `WKHTTPCookieStore`. The two are not automatically synchronised on iOS.

**The attack path:**

1. User logs in → WKWebView receives `Set-Cookie: cpoint_session=…` from the server.
2. At some point, `syncBadgeWithServer()` fires. `URLSession.shared` sends its own HTTP request. If WKWebView and `URLSession.shared` share cookies for the same domain (they can, via `HTTPCookieStorage.shared` if the cookie domain matches), the session cookie lands in the native jar. Even if they don't share automatically, the badge-sync request may cause the **server to set a session cookie on the native-side response**, which `URLSession.shared` stores.
3. User logs out → `window.location.replace('/logout')` fires in WKWebView. The 302 response sets `cpoint_session=""` with `max_age=0` **in WKWebView's cookie store only**. `URLSession.shared`'s copy is untouched.
4. User kills and reopens app → `applicationDidBecomeActive` → `syncBadgeWithServer()` → `URLSession.shared` sends the **old, still-valid** `cpoint_session` to `/api/notifications/badge-count`. If the server accepts it, the session is effectively alive from the native-HTTP side.
5. Meanwhile, WKWebView loads `https://app.c-point.co` — if the session cookie was properly cleared in WKWebView, the user should land on `/welcome`. But if the server's `before_request` handler sees the remember_token or refreshed session from step 4, the session could be restored.

**Additional risk factor:** The Flask config sets `SESSION_REFRESH_EACH_REQUEST = True` and `SESSION_COOKIE_SAMESITE = 'None'`. Every successful authenticated request extends the session lifetime. The native badge-sync call keeps refreshing the cookie.

### RC-2 (High): WKWebView drops `Set-Cookie` on 302 redirect

**Evidence:**

The backend `/logout` route (`auth.py:580–623`) returns:

```python
resp = make_response(redirect("/welcome"))   # 302
remember_tokens.clear_cookie(resp)           # Set-Cookie: remember_token=""
auth_session.clear_session_cookie(resp)      # Set-Cookie: cpoint_session=""
auth_session.clear_install_cookie(resp)      # Set-Cookie: native_push_install_id=""
```

This means the cookie-clearing `Set-Cookie` headers ride on the **302 response**, not on the final 200 response at `/welcome`.

**Known WKWebView behaviour:** There is a long-standing WebKit behaviour (not technically a "bug" per spec, but a divergence from desktop Safari) where `Set-Cookie` headers on **redirect** (3xx) responses are sometimes not applied to `WKHTTPCookieStore`, especially when:
- The redirect is cross-origin (not the case here — same host)
- `SameSite=None` is used (which this app does use in production)
- Multiple `Set-Cookie` headers are present on the same response

Even when same-origin, timing matters — WKWebView's cookie store is asynchronous. If the redirect completes faster than the cookie-store flush, the old cookie value persists.

**Compounding factor:** `clear_session_cookie` emits **four** `Set-Cookie` headers for `cpoint_session` (one per domain variant: configured domain, `.c-point.co`, `app.c-point.co`, host-only). Combined with `remember_token` and `native_push_install_id` clearing headers, the 302 response carries **~6 Set-Cookie headers**. WKWebView's batched cookie application on a redirect response is the most fragile path.

### RC-3 (Medium): Resume handlers fire with stale cookies before redirect completes

**Evidence:**

Multiple JS-side `App.addListener('resume', ...)` handlers exist:

- **`BadgeContext.tsx:107`** — on resume, calls `poll()` which does `fetch('/api/notifications/badge-count', {credentials:'include'})` and then `fetch('/api/notifications/clear-badge', {credentials:'include'})`.
- **`useResumeOutboxDrain.ts:14`** — on resume, drains the offline outbox, which sends queued `fetch` requests with `credentials:'include'`.

If the user backgrounds the app during or just after the logout sequence (before `window.location.replace('/logout')` completes its full redirect chain), then:

1. The app enters background with the old session cookie still in WKWebView.
2. On resume, these handlers fire immediately and send authenticated requests.
3. If the server's `SESSION_REFRESH_EACH_REQUEST` processes one of these requests before the 302 cookie-clearing arrives, the session is refreshed/extended.
4. The race is tight but plausible on slow networks.

---

## 3. Reproduction Steps

### Repro for RC-1 (Dual cookie jar)

1. Install a debug build on a physical iOS device.
2. Log in. Navigate around to ensure badge sync has fired at least once (background → foreground the app).
3. Log out via the app's logout button.
4. **Kill the app** (swipe up from app switcher).
5. Relaunch the app.
6. **Check:** Does the app land on `/welcome` or on the dashboard? If dashboard → session persisted.
7. **Instrument (if possible):** Add `NSLog` in `syncBadgeWithServer()` to print all cookies from `HTTPCookieStorage.shared.cookies(for: url)` before making the request. Check if `cpoint_session` is present after logout.

### Repro for RC-2 (302 Set-Cookie drop)

1. Log in on iOS device.
2. Open Safari Web Inspector → connect to the WKWebView.
3. In the JS console, run: `document.cookie` — note the `cpoint_session` value (or absence if httpOnly, in which case check via Network tab).
4. Trigger logout.
5. **Immediately** after the page lands on `/welcome`, check cookies in Web Inspector's Storage tab.
6. **Check:** Is `cpoint_session` still present with a non-empty value? If yes → the 302 Set-Cookie was dropped.
7. **Alternative:** Before logout, set a breakpoint in Safari on the `/logout` network request and inspect response headers. Verify all `Set-Cookie` headers are present on the 302.

### Repro for RC-3 (Resume race)

1. Log in on iOS device.
2. Tap "Log out."
3. **Immediately** press the Home button (background the app) before the `/welcome` page fully loads.
4. Wait 2-3 seconds, then resume the app.
5. **Check:** Does the app land on `/welcome` or did a resume handler's fetch keep the session alive?
6. Repeat with airplane mode ON during step 3 (to delay the 302 completion), then turn airplane mode OFF in step 4.

---

## 4. Open Questions for Parent Agent / Logs

1. **Production `CANONICAL_HOST` value:** The session cookie domain logic in `bodybuilding_app.py:647–651` skips setting `SESSION_COOKIE_DOMAIN` when `CANONICAL_HOST == 'app.c-point.co'`. Confirm that production Cloud Run has `CANONICAL_HOST=app.c-point.co` as an env var (it's not in Secret Manager per `wire_prod_cloud_run_secrets.sh`). If it's unset or different, the cookie domain mismatch could cause clearing to fail.

2. **Server-side session store:** Is the session backend Redis, filesystem, or signed-cookie? If Redis-backed with `SESSION_REFRESH_EACH_REQUEST=True`, the badge-sync native request (via `URLSession.shared`) refreshes the session TTL on every foreground, even after logout cleared the WKWebView cookie.

3. **Device logs:** Can we get `NSLog` output from a user experiencing the bug? Specifically:
   - Does `syncBadgeWithServer` fire after logout? What HTTP status does it get?
   - What cookies does `HTTPCookieStorage.shared` hold for `app.c-point.co` after the user logs out?

4. **Remember-me token:** The `remember_token` cookie is `httpOnly=True, secure=True, sameSite=Lax`. On next app launch, does `before_request` call `remember_tokens.restore_session()` and silently re-establish the session even though `cpoint_session` was cleared? Check if `remember_token` was also properly cleared by the 302 — same WKWebView redirect risk applies.

5. **iOS version distribution:** WKWebView cookie handling has improved in iOS 16.4+ (WebKit cookie-store flush improvements). Are the reports concentrated on older iOS versions (14-15)?

---

## 5. Additional Findings

### 5a. No `CapacitorHttp` plugin in use

The app does **not** use `@capacitor/core`'s `CapacitorHttp` or `@capacitor-community/http`. All JS `fetch()` calls go through WKWebView's native networking stack, which shares the WKWebView cookie jar. This rules out a third cookie-jar split from HTTP plugin proxying.

Plugins that do HTTP (from Podfile analysis):
- `Firebase/Messaging` — FCM token exchange (uses its own auth, not session cookies)
- `CapgoNativePurchases` — StoreKit receipts (no session cookies)
- `CapgoInappbrowser` — opens a separate `SFSafariViewController` (isolated cookie jar, not shared with WKWebView)
- `CodetrixStudioCapacitorGoogleAuth` — Google Sign-In SDK (uses OAuth, not session cookies)
- **`AppDelegate.syncBadgeWithServer()`** — uses `URLSession.shared` (**THIS is the dual-jar problem**)

### 5b. Universal link bypass risk

`AppDelegate` stores `launchUniversalLink` in `UserDefaults` on cold start from a universal link. This value is never cleared during logout. If the React app reads this value (via a native bridge call or Capacitor plugin) and navigates to the deep-linked route, a logged-out user could land on an authenticated view. However, the WebView should still enforce the session check server-side, so this is a UX issue rather than a session persistence issue — unless combined with RC-1 or RC-2.

### 5c. FCM token lifecycle is correct but fragile

The `FCMPlugin.swift:deleteToken()` correctly calls `Messaging.messaging().deleteToken()`, which invalidates the token server-side at Firebase. On next launch, Firebase generates a **new** token and fires `messaging:didReceiveRegistrationToken:`. The new token is only registered with the C-Point server when `__reregisterPushToken()` runs (gated by session existence in `PushInit.tsx`). This is correct — but if the session persists (per RC-1/RC-2), the new token gets registered to the old user, causing push leakage.

### 5d. `SameSite=None` on production cookies

Production sets `SESSION_COOKIE_SAMESITE = 'None'` with `SESSION_COOKIE_SECURE = True`. This is required for admin cross-subdomain access but is more permissive than needed for the iOS Capacitor shell. WKWebView on iOS 15+ enforces `SameSite=None` + `Secure` strictly — but the permissive `SameSite` means the cookie is sent on all cross-site contexts, including any `URLSession.shared` requests that happen to match the domain.

---

## 6. Recommended Investigation Priority

| Priority | Action | Owner |
|----------|--------|-------|
| P0 | Instrument `syncBadgeWithServer()` to log `HTTPCookieStorage.shared.cookies(for:)` before/after logout | ios-expert |
| P0 | Add explicit `HTTPCookieStorage.shared.removeCookies(since:)` in a logout bridge call, or switch badge sync to use `WKWebView.evaluateJavaScript` instead of `URLSession.shared` | ios-expert + c-point-lead |
| P1 | Change `/logout` to return 200 with Set-Cookie headers + client-side redirect (JS `window.location = '/welcome'`) instead of 302 | c-point-lead (backend) |
| P1 | Add a `WKHTTPCookieStore` flush/delete step via native bridge during the JS logout flow | ios-expert |
| P2 | Clear `UserDefaults` keys (`launchUniversalLink`, `lastUniversalLink`) during logout | ios-expert |
| P2 | Audit whether `remember_tokens.restore_session()` runs in `before_request` and can silently re-establish a session | c-point-lead |
