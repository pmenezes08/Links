# C.Point Admin Web – Deployment Guide

## Architecture

| Service | URL | Cloud Run Service | Purpose |
|---------|-----|-------------------|---------|
| Main App | https://app.c-point.co | cpoint-app | Mobile app backend + SPA |
| Admin Web | https://admin.c-point.co | cpoint-admin | Admin dashboard SPA (static) |

## Admin Login / Session

When the admin site is at `admin.c-point.co` and the API at `app.c-point.co`, the session cookie must be valid for both subdomains.

The main app sets `SESSION_COOKIE_DOMAIN=.c-point.co` automatically when:
- `CANONICAL_HOST` ends with `c-point.co`, OR
- Running on Cloud Run (`K_SERVICE` is set)

The cookie is also set with `Secure=True` on Cloud Run (HTTPS).

The cookie uses `SameSite=None; Secure=True` on Cloud Run so it's sent in cross-origin `fetch()` from `admin.c-point.co` to `app.c-point.co`.

**If admins see "Not authorized. Admin access required."** after logging in correctly:
1. Ensure the main app (cpoint-app on Cloud Run) has `SESSION_COOKIE_DOMAIN=.c-point.co` or `CANONICAL_HOST=app.c-point.co` set as an environment variable
2. Ensure the main app is accessed via `https://app.c-point.co` (custom domain), not only the default Cloud Run URL
3. Ensure the admin SPA is built with `VITE_API_BASE=https://app.c-point.co` (set in `admin-web/Dockerfile`)
4. Clear cookies for both `admin.c-point.co` and `app.c-point.co` and try again

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

### Environment / Build Args

| Variable | Where | Default | Description |
|----------|-------|---------|-------------|
| `VITE_API_BASE` | Dockerfile ARG / Vite env | `https://app.c-point.co` | API base URL for the admin SPA. All `/api/*`, `/login`, `/logout` calls go here. |

The `cloudbuild-admin.yaml` passes `--build-arg=VITE_API_BASE=https://app.c-point.co` so the production build targets the main app. For staging, change this to the staging Cloud Run URL.

### Invite Emails

Invite emails are sent by the main app (Flask) and use the same C-Point branding:
- Logo: `{PUBLIC_BASE_URL}/static/cpoint-logo.svg` (or custom invite logo when configured)
- Colors: teal `#4db6ac`, black `#000000`, dark card `#1a1a1a`
- Both "You've been added" and "You're invited to join" templates include the logo in the header

## Local Development

```bash
cd admin-web
npm install
npm run dev
```

The Vite dev server proxies `/api` requests to `localhost:5000` (the Flask backend).

## Phase 2 – Multi-tenancy

Multi-tenancy is now partially implemented:

- **Landlord admin**: `admin.c-point.co` — sees all platform data
- **Tenant admin**: `{tenant}.c-point.co/admin` — sees only their tenant's data
- **www admin login**: `POST /api/admin/login-by-email` — email lookup redirects to tenant admin URL

### Setup for a new tenant
1. Add a row to `tenants` table: `INSERT INTO tenants (name, subdomain) VALUES ('WHU', 'whu')`
2. Set `tenant_id` on the tenant's users and communities
3. Configure wildcard DNS `*.c-point.co` → Cloud Run service
4. Tenant admin accesses `https://whu.c-point.co/admin`

### Environment
- `APP_DOMAIN=c-point.co` on the main app Cloud Run service

See `PHASE2.md` for full details.
