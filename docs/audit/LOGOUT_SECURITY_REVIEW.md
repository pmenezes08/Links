# Logout Session-Persistence — Independent Security Review

**Date:** 2026-05-28
**Reviewer:** Security Sentinel (cybersecurity audit agent)
**Scope:** `docs/audit/LOGOUT_REMEDIATION_PLAN.md`, per-platform audits, backend auth code, frontend logout flow, native shells, service worker, test suite
**Methodology:** `.cursor/rules/cybersecurity-methodology.mdc` — trace every auth path from request entry to data return; assume every route leaks until proven otherwise

---

## 1. Verdict on the Diagnosis

**Confirmed-with-caveats.**

RC-1 (the `after_app_request` rotation hook re-issuing a `remember_token` on the `/logout` response) is definitively the smoking gun. The data flow is airtight:

1. `auto_login_from_remember_token` (`backend/blueprints/auth.py:113-129`): when no `username` in session and a valid `remember_token` cookie is present, it calls `remember_tokens.restore_session()` which sets `session["username"]` (`backend/services/remember_tokens.py:176`), then sets `g.remember_token_rotation_username` and `g.remember_token_rotation_old_hash` (`auth.py:126-127`).
2. `/logout` (`auth.py:580-623`): reads `session.get("username")` at line 584 (which works because `before_app_request` just restored it), calls `revoke_by_cookie(request)` at line 595 (deletes the old DB row — that is the `tokens_revoked=1` log line), then `session.clear()` at line 597, builds a 302 redirect to `/welcome`, calls `remember_tokens.clear_cookie(resp)` at 601, `auth_session.clear_session_cookie(resp)` at 602, `auth_session.clear_install_cookie(resp)` at 603, and saves the empty session at 613.
3. `rotate_remember_token_after_auto_login` (`auth.py:132-151`): fires on **every** response. The `g.*` flags set in step 1 survive through the request — `session.clear()` does NOT clear Flask's `g` namespace. There is **no guard** checking the endpoint. At line 141 it revokes the old hash (already deleted by logout — no-op), and at line 146 it calls `remember_tokens.issue(response, username)` which inserts a **new DB row** and overwrites the `Set-Cookie: remember_token` header with a fresh 365-day token. Line 147 also re-issues `native_push_install_id`.

Flask `after_app_request` hooks run on redirect responses — confirmed by Flask's WSGI internals (`Flask.process_response` calls registered `after_request` functions for all response types including 3xx). The `g` namespace is per-request and is not cleared by `session.clear()`. Nothing in the logout handler sets any flag that would prevent the rotation hook from firing.

**The net result:** the `/logout` 302 response carries *two* `Set-Cookie: remember_token` headers — the clear (`Max-Age=0`) followed by the re-issue (`Max-Age=31536000`). The browser applies the last one. The user is handed a fresh credential on the very response that was supposed to end their session.

**Caveats on RC-2 and RC-3:**

- **RC-2 (iOS `URLSession.shared` cookie-jar split):** Confirmed that `AppDelegate.swift:152` uses `URLSession.shared.dataTask(with: request)` for badge sync and that `HTTPCookieStorage.shared` is separate from WKWebView's `WKHTTPCookieStore` (zero `WKHTTPCookieStore` or `HTTPCookieStorage` references in `client/ios/` — confirmed by grep). However, the mechanism by which `HTTPCookieStorage.shared` acquires a valid `cpoint_session` is indirect — WKWebView's cookies do not automatically sync to the native jar. The more likely iOS amplifier is RC-1 itself: the freshly minted `remember_token` in WKWebView's jar triggers `auto_login_from_remember_token` on next app launch. The `URLSession.shared` jar is a real defense-in-depth concern but likely not the primary vector.
- **RC-3 (Android `CookieManager.flush()` missing):** Confirmed — zero `CookieManager` references in `client/android/app/src/main/java/` (confirmed by grep). The swipe-kill race is real but narrow. With RC-1 fixed, the expired token (`Max-Age=0`) will also be written to disk eventually. This is defense-in-depth, not the single cause.

---

## 2. Verdict on Each Proposed Fix

| PR | Title | Closes the gap? | Creates new risk? | Recommended modifications | Ship in this release? |
|----|-------|----------------|-------------------|--------------------------|----------------------|
| **PR-A** | Block remember-me rotation on `/logout` | **Yes.** The early-return guard in `rotate_remember_token_after_auto_login` when `request.endpoint == 'auth.logout'` prevents the re-issue. Only `auto_login_from_remember_token` (`auth.py:126-127`) sets the `g.*` flags — no other consumers exist. Skipping rotation on `/logout` is semantically correct. | **No.** The rotation hook's only purpose is to refresh the remember-me credential after silent restoration; skipping it on the endpoint that tears down the session has zero effect on login, refresh, or rotation on other endpoints. Rollback is trivial (revert the early-return). | (1) Add an info-level log line inside `auto_login_from_remember_token` on successful restoration (between `auth.py:127` and `128`): `current_app.logger.info("auth.remember_me_restore username=%s ip=%s ua=%s", username, request.remote_addr, request.headers.get("User-Agent", "")[:80])` — without this, post-deploy monitoring is blind. (2) Using both `request.endpoint == 'auth.logout'` and `request.path == '/logout'` is redundant but harmless — keep both for safety. | **Yes — same-day hotfix, but co-ship with PR-D** (see §4). |
| **PR-B** | iOS native `URLSession.shared` cookie-jar parity | **Yes**, if implemented correctly. | **Low risk.** The plan offers two options: (a) route badge-sync through WKWebView (preferred — single jar), or (b) import WKWebView cookies into `HTTPCookieStorage.shared` + native bridge to clear the native jar. Option (b) briefly exposes `httpOnly` cookies via `WKHTTPCookieStore.allCookies()` (known WebKit behavior). `HTTPCookieStorage.shared` is app-scoped, NOT shared with Safari, so no Safari leakage. | **Strongly recommend option (a)** — move badge-sync into WKWebView (`evaluateJavaScript` with a `fetch`) to avoid the `httpOnly` exposure window entirely. If option (b) is chosen, scope `removeCookies(since:)` to `app.c-point.co` only. | Yes — after PR-A+D, in the native build wave. |
| **PR-C** | Android `CookieManager.flush()` + persistent guarantee | **Yes**, as defense-in-depth. | **No.** `CookieManager.flush()` is async (returns `ValueCallback<Boolean>`) and does NOT block the UI thread. Calling from `onPause()` schedules the write but may not complete before process death (same race, smaller window). The plan's proposal to also call `removeAllCookies()` on logout is the real belt-and-braces — also async but completes faster than process death after an explicit user action. | None — the proposal is sound. | Yes — after PR-A+D, in the native build wave. |
| **PR-D** | Backend defense in depth (`revoke_for_user`, legacy domain sweep, `g.skip_remember_rotation`, `no_store`) | **Yes — and it is REQUIRED alongside PR-A.** (a) `revoke_for_user(username)` kills all remember-me rows for the user — correct security default; PO must confirm (§8 Q2 in the plan). (b) Multi-domain sweep for `remember_tokens.clear_cookie` and `auth_session.clear_install_cookie` mirrors the four-variant pattern already used by `clear_session_cookie` (`auth_session.py:21-31`). Without this, users whose `remember_token` was issued under the old `.c-point.co` domain config CANNOT log out — a host-only expiry does NOT clear a `.c-point.co`-domain cookie. (c) `g.skip_remember_rotation = True` is belt-and-braces on top of the endpoint check in PR-A. | **No new risk from (a)-(c).** Side effect of (a): logging out on phone kills remember-me on desktop. This is the correct security default for "logout" and is flagged as a PO decision. `no_store` is already present on the `/logout` redirect (`auth.py:614`); the subsequent `/welcome` GET gets `no-cache` from the `add_cache_headers` after-request hook (`bodybuilding_app.py:484-487`). | `revoke_for_user` (`remember_tokens.py:202-213`) already exists and is tested (`test_remember_tokens.py:170-182`). Ensure the new test (`test_logout_revokes_all_user_remember_tokens`) inserts rows for the same user on multiple "devices" and asserts all are deleted. | **Yes — MUST co-ship with PR-A** (see §3 C6 and §4). |
| **PR-E** | SW `/api/profile_me` network-only | **Yes.** `sw.js:29` includes `/api/profile_me` in `STALE_API_ENDPOINTS` despite the comment at line 20 saying it shouldn't be there. Removing it makes `/api/profile_me` fall through to the `networkFirst` handler at `sw.js:241-244`. | **No.** Network-first already caches 200 responses and serves from cache on network failure. Offline users see a stale profile rather than an error — same as before but with an extra network attempt first. No DoS amplification (one extra network request per page load, not an amplifier). | Bump `SW_VERSION` (currently `'2.64.0'` at `sw.js:1`) so old SWs replace themselves on next page load. | Yes — web-only, ship in parallel with PR-F/G. |
| **PR-F** | Password login parity with OAuth | **Yes**, for the data-leakage-on-account-switch scenario. | **No.** `ensureAccountIsolationForUsername` (`accountStateReset.ts:172-179`) compares `nextUsername` with `localStorage.getItem('current_username')`. If different, it calls `resetAccountScopedState()` which clears account-scoped localStorage, IndexedDB, and caches. It returns `true`/`false` — neither value reveals prior account info. No enumeration risk. | None — the proposal is sound. | Yes — low priority, ship last. |
| **PR-G** | Test infra fix for `logout.test.ts` | **Yes** — test-only, structurally correct. `vi.resetModules()` + factory-style `vi.mock` + dynamic `await import('./logout')` is the standard Vitest pattern. | **No** — CI only. | None. | Yes — ship with PR-F. |

---

## 3. Gaps the Plan Does NOT Cover

### C1. CSRF on `/logout` — P3 (Low)

`/logout` is a **GET** endpoint (`auth.py:580`: `@auth_bp.route("/logout", endpoint="logout")` — no `methods=` restriction, defaults to GET). The CSRF origin check in `_should_skip` (`backend/services/security.py:114-115`) **skips all GET requests**. This means a malicious page can embed `<img src="https://app.c-point.co/logout">` and force any C-Point user to log out — a nuisance DoS but not a session compromise. A full "login CSRF" (forced login to attacker's account) is impractical because `/api/auth/google` requires a valid Google ID token that cannot be forged, and `/login_password` requires interactive password entry.

**Proposed remediation:** In a follow-up, make `/logout` POST-only (`methods=["POST"]`) and update `logout.ts:107` to submit a form POST instead of `window.location.replace`. Low priority — the forced-logout risk is annoying but not a data compromise.

### C2. Token replay / lifetime limiting — P1 (High)

The plan fixes RC-1 (no new token on logout) and RC-5 (revoke all rows on logout). But there is **no maximum lifetime enforcement** on remember-me tokens beyond the DB `expires_at` field (365 days, `remember_tokens.py:114`). No anomaly detection exists — a remember-me cookie used from a new IP, new device fingerprint, or after a long dormancy period is silently accepted. If a device was stolen before logout, the thief has up to 365 days to use the remember-me token from any network.

**Proposed remediation:** (1) Add remember-me token rotation on a shorter cycle (e.g., 30-day hard expiry with re-issue on active use). (2) Log `auto_login_from_remember_token` restores with IP + User-Agent for anomaly detection (partially addressed by the mandatory hardening in §4). (3) Consider a "sign out all devices" UI surface tied to `revoke_for_user`.

### C3. Audit logging gap — P1 (High, required before ship)

The current `auto_login_from_remember_token` (`auth.py:113-129`) does **not** emit any log line on successful silent session restoration. The only logging is in the `except` block at line 129 (failure case). This means:

- After the fix, there is no way to detect whether remember-me tokens are still being replayed anomalously.
- There is no audit trail for "user X was silently authenticated via remember-me at time T from IP Y."
- Post-deploy verification of PR-A requires correlating multiple log entries instead of a single authoritative restoration event.

**Proposed remediation:** Before shipping PR-A, add an info-level log line inside `auto_login_from_remember_token` on successful restoration, between `auth.py:127` and `128`:

```python
current_app.logger.info(
    "auth.remember_me_restore username=%s ip=%s ua=%s",
    username, request.remote_addr, request.headers.get("User-Agent", "")[:80]
)
```

### C4. Account deletion (`/delete_account`) vs logout — P2 (Medium)

`delete_account_post` (`auth.py:626-679`) calls `session.clear()` at line 649 but does **not** send `Set-Cookie` clears for `cpoint_session`, `remember_token`, or `native_push_install_id`. The response at line 675 is a JSON `{"success": True, "clear_storage": True}`.

**Safety net:** `restore_session` (`remember_tokens.py:171-173`) checks `session_identity.user_exists(username)` and revokes the token if the user doesn't exist. Also, `login_required` (`bodybuilding_app.py:412-418`) checks `session_identity.user_exists(username)` on every protected request.

**Residual risk:** The `cpoint_session` Flask cookie is a signed session that contains `username`. Routes without `login_required` that read `session.get("username")` could still return data for a deleted user if the session cookie persists. The 365-day `remember_token` persists as dead data and trips legacy-domain patterns if the next user logs in on the same device.

**Proposed remediation:** Mirror `/logout`'s cookie-clear stack on the `delete_account` response. Acceptable to defer to follow-up given the `user_exists` safety nets.

### C5. OAuth bypass after logout — P2 (Medium, acceptable to defer)

Even after all PRs ship, a client can POST a stored Google / Apple ID token to `/api/auth/google` (`auth.py:1080-1133`) or `/api/auth/apple` (`auth.py:1227-1375`) to get a new session. The OAuth endpoints verify the token's signature against Google/Apple's JWKS, confirm the audience matches the app's client IDs, and look up the user by `google_id`/`apple_id`. They do **not** check whether the user recently logged out.

However, obtaining a valid ID token post-logout requires either (a) the Google/Apple SDK on the device (which requires user interaction after `GoogleAuth.signOut()` clears the cached token), or (b) stealing a token that hasn't expired (Google ID tokens expire in ~60 minutes; Apple's in ~5 minutes). The replay window is short.

**Proposed remediation:** The plan's RC-7 (`revokeAccess()` / `disconnect()`) is the correct long-term fix — adds friction (next sign-in shows the chooser/consent) but closes the gap. The plan's P2 classification is acceptable.

### C6. Prod cookie domain migration / legacy cookies — P1 (High, ship-blocking if PR-D not co-shipped)

`bodybuilding_app.py:648-651`: when `CANONICAL_HOST == 'app.c-point.co'`, `SESSION_COOKIE_DOMAIN` is **not set** (host-only cookies). Any user who logged in when the config was `.c-point.co` has a `remember_token` cookie with `Domain=.c-point.co`. The current `clear_cookie` (`remember_tokens.py:216-218`) sends a host-only expiry. **A host-only expiry does NOT clear a domain-scoped cookie** — the browser treats them as distinct cookies.

This means some users **cannot log out at all** until either (a) the legacy cookie expires (365 days from issue), or (b) PR-D's multi-domain sweep ships. **This is why PR-D must ship in the same release window as PR-A.**

`clear_session_cookie` (`auth_session.py:21-31`) already handles this correctly with a four-variant sweep. The asymmetry between session cookie clearing and remember-token clearing is the specific defect.

### C7. Server-side session storage / SECRET_KEY — P2 (Medium)

Flask uses **client-side signed sessions** (cookie-based, via `itsdangerous`). The `SECRET_KEY` is loaded from `FLASK_SECRET_KEY` env var (`bodybuilding_app.py:1131-1137`). If this key is leaked, an attacker can forge arbitrary `cpoint_session` cookies containing any username, bypassing all server-side controls.

The key is managed via Cloud Run secrets. The plan does not address SECRET_KEY rotation. If the key has never been rotated since project inception, it is a latent risk — a leaked `SECRET_KEY` would make all client-side cookie fixes irrelevant.

**Proposed remediation:** Verify SECRET_KEY was rotated during the May 2026 domain migration. If not, schedule rotation as a follow-up with a session invalidation plan (all users will need to re-authenticate after rotation).

### C8. SameSite / domain attribute mismatch — P2 (Medium)

From the code:

| Cookie | `SameSite` | `Secure` | `Domain` | Source |
|--------|-----------|----------|----------|--------|
| `cpoint_session` | `None` (`bodybuilding_app.py:638`) | `True` (Cloud Run) | Host-only on `app.c-point.co` (`bodybuilding_app.py:648-651`) | Flask session |
| `remember_token` | `Lax` (`remember_tokens.py:33`) | `True` | Host-only | `remember_tokens.issue` |
| `native_push_install_id` | `None` (via `_install_cookie_attrs`, `auth_session.py:38`) | `True` | Host-only | `auth_session.set_install_cookie` |

The mismatch: `cpoint_session` is `SameSite=None` while `remember_token` is `SameSite=Lax`. This is problematic in two ways:

1. **Capacitor origin behavior:** Capacitor WebViews send requests with `Origin: capacitor://localhost`. With `SameSite=Lax`, the `remember_token` cookie is only sent on top-level navigations from same-site origins, not on cross-site subrequests. For the current design this is actually fine — `remember_token` is only needed for the `before_app_request` hook on page navigation, not on API fetches. But it is a maintenance footgun.

2. **iOS Safari ITP:** iOS 16.4+ Intelligent Tracking Prevention treats `SameSite=None` cookies more aggressively, potentially capping their lifetime. Having different `SameSite` values between session cookie and remember cookie means they may age out at different rates. In practice, since both use host-only `app.c-point.co` and requests originate from the same domain, ITP's third-party classification should not apply. This is a theoretical concern, not an active exploit.

**Proposed remediation:** Document the inconsistency. Consider aligning both to `SameSite=None; Secure` for consistency (required for admin-web cross-subdomain access anyway). Low priority.

---

## 4. Mandatory Hardening Before Ship

These items **must** be included before merging PR-A to production:

### 4.1. Add audit log on successful `auto_login_from_remember_token` (P1)

Without this, post-deploy monitoring is blind. Add between `auth.py:127` and `128`:

```python
current_app.logger.info(
    "auth.remember_me_restore username=%s ip=%s ua=%s",
    username, request.remote_addr, request.headers.get("User-Agent", "")[:80]
)
```

This enables the production log monitor described in the plan's §5.3 and provides an audit trail for anomalous remember-me usage.

### 4.2. Co-ship PR-D with PR-A (P1)

PR-A alone is insufficient for users whose `remember_token` was issued under the old `.c-point.co` domain config. Those users' tokens survive the single-domain `clear_cookie` and cannot be cleared until either (a) 365-day expiry or (b) PR-D's multi-domain sweep. Shipping PR-A without PR-D leaves a subset of users unable to log out for up to a year.

PR-D's risk is low — it adds more `Set-Cookie` clear headers and calls `revoke_for_user` (already tested at `test_remember_tokens.py:170-182`). The two PRs should be a single backend deploy.

### 4.3. Verify `FLASK_SECRET_KEY` rotation (P2, background verification)

Flask's client-side signed sessions mean a leaked or long-lived secret key allows forging arbitrary sessions containing any username — making all cookie-clearing fixes irrelevant. Confirm:

- Was `FLASK_SECRET_KEY` rotated during the May 2026 domain migration?
- Is the current key stored in Cloud Run Secret Manager (not in env vars or source)?
- Is there a rotation schedule?

This is a background verification, not a code change, but must be confirmed before treating the logout fix as fully resolved.

---

## 5. Recommended Hardening for Follow-Up

These are deferrable improvements that strengthen the security posture but are not required for the immediate remediation wave:

1. **Make `/logout` POST-only** — prevents forced-logout via GET CSRF (`auth.py:580`). Update `logout.ts:107` to submit a form POST instead of `window.location.replace`. Low priority (P3).

2. **Add remember-me token IP/UA logging** — enables anomaly detection for stolen tokens. Log every `auto_login_from_remember_token` restore with IP, User-Agent, and token age (partially addressed by §4.1). Medium priority (P1).

3. **Add `remember_token` rotation ceiling** — e.g., max 90-day absolute lifetime even with rotation (`remember_tokens.py:114` currently uses 365 days). Prevents indefinite credential validity on stolen devices. Medium priority (P1).

4. **Mirror `/logout`'s cookie-clear stack on `/delete_account`** — `delete_account_post` (`auth.py:626-679`) does not send `Set-Cookie` clears. The `user_exists` safety net (`remember_tokens.py:171-173`, `bodybuilding_app.py:412-418`) bounds the risk, but sloppy. Medium priority (P2).

5. **Add `revokeAccess()` / `disconnect()` to OAuth logout** — `logout.ts:88-93` only calls `GoogleAuth.signOut()`, not `revokeAccess()`. Adds friction (next sign-in shows the chooser/consent) but prevents trivial re-establishment of sessions. Medium priority (P2).

6. **Reset Firebase Installation ID on logout** — both platform audits confirm FID survives logout. Server does not treat FID as identity, but it links pre/post-logout device identity. Privacy hygiene. Low priority (P3).

7. **Set `android:allowBackup="false"` or add data extraction rules** — `AndroidManifest.xml` has `allowBackup="true"` with no exclusions. Google Auto Backup could restore cookies/prefs on reinstall. Privacy concern, not a session-persistence bug. Low priority (P3).

8. **Verify and schedule `FLASK_SECRET_KEY` rotation** — if never rotated since project inception, schedule with session invalidation plan. All users will need to re-authenticate. Medium priority (P2).

9. **Align `SameSite` attribute across all three cookies** — `cpoint_session` is `SameSite=None`, `remember_token` is `SameSite=Lax`. Inconsistency is a maintenance footgun. Low priority (P3).

10. **CSRF enforcement default hardening** — `security.py:160` defaults `CSRF_ORIGIN_ENFORCE` to `"false"` (shadow mode). Production Dockerfile sets it to `true` (`Dockerfile:52`), but if the env var is ever accidentally unset, enforcement silently degrades. Consider defaulting to `true` in code. Low priority (P3).

---

## 6. Sign-Off Block

PO-actionable checklist. Each item must be confirmed before deploying to production:

- [ ] **6.1** RC-1 confirmed: rotation hook re-issues `remember_token` on `/logout` response — **Confirmed** by security review (see §1).
- [ ] **6.2** PR-A guard prevents re-issue — code reviewed and new test (`test_logout_does_not_rotate_remember_token_after_silent_restore`) passes.
- [ ] **6.3** Audit log added for `auto_login_from_remember_token` successful restores (§4.1) — log line present in PR-A diff.
- [ ] **6.4** PR-D multi-domain sweep covers legacy `.c-point.co` cookies — `remember_tokens.clear_cookie` and `auth_session.clear_install_cookie` both emit four domain variants (matching `clear_session_cookie` pattern).
- [ ] **6.5** PR-D `revoke_for_user` kills all user tokens on logout — PO has approved all-devices sign-out (§8 Q2 in remediation plan).
- [ ] **6.6** PR-A + PR-D tested on staging: (a) `gcloud logging read` shows zero `tokens_revoked=1` lines correlated with a non-empty `Set-Cookie: remember_token=<value>; Max-Age=<positive>` on the same response; (b) multi-device test confirms logout on phone kills desktop session.
- [ ] **6.7** `FLASK_SECRET_KEY` rotation verified — key was rotated during May 2026 migration OR rotation is scheduled with session invalidation plan.
- [ ] **6.8** `CSRF_ORIGIN_ENFORCE=true` confirmed in production Cloud Run env — verified in `Dockerfile:52`.
- [ ] **6.9** PR-B (iOS) clears `HTTPCookieStorage.shared` on logout — manual verification: post-logout cold launch sends no stale `cpoint_session` on badge-sync request.
- [ ] **6.10** PR-C (Android) calls `CookieManager.flush()` + `removeAllCookies()` — manual verification: logout → swipe-kill within 1s → relaunch lands on `/welcome`.
- [ ] **6.11** PR-E removes `/api/profile_me` from `STALE_API_ENDPOINTS` and bumps `SW_VERSION` — DevTools confirms `/api/profile_me` served from network, not SW cache, after logout.
- [ ] **6.12** Post-deploy log monitor configured — Cloud Logging alert on `auth.logout … tokens_revoked=1` correlated with non-zero `Max-Age` `remember_token` Set-Cookie (should be permanently silent after PR-A).

**Sign-off:** ⚠️ **Confirmed-with-caveats — proceed with fixes.** The diagnosis is sound. The proposed fixes are structurally correct and do not create new security risks. Three mandatory additions (§4) must be included before merging. No ship-blockers in the proposed fixes themselves.
