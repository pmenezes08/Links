# Phase 2 – Multi-tenancy

## Status: Foundation Complete

### Done

#### Schema
- `tenants` table: id, name, subdomain (unique), custom_domain, plan, settings, created_at
- `tenant_id` column on `users` and `communities` (nullable, defaults to NULL for global/platform)
- Auto-migration via `_ensure_tenants_table()` and `_ensure_tenant_id_columns()` on app startup

#### Tenant Resolution
- `_set_tenant_context` before_request handler resolves tenant from:
  - `X-Tenant-Id` header
  - Subdomain: `{tenant}.c-point.co` → looks up `tenants.subdomain`
  - Reserved subdomains (www, app, admin, api, staging) are excluded
- Sets `g.tenant_id` and `g.tenant` (dict with id, name, subdomain)
- Requires `APP_DOMAIN` env var (default: `c-point.co`) and wildcard DNS `*.c-point.co`

#### Tenant-Scoped Admin Queries
- `_tenant_filter()` helper returns SQL clause + params for scoping
- Applied to all admin API routes: overview, users, communities, dashboard, metrics
- When `g.tenant_id` is set: queries filtered to that tenant's data
- When `g.tenant_id` is None (landlord): all data visible (platform-wide)

#### www.c-point.co Admin Login
- `POST /api/admin/login-by-email`: looks up user's tenant by email
- Returns redirect URL to tenant's admin (`https://{subdomain}.c-point.co/admin`)
- Platform users (no tenant) redirected to `https://admin.c-point.co`

#### Tenant Admin UI
- Same admin SPA (`admin-web/`) works on tenant subdomains
- API calls go to the same host, so `g.tenant_id` is set from subdomain
- Tenant indicator shown in sidebar when on a tenant subdomain
- Landlord at `admin.c-point.co` sees all data

### Configuration Required
- `APP_DOMAIN=c-point.co` env var on main app
- Wildcard DNS: `*.c-point.co` → Cloud Run service
- Each tenant needs a row in `tenants` table with `subdomain` set

### Next Steps (Optional/Later)
- Custom domain support (`tenants.custom_domain`)
- Tenant admin role/permissions (separate from app admin)
- Billing/plan enforcement per tenant
- Tenant onboarding wizard
