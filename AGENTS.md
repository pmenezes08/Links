# AGENTS.md

Project-wide guidance for any AI coding agent (Cursor, Codex, Claude,
etc.) working in this repository. Read this before your first edit. The
pointers below are not optional — skipping them breaks live revenue
flows.

## Mandatory reading for AI / monetization work

- **[docs/STEVE_AND_VOICE_NOTES.md](docs/STEVE_AND_VOICE_NOTES.md)** —
  The only sanctioned way to add Steve surfaces, voice-note pipelines,
  or any feature that calls Grok / OpenAI / Whisper. Bootstrap every
  new AI feature on top of the services it describes
  (`backend.services.ai_usage`, `entitlements`, `entitlements_gate`,
  `entitlements_errors`, `whisper_service`). Do **not** call the
  upstream APIs directly.
- **[docs/cloud-scheduler-cron.md](docs/cloud-scheduler-cron.md)** —
  How the lifecycle crons (grace sweep, nag dispatch, winback expiry,
  usage-cycle notify, revoke-expired) are deployed and authenticated.
  Any new cron endpoint must live under `/api/cron/*` and honour the
  `X-Cron-Secret` header.

## Structural rules

- **Monolith reduction (ongoing).** Large pages and legacy Flask routes block safe iteration. Follow **`docs/MONOLITH_REDUCTION_ROADMAP.md`**; Cursor rules **`frontend-pages-and-routing`**, **`chat-surfaces`**, **`backend-monolith-boundaries`** (under `.cursor/rules/`) apply when editing those paths. In-app status: **KB → Planning → Product Roadmap** (seeded from `knowledge_base.py`).
- **API structure — blueprints / services.** New API routes go in
  `backend/blueprints/*.py`; new helpers, background workers, and
  module-level state go in `backend/services/*.py`. Register new
  blueprints in `backend/blueprints/__init__.py`. Do not add new
  symbols to `bodybuilding_app.py`. When patching an existing monolith
  route, push any new logic into a service module the route calls into
  so a later move to a blueprint is mechanical. Module-level state
  (dicts, sets) belongs in Redis or a service, never in the monolith
  global namespace.
- **Keep backend changes clean and small.** Prefer focused services with
  explicit inputs/outputs over inline route logic. Do not stack temporary
  guards or one-off SQL fixes when a shared helper or service invariant
  would solve the problem more clearly.
- **KB is the source of truth** for pricing, caps, policies, roadmap,
  and special-user lists. Edit `backend/services/knowledge_base.py`
  seeds, redeploy, and (if content changed) hit the admin-web
  "Reseed + Force" button — do not hard-code these values in Python
  or TS.
- **Entitlements are resolved, not guessed.** Call
  `backend.services.entitlements.resolve_entitlements(username)` and
  read caps from the returned dict. The overlay (tier → KB → Special
  → Enterprise seat) lives there and only there.
- **Usage is logged, not inferred.** Every paid API call writes one
  row to `ai_usage_log` via `ai_usage.log_usage(...)` with the right
  `surface`. Blocked calls write a `success=0` row via
  `ai_usage.log_block(...)`. No raw SQL inserts into that table from
  anywhere else.

## Branding

- The product name is **C-Point** in UI copy, docs, prompts, emails, and
  user-facing text. Do not write `C.Point`, `CPoint`, or `C Point` unless
  quoting a legacy identifier, bundle/package name, or external value that
  cannot be changed.

## Frontend conventions

- `client/src/components/membership/ManageMembershipModal.tsx` is the
  canonical surface for plan / AI usage / billing UI. Don't duplicate
  it.
- `useEntitlements` / `LimitReachedBubble` / `LimitReachedModal` /
  `UsageWarningBanner` are the only sanctioned gating primitives.
  New Steve surfaces must render one of them when a block payload
  comes back from the server.
- Mount `<EntitlementsProvider>` inside `BrowserRouter` in `client/src/App.tsx`
  so `useEntitlementsHandler().showError` / `handleResponse` open `LimitReachedModal`
  (otherwise the context defaults are no-ops).

## Deployment

- After changing `docs/STEVE_PLATFORM_KB.md` (seed for KB slug `steve-platform-manual`),
  redeploy and refresh MySQL on staging/prod so Steve reads the new manifesto: use
  admin-web **Reseed + Force** for that page, or call
  `seed_default_pages(force=True, slug="steve-platform-manual", actor_username="<you>")`.
  Untouched `system-seed` rows auto-upgrade on seed runs; admin-edited bodies stay until forced.
- Backend staging: `gcloud builds submit --config=cloudbuild.yaml --project=cpoint-127c2 .`
- Admin-web staging: from `admin-web/`,
  `gcloud builds submit --config=../cloudbuild-admin-staging.yaml --project=cpoint-127c2 .`
- Never deploy straight to prod; stage and smoke-test first. Production
  backend: `gcloud builds submit --config=cloudbuild-production.yaml --project=cpoint-127c2 .`
  (wires secrets + runs `scripts/smoke_prod.sh`). If prod fails while staging works:
  **`docs/PROD_CLOUD_RUN_RECOVERY.md`**.

## Git / commit hygiene

- Do not commit on the user's behalf unless explicitly asked.
- Never change git config, never `--force` push to `main`, never
  `--amend` an already-pushed commit.
- Use `git mv` rather than delete+add when moving files so history
  follows.

## CI + manual QA

- **Automated tests** run via `.github/workflows/test.yml` on every
  push and on pull requests targeting `main` or `staging`. The workflow
  spins up a MySQL 8 testcontainer (so tests run against the same DB
  engine as production) and executes `pytest`. Triggers also include
  `workflow_dispatch` so you can re-run on demand from the Actions tab.
- **Test dashboards** live in the Knowledge Base:
  - `KB → Audit → Tests` — authoritative list of test rows, with
    runner (automated / manual), target service, and last-known status.
    Clicking **Run now** on a row records a new status + changelog entry.
  - `KB → Planning → Product Roadmap` — every roadmap item has a
    `Test` ref and a rollup `Test status` pill. Green pill = the
    matching Tests row last ran successful; red = failed; grey = not
    run. Do not close a roadmap item with a grey or red pill.
- **Manual QA** follows `docs/QA_CHECKLIST.md`. Run it after any deploy
  that touches Steve, Whisper, entitlements, or the enterprise seat
  lifecycle. Each checklist section maps 1:1 to a `runner=manual` row
  on the Tests page.
- **Do not** skip writing a test for a new AI surface / counter /
  entitlement. CI is cheaper than re-debugging a production counter
  mismatch — we've fixed that class of bug twice already.

## Living engineering docs (keep current with code)

Route inventory, data-store maps, deploy topology, and journey narratives **must stay accurate**. When your work **changes** any of the items below, **update the matching doc in the same change** (same branch / before you treat the task as done). Do not leave stale docs for a “later cleanup.”

| Change | Document to update |
|--------|-------------------|
| New, renamed, or removed HTTP routes | Regenerate **`docs/BACKEND_ROUTES.md`**: `python scripts/generate_route_inventory.py` (repo root). |
| MySQL tables, Firestore collections, or how features read/write them | **`docs/MYSQL_AND_FIRESTORE.md`**. |
| Cloud Build files, Cloud Run service names, `run.app` / custom domains, staging–prod pairing, CSRF `CSRF_ALLOWED_ORIGINS`, or which build targets which API | **`docs/DEPLOYMENT_INSTANCES.md`**; if Scheduler/cron **URLs or secrets** move, **`docs/cloud-scheduler-cron.md`** too. |
| Material shift in a **cross-system** flow (Stripe/checkout/webhook path, AI gate + usage logging, enterprise seat lifecycle, onboarding stages, DM/group storage or read path) | **`docs/PRODUCT_JOURNEYS.md`**. |
| Monolith reduction **epic** priority or acceptance criteria shift | **`docs/MONOLITH_REDUCTION_ROADMAP.md`**. |
| New major dependency, supplier, blueprint area, or integration worth a one-line pointer | **`docs/C_POINT_ARCHITECTURE.md`**. |

Full checkbox list: **[docs/AGENT_TASK_CHECKLIST.md](docs/AGENT_TASK_CHECKLIST.md)**.

## Team documentation (Notion)

- **Team hub:** [C-Point — team hub](https://www.notion.so/35c43dca8b6f811ea3efc440a3697c47) — canonical URL also in `.cursor/rules/notion-project-hub.mdc`. Agents maintain it from **Cursor** via the Notion MCP after substantive changes.
- **Architecture & integrations:** [`docs/C_POINT_ARCHITECTURE.md`](docs/C_POINT_ARCHITECTURE.md) — structure, APIs, suppliers. **Monolith reduction (engineering roadmap):** [`docs/MONOLITH_REDUCTION_ROADMAP.md`](docs/MONOLITH_REDUCTION_ROADMAP.md) + KB **Product Roadmap** rows. **Deployment / instances:** [`docs/DEPLOYMENT_INSTANCES.md`](docs/DEPLOYMENT_INSTANCES.md) (Cloud Run names, URLs, staging vs prod — not the same as hostname “cpoint-web”). **Product journeys:** [`docs/PRODUCT_JOURNEYS.md`](docs/PRODUCT_JOURNEYS.md) (Stripe, AI usage, crons, onboarding, cross-store messaging). **Agent PR checklist:** [`docs/AGENT_TASK_CHECKLIST.md`](docs/AGENT_TASK_CHECKLIST.md) (includes **§ Product roadmap (KB ↔ Notion)**). **Routes:** [`docs/BACKEND_ROUTES.md`](docs/BACKEND_ROUTES.md) (regenerate with `python scripts/generate_route_inventory.py`). **Data stores:** [`docs/MYSQL_AND_FIRESTORE.md`](docs/MYSQL_AND_FIRESTORE.md).
- **Steve group agent (group feed):** [`docs/STEVE_GROUP_AGENT.md`](docs/STEVE_GROUP_AGENT.md) — preset agent, package gate, cron, pool usage.
- **In-app Knowledge Base** remains authoritative for **pricing, caps, policies, special-user lists, and seeded roadmap content** managed through admin / `knowledge_base.py` — Notion complements this for **people and engineering context**, not product policy truth.

## When in doubt

Stop and ask. It is cheaper to clarify the business rule for a new
Steve surface than to ship a feature that silently bypasses logging
and distorts the revenue dashboard.
