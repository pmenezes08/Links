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

1. `users` row (subscription, `is_special`, account age).
2. **Knowledge Base** pages (e.g. `user-tiers`, `credits-entitlements`, `hard-limits`, `special-users`) — editable in **admin-web** without redeploy.
3. **Enterprise seat** row in `user_enterprise_seats` when active.

**UI:** `ManageMembershipModal` / `useEntitlements` / limit modals — **`AGENTS.md`** — should stay consistent with server truth.

---

## 4. Community billing (paid tier per community)

Communities can have **Stripe-backed** billing separate from the user’s personal subscription. Flows live under **`backend/blueprints/communities.py`** and related services (Checkout, webhooks, dashboard). Treat **community** entitlements as their own Product journey when debugging “why can’t this coach enable feature X” — often **`stripe_account` / billing state**, not personal `users.subscription`.

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
