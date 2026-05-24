# Production Cloud Run recovery runbook (`cpoint-app` / `app.c-point.co`)

> **For AI agents and operators.** Use when production “looks up” but the app cannot log in, welcome cards are empty, or APIs return `Server error` while **staging works**.

**Service:** `cpoint-app` · **Region:** `europe-west1` · **Project:** `cpoint-127c2`
**User-facing host:** `https://app.c-point.co`
**Staging (healthy reference):** `https://cpoint-app-staging-739552904126.europe-west1.run.app`

---

## Symptoms → likely cause

| Symptom | Likely cause |
|---------|----------------|
| Welcome page: no carousel images; `/welcome_cards` returns `"success": false` | **MySQL env broken** — almost always missing `MYSQL_PASSWORD` on `cpoint-app` |
| Login: “Server error. Please try again.” on username step | **DB connection failure** (same as above) |
| Login: password accepted then back to login / blank dashboard | **Session cookies** — missing `FLASK_SECRET_KEY`, bad `SESSION_COOKIE_DOMAIN`, or stale cookies after secret rotation |
| `/health` returns healthy but everything else fails | **DB not checked by health** — do not use `/health` alone as “prod OK” |
| Staging works; prod broken; you only changed Capacitor `server.url` | **Prod misconfig exposed**, not caused by the mobile build |

---

## 60-second diagnosis (run from any machine with `curl`)

```bash
curl -sS https://app.c-point.co/welcome_cards
```

| Response | Meaning |
|----------|---------|
| `"success":true` | MySQL wiring on prod is **OK** (continue to session/login section if users still can’t log in) |
| `"success":false` or empty | **Stop** — fix secrets first (§ Fix A) |

```bash
curl -sS https://app.c-point.co/health
```

Healthy here does **not** prove the database works.

**Automated checks:** `bash scripts/smoke_prod.sh` or `pwsh scripts/smoke_prod.ps1`

---

## Root cause (May 2026 incident)

1. **`cloudbuild-production.yaml` deployed only the Docker image** — it did not mount Secret Manager env vars. A console or image-only revision left `cpoint-app` with `MYSQL_HOST` / `MYSQL_USER` / `MYSQL_DB` but **no `MYSQL_PASSWORD`**.
2. After secrets were restored manually, **`FLASK_SECRET_KEY`** from Secret Manager invalidated old `cpoint_session` cookies; **`SESSION_COOKIE_DOMAIN`** behaviour differed from staging (`run.app` vs `app.c-point.co`).
3. Code fixes shipped: host-only cookies for `app.c-point.co`, explicit session save on login, legacy cookie clearing (`backend/services/auth_session.py`, `backend/blueprints/auth.py`).

---

## Fix A — Restore Secret Manager bindings (most common)

**Compare prod vs staging:**

```bash
gcloud run services describe cpoint-app --region=europe-west1 --project=cpoint-127c2 \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -E "MYSQL_PASSWORD|FLASK_SECRET|name:"

gcloud run services describe cpoint-app-staging --region=europe-west1 --project=cpoint-127c2 \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -E "MYSQL_PASSWORD|FLASK_SECRET|name:"
```

Prod **must** include `MYSQL_PASSWORD` (and peers) as `valueFrom.secretKeyRef`, not only plain `value:` entries.

**One-command repair (repo root):**

```bash
bash scripts/wire_prod_cloud_run_secrets.sh
```

**Verify:**

```bash
bash scripts/smoke_prod.sh
```

### Required production secrets (Secret Manager → env)

| Env var | Secret name |
|---------|-------------|
| `MYSQL_PASSWORD` | `mysql-password` |
| `FLASK_SECRET_KEY` | `flask-secret-key` |
| `CLOUDFLARE_R2_SECRET_KEY` | `r2-secret-key` |
| `VAPID_PRIVATE_KEY` | `vapid-private-key` |
| `RESEND_API_KEY` | `resend-api-key` |
| `OPENAI_API_KEY` | `openai-api-key` |
| `REDIS_PASSWORD` | `redis-password` |
| `CRON_SHARED_SECRET` | `cron-shared-secret` (not `*-staging`) |
| `STRIPE_API_KEY` | `stripe-api-key` |
| `STRIPE_PUBLISHABLE_KEY` | `stripe-publishable-key` |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook-secret` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | `google-play-service-account-json` |

Stripe-only updates: `scripts/wire_prod_stripe_secrets.ps1` (run **after** the table above is wired).

### Required production secret files / Cloud SQL connector

`scripts/wire_prod_cloud_run_secrets.sh` must also preserve file mounts
and the Cloud SQL connector path:

| Runtime path / env var | Source |
|------------------------|--------|
| `FIREBASE_CREDENTIALS=/secrets/firebase/credentials.json` | Secret file `firebase-credentials:latest` |
| `APNS_KEY_PATH=/secrets/apns/key.p8` | Secret file `apns-key:latest` |
| `MYSQL_UNIX_SOCKET=/cloudsql/cpoint-127c2:europe-west1:cpoint-db` | Cloud Run Cloud SQL mount |

If `FIREBASE_CREDENTIALS` points at a missing file, push
notifications/Firestore startup will log `Credentials path does not
exist`. If MySQL connects to the public IP and times out, verify the
Cloud SQL annotation and `MYSQL_UNIX_SOCKET` are present on `cpoint-app`.

**Do not set** `SESSION_COOKIE_DOMAIN=app.c-point.co` (invalid). For `CANONICAL_HOST=app.c-point.co` the app uses **host-only** session cookies (see `bodybuilding_app.py`).

---

## Fix B — Login works on server but app stays logged out

**Cloud Logging** (filter `cpoint-app`):

```
login_password ok
No username in session
```

**Meaning:** Password check passed; session cookie not persisted or not decoded.

**Actions:**

1. Ensure **Fix A** includes `FLASK_SECRET_KEY=flask-secret-key:latest`.
2. Confirm deployed image includes session fixes (`_finalize_session_response`, host-only cookie for `app.c-point.co`). Redeploy if needed:
   `gcloud builds submit --config=cloudbuild-production.yaml --project=cpoint-127c2 .`
3. Ask user to **force-quit the app** or clear site data for `app.c-point.co` (stale `cpoint_session` cookies).
4. Compare login `Set-Cookie` from prod vs staging — prod should **not** use `Domain=app.c-point.co`.

---

## Fix C — Deploy production safely (prevention)

Every production backend deploy should:

1. Build and deploy image **and** wire secrets (see `cloudbuild-production.yaml` — includes `wire_prod_cloud_run_secrets.sh` + `smoke_prod.sh`).
2. Pass smoke: `bash scripts/smoke_prod.sh`
3. Manual QA: login on `https://app.c-point.co/login` in Safari, then in the Capacitor app.

**Never** treat “deploy succeeded” as “prod is healthy” without `welcome_cards` + login checks.

---

## What not to do

- Do not debug Capacitor `server.url` until `welcome_cards` returns `"success":true`.
- Do not copy staging Stripe secrets (`*-staging`) onto prod.
- Do not paste live API keys as plain Cloud Run env vars — use Secret Manager (see `docs/OPERATIONS.md` § Stripe).
- Do not use `/health` as the only post-deploy check.

---

## Related docs

- **`docs/DEPLOYMENT_INSTANCES.md`** — service names, Capacitor prod URL, deploy commands
- **`docs/OPERATIONS.md`** — shared DB caveat, Stripe wiring, CSRF
- **`docs/QA_CHECKLIST.md`** — manual QA after auth/deploy changes
- **`AGENTS.md`** — living docs triggers

---

## Changelog

| Date | Event |
|------|--------|
| 2026-05-21 | Incident: missing prod secrets + session cookies; recovery scripts and Cloud Build hardening added |
