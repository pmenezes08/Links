# Account Isolation Inventory

PR A baseline: this document records the current account-scoped browser state
and user-scoped endpoints before any logout, service-worker, or session-epoch
behavior changes. It is intentionally descriptive only.

## Browser State

### localStorage

Known identity/session keys currently cleared by `client/src/utils/logout.ts`:

- `signal_device_id`
- `current_username`
- `encryption_keys_generated_at`
- `encryption_needs_sync`
- `encryption_reset_requested`
- `last_community_id`
- `mic_permission_granted`
- `home-timeline`
- `communityManagementShowNested`
- `cached_profile`

Known account-scoped prefixes currently cleared by `client/src/utils/logout.ts`:

- `signal_`
- `chat_`
- `community_`
- `cpoint_`
- `onboarding_`
- `signal-store-`
- `dashboard-`
- `community-feed:`
- `group-feed:`
- `chat-threads-list`
- `group-chats-list`
- `chat-communities-tree`
- `chat-messages:`
- `chat-profile:`

`client/src/App.tsx` also writes `cached_profile` and `current_username` during
profile hydration and performs a smaller prefix sweep when it detects a username
change.

### sessionStorage

Known account/bootstrap keys:

- `cpoint_signin_notice`
- `cpoint_pending_invite`
- `cpoint_pending_username`
- `geo_countries`
- `swReloaded`
- `parent_tl_cache:<parent_id>`

Known preserved logout key:

- `cpoint_processed_deep_links`

### IndexedDB

`client/src/utils/offlineDb.ts` owns:

- DB name: `cpoint-offline`
- DB version: `3`
- Stores: `messages`, `conversations`, `posts`, `feeds`, `outbox`, `keyval`

Current scoping notes:

- DM thread list helpers in `client/src/utils/chatThreadsCache.ts` build
  viewer-scoped localStorage keys.
- `conversationRowId(viewer, peer)` is viewer-scoped for the `conversations`
  store.
- `messages` rows are scoped by caller-provided `conversationKey`.
- `feeds` are currently keyed by `communityId` only.
- `outbox` currently has no owner/viewer field.
- `posts` are keyed by post id and indexed by `communityId`.

Logout also deletes the following IndexedDB databases:

- `cpoint-offline`
- `chat-encryption`
- `signal-protocol`
- `signal-store`

### Cache Storage / Service Worker

Current SW version: `2.69.0`.

Current Cache Storage buckets:

- `cp-shell-${SW_VERSION}`
- `cp-runtime-${SW_VERSION}`
- `cp-media-${SW_VERSION}`

Current explicit no-cache API list in `client/public/sw.js`:

- `/api/profile_me`
- `/api/profile/ai_suggestions`
- `/api/profile/ai_review`
- `/api/profile/steve_analysis`
- `/api/profile/steve_request_refresh`

Current stale-while-revalidate API list in `client/public/sw.js`:

- `/api/user_communities_hierarchical`
- `/get_user_communities_with_members`
- `/api/premium_dashboard_summary`
- `/api/user_parent_community`
- `/api/chat_threads`
- `/api/group_chat/list`
- `/api/notifications`
- `/api/check_gym_membership`
- `/api/check_admin`

Current fallback behavior: same-origin JSON `GET /api/*` responses that are not
in the no-cache list are handled with `networkFirst(..., RUNTIME_CACHE)`, which
can still write successful responses to Cache Storage.

## User-Scoped Endpoints

The following endpoints return data derived from the signed-in user, admin
status, memberships, billing, notifications, or private conversations. They
must be treated as user-scoped in later PRs.

### Identity and Profile

- `/api/profile_me`
- `/api/profile/ai_suggestions`
- `/api/profile/ai_review`
- `/api/profile/steve_analysis`
- `/api/profile/steve_request_refresh`
- `/api/check_admin`

### Dashboard, Communities, and Feed

- `/api/user_communities_hierarchical`
- `/get_user_communities_with_members`
- `/api/premium_dashboard_summary`
- `/api/user_parent_community`
- `/api/check_gym_membership`
- `/api/dashboard_unread_feed`
- `/api/community_group_feed/<parent_id>`
- `/api/community_feed/<community_id>`
- `/api/group_feed/<group_id>`

### Chat and Notifications

- `/api/chat_threads`
- `/api/group_chat/list`
- `/api/notifications`
- `/send_message`
- `/api/group_chat/<group_id>/send`

### Subscriptions, Billing, Entitlements, and Usage

- `/api/me/entitlements`
- `/api/me/ai-usage`
- `/api/me/billing`
- `/api/me/billing/portal`
- `/api/me/subscriptions`
- `/api/communities/<community_id>/billing`
- `/api/communities/<community_id>/billing/change-tier`
- `/api/stripe/config`
- `/api/stripe/checkout_status`
- `/api/stripe/create_checkout_session`

### Admin User Data

- `/api/admin/*`
- `/api/admin/subscriptions/users`
- `/api/admin/subscriptions/communities`
- `/api/admin/steve_profiles`
- `/api/admin/knowledge_base/*`

## Public / Non-User Exceptions

Known endpoints that are intentionally public or not browser-session scoped:

- `/api/auth/google`
- `/api/invitation/verify`
- `/api/public/logo`
- `/api/kb/pricing`
- `/api/giphy/search`
- `/api/config/giphy_key`
- `/api/push/public_key`
- `/health`
- `/api/webhooks/stripe`
- `/api/webhooks/apple`
- `/api/webhooks/google`
- `/api/cron/*` (authenticated by `X-Cron-Secret`, not browser session)

## Follow-Up PR Boundaries

- PR B should only add backend `no-store` headers for user-scoped responses.
- PR C should only harden explicit logout cleanup.
- PR D should only viewer-scope IndexedDB rows.
- PR E should only change service-worker caching policy.
- PR F should only add login epoch after remember-token restore is idempotent.
