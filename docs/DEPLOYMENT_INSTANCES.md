# Deployment instances & environments

> **Living doc:** When Cloud Build, Cloud Run names, `run.app`/custom domains, or staging–prod/env pairing changes—update this file in the **same PR**; see **`AGENTS.md` § Living engineering docs**.

GCP project: **`cpoint-127c2`**. Cloud Run region: **`europe-west1`**.

This maps **informal names** (“staging API”, “admin web”, “cpoint-web”) to **Cloud Run services**, domains, and build configs. For **founder operational** detail (backups, scripts, cost), see **[OPERATIONS.md](OPERATIONS.md)** §0–§6.

Out-of-repo or legacy names (`evalio`, `links` as separate cost centres) are called out in **OPERATIONS** — they are **not** this app’s deploy surface.

---

## Cloud Run services

| Service | Build config | Typical URL | Role |
|---------|--------------|------------|------|
| **`cpoint-app`** | `cloudbuild-production.yaml` → image `cpoint-app:latest` | **`https://cpoint-app-739552904126.europe-west1.run.app`**; users often enter via custom domain **`https://app.c-point.co`** (see [cloud-scheduler-cron.md](cloud-scheduler-cron.md)). | **Production Flask API** (`bodybuilding_app.py` + blueprints). Prod secrets, usually `min-instances=1` to avoid cold starts. |
| **`cpoint-app-staging`** | `cloudbuild.yaml` → `cpoint-app-staging:latest` | **`https://cpoint-app-staging-739552904126.europe-west1.run.app`** | **Staging API** — same codebase. **`min-instances=1`** + Cloud SQL Auth Proxy (`cpoint-db`) wired in `cloudbuild.yaml` to avoid cold-start + public-IP MySQL timeouts during feed/Steve contention QA. |
| **`cpoint-admin`** | `cloudbuild-admin.yaml` | Cloud Run hostname for **admin SPA**; **OPERATIONS** references admin alongside the app (team may map **admin.c-point.co** at the edge). | Static **admin-web** build; API calls go to **`cpoint-app`** (check `admin-web/Dockerfile` build args). |
| **`cpoint-admin-staging`** | `cloudbuild-admin-staging.yaml` | Example: **`https://cpoint-admin-staging-739552904126.europe-west1.run.app`** (confirm in Console) | Staging **admin** — baked to talk to **`cpoint-app-staging`** (`VITE_API_BASE` / `API_PROXY_*` in `cloudbuild-admin-staging.yaml`). |
| **`cpoint-landing`** | `cloudbuild-landing.yaml` | Marketing / landing only. | Separate **`landing/`** app; no core product API. |
| **`cpoint-render`** | `cloudbuild-render.yaml` → `cpoint-render:latest` (build context `services/render/`) | **`https://cpoint-render-739552904126.europe-west1.run.app`** (private) | **Headless-Chromium render worker** for the Steve Builder render/vision-judge harness. Playwright on the official image; `POST /render` → screenshot + diagnostics. `--no-allow-unauthenticated`, scale-to-zero (`min-instances=0`), `2Gi`/`cpu=2`/`concurrency=1`. Currently **staging only**. |

## Cloudflare edge services

| Service | Config | Typical URL | Role |
|---------|--------|-------------|------|
| **`cpoint-public-builds`** | `services/public-builds-worker/wrangler.jsonc` | Live custom domain **`https://builds.c-point.co/<slug>`** | Cloudflare Worker that serves public Steve Build website/app artifacts from the same EU-jurisdiction R2 bucket as the backend (`cpoints-uploads`). It reads `public/builds/<slug>/manifest.json`, streams the manifest's artifact HTML, applies security headers, returns a branded 404 for unpublished/missing builds, and proxies public-safe data connector requests to the Flask public feed route without cookies. |
| **`cpoint-public-builds-staging`** | `wrangler deploy --env staging` from `services/public-builds-worker/` | Not externally routed until a `workers.dev` subdomain or staging custom domain is configured | Staging Worker paired with `cpoint-app-staging` through `PUBLIC_API_BASE`. |

Public build artifacts remain separate from private builder artifacts. Private build HTML uses `private/creations/...` and is loaded through authenticated Cloud Run APIs; public website/app copies use `public/builds/...` and are revocable through `/api/builder/<id>/publish-web`.

---

## How they differ (quick reference)

| Topic | Prod (`cpoint-app`) | Staging (`cpoint-app-staging`) |
|-------|---------------------|--------------------------------|
| **Purpose** | Live traffic, revenue, cron in prod. | Smoke tests, manual QA, experiments. |
| **Scale / cold start** | Typically warm (`min-instances` ≥ 1). | **`min-instances=1`** (since Steve/feed isolation deploy); Cloud SQL via **`run.googleapis.com/cloudsql-instances`** (same `cpoint-db` as prod). |
| **Cron** | Scheduler jobs use prod `run.app` URL + `cron-shared-secret`. Includes **`purge-underage`** → `/api/cron/purge-underage` (Option A underage account purge, 03:30 UTC — see [COMPLIANCE_AGE_GATE.md](COMPLIANCE_AGE_GATE.md)). | Staging jobs use staging URL + `cron-shared-secret-staging` (prefix job names with `staging-`). See [cloud-scheduler-cron.md](cloud-scheduler-cron.md). |
| **Admin pairing** | Admin prod build targets prod API. | Staging **API** sets **`CSRF_ALLOWED_ORIGINS`** to the **staging admin** origin (`cloudbuild.yaml` — the staging admin **`.run.app`** URL). |

**Shared DB caveat:** Both **`cpoint-app`** and **`cpoint-app-staging`** use the **same Cloud SQL instance** **`cpoint-db`** (same DB + credentials). Staging writes affect “prod” data — see **OPERATIONS** §6 before destructive ops.

---

## `cpoint-render` — Steve Builder render worker

Private Cloud Run service that renders a self-contained HTML artifact in real Chromium and returns a PNG screenshot + diagnostics (console errors, blank/overflow). Used only on the **async build path** by `backend/services/render_service.py` → fed to `backend/services/vision_judge.py` (a paid AI surface logged under `ai_usage` `SURFACE_BUILDER_JUDGE`) for render-fix, web-data verification, and design-refine. Best-effort: if the worker is unreachable, a build silently skips verification — it never fails.

**One-time setup (already done for staging):**

```bash
# 1. Shared secret (defence-in-depth alongside Cloud Run IAM)
python -c "import secrets,sys; sys.stdout.write(secrets.token_hex(32))" \
  | gcloud secrets create render-shared-secret --data-file=- --replication-policy=automatic --project=cpoint-127c2
gcloud secrets add-iam-policy-binding render-shared-secret \
  --member="serviceAccount:739552904126-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" --project=cpoint-127c2

# 2. Build + deploy the worker (private)
gcloud builds submit --config=cloudbuild-render.yaml --project=cpoint-127c2 .

# 3. Let the main app invoke it (both run as the default compute SA)
gcloud run services add-iam-policy-binding cpoint-render --region=europe-west1 \
  --member="serviceAccount:739552904126-compute@developer.gserviceaccount.com" \
  --role="roles/run.invoker" --project=cpoint-127c2

# 4. Point the main app at it (merges; survives cloudbuild deploys)
gcloud run services update cpoint-app-staging --region=europe-west1 --project=cpoint-127c2 \
  --update-env-vars=RENDER_SERVICE_URL=https://cpoint-render-hcvblrg55q-ew.a.run.app \
  --update-secrets=RENDER_SHARED_SECRET=render-shared-secret:latest
```

The worker is gated entirely by `RENDER_SERVICE_URL` on the main app: unset ⇒ the whole render/judge pipeline no-ops. **Not yet wired to prod** — replicate steps 1–4 against `cpoint-app` when promoting.

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
| **Steve Builder async jobs** | `builder_jobs` can run through Cloud Tasks when `BUILDER_TASKS_QUEUE`, `BUILDER_TASKS_LOCATION`, `GOOGLE_CLOUD_PROJECT`, `PUBLIC_BASE_URL`, and `BUILDER_JOB_SECRET` (or `CRON_SHARED_SECRET`) are set on the Run service. Without queue config, the app falls back to an in-process worker thread (NOT durable — deploys/instance recycling kill in-flight builds); durability requires Cloud Tasks calling `/api/internal/builder/jobs/<id>/run` with `X-Builder-Job-Secret`. **Staging is configured:** queue `builder-jobs-staging` (europe-west1, max-attempts 5), env set on `cpoint-app-staging` with `BUILDER_JOB_SECRET` mapped to the `cron-shared-secret-staging` secret, and the default compute SA holds `roles/cloudtasks.enqueuer`. Production needs the same setup with its own queue + secret before builds are durable there. |

---

## Deploy commands (from `AGENTS.md`)

- Backend **staging:** `gcloud builds submit --config=cloudbuild.yaml --project=cpoint-127c2 .`
- Backend **production:** `gcloud builds submit --config=cloudbuild-production.yaml --project=cpoint-127c2 .`
- Admin **staging:** from `admin-web/`, `gcloud builds submit --config=../cloudbuild-admin-staging.yaml --project=cpoint-127c2 .`

**Production secrets (`cpoint-app`):** `cloudbuild-production.yaml` deploys the image, runs **`scripts/wire_prod_cloud_run_secrets.sh`**, then **`scripts/smoke_prod.sh`**. If prod breaks while staging works, use **`docs/PROD_CLOUD_RUN_RECOVERY.md`** (agent runbook). Manual repair: `bash scripts/wire_prod_cloud_run_secrets.sh` then `bash scripts/smoke_prod.sh`. Do **not** set `SESSION_COOKIE_DOMAIN=app.c-point.co` — invalid; host-only is used when `CANONICAL_HOST=app.c-point.co`.

If a Run service URL changes, update **admin build args** and any **`CSRF_ALLOWED_ORIGINS`** on the API service that accepts browser POSTs from that admin origin.
