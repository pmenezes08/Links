# Phase 3 – Planned Features

## Scope

Phase 3 focuses on self-service tenant management, custom domains, granular permissions, and billing.

### 1. Tenant Onboarding Wizard
- Self-service tenant signup from www.c-point.co or admin
- Wizard flow: choose plan → enter organization name → pick subdomain → invite first admin
- Auto-create tenant, set up initial community structure
- **Acceptance:** A new organization can sign up and start using C.Point without landlord intervention

### 2. Custom Domain Support
- Use `tenants.custom_domain` in tenant resolution
- In `_set_tenant_context`, check if the request host matches any tenant's `custom_domain`
- DNS: CNAME from custom domain to Cloud Run service
- SSL: Managed certificates via Cloud Run custom domains
- **Acceptance:** `https://community.example.com` resolves to the correct tenant

### 3. Tenant Admin Role
- Separate "tenant admin" permission from "app admin" (landlord)
- New column `users.is_tenant_admin` (boolean) or a `tenant_admins` table
- Tenant admins can manage their tenant's users, communities, content
- Tenant admins cannot see other tenants or platform-wide data
- **Acceptance:** A user marked as tenant admin can access admin at `{tenant}.c-point.co/admin` and manage only their tenant's data

### 4. Billing / Plan Enforcement
- Per-tenant plan stored in `tenants.plan` (free, starter, pro, enterprise)
- Enforce limits by plan:
  - Free: up to N users, M communities
  - Starter/Pro: higher limits, premium features
  - Enterprise: unlimited, custom domain, SLA
- Stripe integration for per-tenant billing
- **Acceptance:** Tenant hitting their plan limit sees an upgrade prompt; payment creates/upgrades the subscription

### 5. Tenant Analytics Dashboard
- Per-tenant metrics visible to tenant admins
- DAU/MAU scoped to tenant
- Content moderation stats per tenant
- **Acceptance:** Tenant admin sees engagement metrics for their tenant only

## Priority Order
1. Tenant Admin Role (most requested)
2. Custom Domain Support
3. Tenant Onboarding Wizard
4. Billing / Plan Enforcement
5. Tenant Analytics Dashboard

## Dependencies
- Phase 2 complete (tenants table, tenant_id columns, subdomain resolution, scoped queries)
- Wildcard DNS for `*.c-point.co`
- Stripe account for billing (Phase 3.4)
