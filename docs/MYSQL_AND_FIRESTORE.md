# MySQL & Firestore data model

> **Living doc:** When tables, collections, or read/write paths change—update this file in the **same PR**; see **`AGENTS.md` § Living engineering docs**.

Authoritative **MySQL** DDL is scattered across `bodybuilding_app.py` (legacy `ensure_tables`), `init_database.py`, migration scripts at repo root, and `ensure_*` helpers in `backend/services/` & `backend/blueprints/group_chat.py`. Production uses **MySQL** (`USE_MYSQL` in `backend/services/database.py`); SQLite-shaped branches exist for local/test.

**Firestore** (`FIRESTORE_DATABASE`, default `cpoint`) mirrors social + Steve profile data for scale and realtime reads. Writes are best-effort after MySQL (`USE_FIRESTORE_WRITES`); reads can prefer Firestore (`USE_FIRESTORE_READS`).

Regenerate route × usage inventory: `python scripts/generate_route_inventory.py` → `docs/BACKEND_ROUTES.md`.

---

## 1. Firestore — collections & document shapes

Database name: env `FIRESTORE_DATABASE` (default **`cpoint`**).

| Collection | Document ID | Subcollections | Purpose |
|------------|-------------|----------------|---------|
| **`dm_conversations`** | `userA_userB` (lowercase sorted usernames; legacy ID variants supported) | **`messages`** (`message_id`) | DM threads: participants, last_message, per-message text/media/audio, reactions, encryption flags. Optional thread-summary fields: `steve_thread_summary`, `steve_thread_summary_msg_count`, `steve_thread_summary_through_ts` (written by `steve_thread_memory.py` when `thread_summary_enabled`). Synced from MySQL chat. Readers: `firestore_reads.get_dm_messages`. |
| **`group_chats`** | `group_id` (string) | **`messages`** | Group chat message bodies + metadata; optional presence/updates on parent doc. Optional thread-summary fields: `steve_thread_summary`, `steve_thread_summary_msg_count`, `steve_thread_summary_through_ts` (written by `steve_thread_memory.py` when `thread_summary_enabled`). |
| **`posts`** | Community post: numeric `post_id`; group post: **`gp_{post_id}`** | **`replies`**, **`reactions`** (reactor username doc id) | Feed/group posts, nested replies, reaction tallies. Dual-write from community/group APIs. |
| **`steve_user_profiles`** | `username` | — | Steve analysis, profiling blobs (`profilingPlatformActivity`, etc.), onboarding merge (`onboardingIdentity`), `recentRecommendations`, embeddings-related fields. Written by `firestore_writes`, read for networking/admin. |
| **`steve_knowledge_base`** | Chunked docs per user (e.g. `{username}_Index`, `{username}_Identity`, dimension shards) | — | Retrieved knowledge for Steve RAG (`steve_knowledge_base.py`). |
| **`steve_community_memory`** | root community id as string | optional **`episodes`** | Compact community memory for feed Steve (`currentSummary`, topics, important docs/links, active decisions). MySQL remains canonical for posts/docs/events/polls; Firestore is synthesized prompt memory only. |
| **`steve_community_memory`** | root community id as string | optional **`episodes`** | Compact community memory for feed Steve (`currentSummary`, topics, important docs/links, active decisions). MySQL remains canonical for posts/docs/events/polls; Firestore is synthesized prompt memory only. |
| **`steve_doc_memory`** | exact scope key: `community:{id}` or `group:{id}` | **`docs/{doc_id}/chunks/{chunk_id}`** | Steve document memory for uploaded PDFs. MySQL `useful_docs` remains authoritative for ownership/scope; Firestore stores extraction status, summaries, outline/topics, page chunks, token estimates, and optional embeddings for scoped retrieval (`steve_document_memory.py`). |
| **`steve_chat_memory`** | exact thread scope key: `dm:{conv_id}` or `group:{group_id}` | planned **`chunks/{chunk_id}`**, planned **`events/{event_id}`** | Phase 3 Steve chat-memory sidecar for long DMs/group chats. PR 1 only adds config/scope/format helpers (`steve_chat_memory.py`); no writes, embeddings, retrieval, or event extraction run yet. Future chunks/events are personal data and must never cross scope keys. |
| **`steve_onboarding`** | `username` | — | Onboarding state: `stage`, `collected`, conversation messages (`onboarding_session.py`, `onboarding.py` blueprint). Reminder sweeps read collection. |

**Environment:** `GOOGLE_CLOUD_PROJECT` / `GCP_PROJECT`; toggles `USE_FIRESTORE_READS`, `USE_FIRESTORE_WRITES`.

---

## 2. MySQL — table inventory (high level)

> **Not** a full `SHOW CREATE TABLE` dump — too large for docs. Use production **read replica** or export (`mysqldump --no-data`) when you need exact column types.

### Core social & identity

| Table | Defined / ensured in | Role |
|-------|----------------------|------|
| `users` | `bodybuilding_app.py` (init), `init_database.py`, `backend/services/user_trial.py` (`trial_revoked_at`), `backend/services/user_locale.py` (`preferred_locale`), `backend/services/user_age_gate.py` (`age_confirmed_at`, `age_consent_given`, `underage_delete_scheduled_at`), `backend/blueprints/auth.py` (`google_id`, `apple_id`) | Accounts, credentials, profile fields. **`google_id`** / **`apple_id`** (VARCHAR(191) UNIQUE NULL on MySQL): stable OAuth subject IDs for Google Sign-In and iOS Sign in with Apple; auth first looks up these IDs, then cautiously links by canonical email when the provider supplies a signed email claim. **`trial_revoked_at`** (DATETIME NULL): when set (admin **End trial**), entitlements skip the signup trial tier regardless of account age; see `POST /api/admin/users/<username>/trial/revoke` in **`BACKEND_ROUTES.md`**. **`preferred_locale`** (VARCHAR(16) NULL): explicit user language choice from Account Settings (`en`, `pt-PT`, …). When NULL the server resolves locale from `X-CPoint-Locale` / `Accept-Language`. Read/write only via `backend/services/user_locale.py`; see `GET/PATCH /api/me/locale` in **`BACKEND_ROUTES.md`** and **`docs/I18N_ROADMAP.md`**. **Age gate (Option A — no DOB stored):** **`age_confirmed_at`** (DATETIME NULL), **`age_consent_given`** (TINYINT(1) NULL; `1` = confirmed 18+, `0` = declared under 18), **`underage_delete_scheduled_at`** (DATETIME NULL; purge due when `<= NOW()`, 7-day grace). Read/write via `backend/services/user_age_gate.py`; `POST /api/me/age-confirmation` in **`BACKEND_ROUTES.md`**. Legacy profile fields **`date_of_birth`** / **`age`** are unrelated to the gate. **`professional_cv_r2_key`**, **`professional_cv_uploaded_at`**, **`professional_cv_original_filename`**: last CV PDF stored privately in R2 (key + metadata); download/authenticated access via **`GET /api/profile/cv`**. |
| `user_profiles` | `add_user_profiles_table.py`, monolith | Extended profile. |
| `communities` | `init_database.py`, monolith | Community rows, hierarchy. |
| `user_communities` | monolith | Membership + roles. |
| `posts`, `post_views` | `init_database.py`, `post_views.py` | Feed posts + view counts. |
| `replies`, `reactions`, `reply_reactions` | `init_database.py` | Threading and emoji reactions. |
| `followers` | monolith | Follow graph. |
| `messages` | `init_database.py`, monolith | DM storage (primary); Firestore mirrors. Columns include media paths, `client_key` for optimistic/idempotent sends, and **`file_path` / `file_name`** for PDF attachments (`dm_chats_tables.ensure_messages_document_columns`). **FULLTEXT index `ft_message`** on `message` column for per-thread keyword search (`dm_chats_tables.ensure_fulltext_search_indexes`). |
| `chat_upload_sessions` | `chat_uploads.ensure_tables` | Resumable multipart upload sessions: owner, DM/group context, R2 `object_key` + multipart `upload_id` (VARCHAR 512), expected bytes, status, expiry. Client outbox stores matching session metadata and completed part numbers for foreground resume; janitor: `/api/cron/chat-uploads-janitor`. |

#### Age gate columns on `users` (Option A — **`backend/services/user_age_gate.py`**)

Compliance memo: **`docs/COMPLIANCE_AGE_GATE.md`**. Columns are added idempotently by **`ensure_age_gate_columns()`** (same pattern as `user_trial.ensure_trial_columns()`). **No DOB or birth year** is stored for the gate.

| Column | Type | Owner writes | Semantics |
|--------|------|--------------|-----------|
| **`age_confirmed_at`** | `DATETIME NULL` | `confirm_age_gate(..., confirmed=True)` | UTC when user self-declared 18+ |
| **`age_consent_given`** | `TINYINT(1) NULL` | confirm / schedule paths | `1` = confirmed 18+; `0` = declared under 18; `NULL` = unanswered |
| **`underage_delete_scheduled_at`** | `DATETIME NULL` | `schedule_underage_deletion` | Purge due when `<= NOW()`; set to `now + 7 days` on underage path |

**HTTP:** `POST /api/me/age-confirmation` (`backend/blueprints/me.py`) → **`user_age_gate.confirm_age_gate`**. **Cron:** `POST /api/cron/purge-underage` → **`purge_due_underage_accounts`** → **`account_deletion.delete_user_in_connection`**. Status reads: **`get_age_gate_status`**. Legacy **`date_of_birth`** / **`age`** profile columns are **not** written by this service.

### Group chat & DMs (SQL)

| Table | Role |
|-------|------|
| `group_chats`, `group_chat_members`, `group_chat_messages` (incl. **`file_path` / `file_name`** for PDFs, **FULLTEXT index `ft_message_text`** on `message_text` for per-thread keyword search), `group_message_reactions`, `group_chat_read_receipts`, `group_chat_presence`, `steve_suppressed_topics` | Group chat + Steve-in-group (`group_chat` blueprint + monolith). |

Also: **`groups`** (optional **`steve_agent_enabled`**, **`steve_agent_preset`**, **`steve_proactive_enabled`**), **`group_members`**, **`group_posts`** (optional **`ask_steve`**, **`auto_steve_used_count`**, **`agent_cap_notice_shown`**), **`group_steve_agent_schedule`** (delayed first Steve reply; `bodybuilding_app.ensure_tables`), **`group_post_views`** (group post view counts; not community `post_views` / `posts` FK), **`group_replies`**, **`group_reply_views`** (per-viewer counts for thread UI; not the community `reply_views` table), reaction tables, **`group_community_key_posts`**, **`group_user_key_posts`** (created/ensured from `backend/blueprints/group_feed.py` + monolith `ensure_tables` in `bodybuilding_app.py`). HTTP: **`group_feed`** blueprint (photos, key posts, group post/reply view APIs, reply delete — not group chat). Steve **group agent:** **`docs/STEVE_GROUP_AGENT.md`**, cron **`/api/cron/group-steve-agent-due`**.

**Group post polls (optional feed payloads):** **`group_polls`**, **`group_poll_options`**, **`group_poll_votes`** — DDL in `backend/services/group_polls_data.py` (`ensure_group_poll_tables`). On MySQL, the deferred startup thread runs this after `add_missing_tables()` in `bodybuilding_app.py` so staging/prod get tables without waiting for a feed hit. Manual repair (Cloud SQL): use the same three `CREATE TABLE` statements as in `ensure_group_poll_tables` (MySQL branch). The group feed treats missing poll tables as **no polls** (HTTP 200) and logs the error.

### Billing & subscriptions

| Table | Role |
|-------|------|
| `users` billing columns | Personal subscription state (`stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `current_period_end`, `cancel_at_period_end`, `canceled_at`, `subscription_provider`, `stripe_mode`) owned by `backend/services/user_billing.py`; `/api/me/billing` renders this as the canonical Billing summary, with a live Stripe email fallback only when the stored row is stale or in the wrong Stripe mode. |
| `communities` billing columns | Community tier + add-on subscription state (`stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `billing_provider`, `stripe_mode`, `current_period_end`, plus `steve_package_*`) owned by `backend/services/community_billing.py`; Stripe portal routes use `stripe_mode` to block test/live Customer Portal mismatches. |
| `iap_links` | Apple / Google purchase link table. Keyed by `(provider, purchase_key)` where `purchase_key` is Apple original transaction ID or Google purchase token. Stores `username`, `sku`, optional `community_id`, `tier_code`, `product_id`, `status`, `environment`, and `expires_at`; used by confirm/restore endpoints and store webhooks to mutate `users` / `communities` idempotently. |
| `subscription_invoice_payments`, `subscription_audit_log` | Paid Stripe invoice ledger and audit (`subscription_billing_ledger.py`, `subscription_audit.py`). `subscription_invoice_payments` powers Account Settings → Payment history for personal Premium and root communities the user owns; owner resolution uses subscription id first, then customer id and invoice email/metadata for reconciliation/backfill cases. |
| `user_enterprise_seats` | Enterprise seat tracking (`enterprise_membership.py`). |
| `enterprise_iap_nag` | IAP nag state (`enterprise_iap_nag.py`). |
| `winback_tokens` | Win-back promo (`winback_promo.py`). |

### AI usage & entitlements

| Table | Role |
|-------|------|
| **`ai_usage_log`** | **Required** for every AI/Whisper call — `ai_usage.ensure_tables()`. Columns include `credits_debited` (weighted Steve allowance) and `credits_meta` (JSON breakdown). |
| `special_access_log` | Overrides (`special_access.py`). |

### Knowledge base (admin)

| Table | Role |
|-------|------|
| `kb_pages`, `kb_changelog` | Internal KB seeds + changelog (`knowledge_base.py`). |

### Notifications & push

| Table | Role |
|-------|------|
| `notifications` | In-app rows. |
| `fcm_tokens`, `native_push_tokens`, `push_subscriptions`, `push_send_log` | FCM / web push / delivery logs. |
| `remember_tokens` | Long-lived login (`remember_tokens.py`). |

### Community extras

| Table | Role |
|-------|------|
| `community_stories`, `community_story_*` | Stories (`community_stories.py`). |
| `community_invitations` | Invites. |
| `community_lifecycle_notifications` | Grace / lifecycle emails (`community_lifecycle.py`). |
| `community_media_assets` | Accounting (`media_assets.py`). |
| `tasks` | Community tasks (`tasks.py`). |
| `calendar_events` | Calendar (`add_calendar_table.py`, calendar routes). |

### Steve / networking (SQL)

| Table | Role |
|-------|------|
| `steve_chat_sessions`, `steve_chat_messages` | Networking / Steve session history in SQL. |
| `steve_recommendation_feedback` | Feedback on recommendations. |
| `steve_reminder_vault`, `steve_reminder_draft` | Reminder vault (`steve_reminder_vault.py`). |
| `steve_feedback_items`, `steve_feedback_events` | Feedback queue (`steve_feedback.py`). |
| `imagine_jobs` | Image/gen jobs. |

### Gym / workout legacy

Many **`exercises`**, **`workouts`**, **`workout_exercises`**, **`exercise_sets`**, **`crossfit_entries`**, etc. — see `bodybuilding_app.py` `CREATE TABLE` blocks.

### Misc

| Table | Role |
|-------|------|
| `key_posts`, `community_key_posts` | Pinned posts. |
| `product_posts`, `product_replies`, `product_polls`, `product_poll_votes` | Product-area feed. |
| `useful_links`, `useful_docs`, `community_files`, `community_announcements` | Resources; `useful_*` rows with `group_id` set are listed **only** in group context (`get_links` + `group_id`), not merged with community-wide (`group_id` null) rows. `useful_docs.description` is the required document **Name** and `useful_docs.details` is the optional user-facing **Description**. `useful_docs` is also the MySQL source of truth for Steve doc memory indexing; `/upload_doc` best-effort indexes the committed row into Firestore, and `scripts/backfill_steve_document_memory.py` backfills existing rows. |
| `university_ads` | Ads. |
| `archived_chats`, `deleted_chat_threads` | DM UX (`dm_chats_tables.py`). |
| `typing_status`, `encryption_*` | Typing / E2E helpers. |
| `password_reset_tokens`, `pending_signups` | Auth flows. |
| `api_usage`, `saved_data` | Legacy counters / saved blobs. |
| `user_login_history`, `community_visit_history` | Analytics (`user_activity_tables.py`). |
| `site_settings` | Key/value (`branding_assets.py`). |
| `about_tutorial_videos` | About page videos (`about_tutorials.py`). |
| `community_media_assets` | Media accounting. |
| `user_muted_chats`, `user_muted_communities` | Mutes. |
| `active_chat_status`, `recent_post_tokens`, `recent_reply_tokens` | Realtime-ish helpers. |
| `poll_notification_log` | Poll fanout dedupe. |

---

## 3. Operational notes

- **Schema changes:** Prefer adding `ensure_*` in the owning service and running migration in deploy — same pattern as `register_blueprints` bootstraps billing tables.
- **Source of truth:** For billing amounts, Stripe price IDs, mobile product IDs, `iap_purchases_enabled`, and product rules, **in-app KB** still wins (`AGENTS.md`). These tables hold **operational** data only.
- **Billing ownership:** `backend/services/billing_ownership.py` reconciles existing `users` billing columns, `communities` billing columns, and `iap_links` rows. No separate ownership table exists in v1; active provider and mode are derived from those operational rows.
- **Firestore costs:** Driven by read/write volumes on `dm_conversations`, `group_chats`, `posts`, `steve_user_profiles`, and `steve_doc_memory` (PDF chunks/embeddings are written once per upload/backfill, then read during Steve document retrieval). `steve_chat_memory` is reserved for future scoped chat chunks/events and is disabled/no-write in PR 1. Steve context reads are bounded: `ORDER BY created_at DESC LIMIT N` where N = `max_context_messages` (200) or `max_context_messages_peer_dm` (60), so reads are O(cap) per turn, not O(thread length).

---

*Update this file when adding collections or materially new SQL tables.*
