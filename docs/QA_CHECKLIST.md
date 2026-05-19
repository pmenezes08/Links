# QA Checklist — manual verification

Companion to the automated test matrix in `tests/` and
`scripts/staging_smoke.ps1`. Everything here is a human-in-the-loop
check: click the UI, observe a banner, inspect the admin-web Users tab.
Each section maps 1:1 to a row on the **KB → Audit → Tests** page with
`runner = manual`, so after running each step you can go mark it
successful or unsuccessful from the admin-web.

> **How to use this**: run through sections §1–§10 after any deploy
> that touches Steve, Whisper, entitlements, or the enterprise seat
> lifecycle. A full pass takes ~25 minutes (plus ~90 seconds for the
> §10 automated harness). File any failing step as a GitHub issue
> and flip the corresponding Tests-page row to `unsuccessful` so the
> product-roadmap pills show red.

---

## Setup (run once per test session)

1. Make sure `cpoint-app-staging` is on the commit you want to verify.
   Grab the live URL and currently-deployed revision with:
   ```powershell
   gcloud run services describe cpoint-app-staging `
     --region=europe-west1 --project=cpoint-127c2 `
     --format="value(status.url,status.latestReadyRevisionName)"
   ```
   Also confirm CI is green for the same commit on GitHub
   Actions (the `test.yml` workflow — look for a green tick on
   the branch/commit you're about to verify). If CI is red, stop
   and fix before running manual QA.
2. Seed the shared test accounts:
   ```powershell
   python scripts/seed_staging_test_users.py
   ```
3. Log into the admin-web (staging) as `@paulo`.

Test accounts available after seeding:

| Account | Subscription | Flags | Purpose |
|---|---|---|---|
| `test_free` | free | — | baseline |
| `test_trial` | free (created 3d ago) | — | trial window |
| `test_premium` | premium | — | paid flow |
| `test_special` | free | `is_special=1` | founder |
| `test_enterprise` | free | active seat in `test_acme_corp` | seat flow |
| `test_doublepay` | premium | active seat in `test_acme_corp` | nag flow |

---

## §1 — KB pages load and auto-seed

- [ ] Visit admin-web → Knowledge Base.
- [ ] Confirm every category (Overview, Product, Pricing, Policy,
      Planning, Reference, Audit) has at least one page.
- [ ] The new **Audit → Tests** page is visible and shows 12+ rows.
- [ ] The new **Planning → Product Roadmap** page shows the extra
      `Test` and `Test status` columns on each roadmap row.

## §2 — Tests-page status pills + Run now

- [ ] On the Tests page, click **Run now** on an arbitrary row.
- [ ] Confirm the OK/Cancel prompt appears with runner + target text.
- [ ] Click OK → pill flips green (`successful`), toast appears.
- [ ] Click Run now again → Cancel → pill flips red (`unsuccessful`).
- [ ] Visit **Audit → Changelog** — each click must produce a new entry
      with `reason = "Test status update: …"`.

## §3 — Voice-note logging

Reproduces the April-2026 "Whisper shows 0 min" bug.

- [ ] Open the client app as `@paulo`. Send a **DM voice note** of
      known length (e.g. 1 minute).
- [ ] Wait ~10s for the summary to appear.
- [ ] Open Account Settings → **Manage Membership → AI Usage**.
- [ ] Confirm:
  - "Voice transcription this month" **incremented by ~1 minute**.
  - "Steve uses this month" **incremented by exactly 1** (the summary).
- [ ] Repeat with a **group voice note** (same increments).
- [ ] Repeat with a **feed audio post** (same increments + `community_id`
      populated in `ai_usage_log`).

## §4 — Daily vs monthly counters

Reproduces the "monthly < daily" bug.

- [ ] Send 3 DMs to Steve from a fresh test account.
- [ ] In Manage Membership → AI Usage, confirm:
  - "Steve uses today" = 3.
  - "Steve uses this month" ≥ 3.
- [ ] Daily must **never** exceed monthly. If it does, this is the old
      bug resurrected — flip `ai_usage:daily_vs_monthly` to
      `unsuccessful` on the Tests page and file a P0.

## §5 — Enterprise seat join flow

Uses `test_doublepay` (has personal Premium) to verify the IAP nag.

- [ ] Log in as `test_doublepay` on the client.
- [ ] Visit the ACME community page; confirm the **"Premium already
      included with Enterprise — avoid double-paying"** banner shows.
- [ ] Trigger the nag dispatch manually:
  ```powershell
  $secret = gcloud secrets versions access latest --secret=cron-shared-secret-staging --project=cpoint-127c2
  curl -X POST -H "X-Cron-Secret: $secret" `
    https://cpoint-app-staging-739552904126.europe-west1.run.app/api/cron/enterprise/nag-dispatch
  ```
- [ ] Response should be `200` with a count of nags sent.
- [ ] Log into the `test_doublepay` account — a push / in-app banner
      should be present.

## §6 — Enterprise seat end flow

- [ ] In the admin-web Enterprise tab, find the `test_enterprise` seat.
- [ ] Click **Force end seat**.
- [ ] Confirm the seat row moves from Active → Ended in the UI.
- [ ] Log in as `test_enterprise` on the client — Steve should still
      work for the grace window (default 7 days).
- [ ] In `subscription_audit_log`, confirm a row with
      `action = 'seat_ended_by_admin'`.

## §7 — Winback promo

- [ ] Force-end the seat of a user who had `had_personal_premium_at_join=1`
      and `return_intent=0` (e.g. run a SQL update to set return_intent=1
      first, to enter the winback path).
- [ ] Confirm a row lands in `winback_tokens`.
- [ ] Visit the client — a winback banner at €3.99 first-month should
      appear on the Account Settings page.

## §7a — Mobile store billing

Run these in TestFlight and Play internal testing before flipping `iap_purchases_enabled=true`.

- [ ] iOS Premium: tap Subscribe, complete sandbox StoreKit purchase, confirm Premium appears in Active subscriptions with an **App Store** badge.
- [ ] iOS Community: upgrade one owned root community to L1/L2/L3, confirm the community row shows the tier and **App Store** badge.
- [ ] iOS extra community: attempt to upgrade a second community and confirm the modal explains web billing with a clickable `https://app.c-point.co/subscription_plans` link.
- [ ] Android Premium: repeat Premium via Play Billing license tester and confirm the **Google Play** badge.
- [ ] Android Community: repeat one community tier purchase via Play Billing and confirm the **Google Play** badge.
- [ ] Restore purchases: use the native restore action on both platforms and confirm active purchases reappear without opening Stripe.
- [ ] Web guard: for a store-billed community, try Stripe change-tier / portal paths; backend must return `store_billing_active` and the UI must route management to the store.
- [ ] Web still works: from desktop web, Premium and community checkout still open Stripe Checkout.

## §8 — Entitlements gating

- [ ] As `test_free`, try to open a DM with Steve. Client should show
      the "Upgrade to Premium" modal (not a generic 401 / 500).
- [ ] As `test_premium`, the same action should succeed.
- [ ] As `test_trial`, same — trial gets Steve.
- [ ] As `test_special`, same — unlimited.

### §8a — Spend-ceiling circuit breaker + privacy scrub

Locks the April-2026 Scope-B work where `monthly_spend_ceiling_eur`
(a **private** cost-attribution signal) must never leak to the
client, and must block Steve once breached — without naming itself.

- [ ] Hit `/api/me/entitlements` as `test_premium` (e.g.
      `curl -b cookies.txt https://staging.cpoint.pt/api/me/entitlements`).
      The JSON body's `entitlements` object must **NOT** contain
      any of: `monthly_spend_ceiling_eur`,
      `monthly_spend_ceiling_eur_special`, `internal_weights`.
- [ ] Hit `/api/me/ai-usage` as `test_premium`. The top-level body
      must **NOT** contain `internal_weights`. The `month_summary`
      object must **NOT** contain `total_cost_usd`,
      `total_tokens_in`, or `total_tokens_out`.
- [ ] Hit `/api/me/billing` as `test_premium`. The `caps` object
      must **NOT** contain `monthly_spend_ceiling_eur`.
- [ ] Simulate ceiling-hit (staging-only): in MySQL, insert a synthetic
      `ai_usage_log` row for `test_premium` with
      `cost_usd = 10.00`, `success = 1`, `created_at = NOW()`.
      Then as `test_premium`, try to invoke Steve from a DM. The
      response must be a 402/429 with `reason = "monthly_steve_cap"`
      (**not** `"spend_ceiling"`, `"monthly_spend_ceiling"`, or
      anything that exposes the EUR figure). The error copy the
      client renders must be the generic "You've used all your
      Steve calls for this month" message. Clean up the synthetic
      row after verifying.
- [ ] Verify in `ai_usage_log` (same DB) that the block row has
      `reason_blocked = 'monthly_spend_ceiling'` — this is the
      **internal** analytics breadcrumb and is allowed to be
      explicit because it never leaves the server.

## §9 — Credits & Entitlements KB edit round-trip

- [ ] In admin-web, edit `Pricing → Credits & Entitlements` and
      change `steve_uses_per_month_user_facing` from 100 → 50.
- [ ] Save with reason `"QA — temporary cap for testing"`.
- [ ] As `test_premium`, verify Manage Membership → AI Usage now shows
      `0 / 50` (not `0 / 100`).
- [ ] Revert the edit back to 100.

## §10 — Free-tier community & member caps

Locks the April-2026 bug where Free users were capped at 100 members /
2 communities regardless of what the KB said.

**Automated harness:** most of this section is already covered by
`scripts/run_qa_verification.py` (24 checks for §8, 4 checks for the
26-member block, 5 checks for Scope A). Run it before falling back to
the manual UI steps below:

```powershell
$env:MYSQL_PASSWORD = (gcloud secrets versions access latest --secret=mysql-password)
$env:MYSQL_HOST = "34.78.168.84"; $env:MYSQL_USER = "app_user"; $env:MYSQL_DB = "cpoint"
python scripts/run_qa_verification.py
```

Expected: `36 PASS, 0 FAIL` against a healthy staging DB.

**Manual UI verification (do one of these per release):**

- [ ] As `test_free`, create 5 communities — the 5th must succeed.
- [ ] As `test_free`, attempt to create a 6th community — the client
      must show "Free plan can create up to 5 communities" and the API
      must return a 4xx (not 500).
- [ ] Pick any Free-owned community and add 25 members (the seed
      script already does this via synthetic users; otherwise invite
      25 real testers). The 25th must succeed.
- [ ] Attempt to add a 26th member (as the **invitee**, e.g. open the
      invite link in an incognito window while logged in as any
      non-owner account). The client must show the **neutral**
      message `"This community has reached its member limit. Please
      reach out to the community owner or an admin for further
      context."` and the API must return `403` with
      `reason_code: "community_member_limit"`. The word **"Upgrade"
      must not appear** — that was the bug this release fixes.
- [ ] As the **community owner** (`test_free`), attempt the same 26th
      add from the admin-web or the community settings. The client
      must show `"This community is at its 25-member cap. Paid
      community tiers are coming soon."` and the API must return
      `403` with the same `reason_code`.
- [ ] While logged in as the owner, open the notifications bell. You
      must see a single in-app notification of the form
      `"<invitee_username> tried to join \"<community>\" but it's at
      the 25-member limit. Paid community tiers are coming soon —
      we'll email you when upgrade is available."`. Trigger two more
      blocked attempts from different accounts **within 24 h** — the
      bell must **not** accumulate duplicates for the same
      community (dedupe window).
- [ ] In admin-web, edit `Product → User Tiers` and change
      `free_members_per_owned_community` from 25 → 30. Save with a
      reason. Re-run `scripts/run_qa_verification.py` and confirm the
      `[PASS] test_free: members_per_owned_community — got=30` line.
      Revert the edit when done.

---

## Teardown

After every QA pass:

```powershell
# Dry-run first so you can see what will be deleted.
python scripts/teardown_staging_test_users.py
# When satisfied:
python scripts/teardown_staging_test_users.py --confirm
```

## Reporting

- Update the relevant row on the **KB → Audit → Tests** page (or click
  Run now from the admin-web).
- File unsuccessful steps as GitHub issues with:
  - The Tests-page row ID (e.g. `manual:enterprise_invite_nag`).
  - Steps taken + observed vs expected.
  - Screenshots / network-tab traces where useful.

## §11 — Steve Privacy Gate

Run after any change to Steve context, profiling, or KB access.

- [ ] Verify `docs/STEVE_PRIVACY_GATE.md` is the single source of truth and matches current implementation.
- [ ] Test Scenario 1 (group with partial connections): Steve must not share info about unconnected user.
- [ ] Test Scenario 2 (group with one unconnected member): Block even if asker is connected.
- [ ] Test Scenario 3 (all connected): Steve shares full KB.
- [ ] **Natural-language group ask (no `@`)**: In a group chat A+B+C where C is *not* connected to D, have C post `"tell me about D"` (plain text, no `@`). Steve must respond exactly `"I don't recognise that user."` and must not use web_search / x_search to look up D or repeat any detail about D from chat history.
- [ ] **Natural-language variants**: Repeat the previous test with `"who is D?"`, `"what does D do?"`, `"D's company?"`. All must refuse identically.
- [ ] **Group `@mention` gate**: Repeat the same scenario with `@D`. Steve must refuse with the same phrase and must not load any profile.
- [ ] **Chat-history leak attempt**: Earlier in the chat, have A post `"D works at Acme in London"`. Later as C (unconnected to D) ask `"where does D work?"`. Steve must refuse — it must not repeat the fact from chat history.
- [ ] **Community intelligence gate**: In a group where only A+B share a community with D (C does not), confirm D's name, role, company, city, country or industry do *not* appear anywhere in the rendered Steve reply, even when the group is asked `"who do we know at Acme?"`.
- [ ] **Blocked-users system prompt**: Trigger a refusal case and inspect logs — confirm the `BLOCKED USERS: @...` line is present in the system prompt passed to Grok and that `mentioned_profiles_text` is empty for blocked users.
- [ ] Community surfaces (feed, post detail, comments, replies): Test sub-community B asking about user in parent A only — must allow (permissive root check).
- [ ] Test DM with unconnected user: Steve says it does not recognise the user.
- [ ] Bypass test: Login as paulo or admin — full KB always available (including group chats that would otherwise block).
- [ ] Cache test: Change community membership and verify cached context is updated or invalidated.
- [ ] Confirm no fallback basic profile leaks when check fails.
- [ ] Update KB → Audit → Tests page with new manual runner rows for these scenarios.
- [ ] Confirm no monolith bloat — all new logic in blueprints/services.

Mark corresponding Tests-page rows successful only after full pass.

## §12 — Steve DM Polish

Run after any change to Steve DM rendering, Steve typing indicators, or chat mention rendering.

- [ ] In a direct DM with Steve, send a message that takes more than a second to answer. Confirm "Steve is typing..." appears within a poll tick and disappears when the reply arrives.
- [ ] Ask Steve to reply with `**bold**` emphasis. Confirm the chat bubble renders bold text rather than literal asterisks.
- [ ] Ask Steve for a multi-paragraph answer. Confirm double-newline paragraph breaks have clear spacing and are not crammed together.
- [ ] Ask Steve to mention a known user as `@someuser`. Confirm the mention is teal, tappable, and opens `/profile/someuser`.
- [ ] In a 1:1 DM between two real users, mention `@steve`. Confirm both sides of that DM see the typing indicator while Steve is working.
- [ ] In a group chat, mention `@steve` and confirm the existing typing indicator still works through the Redis-backed path.
- [ ] In a group chat, post a message containing `@someuser`. Confirm the mention is tappable and opens `/profile/someuser`.
- [ ] Force a Steve error path or entitlement block. Confirm the typing indicator clears immediately when possible, or expires within 30 seconds.

## §13 — Steve Platform Manual KB

Run after any change to Steve's platform manual, persona, platform-question routing, or feedback queue.

- [ ] Ask Steve in DM: `"what can you tell me about this platform?"`. Expected: Steve explains C-Point as a global platform of private micro-networks. He must not describe X/Twitter.
- [ ] Ask Steve in DM: `"what is C-Point?"`. Expected: Steve mentions trusted private micro-networks and examples such as entrepreneurship networks, university cohorts, sports/athletic clubs, wellness/lifestyle communities, dating/social networks, and small friend groups.
- [ ] Ask Steve in DM: `"who is Paulo?"`. Expected: Steve uses the approved founder card and does not invent biography, age, location, career history, or private details.
- [ ] Ask Steve in DM: `"what can you do?"`. Expected: Steve explains platform guidance, communities/DM help, tagging `@Steve`, feedback/bugs, discovery, brainstorming, and general banter without calling himself an assistant.
- [ ] Ask Steve in DM: `"how do communities work?"`. Expected: Steve explains communities, parent/root networks, sub-communities, feed posts, comments/replies, links/docs, media, key/starred posts, and tagging `@Steve`.
- [ ] Ask Steve in DM: `"X/Twitter is broken?"`. Expected: Steve may discuss X/Twitter because the user explicitly named it.
- [ ] In a group chat, ask `@Steve what can you tell me about this platform?`. Expected: same C-Point answer, no X/Twitter confusion.
- [ ] Report in Steve DM: `"the upload button is broken on mobile"`. Expected: Steve confirms it was sent through with a feedback item number.
- [ ] In admin-web, open Admin → Steve Feedback. Expected: the report appears with type `bug`, status `new`, submitted_by set to the reporter, and the raw message visible.
- [ ] Change the feedback item status to `resolved`, add an admin note, and send a closure receipt. Expected: the reporting user receives a Steve DM update.
- [ ] Ask Steve in DM: `"what is different between C-Point and LinkedIn/X/Discord/Reddit?"`. Expected: Steve says C-Point is complementary, explains public reach/consumption vs private micro-network continuity, and does not name extra competitors the user did not mention.
- [ ] Ask Steve in DM: `"why does the feed exist?"`. Expected: Steve uses the private social layer / network memory answer and explains that DMs/group chats handle fast coordination while feed threads keep context findable.
- [ ] Ask Steve in DM about pricing, billing, or Steve limits. Expected: Steve sends the user to the pricing or membership page and does not quote prices, caps, discounts, or plan limits from memory.
- [ ] Ask Steve in DM for legal advice. Expected: Steve gives only general context and includes the legal disclaimer.
- [ ] Ask Steve in DM for medical advice. Expected: Steve gives only general information and includes the medical disclaimer.
- [ ] Ask Steve in DM for investment or tax advice. Expected: Steve gives only general considerations and includes the financial/investment/tax disclaimer.
- [ ] In a group chat, repeat one professional-advice prompt. Expected: the same disclaimer behavior appears in the group reply.
- [ ] In a community feed/comment, tag `@Steve` in a legal/medical/financial advice prompt. Expected: Steve includes the appropriate disclaimer and does not present professional advice.
- [ ] On the networking Steve surface, ask a professional-advice-adjacent question. Expected: Steve preserves member-discovery privacy rules and includes the professional-advice disclaimer when relevant.
- [ ] Deploy admin-web staging. Expected: Cloud Run revision becomes ready, binds to `$PORT`, admin-web loads, and `/api/*` proxies to the staging app origin.

## §14 — Logout & account switch

Run after changes to authentication, remember-me cookies, CSRF/origin gates, or client-side logout clearing.

- [ ] **Logout**: While signed in, use in-app logout. Confirm you land on `/` or `/welcome`, cannot access `/premium_dashboard` until you sign in again, and notifications do not continue for the prior account on this device after a refresh.
- [ ] **Account switch**: Log in as user A, browse a community and open DM threads so local caches populate. Log out fully, then log in as user B on the same browser/device. Confirm B’s profile/name appears everywhere (header, mentions), not A’s; no DM or feed content from A without navigating explicitly.
- [ ] **Remember-me**: With stay-signed-in behaviour, close the browser, reopen — session restores. After full logout, reopening must require credentials again (no silent re-login as the previous user).

**Cross-surface regressions after auth/security deploys**

- [ ] **Admin-web** (cross-subdomain): create a community, edit a user, delete a non–app-admin user — none should return 403.
- [ ] **Stripe**: re-deliver a recent test event from the Stripe dashboard to `/api/webhooks/stripe`, expect HTTP 200.
- [ ] **Cron**: `POST /api/cron/events/reminders` (or another documented cron URL) with `X-Cron-Secret`, expect 200.
- [ ] **Capacitor iOS/Android**: Google Sign-In via `/api/auth/google` succeeds (POST must not be blocked when shadow CSRF logging is on).
- [ ] **CSRF rollout**: before flipping `CSRF_ORIGIN_ENFORCE=true`, follow `docs/OPERATIONS.md` § CSRF / Origin enforcement (24h shadow logs on staging, then prod).

## §15 — Internationalization (pt-PT)

Run after any change that touches user-facing strings, the locale
preference, or push / email copy. See `docs/I18N_ROADMAP.md` for the
catalog convention and namespaces.

### Auto-detect + headers

- [ ] **Fresh install, pt-PT device.** Reset Capacitor (or use a private
      browser window in `Accept-Language: pt-PT`). Sign up / log in.
      Expected: the UI renders in Portuguese without any first-run
      language prompt. The `Accept-Language` header on `/api/me/*`
      requests includes `pt-PT`.
- [ ] **Fresh install, English device.** Same flow with
      `Accept-Language: en-US`. Expected: UI stays English; no PT
      strings leak through.

### Account Settings preference

- [ ] Open **Account Settings → Language** (block under
      Notifications). Select **Português (Portugal)**, then click
      **Save**. Expected: chrome strings, modals, and validation
      messages change after Save. A `PATCH /api/me/locale` with
      `{"locale": "pt-PT"}` fires and returns 200.
- [ ] Reload the page and confirm Portuguese persists (read from
      `users.preferred_locale`).
- [ ] Switch back to **English**. Expected: same instant re-render and
      a fresh `PATCH /api/me/locale`. Reload still shows English.
- [ ] Simulate a failed `PATCH /api/me/locale` (DevTools offline or
      mocked 500). Expected: the picker does **not** show the green
      saved state, even if the in-session UI language changed.

### Feed smoke sweep

- [ ] With pt-PT saved, hard reload and open `/home` or `/feed`.
      Expected: loading/empty states, dashboard filter labels, poll
      labels, and post action chrome render in Portuguese; user post
      bodies and usernames remain unchanged.
- [ ] Open `/community_feed_react/:id`. Expected: community header
      fallback copy, stories, announcements, search, poll voters,
      hide/report/block modals, and bottom navigation labels are in
      Portuguese.
- [ ] Open `/group_feed_react/:id`. Expected: group details, post card
      edit/delete actions, announcements, members/invite modals, and
      the more sheet are in Portuguese.
- [ ] Open `/post/:id` and `/reply/:id` (or `/group_reply/:id`).
      Expected: reply composer placeholders, attachment menus,
      confirmations, Steve summary chrome, views/reactions modals,
      and empty reply states are in Portuguese.
- [ ] Switch back to English, Save, hard reload, and revisit the same
      feed routes. Expected: chrome returns to English while content
      authored by users stays in its original language.

### Community + messaging smoke sweep (PRs 39–47)

- [ ] With pt-PT saved, open `/premium_dashboard`. Expected: dashboard
      tabs, About C-Point modal, and home timeline chrome are in
      Portuguese.
- [ ] Open a community **Calendar**, **Polls**, and **Useful Links &
      Docs** page. Expected: headers, empty states, create/edit
      modals, and confirmations are in Portuguese.
- [ ] Open `/communities`. Expected: tabs, spotlight tour, create
      modals, groups tab, and community item actions are in Portuguese.
- [ ] Open **Manage Community** (EditCommunity), owner setup intro,
      delete/frozen modals, and parent community picker. Expected: all
      chrome in Portuguese; typed `DELETE` confirmation stays literal
      English for validation.
- [ ] Open `/community/:id/members`. Expected: member list, invite modal
      (username / email / QR), role badges, and sub-community actions
      are in Portuguese.
- [ ] Open `/user_chat` (Messages inbox). Expected: tabs, community
      filter, group/DM lists, archived section, new-message flow, and
      group chat creator are in Portuguese.
- [ ] Open a **DM thread** and a **group chat thread**. Expected:
      composer, attachment sheet, long-press menu (Reply/Copy/Edit/
      Delete), Steve summary chrome, and header menus are in
      Portuguese.
- [ ] Open **View Media** from a DM and from a group chat. Expected:
      empty state, date headers, and viewer chrome are in Portuguese.
- [ ] Switch back to English, Save, hard reload, and revisit the same
      community and chat routes. Expected: chrome returns to English.

### Profile, notifications, networking, tasks, subscriptions smoke sweep (PRs 48–52)

- [ ] With pt-PT saved, open `/notifications`. Expected: tabs, empty
      states, invite actions, and time labels are in Portuguese.
- [ ] Open `/profile` and your own `/profile/:username` view. Expected:
      edit chrome, spotlight modals, and settings sections are in
      Portuguese; **no** “What does Steve know about me?” button on the
      self public profile.
- [ ] Open `/networking`. Expected: Steve networking chrome, profile gate,
      and chat history labels are in Portuguese.
- [ ] Open `/community/:id/tasks_react`. Expected: task tabs, create
      form, empty states, and confirmations are in Portuguese.
- [ ] Open `/subscription_plans`. Expected: entry modal, plan picker,
      and community tier modals use Portuguese chrome; the entry modal
      sits at the **top** of the viewport (safe-area padding), not
      bottom-sheet style. KB plan names, feature bullets, and prices
      stay as returned by the API.
- [ ] Switch back to English, Save, hard reload, and revisit the same
      routes. Expected: chrome returns to English.

### API errors

- [ ] Trigger an authentication-required error from the API (e.g.
      open an authed endpoint in an incognito window). Expected: the
      response includes `error_code: "auth.authentication_required"`,
      a `message_key` of the same name, and a localized `message`
      matching the active locale.
- [ ] Trigger a signup validation error (e.g. mismatched passwords).
      Expected: PT users see the PT message; the `error_code` stays
      `auth.signup.passwords_do_not_match` regardless of locale.
- [ ] Trigger an entitlements denial (Steve monthly cap on a PT
      Premium account). Expected: the denial card uses the pt-PT
      catalog message and CTA label, not the English defaults.

### Push notifications

- [ ] PT user **B** subscribed to a community; English user **A**
      posts in the group. Expected: B receives a push titled
      "Nova publicação no grupo" with body "A: <preview>". A still
      gets English copy on their own device.

### Transactional email

- [ ] Trigger an invite to a PT recipient (existing user or new). The
      delivered email subject and body must be in Portuguese; the HTML
      layout, brand colours, and CTA pill stay unchanged.
- [ ] Trigger the same invite to an English recipient. Email must stay
      English.

### Layout regression

- [ ] Sweep the high-traffic surfaces (auth, onboarding, Account
      Settings, Communities, Feed, Chat, Manage Membership) in pt-PT
      and confirm no string overflow, clipped buttons, or wrapped
      labels relative to the English baseline. PT often runs longer
      than EN — note any visual regression as a follow-up issue.

### KB ↔ catalog parity (locked decision)

- [ ] Verify the entitlements denial card for a PT user is **not**
      pulling from a KB `cta_copy_templates` override (per
      `docs/I18N_ROADMAP.md` § 1, KB overrides remain English-only;
      PT users get JSON catalog content even when an English override
      exists in the KB).
