# Mobile Store Billing Setup

This checklist keeps App Store Connect, Play Console, the in-app KB, and the native clients aligned for mobile subscriptions.

## Shared Product IDs

These IDs are the defaults emitted by `/api/iap/config` and must match the store consoles exactly.

| SKU | Apple product ID | Google product ID | Price |
|---|---|---|---|
| Premium monthly | `cpoint_premium_monthly` | `cpoint_premium_monthly` | existing Premium monthly price |
| Community L1 monthly | `cpoint_community_l1_monthly` | `cpoint_community_l1_monthly` | EUR 49.99 |
| Community L2 monthly | `cpoint_community_l2_monthly` | `cpoint_community_l2_monthly` | EUR 99.99 |
| Community L3 monthly | `cpoint_community_l3_monthly` | `cpoint_community_l3_monthly` | EUR 189.99 |
| Steve Community Package monthly | `cpoint_steve_community_monthly` | `cpoint_steve_community_monthly` | match KB `paid_steve_package_price_eur_monthly` (e.g. EUR 49.99) |

Production grants stay behind the KB field `iap_purchases_enabled=false` until store review is approved. Flip it in production only after TestFlight / Play internal testing and App Review approval.

**Steve add-on:** use a **separate** App Store subscription group (not Premium or Community). The app passes `community_id` on confirm so the grant attaches to the correct root community. Web checkout for Steve remains available via Stripe when KB Stripe price IDs are set.

## App Store Connect

1. Create or confirm one Premium subscription group with product ID `cpoint_premium_monthly`.
2. Create one Community subscription group with three ranked subscriptions:
   - `cpoint_community_l1_monthly` at EUR 49.99
   - `cpoint_community_l2_monthly` at EUR 99.99
   - `cpoint_community_l3_monthly` at EUR 189.99
3. Create a **Steve Community** subscription group (separate from steps 1–2) with one auto-renewable subscription:
   - Product ID: `cpoint_steve_community_monthly` (must match KB `paid_steve_package_apple_product_id`)
   - Price: align with KB Steve package monthly price
   - Review notes: optional add-on for **paid** community owners; user picks which community before purchase
4. Add review screenshots for the in-app subscription screen, community tier picker, and Steve add-on flow (community picker → subscribe).
5. Set App Store Server Notifications V2 URL to `https://cpoint-app-739552904126.europe-west1.run.app/api/webhooks/apple` (or `https://app.c-point.co/api/webhooks/apple` if routed).
6. Use sandbox testers to verify Premium, Community L1, L1→L2 upgrade, **Steve add-on on a paid root community**, restore purchases, and the extra-community web-link modal.

## Google Play Console

1. Create a Premium subscription product `cpoint_premium_monthly`.
2. Create Community subscription products or base plans matching:
   - `cpoint_community_l1_monthly` at EUR 49.99
   - `cpoint_community_l2_monthly` at EUR 99.99
   - `cpoint_community_l3_monthly` at EUR 189.99
3. Create subscription `cpoint_steve_community_monthly` (separate product; KB `paid_steve_package_google_product_id`).
4. Add license testers and include the products in an internal testing release.
5. Configure RTDN Pub/Sub push delivery to `https://cpoint-app-739552904126.europe-west1.run.app/api/webhooks/google`.
6. Verify Premium, Community L1, L1→L2 upgrade, Steve add-on, restore purchases, and the extra-community web-link modal.

## Mobile UX Policy

Native apps use Apple IAP or Google Play Billing for Premium and the first community subscription per store account. Additional communities are upgraded on `https://app.c-point.co/subscription_plans`, opened as an external web billing link.

## Backend verification (production)

Cloud Run **`cpoint-app`** must have:

| Secret / env | Purpose |
|--------------|---------|
| `APPLE_IAP_KEY_ID`, `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_PRIVATE_KEY` | App Store Server API + ASSN2 JWS verify |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Play Developer API subscription lookup |
| `GOOGLE_PLAY_PACKAGE_NAME` | Optional override (default `co.cpoint.app`) |

Confirm/restore and webhooks reject forged tokens when `iap_purchases_enabled=true` (sandbox/license-test still allowed without store credentials).

Full launch sequence: **`docs/release/LAUNCH_CHECKLIST.md`**.
