# Android Logout Session Persistence — Audit Report

**Date:** 2026-05-28  
**Scope:** Capacitor Android shell (`client/android/`), logout flow (`client/src/utils/logout.ts`), backend `/logout` route  
**Bug:** Sessions persist after logout on Android Capacitor — user relaunches app and is still authenticated.

---

## 1. Persistence-Layer Matrix

| # | Layer | What it stores | Cleared by current logout? | How it's cleared | Risk if NOT cleared |
|---|-------|---------------|---------------------------|-----------------|-------------------|
| 1 | **WebView CookieManager** (session cookies) | `cpoint_session`, `remember_token`, `native_push_install_id` | **Partially — via Set-Cookie on 302 redirect** | Server `/logout` returns `Set-Cookie: …; max_age=0; expires=0` on the redirect to `/welcome`. WebView applies these during navigation. | **HIGH** — If Set-Cookie headers on the 302 are not flushed to disk before process kill, old cookies restore on next launch. See §2 Root Cause #1. |
| 2 | **WebView CookieManager** (persistent cookies) | Same cookies if `Expires` / `max-age` was originally > 0 (remember_token has 365d max_age) | Same as above — relies on Set-Cookie expiry headers | Server sends `max_age=0, expires=0` on 302 | **HIGH** — `remember_token` is a persistent (disk-backed) cookie. CookieManager writes happen async; `flush()` is never called. |
| 3 | **WebView localStorage** | `current_username`, `cached_profile`, `signal_*`, `chat_*`, `community_*`, etc. | **Yes** — `resetAccountScopedState()` clears account-scoped keys and prefixes | JS `localStorage.removeItem()` per key/prefix | LOW — profile display may bleed but no auth credential stored here |
| 4 | **WebView sessionStorage** | Transient navigation state | **Yes** — `clearSessionStorageForAccount()` (preserves `cpoint_processed_deep_links`) | JS `sessionStorage.clear()` | LOW — dies with WebView process anyway |
| 5 | **WebView IndexedDB** | `chat-encryption`, `signal-protocol`, `signal-store`, offline DB | **Yes** — `clearAccountIndexedDb()` deletes each database | `indexedDB.deleteDatabase()` | LOW for auth (stores E2E keys, not session) |
| 6 | **WebView Cache API / SW caches** | `runtime`, `cp-*` cache names | **Yes** — `clearAccountCaches('account')` deletes matching caches; SW unregistered | `caches.delete()`, `registration.unregister()` | LOW |
| 7 | **Capacitor `@capacitor/preferences`** (SharedPreferences `CapacitorStorage`) | App-level KV (no auth tokens found stored here) | **Yes** — `Preferences.clear()` | Clears only the `CapacitorStorage` SharedPreferences file | NONE for auth |
| 8 | **Google Sign-In native state** (`com.google.android.gms` account cache) | Cached Google account selection + credential | **Partially** — `GoogleAuth.signOut()` clears account selection but **does NOT call `revokeAccess()`** | Plugin calls `GoogleSignInClient.signOut()` only | **MEDIUM** — Next `GoogleAuth.signIn()` may silently return the same account without a chooser, leading to auto-re-auth if any server endpoint issues a session on ID token presentation. See Root Cause #2. |
| 9 | **Firebase Installations** (`com.google.firebase.installations`) | Installation ID (FID), auth token | **NOT cleared** | Survives all app-level clears; only `FirebaseInstallations.delete()` removes it | LOW — FID is not an auth credential, but it links device identity across logout/login cycles |
| 10 | **Firebase Messaging token cache** (`com.google.firebase.messaging`) | FCM token | **Partially** — `FCMPlugin.deleteToken()` invalidates current token | Firebase SDK deletes token server-side; BUT next `getToken()` auto-generates a new one that the old server unregister never saw | **MEDIUM** — Orphan token rows on server; not a session-persistence risk but a push-to-wrong-user risk. See §3 Q6. |
| 11 | **Other SharedPreferences files** (app default, Firebase, Google Sign-In, Capacitor plugins) | Plugin config, Firebase sender ID, google account hint, device UUID | **NOT cleared** — `Preferences.clear()` only touches `CapacitorStorage` file, not `com.google.firebase.*`, `com.google.android.gms.*`, or default prefs | Would require `context.getSharedPreferences(name).edit().clear().apply()` per file | LOW for auth — no session tokens here, but Google Sign-In hint survives |
| 12 | **EncryptedSharedPreferences / AndroidKeystore** | — | N/A — **not used** by this app (no custom native code references either) | — | NONE |
| 13 | **App internal files** (`filesDir`, `cacheDir`) | `IncomingShare/manifest.json`, `ImportedShare/` | **NOT cleared by logout** (cleared by `ShareImportPlugin.clearPending()` on share consume) | Manual file deletion | NONE for auth |
| 14 | **Android Auto Backup** (`android:allowBackup="true"`) | Full app data (SharedPreferences, databases, files, WebView data) | **NOT addressed** — `allowBackup="true"` in manifest with no `backup_rules` exclusions | Google auto-backup restores all data on reinstall/device transfer | **MEDIUM** — After uninstall+reinstall, backup could restore old cookies/prefs. Not a direct session-persistence vector post-logout, but a data-leakage concern. |
| 15 | **WebView saved-instance-state** (Android process restoration) | Last loaded URL, form data, scroll position | **NOT explicitly cleared** — `MainActivity.onCreate(savedInstanceState)` passes it to `super.onCreate()` which passes it to Capacitor `BridgeActivity` | Capacitor's `BridgeActivity` does NOT restore WebView state from `savedInstanceState`; it reloads `server.url` fresh | LOW — Capacitor always loads the configured server URL on cold start, not the saved URL |

---

## 2. Top 3 Android-Specific Root-Cause Candidates

### Root Cause #1 (HIGHEST PROBABILITY): WebView CookieManager flush race on `window.location.replace('/logout')`

**The problem:**

1. `performLogout()` calls `window.location.replace('/logout')`.
2. Server `/logout` returns a **302 redirect** to `/welcome` with `Set-Cookie` headers expiring `cpoint_session`, `remember_token`, and `native_push_install_id`.
3. Android's `CookieManager` receives these Set-Cookie headers and updates its **in-memory** cookie store.
4. `CookieManager.flush()` writes cookies to disk **asynchronously**. The app **never calls `flush()`** explicitly.
5. **Critical race:** If the user taps Home, swipe-kills the app, or Android kills the process before the async flush completes, the **disk-backed cookie file still contains the old, valid `remember_token`** (365-day persistent cookie).
6. On next app launch, `CookieManager` loads from disk → old `remember_token` is present → server `restore_session()` reads it → user is re-authenticated silently.

**Why `remember_token` is the specific culprit:**

- `remember_token` is issued with `max_age = 365 * 24 * 60 * 60` (1 year) and `secure=True, httponly=True, samesite=Lax`.
- Being a persistent cookie (explicit `max_age`), Android WebView writes it to the on-disk cookie database.
- `cpoint_session` is also persistent (`session.permanent = True` → Flask sets `Expires` on it), so it has the same flush-race vulnerability.

**Why this is Android-specific:**

- On iOS, `WKWebView` flushes cookies synchronously on `URLSession` completion.
- On desktop Chrome, the cookie flush is near-instant and the browser process rarely dies mid-navigation.
- On Android Capacitor, the app process can be killed at any time by the system, and users commonly swipe-kill apps immediately after performing an action.

**Evidence from code:**

- `logout.ts:107` — `window.location.replace('/logout')` initiates navigation but JS execution continues/ends before the 302's Set-Cookie headers are guaranteed flushed.
- No native Java code in `MainActivity.java` or anywhere in `client/android/app/src/main/java/` calls `CookieManager.getInstance().flush()`.
- `CapacitorHttp` is NOT in use (confirmed: no `CapacitorHttp` or `CapacitorCookies` references in the codebase), so all HTTP goes through the WebView → single cookie jar → `CookieManager` → same flush-race applies to all requests.

**Cookie domain mismatch amplifier:**

The server's `SESSION_COOKIE_DOMAIN` config on `app.c-point.co` results in **no domain** being set (host-only cookies) per `bodybuilding_app.py:648-651`. But `clear_session_cookie()` also expires cookies on `.c-point.co` and `app.c-point.co` domains as legacy variants. If the original cookie was set with a different domain variant (e.g., during a config migration), the expiry Set-Cookie might not match the stored cookie's domain, leaving the old cookie intact.

---

### Root Cause #2 (MEDIUM PROBABILITY): Google Sign-In silent re-authentication

**The problem:**

1. `performLogout()` calls `GoogleAuth.signOut()` (line 91).
2. The `@codetrix-studio/capacitor-google-auth` plugin calls `GoogleSignInClient.signOut()` on Android.
3. `signOut()` clears the **cached account selection** but does NOT revoke the app's access to the Google account.
4. `revokeAccess()` is never called anywhere in the codebase.
5. On next app launch, if the app navigates to login and the user taps "Sign in with Google", `GoogleAuth.signIn()` may return the same account's ID token **without showing the account chooser** if:
   - The Google account is still signed into the device
   - The app's OAuth consent is still valid
   - `forceCodeForRefreshToken: false` (confirmed in `capacitor.config.ts:49`)
6. The server receives a valid ID token → creates/restores session → user is "logged back in" with one tap.

**Why this matters:**

This isn't strictly "session persists" — it's "session can be trivially re-established without credentials." Combined with Root Cause #1 (cookie not actually cleared), it creates a perception that logout never happened.

**Why `forceCodeForRefreshToken: false` matters:**

With this set to `false`, the plugin does NOT force offline access. But the Google account remains authorized for this app on the device. `signOut()` only affects the local SDK cache, not the Google account's app permissions.

---

### Root Cause #3 (MEDIUM PROBABILITY): `remember_token` server-side clear uses domain-mismatched Set-Cookie

**The problem:**

1. `remember_tokens.clear_cookie()` expires the `remember_token` using `_cookie_attrs()` which sets `domain = current_app.config.get("SESSION_COOKIE_DOMAIN") or None`.
2. On `app.c-point.co`, the config logic in `bodybuilding_app.py:648-651` explicitly **skips** setting `SESSION_COOKIE_DOMAIN` for `app.c-point.co` (host-only cookies).
3. So `clear_cookie()` sends `Set-Cookie: remember_token=; domain=None` → host-only expiry.
4. But `remember_tokens.issue()` uses the same `_cookie_attrs()`, so if the cookie was issued when `SESSION_COOKIE_DOMAIN` was configured differently (e.g., `.c-point.co` before the May 2026 migration), the issued cookie's domain is `.c-point.co` while the clear targets host-only.
5. **A host-only expiry does NOT clear a `.c-point.co`-domain cookie** — they are different cookies in the browser's jar.

**Key difference from `clear_session_cookie()`:**

The `auth_session.clear_session_cookie()` function explicitly sends expiry Set-Cookies for **three domain variants** (configured domain, `.c-point.co`, `app.c-point.co`, and host-only). But `remember_tokens.clear_cookie()` only sends **one** expiry using the current config. If the remember_token was issued under the old domain config, it will survive logout.

---

## 3. Detailed Answers to Specific Questions

### Q1: WebView CookieManager + Set-Cookie on 302

Android WebView's `CookieManager` processes Set-Cookie headers from HTTP responses including redirects. The 302 from `/logout` → `/welcome` carries Set-Cookie headers, and the WebView applies them to its in-memory store. However:

- **`flush()` is required** to guarantee persistence to disk. The Chromium-based WebView schedules disk writes asynchronously.
- **On process kill before flush:** The on-disk cookie database retains the pre-logout state. Next launch loads from disk → old cookies restored.
- This is documented Android behavior: `CookieManager.flush()` "forces the manager to write any pending cookies to disk."

### Q2: Multiple cookie jars

**Single cookie jar confirmed.** No `CapacitorHttp` or `CapacitorCookies` plugins are in use (zero references in the codebase). All HTTP from the WebView goes through the standard WebView networking stack, which uses `CookieManager` as the single cookie store. The `fetch()` calls in JS (e.g., `unregister_fcm`, `register_fcm`) go through the WebView's fetch implementation, which shares the same `CookieManager`.

No `OkHttpClient` with a separate `CookieJar` is configured in native code. The three Java files (`MainActivity.java`, `ShareImportPlugin.java`, `ShareIntentHelper.java`) contain zero HTTP or cookie-related code.

### Q3: WebView persistent cookies

Modern Android WebView (Chromium-based) defaults to `CookieManager.setAcceptCookie(true)` and writes persistent cookies (those with `Expires` or `max-age`) to an SQLite database in the app's WebView data directory. Session cookies (no `Expires`) are in-memory only. Both `cpoint_session` (Flask permanent session) and `remember_token` (365d max_age) are **persistent** cookies → they survive across app launches.

The cookie-clear from the `/logout` 302 updates the in-memory state but the disk write is async. The cleared state does NOT persist until `flush()` completes or the WebView process performs a scheduled write.

### Q4: EncryptedSharedPreferences / AndroidKeystore

**Not used.** Zero references to `EncryptedSharedPreferences`, `AndroidKeystore`, or `SecurityKeystore` anywhere in the codebase. No custom native code stores auth tokens outside the WebView cookie jar. `@capacitor/preferences` writes to a plain `SharedPreferences` file (`CapacitorStorage`), which the logout flow clears.

### Q5: Google Sign-In native state

`GoogleAuth.signOut()` in the `@codetrix-studio/capacitor-google-auth` plugin calls `GoogleSignInClient.signOut()` on Android. This:
- **Clears** the cached `GoogleSignInAccount` from the local SDK
- **Does NOT call** `GoogleSignInClient.revokeAccess()`
- **Does NOT** remove the Google account from the device
- **Does NOT** revoke the OAuth consent for the app

`revokeAccess()` is never called anywhere in the codebase (confirmed by grep). The next `signIn()` call may return the same account silently if the device account is still active and the consent hasn't been revoked through Google account settings.

`forceCodeForRefreshToken: false` in `capacitor.config.ts` means the plugin does not request offline access, but this doesn't prevent silent re-selection of the same account.

### Q6: FCM token persistence

The logout flow calls `FCMPlugin.deleteToken()` → Firebase SDK's `FirebaseMessaging.getInstance().deleteToken()`. This invalidates the current token server-side. However:

1. The server `unregister_fcm` (line 40-53 of `logout.ts`) sends the old `window.__fcmToken` to `/api/push/unregister_fcm` which deletes by that specific token value.
2. `deleteToken()` on the Firebase SDK also invalidates the token, but the next `getToken()` call (on next app launch via `PushInit.tsx`) generates a **new** token.
3. This new token is cached in `window.__fcmToken` and registered via `__reregisterPushToken` after profile fetch (App.tsx:619) or login (MobileLogin.tsx:156, 520, 535).
4. **Risk:** If the session persists (Root Cause #1) and the app resumes, the profile fetch succeeds → `__reregisterPushToken()` registers the new FCM token → push notifications resume for the "logged out" user.

### Q7: App resume listeners

Relevant resume handlers found:
- **`useResumeOutboxDrain`** (`client/src/chat/useResumeOutboxDrain.ts`): On `App.addListener('resume')`, calls `drainOutbox()` which flushes offline chat queue. This sends requests with `credentials: 'include'` — if cookies survived, these succeed and the server treats the user as authenticated.
- **`useSafeAreaSync`** and **`useFixedComposerKeyboard`**: UI-only resume handlers, no auth-relevant network calls.
- **`PushInit.tsx`**: No resume listener, but `__reregisterPushToken` is called on profile fetch success, which happens on app mount/navigation.

**There is no explicit "on resume, verify session is still valid" check.** The app does not proactively hit a `/api/session/check` endpoint on resume; it relies on the next API call failing with 401. If cookies survived due to Root Cause #1, the next API call succeeds and the user appears logged in.

### Q8: Share targets / deep links bypassing logout

The manifest defines:
- **App links:** `https://app.c-point.co` with `android:autoVerify="true"` → tapping a C-Point link opens the app directly
- **Custom scheme:** `cpoint://` → internal deep links (share routing)
- **Share intents:** SEND/SEND_MULTIPLE for images, video, audio, PDF, text

All of these launch `MainActivity` with `launchMode="singleTask"`. If the user logged out but cookies weren't flushed (Root Cause #1), tapping an `https://app.c-point.co/communities/123` link opens the app → WebView loads the URL with the surviving session cookie → user sees authenticated content.

This doesn't bypass logout per se, but it **triggers app launch at an authenticated route** which masks the failed cookie clear.

### Q9: Process death + restoration

`MainActivity.onCreate(savedInstanceState)` passes `savedInstanceState` to `super.onCreate()` (Capacitor's `BridgeActivity`). However, **Capacitor's `BridgeActivity` does NOT use saved-instance-state to restore WebView page state.** It always loads the configured `server.url` (`https://app.c-point.co`) fresh.

So process death + restoration does NOT restore the previous authenticated URL. But it DOES trigger a fresh load of `app.c-point.co` which — if cookies survived — will auto-authenticate.

### Q10: See §1 Persistence-Layer Matrix above.

### Q11: Recent native changes

The three Java files in `client/android/app/src/main/java/co/cpoint/app/` are:

1. **`MainActivity.java`** — Standard `BridgeActivity` subclass. Registers `ShareImportPlugin`. Handles share intent routing via `cpoint://share/incoming` synthetic intent. No cookies, auth, or FCM code. No `onSaveInstanceState` override. No `CookieManager` interaction.

2. **`ShareImportPlugin.java`** — Reads share manifest from `filesDir/IncomingShare/`, returns base64 file data to JS. No auth, cookies, or network code.

3. **`ShareIntentHelper.java`** — Persists incoming share intents to `filesDir/IncomingShare/manifest.json`. No auth, cookies, or network code.

**Suspicious patterns:** None in custom Java code. The vulnerability is in what's **missing** (no `CookieManager.flush()` call) rather than what's present.

**`android:allowBackup="true"`** in `AndroidManifest.xml` (line 5) with no `<data-extraction-rules>` or `<full-backup-content>` exclusions means Google Auto Backup will back up the entire app data directory including WebView cookies database. Not a direct session-persistence vector, but a data-leakage concern.

---

## 4. Concrete Reproduction Steps

### Test A: Cookie flush race (Root Cause #1)

1. Install release APK on a physical Android device
2. Log in with credentials (ensure `remember_token` is issued — check Network tab or server logs)
3. Navigate around briefly (confirm session works)
4. Tap Logout
5. **Immediately** (within 1-2 seconds) swipe-kill the app from the recents tray
6. Wait 5 seconds, then open the app from launcher
7. **Expected if bug present:** App loads authenticated dashboard (remember_token cookie was not flushed to disk as cleared)
8. **Expected if bug absent:** App loads `/welcome` or login screen

### Test B: Slow variant (confirm flush timing)

1. Same as Test A steps 1-4
2. Wait 10-15 seconds (allow async flush to complete)
3. Force-stop app from Settings → Apps → C-Point → Force Stop
4. Open app from launcher
5. **Expected:** App loads login screen (flush had time to complete)
6. Compare result with Test A — if Test A shows authenticated and Test B doesn't, flush race is confirmed.

### Test C: Google Sign-In silent re-auth (Root Cause #2)

1. Log in via Google Sign-In on Android
2. Tap Logout, wait for `/welcome` page
3. Tap "Sign in with Google"
4. **Expected if bug present:** Same Google account is auto-selected without showing the chooser; user is logged back in with one tap
5. **Expected if bug absent:** Google account chooser appears, or user must re-confirm

### Test D: Domain-mismatched remember_token (Root Cause #3)

1. Log in on a device that may have an older `remember_token` cookie (issued before the May 2026 domain migration)
2. Inspect cookies in `chrome://inspect` → WebView → Application → Cookies
3. Note the `remember_token` domain (`.c-point.co` vs host-only `app.c-point.co`)
4. Tap Logout
5. Re-inspect cookies — is the `remember_token` still present?
6. **Expected if bug present:** Old `.c-point.co`-domain `remember_token` survives because the clear targeted host-only

---

## 5. Open Questions for Parent Agent

1. **Server logs:** Can we check Cloud Run logs for `/logout` requests from Android user-agents followed by successful authenticated API calls from the same user within 1-5 minutes? This would confirm the flush-race window.

2. **`remember_token` domain audit:** What is the current `SESSION_COOKIE_DOMAIN` value on the production Cloud Run instance (`app.c-point.co`)? Confirm it's `None` (host-only) as the code suggests. Are there any users whose `remember_token` was issued under the old `.c-point.co` domain config?

3. **`CookieManager.flush()` integration:** The fix would involve calling `CookieManager.getInstance().flush()` from native Java after the WebView navigates to `/logout`. Should this be a Capacitor plugin method callable from JS, or a `WebViewClient.onPageFinished()` hook on the `/logout` → `/welcome` redirect?

4. **`revokeAccess()` product decision:** Should logout fully revoke Google OAuth access (forces full re-consent on next login) or just clear the local state (`signOut()` only, current behavior)? Full revoke is more secure but adds friction.

5. **Device telemetry:** Can we add a one-shot diagnostic that logs (to the server) the WebView's `CookieManager` cookie list on app cold start, before any API calls? This would conclusively show whether cookies survived the previous logout.

6. **`allowBackup` policy:** Should we set `android:allowBackup="false"` or add `<data-extraction-rules>` to exclude WebView data and SharedPreferences from Google Auto Backup?
