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
| **`dm_conversations`** | `userA_userB` (lowercase sorted usernames; legacy ID variants supported) | **`messages`** (`message_id`) | DM threads: participants, last_message, per-message text/media/audio, reactions, encryption flags. Synced from MySQL chat. Readers: `firestore_reads.get_dm_messages`. |
| **`group_chats`** | `group_id` (string) | **`messages`** | Group chat message bodies + metadata; optional presence/updates on parent doc. |
| **`posts`** | Community post: numeric `post_id`; group post: **`gp_{post_id}`** | **`replies`**, **`reactions`** (reactor username doc id) | Feed/group posts, nested replies, reaction tallies. Dual-write from community/group APIs. |
| **`steve_user_profiles`** | `username` | — | Steve analysis, profiling blobs (`profilingPlatformActivity`, etc.), onboarding merge (`onboardingIdentity`), `recentRecommendations`, embeddings-related fields. Written by `firestore_writes`, read for networking/admin. |
| **`steve_knowledge_base`** | Chunked docs per user (e.g. `{username}_Index`, `{username}_Identity`, dimension shards) | — | Retrieved knowledge for Steve RAG (`steve_knowledge_base.py`). |
| **`steve_onboarding`** | `username` | — | Onboarding state: `stage`, `collected`, conversation messages (`onboarding_session.py`, `onboarding.py` blueprint). Reminder sweeps read collection. |

**Environment:** `GOOGLE_CLOUD_PROJECT` / `GCP_PROJECT`; toggles `USE_FIRESTORE_READS`, `USE_FIRESTORE_WRITES`.

---

## 2. MySQL — table inventory (high level)

> **Not** a full `SHOW CREATE TABLE` dump — too large for docs. Use production **read replica** or export (`mysqldump --no-data`) when you need exact column types.

### Core social & identity

| Table | Defined / ensured in | Role |
|-------|----------------------|------|
| `users` | `bodybuilding_app.py` (init), `init_database.py` | Accounts, credentials, profile fields. |
| `user_profiles` | `add_user_profiles_table.py`, monolith | Extended profile. |
| `communities` | `init_database.py`, monolith | Community rows, hierarchy. |
| `user_communities` | monolith | Membership + roles. |
| `posts`, `post_views` | `init_database.py`, `post_views.py` | Feed posts + view counts. |
| `replies`, `reactions`, `reply_reactions` | `init_database.py` | Threading and emoji reactions. |
| `followers` | monolith | Follow graph. |
| `messages` | `init_database.py`, monolith | DM storage (primary); Firestore mirrors. |

### Group chat & DMs (SQL)

| Table | Role |
|-------|------|
| `group_chats`, `group_chat_members`, `group_chat_messages`, `group_message_reactions`, `group_chat_read_receipts`, `group_chat_presence`, `steve_suppressed_topics` | Group chat + Steve-in-group (`group_chat` blueprint + monolith). |

Also: **`groups`**, **`group_*`** legacy product tables in monolith (see `CREATE TABLE` in `bodybuilding_app.py`).

### Billing & subscriptions

| Table | Role |
|-------|------|
| `user_billing`, `community_billing`-related columns | Stripe state (see `user_billing.py`, `community_billing.py`). |
| `subscription_billing_ledger`, `subscription_audit_log` | Ledger & audit (`subscription_billing_ledger.py`, `subscription_audit.py`). |
| `user_enterprise_seats` | Enterprise seat tracking (`enterprise_membership.py`). |
| `enterprise_iap_nag` | IAP nag state (`enterprise_iap_nag.py`). |
| `winback_tokens` | Win-back promo (`winback_promo.py`). |

### AI usage & entitlements

| Table | Role |
|-------|------|
| **`ai_usage_log`** | **Required** for every AI/Whisper call — `ai_usage.ensure_tables()`. |
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
| `useful_links`, `useful_docs`, `community_files`, `community_announcements` | Resources. |
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
- **Source of truth:** For billing amounts and product rules, **in-app KB** still wins (`AGENTS.md`). These tables hold **operational** data only.
- **Firestore costs:** Driven by read/write volumes on `dm_conversations`, `group_chats`, `posts`, and `steve_user_profiles`.

---

*Update this file when adding collections or materially new SQL tables.*
