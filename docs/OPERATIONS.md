# CPoint — Operations Playbook

> Living reference for the handful of hot operational flows the founder
> runs personally (deploys, backups, data resets, single-user promotions,
> QA). Code details live in source; **only** decisions, commands, and
> caveats that aren't obvious from reading the code belong here.
>
> If you're reading this before touching prod data: stop, re-read the
> **Shared staging/prod DB** caveat, and confirm the Cloud SQL backup
> ID with the founder before running any script in `scripts/execute_*`.

---

## 0. Topology (what you're working with)

- **Cloud Run — staging**: `cpoint-app-staging` (region `europe-west1`).
- **Cloud Run — prod**: `cpoint-app` (same region).
- **Cloud SQL — MySQL 8**: `cpoint-db` (same instance + same database +
  same credentials for **both** services). See §6 for the implications.
- **Secret Manager**: `mysql-password`, `cron-shared-secret-staging`,
  `cron-shared-secret-prod`, Stripe/OpenAI/Grok keys.
- **Admin-web** (static React): deployed alongside the app. Admin flows
  (KB edits, Users tab, Tests page) are served there.
- **Client-web / mobile**: the React + iOS clients; no backend logic
  here, they just call `/api/…` on the Cloud Run service.

Source of truth for entitlements is **resolve_entitlements()** in
`backend/services/entitlements.py`. It reads:
1. `users` row (`subscription`, `is_special`, `created_at`).
2. KB pages `user-tiers`, `credits-entitlements`, `hard-limits`,
   `special-users` (editable live from admin-web, no redeploy needed).
3. `user_enterprise_seats` (active seat → Premium-via-Enterprise).

### 0.1 Infrastructure cost snapshot (2026-04-20)

Last 30 days billing: **€121.78/month**. Breakdown (approximate, from
Console billing report):

| Service                   | €/mo | Notes                                                          |
|---------------------------|------|----------------------------------------------------------------|
| Cloud Run (all services)  | 103.35 | Dominant cost; two services at `min-instances=1` was the cause |
| Artifact Registry         | 8.71 | Growing creep from stale source-deploy image layers            |
| Cloud SQL (cpoint-db)     | 7.81 | `db-f1-micro` — already lean, no action                       |
| Other (Cloud Storage, SM) | 1.91 | Noise                                                         |

Services actually in use for CPoint: `cpoint-app`, `cpoint-app-staging`,
`cpoint-admin`, `cpoint-admin-staging`, `cpoint-landing`. Services
`evalio` and `links` belong to other projects and are out of scope for
this project's cost optimisation.

**Cost-hygiene actions applied 2026-04-20** (Phase 0 of the hygiene PR):

1. `cpoint-app-staging` scaled to `min-instances=0` (was 1). Cold-start
   on first hit per idle period is acceptable for staging. Prod stays at
   `min-instances=1` so users never pay the cold-start tax.
2. Artifact Registry cleanup policies applied to both repos
   (`cloud-run-source-deploy` in `europe-west1`, `gcr.io` in `us`):
   keep 5 most-recent versions, delete untagged >7d, delete tagged >30d.
   Policy source-of-truth: `[scripts/ar_cleanup_policy.json](../scripts/ar_cleanup_policy.json)`.
3. BigQuery dataset `cpoint-127c2:billing_export` created (EU multi-region)
   as the target for Cloud Billing → BigQuery export. **The Console
   linking step is still pending** — see §0.3.
4. Four Cloud Monitoring alert policies defined in
   `[scripts/monitoring_alerts/](../scripts/monitoring_alerts/)` with
   apply instructions in `[scripts/monitoring_alerts/README.md](../scripts/monitoring_alerts/README.md)`.
   **Apply pending** — see §0.3.

Projected fixed floor after all actions settle: **~€55–60/month**.
Current break-even on community pricing (€0.33/member flat) recalculated
against the reduced floor: ~180 paying members, or roughly 1 Enterprise
customer OR 3–4 L1 paid communities.

### 0.2 When to review staging scaling

Keep `cpoint-app-staging` at `min-instances=0` until one of:
- You need to run joint testing sessions with external testers where a
  15s cold-start would disrupt the flow.
- Staging is the target of a recurring external smoke/probe job.

When promoting back, the command is simply:

```powershell
gcloud run services update cpoint-app-staging --min-instances=1 --region=europe-west1
```

and note the change in this file.

### 0.3 Open follow-ups (Cloud-Shell-only tasks)

Two Phase-0 items need an interactive Cloud Shell session (the local
gcloud CLI can't run `gcloud alpha monitoring` or the Console-only
billing export link). Doing them later doesn't change run-rate; they
only gate observability:

1. **Apply monitoring alerts** — from Cloud Shell:
   ```bash
   cd /path/to/Links
   # First create the email notification channel if it doesn't exist:
   gcloud beta monitoring channels create \
     --display-name="Founder email" --type=email \
     --channel-labels=email_address=paulo.miguel.menezes@gmail.com
   # Capture the returned channel name, then:
   export CHAN="projects/cpoint-127c2/notificationChannels/XXXXX"
   for f in scripts/monitoring_alerts/*_high.json; do
     gcloud alpha monitoring policies create \
       --policy-from-file="$f" --notification-channels="$CHAN"
   done
   ```
2. **Link BigQuery billing export** (Console only) — Navigation menu
   → Billing → Billing export → BigQuery export → Edit settings:
   - Project: `cpoint-127c2`
   - Dataset: `billing_export` (already created)
   - Enable both *Standard usage cost* and *Pricing* exports.
   First data appears ~24h after enabling.

---

## 1. Deploying code

Both services are source-deploys (no image registry). Build + push both
after merging to `main`:

```powershell
gcloud run deploy cpoint-app-staging --source . --region europe-west1 --allow-unauthenticated
# Manual smoke on staging here (see §4).
gcloud run deploy cpoint-app --source . --region europe-west1 --allow-unauthenticated
```

Typical time: ~4 min per service. If the deploy errors out with
"container failed to start within timeout", it's almost always a bad
import or missing env var — check the Cloud Run logs tab.

### When to deploy both vs. staging only

- **Staging only**: any backend or schema change you want to smoke
  against real data before prod sees it. Remember staging **writes to
  the same DB**, so this is NOT a hermetic safety net — it just lets
  you eyeball the code change while prod keeps serving the old code.
- **Both**: once staging smoke passes.

---

## 2. Backing up Cloud SQL

Before **any** destructive script (resets, migrations, mass promotions),
take an on-demand backup:

```powershell
gcloud sql backups create `
  --instance=cpoint-db `
  --description="pre-<op>-$(Get-Date -Format yyyyMMdd-HHmm)"
```

Wait for it to finish (≤2 min for our size). Capture the backup ID
printed in the response. That ID is your restore point.

Restoring (only if you really need to):

```powershell
# List recent backups.
gcloud sql backups list --instance=cpoint-db --limit=10

# Restore. THIS IS DESTRUCTIVE — it replaces the live DB contents.
gcloud sql backups restore <BACKUP_ID> --restore-instance=cpoint-db
```

Backups are retained per GCP defaults (7 daily + on-demand). Always
take a fresh on-demand one **right before** the destructive run; don't
rely on the nightly schedule.

---

## 3. User reset playbook (Phase B)

The reset that ran on **2026-04-20** flipped every non-exempt user to
Free tier, cleared `is_special`, closed their active enterprise seats,
and reset `created_at = NOW()` so everyone got a fresh 30-day trial
window. **Exempt accounts**: `paulo`, `admin`, `steve`.

The scripts are idempotent by design:

1. **Survey** — always run first:
   ```powershell
   python scripts/preflight_reset_survey.py
   ```
   This is read-only. It reports: total users, how many would be
   touched, subscription breakdown, is_special count, bad `created_at`
   count, active enterprise seats, over-cap communities.
2. **Execute** — only after reviewing survey counts:
   ```powershell
   python scripts/execute_user_reset.py
   ```
   Each of the 4 updates (subscription, is_special, seats, created_at)
   runs in its own transaction with a pre-count assertion and rollback
   on mismatch. Safe to Ctrl-C mid-run — the in-progress transaction
   will rollback.
3. **Verify** — run the survey again and spot-check a handful of users:
   ```sql
   SELECT username, subscription, is_special, created_at
     FROM users WHERE username IN ('paulo','admin','steve');
   -- expect unchanged rows for all three
   ```

### When to run a reset

Almost never. The 2026-04-20 reset was a one-off to recover from a mix
of malformed `created_at` values and opportunistic "premium" flags
handed out during early onboarding. **If you're tempted to run another
one**, stop and promote individuals via §4 instead.

---

## 4. Single-user promotions / demotions

The admin-web **Users** tab is the right tool — it calls
`/api/admin/update_user` which:

- Updates `users.subscription` (free / premium) or `is_special`.
- Invalidates any session cookies for that user (next request
  re-reads the tier).
- Writes a `subscription_audit_log` row with actor + reason.

**UI caveat**: the client-side `useEntitlements` hook caches the
entitlements on mount and doesn't auto-refresh. A user whose tier is
flipped while they're logged in will see their **UI** as stale until
they reload, but the **backend enforcement** is immediate — every API
call re-reads entitlements from the DB. Good enough for day-to-day
ops; flagged for a future refresh-on-focus patch.

For trial-extension edge cases (someone should get "another 30 days"),
update `users.created_at = NOW()` for just that user and confirm with
`resolve_entitlements()` returns `tier = 'trial'`. There is no
separate trial-extension admin UI yet.

---

## 4.1 Stripe subscriptions

Stripe checkout uses the Knowledge Base as the source of truth for Price
IDs. Add the Stripe **Price ID** (`price_...`), never the Product ID
(`prod_...`), to these fields:

- `user-tiers`: `premium_stripe_price_id_test` / `premium_stripe_price_id_live`.
- `community-tiers`: `paid_l1_stripe_price_id_*`, `paid_l2_stripe_price_id_*`, `paid_l3_stripe_price_id_*`.
- Future add-ons: `paid_steve_package_stripe_price_id_*` and `networking_page_stripe_price_id_*`.

The app chooses `*_test` or `*_live` from the current `STRIPE_API_KEY`
prefix. Admin-web → Subscriptions shows a diagnostics banner when any
expected Price ID is missing.

Webhook-owned billing state:

- Personal Premium state is stored on `users` via
  `backend/services/user_billing.py`.
- Community tier state is stored on root `communities` via
  `backend/services/community_billing.py`.
- `cancel_at_period_end = 1` means benefits are still active until
  `current_period_end`; do not downgrade entitlement until
  `customer.subscription.deleted`.

Upgrade and renewal policy:

- New purchases use Stripe Checkout.
- Existing active or cancelling community subscriptions use Stripe
  Billing Portal. Do not start a second Checkout session for L1 → L2,
  L2 → L3, or renewal after `cancel_at_period_end`.
- Configure Stripe Customer Portal in the Stripe Dashboard so Community
  L1/L2/L3 products and prices are available for plan changes.

## 4.2 Paulo community ownership cleanup

Paulo should not be the platform owner (`communities.creator_username`)
for existing operational communities because it skews founder KB/test
data. The owner should be `admin`, while Paulo remains a community
admin/member where needed.

Always run a Cloud SQL backup first because staging and prod share the
same database:

```powershell
gcloud sql backups create `
  --instance=cpoint-db `
  --description="pre-paulo-ownership-transfer-$(Get-Date -Format yyyyMMdd-HHmm)"
```

Survey first:

```powershell
python scripts/survey_paulo_community_ownership.py
```

Dry-run execute:

```powershell
python scripts/execute_paulo_ownership_transfer.py --dry-run
```

Execute only after reviewing the survey and backup ID:

```powershell
python scripts/execute_paulo_ownership_transfer.py --yes-i-have-backup
```

Verification SQL:

```sql
SELECT COUNT(*) AS paulo_owned
  FROM communities
 WHERE LOWER(creator_username) = 'paulo';

SELECT c.id, c.name, u.username, uc.role
  FROM communities c
  JOIN user_communities uc ON uc.community_id = c.id
  JOIN users u ON u.id = uc.user_id
 WHERE LOWER(c.creator_username) = 'admin'
   AND LOWER(u.username) IN ('paulo', 'admin')
 ORDER BY c.id, u.username;
```

The scripts leave Stripe customer/subscription IDs unchanged. That is
intentional: platform ownership and paying Stripe customer are separate
fields.

---

## 5. Running manual QA + the automated harness

See `docs/QA_CHECKLIST.md` for the 10-section manual run. In addition,
run the QA harness on any staging deploy that touches
`backend/services/entitlements.py`, `backend/services/ai_usage.py`,
or `bodybuilding_app.py:ensure_free_parent_member_capacity`:

```powershell
$env:MYSQL_PASSWORD = (gcloud secrets versions access latest --secret=mysql-password)
$env:MYSQL_HOST = "34.78.168.84"
$env:MYSQL_USER = "app_user"
$env:MYSQL_DB   = "cpoint"

python scripts/run_qa_verification.py
```

Expected: `36 PASS, 0 FAIL`. The harness:

- Re-resolves entitlements for the 4 `test_*` personas (§8).
- Seeds 25 synthetic members onto a throwaway Free community, asserts
  the 26th raises `CommunityMembershipLimitError` with the correct
  "up to 25 members" wording (§10).
- Seeds 5 per-surface `ai_usage_log` rows for `test_premium`, asserts
  `current_month_summary.by_surface` buckets them, and confirms the KB
  `internal_weights` round-trip to `resolve_entitlements` identically
  (Scope A).
- Reports cost-drift for real rows from the last 7 days (Scope A report).
- Cleans up every row it inserted in a `finally` block, even on failure.

The harness talks to the same DB as prod (see §6), so rerun it right
after a deploy before pushing UI work that depends on the entitlements
dict shape.

---

## 6. Shared staging/prod DB — permanent caveat

`cpoint-app-staging` and `cpoint-app` are two Cloud Run services that
point at the **same** Cloud SQL instance, **same** database, **same**
credentials. This is not an accident — it was the cheapest path early
and we kept it because the rollout cadence is low.

Consequences — internalise these:

- Any write you make via the **staging** URL lands in production data.
  "Staging" here is strictly a code-isolation boundary, not a data one.
- Any schema migration that ships via staging deploy hits prod
  immediately (there are no separate migrations for staging).
- Long-running QA flows (seeding `qa_member_*` users, inserting rows
  into `ai_usage_log`) must **clean up after themselves**. The
  harness in §5 is careful about this; anything else you build
  should follow the same `try/finally` shape.
- User reset, trial-window edits, mass promotions → see §2 and §3.
  Always backup first.

If/when we outgrow this, the right move is to spin up a
`cpoint-db-staging` instance, point `cpoint-app-staging` at it, and
seed it nightly from a prod backup. Not blocking today.

---

## 7. Cost privacy principle

**Users must not be able to compute their AI cost.** The €3.99 monthly
spend ceiling, per-token USD rates, tool-call USD rates, internal
credit weights, and cumulative `total_cost_usd` are internal-only
pricing primitives. Leaking them lets users reverse-engineer our
unit economics and erodes the "Premium includes Steve" pitch.

Today (2026-04-20) these fields **are** exposed to any logged-in user
via `/api/me/entitlements` and `/api/me/ai-usage`:

- `monthly_spend_ceiling_eur`
- `internal_weights`
- `total_cost_usd`
- `total_tokens_in` / `total_tokens_out`

That's a P1 leak. It's tracked under the §9 backlog item. The gating
itself does **not** depend on these fields being visible — only the
current admin-web Calculator page does (and admins must see them).
Any new user-facing endpoint must not add cost-bearing fields to its
JSON; always use counts (`steve_call_count`, `whisper_minutes`) and
opaque caps (`steve_uses_per_month`, `whisper_minutes_per_month`).

When the ceiling is enforced in code (see §9), the block message must
use the existing `REASON_MONTHLY_STEVE_CAP` string so users see the
same "monthly Steve limit reached" UX and never see euros/dollars.

---

## 8. Today's state (snapshot, 2026-04-20)

- Code shipped to both Cloud Run services on **2026-04-20 18:xx UTC**,
  `main` HEAD at that time (see `git log --oneline --since=2026-04-19`).
- User reset executed **2026-04-20 19:xx UTC**. Pre-reset Cloud SQL
  backup: `pre-reset-20260420-1912` (retained per GCP defaults).
- Exempt users after reset: `paulo`, `admin`, `steve`. All three
  preserved their original `subscription` / `is_special` / `created_at`.
- All other users: `subscription='free'`, `is_special=0`, all enterprise
  seats closed, `created_at=NOW()` (so everyone has 30 days of Trial
  from 2026-04-20).
- KB **`user-tiers`** page was auto-seeded from code defaults at first
  bootstrap on 2026-04-20 19:57. The seed value of
  `free_members_per_owned_community = 50` was patched live to `25` on
  2026-04-20 at QA time (v2 via `kb.save_page`, actor `system-qa`) so
  the resolver returns 25 and the 26th-member block fires correctly.
  Code default in `entitlements._DEFAULTS` is now 25 as well so any
  future bootstrap agrees with the KB.

---

## 9. Backlog (scope for next ops/PR session)

Prioritised. Pick the top item when capacity opens up.

### 9.1 [P1] Spend-ceiling enforcement + user-API privacy scrub

Scope (one PR, no schema changes):

- In `backend/services/entitlements_gate.py::check_steve_access`, add
  a 5th check **after** the existing four (tier, daily, monthly-count,
  whisper): if `SUM(cost_usd)` for the current calendar month exceeds
  `ent["monthly_spend_ceiling_eur"] * usd_to_eur_rate`, block with
  `REASON_MONTHLY_STEVE_CAP` (**not** a new cost-specific reason —
  see the cost privacy principle in §7).
- Add `backend/services/ai_usage.py::monthly_spend_usd(username)`
  helper. Query: `SUM(cost_usd) FROM ai_usage_log WHERE username=?
  AND success=1 AND created_at >= first-of-current-month-UTC`.
- Strip the following fields from every user-facing API response
  under `/api/me/*` (they should only appear in admin-web endpoints
  that already require `require_admin()`):
  - `/api/me/entitlements`: remove `monthly_spend_ceiling_eur`,
    `internal_weights`, any `*_usd` field.
  - `/api/me/ai-usage`: remove `total_cost_usd`, `total_tokens_in`,
    `total_tokens_out`, and any nested cost keys. Keep
    `by_surface`, counts, and minutes.
- Add a regression test in `tests/test_entitlements_gate.py`:
  `test_spend_ceiling_blocks_when_monthly_cost_exceeded` that
  inserts a `SUM(cost_usd) = 4.00 EUR`-equivalent set of rows and
  asserts `check_steve_access` returns `(False, reason=..., 429, ...)`.
- Update `admin-web/src/pages/Calculator.tsx` only if it consumed the
  now-stripped `/api/me/*` fields; it should use the admin-only
  `/api/admin/ai-usage-summary` path instead.

Estimated effort: 1 agent session (~45 min).

### 9.2 [P2] Client-side entitlements refresh-on-focus

When an admin flips a user's tier via the Users tab, that user's UI
currently shows stale caps until they hard-reload. Add a
refocus/visibilitychange listener in `client/src/hooks/useEntitlements.ts`
that re-fetches when the tab gains focus (debounced to once per 60s).
No backend changes.

### 9.3 [P2] Weighted user-facing AI counter

The `internal_weights` in the KB are used by the admin Calculator but
**not** applied to the user-facing `steve_call_count` — users see raw
counts. A `group` message and a `dm` message cost the user the same
"Steve use", even though they cost us 3× and 1× internally. This is
fine for the current pricing (€3.99 ceiling protects us) but caps
the upside of dynamic weighting. Future work: optionally compute
`weighted_calls` in `current_month_summary` and gate on that; keep
the raw counter for "5 of 100 this month" UX.

### 9.4 [P3] Separate staging DB

See §6. Not blocking, tracked for when usage or incident-risk grows.

### 9.5 Subscriptions UI — Step E (shipped) & deferred follow-ups

Step E shipped the subscriptions hub at `/subscription_plans` as a KB-driven
commerce surface. Two SKUs are live, two ship as "Coming soon" cards.

**Live today:**

- **User Premium Membership** — personal Steve (`users.subscription='premium'`).
  Monthly Checkout via `POST /api/stripe/create_checkout_session` with
  `plan_id='premium'`. Stripe price ID lives in KB
  (`user-tiers.premium_stripe_price_id_{test,live}`).
- **Community Paid Tier (L1 / L2 / L3)** — community-level
  (`communities.tier='paid_l{1,2,3}'`). Community owner initiates
  Checkout with `plan_id='community_tier'`, `community_id`, `tier_code`.
  Prices live in KB (`community-tiers.paid_l{1,2,3}_stripe_price_id_{test,live}`).
  Owner's personal `users.subscription` is deliberately **not** flipped
  by a community-tier purchase — C-Point monetizes on two independent axes.

**"Coming soon" (deferred, no live checkout):**

- **Steve Community Package** — shared community credit pool. KB fields in
  `community-tiers.paid_steve_package_*` already exist. Deferred: live
  checkout + pool-allocation fulfillment.
- **Networking Package** — directory listing add-on. KB fields in
  `networking-page.networking_page_*` already exist. Deferred: live
  checkout + `communities.on_networking_page` flag fulfillment.
- **Premium Yearly price** — field reserved on `user-tiers`; no Stripe
  price yet.
- **Apple / Google IAP** — webhook stubs in
  `backend/blueprints/subscription_webhooks.py` log events to the audit
  table but don't yet mutate `users.subscription`. Needs the IAP link
  table (original_transaction_id ↔ username) from a later mobile ticket.

**KB-driven pricing pattern (mandatory for new SKUs):**

- **Source of truth is the KB**, not env vars. Every purchasable SKU
  stores its Stripe price ID in `kb_pages.fields_json` with `_test` and
  `_live` suffixes. Never hardcode price IDs in blueprints or the client.
- **Mode filtering is server-side.** `GET /api/kb/pricing` reads
  `STRIPE_API_KEY` at request time — `sk_test_*` → emits `*_test` fields,
  `sk_live_*` → emits `*_live`. The opposite mode's ID is stripped
  before the response leaves the server, so a misconfigured prod can't
  leak a live-mode ID to a staging client (or vice versa).
- **Admin-editable without redeploy.** When a new Stripe price is
  created, admin-web `KnowledgeBase.tsx` pastes the ID into the right
  field and `/subscription_plans` reflects immediately on next load.
  No Flask restart, no build, no PR.
- **Fallback envs are the exception, not the rule.** Only Premium has
  `STRIPE_PRICE_PREMIUM_MONTHLY` / `_YEARLY` env fallbacks — legacy
  from before KB seeding landed. Community tiers have no env fallback
  by design (the KB is the contract).
- **New SKU checklist:**
  1. Add `*_stripe_price_id_test` / `*_live` fields to the relevant KB
     page in `backend/services/knowledge_base.py`.
  2. Extend `backend/blueprints/subscriptions.py::api_kb_pricing` to
     emit the SKU's card payload (strip internal/calculator fields).
  3. Extend `api_stripe_create_checkout_session` to dispatch on the new
     `plan_id`; put preflight gates (ownership, cap fit, duplicate sub)
     next to the existing `_preflight_community_tier` helper.
  4. Add a webhook dispatch branch in
     `backend/blueprints/subscription_webhooks.py::stripe_webhook` keyed
     on `metadata.sku` — keep the DB writes in a service module
     (`backend/services/community_billing.py` pattern), not in the
     blueprint.
  5. Add tests: `tests/test_kb_pricing_endpoint.py`,
     `tests/test_stripe_*_checkout.py`,
     `tests/test_stripe_webhook_*.py`, client RTL smoke.

**Operational runbook when a Stripe price changes:**

1. Create the new Stripe **Product + Price** in dashboard (test mode
   first). Copy the `price_...` ID.
2. In admin-web KB editor, open the relevant page (`Community Tiers`,
   `User Tiers`, or `Networking Page`), paste the new ID into the
   matching `*_stripe_price_id_test` field, save with a change reason
   (the KB changelog makes this audit-loggable).
3. Visit `/subscription_plans` — the new price is live immediately.
4. Repeat in production with the live-mode ID once staging e2e passes.

**Never set the live price ID on staging or vice versa** — the mode
filter will simply hide it, but having live IDs in a staging DB makes
incident triage harder.

---

## Appendix — File index

| Area | File |
|---|---|
| Entitlements logic | `backend/services/entitlements.py` |
| Steve/Whisper gate | `backend/services/entitlements_gate.py` |
| AI usage logging & counters | `backend/services/ai_usage.py` |
| KB defaults & persistence | `backend/services/knowledge_base.py` |
| Community + member limits | `bodybuilding_app.py` (`ensure_free_parent_member_capacity`, `/create_community`) |
| User-API endpoints | `backend/blueprints/me.py` |
| Admin-API endpoints | `backend/blueprints/admin.py` |
| Subscriptions (Stripe Checkout + pricing) | `backend/blueprints/subscriptions.py` |
| Subscription webhooks (Stripe/Apple/Google) | `backend/blueprints/subscription_webhooks.py` |
| Community-level Stripe state | `backend/services/community_billing.py` |
| Subscriptions hub (client) | `client/src/pages/SubscriptionPlans.tsx` |
| Post-checkout landing (client) | `client/src/pages/Success.tsx` |
| QA harness | `scripts/run_qa_verification.py` |
| QA manual checklist | `docs/QA_CHECKLIST.md` |
| Reset survey | `scripts/preflight_reset_survey.py` |
| Reset execute | `scripts/execute_user_reset.py` |
| Test user seeder | `scripts/seed_staging_test_users.py` |
| Test user teardown | `scripts/teardown_staging_test_users.py` |
| Smoke script | `scripts/staging_smoke.ps1` |
