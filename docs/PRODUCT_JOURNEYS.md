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
3. Interactive Steve calls read KB-backed output/context caps from resolved entitlements and use **`steve_model_config`** for official xAI Grok 4.3 pricing/cost estimation. Prompt formatting comes from **`steve_prompt_policy`** so casual chat stays short while substantive answers use headings, bullets, recommendations, pitfalls, and next steps.
4. Successful paid work logs **`ai_usage.log_usage(...)`** with the correct **`surface`**, tokens, cost, model, and latency; **blocked** attempts log via **`ai_usage.log_block(...)`** (`success=0`). The **revenue / usage dashboard** depends on this — no hand-inserted rows.

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
- **Steve Community config lives in KB** (`community-tiers` / `paid_steve_package` fields): package price, 200-call pool, hidden provider-cost ceiling, reservation amount, model, output cap, web/X policy, and context budgets. User-facing copy shows only the call pool; provider spend is operator-only. Community-pool feed replies use the stricter of the user's resolved feed output cap and the package output cap.
- Community-feed Steve uses the same community-aware runtime whether the payer is the community add-on or a Premium member's personal allowance: Grok 4.3, no multi-agent, compact Firestore community memory, selective MySQL context, and **hosted `web_search` / `x_search`** when **`steve_tool_router.resolve_steve_hosted_tools`** attaches them: first **`steve_tool_policy.steve_tools_for_message`** (explicit browse phrasing, **news/sports/markets** heuristics from **`steve_prompt_policy`**, job/careers-site wording, or KB “default on” when **external search explicit only** is OFF); if that yields no tools, an optional **JSON-only tool-router** pass may attach hosted tools on **ambiguous public web / X** intent (skipped for platform-manual-only and professional-advice-only turns, profile-suppressed cohorts, `STEVE_TOOL_ROUTER_DISABLED`, logged as `request_type=steve_tool_router`). Profile / “who is @user” style asks stay **platform-first** (no external tools) unless the same message also requests live news. KB **`paid_steve_package_feed_attach_*`** can still disable either channel; **DM and group @Steve** read the same policy from **`SteveCommunityConfig`**. Platform-manual and professional-advice-only turns never attach tools. Logs record the effective tool list. The gate decides attribution before vendor spend: active add-on uses `community_id=<root_id>`; Premium personal fallback logs with `community_id=NULL`. **News-style** asks map to **`steve_prompt_policy` `news_current_events`** (structured briefing + headline Markdown sources + tier hygiene); **`steve-platform-manual` / `steve.what_can_i_do`** documents Steve capability boundaries for product questions. **@Mentioned** members (other than the asker) may receive gated Firestore profile blocks on feed/group replies per **`user_can_access_steve_kb`**.
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

Onboarding stages and APIs: **`backend/blueprints/onboarding.py`** plus services such as **`onboarding_bootstrap`**, **`onboarding_company_intel`**, **`onboarding_cv_import`** (optional **PDF CV** upload: **`POST /api/onboarding/parse_cv`** extracts text locally, Grok returns structured current role / company / `current_role_start_ym` / prior roles; with **`persist=1`** the PDF is stored in **private R2** under `private/cv/{username}/…` and **`users.professional_cv_*`** metadata is updated when storage succeeds). **`POST /api/onboarding/apply_professional_structured`** persists to **`users`** after the user confirms, with **`mode`** **`replace`** (work history from the CV list only) or **`merge`** (keep and dedupe prior **`professional_work_history`**, promoting the previous current role into history when role/company change). Signed-in users download the last stored file via **`GET /api/profile/cv`**. **Firestore** collection **`steve_onboarding`** holds progressive state — see **`MYSQL_AND_FIRESTORE.md`**. Client navigates stages; backend enforces progression and ties into **Steve** where applicable.

---

## 8. Messaging: MySQL + Firestore (incl. DM Media Pipeline)

**DMs / group chat:** Canonical thread metadata, rules, and `messages` table in **MySQL** (with `image_path`, `video_path`, `media_paths` JSON); **Firestore** (`dm_conversations/{conv_id}/messages`) is primary for realtime/paginated reads (see **`MYSQL_AND_FIRESTORE.md`**, `dm_chats` / `group_chat` routes in **`BACKEND_ROUTES.md`**). Dual-write is best-effort. Link previews integrate via `LinkPreview.tsx` (used in `MessageBubble.tsx` etc.); see below for full media flow.

**Group feed (posts/replies, not chat):** **`group_posts`** / **`group_replies`** live in **MySQL** only for this product surface. Access is **`group_feed_access.check_group_feed_access`** (group member, community owner/admin, app admin, group creator). HTTP includes the monolith group post routes plus **`backend/blueprints/group_feed.py`** (photos, key posts, reply delete). **`POST /api/ai/steve_reply`** with **`is_group_post`** uses **`SURFACE_GROUP`** and writes **`group_replies`** as Steve. New **group posts** and **group replies** fan out **in-app notifications** (`group_feed_post`, `group_feed_reply`) and **push** to other **`group_members`** with status **`member`**, skipping the author and honoring **`user_muted_communities`** for the parent **`community_id`**. Group posts may **show polls** with voting on the feed; **poll creation** is from the group polls page, not the post row. When the client opens **Useful Links & Docs**, **Tasks**, or **group calendar** with **`group_id`**, list endpoints return **only resources scoped to that group** (not community-wide rows for the same community).

### Steve group agent (exclusive group feed)

Optional **preset agent** on a group (v1: **Career Expert**): enabled only when the **Steve Community Package** is active on the billing root; **`POST /api/groups/create`** with the agent on inserts a **static** welcome **`group_posts`** row from @Steve (introduces the agent); **`POST /api/group_posts`** accepts **`ask_steve`** and may enqueue a **delayed** first reply (**`group_steve_agent_schedule`**); **`POST /api/cron/group-steve-agent-due`** ( **`X-Cron-Secret`** ) processes due rows; **`@Steve`** cancels the schedule and bypasses delay; **five** auto-budget replies per post, then a cap notice; consumption uses the **same** `ai_usage` community pool as other group Steve. **Exclusive group feed** Steve (`_steve_ai_reply_for_group_post`: member @Steve, Ask Steve, cron/thread automation) injects **group-scoped** resources (this group's calendar, links, document excerpts, group polls) and still **does not** load **parent-community** bundles (`_build_steve_community_context`). **`group_chats`** Steve is a separate surface and does not automatically get that exclusive-group resource block. See **`docs/STEVE_GROUP_AGENT.md`**.

### DM Media Upload → Storage → Read → Render Flow
**Complete cross-system map** (updated for R2 direct uploads, multi-media, caching layers, iOS paths). See focused files: `ChatThread.tsx`, `mediaSenders.ts`, `firestore_reads.py`, `media.py:save_uploaded_file`, `r2_storage.py`, `MessageImage.tsx`, `normalizeMediaPath` (in `chat/utils.ts` + duplicates), `bodybuilding_app.py` (monolith routes), `firestore_writes.py`.

#### 1. **Upload (Client → Backend)**
- `client/src/pages/ChatThread.tsx`: `pendingMedia`, `videoUploadProgress`, optimistic UI with `URL.createObjectURL(file)` (blob: URLs for previews), `idBridgeRef` (temp→server ID mapping to avoid flicker), device cache (`chatMessagesDeviceCacheKey`, IndexedDB `offlineDb`), iOS-specific: `Capacitor.getPlatform() !== 'ios'` keyboard listeners (`visualViewport`, `normalizeHeight` for viewport lift/scroll-to-bottom).
- `client/src/chat/mediaSenders.ts`:
  - Single-image GIF/photo still uses `POST /send_photo_message` (multipart).
  - Large single videos: presigned `PUT` via `/api/video_upload_url`, then `POST /send_video_message` with `video_url`.
  - **Multi-media:** parallel client uploads — images scaled via `compressImageForUpload` then `POST /api/message_image_upload_url` + presigned `PUT`; each video uses `/api/video_upload_url` + `PUT`; **`POST /send_dm_media`** sends ordered JSON `media_urls` only (no multipart blobs through Cloud Run), preserving collage order.
  - Sender-only **remove one attachment** from a collage (requires ≥2 server-side paths): `POST /api/chat/dm/remove_message_media` JSON `{ message_id, media_url }`.
  - Group multi-media mirrors DM using `/api/group_chat/:id/image_upload_url`, `/api/group_chat/:id/video_upload_url`, then `POST .../send_media` with `media_urls`; removal: `POST /api/group_chat/:id/remove_message_media`.
- Backend routes (still in monolith `bodybuilding_app.py:13411`—see **MONOLITH_REDUCTION_ROADMAP**):
  - `/send_photo_message`, `/send_video_message`, `/send_dm_media`: auth, block check, recipient lookup, `save_uploaded_file(...)`, insert to `messages` (with `media_paths=json.dumps(...)` for groups), **dual-write** to Firestore, notifications, push (skips if active_chat_status or muted).
  - `/api/video_upload_url` (`backend/blueprints/media_assets.py:56`): validates recipient, calls `_video_upload_payload("message_videos", ...)` → R2 presigned.

#### 2. **Storage (Dual + R2 + Cache Layers) — Thorough**
- `backend/services/media.py:159` (`save_uploaded_file` — core):
  ```python
  # Local first (uploads/message_photos/ or message_videos/)
  filepath = ...; file.save(filepath)
  # Optimize: PIL/exif for images (media_processing.optimize_image_file or fix_orientation_only), 
  # transcode_video_file for some videos (recent iOS support)
  if R2_ENABLED:
      success, r2_url = upload_to_r2(...)  # returns CDN URL or None
  saved_path = r2_url or f"uploads/{subfolder}/{unique_filename}"
  ```
  Handles MIME fallback for iOS cameras (no ext, quicktime/m4a/caf/webm), secure_filename, unique timestamp names. Returns R2 public URL preferentially.
- `backend/services/r2_storage.py`: boto3 S3-compatible (CLOUDFLARE_R2_* envs), `R2_ENABLED`, `generate_presigned_upload_url` (for large videos, 1hr expiry), `put_object` with `CacheControl='public, max-age=31536000'`, `get_r2_public_url`, `is_r2_url`. Bucket keys: `message_videos/name_YYYYMMDD_HHMMSS.mp4`. Fallback to local if R2 fails.
- **MySQL** (`messages` table): source-of-truth for IDs, paths (`image_path`, `video_path`, `media_paths` as JSON array of strings/URLs), sender/receiver/timestamp. See schema in `MYSQL_AND_FIRESTORE.md`.
- **Firestore** (`dm_conversations/{conv_id=lowercase_sorted_usernames}/messages/{mysql_id}` via `firestore_writes.write_dm_message:99` — best-effort, `conv_ref.set(merge=True)` for last_message): mirrors paths, `created_at` for pagination/queries (`get_dm_messages` uses timestamp >/< since/before). `_dm_conv_id` legacy fallback.
- **Caches**: 
  - Frontend: `readDeviceCache`/`cacheMessages` (localStorage + version/TTL=CHAT_CACHE_TTL_MS), IndexedDB (`dmConversationOfflineKey`, `getCachedMessages`), optimistic refs.
  - CDN/Edge: R2 Cache-Control + Cloudflare (CF Image Optimization layer).
  - Browser: HTTP cache on R2/CDN URLs; `optimizeMessagePhoto` avoids re-transform.
- **Local disk**: temp during upload/optimize; served via static mappings (`/uploads/*` → `uploads/` dir in Cloud Run config — see `DEPLOYMENT_INSTANCES.md`). Fallback if R2 disabled.

**Recent changes**: Multi-media `media_paths` persistence, R2 uploads for large videos, iOS MIME/ACL/CF optimizer, MessageImage preview retry, Capacitor Network for offline. **Final fix**: Restored isInitialized + navigator.onLine default + symmetric goOnline in NetworkContext (prevents cold-start ghost/offline banner); safe default in get_steve_user_profile + dashboard cache clear (eliminates ghost account/empty dashboard/profile load failure). Updated OfflineBanner, KB to completed, living docs. Stable on simulator/Xcode new builds. Matches AGENTS.md and PRODUCT_JOURNEYS native flow.

#### 3. **Reading in Threads**
- `ChatThread.tsx:674` (cache-first → `fetchMessagesAndProfile` → `processRawMessages:614` now normalizes `media_paths` (JSON.parse if string, array fallback), time/reactions/replies/storyReply; merges with local reactions/outbox and `media_paths: m.media_paths ?? existing?.media_paths` at ~1358).
- `backend/services/firestore_reads.py:88` (`get_dm_messages` primary; pagination via `since_id`/`before_id` using Firestore `created_at` queries + updated `_format_dm_message:60` which returns `media_paths` (with parse for robustness)):
  ```python
  def _format_dm_message(doc, username):
      d = doc.to_dict()
      media_paths = d.get('media_paths')
      if (typeof media_paths === 'string') ... # parse + list guard
      return { ..., 'media_paths': media_paths if Array.isArray... }
  ```
  Falls back to MySQL in some paths. `invalidate_message_cache` after writes (now includes multi-media). Group uses similar (full parity achieved).

#### 4. **Rendering (MessageImage/MessageBubble)**
- `client/src/chat/utils.ts:108` (`normalizeMediaPath` — critical for all paths):
  ```typescript
  export function normalizeMediaPath(path?: string | null): string {
    if (!path) return '';
    if (path.startsWith('http') || path.startsWith('blob:')) return path;
    if (path.startsWith('/uploads/') || path.startsWith('/static/')) return path;
    if (path.startsWith('uploads/')) return `/${path}`;
    return `/uploads/${path}`;  // bare paths from backend
  }
  ```
  Duplicated in some legacy pages (Followers, HomeTimeline, etc.) — risk of drift.
- `client/src/chat/MessageBubble.tsx:141`: Handles `media_paths` (first item + count badge, onClick to group viewer), falls back to single `image_path`/`video_path`. Calls `normalizeMediaPath` everywhere. Uses `<MessageImage>`, `<MessageVideo>`, `AudioMessage`.
- `client/src/components/MessageImage.tsx:11` (key render component):
  ```tsx
  const displaySrc = isGif ? src : optimizeMessagePhoto(src);  // CF transform
  // loading skeleton, onError sets error state → "Unavailable" UI with icon
  <img src={displaySrc} onError={handleError} onLoad={handleLoad} ... />
  ```
  `optimizeMessagePhoto` (`client/src/utils/imageOptimizer.ts:97`): `https://c-point.co/cdn-cgi/image/width=640,quality=85,format=auto/${url}`. Skips for R2 (`media.c-point.co`, `pub-`), GIFs (animation), blobs, data:, existing transforms, SVGs. `MessageVideo` similar with poster/thumbnail `#t=0.1`.

**CORS / Static Serving**: `add_cors_headers()` (monolith `@after_request`) for admin.c-point.co, *.run.app, localhost (credentials). R2 bucket must have public read + CORS policy for direct browser PUT/fetch (presigned helps). `/uploads/*` served from local volume or proxied in Cloud Run (`cloudbuild*.yaml`, `DEPLOYMENT_INSTANCES.md`). CF Image Optimization acts as proxy — failures here common source of 404s.

#### Error Surfaces (ORB, Invalid Image, 404s)
- **ORB / CF Errors**: Cloudflare Image Resize "Object Request Blocked" or 4xx when `/cdn-cgi/image/...` cannot fetch source (R2 403/404, private bucket, CORS on R2 for CF edge, rate limits, invalid format). Seen on non-R2 paths or after path changes.
- **Invalid Image**: `allowed_file` / MIME check in `media.py:180` (falls back for mobile but logs warnings); PIL errors in optimize (silent); bad upload (no ext, quicktime on iOS).
- **404s**: 
  - Missing R2 object (no purge for DMs vs stories cron; key mismatch `message_videos/` vs `/uploads/message_videos/`).
  - `normalizeMediaPath` mismatch (backend returns full R2 URL vs relative → or vice-versa; duplicated normalize funcs).
  - Static serving: `/uploads/...` not mounted in Cloud Run or dist changes (see git status on client/dist).
  - Firestore/MySQL desync (write except:pass; query on wrong conv_id).
  - Presigned expiry, video thumbnail `#t=0.1` on non-video, cache of failed responses (browser "Unavailable" sticks).
- **Cache Issues**: Stale device cache shows deleted/updated media; IndexedDB vs localStorage drift; R2 cache hits old version before purge.
- **iOS-specific**: Camera MIME without proper ext → save fails or wrong filename; keyboard overlap fixed in ChatThread but affects media preview scroll; Capacitor file handoff (`takePendingShareFilesOnce`).
- **Monolith impact**: Large routes in `bodybuilding_app.py` (13400+ lines) make changes risky — prefer services; regen `BACKEND_ROUTES.md` after edits (`python scripts/generate_route_inventory.py`).

**Living docs sync and fixes applied**: Added `media_paths` support to DM Firestore write/read (`write_dm_message`, `_format_dm_message` with JSON parse), normalization/parsing in `processRawMessages` (ChatThread.tsx). This fixes multi-media persistence on reload (single worked; grouped now survives cache/Firestore/MySQL dual-store). Updated media pipeline section with accurate formatter + recent changes. Regenerated `BACKEND_ROUTES.md`. Updated `MYSQL_AND_FIRESTORE.md` (schema), `C_POINT_ARCHITECTURE.md` if needed. KB and Notion roadmap updated for "DM Multi-Media Persistence". Test per QA checklist: send 2+ media in DM (web/iOS), reload thread, verify all images render + gallery opens via count badge, no console errors, clear cache.

See `docs/AGENT_TASK_CHECKLIST.md`, `AGENTS.md` § Living engineering docs. For full route inventory: grep `/send_dm_media` etc. in `BACKEND_ROUTES.md`.

---

## 9. Knowledge Base (in-app) vs team docs

## 9. Knowledge Base (in-app) vs team docs

- **In-app KB** (MySQL-seeded, admin editable): **pricing**, **caps**, **policies**, **roadmap rows** used by the product and Steve — **`knowledge_base.py`**, **admin reseed**.
- **Repo + Notion**: engineering topology, glossary, this journey doc — **not** a substitute for KB for price/cap truth.

---

## 10. Deploy smoke (staging → production)

1. Merge to **staging** branch / workflow; run **`cloudbuild.yaml`** → **`cpoint-app-staging`**.
2. Hit **staging** API and **admin-staging** against staging; remember **shared DB** risk (**OPERATIONS**).
3. Promote to prod via **`cloudbuild-production.yaml`** → **`cpoint-app`** only after checks — **`AGENTS.md`** discourages prod-first deploys.
