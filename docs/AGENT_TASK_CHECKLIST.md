# Agent task checklist

Use this before opening a PR, especially for **routes, AI, billing, or entitlements**.

## Living docs (non-optional)

Reference docs are **part of the implementation**. If the code you ship makes a doc **wrong or incomplete**, update that doc **in the same PR / session** — not a follow-up ticket.

| Trigger | Action |
|---------|--------|
| Routes added, removed, or moved | `python scripts/generate_route_inventory.py` → commit **`docs/BACKEND_ROUTES.md`**. |
| Schema / collection / read-path change (MySQL or Firestore) | Edit **`docs/MYSQL_AND_FIRESTORE.md`**. |
| Deploy or infra naming/URLs/env (Cloud Build, Run services, domains, CSRF admin pairing) | Edit **`docs/DEPLOYMENT_INSTANCES.md`** (+ **`docs/cloud-scheduler-cron.md`** if cron base URL or auth story changes). |
| User-visible **journey** changes materially (billing, AI pipeline steps, seat lifecycle, onboarding flow, chat persistence) | Edit **`docs/PRODUCT_JOURNEYS.md`**. |
| Monolith reduction **epic** (priority, acceptance, or hotspot list) shifts | Edit **`docs/MONOLITH_REDUCTION_ROADMAP.md`**; align **KB → Product Roadmap** row if status changes. |
| **Product Roadmap** row added, renamed, merged, dropped, or materially retargeted (`knowledge_base.py` → **`product-roadmap` → roadmap_items**) | Update **both** KB seeds **and** the Notion hub **Product roadmap** database (**same Names / titles**, **Area**, status). Prefer editing KB first, then mirror to Notion (or Notion MCP from Cursor). Details: § **Product roadmap (KB ↔ Notion)** below. |
| New integration, blueprint, or architectural seam worth documenting | Edit **`docs/C_POINT_ARCHITECTURE.md`**. |
| User-facing strings, locale handling, push/email copy, or new locale | Follow **[`docs/I18N_ROADMAP.md`](I18N_ROADMAP.md)** — keys in catalogs, recipient locale for push/email, no monolith additions. |

Skips are only OK when the change **cannot** affect the doc (e.g. typo-only, pure test fixture rename with no route/schema/journey impact).

## Scope and constraints

- [ ] Task scope is clear; no unrelated refactors or drive-by edits.
- [ ] Read **`AGENTS.md`** (project invariants).
- [ ] If the change touches **Steve / voice / any paid LLM or Whisper**: read **`docs/STEVE_AND_VOICE_NOTES.md`** and use **`ai_usage`**, **`entitlements`**, **`whisper_service`** — no direct vendor API calls.

## Backend structure

- [ ] New **HTTP routes** live in **`backend/blueprints/*.py`** and are registered in **`backend/blueprints/__init__.py`**. Avoid growing **`bodybuilding_app.py`** with new `@app.route` handlers.
- [ ] New **logic** lives in **`backend/services/*.py`** with explicit inputs/outputs; routes stay thin.
- [ ] No **module-level mutable caches** in the monolith — use **Redis** or a **service** pattern (**`AGENTS.md`**).

## Revenue and policy

- [ ] **Caps / prices / policy text** come from the **Knowledge Base** seeds / admin — **`backend/services/knowledge_base.py`**, not hard-coded Python/TS constants for product policy.
- [ ] **Entitlements** via **`resolve_entitlements(username)`** — do not guess from DB columns alone.
- [ ] Every **billable AI path** records **`ai_usage.log_usage`** (or **`log_block`** on deny) with the right **`surface`**.

## Frontend

- [ ] Billing / plan UI: reuse **`ManageMembershipModal`** / **`useEntitlements`** / limit components — **`AGENTS.md`**.

## Tests and CI

- [ ] Added or updated **pytest** coverage for new behaviour (especially **AI surfaces**, **counters**, **entitlements**).
- [ ] Run **`pytest`** locally or rely on CI before merge.

## Documentation (same session as the code)

- [ ] **Triggered the “Living docs” table above?** If yes, the matching file is **updated in this change** — verify with a quick re-read of the diff.
- [ ] **New or renamed API routes:** regenerate **`docs/BACKEND_ROUTES.md`**:  
  `python scripts/generate_route_inventory.py` (repo root).
- [ ] **MySQL / Firestore schema or collection usage changed:** update **`docs/MYSQL_AND_FIRESTORE.md`**.
- [ ] **Deploy / topology / Cloud Build pairing changed:** update **`docs/DEPLOYMENT_INSTANCES.md`** (and **`docs/cloud-scheduler-cron.md`** if cron URL/secret story changed).
- [ ] **Cross-system product flow changed materially:** update **`docs/PRODUCT_JOURNEYS.md`**.
- [ ] **Monolith epic** (decomposition shipped, priorities shifted): update **`docs/MONOLITH_REDUCTION_ROADMAP.md`** and **KB → Product Roadmap** row status if applicable.
- [ ] **Top-level architecture / integrations changed:** update **`docs/C_POINT_ARCHITECTURE.md`** as needed.
- [ ] **Product Roadmap list or row metadata changed** (`product-roadmap` / `roadmap_items`): mirror to **Notion → Product roadmap** per **§ Product roadmap (KB ↔ Notion)**.
- [ ] **Substantive ship** (new service, cron, AI surface, deploy): optional **Notion team hub** sync per **`.cursor/rules/notion-project-hub.mdc`** (repo docs are still mandatory when triggers apply).

## Product roadmap (KB ↔ Notion)

**Canonical list:** `backend/services/knowledge_base.py` → page slug **`product-roadmap`** → field **`roadmap_items`**. Each row has `title`, `area` (same vocabulary as Notion Area: client, admin, backend, infra, AI, iOS, Android, Steve, Subscriptions), `phase`, `status`, `effort`, `target_quarter`, optional `test` / `test_status`, and `notes`.

**Notion mirror:** [C-Point — team hub](https://www.notion.so/35c43dca8b6f811ea3efc440a3697c47) → **Product roadmap** database. **Name** in Notion must match **title** in KB (single set of rows; no duplicate summaries). Use **Summary** for a one-line parity line: `Phase: … | Effort: … | Target: … | KB test: …` when a test ref exists.

**Status mapping (KB → Notion):** `completed` → **Done**; `ongoing` → **In progress**; `not_started` with `phase` **exploring** → **Idea**; other `not_started` → **Planned**.

**Workflow (same PR / session):**

1. Edit **`roadmap_items`** in **`knowledge_base.py`** (and reseed staging when you ship the change, or admin **Reseed** for that page as appropriate).
2. Create/update/delete the matching Notion database rows (Cursor Notion MCP or manual) so **every KB title has a Notion row and vice versa**.
3. After substantive roadmap edits, optional: add a short **Notion Project memory** ADR only if the change reflects a product decision, not just scheduling.

## Crons

- [ ] New scheduled endpoint: under **`/api/cron/*`**, **`X-Cron-Secret`**, documented in **`docs/cloud-scheduler-cron.md`** — **`AGENTS.md`**.
