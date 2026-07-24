# Cloud Scheduler — entitlements & lifecycle cron jobs

The entitlements stack exposes authenticated cron endpoints on the backend
that must be invoked on a schedule. In production these are driven by
[Cloud Scheduler](https://cloud.google.com/scheduler) hitting the Cloud
Run service URL.

All endpoints reject unauthenticated requests. Auth is a shared secret
passed in the `X-Cron-Secret` header and validated against the
`CRON_SHARED_SECRET` env var on the Cloud Run service.

**Current prod/staging services and secrets (as of 2026-04):**

| Env | Cloud Run service | Canonical run.app URL | Secret in Secret Manager |
|---|---|---|---|
| Production | `cpoint-app` | `https://cpoint-app-739552904126.europe-west1.run.app` | `cron-shared-secret` |
| Staging | `cpoint-app-staging` | `https://cpoint-app-staging-739552904126.europe-west1.run.app` | `cron-shared-secret-staging` |

The custom domain `https://app.c-point.co` also reaches production, but
Cloud Scheduler should hit the `run.app` URL directly because the custom
domain 301-redirects and Scheduler does not preserve POST across redirects.

## 1. Generate + store the shared secret

```bash
# 32-byte random, base64 — keep a copy in your password manager too.
CRON_SECRET=$(openssl rand -base64 32)

gcloud secrets create cron-shared-secret --replication-policy=automatic
printf "%s" "$CRON_SECRET" | gcloud secrets versions add cron-shared-secret --data-file=-

# Grant the Cloud Run service account read access.
gcloud secrets add-iam-policy-binding cron-shared-secret \
  --member="serviceAccount:$(gcloud run services describe cpoint-app \
      --region=europe-west1 --format='value(spec.template.spec.serviceAccountName)')" \
  --role=roles/secretmanager.secretAccessor
```

Then wire it into the Cloud Run service as an env var (this creates a new
revision — expect ~60s of rolling traffic shift):

```bash
gcloud run services update cpoint-app \
  --region=europe-west1 \
  --update-secrets=CRON_SHARED_SECRET=cron-shared-secret:latest
```

Repeat for `cpoint-app-staging` using `cron-shared-secret-staging` with a
*different* secret value so leaks in one env can't be used against the
other.

## 2. Create the Scheduler jobs

All jobs target the backend's base URL (replace with your Cloud Run URL):

```bash
BASE=https://cpoint-app-739552904126.europe-west1.run.app
SECRET=$(gcloud secrets versions access latest --secret=cron-shared-secret)

# Grace-window sweep — closes seats whose grace has expired.
# Runs every 15 min so the UX of "Steve paused" lands promptly.
gcloud scheduler jobs create http enterprise-grace-sweep \
  --location=europe-west1 \
  --schedule="*/15 * * * *" \
  --time-zone=UTC \
  --uri="$BASE/api/cron/enterprise/grace-sweep" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=60s

# Daily IAP nag dispatch — hits the 09:00 Dublin window.
gcloud scheduler jobs create http enterprise-iap-nag \
  --location=europe-west1 \
  --schedule="0 9 * * *" \
  --time-zone=Europe/Dublin \
  --uri="$BASE/api/cron/enterprise/nag-dispatch" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=120s

# Winback token expiry — daily at 03:00 UTC (low traffic window).
gcloud scheduler jobs create http enterprise-winback-expire \
  --location=europe-west1 \
  --schedule="0 3 * * *" \
  --time-zone=UTC \
  --uri="$BASE/api/cron/enterprise/winback-expire" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=60s

# Defensive personal-Premium revocation — IAP subs whose renewal webhook
# never reached us get flipped to Free after 35 days.
gcloud scheduler jobs create http subscriptions-revoke-expired \
  --location=europe-west1 \
  --schedule="15 3 * * *" \
  --time-zone=UTC \
  --uri="$BASE/api/cron/subscriptions/revoke-expired" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=300s

# Usage-cycle warnings — identifies users near their Steve caps and queues
# 80% / 95% notifications (delivered by the push/email layer).
gcloud scheduler jobs create http usage-cycle-notify \
  --location=europe-west1 \
  --schedule="30 */6 * * *" \
  --time-zone=UTC \
  --uri="$BASE/api/cron/usage/cycle-notify" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=300s

# AI usage daily rollup — aggregates yesterday's ai_usage_log into
# ai_usage_daily_rollups (admin metrics). Daily at 02:15 UTC.
gcloud scheduler jobs create http ai-usage-daily-rollup \
  --location=europe-west1 \
  --schedule="15 2 * * *" \
  --time-zone=UTC \
  --uri="$BASE/api/cron/ai-usage/daily-rollup" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=300s

# Community lifecycle warnings — fires pre-archive warnings for Free
# communities (day 75, day 88) and purge reminders for archived Free
# communities (day 300). Daily at 10:05 Europe/Dublin so warnings land
# in the owner's inbox during waking hours.
#
# Kill switches (use either depending on urgency):
#   * Fast (no code deploy): flip the KB field
#     community_lifecycle_notifications_enabled → False on the
#     "community-tiers" KB page. The endpoint still returns 200 with
#     dry_run: true counts — great for verifying the flag flipped.
#   * Full pause: `gcloud scheduler jobs pause communities-lifecycle-dispatch`
#
# Dry-run from the CLI:
#   curl -X POST "$BASE/api/cron/communities/lifecycle-dispatch?dry_run=1" \
#     -H "X-Cron-Secret: $CRON_SECRET"
gcloud scheduler jobs create http communities-lifecycle-dispatch \
  --location=europe-west1 \
  --schedule="5 10 * * *" \
  --time-zone=Europe/Dublin \
  --uri="$BASE/api/cron/communities/lifecycle-dispatch" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=300s

# Rolling welcome summaries — once a week, Steve posts one batched summary
# of newly joined members per community/window. Dry-run:
#   curl -X POST "$BASE/api/cron/communities/rolling-welcome?dry_run=1" \
#     -H "X-Cron-Secret: $CRON_SECRET"
gcloud scheduler jobs create http communities-rolling-welcome \
  --location=europe-west1 \
  --schedule="30 10 * * MON" \
  --time-zone=Europe/Dublin \
  --uri="$BASE/api/cron/communities/rolling-welcome" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=300s

# Retained story media purge — deletes story objects after they have been
# invisible for 7 days. Daily at 02:40 UTC, after the low-traffic expiry
# window. Dry-run:
#   curl -X POST "$BASE/api/cron/media/purge-retained-stories?dry_run=1" \
#     -H "X-Cron-Secret: $CRON_SECRET"
gcloud scheduler jobs create http media-purge-retained-stories \
  --location=europe-west1 \
  --schedule="40 2 * * *" \
  --time-zone=UTC \
  --uri="$BASE/api/cron/media/purge-retained-stories" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=300s

# Chat upload session janitor — aborts expired multipart sessions stuck in
# `initiated` state. Daily at 03:10 UTC. Dry-run:
#   curl -X POST "$BASE/api/cron/chat-uploads-janitor?dry_run=1" \
#     -H "X-Cron-Secret: $CRON_SECRET"
gcloud scheduler jobs create http chat-uploads-janitor \
  --location=europe-west1 \
  --schedule="10 3 * * *" \
  --time-zone=UTC \
  --uri="$BASE/api/cron/chat-uploads-janitor" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=300s

# Underage account purge — permanently deletes accounts that declared under 18
# and whose 7-day grace period (``underage_delete_scheduled_at``) has passed.
# Option A age gate — see docs/COMPLIANCE_AGE_GATE.md.
# Daily at 03:30 UTC (low-traffic window). Response returns counts only in
# production (no usernames). Dry-run:
#   curl -X POST "$BASE/api/cron/purge-underage?dry_run=1" \
#     -H "X-Cron-Secret: $CRON_SECRET"
gcloud scheduler jobs create http purge-underage \
  --location=europe-west1 \
  --schedule="30 3 * * *" \
  --time-zone=UTC \
  --uri="$BASE/api/cron/purge-underage" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=300s

# Event reminders — checks upcoming calendar events and sends the configured
# 1-week, 1-day, and 1-hour reminders. The endpoint dedupes per
# event/user/reminder type and supports dry-run:
#   curl -X POST "$BASE/api/cron/events/reminders?dry_run=1" \
#     -H "X-Cron-Secret: $CRON_SECRET"
gcloud scheduler jobs create http event-reminder-dispatch \
  --location=europe-west1 \
  --schedule="*/15 * * * *" \
  --time-zone=UTC \
  --uri="$BASE/api/cron/events/reminders" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=300s

# Onboarding profile reminders — sends the 24h and 48h gentle reminders
# for users who chose Finish later during profile onboarding. The endpoint
# dedupes with Firestore sent markers and supports dry-run:
#   curl -X POST "$BASE/api/cron/onboarding/reminders?dry_run=1" \
#     -H "X-Cron-Secret: $CRON_SECRET"
gcloud scheduler jobs create http onboarding-profile-reminders \
  --location=europe-west1 \
  --schedule="*/30 * * * *" \
  --time-zone=UTC \
  --uri="$BASE/api/cron/onboarding/reminders" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=120s

# Steve member KB — weekly auto-synthesis. Refreshes every active
# member's Knowledge Base once per calendar week by processing one of
# seven daily buckets keyed off CRC32(username) % 7 (today's
# day-of-week 0..6). Users with no post/reply in the last
# KB_ACTIVE_WINDOW_DAYS (default 7) are skipped, so "quiet weeks"
# cost nothing. This removes the need for the manual admin-dashboard
# trigger for routine upkeep.
#
# Kill switches:
#   * Fast (no code deploy): set env KB_WEEKLY_AUTO_ENABLED=false
#     on the Cloud Run service. Endpoint returns skipped=true with
#     reason=kb_weekly_auto_disabled.
#   * Full pause: `gcloud scheduler jobs pause kb-weekly-synthesis`
#
# Dry-run from the CLI (lists candidate usernames, doesn't synthesize):
#   curl -X POST "$BASE/api/cron/kb/weekly-synthesis?dry_run=1" \
#     -H "X-Cron-Secret: $CRON_SECRET"
#
# Schedule rationale: 03:30 UTC is low-traffic for all timezones; Grok
# latency (~5-15s per synthesis) and per-invocation cap
# (KB_WEEKLY_BATCH_MAX, default 200) mean a single run finishes in
# well under the attempt deadline for realistic rosters.
gcloud scheduler jobs create http kb-weekly-synthesis \
  --location=europe-west1 \
  --schedule="30 3 * * *" \
  --time-zone=UTC \
  --uri="$BASE/api/cron/kb/weekly-synthesis" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=900s

# Steve Builder reaper — reclaims async build jobs orphaned by a crashed
# worker / recycled Cloud Run instance. Requeues + re-dispatches jobs whose
# 10-min lease expired (if attempts remain), and terminally fails those past
# max_attempts (one block row + one notification). Idempotent — safe to run
# often. Every ~5 min keeps a stuck "building..." state short.
#   curl -X POST "$BASE/api/cron/builder/sweep" -H "X-Cron-Secret: $SECRET"
gcloud scheduler jobs create http builder-sweep \
  --location=europe-west1 \
  --schedule="*/5 * * * *" \
  --time-zone=UTC \
  --uri="$BASE/api/cron/builder/sweep" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=120s
```

```bash
# Builder creator play-digest — weekly "N people opened your creation"
# notification for gallery-listed creations. Zero-LLM (nothing to retry-burn),
# snapshot-idempotent (plays_digest_count advances only after a successful
# send), so at-least-once delivery is safe.
#   curl -X POST "$BASE/api/cron/builder/play-digest" -H "X-Cron-Secret: $SECRET"
gcloud scheduler jobs create http builder-play-digest \
  --location=europe-west1 \
  --schedule="0 17 * * 5" \
  --time-zone=UTC \
  --uri="$BASE/api/cron/builder/play-digest" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=120s
```

Note: the builder worker callback `/api/internal/builder/jobs/<id>/run` is
invoked by **Cloud Tasks** (not Scheduler) and accepts either `X-Cron-Secret`
(`CRON_SHARED_SECRET`) or a dedicated `X-Builder-Job-Secret` (`BUILDER_JOB_SECRET`).
See `docs/DEPLOYMENT_INSTANCES.md` for the Cloud Tasks queue env (`BUILDER_TASKS_QUEUE`,
`BUILDER_TASKS_LOCATION`, `PUBLIC_BASE_URL`); without it, builds fall back to a
non-durable in-process thread (logged at startup by `builder_async_health`).

## 3. Monitor the jobs

- `gcloud scheduler jobs list --location=europe-west1` — schedule + last status
- `gcloud scheduler jobs describe enterprise-iap-nag --location=europe-west1`
- Cloud Logging filter:
  `resource.type="cloud_scheduler_job" AND severity>=WARNING`
- Each endpoint returns `{"success": true, ...}` with counters the job log
  preserves, so use the request body in Logs Explorer to verify work.

## 4. Manual invocation (useful during incident response)

```bash
curl -fsS -X POST "$BASE/api/cron/enterprise/grace-sweep" \
  -H "X-Cron-Secret: $CRON_SECRET"
```

## 5. Staging

Replicate every job for the staging service (`cpoint-app-staging`) using
`cron-shared-secret-staging` for `X-Cron-Secret`. Prefix job names with
`staging-` so the lists don't collide in the console.

```bash
BASE_STAGING=https://cpoint-app-staging-739552904126.europe-west1.run.app
SECRET_STAGING=$(gcloud secrets versions access latest --secret=cron-shared-secret-staging)
# then: gcloud scheduler jobs create http staging-<name> --uri="$BASE_STAGING/..." --headers="X-Cron-Secret=$SECRET_STAGING" ...
```

## 6. Shutting it off

To pause all entitlements-related lifecycle jobs (e.g. during a DB
migration), run:

```bash
for job in enterprise-grace-sweep enterprise-iap-nag enterprise-winback-expire \
           subscriptions-revoke-expired usage-cycle-notify \
           communities-lifecycle-dispatch media-purge-retained-stories \
           chat-uploads-janitor purge-underage \
           event-reminder-dispatch kb-weekly-synthesis steve-reminder-vault-dispatch \
           group-steve-agent-due steve-trial-lifecycle; do
  gcloud scheduler jobs pause "$job" --location=europe-west1
done
```

Resume with `gcloud scheduler jobs resume ...`.

To do the same for staging, prefix each name with `staging-` in the loop.

## 7. Recipe: adding a new cron job

When you add a new `@app.route('/api/cron/...')` endpoint, ship it
end-to-end by following this sequence. The goal is that staging exercises
the endpoint for at least one fire cycle before prod, and that prod
registration happens only after a dry-run confirms the blast radius.

### 7.1 Backend endpoint checklist

The handler must:

1. Reject unauthenticated callers. Use the same `X-Cron-Secret` header +
   `CRON_SHARED_SECRET` env var pattern — or lift the helper used by
   existing cron endpoints so the check is uniform.
2. Accept `?dry_run=1` and return candidate counts with no side effects.
   This is what lets you measure blast radius before enabling on prod.
3. Return a JSON body shaped like `{"success": true, "scanned": N, ...}`
   with counters that answer "what did this run actually do?". Logs
   Explorer preserves the response body — these counters are the audit
   trail.
4. Respect a per-feature kill-switch env var (e.g.
   `KB_WEEKLY_AUTO_ENABLED`, `COMMUNITY_LIFECYCLE_NOTIFICATIONS_ENABLED`).
   When it's false, return `{"success": true, "skipped": true,
   "reason": "..."}` rather than 503 — Scheduler treats 5xx as a retry
   signal, and we don't want retries when a flag is intentionally off.

### 7.2 Register on staging first

```bash
BASE_STAGING=https://cpoint-app-staging-739552904126.europe-west1.run.app
SECRET_STAGING=$(gcloud secrets versions access latest --secret=cron-shared-secret-staging)

gcloud scheduler jobs create http staging-<name> \
  --location=europe-west1 \
  --schedule="<cron>" --time-zone=<tz> \
  --uri="$BASE_STAGING/api/cron/<path>" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET_STAGING" \
  --attempt-deadline=<seconds>s \
  --description="<one-line description>"
```

### 7.3 Dry-run smoke test

Hit the endpoint directly and sanity-check the counters:

```bash
curl.exe -s -X POST \
  "$BASE_STAGING/api/cron/<path>?dry_run=1" \
  -H "X-Cron-Secret: $SECRET_STAGING" --data "" \
  -w "`nHTTP_STATUS=%{http_code}`n"
```

Known quirks on Windows/PowerShell:
- Use `curl.exe` (not the PowerShell alias), or `Invoke-RestMethod` will
  strangle the headers.
- `--data ""` is required on POSTs — GFE returns 411 without a
  `Content-Length` header, and curl only sets one when a body is present.
- Hit the `*.run.app` URL directly. `https://app.c-point.co` redirects,
  and curl's default `-L` downgrades POST to GET on redirect.

### 7.4 Register on production

```bash
BASE_PROD=https://cpoint-app-739552904126.europe-west1.run.app
SECRET_PROD=$(gcloud secrets versions access latest --secret=cron-shared-secret)

gcloud scheduler jobs create http <name> \
  --location=europe-west1 \
  --schedule="<cron>" --time-zone=<tz> \
  --uri="$BASE_PROD/api/cron/<path>" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET_PROD" \
  --attempt-deadline=<seconds>s \
  --description="<one-line description>"
```

Before the first real fire, do one more `?dry_run=1` against prod to
catch any env-specific surprises (prod data != staging data). If the
blast radius is larger than expected, either:

- temporarily flip the feature's kill-switch env var off on the Cloud
  Run service, then re-deploy to land it; or
- `gcloud scheduler jobs pause <name>` and investigate.

### 7.5 Register the job name in §6's bulk-pause loop

Add the new job name to the `for job in ...` list above so the emergency
shutoff script covers it. Commit that change in the same PR as the
backend endpoint.

### 7.6 Don't forget

- **Monitor the first fire.** `gcloud scheduler jobs describe <name>`
  shows `lastAttemptTime` and `state`. If state becomes `FAILED`, check
  Cloud Logging for the response body.
- **Document the kill switch** in the job creation block above (the
  `kb-weekly-synthesis` and `communities-lifecycle-dispatch` blocks are
  good templates).
- **Two secrets, one per env.** Never point a staging-prefixed job at
  the prod secret or vice versa — the point of separate secrets is that
  a leak in one env can't be weaponised against the other.

## 8. Steve Reminder Vault dispatch

| Field | Value |
|-------|--------|
| **URI** | `{BASE}/api/cron/steve/reminder-vault-dispatch` |
| **Method** | `POST` |
| **Header** | `X-Cron-Secret` = same `CRON_SHARED_SECRET` as other crons |
| **Suggested schedule** | **Every minute** (`*/1 * * * *`, UTC) — short “in N minutes” nudges stay within about a minute after the due time (a 5‑minute cadence can delay by up to ~5 minutes). |

Example (staging `BASE`):

```bash
BASE=https://cpoint-app-staging-739552904126.europe-west1.run.app
SECRET=$(gcloud secrets versions access latest --secret=cron-shared-secret-staging)

gcloud scheduler jobs create http steve-reminder-vault-dispatch \
  --location=europe-west1 \
  --schedule="*/1 * * * *" \
  --time-zone=UTC \
  --uri="$BASE/api/cron/steve/reminder-vault-dispatch" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=120s
```

Update an existing prod/staging job to every minute:

```bash
gcloud scheduler jobs update http steve-reminder-vault-dispatch \
  --location=europe-west1 --schedule="*/1 * * * *" --time-zone=UTC

gcloud scheduler jobs update http staging-steve-reminder-vault-dispatch \
  --location=europe-west1 --schedule="*/1 * * * *" --time-zone=UTC
```

## 9. Group Steve agent — delayed first replies

| Field | Value |
|-------|--------|
| **URI** | `{BASE}/api/cron/group-steve-agent-due` |
| **Method** | `POST` |
| **Header** | `X-Cron-Secret` = same `CRON_SHARED_SECRET` as other crons |
| **Suggested schedule** | Every **1–5 minutes** (`*/5 * * * *`, UTC) — processes due rows in `group_steve_agent_schedule` (randomized 15m–2h delay from post time). |
| **Query** | `dry_run=1` — counts eligible due rows without deleting schedule rows or calling Steve. |

Add `group-steve-agent-due` to the bulk-pause list in §6 when you register the job in GCP.

## 10. Embedding index snapshot refresh

| Field | Value |
|-------|--------|
| **URI** | `{BASE}/api/cron/refresh_embedding_index` |
| **Method** | `POST` |
| **Header** | `X-Cron-Secret` = same `CRON_SHARED_SECRET` as other crons |
| **Suggested schedule** | Every **30 minutes** (`*/30 * * * *`, UTC) — rebuilds the in-memory profile embedding index from live Firestore and rewrites the private R2 snapshot (`backend/services/embedding_index_snapshot.py`) that cold Cloud Run instances boot from. Bounds snapshot staleness for new instances. |

```bash
gcloud scheduler jobs create http refresh-embedding-index \
  --location=europe-west1 \
  --schedule="*/30 * * * *" \
  --time-zone=UTC \
  --uri="$BASE/api/cron/refresh_embedding_index" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=300s
```

The snapshot is an accelerator, not a source of truth: if it is missing or
corrupt, networking falls back to the legacy Firestore stream on first use.

## 11. Owner weekly pulse (Steve's dashboard digest)

| Field | Value |
|-------|--------|
| **URI** | `{BASE}/api/cron/owner-weekly-pulse` |
| **Method** | `POST` |
| **Header** | `X-Cron-Secret` = same `CRON_SHARED_SECRET` as other crons |
| **Suggested schedule** | **Weekly, Monday 08:00 UTC** (`0 8 * * 1`) — one templated push + in-app row per community owner per ISO week, deep-linking to `/community/{id}/owner`. |
| **Query** | `dry_run=1` — lists candidate owners + this-week/prior-week active counts without reserving or sending. |
| **Kill switch** | env `OWNER_PULSE_ENABLED` must be truthy on the service for real sends (dry-run works regardless; a real run with the switch off returns 409). |

Idempotent by design: sends are reserved INSERT-first in `owner_pulse_sends`
(`UNIQUE(username, week_key)`), so Scheduler retries never double-push.
Quiet communities (zero active members this week) are skipped, owners with
several root networks get one pulse for their largest network, and copy is
resolved in the **recipient's** locale via `notification_copy`.

```bash
BASE=https://cpoint-app-staging-739552904126.europe-west1.run.app
SECRET=$(gcloud secrets versions access latest --secret=cron-shared-secret-staging)

# Smoke-test first:
curl -X POST "$BASE/api/cron/owner-weekly-pulse?dry_run=1" -H "X-Cron-Secret: $SECRET"

gcloud scheduler jobs create http owner-weekly-pulse \
  --location=europe-west1 \
  --schedule="0 8 * * 1" \
  --time-zone=UTC \
  --uri="$BASE/api/cron/owner-weekly-pulse" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=300s
```

Add `owner-weekly-pulse` to the bulk-pause list in §6 when you register the job in GCP.

## 12. Steve trial lifecycle — owner CTA notifications

| Field | Value |
|-------|--------|
| **URI** | `{BASE}/api/cron/steve-trial-lifecycle` |
| **Method** | `POST` |
| **Header** | `X-Cron-Secret` = same `CRON_SHARED_SECRET` as other crons |
| **Suggested schedule** | **Daily, 09:30 Europe/Dublin** (`30 9 * * *`) — lands in the owner's inbox during waking hours. |
| **Query** | `dry_run=1` — counts ending-soon / expired trial candidates without sending or writing audit rows. |
| **Kill switch** | env `OWNER_BILLING_CTAS_ENABLED=false` on the Cloud Run service → `{"success": true, "skipped": true}` (never 5xx, so Scheduler doesn't retry). Also mutes the gate-driven owner CTAs (member-blocked / pool-exhausted). |

Sweeps root communities whose Steve Community Package row is the synthetic
trial (`trial_pkg_<id>` / `trialing`, `backend/services/community_billing.py`)
and sends the owner one `owner_cta:steve_trial_ending` push + in-app row when
the period end is within 3 days, and one `owner_cta:steve_trial_expired` once
it has passed — each **once per community ever**, dedup'd via
`subscription_audit_log` (`owner_cta_steve_trial_*` actions), so Scheduler
retries never double-send. Copy resolves in the **recipient's** locale via
`notification_copy`; deep link is the add-on panel
(`/subscription_plans?open=community_addons&community_id=<id>`).
Service: `backend/services/owner_billing_ctas.py`.

```bash
# Staging first (staging- prefix + staging secret, per §5/§7):
BASE_STAGING=https://cpoint-app-staging-739552904126.europe-west1.run.app
SECRET_STAGING=$(gcloud secrets versions access latest --secret=cron-shared-secret-staging)

# Smoke-test the blast radius:
curl -X POST "$BASE_STAGING/api/cron/steve-trial-lifecycle?dry_run=1" -H "X-Cron-Secret: $SECRET_STAGING"

gcloud scheduler jobs create http staging-steve-trial-lifecycle \
  --location=europe-west1 \
  --schedule="30 9 * * *" \
  --time-zone=Europe/Dublin \
  --uri="$BASE_STAGING/api/cron/steve-trial-lifecycle" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET_STAGING" \
  --attempt-deadline=300s \
  --description="Owner CTA notifications for ending/expired Steve package trials"
```

Add `steve-trial-lifecycle` to the bulk-pause list in §6 when you register the job in GCP (already listed).

## 13. Member weekly digest (the member-side return loop)

| Field | Value |
|-------|--------|
| **URI** | `{BASE}/api/cron/member-weekly-digest` |
| **Method** | `POST` |
| **Header** | `X-Cron-Secret` = same `CRON_SHARED_SECRET` as other crons |
| **Suggested schedule** | **Weekly, Thursday 17:00 UTC** (`0 17 * * 4`) — offset from the Monday owner pulse so members and owners aren't pinged the same day. |
| **Query** | `dry_run=1` — lists candidate members + their most-active community without reserving or sending. `max_sends=N` throttles a run (default 500). |
| **Kill switch** | env `MEMBER_DIGEST_ENABLED` must be truthy for real sends — **off by default and off on staging** (staging shares the prod Cloud SQL instance, so a staging run must never push to real members). Real run with the switch off returns 409; dry-run works regardless. |

One templated push + in-app row per member per ISO week (`member_digest_sends`,
INSERT-first `UNIQUE(username, week_key)`), for the member's community with the
most new posts by *other* people this week (≥ 3; own posts don't count; owners
are skipped — they get the pulse). Copy resolves in the **recipient's** locale
via `notification_copy` (`notifications.member_digest`); the deep link is
`/community_feed_react/{id}?source=weekly_digest_push` so tap-through lands in
`retention_events` (`digest_opened`) against the cron's `digest_sent` rows.
Service: `backend/services/member_digest.py`.

```bash
# Dry-run only until MEMBER_DIGEST_ENABLED is set on the target service:
BASE=https://cpoint-app-staging-739552904126.europe-west1.run.app
SECRET=$(gcloud secrets versions access latest --secret=cron-shared-secret-staging)

curl -X POST "$BASE/api/cron/member-weekly-digest?dry_run=1" -H "X-Cron-Secret: $SECRET"

# Register only when enabling for real (prod, after QA):
gcloud scheduler jobs create http member-weekly-digest \
  --location=europe-west1 \
  --schedule="0 17 * * 4" \
  --time-zone=UTC \
  --uri="$BASE/api/cron/member-weekly-digest" \
  --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" \
  --attempt-deadline=300s
```

Add `member-weekly-digest` to the bulk-pause list in §6 when you register the job in GCP.

## 14. Lifecycle emails (welcome, activation nudges, verification reminders)

Three jobs sharing one service (`backend/services/lifecycle_email_dispatch.py`)
and one reservation table (`lifecycle_email_sends`, INSERT-first
`UNIQUE(recipient, kind)`). Welcome + nudges go through the
`backend/services/lifecycle_email.py` chokepoint (consent check against
`email_preferences`, RFC 8058 `List-Unsubscribe` one-click headers, localized
unsubscribe/legal footer). The verification reminder is transactional (the
user started the signup) and bypasses consent, but is still capped at once
per address — and mints a **fresh** verification token, since the original
expires 24h after signup.

| Job | URI | Suggested schedule | Kill switch |
|-----|-----|--------------------|-------------|
| Welcome sweep | `{BASE}/api/cron/email/welcome` | every 20 min (`*/20 * * * *`) | `WELCOME_EMAIL_ENABLED` |
| Activation nudges | `{BASE}/api/cron/email/activation-nudges` | daily 10:00 Europe/Dublin (`0 10 * * *`) | `ACTIVATION_NUDGE_EMAIL_ENABLED` |
| Verification reminders | `{BASE}/api/cron/email/verification-reminders` | daily 11:00 Europe/Dublin (`0 11 * * *`) | `VERIFICATION_REMINDER_EMAIL_ENABLED` |

All three: `POST`, `X-Cron-Secret`, `dry_run=1` lists candidates without
reserving or sending, `max_sends=N` throttles (default 200). Real welcome /
nudge sends **additionally** require the master `LIFECYCLE_EMAIL_ENABLED` —
**off by default and off on staging** (staging shares the prod DB; a staging
run must never email real users). `EMAIL_LEGAL_ADDRESS` (physical postal
address, CAN-SPAM) must be set on the service before enabling in prod.

Cohorts: welcome = users rows created in the last 72h (owner variant for
organic signups, member variant anchored to the joined community for invited
users); no-community nudge = organic users 2–14 days old with zero
`user_communities` rows; empty-community nudge = root communities ≥ 96h old
whose only member is the owner and whose owner has no `invite_sent`
retention event; verification reminder = `pending_signups` rows 24h–7d old
with no matching users row. Cross-kind spacing: at most one lifecycle email
per recipient per 48h; each kind at most once ever. Every chokepoint send
logs a server-only `lifecycle_email_sent` retention event (`detail` = kind)
and every CTA carries `?source=lifecycle_email_<kind>`.

```bash
# Staging smoke (dry-run only; kill switches stay off on staging):
BASE=https://cpoint-app-staging-739552904126.europe-west1.run.app
SECRET=$(gcloud secrets versions access latest --secret=cron-shared-secret-staging)

curl -X POST "$BASE/api/cron/email/welcome?dry_run=1" -H "X-Cron-Secret: $SECRET"
curl -X POST "$BASE/api/cron/email/activation-nudges?dry_run=1" -H "X-Cron-Secret: $SECRET"
curl -X POST "$BASE/api/cron/email/verification-reminders?dry_run=1" -H "X-Cron-Secret: $SECRET"

# Prod registration (after QA + LIFECYCLE_EMAIL_ENABLED + EMAIL_LEGAL_ADDRESS set):
gcloud scheduler jobs create http email-welcome \
  --location=europe-west1 --schedule="*/20 * * * *" --time-zone=UTC \
  --uri="$BASE/api/cron/email/welcome" --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" --attempt-deadline=300s
gcloud scheduler jobs create http email-activation-nudges \
  --location=europe-west1 --schedule="0 10 * * *" --time-zone=Europe/Dublin \
  --uri="$BASE/api/cron/email/activation-nudges" --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" --attempt-deadline=300s
gcloud scheduler jobs create http email-verification-reminders \
  --location=europe-west1 --schedule="0 11 * * *" --time-zone=Europe/Dublin \
  --uri="$BASE/api/cron/email/verification-reminders" --http-method=POST \
  --headers="X-Cron-Secret=$SECRET" --attempt-deadline=300s
```

Add `email-welcome`, `email-activation-nudges`, and
`email-verification-reminders` to the bulk-pause list in §6 when you register
the jobs in GCP.
