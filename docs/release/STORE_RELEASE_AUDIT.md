# C-Point — Store release audit (App Store update + Google Play first ship)

**Date:** 2026-05-19  
**Coordinator:** Release audit (5 sequential lanes, read-only)  
**Truth docs:** `AGENTS.md`, `docs/STORE_BILLING_SETUP.md`, `docs/PRODUCT_JOURNEYS.md` (§ Mobile store billing), `docs/QA_CHECKLIST.md` §7a  

---

## Cross-lane blockers

| ID | Blocker | Raised by | Blocks |
|----|---------|-----------|--------|
| X1 | `@capgo/native-purchases` in npm but **not** linked in iOS Podfile / Android Capacitor gradle | Agent 3, 4 | Native IAP on both platforms |
| X2 | Default `client/capacitor.config.ts` loads **staging** API URL | Agent 3, 4 | Prod App Store / Play binaries |
| X3 | No server-side Apple/Google **purchase verification** API calls on confirm | Agent 2 | Production fraud / trust |
| X4 | `iap_purchases_enabled` defaults false; prod confirms rejected unless sandbox | Agent 2, 5 | Launch flip process |
| X5 | §7a manual QA not evidenced; KB test rows `not_run` | Agent 5 | Flip flag + ship |
| X6 | Steve Community Package checkout uses **Stripe** even on native (`onSteveCommunityChosen` → `startCheckout`) | Agent 1 | Apple “external purchase” policy review |

---

## Agent 1 — Subscription UI

**Scope:** `ManageMembershipModal.tsx`, `SubscriptionPlans.tsx`, `EditCommunity.tsx`, `mobileStoreBilling.ts`

### Summary

- **SubscriptionPlans** correctly branches native Premium/community to `purchaseStoreSubscription` when `currentStoreProvider()` is set and product IDs exist; otherwise falls back to Stripe `startCheckout`.
- **Second store-billed community** is blocked with `store_community_limit` UX: `mobileBillingNotice` + external link to `web_app_billing_url` (default `https://app.c-point.co/subscription_plans`).
- **ManageMembershipModal** Billing tab shows provider badge and routes store users to App Store / Play subscription management URLs.
- **EditCommunity** shows `providerBadge`, disables in-app tier upgrade for store-billed communities, opens store URLs for cancel/manage.

### Findings

| Sev | Issue | Evidence | Fix |
|-----|-------|----------|-----|
| P1 | **Plan tab** has no `subscription_provider` badge; “Upgrade to Premium” always navigates to `/subscription_plans` | `ManageMembershipModal.tsx` PlanTab ~195–268 | Add provider badge; on native, ensure CTA copy says “Subscribe in App Store/Play” |
| P1 | **Steve Community Package** always uses Stripe checkout (`onSteveCommunityChosen` → `startCheckout`) with **no** `currentStoreProvider()` guard | `SubscriptionPlans.tsx` ~649–662 | For native: open external web billing URL or block with copy; avoid in-app Stripe Checkout in WebView for Apple review |
| P1 | Client **never reads** `iap_purchases_enabled` from `/api/iap/config` | `mobileStoreBilling.ts` types only; `SubscriptionPlans` uses product IDs for `storeProductAvailable` | Gate subscribe CTAs when false; show “Purchases temporarily unavailable” to avoid post-purchase confirm failure in prod |
| P2 | **Change-tier** for existing Stripe community blocked in UI for store; upgrade button disabled in EditCommunity modal for store — good | `SubscriptionPlans.tsx` ~551–558; `EditCommunity.tsx` ~920 | — |
| P2 | Steve addon button in EditCommunity still navigates to `/subscription_plans?...community_addons` for store-billed roots | `EditCommunity.tsx` ~929–938 | Confirm Apple allows Stripe add-on via web overflow only |
| OK | Store-billed personal billing: external store links | `ManageMembershipModal.tsx` ~472–510 | — |
| OK | Restore purchases UI when `storeProvider` set | `SubscriptionPlans.tsx` ~1062–1072 | — |
| OK | Active subscriptions show App Store / Google Play badges | `SubscriptionPlans.tsx` ~1196–1273 | — |

### Agent 1 verdict

UI policy is **mostly aligned** with `docs/PRODUCT_JOURNEYS.md` for Premium + first community IAP. **Steve package + Plan tab** need review before Apple resubmission.

---

## Agent 2 — Backend IAP

**Scope:** `mobile_iap.py`, `iap_links.py`, `iap.py`, `subscription_webhooks.py`, `subscriptions.py`, `me.py`, tests

### Summary

- KB-driven `/api/iap/config` exposes product IDs, `iap_purchases_enabled`, `web_app_billing_url`.
- `_grants_allowed`: sandbox / `license_test` / `xcode` / `test` always grant; production requires `iap_purchases_enabled=true`.
- `iap_links` table maps `purchase_key` → user/community; `store_community_limit` enforced (tested).
- Stripe paths return `store_billing_active` (403) for apple/google rows on portal and change-tier.

### Findings

| Sev | Issue | Evidence | Fix |
|-----|-------|----------|-----|
| P0 | **No Apple App Store Server API / Google Play Developer API verification** on confirm — trusts client `purchase_key` + optional JWS decode without signature verify | `mobile_iap.confirm_purchase`; `apple_iap.py` / `google_iap.py` are thin wrappers | Add server verification before `mark_subscription` in production |
| P1 | Apple webhook uses `_decode_jws_unsafely` but still calls `apply_store_lifecycle` | `subscription_webhooks.py` ~696–749, ~861–877 | Verify JWS with Apple roots before lifecycle mutations |
| P1 | Google RTDN decodes Pub/Sub payload without purchase token validation against Play API | `subscription_webhooks.py` ~769–807 | Add Play API subscription GET before grant/revoke |
| P2 | Webhook community lifecycle mapping is coarse (premium-oriented action names) | `_apple_notif_to_action`, `_google_notif_to_action` | Confirm community tier renew/cancel events map correctly |
| OK | `iap_purchases_disabled` → 403 on confirm | `iap.py` `_status` ~143–145 | — |
| OK | `store_community_limit` → 409 | `test_mobile_iap.py` | — |
| OK | CSRF bypass for webhook paths | `tests/test_security_origin.py` | — |

### API surface (reference)

| Route | Role |
|-------|------|
| `GET /api/iap/config` | Product IDs + launch flag |
| `POST /api/iap/apple/confirm`, `/restore` | Grant personal/community |
| `POST /api/iap/google/confirm`, `/restore` | Same for Play |
| `POST /api/webhooks/apple` | ASSN2 lifecycle |
| `POST /api/webhooks/google` | RTDN lifecycle |

### Agent 2 verdict

Backend **structure matches** product journeys; **trust boundary** (verify purchases + webhook signatures) is **not production-grade** yet.

---

## Agent 3 — iOS (App Store update)

**Scope:** `client/ios`, `capacitor.config.ts`, Podfile, entitlements

### Summary

- Capacitor iOS project exists; bundle `co.cpoint.app`; privacy usage strings present (mic, camera, photos, notifications, calendar).
- Google Sign-In pod pinned ≥7.1 for privacy manifest (ITMS-91061).
- Associated domains / push entitlements in `App.entitlements` (per prior architecture).

### Findings

| Sev | Issue | Evidence | Fix |
|-----|-------|----------|-----|
| P0 | **`@capgo/native-purchases` not in Podfile** — only `CapgoInappbrowser` | `client/ios/App/Podfile` ~11–26 | `cd client && npx cap sync ios`; commit Podfile.lock |
| P0 | **`capacitor.config.ts` `server.url`** points to **staging** Cloud Run | `client/capacitor.config.ts` ~9–14 | Release builds must use prod (`app.c-point.co` or bundled `webDir` without remote staging URL) |
| P1 | App Store Connect checklist (products, ASSN2 URL, screenshots) is **operator** — not verifiable in repo | `docs/STORE_BILLING_SETUP.md` | Complete § App Store Connect; webhook → prod `https://cpoint-app-.../api/webhooks/apple` |
| P2 | `APPLE_APP_STORE_PLAN.md` is legacy planning doc | May confuse reviewers | Use `STORE_BILLING_SETUP.md` only |
| OK | Account deletion path exists | `AccountDangerZone.tsx` → `/delete_account` | Verify linked in App Store “account deletion” field |
| OK | Restore + external subscription URLs in UI | Agent 1 | — |

### Agent 3 verdict

**Do not ship** a new iOS binary until **native-purchases pod sync** and **prod Capacitor server URL** are fixed.

---

## Agent 4 — Android (first Play ship)

**Scope:** `client/android`, Play Billing wiring, release config

### Summary

- `applicationId` `co.cpoint.app`; `versionCode 2`, `versionName 1.1`.
- `google-services.json` present for FCM.
- App links: `https://app.c-point.co` with `autoVerify=true`.
- Release signing uses optional `MYAPP_RELEASE_*` gradle properties — may be unset locally.

### Findings

| Sev | Issue | Evidence | Fix |
|-----|-------|----------|-----|
| P0 | **`@capgo/native-purchases` not in `capacitor.settings.gradle` or `capacitor.build.gradle`** | `client/android/capacitor.settings.gradle`; `capacitor.build.gradle` dependencies | `npx cap sync android`; commit generated files |
| P0 | Same **staging `server.url`** in default capacitor config | `capacitor.config.ts` | Prod release pipeline must swap config or use production capacitor config |
| P1 | **Play Console** first-time: products, license testers, internal track, RTDN → `/api/webhooks/google` | `docs/STORE_BILLING_SETUP.md` | Operator checklist before production rollout |
| P1 | Release keystore not defined in repo (expected) — verify CI/CD signing | `android/app/build.gradle` signingConfigs | Configure Play App Signing + upload key in CI |
| P2 | No explicit `BILLING` permission in manifest (often added by billing library after sync) | `AndroidManifest.xml` | Re-check after cap sync |
| P2 | KB roadmap: **Android — Production rollout** status `not_started` | `knowledge_base.py` roadmap row | Track in Product Roadmap |
| OK | Deep link + share intents configured | `AndroidManifest.xml` | — |

### Agent 4 verdict

**First Play ship blocked** on native IAP plugin sync + Play Console setup + prod API URL in release builds.

---

## Agent 5 — QA & tests

**Scope:** `docs/QA_CHECKLIST.md` §7a, pytest, `SubscriptionPlans.test.tsx`

### §7a mapping

| Step | Platform | Automated test | Status |
|------|----------|----------------|--------|
| Premium IAP + App Store badge | iOS | None | **Manual** |
| Community L1–L3 IAP + badge | iOS | None | **Manual** |
| Second community → web billing link | iOS | None | **Manual** |
| Premium IAP + Play badge | Android | None | **Manual** |
| Community IAP + Play badge | Android | None | **Manual** |
| Second community → web billing link | Android | **Not listed in §7a** | **Add to QA** |
| Restore purchases | iOS + Android | None | **Manual** |
| Web guard `store_billing_active` | Web/API | No dedicated test | **Manual** + partial API |
| Web Stripe checkout | Web | `SubscriptionPlans.test.tsx` (KB UI only) | **Manual** for Stripe |

### Test coverage

| File | Covers |
|------|--------|
| `tests/test_mobile_iap.py` | Config defaults, Apple premium confirm, `store_community_limit` |
| `tests/test_subscription_webhook_notifications.py` | Stripe notifications (not Apple/Google IAP) |
| `client/src/pages/SubscriptionPlans.test.tsx` | Web pricing UI modals — **no** `NativePurchases` / IAP mocks |
| **Missing** | `test_apple_webhook.py`, `test_google_rtdn.py`, `test_store_billing_active` on portal/change-tier |

### KB / roadmap test pills

- `iap:mobile-webhooks` — **not_run**
- `iap:ios-subscriptions-review` — **not_run**

### Agent 5 verdict

All store-billing acceptance criteria are **manual** today. Complete §7a on **TestFlight + Play internal** before `iap_purchases_enabled=true`.

---

## Final merged report

### Executive summary

1. **Product model is documented and largely implemented:** web = Stripe; native = IAP for Premium + first community; extra communities = external web URL; provider fields drive management UI.
2. **P0 — Native IAP plugin not linked** in iOS Podfile or Android Capacitor gradle despite `@capgo/native-purchases` in `package.json` — purchases will fail until `cap sync`.
3. **P0 — Default Capacitor config loads staging API** — production store builds must not ship with `cpoint-app-staging-...` as `server.url`.
4. **P1 — Server does not verify receipts** with Apple/Google on confirm; webhooks decode Apple JWS without signature verification.
5. **P1 — Steve Community Package uses Stripe checkout on native** without store guard — clarify/align with Apple external-purchase rules.
6. **P1 — Client ignores `iap_purchases_enabled`** — users can complete store purchase but prod backend may reject confirm.
7. **Tests:** `test_mobile_iap.py` only; §7a is fully manual; Android second-community step missing from checklist.
8. **Flip `iap_purchases_enabled`:** **No** until P0 fixes, server trust improvements (recommended), and §7a pass on both stores.

### P0 — Blockers

| Issue | Platform | Evidence | Fix |
|-------|----------|----------|-----|
| Native purchases plugin not synced | iOS, Android | `package.json` has `@capgo/native-purchases`; absent from `Podfile`, `capacitor.settings.gradle`, `capacitor.build.gradle` | `cd client && npm ci && npx cap sync ios android`; commit native project changes; device smoke purchase |
| Staging API in default Capacitor config | iOS, Android | `client/capacitor.config.ts` `server.url` → staging Cloud Run | Release pipeline uses prod URL or ships bundled `dist` without remote staging |
| End-to-end IAP not validated | iOS, Android | No CI e2e; plugin missing | TestFlight + Play internal §7a |
| Play / App Store products + webhooks | Ops | `docs/STORE_BILLING_SETUP.md` | Configure SKUs + ASSN2 + RTDN on **production** API host |

### P1 — Important

| Issue | Platform | Evidence | Fix |
|-------|----------|----------|-----|
| No server-side purchase verification | Backend | `mobile_iap.confirm_purchase` | Integrate App Store Server API + Play Developer API |
| Unverified Apple webhook JWS | Backend | `subscription_webhooks._decode_jws_unsafely` + `apply_store_lifecycle` | Verify signatures before DB mutations |
| Steve package → Stripe on native | UI | `SubscriptionPlans.onSteveCommunityChosen` | External browser to web billing or disable on native |
| Client ignores `iap_purchases_enabled` | UI | `/api/iap/config` unused for gating | Disable CTAs + message when false |
| Plan tab missing billing provider | UI | `ManageMembershipModal` PlanTab | Show badge + correct upgrade path |
| No automated `store_billing_active` tests | Backend | grep tests: none | Add pytest for portal/change-tier 403 |

### P2 — Follow-up

| Issue | Platform | Evidence | Fix |
|-------|----------|----------|-----|
| `SubscriptionPlans.tsx` ~2k lines | Client | Monolith roadmap | Extract IAP vs Stripe hooks |
| Android §7a missing 2nd-community step | QA | §7a vs iOS | Add parity checkbox |
| Outdated `APPLE_APP_STORE_PLAN.md` | Docs | — | Archive or pointer to `STORE_BILLING_SETUP.md` |
| KB test rows not_run | Ops | `knowledge_base.py` | Run after §7a |

### Ready to ship?

| Platform | Ready? | Notes |
|----------|--------|-------|
| **iOS (update)** | **No** | Fix cap sync + prod config; run §7a; review Steve/Stripe on native |
| **Android (first)** | **No** | Same native fixes + full Play Console setup + signing |
| **Web** | **Yes** (Stripe path) | Verify prod KB pricing + Stripe live mode separately |

### Ready to flip `iap_purchases_enabled`?

**No.**

**Steps when ready:**

1. Complete P0 native sync + prod Capacitor/API targeting.  
2. Run **full §7a** on TestFlight and Play internal (add Android second-community step).  
3. Configure **production** webhooks (`/api/webhooks/apple`, `/api/webhooks/google`).  
4. (Recommended) Ship server purchase verification before broad prod traffic.  
5. Admin-web: KB **Reseed + Force** `user-tiers` → set `iap_purchases_enabled=true`.  
6. Deploy **production** API (`cpoint-app`).  
7. Smoke one sandbox/license purchase in prod flag state.  
8. Update KB Product Roadmap + Notion; mark Tests rows green.

### Manual QA minimum (order)

1. `npx cap sync` + release builds pointing at **prod**.  
2. iOS §7a: Premium, Community, **second community web link**, Restore.  
3. Android §7a: same (include **second community web link**).  
4. Web: Stripe Premium + community; attempt portal on store-billed row → `store_billing_active`.  
5. Webhook sandbox renewal/cancel → check `subscription_audit_log` / entitlements.  
6. Flip KB flag + deploy + repeat one purchase smoke.

### Suggested fix PR order

1. `fix/mobile-cap-sync-native-purchases` — cap sync ios/android  
2. `fix/capacitor-prod-release-config` — staging vs prod capacitor configs in CI  
3. `fix/iap-client-gate-and-steve-native` — `iap_purchases_enabled` + Steve native policy  
4. `feat/iap-server-verification` — Apple/Google verify on confirm (and webhooks)  
5. `test/store-billing-guards` — `store_billing_active` + webhook fixtures  
6. Ops: App Store Connect + Play Console (no code)

---

*End of audit. Not committed per request.*
