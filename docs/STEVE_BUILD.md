# Steve Build

Steve Build is C-Point's community-native creation surface: a member chats with Steve, Steve proposes a small playable or useful front-end creation, and the result can be tested, iterated, and shared inside a community.

This is a major product direction for C-Point. The goal is not to copy a generic app builder. The goal is to make creation social: members build things for their own communities, with community data, feedback, play, sharing, and identity around the work.

## Product Intent

Steve Build should feel like:

- A creative collaborator inside the community, not a blank code tool.
- Fast enough for playful experimentation, but polished enough that members want to share the result.
- Mobile-first and touch-first.
- Safe by default: front-end only, sandboxed, no access to app cookies or storage.
- Community-aware through approved host APIs, not arbitrary backend access.

Steve can create games, quizzes, generators, guides, toys, and small interactive pages. Phase 1 is intentionally front-end only.

## Current Architecture

Entry point:

- `client/src/pages/BuilderPage.tsx`
- `client/src/hooks/useBuilder.ts`

Backend routes:

- `POST /api/builder/chat` - Steve conversation and proposal flow.
- `POST /api/builder/create` - enqueue a first build.
- `POST /api/builder/<id>/iterate` - enqueue an iteration.
- `GET /api/builder/jobs/<id>` - poll async job status.
- `POST /api/internal/builder/jobs/<id>/run` - protected Cloud Tasks worker entry point (shared-secret auth via `cron_auth.cron_authed`, accepting `X-Cron-Secret` or `X-Builder-Job-Secret`).
- `POST /api/cron/builder/sweep` - Cloud Scheduler reaper for orphaned jobs.
- `GET /api/builder/<id>` - load a creation for owner/playback.
- `POST /api/builder/<id>/publish` - publish as a community post.
- `/api/builder/<id>/data/*` - host-brokered creation data APIs.

Core service:

- `backend/services/builder.py`

Storage:

- `creations` stores generated HTML, owner, community, status, prompt history, and chat history.
- `builder_jobs` stores async build/iterate jobs so builds continue if the user leaves, locks the phone, or switches apps.
- `creation_data` stores host-brokered scores, ratings, saves, and related creation data.

## Async Build Model

Builds must not depend on the browser staying open.

Flow:

1. User confirms a build.
2. Backend gates the turn with `entitlements_gate.gate_builder_or_reason` and logs a block row if denied.
3. `user_has_active_job` limits one in-flight build per user (`409` otherwise).
4. Backend creates a `builder_jobs` row (`queued`) and returns `202`.
5. The client can leave the screen and poll `GET /api/builder/jobs/<id>` while open.
6. The worker runs generation server-side.
7. On finish, the worker writes/updates the creation, logs exactly one `ai_usage` row, stamps `notified_at`, and sends in-app plus push notification.
8. The notification deep-links back to the Builder page with the finished `creation_id`.

### Reliability model (at-least-once safe)

Cloud Tasks delivers at-least-once, so the worker is built to be idempotent:

- **Atomic claim.** `run_build_job` calls `claim_build_job` - a single conditional `UPDATE` that flips `queued`/`failed` (or a lease-expired `running`) to `running` and stamps a `worker_token` + `lease_expires_at`. Only the worker whose `UPDATE` affects one row runs generation, so a duplicate delivery is a no-op and can never produce two creations or two usage rows.
- **Exactly-one side effects.** The creation write, the single `ai_usage.log_usage` row, and the notification all hang off the winning claim. `notified_at` is stamped once (`_mark_notified`) so retries never re-notify.
- **Terminal vs transient.** Generation/validation errors are terminal: the job goes `failed`, logs one `success=0` row, and the worker route returns `200` so Cloud Tasks stops retrying. Only genuine infra blips (`_is_transient_error`) requeue and return `500` to request a retry, bounded by `attempts < max_attempts`.
- **Reaper.** `/api/cron/builder/sweep` (`sweep_build_jobs`) requeues `running` jobs whose lease expired (crashed worker / recycled instance) and terminally fails those past `max_attempts`, with one block row + one notification.

Production durability uses Cloud Tasks with:

- `BUILDER_TASKS_QUEUE`
- `BUILDER_TASKS_LOCATION`
- `GOOGLE_CLOUD_PROJECT` (or `GCP_PROJECT`)
- `PUBLIC_BASE_URL`
- `BUILDER_JOB_SECRET` or `CRON_SHARED_SECRET`

Without full Cloud Tasks config the code falls back to a non-durable in-process thread for local/staging convenience; `builder_async_health` logs which path is active at startup so prod never degrades silently.

## Sandbox And Runtime

Generated creations render inside an iframe with:

- `srcDoc`
- `sandbox="allow-scripts"`
- no `allow-same-origin`

This gives the artifact an opaque origin. It cannot read C-Point cookies, local storage, or session data.

`client/src/utils/creationHtml.ts` injects:

- viewport and base CSS safeguards,
- fit reporting,
- runtime error reporting,
- the `window.CPoint` data bridge when a creation ID exists.

## CPoint Creation API

Generated creations may use `window.CPoint` when present. They must always feature-detect it and degrade gracefully.

Supported capabilities:

- `CPoint.submitScore(value, opts)` - save a score.
- `CPoint.getLeaderboard(opts)` - read community leaderboard data.
- `CPoint.rate(value, opts)` - rate the creation.
- `CPoint.getResults()` - read aggregate ratings/results.
- `CPoint.save(key, value)` - save per-player progress/state/preferences (`value` is any JSON).
- `CPoint.load(key)` - load per-player saved state; resolves to `{value}` (`value` is `null` when nothing is saved).
- `CPoint.images(query, opts)` - fetch real freely licensed web photos.
- `CPoint.gameOver(opts)` - signal the native result overlay.
- `CPoint.hasPersistence` - `true` whenever the bridge is injected, so a creation can feature-detect save support.

Important: generated creations must not call arbitrary private services or invent backend APIs. The host bridge is the approved boundary.

### Persistence contract (save slots)

`localStorage`, `sessionStorage`, and cookies are blocked in the sandbox, so save slots are brokered to the host:

- Save: `POST /api/builder/<id>/data/save` `{ key, value }`; Load: `GET /api/builder/<id>/data/load?key=<key>`.
- Stored in MySQL `creation_data` under `namespace='save'`, **scoped per (creation, key, user)** — one player can never read another's save.
- Save keys are normalized by `_safe_save_key` (lowercase; whitespace → `_`; only `a-z 0-9 _ - . :` survive; max 64 chars; empty/junk → `save`). This preserves common generated slot names (`slot-1`, `saveSlot1`, `save slot 1`, `level:3`) instead of collapsing them to one bucket. Leaderboard/score keys keep the stricter `_safe_key` (`highscore` fallback).
- Limits: max ~`_SAVE_MAX_KEYS` (20) distinct slots per user/creation (`too_many_saves`); per-value size cap `_SAVE_MAX_BYTES` (`save_too_large`).
- The host broker logs save/load failures (`auth_required`, `not_found`, `rate_limited`, `save_too_large`, …) to the console so persistence never fails silently during QA.

### My Builds page

`/builds` (under `DashboardLayout`) lists the signed-in user's creations from `GET /api/builder/mine` so they can find, play/preview, or continue building without remembering which community they used. Reachable from a dashboard shortcut and the native sidebar.

## Host Controls Philosophy

The play surface should feel like the creation, not like a developer tool.

Host controls should be minimal:

- Keep a clear close/back control in the top-left.
- Keep native result/share overlays when the creation calls `CPoint.gameOver`.
- Do not show a host gamepad, D-pad, or debug-style control toggle.
- Do not add host-level sound controls.

Generated creations must include their own touch controls when interaction requires controls. They must not depend on keyboard-only input or host-provided gamepad controls.

## Sound Philosophy

Sound is optional and should belong to the creation.

Guidelines:

- Games and toys may include procedural sound when it improves delight.
- Quizzes, guides, recommendation tools, and informational creations should usually be silent.
- If sound exists, the generated creation should include a small mute toggle that matches its design.
- C-Point should not impose a separate platform-level sound icon.

This keeps Steve Build polished and avoids confusing users with platform chrome that feels unrelated to the creation.

## Conversation Quality

Steve's chat replies should be easy to read on mobile:

- short paragraphs,
- blank lines between ideas,
- bullets for plans/options,
- no long walls of text,
- concise hidden build briefs.

The conversation prompt should know the real Builder capabilities: web photos, saves, ratings, leaderboards, and play counts are supported. Steve should affirm those requests instead of refusing them as "outside services."

## AI And Revenue Invariants

Steve Build is AI-backed and revenue-sensitive.

Rules:

- Do not call model vendors directly from new code.
- Use `backend.services.content_generation.llm.generate_text`.
- Build turns log `ai_usage` with surface `builder`.
- Chat and plan calls use distinct surfaces so discussion does not consume build turns.
- Builder caps come from `resolve_entitlements` / KB-backed entitlements, not hard-coded UI logic.
- Blocks must log through `ai_usage.log_block`.

## QA Checklist

Before shipping Builder changes:

- Start a first build from a community.
- Confirm the request returns quickly and shows a server-side build state.
- Lock/switch apps, then return and confirm the job resumes/polls.
- Confirm completion notification opens the finished creation.
- Test a creation with `CPoint.images`.
- Save `slot-1`, reload the play surface, load `slot-1` — state returns.
- Save `slot-2` and confirm it does not overwrite `slot-1`.
- As a second user, confirm you cannot read the first user's save.
- Open `/builds` from the dashboard; play/preview and continue a creation.
- Test score/rating/result overlay.
- Confirm the play surface has only a visible top-left close control.
- Confirm there is no host gamepad button, D-pad overlay, or host sound icon.
- Confirm generated creations include their own touch controls.
- Confirm Steve chat replies render paragraphs/bullets.

## Roadmap

Likely next infrastructure steps:

- Cloud Tasks queue configuration for staging and production.
- Dedicated sandbox origin before broad public release.
- Remix/fork lineage built on `parent_creation_id`.
- Better creation quality evaluation and auto-repair loops.
- Version history per creation.
- Community templates and featured builds.
- Owner analytics: plays, ratings, top scores, shares, replays.
- Creator monetization marketplace: paid unlocks/tips/packs on creations, Stripe Connect payouts, a C-Point platform fee, moderation, refunds, tax/KYC, and quality thresholds (separate future epic).
