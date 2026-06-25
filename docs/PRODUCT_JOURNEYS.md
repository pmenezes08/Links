# Product journeys (cross-system flows)

> **Living doc:** When you materially change checkout, webhooks, AI gates, seat lifecycle, onboarding, or how chat data is stored/read—update this file in the **same PR**; see **`AGENTS.md` § Living engineering docs**.

Short narratives for **how behaviour spans** Flask, Stripe, MySQL, Firestore, crons, and clients. For **HTTP specifics**, grep [`BACKEND_ROUTES.md`](BACKEND_ROUTES.md); for **tables/collections**, see [`MYSQL_AND_FIRESTORE.md`](MYSQL_AND_FIRESTORE.md).

---

## 0. Authentication

- **Username/password remains first-party.** The staged `/login` → `/login_password` flow sets the same Flask session / remember-token cookies as OAuth and is still available on all platforms.
- **Google Sign-In remains available.** `client/src/pages/MobileLogin.tsx` uses native Google auth on Capacitor and Google Identity Services on web, then posts the ID token to `POST /api/auth/google`. The backend verifies the token, looks up `users.google_id`, links by signed email when needed, or creates a user.
- **iOS Sign in with Apple is App Store compliance-critical.** On iOS only, the login screen shows Sign in with Apple beside Google. The client requests `email name` scopes through `@capacitor-community/apple-sign-in` and posts Apple’s identity token to `POST /api/auth/apple`. The backend verifies Apple JWKS / issuer / audience (`co.cpoint.app`), stores `users.apple_id`, accepts private relay email addresses, and uses first-login name fields only when Apple returns them.
- **Session finish is shared.** Successful OAuth paths clear stale session state, issue the normal remember-token/install cookies, invalidate profile/dashboard caches, re-register push tokens, and redirect to `/premium_dashboard`.

### Invitation acceptance

- **Invites are pending until accepted.** Email, username, QR/link, and bulk invitations create `community_invitations` rows with a 7-day `expires_at`. Signup, email verification, password login, Google Sign-In, Apple Sign-In, deep links, and clipboard handoff may preserve or preview an invite token, but they must not insert `user_communities` rows.
- **Preview before membership.** Invite links route to `/invite-preview/<token>`, backed by `GET /api/invite_preview/<token>`, so recipients see the community, inviter, and expiry before joining. Authenticated users join only by pressing Join/Accept, which calls the explicit invite-accept endpoint.
- **Intro thread activation.** Accepting an invite writes membership, marks the invitation accepted, then creates or reuses Steve's pinned `Introduce Yourself` system thread (`cold_start.introduce_yourself.v1`). The accept response includes `next_url=/community_feed_react/<community_id>?joined=1`, so Invite Preview, dashboard invite prompts, and Notifications Invites land the new member on the community feed first with a calm orientation card. The intro thread stays available via Key Posts and an optional "Introduce yourself when ready" link; existing-member new-member notifications still link to the intro thread when available.
- **Inbox parity.** Existing-user username and email invites appear in the Notifications Invites tab. Declining is private; accepting writes membership, marks the invitation accepted, triggers the intro-thread activation path above, and then uses the normal new-member notification path.
- **Expired invite recovery.** Accepting an expired invite returns an expired-invite response and no membership write; UI tells the user to request a new invite from the inviter/community owner.

### Community cold-start loop

- **Creation:** `/create_community` still commits the community first, then calls `welcome_for_new_community()` best-effort. The service now publishes Steve's deterministic welcome post plus a notification-silent icebreaker poll (`cold_start.poll.v1`) in MySQL `posts`/`polls`/`poll_options`, then mirrors the post body to Firestore best-effort. **Locale:** welcome posts, polls, intro threads, rolling summaries, and owner DMs render in the **community owner's preferred locale** at write time (`users.preferred_locale` / Accept-Language on create); stored copy is not re-rendered for viewers and existing English posts are not backfilled.
- **Owner first post:** `CommunityFeed.tsx` treats a community with only Steve system posts as having `0 userPosts`. Owners/admins see a dismissible "Start the room" banner and editable Steve draft modal. Publishing uses the normal `/create_post` route, so the owner's first real post gets standard feed fanout and push behavior.
- **Member arrival:** Invite acceptance routes new members to the feed with a one-time orientation card. The owner's first post is ranked above Steve scaffolding while the community is young; the intro thread is hidden from the main timeline but reachable on demand. Steve welcome posts collapse to a Key Posts stub once the owner has posted; Steve polls render compact and rank below owner content.
- **Weekly recognition:** Cloud Scheduler can call `POST /api/cron/communities/rolling-welcome` with `X-Cron-Secret`. The service batches recent joins by community, dedupes by `(community_id, window_start, window_end)`, and posts one Steve rolling welcome summary per community/window without using the generic create-post notification path.

---

## 0a. Age gate (18+, Option A)

Compliance and minimization rules: **`docs/COMPLIANCE_AGE_GATE.md`**. Server stores **timestamp + boolean outcome only** — no date of birth on `POST /api/me/age-confirmation`.

1. **Any authenticated session** — The app-level **`AgeGateController`** (`client/src/components/onboarding/AgeGate.tsx`, mounted in `client/src/App.tsx` beside `BasicProfileGateProvider`) checks **`GET /api/me/age-gate`** once per signed-in account and renders the full-screen gate whenever the server status is **`pending`**. This catches every entry path — invited members landing in a community feed, OAuth signups, deep links — not just dashboard visits. (History: the gate originally lived inside `OnboardingIntroGate`, which became unreachable after the "optional enrichment" refactor and never called the API. The intro component — language picker, dark/light/system appearance, welcome video, manifesto — has since been revived for first sessions: newly verified accounts see it once via `PremiumDashboard`'s trigger effect, with its age page permanently skipped in favour of the app-level gate.)
2. **Client eligibility (DOB not sent to server)** — The gate collects DOB + explicit 18+ consent in the UI (`client/src/lib/ageGate.ts`). DOB is used only in-browser to enforce 18+; it is **not** posted to the API under Option A. A client-only `localStorage` key (`cpoint:age_gate_confirmed_at`) is a skip-cache only; server truth (`users.age_confirmed_at`, read back via `GET /api/me/age-gate`) wins on new devices.
3. **Confirm 18+** — Client calls **`POST /api/me/age-confirmation`** with `{ "confirmed": true }` (session cookie). **`user_age_gate.confirm_age_gate`** sets **`users.age_confirmed_at`**, **`age_consent_given = 1`**, clears **`underage_delete_scheduled_at`**, sets **`is_active = 1`**. User continues welcome / Meet Steve onboarding pages.
4. **Declare under 18** — Client calls `{ "confirmed": false }` (or user chooses **Delete my account** in the underage modal → immediate **`POST /delete_account`**). The schedule path sets **`age_consent_given = 0`**, **`underage_delete_scheduled_at = UTC now + 7 days`**, **`is_active = 0`**, revokes sessions/remember-me (same cookie stack as logout), and clears the Flask session on the response — **no synchronous hard delete**.
5. **Scheduled purge** — Daily Cloud Scheduler job **`purge-underage`** POSTs to **`/api/cron/purge-underage`** on **`cpoint-app`** / staging with **`X-Cron-Secret`** (see **`docs/cloud-scheduler-cron.md`**, **`docs/DEPLOYMENT_INSTANCES.md`**). **`purge_due_underage_accounts`** selects rows where **`underage_delete_scheduled_at <= NOW()`** and runs **`account_deletion.delete_user_in_connection`** (MySQL + Firestore cleanup per existing deletion service). Production cron JSON returns counts only.

**Tables:** three gate columns on **`users`** — see **`MYSQL_AND_FIRESTORE.md`**. **Routes:** `GET /api/me/age-gate` (status), `POST /api/me/age-confirmation`, `POST /api/cron/purge-underage` — see **`BACKEND_ROUTES.md`**. **Tests:** `tests/test_age_gate_api.py`. **Grandfathering:** accounts created before this gate see it once on their next session (all three columns `NULL` → `pending`).

---

## 1. Subscription and Stripe

1. User starts checkout from the client; backend creates a **Stripe Checkout** session (`backend/blueprints/subscriptions.py` and related).
2. User completes payment on Stripe; **webhooks** hit **`backend/blueprints/subscription_webhooks.py`** (signature-verified). Events update MySQL (`users`, subscription rows) according to business rules.
3. Every gated API path resolves **effective access** via **`resolve_entitlements(username)`** in `backend/services/entitlements.py` — not from ad-hoc checks of the `users.subscription` column alone.

**Return URLs:** After Checkout, browser redirects use **`billing_return`** patterns so the SPA lands in a sane state.

**Account Settings billing:** `ManageMembershipModal` keeps **Billing** and **Payment** separate. Billing reads `/api/me/billing`, which treats the stored user billing row (`users.stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `current_period_end`, `subscription_provider`, `stripe_mode`) as the canonical display source. If that row is stale (for example test/canceled/past-due) while the current Stripe mode has an active subscription for the account email, the endpoint returns the active Stripe view with a `needs_sync` diagnostic so the UI does not show a false inactive state. Payment reads `/api/me/payment-history`, backed by `subscription_invoice_payments`, and lists paid invoices for the user's Premium subscription plus root communities they own. The ledger resolves invoice ownership by subscription id first, then customer id and invoice email/metadata so paid invoices can still appear after billing reconciliation.

**Native billing management UX:** On iOS, Account Settings does not show generic Stripe portal errors for subscriptions owned by another platform. App Store-owned subscriptions open the App Store subscription screen; web-billed subscriptions ask the user to manage billing on web; subscriptions owned by another store show original-platform guidance without naming competing stores.

**Billing ownership guard:** Every checkout/confirm/webhook path runs through `backend/services/billing_ownership.py` before granting or changing an active paid product. A user may have only one active **Premium** owner across Stripe/App Store/Google Play; a root community may have only one active billing owner across community products. Tier changes (`paid_l1`/`paid_l2`/`paid_l3`) are changes inside the `community_tier` family and must use the original active provider. Test/sandbox/license-test vs live/production are diagnostic modes, not permission to double-subscribe; conflicts return stable ownership reasons and write audit rows instead of silently overwriting canonical billing state.

---

## 2. Steve / AI usage and ledger

1. Client calls a **Steve or AI-related** endpoint (chat, summaries, voice pipeline, etc.).
2. **Gating** runs first: tier caps, KB-driven limits, specials, enterprise overlay — see **`docs/STEVE_AND_VOICE_NOTES.md`**. Use **`entitlements_gate`** / shared helpers; do not call **OpenAI / Grok / Whisper** directly from new code.
3. Interactive Steve calls read KB-backed output/context caps from resolved entitlements and use **`steve_model_config`** for official xAI Grok 4.3 pricing/cost estimation. Context reads (DM, group) are bounded: `ORDER BY created_at DESC LIMIT N` on Firestore/MySQL, where N = `max_context_messages` (200) or `max_context_messages_peer_dm` (60 for @Steve in human-human DMs). Optionally, when `thread_summary_enabled` is true (KB `hard-limits`), `steve_thread_memory.maybe_refresh_thread_summary` prepends a rolling structured summary of older messages for counting/aggregation recall. Phase 3 chat memory is scaffolded but disabled: `steve_chat_memory.py` only parses KB/entitlement knobs and formats exact-scope future sections for `dm:{conv_id}` / `group:{group_id}`; it performs no Firestore reads, embeddings, vendor calls, or live prompt injection until later PRs. Prompt formatting comes from **`steve_prompt_policy`** so casual chat stays short while substantive answers use headings, bullets, recommendations, pitfalls, and next steps.
4. Successful paid work logs **`ai_usage.log_usage(...)`** with the correct **`surface`**, tokens, cost, model, and latency; thread summary refreshes log a separate row with `request_type="steve_thread_summary"`. **Blocked** attempts log via **`ai_usage.log_block(...)`** (`success=0`). The **revenue / usage dashboard** depends on this — no hand-inserted rows.

---

## 3. Entitlements resolution (single source of truth)

`resolve_entitlements()` overlays:

1. `users` row (subscription, `is_special`, account age, optional **`trial_revoked_at`**).
2. **Knowledge Base** pages (e.g. `user-tiers`, `credits-entitlements`, `hard-limits`, `special-users`) — editable in **admin-web** without redeploy.
3. **Enterprise seat** row in `user_enterprise_seats` when active.

**UI:** `ManageMembershipModal` / `useEntitlements` / limit modals — **`AGENTS.md`** — should stay consistent with server truth.

**Operator — end signup trial early:** From **admin-web → Users → Manage**, when the resolved tier is **trial**, an admin can **End trial** (requires a reason). That sets **`users.trial_revoked_at`** and writes **`subscription_audit_log`** with action **`trial_revoked_by_admin`**; **`resolve_entitlements`** then treats the account as **free** for tier purposes (Steve access follows free caps unless Premium / Special / Enterprise seat applies).

**B2B pivot (June 2026) — signup trial grants no personal AI:** the `TIER_TRIAL` block in `backend/services/entitlements.py` now resolves with `can_use_steve: False` and zeroed Steve/Whisper/AI-daily/spend caps — identical to Free for AI purposes. The tier label, 30-day window, and admin trial-revoke tooling are unchanged (bookkeeping only). Members get Steve exclusively through a community's **Steve Community Package** pool (section 4) or an admin **Special** grant. Personal Premium is **soft-retired**: the purchase tile in `SubscriptionsHome` renders only for users with an existing personal subscription (legacy manage/cancel keeps working; backend checkout untouched), the dashboard "Upgrade to Premium" CTA and personal "Talk to Steve" entry points (bottom-nav Steve modal, dashboard card/tile, About modal prefill) were removed, and single-community users land directly on their community feed on app open (`useSingleCommunityLanding`). KB `user-tiers` trial seeds were zeroed — **requires KB reseed (Reseed + Force) after deploy**.

---

## 4. Community billing (paid tier per community)

Communities can have **Stripe-backed** billing separate from the user’s personal subscription. Paid tiers use one Stripe subscription on the community row (`stripe_subscription_id`); owners may add a **Steve Community Package**, stored as a **second** subscription (`steve_package_*` columns) so tier webhooks and Steve-package webhooks never overwrite each other.

**14-day Steve package trial (June 2026):** every **new root community** is granted the Steve Community Package as a **synthetic trial** at creation (`community_billing.grant_steve_package_trial`, called from `create_community` and `onboarding_bootstrap`). The trial writes `steve_package_stripe_subscription_id = trial_pkg_<id>`, status `trialing`, period end now+14d — **no Stripe object exists**, so expiry is enforced at read time in `get_billing_state` (a `trialing` row past its period end resolves inactive; no cron or webhook involved). One trial per community; a real purchase overwrites the columns via the normal webhook path, and the synthetic trial is excluded from checkout/IAP "already active" preflights and `billing_ownership` so it can never block conversion. Tests: `tests/test_steve_package_trial.py`. **Steve Community Package** usage in feed/group contexts can draw from a **shared monthly pool** on the billing root (`ai_usage_log.community_id` normalized to the root for Steve surfaces); see **`entitlements_gate.check_steve_access`** with `community_id` and **`docs/STEVE_AND_VOICE_NOTES.md`**. Flows live under **`backend/blueprints/subscriptions.py`**, **`subscription_webhooks.py`**, and related services.

### Mobile store billing rails

- **Web remains Stripe.** Web clients still call `/api/stripe/create_checkout_session` for Premium and community tier checkout, and `/api/me/billing/portal` for Stripe-managed subscriptions.
- **Native apps use store billing.** `client/src/utils/mobileStoreBilling.ts` calls `@capgo/native-purchases` for StoreKit / Play Billing purchases, then confirms with `/api/iap/apple/confirm` or `/api/iap/google/confirm`. `/api/iap/config` returns product IDs, the launch flag, and the web overflow URL from KB.
- **One store-billed community per provider account.** `backend/services/iap_links.py` maps Apple `originalTransactionId` / Google `purchaseToken` to the C-Point user and community. Backend confirm rejects a second active community for the same provider with `store_community_limit`.
- **Additional communities go to web billing.** Native UI opens `https://app.c-point.co/subscription_plans` as a clickable external link for extra communities; it must not open Stripe Checkout inside the native app.
- **Provider-aware management.** `billing_provider` on community rows and `subscription_provider` on users route management to Stripe, App Store, or Google Play. Stripe portal/change-tier endpoints reject Apple/Google-managed rows with `store_billing_active`. Stripe-managed rows also carry `stripe_mode` so test-mode community subscriptions do not open the live Customer Portal; `/api/me/billing/portal` returns `stripe_mode_mismatch` for that case and the client explains it in-app.
- **Original-provider upgrades.** A root community's active billing provider owns upgrades/downgrades and add-ons until inactive. Apple-owned roots change tiers/add-ons via StoreKit, Google-owned roots via Play Billing, and Stripe-owned roots via web/Stripe; other providers are blocked by `billing_ownership` with `managed_by_other_provider` / `already_active_other_provider` / `mode_mismatch` / `needs_reconciliation`.
- **Launch gate.** Production IAP grants stay off until `iap_purchases_enabled=true` in KB after App Store / Play review. Sandbox/license-test restore/confirm paths are kept available for review testing.
- **Server trust.** Confirm/restore calls `store_purchase_verify` (App Store Server API + Play Developer API) before granting entitlements when not sandbox; ASSN2/RTDN webhooks verify signed payloads when store credentials are configured (`docs/STORE_BILLING_SETUP.md`).

### Subscription hub API (`GET /api/me/subscriptions`)

Single JSON contract for **Manage Membership**, **SubscriptionPlans**, and Steve checkout preflight alignment:

- **Personal:** `subscription_active`, `needs_attention`, `renewal_date_status`. Legacy field **`active`** is **healthy Premium / special only** — e.g. `past_due` Stripe status no longer counts as active for UI grouping.
- **Communities (billing roots the user owns):** `tier_subscription_active` (alias **`tier_subscription_live`**), `needs_attention`, `renewal_date_status`, `has_stripe_customer`, `stripe_mode`, **`steve_addon_eligible`**, **`steve_addon_reason`**, **`steve_addon_message`** (machine + human-readable Steve gate). Paid **tier label** alone is not “active subscription” without Stripe id + `active`/`trialing` + valid future renewal boundary (see **`backend/services/subscription_health.py`**).

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
- Feed/group @Steve comment replies assemble the post thread via **`backend.services.steve_feed_thread_context`** (most recent N comments, numbered, Steve prior-reply labels) before resource/doc blocks; see **`docs/STEVE_AND_VOICE_NOTES.md`** § Thread context.
- Steve document retrieval is two-stage. `/upload_doc` (blueprint **`useful_resources`**) writes the canonical MySQL `useful_docs` row and file bytes to R2/local storage first, then queues best-effort **`backend.services.steve_document_memory`** indexing into Firestore (`steve_doc_memory/{community:id|group:id}/docs/{doc_id}/chunks/{chunk_id}`). Mutations require community membership or group feed access via **`community_access`**. Deletes best-effort purge R2/local bytes and Firestore manifest/chunks (`purge_useful_doc`). Feed/group Steve turns assemble calendar/links/docs/polls through **`backend.services.steve_resource_context`**, which loads a compact exact-scope document manifest plus index-time dossier summaries and retrieves only relevant PDF chunks when the current thread, parent/original post, recent replies, or recent upload state makes a document ask active (`should_include_community_resources_from_thread` with real **`scope_has_useful_docs`**). Large PDFs are never injected wholesale; group docs use `group:{id}` memory only and are not visible from the parent community feed. Legacy on-the-fly PDF text extraction fires when Firestore memory has no readable chunks for that scope. Existing `useful_docs` rows can be backfilled with **`scripts/backfill_steve_document_memory.py`**.
- Community-feed Steve uses the same community-aware runtime whether the payer is the community add-on or a Premium member's personal allowance: Grok 4.3, no multi-agent, compact Firestore community memory, selective MySQL context, and **hosted `web_search` / `x_search`** attached by default via **`steve_tool_router.resolve_steve_hosted_tools`** (hard exclusions only; model invokes when needed). Intent detection is **multilingual (EN / PT-PT / ES)** with diacritic folding in **`normalize_message_for_live_search_signals`**, so *últimas notícias*, *vagas de emprego*, *busca en internet*, or *vacantes en …* attach `web_search` exactly like their English equivalents, and the tool-router LLM prompt is language-agnostic. **`tools_web_search` / `tools_x_search`** on **`ai_usage_log`** reflect **actual invocations** parsed from the Grok response, not attachment. Profile / “who is @user” style asks stay **platform-first** (no external tools) unless the same message also requests live news. KB **`paid_steve_package_feed_attach_*`** can still disable either channel; **DM and group @Steve** read the same policy from **`SteveCommunityConfig`**. Platform-manual and professional-advice-only turns never attach tools. The gate decides attribution before vendor spend: active add-on uses `community_id=<root_id>`; Premium personal fallback logs with `community_id=NULL`. **News-style** asks map to **`steve_prompt_policy` `news_current_events`** (structured briefing + headline Markdown sources + tier hygiene); **`steve-platform-manual` / `steve.what_can_i_do`** documents Steve capability boundaries for product questions. **@Mentioned** members (other than the asker) may receive gated Firestore profile blocks on feed/group replies per **`user_can_access_steve_kb`**.
- The hidden provider-cost ceiling is enforced before community-pool spend using `ai_usage.monthly_community_spend_usd(root_id)` plus a KB reservation estimate. If the cost ceiling is exhausted, free members are blocked as pool exhausted; Premium members may fall back to personal usage when the KB fallback toggle allows it.
- **Networking (Steve people-search) is B2B-gated to the Steve Package.** `/api/networking/steve_match` and `/api/networking/steve_auto_match` require the searched community's billing **root** to have an active Steve Package (paid **or** the synthetic 14-day trial), decided by **`backend.services.networking_billing.networking_gate_decision`** (reuses `community_billing.get_billing_state`, which root-normalizes). No package → `403 steve_package_required`. Trial communities get a reduced per-user weekly cap (KB `networking_trial_weekly_prompts`, default **5**) vs the paid cap (`weekly_prompts_per_user`, default **20**); the requirement itself is KB-toggleable (`networking_requires_steve_package`) — all on the **`networking-ai`** KB page. App admins, the founder, and **Special** users are exempt (unlimited) via `networking_cap_exempt`. Unlike feed/group Steve, networking is **not** in `STEVE_SURFACES`, so it does **not** draw the shared credit pool — it keeps its own per-user rolling-7-day counter (`ai_usage.networking_prompts_last_7_days`); pool-billing is deferred (networking measured at ~12× a chat reply, needs context cost-bounding first). Existing root communities were backfilled with trials at rollout via **`scripts/grant_networking_trials_to_existing_communities.py`**.
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

**Underage account purge (Option A):** Job **`purge-underage`** → **`POST /api/cron/purge-underage`** daily at **03:30 UTC**. Deletes accounts whose **`underage_delete_scheduled_at`** has passed (7-day grace after underage self-declaration). Supports **`?dry_run=1`**. See **`docs/COMPLIANCE_AGE_GATE.md`** § retention.

---

## 7. Onboarding (Steve-guided setup)

**Age gate (first):** Accounts with an unanswered server-side age status pass the app-level **18+ gate** (`AgeGateController` in `client/src/components/onboarding/AgeGate.tsx`) — see **§0a** and **`docs/COMPLIANCE_AGE_GATE.md`**.

**Simple participation rule:** Users may accept invites and read community feeds first. The only hard participation requirement is a **basic real profile**: `users.first_name`, `users.last_name`, and `user_profiles.profile_picture`. `GET /api/me/basic_profile` returns completion status and missing fields; `POST /api/me/basic_profile` saves those three fields. Social write routes return **`412 Precondition Failed`** with `error_code="basic_profile_required"` when incomplete, and the client opens a focused basic-profile sheet. Feed reads and invite acceptance remain open.

**Participation writes:** The first enforcement wave covers community posts/replies/reactions/poll votes, group feed posts/replies/reactions/polls, community invite sending, and DM/group-chat sends/edits/reactions. The gate is server-side; frontend handling is only UX.

**Optional enrichment:** Rich Steve onboarding remains available as profile help, but it is no longer a first-session gate. Dashboard reminders and community feed recommendation cards frame Steve as optional enrichment (“Improve your profile with Steve”), not a requirement to participate.

**Owner recommendation mode:** Community owners can set `recommended_profile_mode = none | personal | professional | both` in Manage Community. The feed renders a dismissible soft card for members, for example “This community works best with a professional profile. Steve can help.” It never blocks posting, replying, reacting, inviting, or messaging. The card is suppressed when `/api/onboarding/state` reports that the recommended section is effectively complete from durable profile fields or onboarding state.

**Scoped Steve profile builder:** Contextual recommendation CTAs route to a dedicated Steve profile-builder surface such as `/steve/profile-builder/professional?community_id=<id>&source=community_profile_card`, not generic Steve DM. This preserves the originating community context, uses the existing swipe page transition stack, runs only the requested profile section, and returns the user to the community feed when finished.

Onboarding stages and APIs: **`backend/blueprints/onboarding.py`** plus services such as **`onboarding_bootstrap`**, **`onboarding_company_intel`**, **`onboarding_cv_import`** (optional **PDF CV** upload: **`POST /api/onboarding/parse_cv`** extracts text locally, Grok returns structured current role / company / `current_role_start_ym` / prior roles; with **`persist=1`** the PDF is stored in **private R2** under `private/cv/{username}/…` and **`users.professional_cv_*`** metadata is updated when storage succeeds). **`POST /api/onboarding/apply_professional_structured`** persists to **`users`** after the user confirms, with **`mode`** **`replace`** (work history from the CV list only) or **`merge`** (keep and dedupe prior **`professional_work_history`**, promoting the previous current role into history when role/company change). Signed-in users download the last stored file via **`GET /api/profile/cv`**. **Firestore** collection **`steve_onboarding`** holds progressive state — see **`MYSQL_AND_FIRESTORE.md`**. Client navigates stages; backend enforces progression and ties into **Steve** where applicable.

---

## 8. Messaging: MySQL + Firestore (incl. DM Media Pipeline)

**DMs / group chat:** Canonical thread metadata, rules, and `messages` table in **MySQL** (with `image_path`, `video_path`, `media_paths` JSON, `file_path`/`file_name` for PDF attachments); **Firestore** (`dm_conversations/{conv_id}/messages`) is primary for realtime/paginated reads when a conversation document exists (see **`MYSQL_AND_FIRESTORE.md`**, `dm_chats` / `group_chat` routes in **`BACKEND_ROUTES.md`**). **`POST /get_messages`**, **`POST /send_message`**, media send routes, and **`POST /api/chat/react_to_message`** live on **`backend/blueprints/dm_chats.py`** (`dm_messages_read`, `dm_send_message`, `dm_send_media`, `dm_message_reactions`). While a DM thread is open, the client polls with **`since_id`** for new rows but performs a **full page sync every N polls** (same pattern as group chat) so **reactions** and **edits** on existing messages merge without reopening the thread; **cache-first thread open** hydrates **device cache** (DM + group, 5 min TTL) and IndexedDB before network merge; scroll pin **reveals immediately** once messages paint (late media/link previews nudge scroll in the background without hiding the list). Network refresh dedupes unchanged tails so reopen within TTL does not re-pin or spam badge checks. Link previews defer until the list is visible and only fetch in-viewport rows (max 2 concurrent). Long threads (>80 rows) use Virtuoso on web/Android; iOS Capacitor defaults to the standard list unless `VITE_CHAT_VIRTUOSO=1`. PDF sends use **`POST /api/chat/dm/send_document`** (DM) and **`POST /api/group_chat/<id>/send_document`** (group) via **`backend/services/chat_document_send.py`** (R2/local `message_documents/` subfolder, PDF-only, 25 MB cap). On **initial full load**, if Firestore has no conversation or returns an empty page, `/get_messages` and group **`GET .../messages`** **fall back to MySQL**; when Firestore reads succeed but a row lacks `file_path`, **`chat_message_document_merge`** backfills from MySQL (including cached full-fetch reads). Document galleries: **`GET /api/chat/documents?peer=`** and **`GET /api/group_chat/<id>/documents`**. **@Steve in a human–human DM** writes Steve rows tagged with **`human_dm_thread`** (sorted pair key); **`get_messages`** and thread-list preview only expose those rows in the **peer thread**, not in the private **steve** inbox (`human_dm_thread IS NULL` for direct Steve chats). Client thread pages use **generation guards** + route **`key`** so rapid DM/group switches cannot merge messages across peers. **Steve DM** (`backend/services/steve_dm_reply.py`) uses **`steve_chat_images`** for Grok **vision** on thread CDN images when the user asks about a photo; photo/media sends to Steve trigger a background reply; typing uses Redis heartbeat + client escalated copy during long xAI turns.

**Group feed (posts/replies, not chat):** **`group_posts`** / **`group_replies`** live in **MySQL** only for this product surface. Access is **`group_feed_access.check_group_feed_access`** (group member, community owner/admin, app admin, group creator). HTTP includes the monolith group post routes plus **`backend/blueprints/group_feed.py`** (photos, key posts, reply delete). **`POST /api/ai/steve_reply`** with **`is_group_post`** uses **`SURFACE_GROUP`** and writes **`group_replies`** as Steve. New **group posts** and **group replies** fan out **in-app notifications** (`group_feed_post`, `group_feed_reply`) and **push** to other **`group_members`** with status **`member`**, skipping the author and honoring **`user_muted_communities`** for the parent **`community_id`**. Group posts may **show polls** with voting on the feed; **poll creation** is from the group polls page, not the post row. When the client opens **Useful Links & Docs**, **Tasks**, or **group calendar** with **`group_id`**, list endpoints return **only resources scoped to that group** (not community-wide rows for the same community).

### Steve group agent (exclusive group feed)

Optional **preset agent** on a group (v1: **Career Expert**): enabled only when the **Steve Community Package** is active on the billing root; **`POST /api/groups/create`** with the agent on inserts a **static** welcome **`group_posts`** row from @Steve (introduces the agent); **`POST /api/group_posts`** accepts **`ask_steve`** and may enqueue a **delayed** first reply (**`group_steve_agent_schedule`**); **`POST /api/cron/group-steve-agent-due`** ( **`X-Cron-Secret`** ) processes due rows; **`@Steve`** cancels the schedule and bypasses delay; **five** auto-budget replies per post, then a cap notice; consumption uses the **same** `ai_usage` community pool as other group Steve. **Exclusive group feed** Steve (`_steve_ai_reply_for_group_post`: member @Steve, Ask Steve, cron/thread automation) injects **group-scoped** resources (this group's calendar, links, document excerpts, group polls) and still **does not** load **parent-community** bundles (`_build_steve_community_context`). **`group_chats`** Steve is a separate surface and does not automatically get that exclusive-group resource block. See **`docs/STEVE_GROUP_AGENT.md`**.

### DM Media Upload → Storage → Read → Render Flow
**Complete cross-system map** (updated for R2 direct uploads, multi-media, caching layers, iOS paths). See focused files: `ChatThread.tsx`, `mediaSenders.ts`, `firestore_reads.py`, `media.py:save_uploaded_file`, `r2_storage.py`, `MessageImage.tsx`, `normalizeMediaPath` (in `chat/utils.ts` + duplicates), `bodybuilding_app.py` (monolith routes), `firestore_writes.py`.

#### 1. **Upload (Client → Backend)**
- `client/src/pages/ChatThread.tsx`: `pendingMedia`, `videoUploadProgress`, optimistic UI with `URL.createObjectURL(file)` (blob: URLs for previews), `idBridgeRef` (temp→server ID mapping to avoid flicker), device cache (`chatMessagesDeviceCacheKey`, IndexedDB `offlineDb`), iOS-specific: `Capacitor.getPlatform() !== 'ios'` keyboard listeners (`visualViewport`, `normalizeHeight` for viewport lift/scroll-to-bottom).
- `client/src/chat/mediaSenders.ts` + `client/src/chat/upload/` (**Chat Media v2**):
  - **Resumable multipart** direct-to-R2 via `POST /api/chat/uploads/init|part-url|complete|abort` (`backend/services/chat_uploads.py`, `backend/blueprints/chat_uploads.py`).
  - Client kernel: on-device image compress + Standard/HD video quality choice, persistent **media outbox** (IndexedDB ArrayBuffer payloads), per-part retry, concurrency cap, app-level foreground resume (`useMediaUploadResume`).
  - v2.1 resume stores multipart session metadata and `completedParts`; foreground/app-return retry passes those parts into `uploadMultipartBlob({ resumeParts })` so completed R2 parts are skipped when possible.
  - After upload completes, existing send endpoints receive **`media_urls` / `video_url` only** plus the optimistic **`client_key`** (no large blobs through Cloud Run): `/send_dm_media`, `/send_video_message`, `/api/group_chat/:id/send_media`. Commit retries with the same `client_key` return the existing message instead of duplicating it.
  - Upload caps (`upload_size_limit`, `upload_daily_limit`) are enforced at `init` and mapped to the shared limit/upgrade surface in the client, not surfaced as raw upload errors.
  - Legacy single-PUT presigned routes (`/api/video_upload_url`, group `image_upload_url`/`video_upload_url`) deprecated; see `docs/CHAT_MEDIA_UPLOAD_V2.md`.
  - Sender-only **remove one attachment** from a collage: `POST /api/chat/dm/remove_message_media`; group: `POST /api/group_chat/:id/remove_message_media`. Media gallery deletion uses bulk endpoints (`POST /api/chat/dm/remove_media_bulk`, `POST /api/group_chat/:id/remove_media_bulk`) so delete-selected/delete-all can remove authorized items and return partial-failure counts without reloading the gallery. Authorized removals also purge the matching R2/local upload object and notify active/stale chat threads to remove the attachment locally; if a cached URL is still rendered, image/video components show "Media deleted" / "Cannot play media" fallbacks instead of a broken element.
  - Active upload cancel is keyed by the optimistic `client_key`. The client aborts the current multipart fetches, calls the existing upload abort path, removes the outbox record/blob, and drops the optimistic message so app-level resume will not resurrect a user-cancelled upload.
  - App-level resume now runs on mount/focus/native foreground, heartbeats live uploads, marks old ghost rows failed/retryable, stops automatic retry after five attempts, and surfaces missing IndexedDB blobs instead of silently skipping them.
- Backend routes (**`backend/blueprints/dm_chats.py`** + services **`dm_send_message`**, **`dm_send_media`** — see **MONOLITH_REDUCTION_ROADMAP**):
  - `/send_message`, `/send_photo_message`, `/send_video_message`, `/send_audio_message`, `/send_dm_media`: auth, block check, recipient lookup, `save_uploaded_file(...)`, insert to `messages` (with `media_paths=json.dumps(...)` for groups), **dual-write** to Firestore, notifications, push (skips if active_chat_status or muted).
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

## 8b. Post detail read + viewer-scoped cache

The post detail pages (`/get_post` and `/api/group_post`) are read through a single service and a viewer-scoped Redis cache so repeat opens of a community or group post are fast without leaking another viewer's per-user flags.

1. **Single read service** — `backend/services/post_detail_read.py` owns `read_community_post_detail(post_id, username)` and `read_group_post_detail(post_id, username)`. Both return `(body, status)` dicts so the same function is reusable from background workers and tests. The community read keeps the existing Firestore + MySQL hybrid path; the group read mirrors the legacy route body (reactions, nested reply tree with audio, reply counts, viewer flags, star + community-star flags, NSFW flag, view count). The `bodybuilding_app.py` routes are now ~10-line wrappers.
2. **Viewer-scoped cache layer** — `backend/services/post_detail_cache.py` wraps the read service. Keys are versioned and viewer-scoped:
   - `post_detail:v1:community:{post_id}:viewer:{username}`
   - `post_detail:v1:group:{post_id}:viewer:{username}`
   Only successful 200 responses are cached (TTL `CACHE_TTL_POST_DETAIL`, default 60s). Errors and 404s are served live. Viewer-scoping is required because the payload includes per-viewer flags (`user_reaction`, `is_starred`, `is_community_starred`, `is_community_admin`, `can_edit`, `can_delete`, `can_toggle_community_key`) and sharing a key would mis-report them.
3. **Invalidation matrix** — every mutation site that changes what the cached blob would return calls `invalidate_post_detail(post_id, scope)` (full bust across all viewers) or `invalidate_post_detail_viewer(post_id, username, scope)` (viewer-only):

| Event | Helper | Scope |
|-------|--------|-------|
| `/delete_post`, `/edit_post` | `invalidate_post_detail` | community |
| `/post_reply`, `/edit_reply`, `/delete_reply`, `/api/ai/steve_reply` | `invalidate_post_detail` | community |
| `/add_reaction`, `/add_reply_reaction` | `invalidate_post_detail` | community |
| `/api/toggle_key_post` (viewer star) | `invalidate_post_detail_viewer` | community |
| `/api/toggle_community_key_post` (admin community star) | `invalidate_post_detail` | community |
| `/api/group_posts/react`, `/api/group_posts/edit`, `/api/group_posts/delete` | `invalidate_post_detail` | group |
| `/api/group_replies`, `/api/group_replies/react` | `invalidate_post_detail` | group |
| `/api/toggle_group_key_post` (viewer star) | `invalidate_post_detail_viewer` | group |
| `/api/toggle_group_community_key_post` (admin community star) | `invalidate_post_detail` | group |

The legacy orphan `cache.delete(f"post:{reply_post_id}")` in `/delete_reply` was a no-op (no writer set that key); it has been replaced with `invalidate_post_detail(reply_post_id, scope="community")`. `post_view` is intentionally **not** an invalidation event — view counts change on every viewer, and busting every cached blob per view would defeat the cache. View counts come back fresh on the next 60s window expiry; the client-side device cache (PR 5) handles short-term smoothing.

4. **Failure handling** — cache `get`/`set`/`delete_pattern` failures are logged and swallowed; a Redis outage degrades to the underlying service read, never blocks a mutation.
5. **Observability** — `post_detail cache hit/miss` lines log at DEBUG, matching the feed cache pattern. To bump the payload shape (e.g. add a new viewer flag), set `POST_DETAIL_CACHE_VERSION=v2` in env; existing `v1` keys age out naturally.

---

## 9. Locale and internationalization

**Source of truth:** [`docs/I18N_ROADMAP.md`](I18N_ROADMAP.md). v1 supports `en` (default) and `pt-PT` (tu tone). Admin-web, KB pages, and the marketing landing stay English.

1. **Auto-detect on first launch.** The client reads the device/browser language on boot via `client/src/i18n/` (`react-i18next`). It maps unknown tags to `en` and stores the active locale in local memory only — there is **no first-run language prompt**.
2. **Every API request carries headers.** The fetch wrapper attaches `Accept-Language` and `X-CPoint-Locale` so the backend can resolve copy even before the user has saved a preference.
3. **Explicit choice persists.** Account Settings → Language sets `users.preferred_locale` via `PATCH /api/me/locale` (`backend/blueprints/me.py`). The column is owned by `backend/services/user_locale.py`; no other module reads or writes it.
4. **Backend resolution chain** (`backend/services/user_locale.resolve_request_locale`):
   1. `users.preferred_locale` (explicit choice)
   2. `X-CPoint-Locale` header
   3. `Accept-Language` header
   4. `en` fallback
5. **Copy lives in JSON catalogs.** `backend/locales/{en,pt-PT}.json` (server) and `client/src/locales/{en,pt-PT}.json` (client). Server services call `i18n.t(key, locale, **params)`; blueprints return `api_errors.error_response(key, status)` to get the shared `error_code` / `message_key` / `message` shape.
6. **Async surfaces use recipient locale.** Push and email helpers call `notification_copy.recipient_locale(username)` and `community_invite_emails.render_*(locale=...)`. Never use the sender's session locale for someone else's notification.
7. **KB stays English.** Entitlements `cta_copy_templates` overrides in the KB apply only when the resolved locale is `en`; PT users always read from the JSON catalogs (locked decision in [`docs/I18N_ROADMAP.md`](I18N_ROADMAP.md) § 1).

**Failure modes:**
- Missing key → server logs a warning and returns the English value (or the key text if `en` is also missing). Pages never break in production.
- Stale `users.preferred_locale` (unsupported tag) → defensive normalisation in `get_preferred_locale` strips it back to `None`.

---

## 10. Knowledge Base (in-app) vs team docs

- **In-app KB** (MySQL-seeded, admin editable): **pricing**, **caps**, **policies**, **roadmap rows** used by the product and Steve — **`knowledge_base.py`**, **admin reseed**.
- **Repo + Notion**: engineering topology, glossary, this journey doc — **not** a substitute for KB for price/cap truth.

---

## 11. Push token lifecycle and logout

Push tokens are stored in `fcm_tokens` (primary), `native_push_tokens` (direct APNs fallback), `push_subscriptions` (web push), and legacy `push_tokens`.

- **Registration requires an authenticated session.** `PushInit.tsx` caches the device token client-side (`window.__fcmToken`) but never POSTs to the server automatically. The `__reregisterPushToken` helper (called after login in `MobileLogin.tsx` and after profile load in `App.tsx`) is the single path that writes the token to `POST /api/push/register_fcm`. iOS `AppDelegate.swift` hands the APNs token to Firebase and posts to `NotificationCenter` for the JS bridge but does not call the server directly.
- **Backend upsert guard.** `upsert_fcm_token()` and `upsert_native_push_token()` in `backend/services/native_push.py` enforce a re-activation rule: an unauthenticated request (no session username) can never flip `is_active` back to `1` on a row that already has a `username`. This prevents the logout-then-re-register race where `PushInit` or the native layer would immediately re-activate tokens the logout just deactivated.
- **Logout path.** `performLogout()` → `unregisterPushBeforeLogout()` (calls `FCMNotifications.deleteToken` on native, then `POST /api/push/unregister_fcm` and web push unsubscribe) → `GET /logout` (server calls `deactivate_all_push_for_user()` which deactivates `fcm_tokens`, `native_push_tokens`, `push_tokens`, and deletes `push_subscriptions`).
- **Account deletion.** Both `AccountDangerZone.tsx` and `DangerZoneSheet.tsx` call `unregisterPushBeforeLogout()` before clearing user data.
- **Multi-device logout (banking-grade default, May 2026 hotfix).** `GET /logout` revokes **every** `remember_tokens` row for the user via `remember_tokens.revoke_for_user(username)`, not just the row matching the incoming cookie. The user is logged out on every device they were signed in on. The frontend confirms this explicitly via `LogoutPromptProvider` ("This signs you out on every device where you're logged in"). Per-cookie revocation (`revoke_by_cookie`) still runs first so the audit count is accurate.
- **Remember-me rotation guard on `/logout` (May 2026 hotfix, RC-1).** `rotate_remember_token_after_auto_login` (the `after_app_request` hook) early-returns when `request.endpoint == 'auth.logout'` or `g.skip_remember_rotation` is set. Before the fix, this hook silently re-issued a fresh `remember_token` on the `/logout` response itself whenever `before_app_request` had restored the session from remember-me — undoing the revocation in the same response. Diagnosis + remediation in `docs/audit/LOGOUT_REMEDIATION_PLAN.md`; security review in `docs/audit/LOGOUT_SECURITY_REVIEW.md`.
- **Cookie clear sweeps legacy domains.** `remember_tokens.clear_cookie` mirrors `auth_session.clear_session_cookie` and emits expire-cookie headers for the configured domain plus legacy `.c-point.co`, `app.c-point.co`, and host-only variants — required for users who logged in before the May-2026 host-only cookie-domain migration to actually log out.
- **Audit logging.** Every silent restore from remember-me writes `auth.remember_me_restore username=… ip=… ua=… endpoint=…` to the application log. Post-deploy verification filter: a `/logout` response that emits `Set-Cookie: remember_token=<non-empty>` is the signature of the bug returning. Pair with `auth.logout pre_username=… tokens_revoked=… user_tokens_revoked=…`.

---

## 12. Community Calendar: Timezone-Aware Scheduling and Device Export

- **Timezone Authority.** The backend is the single source of truth for timezone conversion. When creating or editing a calendar event, the client submits the raw wall-clock dates/times entered by the user plus the selected IANA timezone (e.g., `Europe/Lisbon`).
- **UTC Instants Derivation.** In `backend/services/community_calendar.py`, `create_event` and `update_event` use `zoneinfo` to validate the timezone and derive the exact UTC start and end instants (`starts_at_utc`, `ends_at_utc`) for timed events. All-day events are kept as date-only semantics (instants are stored as `NULL`) to prevent date shifting across timezones.
- **Meeting Links.** Event creators can add an optional HTTPS meeting URL (for example Google Meet, Zoom, or Teams). `meeting_url` is validated server-side, returned in event payloads, shown on event detail pages, and included in device calendar notes / ICS descriptions.
- **Device Calendar Export.** When exporting a timed event to the device's native calendar (via `@ebarooni/capacitor-calendar`), `eventToNativeRange` in `client/src/utils/nativeDeviceCalendar.ts` parses `starts_at_utc` and `ends_at_utc` directly into UTC epoch milliseconds. The device OS handles local display conversion automatically. All-day events use local date-only ranges.
- **ICS Fallback.** The ICS generator `format_event_ics` in `backend/services/community_calendar.py` emits UTC `Z` formatted `DTSTART` and `DTEND` values for timed events using the canonical UTC instants, ensuring they import correctly in any timezone. When a meeting link is present, the ICS `DESCRIPTION` includes it and the event `URL` points to the meeting.
- **Reminders.** The cron job `/api/cron/events/reminders` processes upcoming events and schedules notifications based on the canonical `starts_at_utc` instant, preventing reminders from firing early or late for users in different timezones.

---

## 12b. Community handles: find by handle → request → approve

- **Handles.** Every root community has a globally-unique `@handle` (`communities.handle`, owned by `backend/services/community_handles.py`): assigned at creation (creator-picked or slugified from the name), backfilled at startup for older rows, owner-changeable in Manage Community with a 30-day cooldown. Display names are deliberately **not** unique; the handle is the identity. Sub-communities carry no handle.
- **Findability is opt-in.** `communities.discoverable` defaults OFF. The Manage Community card ("Open to join requests") only unlocks once a handle is saved. There is **no directory**: the only discovery primitive is exact-match lookup — `GET /api/community/by_handle/<handle>` — which is rate-limited and **non-enumerating** (nonexistent handle ≡ non-discoverable community ≡ sub-community: identical response). The lookup payload is an allowlist: name, @handle, short description, *bucketed* member count.
- **Request → approve.** A member who finds a community asks to join (`community_join_requests`, one row per user+community). Owners/admins get a push + notification (recipient-locale copy via `notification_copy`: `community_join_request`) and act from the Notifications → Invites tab ("Asking to join" cards) or the admin-only pending-requests row at the top of the community feed (navigates to the inbox; no inline mutations). Accept routes through the same join path as invite acceptance — member-cap checks (`render_member_cap_error`; the request stays pending on cap block), introduce-yourself thread, `notify_on_new_member`, cache invalidation — then notifies the requester (`community_join_request_accepted`).
- **Silent expiry on decline.** Declines never notify and are requester-invisible: the lookup keeps reporting `pending` for the 30-day cooldown, after which the state quietly resets. Request-pending copy promises only the positive path ("If you're welcomed in, you'll hear here"). No reason is ever recorded or shown.

---

## 13. Deploy smoke (staging → production)

1. Merge to **staging** branch / workflow; run **`cloudbuild.yaml`** → **`cpoint-app-staging`**.
2. Hit **staging** API and **admin-staging** against staging; remember **shared DB** risk (**OPERATIONS**).
3. Promote to prod via **`cloudbuild-production.yaml`** → **`cpoint-app`** only after checks — **`AGENTS.md`** discourages prod-first deploys.

## 14. Steve Builder (front-end creations) — Phase 1

The Builder lets a member chat with Steve to generate a **front-end-only** web creation (a single self-contained HTML document — game, quiz, generator, site, or tool), iterate on it, share it to communities, publish eligible websites/apps to the web, and optionally list it anonymously in Explore Creations inside C-Point. It is the entry point to "Steve brings ideas to life"; generic AI app-builder framing is deliberately avoided.

Source-of-truth doc for the pivot, runtime rules, host controls, sound philosophy, QA, and roadmap: **[`docs/STEVE_BUILD.md`](STEVE_BUILD.md)**.

1. **Entry** — dashboard "Bring an idea to life" card → `/builder`; community feed still supports `/community/:id/builder`. Explore CTA → `/explore-creations`.
2. **Build / iterate** — `POST /api/builder/create` accepts an optional `community_id`; no community means a personal creation (`creations.community_id=NULL`). `POST /api/builder/<id>/iterate` keeps ownership-only iteration. Durable `builder_jobs.community_id` is nullable, completion notifications deep-link to `/builder?creation_id=<id>` or `/community/:id/builder?creation_id=<id>` depending on job context. Each build is gated by `entitlements_gate.gate_builder_or_reason` and logs one `ai_usage_log` row through the builder services; the Builder deliberately does **not** use the Steve credit-pool gate.
3. **Preview / play** — the HTML renders client-side in a sandboxed iframe (`srcDoc`, `sandbox="allow-scripts"` only → opaque origin, no access to app session cookies/storage). The injected `window.CPoint` bridge carries active context (`personal`/`community:<id>`) into `/api/builder/<id>/data/*` and `/api/builder/<id>/match/*`. Scores, ratings, saves, shared state, collections, forms, leaderboards, and matches are scoped by `community_id`, so the same creation shared into multiple communities has separate runtime data.
4. **Share = community post** — `POST /api/builder/<id>/publish` / `/share` inserts a normal `posts` row carrying `creation_id` and writes `creation_shares(creation_id, community_id, post_id, shared_by)`. Owners can share the same personal creation into multiple communities they belong to; the route enforces membership before writing. The React feed renders posts with `creation_id` as tap-to-play cards → `/community/:id/creation/:creation_id`.
5. **Publish to web (websites/apps only)** — `POST /api/builder/<id>/publish-web` validates owner + public-eligible kind, injects a public-safe bridge plus mandatory C-Point splash/badge, writes a public R2 artifact (`public/builds/<slug>/<version>.html`) and manifest (`public/builds/<slug>/manifest.json`), then returns `https://builds.c-point.co/<slug>`. `services/public-builds-worker/` serves that manifest/artifact through Cloudflare with security headers and a branded 404. `DELETE /api/builder/<id>/publish-web` removes the manifest/artifact; games stay inside C-Point because saves, scores, identity, and multiplayer are community/session-bound.
6. **Explore Creations** — `POST /api/builder/<id>/gallery` lets owners opt in/unlist any creation type for in-platform anonymous gallery inclusion; `POST /api/admin/builder/<id>/gallery` lets app admins approve/reject/delist if moderation is needed. `GET /api/builder/explore` lists approved creations with `/creation/<id>` play links and returns no creator, profile, community, or post identifiers.
7. **Privacy / access** — create reads and play views authorize via owner access, gallery-approved in-platform access, or `community_access.can_view_community_content` against the active share context. Game invite opponents are only members of the active community and are exposed as opaque handles. Public web visitors are anonymous and receive only public-safe `CPoint` capabilities (public data connectors; no session saves, shared collections/forms, scores, ratings, or multiplayer).

Phase-1 scope is front-end only (no user backends). Remix (copy a creation + `parent_creation_id`) and richer community picker UI for sharing are follow-ups.
