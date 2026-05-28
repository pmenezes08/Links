# Logout session-persistence — root cause and remediation plan

**Date:** 2026-05-28
**Status:** Diagnosis-only. **No code lands until PO sign-off (see §8).**
**Inputs synthesised:**
- `docs/audit/android_logout_audit.md`
- `docs/audit/ios_logout_audit.md`
- Frontend logout audit (parent chat — not committed to disk)
- Backend logout audit (parent chat — not committed to disk)
- Production logs: `gcloud logging read … "auth.logout pre_username"` (last 3 days, `cpoint-app`)
- Direct re-read of `backend/blueprints/auth.py`, `backend/services/remember_tokens.py`, `backend/services/auth_session.py`, `client/src/utils/logout.ts`, `client/src/pages/MobileLogin.tsx`, `client/src/utils/logout.test.ts`, `client/ios/App/App/AppDelegate.swift`, `static/sw.js`, `bodybuilding_app.py:625–655`.

---

## 1. Executive summary

- **What is broken:** Logging out of C-Point does not reliably end the user's session on Capacitor (iOS + Android). Users tap "Log out", relaunch the app, and find themselves authenticated — sometimes still as the same account, sometimes "logged back in" silently.
- **Who is affected:** All Capacitor users (iOS WKWebView, Android WebView). Production logs over the last 3 days show this pattern on real accounts: `Admin` (iOS), `JohnDoe` (Android, repeated), `test` (Android), `mali…` (iOS). Desktop is a smaller, separate failure (service-worker cache + login state).
- **Why now:** Three independent bugs combined in the May 2026 session/domain migration (`CANONICAL_HOST=app.c-point.co`, host-only cookies, persistent remember-me at 365 d). Each bug alone would be mostly invisible; together they make logout silently no-op on mobile.
- **The smoking gun in production logs:** `tokens_revoked=1 pre_username=<user>` from iOS/Android WebViews. That field tells us logout ran via the **remember-me restoration path** (no live session cookie was present at request time). The backend's `after_app_request` hook then re-issues a fresh `remember_token` on the same `/logout` response — handing the user the credential needed to stay logged in.
- **Two independent native amplifiers:** iOS `URLSession.shared` (used by `AppDelegate.syncBadgeWithServer`) keeps its own cookie jar separate from WKWebView, so even a perfect WKWebView clear leaves a valid `cpoint_session` in the native jar. Android WebView never calls `CookieManager.flush()`, so the in-memory cookie expiry can be lost if the process dies before the async disk write.
- **Urgency:** P0. Logout is a foundational security boundary and a billing-trust boundary (a user who "deleted my account" or "logged out from a shared device" must actually be gone). The fix for the root cause is **a single-line backend early-return**; the rest is defense-in-depth.
- **Risk of the proposed P0 fix:** very low — it skips a behaviour (`remember_token` rotation) on a single endpoint (`/logout`) that *should* never have been rotated there in the first place. Backed out trivially by reverting the early-return.
- **Go / no-go on remediation plan: PO decision required before code changes.**

---

## 2. Root causes (ranked, with evidence)

### RC-1 — Backend: remember-token rotation re-issues on `/logout` *(P0, all surfaces, smoking-gun)*

- **Severity:** P0
- **Surfaces affected:** web + iOS + Android (any client whose `/logout` request reached the server via remember-me restoration)
- **One-line description:** The `after_app_request` hook re-issues a fresh `remember_token` cookie on the `/logout` response itself whenever the session was silently restored from remember-me before the route ran.
- **File:line evidence:**
  - `backend/blueprints/auth.py:113-129` — `auto_login_from_remember_token` (`before_app_request`): if no `username` in session and a valid `remember_token` cookie is present, it restores the session AND sets `g.remember_token_rotation_username` + `g.remember_token_rotation_old_hash`.
  - `backend/blueprints/auth.py:132-151` — `rotate_remember_token_after_auto_login` (`after_app_request`): if those `g.*` values are set, **unconditionally** calls `remember_tokens.revoke_by_token_hash(old_hash)` and then `remember_tokens.issue(response, username)` + `auth_session.set_install_cookie(response, …)` on **whatever response is going out** — including the `/logout` redirect.
  - `backend/blueprints/auth.py:595-603` — `/logout` calls `remember_tokens.revoke_by_cookie(request)` (which deletes the old DB row — that's the `tokens_revoked=1` log line) and `remember_tokens.clear_cookie(resp)`. Then the after-request hook runs and **overwrites the `Set-Cookie: remember_token=…; Max-Age=0` with a brand-new `Set-Cookie: remember_token=<new>; Max-Age=31536000`** and inserts a new row into `remember_tokens`. The session is gone but the credential to silently restore it is freshly minted.
- **Production log evidence (filtered `auth.logout pre_username` last 3 days):**
  - `Admin     tokens_revoked=1   iOS WKWebView`
  - `JohnDoe   tokens_revoked=1   Android WebView` (×3)
  - `test      tokens_revoked=1   Android WebView`
  - `mali…     tokens_revoked=1   iOS WKWebView`
  - `JohnDoe   tokens_revoked=1   Android WebView`
  - All Capacitor lines with `tokens_revoked=1` correspond to users who reached `/logout` without a live session cookie (so `before_app_request` restored them from remember-me). The desktop lines all show `tokens_revoked=0` — desktop never trips this bug because the session cookie was alive and the rotation hook didn't fire.
- **Why the current logout code FAILS to handle it:** The handler is correct in isolation (revoke token, clear cookies, save empty session, no-store). But Flask's request lifecycle runs `before_app_request → view → after_app_request`. The after-request hook has zero awareness of the endpoint it's running on; it sees the `g.*` flags from `before_app_request` and proceeds to "rotate" — i.e., issue a new token — on the way out.
- **Minimal fix (plain English):** In `rotate_remember_token_after_auto_login`, **skip rotation when the current request is `/logout`** (or when the view set a `g.skip_remember_rotation = True` flag). One-line early return. Behaviour change is exactly: do not hand the user a new remember-me cookie on the response that is supposed to be ending their session.

### RC-2 — iOS native: `URLSession.shared` cookie-jar split *(P0, iOS only)*

- **Severity:** P0
- **Surfaces affected:** iOS (Capacitor WKWebView)
- **One-line description:** Native iOS code uses `URLSession.shared`, which has a separate cookie jar (`HTTPCookieStorage.shared`) from `WKWebView`; that jar holds a live `cpoint_session` and is never cleared by logout, and `syncBadgeWithServer()` re-hits the server on every foreground.
- **File:line evidence:**
  - `client/ios/App/App/AppDelegate.swift:137-176` — `syncBadgeWithServer()` uses `URLSession.shared.dataTask(with: request)` to `GET /api/notifications/badge-count`.
  - `client/ios/App/App/AppDelegate.swift:130-133` — `applicationDidBecomeActive(_:)` calls `syncBadgeWithServer()` on every foreground.
  - `client/ios/App/App/AppDelegate.swift:60-63` — same call on `application(_:didFinishLaunchingWithOptions:)`.
  - No code anywhere in `client/ios/App/App/` clears `HTTPCookieStorage.shared`.
  - `bodybuilding_app.py:633` — `SESSION_REFRESH_EACH_REQUEST = True`. Every authenticated request from the native jar refreshes the session TTL server-side.
- **Production log evidence (last 3 days):** iOS lines (`Admin`, `mali…`) consistently log `tokens_revoked=1` on `/logout`. The user-perception bug (still logged in after reopen) on iOS is consistent with the native-jar copy of `cpoint_session` re-authenticating on next foreground while WKWebView is on `/welcome`.
- **Why the current logout code FAILS to handle it:** The JS-side logout flow only operates on WKWebView state (`document.cookie`, IndexedDB, Cache, `localStorage`, `@capacitor/preferences`). It has no bridge into `HTTPCookieStorage.shared`. Backend `Set-Cookie: …; Max-Age=0` headers from `/logout` arrive in WKWebView's cookie store only; the native jar's copy is unaffected.
- **Minimal fix:** Either (a) route badge-sync through WKWebView (preferred — single cookie jar), or (b) in `AppDelegate`, before `syncBadgeWithServer`, import cookies from `WKHTTPCookieStore.allCookies` into `HTTPCookieStorage.shared`, and add a small native bridge plugin so JS-side logout can call `HTTPCookieStorage.shared.removeCookies(since: .distantPast)` (scoped to `app.c-point.co`).

### RC-3 — Android native: `CookieManager.flush()` is never called *(P0, Android only)*

- **Severity:** P0
- **Surfaces affected:** Android (Capacitor WebView)
- **One-line description:** Android `CookieManager` writes cookies to disk asynchronously. The 365-day `remember_token`, even when correctly expired in-memory by `/logout`'s `Set-Cookie`, can survive on disk if the app process dies before the next scheduled flush.
- **File:line evidence:**
  - Workspace-wide ripgrep for `CookieManager` returns **zero matches in any source file** (only in `docs/audit/android_logout_audit.md`). No native Java in `client/android/app/src/main/java/co/cpoint/app/` calls `CookieManager.getInstance().flush()`.
  - `backend/services/remember_tokens.py:107-134` — `issue()` sets `max_age=365*24*60*60` (1 year) → this is a **persistent**, disk-backed cookie in Android WebView's SQLite cookie database.
  - `client/src/utils/logout.ts:107` — logout triggers `window.location.replace('/logout')`. The 302 → `/welcome` carries Set-Cookie expiries that the WebView applies **to memory** only.
  - `static/sw.js:21-29` — service worker is also cleared as part of logout, but the cookie store is governed by the WebView's native networking, not the SW.
- **Production log evidence:** Multiple Android `tokens_revoked=1` lines (`JohnDoe` ×4, `test`, `JohnDoe`) — server confirms the DB row was revoked, but combined with RC-1 the **device** ends up with a freshly minted disk-backed `remember_token` anyway, so flush completeness is a defense-in-depth concern, not the single cause.
- **Why the current logout code FAILS to handle it:** No layer of the current logout pipeline explicitly forces the WebView's cookie store to flush to disk. Capacitor's `BridgeActivity` does not call `flush()` either.
- **Minimal fix:** A tiny native plugin method `flushCookies()` callable from JS that runs `CookieManager.getInstance().flush()` (and `removeAllCookies(...)` as belt-and-braces). Call it inside `performLogout()` *before* `window.location.replace('/logout')` (or, better, after the redirect lands on `/welcome` via the WebView client's `onPageFinished`), and also from `MainActivity.onPause()`.

### RC-4 — Backend: `remember_tokens.clear_cookie` does not sweep legacy domains *(P1, all surfaces)*

- **Severity:** P1
- **Surfaces affected:** any client whose `remember_token` was issued before the May 2026 migration (`SESSION_COOKIE_DOMAIN` change from `.c-point.co` to host-only on `app.c-point.co`).
- **One-line description:** Logout's `remember_token` clear sends *one* expiry `Set-Cookie` (matching today's config); the equivalent helper for `cpoint_session` correctly sweeps three legacy variants.
- **File:line evidence:**
  - `backend/services/remember_tokens.py:216-218` — `clear_cookie` is one-line: `response.set_cookie(COOKIE_NAME, "", max_age=0, expires=0, **_cookie_attrs())`. `_cookie_attrs()` reads only the current `SESSION_COOKIE_DOMAIN`.
  - `backend/services/auth_session.py:21-31` — `clear_session_cookie` sweeps **four variants** (configured domain, `.c-point.co`, `app.c-point.co`, host-only). Asymmetric with the remember-me cleanup.
  - `bodybuilding_app.py:640-651` — current production config: `CANONICAL_HOST=app.c-point.co` → no domain attribute → host-only cookies. Any token issued under a previous `.c-point.co` config persists.
  - Note: `auth_session.clear_install_cookie` (line 44-46) has the **same** single-variant defect for `native_push_install_id`.
- **Why the current logout code FAILS to handle it:** A host-only expiry `Set-Cookie` does not match a `.c-point.co`-domain stored cookie; the browser treats them as distinct cookies. The legacy variant survives.
- **Minimal fix:** Mirror `auth_session.clear_session_cookie`'s multi-variant sweep inside `remember_tokens.clear_cookie` and `auth_session.clear_install_cookie`.

### RC-5 — Backend: `/logout` revokes one row, not all of the user's remember-tokens *(P1, all surfaces)*

- **Severity:** P1
- **Surfaces affected:** all clients of the same user across all devices.
- **One-line description:** `/logout` deletes only the `remember_tokens` row that matches the incoming cookie's hash; if the user is logged in on multiple devices (or accumulated stale rows from past rotations), every other row remains a valid silent-login key for *this user account*.
- **File:line evidence:**
  - `backend/blueprints/auth.py:595` — `tokens_revoked = remember_tokens.revoke_by_cookie(request)` (deletes only the cookie's hash row).
  - `backend/services/remember_tokens.py:180-199` — `revoke_by_cookie` → `revoke_by_token_hash` (single-row delete by hash).
  - `backend/services/remember_tokens.py:202-213` — `revoke_for_user(username)` exists (delete-all-for-user) but **is never called from `/logout`**.
  - Rotation (`auth.py:132-151` and `auth.py:68-73`) inserts a new row on every silent restoration and login, so most active accounts accumulate multiple rows.
- **Why the current logout code FAILS to handle it:** Even after RC-1 is fixed, a single-row revoke leaves siblings alive. Combined with RC-2/RC-3, an attacker (or the user's other device) keeps a live credential.
- **Minimal fix:** In `/logout`, after `revoke_by_cookie(...)`, also call `remember_tokens.revoke_for_user(username)`. **This kills sessions on the user's other devices** — desired behaviour for "logout", but worth confirming with PO (see §8).

### RC-6 — Frontend: service worker stale-while-revalidate on `/api/profile_me` *(P1, web only, partial on Capacitor)*

- **Severity:** P1
- **Surfaces affected:** primarily web (desktop PWA + Capacitor while SW is registered before logout unregisters it).
- **One-line description:** `/api/profile_me` is in the stale-while-revalidate set in the service worker despite the inline comment claiming it isn't. After logout, the first re-load can answer `/api/profile_me` from cache and the React app behaves as if the user is logged in until the background fetch lands.
- **File:line evidence:**
  - `static/sw.js:19-32` — line 20 says `// NOTE: /api/profile_me is NOT here - it must always be network-first for proper login/logout`, but line 29 *does* include `'/api/profile_me'` in `STALE_API_ENDPOINTS`. The comment and the code disagree; the code wins.
  - `static/sw.js:236-238` — any entry in `STALE_API_ENDPOINTS` is served via `staleWhileRevalidate(request, RUNTIME_CACHE)`.
  - `client/src/utils/logout.ts:100-103` — logout *does* unregister service workers via `resetAccountScopedState`, but a) the unregister happens before `window.location.replace('/logout')` (race with already-controlling SW), and b) installed SWs persist on next visit until they're unregistered, so users in flight at the moment of the bug-fix still hit cache.
- **Why the current logout code FAILS to handle it:** Service worker unregistration is asynchronous; the page navigation can be served by the still-controlling SW. With `/api/profile_me` cached, the first post-logout boot can find a user "logged in" client-side even if cookies were cleared correctly.
- **Minimal fix:** Remove `/api/profile_me` from `STALE_API_ENDPOINTS` (the comment was correct, the code was wrong). Bump `SW_VERSION` (`static/sw.js:1` — currently `2.64.0`) so old SWs replace themselves.

### RC-7 — OAuth: Google `signOut()` without `revokeAccess()` (and iOS `disconnect()`) *(P2, iOS + Android)*

- **Severity:** P2
- **Surfaces affected:** iOS + Android Google Sign-In users.
- **One-line description:** `GoogleAuth.signOut()` clears local SDK state but leaves the app authorised for the Google account; next tap can silently re-establish a session via `/api/auth/google`.
- **File:line evidence:**
  - `client/src/utils/logout.ts:88-93` — only `GoogleAuth.signOut()` is invoked. No `revokeAccess`/`disconnect`.
  - `backend/blueprints/auth.py:1080-1133` — `/api/auth/google` happily creates a new session and rotates remember-me for the returning Google account. (`session.clear()` then `session['username']=…` then `_apply_login_persistence(resp, username)`).
  - Android audit § Q5 / iOS audit § 1 row 6 corroborate.
- **Why current logout fails:** This isn't strictly a "session persists" path — it's "session is trivially re-established with one tap". Combined with RC-1/2/3 it creates the perception that logout never happened.
- **Minimal fix:** Add `revokeAccess()` on Android and `GIDSignIn.sharedInstance.disconnect()` on iOS to the JS-side logout. **Adds friction** (next sign-in shows the chooser/consent). PO call (see §8).

### RC-8 — Frontend: password login skips account-isolation parity with OAuth *(P2, all clients)*

- **Severity:** P2
- **Surfaces affected:** all clients using username/password (most users).
- **One-line description:** OAuth success paths run `finishAuthSuccess` (clears `cached_profile`, calls `ensureAccountIsolationForUsername`, sets `current_username`, refreshes dashboard). The password-form success path skips all of this — it just calls `__reregisterPushToken` and navigates.
- **File:line evidence:**
  - `client/src/pages/MobileLogin.tsx:121-166` — `finishAuthSuccess` helper (used by Google + Apple paths at `:198`, `:207`, `:250`).
  - `client/src/pages/MobileLogin.tsx:489-522` — password-submit `fetch('/login_password', …)` success block: re-registers push, sets `window.location.href`, does not touch `cached_profile`, `current_username`, or `ensureAccountIsolationForUsername`.
- **Why current logout fails:** Not a logout bug per se, but it means a user who logs out **then logs into a different account via password** can see another user's `cached_profile` from `localStorage` during the brief window before the network fetch lands.
- **Minimal fix:** Route the password-login success path through the same `finishAuthSuccess` helper.

### RC-9 — Backend: `delete_account` cookie clearing weaker than `/logout` *(P2, all clients)*

- **Severity:** P2
- **Surfaces affected:** account-deletion flow only.
- **One-line description:** `/delete_account` clears server-side session and instructs the client to clear storage, but does **not** send `Set-Cookie` clears for `cpoint_session`, `remember_token`, or `native_push_install_id`.
- **File:line evidence:**
  - `backend/blueprints/auth.py:626-679` — `delete_account_post`: `session.clear()` + `invalidate_user_cache` + returns `{"success":True,"clear_storage":True}`. No `auth_session.clear_session_cookie(resp)`, no `remember_tokens.clear_cookie(resp)`, no `auth_session.clear_install_cookie(resp)`.
  - Safety net: `backend/services/remember_tokens.py:171-173` (`restore_session` calls `revoke_by_token_hash` if user no longer exists) means the cookie can't actually re-authenticate after the user is deleted. But cookies stick on the device for 365 days as dead data and trip RC-4/RC-5 patterns when the next user logs in on the same device.
- **Why current logout fails:** Slightly different blast radius from `/logout`, but the same shape: cookies survive on the device.
- **Minimal fix:** Mirror `/logout`'s cookie-clear stack on the `delete_account` response. Tracked as a follow-up, not in this remediation wave.

### RC-10 — Test infra: `logout.test.ts` FCM native path is silently disabled *(P2, CI)*

- **Severity:** P2
- **Surfaces affected:** CI / regression coverage.
- **One-line description:** The `vi.mock('@capacitor/core')` for the FCM native-path test is declared *inside* the `it(...)` block, after `import { performLogout } from './logout'` has already resolved the module graph. The mock is hoisted but `performLogout` was bound before it took effect, so the test does not exercise the native path it claims to.
- **File:line evidence:**
  - `client/src/utils/logout.test.ts:2` — top-level `import { performLogout } from './logout'`.
  - `client/src/utils/logout.test.ts:170-206` — `it('calls FCMNotifications.deleteToken on native platforms…')` block calls `vi.mock(…)` mid-test, then `await import('./logout')` again, but the originally-imported `performLogout` is what's referenced everywhere else.
- **Why current logout fails:** Pre-existing test gap, not a runtime bug — but it's why this class of regression has been missed.
- **Minimal fix:** Use `vi.resetModules()` + factory-style `vi.mock` + dynamic `await import('./logout')` *inside* the test, and assert against the dynamically-imported `performLogout`.

---

## 3. Cookie-clear matrix

For each cookie in the system, the column **Match** is "✅" only when the **issue** attribute set equals the **clear** attribute set. Any "❌" or "⚠️" means a stored cookie can survive logout because the browser does not match it to the clear `Set-Cookie`.

| Cookie | Issue location (file:line) | Issue attrs | Clear location | Clear attrs | Match | Risk |
|--------|---------------------------|-------------|----------------|-------------|-------|------|
| `cpoint_session` (Flask session) | `bodybuilding_app.py:630-654` configures attrs; Flask `SecureCookieSession` writes via `current_app.session_interface.save_session(...)` (e.g. `auth.py:88, 613`) | `name='cpoint_session'`, `httpOnly=True`, `secure=True` (prod), `samesite='None'` (prod), `domain=None` host-only on `app.c-point.co`, `path='/'`, persistent (`SESSION_REFRESH_EACH_REQUEST=True`, `PERMANENT_SESSION_LIFETIME=365d`) | `auth_session.clear_session_cookie` (`backend/services/auth_session.py:21-31`); called from `/logout` `auth.py:602` and `_finalize_session_response` `auth.py:83` | Same base attrs + sweeps **4 domain variants**: configured domain, `.c-point.co`, `app.c-point.co`, host-only | ✅ | Low for clear; iOS `URLSession.shared` jar still has its own copy (RC-2). SW cache may still answer `/api/profile_me` (RC-6). |
| `remember_token` (persistent silent-login) | `remember_tokens.issue` (`backend/services/remember_tokens.py:107-134`); called from `_apply_login_persistence` (`auth.py:68-73`), `_finalize_session_response` (`auth.py:76-92`), the OAuth handlers (`auth.py:1130, 1157, 1217, 1280, 1305, 1369`), and **the after-request hook** `rotate_remember_token_after_auto_login` (`auth.py:146`) | `name='remember_token'`, `httpOnly=True`, `secure=True`, `samesite='Lax'` (not 'None'! — divergent from session cookie), `domain=None` host-only on `app.c-point.co`, `path='/'`, `Max-Age=365d` | `remember_tokens.clear_cookie` (`backend/services/remember_tokens.py:216-218`); called from `/logout` (`auth.py:601`) | Same attrs, **single** domain variant only (`domain=None`) | ⚠️ | RC-4: legacy `.c-point.co`-domain tokens survive. RC-1: re-issued on the same response. RC-5: only one DB row revoked. **Net: the credential survives**. |
| `native_push_install_id` (anonymous install id for native push) | `auth_session.set_install_cookie` (`backend/services/auth_session.py:49-51`); called from `_apply_login_persistence` (`auth.py:72`), `rotate_remember_token_after_auto_login` (`auth.py:147`) | `name='native_push_install_id'`, `httpOnly=False`, `secure=True`, `samesite='None'`, `domain=None` host-only on `app.c-point.co`, `path='/'`, `Max-Age=365d` | `auth_session.clear_install_cookie` (`backend/services/auth_session.py:44-46`); called from `/logout` (`auth.py:603`) | Same attrs, **single** domain variant only | ⚠️ | Privacy: install id can survive logout and bind across accounts on the same device. Same legacy-domain risk as `remember_token`. RC-1 also re-issues this on the `/logout` response. |
| `session` (legacy Flask default) | Default name `session` if `SESSION_COOKIE_NAME` ever changes; current prod uses `cpoint_session` | (legacy only) | `auth_session.clear_session_cookie` correctly reads `SESSION_COOKIE_NAME`, so it clears `cpoint_session` today; older sticky cookies named `session` from before the May 2026 rename are NOT swept | Not cleared on `app.c-point.co` | ⚠️ | Low risk in practice — Flask only reads the configured name. Dead data on devices that migrated through the rename. |

**Asymmetry summary:** `cpoint_session` cleanup is correct (multi-domain sweep). `remember_token` and `native_push_install_id` cleanup is single-domain. The right model is the four-variant sweep used by `clear_session_cookie`; the two laggards must be brought up to that pattern.

---

## 4. Fix plan — sequenced PRs

Sequenced safest → broadest. PR-A first because it is a one-line backend change that eliminates the production smoking gun, with trivial rollback.

| # | Title | Owner | Files (best estimate) | Behaviour change | Blast radius | Exit criteria | Effort |
|---|-------|-------|-----------------------|------------------|--------------|---------------|--------|
| **PR-A** | Block remember-me rotation on `/logout` (P0) | `generalPurpose` | `backend/blueprints/auth.py` (early-return inside `rotate_remember_token_after_auto_login`) | After-request hook becomes a no-op when `request.endpoint == 'auth.logout'` or `request.path == '/logout'` or `g.get('skip_remember_rotation')` is truthy. | Affects only the `/logout` response path. Cannot disturb live sessions, login flows, or rotation on other endpoints. | (a) `pytest tests/test_remember_tokens.py tests/test_auth_logout_login_flow.py` green. (b) New automated test: logout response carries `Set-Cookie: remember_token=; Max-Age=0` and **no** non-empty `remember_token` Set-Cookie. (c) Staging smoke: `gcloud logging read` shows zero correlations of `tokens_revoked=1` with a non-empty `Set-Cookie: remember_token=…` on the same response. | S |
| **PR-B** | iOS native `URLSession.shared` cookie-jar parity (P0) | `ios-expert` | `client/ios/App/App/AppDelegate.swift`; possibly a tiny new Capacitor plugin under `client/ios/App/App/Plugins/AuthCookies/` registered in `project.pbxproj` (see ios-xcode-project rule) | `syncBadgeWithServer` either runs inside WKWebView (preferred — single jar) **or** imports WKHTTPCookieStore cookies into `HTTPCookieStorage.shared` immediately before the request; on logout, a native plugin clears `HTTPCookieStorage.shared` for `app.c-point.co`. | iOS-only. May reduce badge accuracy briefly on cold launch (negligible). | (a) Manual: post-logout cold launch never sends a stale `cpoint_session` on `/api/notifications/badge-count` (verified by Charles/Proxyman or Cloud Run logs). (b) Plugin compiles and is in `PBXSourcesBuildPhase`. | M |
| **PR-C** | Android `CookieManager.flush()` + persistent guarantee (P0) | `android-expert` | `client/android/app/src/main/java/co/cpoint/app/MainActivity.java` (lifecycle hook), small Capacitor plugin `AuthCookies` for JS-callable flush, JS call site in `client/src/utils/logout.ts` | `CookieManager.getInstance().flush()` is invoked in `MainActivity.onPause()` and from JS immediately after the WebView navigates to `/welcome` post-logout. Also `removeAllCookies(...)` as belt-and-braces (scoped to host). | Android-only. Minor: each pause writes pending cookies synchronously (sub-millisecond on modern devices). | (a) Manual: log out → swipe-kill within 1 s → relaunch lands on `/welcome` (Test A in `docs/audit/android_logout_audit.md` § 4). (b) `chrome://inspect` confirms `remember_token` is gone from disk after logout. | S |
| **PR-D** | Backend defense in depth (P1) | `generalPurpose` | `backend/blueprints/auth.py:580-623` (the `logout()` body); `backend/services/remember_tokens.py:216-218`; `backend/services/auth_session.py:44-46` | `/logout` (a) sets `g.skip_remember_rotation = True` as its first statement; (b) calls `remember_tokens.revoke_for_user(username)` in addition to `revoke_by_cookie`; (c) extends `remember_tokens.clear_cookie` to sweep four domain variants like `clear_session_cookie`; (d) extends `clear_install_cookie` likewise; (e) `auth_session.no_store(resp)` is already on the redirect (`auth.py:614`) — verify it remains. | Affects `/logout` response only. (b) is **multi-device sign-out** (see §8 PO question 2). | (a) `pytest tests/test_remember_tokens.py tests/test_auth_logout_login_flow.py` green. (b) New tests: `/logout` sends 4 `Set-Cookie` clears for each of the 3 cookies (12 total); `remember_tokens` table count for the user drops to 0 post-logout; idempotent on repeated `/logout`. (c) Staging smoke: multi-device test — logout on phone kills web session within next request. | M |
| **PR-E** | Service worker `/api/profile_me` network-only (P1) | `thread-engineer` | `static/sw.js:1` (`SW_VERSION` bump) and `:21-32` (remove `/api/profile_me` from `STALE_API_ENDPOINTS`, fix the contradictory comment) | `/api/profile_me` becomes network-first (falls through to the default fetch path). Existing controlled SWs replace themselves due to the `SW_VERSION` bump. | Web + Capacitor. Adds a single network round-trip on profile reads (already the case for fresh devices). | (a) `cd client && npm test -- --run` green. (b) New test: SW intercept of `/api/profile_me` is not served from `RUNTIME_CACHE`. (c) Manual: log out in browser → reload → `/api/profile_me` returns 401 from network. | S |
| **PR-F** | Password login parity with OAuth (P2) | `thread-engineer` | `client/src/pages/MobileLogin.tsx:489-522` | Password-submit success path calls `finishAuthSuccess({username, is_new:false})` after the `/login_password` 302 instead of inline `__reregisterPushToken + location.assign`. | All clients. Adds one `await ensureAccountIsolationForUsername` + `localStorage.removeItem('cached_profile')` before navigate. | (a) Vitest: after password login, `localStorage.cached_profile` is absent. (b) Manual: logout as user A → password-login as user B → first paint never shows A's profile. | S |
| **PR-G** | Test infra fix for `logout.test.ts` (P2) | `thread-engineer` | `client/src/utils/logout.test.ts:170-206` | Hoist `vi.mock('@capacitor/core', () => ({ Capacitor: … }))` to module scope (factory form), call `vi.resetModules()` at the top of the test, dynamic-import `performLogout` inside the test. | CI only. | `cd client && npm test -- --run` green and the FCM native-path test executes the native branch (assert `deleteToken` is called with platform === 'ios'). | S |

**PR-A diff sketch** (for the PO to see how small the highest-leverage fix is):

```python
# backend/blueprints/auth.py, inside rotate_remember_token_after_auto_login

@auth_bp.after_app_request
def rotate_remember_token_after_auto_login(response):
    """Refresh remember-token cookies after silent session restoration."""
    # Never rotate on logout — we are tearing the session down, not refreshing it.
    if request.endpoint == 'auth.logout' or request.path == '/logout' or getattr(g, 'skip_remember_rotation', False):
        return response
    username = getattr(g, "remember_token_rotation_username", None)
    ...
```

---

## 5. Verification plan

### 5.1 Per-PR automated

- **PR-A:** `pytest tests/test_remember_tokens.py tests/test_auth_logout_login_flow.py` plus new test `test_logout_does_not_rotate_remember_token_after_silent_restore` — set a valid `remember_token` cookie, GET `/logout` *without* a session cookie, assert response has **exactly one** `Set-Cookie: remember_token=…` header and that its `Max-Age` is `0`.
- **PR-D:** Same suite + new `test_logout_revokes_all_user_remember_tokens` (insert two rows, GET `/logout`, assert both are gone) + `test_logout_clears_three_cookies_across_four_domains` (count Set-Cookie headers).
- **PR-E:** `cd client && npm test -- --run` plus a new SW Vitest that asserts `/api/profile_me` goes through `networkFirst`, not `staleWhileRevalidate`.
- **PR-F:** Add to `client/src/pages/MobileLogin.test.tsx` (or co-located test): mock `/login_password` redirect, assert `ensureAccountIsolationForUsername` is invoked.
- **PR-G:** Same `npm test -- --run`; the FCM-native test must actually exercise the `Capacitor.isNativePlatform()===true` branch.

### 5.2 Per-PR manual (staging)

Each P0 fix gets a 3-step (a)/(b)/(c) repro-and-verify on staging *before* prod. State the **expected post-state in DevTools / logs** explicitly:

- **PR-A — Block rotation on /logout**
  - (a) Pre-state: log in on staging, copy the `remember_token` cookie value, clear the `cpoint_session` cookie in DevTools to force the remember-me path.
  - (b) Action: navigate to `/logout`.
  - (c) Expected: Network → `/logout` response has exactly one `Set-Cookie: remember_token=; Max-Age=0; …` header (no non-empty re-issue). Cloud Run log line: `auth.logout pre_username=<u> tokens_revoked=1 …` AND no subsequent `INSERT INTO remember_tokens` for the same username in the same request id.

- **PR-B — iOS URLSession.shared parity**
  - (a) Pre-state: install staging build, log in, foreground the app once so `syncBadgeWithServer` fires; capture cookies via Proxyman / Charles for `app.c-point.co`.
  - (b) Action: log out via the in-app button, kill the app, relaunch.
  - (c) Expected: the first `GET /api/notifications/badge-count` after relaunch carries **no** `Cookie: cpoint_session=…` header. Cloud Run log shows the request authenticated as anonymous (401 or unauthenticated badge path).

- **PR-C — Android CookieManager flush**
  - (a) Pre-state: install staging APK, log in, confirm `remember_token` is present in the WebView cookie DB via `chrome://inspect` → Application → Cookies.
  - (b) Action: log out, immediately (<1 s) swipe-kill the app from recents.
  - (c) Expected: relaunch lands on `/welcome`. `chrome://inspect` shows no `remember_token` cookie.

- **PR-D — Backend defense in depth** (manual sanity)
  - (a) Pre-state: log in as the same user on two browsers (Chrome desktop + iOS Safari).
  - (b) Action: log out on Chrome desktop.
  - (c) Expected: next request on iOS Safari returns 401; the `remember_tokens` table has 0 rows for that username. The desktop `/logout` response carries cookie clears for all three cookies × four domain variants.

- **PR-E — SW network-only on `/api/profile_me`** (manual sanity)
  - (a) Pre-state: log in on web, ensure SW is controlling (DevTools → Application → Service Workers).
  - (b) Action: log out, reload `/`.
  - (c) Expected: DevTools → Network → `/api/profile_me` shows `(from network)` not `(from ServiceWorker, runtime cache)`; status 401.

- **PR-F / PR-G:** desktop browser only; no native repro needed.

### 5.3 Production validation post-deploy

After PR-A ships, add a **persistent log-based monitor**:

```bash
gcloud logging read --project=cpoint-127c2 --limit=200 --freshness=24h --format=json \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="cpoint-app"
   AND textPayload:"auth.logout pre_username"
   AND textPayload:"tokens_revoked=1"' \
  | jq -r '.[] | .trace as $t | "\(.timestamp) \(.textPayload) trace=\($t)"' \
  > /tmp/logout_revokes.txt

# Cross-reference each trace id with the Set-Cookie headers on the same response.
# After PR-A: there should be ZERO traces where tokens_revoked=1 AND a non-empty
# Set-Cookie: remember_token=<value>; Max-Age=<positive> appears on /logout.
```

Add this as a Cloud Logging alert (severity WARNING) on the pattern `auth.logout … tokens_revoked=1` AND `Set-Cookie: remember_token` with a non-zero `Max-Age` on the same request id. After PR-A, this alert should be permanently silent; any firing is a regression.

---

## 6. Rollout order + decision gates

PO must approve §2 diagnosis and §8 questions before any code lands. Then ship in this order, deploying to staging between each:

1. **PR-A** — backend single-line block-rotation-on-/logout. Highest leverage, lowest risk. Smoke per §5.2 PR-A. Cloud Build → staging → `scripts/smoke_prod.sh`-equivalent for staging.
2. **Gate:** confirm `tokens_revoked=1` log lines no longer correlate with a fresh `Set-Cookie: remember_token=<value>` on the same response (24 h observation window).
3. **PR-D** — backend defense in depth (`revoke_for_user`, multi-domain cookie sweep, `g.skip_remember_rotation=True` as belt-and-braces). Smoke per §5.2 PR-D.
4. **Gate:** `verifier-qa` runs the manual logout block in `docs/QA_CHECKLIST.md` on staging.
5. **PR-C (Android)** + **PR-B (iOS)** in parallel. Smoke per §5.2 PR-C and PR-B. Both produce store builds (per `AGENTS.md § Android release (do not revert)` and `client/ios/App/App/AppDelegate.swift` pbxproj invariants — do not break either).
6. **Gate:** `verifier-qa` runs the Capacitor logout matrix on both platforms.
7. **PR-E** + **PR-F** + **PR-G** in parallel. Web-only / test-only. Smoke per §5.2.

Production deploys per `AGENTS.md § Deployment`: staging → `gcloud builds submit --config=cloudbuild.yaml --project=cpoint-127c2 .`; prod → `gcloud builds submit --config=cloudbuild-production.yaml --project=cpoint-127c2 .` (which runs `scripts/smoke_prod.sh`). Never skip the staging step.

---

## 7. Out of scope (called out so PO is not surprised)

- **Wave 2 page-transitions / GIF picker work** — unaffected by this remediation; **on hold** until logout fixes ship and pass verification.
- **Architectural rewrite — server-side session store** (Redis-backed Flask sessions with explicit invalidation by `session_id`, OAuth refresh-token revocation flows, true device-by-device session list with revoke UI). Tracked as `Future epic` once the bleeding stops.
- **`delete_account` cookie-clear hardening** (RC-9). Real but bounded blast radius (because `restore_session` checks `user_exists`). Tracked as a follow-up PR after this wave ships.
- **Universal-link `UserDefaults` cleanup** (iOS audit § 5b). Cosmetic / dead-data; not session-persistence.
- **Android `allowBackup="true"`** (Android audit § 1 row 14). Privacy + supply-chain concern; separate hardening PR.
- **Firebase Installations FID reset on logout** (both audits). Identity-linking concern; separate privacy PR.

---

## 8. PO decision points

Before any code lands, please confirm:

1. **Priority order:** Do you accept the P0 ranking (RC-1 → RC-2 → RC-3) and the safe-rollout sequence (PR-A first, then PR-D, then PR-B + PR-C in parallel, then PR-E/F/G)? Or do you want PR-B/PR-C parallel to PR-A?
2. **All-devices sign-out (PR-D):** Are you OK with logout revoking **all** of the user's `remember_tokens` rows (not just the one matching this device's cookie)? This is the safer security default and the user expectation for the word "logout", but it does kill remember-me on every other device the user is signed in on. Default recommendation: **yes**.
3. **Same-day hotfix for PR-A:** PR-A is a single-line early return; do you authorize shipping it to production the same day as approval, ahead of the rest of the wave, to stop the bleed?
4. **OAuth `revokeAccess()` / `disconnect()` (RC-7, P2):** Do you want this in scope for this wave (more secure but next sign-in shows the Google chooser/consent again — small added friction) or deferred to a follow-up?
5. **Multi-domain sweep (PR-D):** OK to send 12 `Set-Cookie` clear headers per `/logout` response (3 cookies × 4 domain variants)? Bytes are negligible (sub-1 KB) but the response gets visibly noisier in DevTools. Default recommendation: **yes** (matches the `cpoint_session` pattern that's already in production).

---

## Appendix — Production log evidence raw (last 3 days)

```
2026-05-27 Admin     tokens_revoked=1   iOS WKWebView
2026-05-27 JohnDoe   tokens_revoked=1   Android WebView
2026-05-27 JohnDoe   tokens_revoked=1   Android WebView
2026-05-27 JohnDoe   tokens_revoked=1   Android WebView
2026-05-27 Paulo     tokens_revoked=0   Windows Chrome    ← desktop, no remember-me
2026-05-27 test      tokens_revoked=1   Android WebView
2026-05-26 admin     tokens_revoked=0   Windows Chrome    ← desktop
2026-05-26 mali...   tokens_revoked=1   iOS WKWebView
2026-05-26 Paulo     tokens_revoked=0   Windows Chrome
2026-05-26 -         tokens_revoked=0   Android WebView   ← username already missing from session
2026-05-26 -         tokens_revoked=0   Android WebView
2026-05-26 -         tokens_revoked=0   Android WebView
2026-05-26 JohnDoe   tokens_revoked=1   Android WebView
```

Two clean patterns:

1. **Capacitor + `tokens_revoked=1`** — user reached `/logout` via the remember-me restoration path (no live `cpoint_session`). RC-1 (rotation hook) fires and hands the user a fresh `remember_token` on the way out. **This is the smoking gun.**
2. **Windows Chrome + `tokens_revoked=0`** — user logged in without remember-me (no token row to revoke). Their post-logout persistence is RC-6 (SW stale-while-revalidate on `/api/profile_me`) plus possibly RC-4 (legacy-domain cookie surviving), not RC-1.
