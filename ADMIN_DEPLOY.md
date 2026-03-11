# C.Point Admin Web – Deployment Guide

## Architecture

| Service | URL | Cloud Run Service | Purpose |
|---------|-----|-------------------|---------|
| Main App | https://app.c-point.co | cpoint-app | Mobile app backend + SPA |
| Admin Web | https://admin.c-point.co | cpoint-admin | Admin dashboard SPA (static) |

## Session Cookie

The session cookie is scoped to `Domain=.c-point.co` so the same session works on both `app.c-point.co` and `admin.c-point.co`. This is set automatically when the canonical host ends with `c-point.co`.

## CORS

The main app (Flask) allows CORS from `https://admin.c-point.co` with credentials. This lets the admin SPA make authenticated API calls to the main app.

## Deploying Admin Web

### Prerequisites
- Google Cloud project with Cloud Run enabled
- `gcloud` CLI authenticated

### Build & Deploy

```bash
# From repo root
gcloud builds submit --config=cloudbuild-admin.yaml ./admin-web
```

Or manually:
```bash
cd admin-web
npm install
npm run build
# Build Docker image and push to GCR
docker build -t gcr.io/YOUR_PROJECT/cpoint-admin:latest .
docker push gcr.io/YOUR_PROJECT/cpoint-admin:latest
# Deploy to Cloud Run
gcloud run deploy cpoint-admin \
  --image gcr.io/YOUR_PROJECT/cpoint-admin:latest \
  --region europe-west1 \
  --platform managed \
  --allow-unauthenticated
```

### Custom Domain

Map `admin.c-point.co` to the `cpoint-admin` Cloud Run service:
1. In GCP Console → Cloud Run → cpoint-admin → Custom domains
2. Add `admin.c-point.co`
3. Update DNS CNAME as instructed

### Environment Variables

The admin SPA uses `VITE_API_BASE` to set the API base URL. For production:
- Not needed (defaults to same origin, and CORS handles cross-origin)
- For staging, set `VITE_API_BASE=https://cpoint-app-staging-739552904126.europe-west1.run.app`

## Local Development

```bash
cd admin-web
npm install
npm run dev
```

The Vite dev server proxies `/api` requests to `localhost:5000` (the Flask backend).

## Phase 2 – Multi-tenancy (NOT IMPLEMENTED)

Phase 2 will add:
- `tenants` table in the database
- `tenant_id` columns on users, communities, etc.
- Tenant subdomains (e.g. `whu.c-point.co`) with per-tenant admin
- `admin.c-point.co` becomes the **landlord** (platform owner) admin
- Tenant admins access their admin at `{tenant}.c-point.co/admin`
- On `www.c-point.co`, an "Admin Login" flow will look up the tenant by email and redirect to the tenant's site

**Current state:** No tenant_id columns, no tenants table. Admin queries are not scoped by tenant. API base URL is from environment only (no hardcoded tenant).
