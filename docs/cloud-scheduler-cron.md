# Cloud Scheduler — entitlements & lifecycle cron jobs

The entitlements stack exposes authenticated cron endpoints on the backend
that must be invoked on a schedule. In production these are driven by
[Cloud Scheduler](https://cloud.google.com/scheduler) hitting the Cloud
Run service URL.

All endpoints reject unauthenticated requests. Auth is a shared secret
passed in the `X-Cron-Secret` header and validated against the
`CRON_SHARED_SECRET` env var on the Cloud Run service.

## 1. Generate + store the shared secret

```bash
# 32-byte random, base64 — keep a copy in your password manager too.
CRON_SECRET=$(openssl rand -base64 32)

gcloud secrets create cron-shared-secret --replication-policy=automatic
printf "%s" "$CRON_SECRET" | gcloud secrets versions add cron-shared-secret --data-file=-

# Grant the Cloud Run service account read access.
gcloud secrets add-iam-policy-binding cron-shared-secret \
  --member="serviceAccount:$(gcloud run services describe cpoint-backend \
      --region=europe-west1 --format='value(spec.template.spec.serviceAccountName)')" \
  --role=roles/secretmanager.secretAccessor
```

Then wire it into the Cloud Run service as an env var:

```bash
gcloud run services update cpoint-backend \
  --region=europe-west1 \
  --update-secrets=CRON_SHARED_SECRET=cron-shared-secret:latest
```

Repeat for `cpoint-backend-staging` with a *different* secret so leaks in
one env can't be used against the other.

## 2. Create the Scheduler jobs

All jobs target the backend's base URL (replace with your Cloud Run URL):

```bash
BASE=https://cpoint-backend-XXXXX-ew.a.run.app
SECRET=$CRON_SECRET  # from step 1, or gcloud secrets versions access

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

Replicate every job for the staging service (`cpoint-backend-staging`)
using a different `CRON_SHARED_SECRET`. Prefix job names with `staging-`
so the lists don't collide in the console.

## 6. Shutting it off

To pause all entitlements-related lifecycle jobs (e.g. during a DB
migration), run:

```bash
for job in enterprise-grace-sweep enterprise-iap-nag enterprise-winback-expire \
           subscriptions-revoke-expired usage-cycle-notify; do
  gcloud scheduler jobs pause "$job" --location=europe-west1
done
```

Resume with `gcloud scheduler jobs resume ...`.
