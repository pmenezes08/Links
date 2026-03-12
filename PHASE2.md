# Phase 2 – Multi-tenancy (Started)

## What's done

### Schema
- `tenants` table: `id`, `name`, `subdomain` (unique), `created_at`, `custom_domain`, `plan`, `settings`
- Migration function `_ensure_tenants_table()` creates the table on first use
- `tenant_id` columns on `users` and `communities` are planned but NOT yet added (requires migration scripts for existing data)

### Request Context
- `_set_tenant_context` before_request handler sets `g.tenant_id` from:
  - `X-Tenant-Id` header (for API calls from tenant-specific admin)
  - Subdomain detection (when tenant subdomains are configured)
- `g.tenant_id = None` for current (default/global) behavior

### Admin
- **Landlord**: `admin.c-point.co` is the platform owner admin (current admin)
- **Tenant admins**: Not yet implemented

## Next Steps (Phase 2 continuation)

1. **Add `tenant_id` columns**: Add nullable `tenant_id` FK to `users` and `communities` tables. Backfill existing rows with `NULL` (global tenant).

2. **Tenant subdomains**: Configure `{tenant}.c-point.co` routing. Each tenant gets their own subdomain with scoped data.

3. **www.c-point.co admin login**: Add "Admin Login" on the landing page. When admin enters email, system looks up their tenant and redirects to `{tenant}.c-point.co`.

4. **Tenant-scoped queries**: Where admin routes run, filter by `g.tenant_id` when present. Comment markers are in place: "Phase 2: scope by g.tenant_id when present."

5. **Tenant admin UI**: Separate admin view for tenant admins (limited to their tenant's data).

## Environment Variables

No new env vars required for Phase 2 foundation. Future:
- Tenant subdomains will use wildcard DNS (`*.c-point.co`)
- Each tenant may have custom domain support via `tenants.custom_domain`
