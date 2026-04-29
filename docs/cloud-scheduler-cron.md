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
```

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
           event-reminder-dispatch kb-weekly-synthesis steve-reminder-vault-dispatch; do
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
