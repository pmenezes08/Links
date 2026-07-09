# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read first

**[AGENTS.md](AGENTS.md) is the authoritative agent guide for this repo** — read it before your first edit. It covers monetization/AI invariants, privacy rules, deployment, git hygiene, and the "living docs" policy. The Cursor rules under `.cursor/rules/` also apply to Claude Code when editing the paths they cover (notably `chat-surfaces.mdc`, `frontend-pages-and-routing.mdc`, `backend-monolith-boundaries.mdc`, `design-system.mdc`, `ios-xcode-project.mdc`).

Before touching AI / monetization code, read `docs/STEVE_AND_VOICE_NOTES.md`. Before touching Steve profile/KB context, read `docs/STEVE_PRIVACY_GATE.md`.

## What this is

C-Point (product name — never "CPoint" or "C.Point" in user-facing copy; repo/GitHub name is "Links"): a community + professional-network platform with an AI assistant ("Steve", powered by xAI Grok). Flask backend on GCP Cloud Run, MySQL primary DB, Redis cache, Firestore mirror for DMs/chat realtime, Cloudflare R2 for media, Stripe billing, React 19 + Vite + Capacitor client (web, iOS, Android).

## Commands

### Backend (Python 3.11, repo root)

```bash
pip install -r requirements.txt          # runtime deps
python bodybuilding_app.py               # run Flask dev server
```

### Tests (pytest + MySQL 8 testcontainer — Docker Desktop must be running)

```bash
pip install -r requirements-dev.txt      # then also requirements.txt
PYTHONPATH=. pytest tests/ -v --tb=short              # all tests
PYTHONPATH=. pytest tests/test_entitlements_resolve.py -v        # one file
PYTHONPATH=. pytest tests/test_i18n.py::test_fallback_chain -v   # one test
```

`PYTHONPATH` must be the repo root (no pyproject.toml/pytest.ini) or `from backend.services...` imports fail. CI (`.github/workflows/test.yml`) runs a subset of suites plus `python scripts/i18n_check_catalogs.py` on every push/PR to `main`/`staging`.

### Client (`client/`)

```bash
npm run dev            # Vite dev server
npm run build          # tsc -b && vite build
npm run lint           # eslint
npm test               # vitest run (all)
npx vitest run src/pages/SubscriptionPlans.test.tsx   # single test file
npm run cap:sync:staging | cap:sync:prod              # Capacitor native sync
```

`admin-web/` and `landing/` are separate Vite apps with the same script shape.

### Doc regeneration / checks

```bash
python scripts/generate_route_inventory.py   # regenerate docs/BACKEND_ROUTES.md after route changes
python scripts/i18n_check_catalogs.py        # catalog drift vs en source of truth (CI-enforced)
```

### Deploy (Cloud Build → Cloud Run, project `cpoint-127c2`)

Never deploy straight to prod; stage and smoke-test first. Staging: `gcloud builds submit --config=cloudbuild.yaml --project=cpoint-127c2 .` Prod: `cloudbuild-production.yaml`. Details and service names: `docs/DEPLOYMENT_INSTANCES.md`; prod outage runbook: `docs/PROD_CLOUD_RUN_RECOVERY.md`.

## Architecture (big picture)

### Backend: monolith + blueprints + services

- **`bodybuilding_app.py`** is a huge legacy monolith (~100 `@app.route` handlers). **Never add new routes or symbols to it.** When patching an existing monolith route, push new logic into a service so a later blueprint move is mechanical.
- **New HTTP routes** → `backend/blueprints/*.py`, registered in `backend/blueprints/__init__.py`. Blueprints have no URL prefix; each route declares its full path (usually `/api/...`). Keep handlers thin.
- **New logic / state** → `backend/services/*.py`. Module-level state belongs in Redis or a service, never in monolith globals.
- **Cron endpoints** live under `/api/cron/*` and must honour the `X-Cron-Secret` header (`docs/cloud-scheduler-cron.md`).
- Full route inventory: `docs/BACKEND_ROUTES.md`. Service-by-service map: `docs/C_POINT_ARCHITECTURE.md`. Data stores: `docs/MYSQL_AND_FIRESTORE.md`.

### Revenue-sensitive invariants (do not bypass)

- **Never call Grok/OpenAI/Whisper APIs directly.** Build on `backend.services.ai_usage`, `entitlements`, `entitlements_gate`, `entitlements_errors`, `whisper_service` (see `docs/STEVE_AND_VOICE_NOTES.md`).
- **Entitlements are resolved, not guessed:** call `entitlements.resolve_entitlements(username)` and read caps from the returned dict.
- **Every paid AI call logs one row** to `ai_usage_log` via `ai_usage.log_usage(...)`; blocked calls log via `ai_usage.log_block(...)`. No raw SQL into that table.
- **The in-app Knowledge Base** (`backend/services/knowledge_base.py` seeds) is the source of truth for pricing, caps, policies, and special-user lists — never hard-code these in Python or TS.
- New AI surfaces/counters/entitlements require a test — no exceptions.

### Privacy invariant

Profile access (including username/avatar/mention/member-list lookups) is a **server-side authorization decision**: self access, app-admin bypass, or shared community/root network, checked in the backend with non-enumerating errors. Hiding UI is never access control. Authorize before reading profile-derived data; viewer/relationship context must be part of any profile cache key.

### Frontend

- **Pages are thin** (`client/src/pages/*.tsx`, target ≤ ~400 lines): routing, layout shell, wiring. New UI logic goes in `client/src/hooks/` or `client/src/components/<feature>/`. Do not grow the already-huge pages (`CommunityFeed`, `PostDetail`, `OnboardingChat`, ...) — extract first.
- **Chat kernel is shared**: DM (`ChatThread.tsx`) and group (`GroupChatThread.tsx`) pages must not duplicate behaviour — shared hooks/components live in `client/src/chat/`. The message list is **inverted (`column-reverse`)**; before touching chat scroll, keyboard insets, caching, or reactions, read `.cursor/rules/chat-surfaces.mdc` in full — it encodes many hard-won invariants.
- **Entitlement gating primitives** are the only sanctioned ones: `useEntitlements`, `LimitReachedBubble`, `LimitReachedModal`, `UsageWarningBanner`; `ManageMembershipModal` is the canonical plan/billing UI. `<EntitlementsProvider>` must stay mounted inside `BrowserRouter` in `App.tsx`.
- **Design tokens** (`docs/DESIGN.md`): app canvas `#000`, accent turquoise `#00CEC8`, motion constants from `client/src/design/motion.ts`. No light mode in drive-by changes.
- **i18n**: user-facing copy comes from JSON catalogs (`backend/locales/`, `client/src/locales/`; `en` is the source of truth, CI fails on drift). Async surfaces (push, in-app notification rows) resolve copy in the **recipient's** locale via `notification_copy.py`.

### Android release invariants

Play Store builds depend on fixed Gradle/Firebase config (`client/android/`): prod WebView host, `MYAPP_RELEASE_*` signing, versionCode baseline, ProGuard keeps, google-services SHA-1s. **Do not revert these to placeholders** — see AGENTS.md § Android release for the full table.

## Living docs — update in the same change

Route, data-store, deployment, and journey docs must stay accurate. If you change routes → regenerate `docs/BACKEND_ROUTES.md`; tables/collections → `docs/MYSQL_AND_FIRESTORE.md`; deploy topology → `docs/DEPLOYMENT_INSTANCES.md`; cross-system flows (Stripe, AI gating, seats, onboarding, DM storage) → `docs/PRODUCT_JOURNEYS.md`; **Steve's build capabilities** (a `CPoint` API / route / connector, a new build kind, a design direction, or a quality pass) → `backend/services/builder_guide.md` (the single build guide injected into every build — update it in the same change so Steve always knows the new capability and his chat feedback stays accurate). Full checklist: `docs/AGENT_TASK_CHECKLIST.md`.

## Git hygiene

- Do not commit on the user's behalf unless explicitly asked.
- Never change git config, never `--force` push to `main`, never `--amend` an already-pushed commit.
- Use `git mv` (not delete+add) when moving files.
