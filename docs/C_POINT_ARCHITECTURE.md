# C-Point application architecture

Single reference for repository layout, HTTP surface, backend services, dependencies, external APIs, and supplier/cost mapping.  
**Product policy / pricing truth** remains in the in-app Knowledge Base (`backend/services/knowledge_base.py`); this document is **engineering structure** only.  
**Maintenance:** When you change integrations, major services, or doc inventory—update this file in the **same change**; see **`AGENTS.md` § Living engineering docs**.

| Detailed doc | Contents |
|--------------|----------|
| [`BACKEND_ROUTES.md`](BACKEND_ROUTES.md) | **Every HTTP route** (28 blueprints + `bodybuilding_app.py` monolith): path, methods, Flask handler, source line, **best-effort** “where used” in `client/src` & `admin-web/src`. Regenerate: `python scripts/generate_route_inventory.py`. |
| [`MYSQL_AND_FIRESTORE.md`](MYSQL_AND_FIRESTORE.md) | **Firestore** collections/doc IDs and **MySQL** table inventory (where DDL lives). Not a full `mysqldump`; use DB export for exact columns. |
| [`DEPLOYMENT_INSTANCES.md`](DEPLOYMENT_INSTANCES.md) | **GCP** project, Cloud Run service names (`cpoint-app`, `cpoint-app-staging`, `cpoint-admin`, `cpoint-landing`), `run.app` URLs, how staging differs from prod, and what people mean by “cpoint-web” (client host, not a service name). |
| [`PROD_CLOUD_RUN_RECOVERY.md`](PROD_CLOUD_RUN_RECOVERY.md) | **Prod outage runbook** when staging works but `app.c-point.co` fails (secrets, smoke scripts). |
| [`PRODUCT_JOURNEYS.md`](PRODUCT_JOURNEYS.md) | Short **cross-system** narratives: Stripe → webhooks → entitlements, Steve/`ai_usage`, enterprise seats, crons, onboarding, DM/group storage paths. |
| [`MONOLITH_REDUCTION_ROADMAP.md`](MONOLITH_REDUCTION_ROADMAP.md) | **Engineering** initiative: shrink oversized UI pages and backend modules; priority order, epics, Cursor rules; pairs with KB **Product Roadmap** “Monolith reduction” rows. |
| [`AGENT_TASK_CHECKLIST.md`](AGENT_TASK_CHECKLIST.md) | Checklist for agents before merge: blueprints, `ai_usage`, KB, route/schema doc regen. |
| [`STEVE_GROUP_AGENT.md`](STEVE_GROUP_AGENT.md) | **Group-feed Steve agent** (Career Expert v1): package gate, Ask Steve, delayed cron, auto budget, pool usage. |
| [`COMPLIANCE_AGE_GATE.md`](COMPLIANCE_AGE_GATE.md) | **18+ age gate (Option A):** timestamp-only storage, `user_age_gate` service, `/api/me/age-confirmation`, `/api/cron/purge-underage`, 7-day underage retention. |

---

## 1. Runtime overview

| Layer | Technology | Location |
|-------|------------|----------|
| Web API | Flask 2.x | `bodybuilding_app.py` + `backend/blueprints/` |
| Business logic | Python services | `backend/services/` |
| Primary DB | MySQL (PyMySQL) | `backend/services/database.py`, migrations implicit in services |
| Cache | Redis Cloud — Essentials 256 MB, europe-west1 | `redis_cache.py` (repo root) |
| Realtime / legacy mirror | Google Firestore | `firestore_reads.py`, `firestore_writes.py` |
| Web + mobile shell | React (Vite) + Capacitor | `client/` |
| Internal admin UI | React (Vite) | `admin-web/` |
| Marketing site | separate Vite app | `landing/` |
| Object storage | Cloudflare R2 (S3 API) | `backend/services/r2_storage.py` |
| Public build edge | Cloudflare Workers + R2 binding | `services/public-builds-worker/` |
| Container build / deploy | Docker + Cloud Build → Cloud Run | `Dockerfile`, `cloudbuild.yaml` |

**Redis connection budget.** The cache runs on **Redis Cloud Essentials 256 MB** (europe-west1), whose ceiling is a **256-connection limit** — not memory. It was upgraded **2026-06-13** from the 30 MB / 30-connection tier, whose tiny ceiling was tripped by Cloud Run autoscaling (and by old+new revisions overlapping during a deploy), firing recurring *"connections limit reached"* alerts. To stay under the ceiling, each process serves Redis from one **bounded `BlockingConnectionPool`** (`redis_cache.py`): cluster-wide connections ≈ `REDIS_MAX_CONNECTIONS` (default **8**) × live Cloud Run instances. Tune `REDIS_MAX_CONNECTIONS` / `REDIS_POOL_TIMEOUT` via env vars — do not remove the pool bound. If connection alerts ever return, lower the per-instance cap or `--max-instances` before considering a bigger plan.

The cap (8) equals the gunicorn thread count (`Dockerfile` runs `--threads 8`), and the **same pool is also drawn by ~12 background daemon threads** (imagine-job executor, backfills, per-DM Steve typing heartbeats). So `REDIS_POOL_TIMEOUT` is kept **short (default 1s)**: under pool contention a *request* thread degrades to a fast cache-miss instead of stalling up to the timeout for a connection a background job holds. Only raise the cap and timeout *together*, and only with `--max-instances` headroom under the 256 ceiling. The client also **self-heals**: a connection failure disables it and it serves cache-misses, retrying `connect()` at most once per `REDIS_RECONNECT_COOLDOWN` (default 30s) — a transient blip never condemns a whole instance to no-cache for life, and we no longer downgrade a slow-ping instance to a non-shared in-memory cache (which would split cache coherence across instances).

**Rule (from `AGENTS.md`):** New HTTP routes go in `backend/blueprints/`; new logic in `backend/services/`. Do not add new symbols to `bodybuilding_app.py` except maintenance of legacy paths.

---

## 2. Entry points

| File | Role |
|------|------|
| `bodybuilding_app.py` | Flask app factory usage, ~100 legacy `@app.route` handlers, templates, Steve/DM hooks not yet migrated to blueprints. Very large; treat as legacy surface. |
| `backend/__init__.py` | `init_app()` → `register_blueprints()`, CLI registration for Steve welcome backfill. |
| `backend/blueprints/__init__.py` | Registers all blueprints; runs idempotent `ensure_tables()` for billing/community on startup. |
| `client/src/main.tsx` | SPA bootstrap. |
| `client/src/App` + `pages/*` | Route-level screens (React Router). |

---

## 3. Blueprints (`backend/blueprints/`)

Flask blueprints are registered **without** a global URL prefix; each route declares a full path (typically under `/api/...`).

| Module | Purpose |
|--------|---------|
| `public.py` | Unauthenticated routes (health, public config, push token registration, etc.). |
| `auth.py` | Login, logout, session, Google Sign-In / iOS Sign in with Apple, OAuth/email verification flows. |
| `onboarding.py` | Onboarding shell, stage APIs, debug helpers. |
| `notifications.py` | Notification feeds, preferences, cron-style notification work. |
| `communities.py` | Communities CRUD, dashboards, Stripe hooks for community billing, feeds. |
| `post_views.py` | Post view / impression accounting. |
| `content_generation.py` | Steve content-generation jobs (admin/community automation). |
| `group_chat.py` | Group chat HTTP API. |
| `admin_users.py` | Elevated admin user operations. |
| `knowledge_base.py` | Admin API for internal KB (seeds, pages, tests metadata). |
| `me.py` | `/api/me/*` profile, entitlements-related reads. |
| `steve_chat.py` | Steve DM preflight (`/api/steve/chat/preflight`). |
| `summaries.py` | Post/voice summaries (gated + logged). |
| `enterprise.py` | Enterprise seat purchase/lifecycle. |
| `subscription_webhooks.py` | **Stripe** webhooks (signature-verified). |
| `subscriptions.py` | User-facing subscription APIs (Checkout, portal, status). |
| `admin_subscriptions.py` | Admin reporting for subscriptions. |
| `billing_return.py` | Browser return URLs after Stripe Checkout. |
| `dm_chats.py` | DM thread list, unread, clear/delete. |
| `steve_feedback.py` | Steve feedback queue. |
| `community_stories.py` | Community stories feature API. |
| `community_invites.py` | Invite links / email / username flows, including read-only preview and explicit accept/decline routes. |
| `media_assets.py` | Media accounting / cleanup routes. |
| `chat_uploads.py` | Resumable multipart chat media upload sessions (R2). |
| `community_calendar.py` | Calendar & events API. |
| `steve_reminders.py` | Steve Reminder Vault API. |
| `platform_activity.py` | Aggregated activity digest (no private DMs). |
| `about_tutorials.py` | Public About page tutorials + admin video URLs. |
| `branding_assets.py` | Branding assets for onboarding surfaces. |

---

## 4. Backend services (`backend/services/`)

Grouped by domain. Each `.py` encapsulates DB/API/cache rules; blueprints and the monolith should call **services**, not embed SQL.

### Auth, session, security

| File | Role |
|------|------|
| `auth_session.py` | Session helpers, cache headers for auth responses. |
| `auth_helpers.py` | Shared auth checks. |
| `session_identity.py` | Identity resolution for requests. |
| `security.py` | Hardening helpers. |
| `remember_tokens.py` | Persistent login tokens table + validation. |
| `oauth_email_verification.py` | OAuth / email verification flows. |
| `email_normalization.py` | Canonical email forms. |
| `disposable_email.py` | Block disposable domains where applicable. |

### Database & platform

| File | Role |
|------|------|
| `database.py` | MySQL connections, `USE_MYSQL`, SQL placeholder helper. |
| `user_activity_tables.py` | Activity / visit logging tables. |
| `post_views.py` | Server-side post view model. |
| `platform_activity_digest.py` | Digest builder for `platform_activity` blueprint. |
| `admin_metrics.py` | Admin dashboard metrics computation. |
| `builder.py` | Steve Build creation service: artifact generation, async build jobs, private R2 artifacts, public website/app publishing metadata/manifests, community-scoped creation data, completion notifications, runtime/host-control policy. See [`STEVE_BUILD.md`](STEVE_BUILD.md). |
| `builder_feeds.py` | Steve Build public-data connector registry (`CPoint.data`): vetted keyless/free public sources, global caching, budgets, stale-while-revalidate, and circuit-breaker fallbacks for sandboxed creations. |
| `creation_runtime.py` | Steve Build brokered data runtime: safe shared JSON state, small structured collections, and append-only form submissions for generated websites/apps/games. Enforces normalized names, size limits, row caps, and optimistic versions behind host-authenticated builder routes. |
| `creation_match.py` | Steve Build two-player turn-based match service: seats, pending/active lifecycle, turn enforcement, optimistic versioning, move log, invite/cancel/decline/resign, and notification fan-out. |

### Entitlements & AI usage (revenue-sensitive)

| File | Role |
|------|------|
| `entitlements.py` | `resolve_entitlements(username)` — tier/KB/enterprise overlay. |
| `entitlements_gate.py` | Gate expensive AI operations. |
| `entitlements_errors.py` | Stable error payloads for UI. |
| `ai_usage.py` | **`ai_usage_log` writes**, monthly/daily counters, `log_usage` / `log_block`. |
| `feature_flags.py` | Feature toggles (e.g. entitlements enforcement). |
| `special_access.py` | Special-case overrides. |
| `whisper_service.py` | Gated Whisper wrapper; duration → usage logging. |
| `steve_model_config.py` | Official xAI Grok 4.3 pricing, KB-backed token caps, response usage extraction, and shared cost estimation for Steve surfaces. |
| `steve_prompt_policy.py` | Shared adaptive prompt policy for Steve: casual vs substantive modes, structured Markdown/bullets, internal reasoning guidance, and context-use heuristics. |
| `steve_tool_policy.py` | Intent + KB rules for when interactive Steve (feed, DM, group) passes Grok **`web_search` / `x_search`**: suppress for platform-manual and professional-advice-only turns; prefer platform KB for profile-style asks; enable for explicit phrases and **news_current_events** heuristics; KB **`external_search_explicit_only`** / **default web-X** / **`feed_attach_*`** channel kill-switches on **`SteveCommunityConfig`**. |

### Billing & subscriptions

| File | Role |
|------|------|
| `user_billing.py` | User-level Stripe/billing state. |
| `community_billing.py` | Community paid features, Stripe coupling. |
| `subscription_billing_ledger.py` | Ledger lines for audits. |
| `subscription_audit.py` | Audit helpers. |
| `community_subscription_changes.py` | Subscription change propagation. |
| `enterprise_membership.py` | Enterprise membership rules. |
| `enterprise_iap_nag.py` | In-app purchase / nag flows. |
| `winback_promo.py` | Win-back promotions lifecycle. |

### Community & social graph

| File | Role |
|------|------|
| `community.py` | Core community model, roles, trees, invalidation. |
| `community_lifecycle.py` | Grace/expiry and lifecycle crons support. |
| `community_group_feed.py` | Group feed aggregation. |
| `community_invites.py` | Invite business logic: pending-row creation, 7-day expiry, recipient checks, read-only preview, explicit acceptance before membership, and post-accept routing into Steve's pinned Introduce Yourself thread. |
| `community_invite_emails.py` | Email sending for invites. |
| `community_stories.py` | Stories. |
| `community_calendar.py` | Calendar domain logic. |
| `community_admin_notifications.py` | Admin-facing notifications. |
| `reactions.py` | Post/reply reactions. |
| `tasks.py` | Task list feature tables. |
| `steve_community_welcome.py` | Steve community welcome and cold-start system content: deterministic welcome cards, icebreaker polls, pinned introduce-yourself thread, owner DM, backfill CLI, and rolling welcome summary cron service. |

### DMs & messaging

| File | Role |
|------|------|
| `dm_chats_tables.py` | SQL tables for DM metadata. |
| `dm_chat_threads.py` | Thread operations. |
| `dm_human_thread.py` | Canonical DM keys vs Firestore. |
| `dm_unread.py` | Unread math. |
| `steve_dm_reply.py` | Steve DM reply pipeline. |
| `steve_dm_typing.py` | Typing indicators. |

### Firestore

| File | Role |
|------|------|
| `firestore_reads.py` | Read paths for DMs, group chat, posts, Steve profiles (dual-read). |
| `firestore_writes.py` | Complementary writes when mirroring. |
| `firebase_notifications.py` | FCM send helpers (with `firebase-admin`). |

### Push notifications

| File | Role |
|------|------|
| `notifications.py` | In-app notification rows, fan-out, preview text. |
| `native_push.py` | **APNs** / native push registration, environment keys. |

### Media & uploads

| File | Role |
|------|------|
| `media.py` | Upload allow-list, optimization, local paths, `save_uploaded_file`. |
| `media_processing.py` | Processing helpers. |
| `profile_pictures.py` | Case-insensitive batched avatar lookups (content tables may store a different username casing than `user_profiles`). |
| `media_assets.py` | Tracked media assets + cleanup. |
| `chat_uploads.py` | Resumable multipart upload session lifecycle + auth gates. |
| `r2_storage.py` | **Cloudflare R2** (S3) upload/delete; public URL mapping. |
| `branding_assets.py` | Branded assets metadata. |

### Knowledge & KB seeds

| File | Role |
|------|------|
| `knowledge_base.py` | KB seeds, pages, merge policy for admin + system seeds. |
| `steve_knowledge_base.py` | Steve-facing KB retrieval / merge. |
| `steve_platform_manual.py` | Platform manual slug for Steve. |

### Content generation & Steve automation

| File | Role |
|------|------|
| `content_generation/__init__.py` | Package export. |
| `content_generation/llm.py` | **Grok** via OpenAI-compatible client to `api.x.ai/v1`. |
| `content_generation/registry.py` | Job type registry. |
| `content_generation/job_schedule.py` | Scheduling windows. |
| `content_generation/permissions.py` | Who can run jobs. |
| `content_generation/storage.py` | Persisted outputs / state. |
| `content_generation/delivery.py` | Deliver generated content to feed/DM. |
| `content_generation/types.py` | Typed payloads. |
| `content_generation/ideas/*.py` | Individual generators (daily motivation, news roundup, etc.). |

### Steve product surfaces

| File | Role |
|------|------|
| `steve_content_enrichment.py` | Enrich text for Steve / sources metadata. |
| `steve_community_config.py` | KB-backed Steve Community package config: shared pool, provider ceiling, model overrides, context budgets, and package output cap. Model pricing delegates to `steve_model_config`. |
| `steve_community_memory.py` | Firestore compact community memory reader for community-feed Steve prompts. |
| `steve_document_memory.py` | Firestore-backed exact-scope PDF memory for Steve: indexes committed `useful_docs` rows, extracts page text, chunks/summarizes PDFs, stores optional embeddings, and retrieves scoped page/section chunks for feed/group turns. |
| `steve_resource_context.py` | Exact-scope Steve resource context builder (calendar, links, documents, polls) for community and group post replies; documents section prefers Firestore doc memory and falls back to legacy on-the-fly PDF text extraction. |
| `steve_feed_thread_context.py` | Feed/group post thread assembly for @Steve: fetches the most recent N comments, formats numbered thread + Steve prior-reply markers, char-budget trim. |
| `useful_links_read.py` / `useful_links_write.py` / `useful_docs_write.py` | Useful Links & Docs read/write services (community/group scoped). |
| `useful_resources_notify.py` / `community_access.py` | Member notifications on new community resources; membership/group gates for mutations. |
| `backend/blueprints/useful_resources.py` | HTTP routes for `/get_links`, `/add_link`, `/delete_link`, `/upload_doc`, `/rename_doc`, `/delete_doc`. |
| `steve_feedback.py` | Feedback queue backend. |
| `steve_community_welcome.py` | Welcome post backfill + Firestore mirror. |
| `steve_reminder_vault.py` | Vault storage. |
| `steve_reminder_slots.py` | Slot generation. |
| `steve_reminder_parse.py` | Natural-language reminder parsing. |
| `steve_profiling_snapshot.py` | Profile snapshot for Steve. |
| `steve_profiling_gates.py` | Gating logic for profiling. |
| `onboarding_bootstrap.py` | Onboarding flow bootstrap. |
| `onboarding_company_intel.py` | **Grok** company research during onboarding. |
| `onboarding_session.py` | Firestore-backed onboarding session. |
| `onboarding_reminders.py` | Scheduled onboarding nudges. |
| `onboarding_tier_hints.py` | Tier hint strings. |

### Networking (productized AI feature)

| File | Role |
|------|------|
| `networking_ai_config.py` | Model/config for networking. |
| `networking_prompting.py` | Prompt assembly. |
| `networking_planner.py` | Planner step. |
| `networking_retrieval.py` | Retrieval / context assembly. |
| `networking_debug_trace.py` | Debug trace for support. |
| `networking_directory.py` | Member directory: single-JOIN tree roster with a community-keyed short-TTL cache (membership gate runs per-request before the cache read; viewer excluded at serve time). |
| `networking_mentions.py` | Mention hygiene for Steve replies: bold-name→@username injection (unique names only), non-roster handle sanitizer, log-only wrong-name detector. Names shown to users are resolved client-side from the members endpoint, never from model prose. |
| `embedding_index_snapshot.py` | Cold-start accelerator: private R2 snapshot of the profile embedding index (keys + vectors). Loaded snapshot-first by networking (`/api/cron/refresh_embedding_index` rewrites it); Firestore stream remains the fallback and source of truth. |
| `networking_name_lookup.py` | Deterministic fast path: ultra-conservative classifier for "just a name lookup" messages (bare @handles, who-is templates, first-turn bare names; exact+unique resolution only). No Grok call → logs a zero-cost `networking_name_lookup` ai_usage row (distinct request_type keeps it out of the weekly cap) and records no recommendations. |

### Embeddings & search

| File | Role |
|------|------|
| `embedding_service.py` | **OpenAI embeddings**, FAISS / numpy similarity, Firestore vector index; reused by Steve document memory for optional PDF chunk embeddings. |
| `profile_structured_fields.py` | Structured profile fields used in discovery. |

### Misc

| File | Role |
|------|------|
| `account_deletion.py` | GDPR-style deletion pipeline. |
| `about_tutorials.py` | About/tutorial content service (mirrors `about_tutorials` blueprint). |

`__init__.py` under `content_generation/` and `ideas/` are package markers.

---

## 5. Client (`client/`)

- **`src/pages/`** — Route-level screens (timeline, communities, chat, onboarding, subscriptions, admin tooling, etc.).
- **`src/components/`** — Reusable UI; **`membership/ManageMembershipModal.tsx`** is canonical billing/AI usage UI per `AGENTS.md`.
- **`src/components/entitlements/`** — `useEntitlements` hook consumers, `LimitReachedBubble`, `LimitReachedModal`, `UsageWarningBanner`.
- **`src/chat/`** — DM/group chat UI, media send queue, audio.
- **`src/contexts/`** — `UserProfileContext`, badges, network state.
- **`src/utils/`** — Caching, push payload parsing, offline DB, Google identity helpers; iOS Apple auth uses the native Capacitor plugin directly from `MobileLogin`.
- **`src/services/`** — Client-side service modules (share import, etc.).
- **`src/hooks/useEntitlements.ts`** — Central entitlements fetching.

Capacitor native projects live under `client/ios` and `client/android` (see `.cursor/rules/ios-xcode-project.mdc` for iOS Xcode rules).

---

## 6. Admin (`admin-web/src/`)

Small React app for KB reseed, tests metadata, subscription admin helpers — calls same Flask API with admin auth.

---

## 7. Python dependencies (from `requirements.txt`)

| Package | Role |
|---------|------|
| Flask, Werkzeug | HTTP stack |
| requests | Outbound HTTP |
| stripe | Stripe SDK |
| python-dotenv | Env files |
| pywebpush | Web Push |
| firebase-admin | FCM |
| google-cloud-firestore | Firestore |
| cryptography | JWT / VAPID |
| redis | Cache client |
| PyMySQL | MySQL driver |
| Pillow | Images |
| openai | OpenAI API + compatible xAI base URL |
| numpy, faiss-cpu | Embeddings / ANN |
| boto3 | S3 → R2 |
| flask-compress | Compression |
| gunicorn | WSGI server |
| pypdf, trafilatura, youtube-transcript-api, dateparser | Ingest pipelines |

---

## 7a. Internationalization (i18n)

User-facing copy is keyed off JSON catalogs, not hard-coded in handlers. See [`I18N_ROADMAP.md`](I18N_ROADMAP.md) for the canonical engineering reference.

**Backend layout:**

| Module | Role |
|--------|------|
| `backend/services/i18n.py` | `t(key, locale, **params)` with the `pt-PT → pt → en` fallback chain; `Accept-Language` parsing; `match_locale` / `normalize_locale` helpers. |
| `backend/services/user_locale.py` | Sole owner of `users.preferred_locale`. `get_preferred_locale`, `set_preferred_locale` (with validation), `resolve_request_locale` (preferred → `X-CPoint-Locale` → `Accept-Language` → `en`). |
| `backend/services/api_errors.py` | Shared JSON error helper (`error_response`, `auth_required`, `forbidden`, `not_found`) that resolves locale from the current request and returns the backward-compatible `error` plus the new `error_code` / `message_key` / `message` fields. |
| `backend/services/notification_copy.py` | `recipient_locale(username)`, `push_payload(event, locale, **params)`, `in_app_text(event, locale, **params)`. Async surfaces (push, in-app rows) MUST resolve copy in the recipient's locale, never the sender's session. |
| `backend/services/entitlements_errors.py` | `build_error(..., locale=…)`: catalog overrides win over `_DEFAULT_TEMPLATES` for non-English locales; KB `cta_copy_templates` overrides apply only when `locale == "en"`. |
| `backend/services/community_invite_emails.py` | `render_existing_user_added_email`, `render_new_user_invite_email`, `invite_subject` — all accept a `locale` kwarg and pull subject / heading / lead / CTA from the `email.*` namespace. |
| `backend/locales/en.json`, `backend/locales/pt-PT.json` | Authoritative catalogs. Top-level namespaces: `common`, `errors`, `auth`, `entitlements`, `billing`, `communities`, `notifications`, `email`, `onboarding`, `chat`. |

**Schema:** `users.preferred_locale VARCHAR(16) NULL` (added idempotently by `ensure_locale_column`). `NULL` means "use the request-chain detection"; non-null is an explicit Account Settings choice.

**Routes:** `GET /api/me/locale` (returns saved + active locale + available list), `PATCH /api/me/locale` (`{"locale": "pt-PT"}` or `{"locale": null}` to clear).

**KB stays English.** Entitlements `cta_copy_templates` and any future KB-edited copy is ops-only — PT users always read from the JSON catalogs.

**Client layout:**

| Module | Role |
|--------|------|
| `client/src/i18n/index.ts` | Boots `react-i18next` with bundled catalogs, `LanguageDetector` (localStorage + navigator), and keeps `<html lang>` in sync. |
| `client/src/i18n/fetchHeaders.ts` | Monkey-patches `window.fetch` once at boot to attach `Accept-Language` + `X-CPoint-Locale` to every same-origin request. |
| `client/src/i18n/useLocale.ts` | Hook for the Account Settings language picker: flips `i18n.language` immediately and calls `PATCH /api/me/locale`. |
| `client/src/components/LocaleBootstrap.tsx` | Once-per-session GET `/api/me/locale` to adopt the saved choice as soon as the user is authed. |
| `client/src/locales/en.json`, `client/src/locales/pt-PT.json` | Authoritative client catalogs. Bundled (no http loader) so first paint never waits on the network. |

**Inventory:** `python scripts/i18n_inventory.py` (heuristic scan; `--strict <namespace>` for CI).

**Catalog drift CI:** `python scripts/i18n_check_catalogs.py` runs in `.github/workflows/test.yml` (job `i18n-catalogs`). Flattens every catalog under `backend/locales/` and `client/src/locales/`, diffs each locale against the `en` source of truth, and fails on missing / extra / drift.

---

## 8. NPM dependencies (summary)

- **client:** React 19, Vite, Capacitor ecosystem, react-query, react-router, tailwind, chart.js, testing libs — see `client/package.json`.
- **admin-web:** React + Vite + router + tailwind — see `admin-web/package.json`.
- **landing:** see `landing/package.json` if present for marketing.

Exact versions: lockfiles in each package.

---

## 9. External APIs & providers

| Direction | Provider | Usage |
|-----------|-----------|--------|
| Outbound | **xAI** (`api.x.ai`) | Grok — Steve, content gen, onboarding intel, networking (`XAI_API_KEY`) |
| Outbound | **OpenAI** | Whisper (`whisper-1`), embeddings (`OPENAI_API_KEY`) |
| Outbound | **Stripe** | Billing + webhooks |
| Outbound | **Cloudflare R2** (S3) | Media (`boto3`, env `CLOUDFLARE_R2_*`) |
| Outbound | **Google Firestore** | Social graph mirror |
| Outbound | **Firebase (FCM)** | Mobile push |
| Outbound | **Apple APNs** | Native iOS push |
| Outbound | **Web Push** | Browser notifications |
| Inbound | **Stripe webhooks** | Subscription events |
| Inbound | **Cloud Scheduler → HTTP** | Lifecycle crons (`X-Cron-Secret`) |

Environment variables are **not** listed here — check deployment secret store / `.env.example` if present.

---

## 10. Suppliers & cost structure (finance ops)

| Supplier | Typical cost model | Maps to engineering |
|----------|--------------------|---------------------|
| Stripe | % + per transaction; dispute fees | `stripe`, webhooks |
| OpenAI | Usage (audio minutes, tokens) | Whisper, embeddings |
| xAI | Usage (tokens) | Grok calls |
| Google Cloud | Cloud Run, GCR, Logging, Scheduler, Firestore | `cloudbuild.yaml`, Firestore SDK |
| Cloudflare | R2 storage/egress | `r2_storage.py` |
| Apple | Developer program; APNs included in ops overhead | `native_push.py` |
| MySQL host | Instance + I/O | `database.py` |
| Redis host | Instance | `redis_cache.py` |

**Fill actual euro/dollar amounts** from monthly invoices in `Suppliers & cost structure` in Notion (or your finance tool); this file stays **structure-only**.

---

## 11. Related docs

- `AGENTS.md` — agent + monetization rules.
- `docs/STEVE_AND_VOICE_NOTES.md` — AI surfaces, usage logging.
- `docs/cloud-scheduler-cron.md` — cron auth & endpoints.
- `docs/QA_CHECKLIST.md` — manual QA after sensitive deploys.

---

*Generated for engineering onboarding; update when adding blueprints/services.*
