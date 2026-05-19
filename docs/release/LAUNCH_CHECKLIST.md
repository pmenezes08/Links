# Mobile store launch checklist (operator)

Manual steps after engineering PRs merge. Pair with **`docs/QA_CHECKLIST.md`** §7a / §8a.

## 1. Store consoles (before TestFlight / Play internal)

- [ ] **App Store Connect** — products match **`docs/STORE_BILLING_SETUP.md`**; ASSN2 → `https://cpoint-app-739552904126.europe-west1.run.app/api/webhooks/apple` (or custom prod host).
- [ ] **Play Console** — same SKUs; RTDN → `https://cpoint-app-739552904126.europe-west1.run.app/api/webhooks/google`.
- [ ] **Cloud Run `cpoint-app`** — Secret Manager: `APPLE_IAP_KEY_ID`, `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_PRIVATE_KEY`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
- [ ] **License testers** / sandbox accounts added on both stores.

## 2. Release binaries

From `client/`:

```bash
npm ci && npm run build
npm run cap:sync:prod
# iOS: archive in Xcode; Android: release bundle with prod signing
```

Confirm network traffic targets **`app.c-point.co`**, not `cpoint-app-staging-…`.

## 3. QA gate (required)

Complete **`docs/QA_CHECKLIST.md`** §7a (iOS + Android, including second-community web link) and §8a.

Mark KB Tests rows green: `iap:ios-subscriptions-review`, `iap:mobile-webhooks`.

## 4. Production flip (ordered)

1. Deploy **`cpoint-app`** with IAP verification + client UX.
2. Ship store builds (prod Capacitor profile).
3. Admin-web: KB reseed if pricing changed → set **`iap_purchases_enabled=true`** on **`user-tiers`** (prod only).
4. Set **`ENTITLEMENTS_ENFORCEMENT_ENABLED=true`** on **`cpoint-app`** if not already.
5. One license-tester purchase smoke in prod flag state.
6. Submit iOS for review / promote Play internal → production.

## 5. Infra before marketing push

- [ ] Upgrade Cloud SQL off **`db-f1-micro`** (see **`docs/OPERATIONS.md`** §0.1).
- [ ] Apply **`scripts/monitoring_alerts/`** + BigQuery billing export (§0.3).
- [ ] Schedule Cloud Scheduler: `POST /api/cron/ai-usage/daily-rollup` with `X-Cron-Secret`.
