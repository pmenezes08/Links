# Product journeys (cross-system flows)

> **Living doc:** When you materially change checkout, webhooks, AI gates, seat lifecycle, onboarding, or how chat data is stored/read—update this file in the **same PR**; see **`AGENTS.md` § Living engineering docs**.

Short narratives for **how behaviour spans** Flask, Stripe, MySQL, Firestore, crons, and clients. For **HTTP specifics**, grep [`BACKEND_ROUTES.md`](BACKEND_ROUTES.md); for **tables/collections**, see [`MYSQL_AND_FIRESTORE.md`](MYSQL_AND_FIRESTORE.md).

---

## 1. Subscription and Stripe

1. User starts checkout from the client; backend creates a **Stripe Checkout** session (`backend/blueprints/subscriptions.py` and related).
2. User completes payment on Stripe; **webhooks** hit **`backend/blueprints/subscription_webhooks.py`** (signature-verified). Events update MySQL (`users`, subscription rows) according to business rules.
3. Every gated API path resolves **effective access** via **`resolve_entitlements(username)`** in `backend/services/entitlements.py` — not from ad-hoc checks of the `users.subscription` column alone.

**Return URLs:** After Checkout, browser redirects use **`billing_return`** patterns so the SPA lands in a sane state.

---

## 2. Steve / AI usage and ledger

1. Client calls a **Steve or AI-related** endpoint (chat, summaries, voice pipeline, etc.).
2. **Gating** runs first: tier caps, KB-driven limits, specials, enterprise overlay — see **`docs/STEVE_AND_VOICE_NOTES.md`**. Use **`entitlements_gate`** / shared helpers; do not call **OpenAI / Grok / Whisper** directly from new code.
3. Successful paid work logs **`ai_usage.log_usage(...)`** with the correct **`surface`**; **blocked** attempts log via **`ai_usage.log_block(...)`** (`success=0`). The **revenue / usage dashboard** depends on this — no hand-inserted rows.

---

## 3. Entitlements resolution (single source of truth)

`resolve_entitlements()` overlays:

1. `users` row (subscription, `is_special`, account age, optional **`trial_revoked_at`**).
2. **Knowledge Base** pages (e.g. `user-tiers`, `credits-entitlements`, `hard-limits`, `special-users`) — editable in **admin-web** without redeploy.
3. **Enterprise seat** row in `user_enterprise_seats` when active.

**UI:** `ManageMembershipModal` / `useEntitlements` / limit modals — **`AGENTS.md`** — should stay consistent with server truth.

**Operator — end signup trial early:** From **admin-web → Users → Manage**, when the resolved tier is **trial**, an admin can **End trial** (requires a reason). That sets **`users.trial_revoked_at`** and writes **`subscription_audit_log`** with action **`trial_revoked_by_admin`**; **`resolve_entitlements`** then treats the account as **free** for tier purposes (Steve access follows free caps unless Premium / Special / Enterprise seat applies).

---

## 4. Community billing (paid tier per community)

Communities can have **Stripe-backed** billing separate from the user’s personal subscription. Paid tiers use one Stripe subscription on the community row (`stripe_subscription_id`); owners may add a **Steve Community Package**, stored as a **second** subscription (`steve_package_*` columns) so tier webhooks and Steve-package webhooks never overwrite each other. **Steve Community Package** usage in feed/group contexts can draw from a **shared monthly pool** on the billing root (`ai_usage_log.community_id` normalized to the root for Steve surfaces); see **`entitlements_gate.check_steve_access`** with `community_id` and **`docs/STEVE_AND_VOICE_NOTES.md`**. Flows live under **`backend/blueprints/subscriptions.py`**, **`subscription_webhooks.py`**, and related services.

### Subscription hub API (`GET /api/me/subscriptions`)

Single JSON contract for **Manage Membership**, **SubscriptionPlans**, and Steve checkout preflight alignment:

- **Personal:** `subscription_active`, `needs_attention`, `renewal_date_status`. Legacy field **`active`** is **healthy Premium / special only** — e.g. `past_due` Stripe status no longer counts as active for UI grouping.
- **Communities (billing roots the user owns):** `tier_subscription_active` (alias **`tier_subscription_live`**), `needs_attention`, `renewal_date_status`, **`steve_addon_eligible`**, **`steve_addon_reason`**, **`steve_addon_message`** (machine + human-readable Steve gate). Paid **tier label** alone is not “active subscription” without Stripe id + `active`/`trialing` + valid future renewal boundary (see **`backend/services/subscription_health.py`**).

### Manage Community → SubscriptionPlans deep links

From **Manage Community → Manage Subscription** (paid/customer state on the billing root):

- **Upgrade Community Tier:** `/subscription_plans?mode=choose&open=community_plans&community_id=<root_or_managed_id>`
- **Steve Community Package:** `/subscription_plans?mode=choose&open=community_addons&community_id=<id>` (Paid L1–L3 roots only in UI)
- **Cancel / payment methods:** `POST /api/me/billing/portal?community_id=<id>` with JSON `{ "return_path": "/community/<id>/edit" }` (same handler as other portal scopes — **`backend/blueprints/me.py`**)

### Steve Community Package pool display + gating

- Feed/group Steve calls must pass the current `community_id` into **`entitlements_gate.check_steve_access`** / **`gate_or_reason`** so free members can spend an active root community pool before seeing Premium CTAs. Client-side Steve preflight must not show a local Premium modal for community-scoped feed/post mentions; it should let the backend pool gate decide.
- Community post/reply composers that detect `@Steve` must call `POST /api/ai/steve_preflight` before saving content. If the backend returns an `entitlements_error`, the composer shows the Premium / cap modal and does **not** persist the post/reply; legacy `/post_status` and `/post_reply` also run the same save-time preflight guard.
- **Manage Community** reads `/api/communities/<id>/billing` and shows `steve_pool_cap`, `steve_pool_used`, and `steve_pool_remaining` when `steve_package_subscription_active` is true. Admin-web **KB → Communities** reads the same root-pool fields from `/api/admin/communities/directory` so operators can see active Steve package usage in the community detail modal. Pool usage comes from **`ai_usage_log.community_id`**, normalized to the billing root by **`ai_usage.log_usage`** for Steve surfaces. Personal Steve counters (`daily_count`, `monthly_steve_count`, and membership usage summaries) exclude community-attributed Steve rows so Premium members using a community pool do not spend personal allowance.
- **Steve Community config lives in KB** (`community-tiers` / `paid_steve_package` fields): package price, 200-call pool, hidden provider-cost ceiling, reservation amount, model, output cap, web/X policy, and context budgets. User-facing copy shows only the call pool; provider spend is operator-only.
- Community-feed Steve uses the same community-aware runtime whether the payer is the community add-on or a Premium member's personal allowance: Grok 4.3, no multi-agent, compact Firestore community memory, selective MySQL context, and web/X only when explicitly requested. The gate decides attribution before vendor spend: active add-on uses `community_id=<root_id>`; Premium personal fallback logs with `community_id=NULL`.
- The hidden provider-cost ceiling is enforced before community-pool spend using `ai_usage.monthly_community_spend_usd(root_id)` plus a KB reservation estimate. If the cost ceiling is exhausted, free members are blocked as pool exhausted; Premium members may fall back to personal usage when the KB fallback toggle allows it.
- Burger-menu visits to `/subscription_plans` stay generic. Focused single-community copy/actions only appear when Manage Community links include `community_id=<id>`.

### Stripe renewal repair (offline)

- **Audit:** `python scripts/sync_community_stripe_renewals.py --audit-only` — lists roots with a Stripe subscription id and `active`/`trialing` status but renewal classification not **`valid`** (missing/expired `current_period_end`).
- **Repair:** same script `--community-id <root_id>` or **`POST /api/admin/communities/<id>/billing/sync-stripe-renewal`** (optional `{ "dry_run": true }`) — calls Stripe **`Subscription.retrieve`** and writes through **`community_billing.mark_subscription`** (not invoked on hot reads).

### Staging QA — subscription billing repair

1. Paid community with **future renewal** → **Community — Active** on SubscriptionPlans “Active” tab; Steve picker enables checkout.
2. Paid tier row with **`current_period_end` missing** (but Stripe claims active) → **Needs Attention** only; Steve checkout blocked with reason **`renewal_date_missing`** and matching **`steve_addon_message`**.
3. Focused deep link with **`community_id`** + Steve flow shows **community name** and **exact backend reason** when ineligible.
4. Steve pool already active → **`steve_package_already_active`** / aligned copy.
5. Manage Community **Manage Subscription** modal buttons navigate with the query params above; portal opens for cancel when **`has_stripe_customer`** is true.

---

## 5. Enterprise seats

Purchasing and lifecycle routes are in **`backend/blueprints/enterprise.py`** with persistence in **`user_enterprise_seats`**. **Crons** (grace period, revoke, nags) run on a schedule — **`docs/cloud-scheduler-cron.md`** and **`docs/OPERATIONS.md`**. Any new lifecycle behaviour should remain **idempotent** and **secret-authenticated** on `/api/cron/*`.

---

## 6. Cron jobs and lifecycle

Cloud Scheduler POSTs to **`/api/cron/*`** on **`cpoint-app`** (or staging) with **`X-Cron-Secret`**. Full list, URLs, and secrets: **`docs/cloud-scheduler-cron.md`**.  
**Do not** use custom domains that **301** for Scheduler POSTs — use the **`run.app`** URL from **[DEPLOYMENT_INSTANCES.md](DEPLOYMENT_INSTANCES.md)** / cron doc.

---

## 7. Onboarding (Steve-guided setup)

Onboarding stages and APIs: **`backend/blueprints/onboarding.py`** plus services such as **`onboarding_bootstrap`**, **`onboarding_company_intel`**. **Firestore** collection **`steve_onboarding`** holds progressive state — see **`MYSQL_AND_FIRESTORE.md`**. Client navigates stages; backend enforces progression and ties into **Steve** where applicable.

---

## 8. Messaging: MySQL + Firestore

**DMs / group chat:** Canonical thread metadata and server rules in **MySQL**; **Firestore** is used for realtime-style reads/mirrors depending on feature — **`MYSQL_AND_FIRESTORE.md`**, **`group_chat`**, **`dm_chats`** in **`BACKEND_ROUTES.md`**. When debugging “message missing on one device”, check **both** stores and **which read path** the client uses.

---

## 9. Knowledge Base (in-app) vs team docs

- **In-app KB** (MySQL-seeded, admin editable): **pricing**, **caps**, **policies**, **roadmap rows** used by the product and Steve — **`knowledge_base.py`**, **admin reseed**.
- **Repo + Notion**: engineering topology, glossary, this journey doc — **not** a substitute for KB for price/cap truth.

---

## 10. Deploy smoke (staging → production)

1. Merge to **staging** branch / workflow; run **`cloudbuild.yaml`** → **`cpoint-app-staging`**.
2. Hit **staging** API and **admin-staging** against staging; remember **shared DB** risk (**OPERATIONS**).
3. Promote to prod via **`cloudbuild-production.yaml`** → **`cpoint-app`** only after checks — **`AGENTS.md`** discourages prod-first deploys.
