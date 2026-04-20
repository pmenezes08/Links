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

- **Monolith vs blueprints.** New API routes go in
  `backend/blueprints/*.py`, not `bodybuilding_app.py`. Register them
  in `backend/blueprints/__init__.py`. Only touch the monolith when
  migrating or patching an existing route in place.
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

## Frontend conventions

- `client/src/components/membership/ManageMembershipModal.tsx` is the
  canonical surface for plan / AI usage / billing UI. Don't duplicate
  it.
- `useEntitlements` / `LimitReachedBubble` / `LimitReachedModal` /
  `UsageWarningBanner` are the only sanctioned gating primitives.
  New Steve surfaces must render one of them when a block payload
  comes back from the server.

## Deployment

- Backend staging: `gcloud builds submit --config=cloudbuild.yaml --project=cpoint-127c2 .`
- Admin-web staging: from `admin-web/`,
  `gcloud builds submit --config=../cloudbuild-admin-staging.yaml --project=cpoint-127c2 .`
- Never deploy straight to prod; stage and smoke-test first. Production
  configs are separate Cloud Build files.

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

## When in doubt

Stop and ask. It is cheaper to clarify the business rule for a new
Steve surface than to ship a feature that silently bypasses logging
and distorts the revenue dashboard.
