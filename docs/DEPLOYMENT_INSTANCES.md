# Deployment instances & environments

> **Living doc:** When Cloud Build, Cloud Run names, `run.app`/custom domains, or staging–prod/env pairing changes—update this file in the **same PR**; see **`AGENTS.md` § Living engineering docs**.

GCP project: **`cpoint-127c2`**. Cloud Run region: **`europe-west1`**.

This maps **informal names** (“staging API”, “admin web”, “cpoint-web”) to **Cloud Run services**, domains, and build configs. For **founder operational** detail (backups, scripts, cost), see **[OPERATIONS.md](OPERATIONS.md)** §0–§6.

Out-of-repo or legacy names (`evalio`, `links` as separate cost centres) are called out in **OPERATIONS** — they are **not** this app’s deploy surface.

---

## Cloud Run services

| Service | Build config | Typical URL | Role |
|---------|--------------|------------|------|
| **`cpoint-app`** | `cloudbuild-production.yaml` → image `cpoint-app:latest` | **`https://cpoint-app-739552904126.europe-west1.run.app`**; users often enter via custom domain **`https://app.c-point.co`** (see [cloud-scheduler-cron.md](cloud-scheduler-cron.md)). | **Production Flask API** (`bodybuilding_app.py` + blueprints). Prod deploys and secret rewiring enforce `min-instances=1` to avoid cold starts. |
| **`cpoint-app-staging`** | `cloudbuild.yaml` → `cpoint-app-staging:latest` | **`https://cpoint-app-staging-739552904126.europe-west1.run.app`** | **Staging API** — same codebase. `min-instances` may be **0** (cold start acceptable); see **OPERATIONS** §0.2. |
| **`cpoint-admin`** | `cloudbuild-admin.yaml` | Cloud Run hostname for **admin SPA**; **OPERATIONS** references admin alongside the app (team may map **admin.c-point.co** at the edge). | Static **admin-web** build; API calls go to **`cpoint-app`** (check `admin-web/Dockerfile` build args). |
| **`cpoint-admin-staging`** | `cloudbuild-admin-staging.yaml` | Example: **`https://cpoint-admin-staging-739552904126.europe-west1.run.app`** (confirm in Console) | Staging **admin** — baked to talk to **`cpoint-app-staging`** (`VITE_API_BASE` / `API_PROXY_*` in `cloudbuild-admin-staging.yaml`). |
| **`cpoint-landing`** | `cloudbuild-landing.yaml` | Marketing / landing only. | Separate **`landing/`** app; no core product API. |

---

## How they differ (quick reference)

| Topic | Prod (`cpoint-app`) | Staging (`cpoint-app-staging`) |
|-------|---------------------|--------------------------------|
| **Purpose** | Live traffic, revenue, cron in prod. | Smoke tests, manual QA, experiments. |
| **Scale / cold start** | Warm (`min-instances` ≥ 1; production deploy and recovery commands set this explicitly). Cloud Run concurrency is `8` and `max-instances=2` to stay under the Redis Cloud Essentials connection cap; `REDIS_MAX_CONNECTIONS=4` bounds each instance pool. | Often 0 min instances → first request can cold-start. |
| **Cron** | Scheduler jobs use prod `run.app` URL + `cron-shared-secret`. | Staging jobs use staging URL + `cron-shared-secret-staging`. See [cloud-scheduler-cron.md](cloud-scheduler-cron.md). |
| **Admin pairing** | Admin prod build targets prod API. | Staging **API** sets **`CSRF_ALLOWED_ORIGINS`** to the **staging admin** origin (`cloudbuild.yaml` — the staging admin **`.run.app`** URL). |

**Shared DB caveat:** Both **`cpoint-app`** and **`cpoint-app-staging`** use the **same Cloud SQL instance** **`cpoint-db`** (same DB + credentials). Staging writes affect “prod” data — see **OPERATIONS** §6 before destructive ops.

---

## “cpoint-web” / client — not a Cloud Run service name

This repository does **not** define a Cloud Run service literally named `cpoint-web`. In conversation that usually means:

- **Web client** — Vite app in **`client/`**, shipped with the mobile shell (Capacitor). Production users load **`app.c-point.co`** (and related `c-point.co` hosts; see `client/src/utils/internalLinkHandler.ts`).
- **API target** — The SPA calls **`/api/…`** on **`cpoint-app`** in prod or **`cpoint-app-staging`** when pointed at staging (`client/capacitor.config.staging.ts`, env/build configuration).

So: **“web” = front-end artifact + hostname**, not a sixth Cloud Run backend name.

### Mobile Capacitor API host (store releases)

Store binaries must **not** load the staging Cloud Run URL. From `client/`:

| Profile | Command | `server.url` |
|---------|---------|----------------|
| **Production** (App Store / Play release) | `npm run cap:sync:prod` | `https://app.c-point.co` |
| **Staging** (internal QA) | `npm run cap:sync:staging` | `cpoint-app-staging-…run.app` |
| **Development** (bundled `webDir`) | `CPOINT_CAPACITOR_PROFILE=development npx cap sync` | omitted (Vite dev server / local) |

Android release builds also default `capacitor-server-inject.gradle` to **`https://app.c-point.co`**; override with `cpointCapacitorServerUrl` in `gradle.properties` for staging APKs.

Production IAP verification secrets (Cloud Run **`cpoint-app`**): `APPLE_IAP_*`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. See **`docs/STORE_BILLING_SETUP.md`**.

Before broad launch, set **`ENTITLEMENTS_ENFORCEMENT_ENABLED=true`** on production Cloud Run (staging should already match).

---

## Other infrastructure (short)

| Piece | Notes |
|-------|--------|
| **Firestore** | Database id commonly **`cpoint`**; DM/group/chat/doc mirrors — see [MYSQL_AND_FIRESTORE.md](MYSQL_AND_FIRESTORE.md). |
| **Stripe** | Webhooks must target the correct **Run URL** and signing secret per environment (prod vs staging dashboards). |
| **Secrets** | Secret Manager: MySQL password, cron secrets, Stripe, AI keys — **OPERATIONS**. |

---

## Deploy commands (from `AGENTS.md`)

- Backend **staging:** `gcloud builds submit --config=cloudbuild.yaml --project=cpoint-127c2 .`
- Backend **production:** `gcloud builds submit --config=cloudbuild-production.yaml --project=cpoint-127c2 .`
- Admin **staging:** from `admin-web/`, `gcloud builds submit --config=../cloudbuild-admin-staging.yaml --project=cpoint-127c2 .`

**Production secrets (`cpoint-app`):** `cloudbuild-production.yaml` deploys the image, runs **`scripts/wire_prod_cloud_run_secrets.sh`**, then **`scripts/smoke_prod.sh`**. If prod breaks while staging works, use **`docs/PROD_CLOUD_RUN_RECOVERY.md`** (agent runbook). Manual repair: `bash scripts/wire_prod_cloud_run_secrets.sh` then `bash scripts/smoke_prod.sh`; on Windows, run `powershell -ExecutionPolicy Bypass -File scripts/smoke_prod.ps1` for smoke checks. Do **not** set `SESSION_COOKIE_DOMAIN=app.c-point.co` — invalid; host-only is used when `CANONICAL_HOST=app.c-point.co`.

If a Run service URL changes, update **admin build args** and any **`CSRF_ALLOWED_ORIGINS`** on the API service that accepts browser POSTs from that admin origin.
