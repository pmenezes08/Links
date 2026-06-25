# Steve Build

Steve Build is C-Point's creation surface: a member chats with Steve, Steve proposes a small playable or useful front-end creation, and the result can be tested, iterated, shared to communities, or published as an eligible public website/app.

This is a major product direction for C-Point. The goal is not to copy a generic app builder. The goal is to make creation social: members can start with a personal creation, then share it into one or more communities with community-specific data, feedback, play, and privacy.

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
- `POST /api/builder/<id>/publish` / `POST /api/builder/<id>/share` - share an owned creation into a community post; the target community can be supplied for personal creations and membership is enforced by the route.
- `GET /api/builder/<id>/publish-web` - owner-only public web publication status.
- `POST /api/builder/<id>/publish-web` - owner-only, publish an eligible website/app to `builds.c-point.co`.
- `DELETE /api/builder/<id>/publish-web` - owner-only, unpublish a public web link.
- `GET /api/builder/explore` - anonymous approved in-platform Explore listings.
- `POST /api/builder/<id>/gallery` - owner opt-in/unlist for Explore Creations.
- `POST /api/admin/builder/<id>/gallery` - app-admin approve/reject/delist review endpoint.
- `GET /api/builder/public/<slug>/data/feed` - unauthenticated public-data connector for published public builds only.
- `/api/builder/<id>/data/*` - host-brokered creation data APIs.

Core service:

- `backend/services/builder.py`

Storage:

- `creations` stores owner, optional home community, status, prompt history, chat history, artifact metadata, public-web metadata, and Explore gallery lifecycle fields. New/updated artifact HTML is uploaded to private Cloudflare R2 via `html_r2_key`; `html_content` remains a MySQL fallback for legacy rows or R2-disabled environments.
- `creation_shares` maps one creation to one or more community posts (`creation_id`, `community_id`, `post_id`, `shared_by`). New Steve creations can be personal (`community_id=NULL`) and later shared to any community the owner belongs to.
- Public web publication metadata lives on `creations`: `public_slug`, `public_status`, `public_html_r2_key`, `public_published_at`, `public_unpublished_at`, and `public_kind`. These fields describe the external website/app copy only; community feed publishing stays separate.
- `builder_jobs` stores async build/iterate jobs so builds continue if the user leaves, locks the phone, or switches apps.
- `creation_data` stores host-brokered scores, ratings, saves, and related creation data scoped by active community context.

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
- `CPoint.data(connector, params)` - fetch recent public data from vetted host-side connectors.
- `CPoint.sharedState.get(key)` / `CPoint.sharedState.update(key, value, opts)` - one shared JSON document per creation/key for lightweight community app state.
- `CPoint.collection(name)` - small structured row collections for task boards, RSVP lists, nominations, directories, feedback walls, and similar app surfaces.
- `CPoint.forms.submit(name, data)` - append-only form submissions for websites and apps.
- `CPoint.turnBasedGame(config)` - preferred high-level runtime for two-player turn-based games; generated code supplies rules/rendering while the platform owns lifecycle, live-feeling polling, and opponent move deltas.
- `CPoint.matchController(opts)` - preferred helper for two-player turn-based games; owns lobby refresh, sent/received invites, cancel/decline/accept, polling, reconnect backoff, stale reloads, tab cleanup, and seat helpers.
- `CPoint.match.*` - lower-level two-player match API (`list`, `opponents`, `create`, `get`, `poll`, `move`, `accept`, `decline`, `cancel`, `resign`) for advanced cases.
- `CPoint.gameOver(opts)` - signal the native result overlay.
- `CPoint.hasPersistence` - `true` whenever the bridge is injected, so a creation can feature-detect save support.
- `CPoint.hasData` - `true` whenever brokered public-data connectors are available.
- `CPoint.hasCreationData` - `true` when shared state, collections, and forms are available.
- `CPoint.hasMultiplayer` / `CPoint.hasMatchController` / `CPoint.hasTurnBasedGame` - `true` when two-player turn-based multiplayer runtimes are available.

Important: generated creations must not call arbitrary private services or invent backend APIs. The host bridge is the approved boundary.

### Creation data runtime

Steve Build exposes safe, brokered data primitives instead of arbitrary databases:

- `sharedState` is for one compact shared JSON value per creation/key. Use it for polls, shared counters, prediction boards, and simple dashboards. Updates accept an optional `version` for optimistic conflict handling.
- `collection(name)` is for small structured row sets. Use it for apps such as task boards, RSVPs, directories, nominations, and feedback walls. Rows are compact JSON values with `id`, `version`, timestamps, and creator metadata.
- `forms.submit(name, data)` is append-only. Use it for websites and apps that need signups, feedback, surveys, votes, or nominations. Do not ask users for sensitive private data in generated forms.

All writes are session-authenticated through the host, scoped to the active context (`personal` or `community:<id>`), rate-limited, and size-limited. If the same creation is shared to multiple communities, scores, ratings, saves, shared state, collections, forms, leaderboards, and multiplayer matches stay isolated per community. Generated creations must render loading/empty/error states and must never invent their own database, raw API route, or localStorage workaround.

### Two-player multiplayer

Two-player games use a host-brokered match system. The sandbox never sees raw usernames and never writes directly to the database; every call is routed through the signed-in user's session and active community share context.

Preferred path:

- Generated turn-based games should use `CPoint.turnBasedGame(config)` first. The generated code supplies `initialState`, `canMove`, `applyMove`, `getResult`, `render`, and optionally `onOpponentMove`; the platform owns the lifecycle.
- Generated games should use `CPoint.matchController(opts)` for normal turn-based games. The controller owns the common lifecycle: lobby refresh, accepting/declining received invites, cancelling sent invites, opening a match, polling sent pending invites until they become active, polling active matches only while waiting for the opponent's move, reloading authoritative state after poll changes, backing off reconnect UI until repeated failures, and cleaning up timers when the tab is hidden.
- Game code supplies only the rules and rendering callbacks: `startingState(match)`, `applyMove(state, action, match)`, `getResult(nextState, match, action)`, `onLobby(matches)`, `onMatch(view)`, and `onReconnect(count)`.
- `controller.view()` returns stable lifecycle and seat helpers: `phase`, `canMove`, `isPending`, `isWaitingForAccept`, `isInviteReceived`, `isActive`, `isFinished`, `yourSeat`, `isWhite`, `isBlack`, `yourTurn`, `status`, `winner`, `lastSeq`, and `opponent`. Generated games should render from `phase`/`canMove`, not from `yourTurn` alone; `yourTurn=false` can mean pending, finished, or opponent turn.
- For live-feeling turn-based play, `turnBasedGame` defaults to faster polling while the local player is waiting. Poll deltas are exposed as `view.moves`, `view.lastMove`, and `onOpponentMove(move, state, view, delta)`. Board/card games should include animation metadata in submitted actions, such as `{from,to,piece}` or `{cardId,fromZone,toZone}`, so the opponent can animate the move when both players have the game open.

Raw API:

- `CPoint.match.opponents()` returns only eligible members in the active community share context, as opaque handles.
- `CPoint.match.create(handle)` creates a pending invite by resolving that opaque handle only within the active community.
- `CPoint.match.accept(id)` and `CPoint.match.decline(id)` are for the invited player.
- `CPoint.match.cancel(id)` is for the challenger to cancel a pending invite before it is accepted.
- `CPoint.match.resign(id)` forfeits an active or pending match as the current player.
- `CPoint.match.move(id,{move,state,version,result})` writes a full compact state blob and enforces optimistic concurrency.

Backend routes live under `/api/builder/<id>/match/*`; the route inventory is regenerated in `docs/BACKEND_ROUTES.md`.

### Public data connectors

`CPoint.data(connector, params)` calls `GET /api/builder/<id>/data/feed`. The sandbox passes a connector ID and typed params; the backend constructs every upstream URL server-side. Raw URLs are never accepted.

Supported connectors:

| Connector | Typical params | Source | Cache |
| --- | --- | --- | --- |
| `weather` | `{place}` or `{lat, lon}` | Open-Meteo | ~15 min |
| `country` | `{name}` or `{code}` | REST Countries | ~24 h |
| `wikipedia` | `{search}` or `{title}` | Wikimedia REST | ~1 h |
| `recipe` | `{search}` or `{random:true}` | TheMealDB | batched/random cache |
| `cocktail` | `{search}` or `{random:true}` | TheCocktailDB | batched/random cache |
| `pokemon` | `{name}` or `{id}` | PokeAPI | ~24 h |
| `joke` | `{category}` | JokeAPI | batched/random cache |
| `fact` | `{random:true}` | Useless Facts | batched/random cache |
| `advice` | `{search}` or `{}` | Advice Slip | batched/random cache |
| `technews` | `{feed:'top'|'new'|'best', limit}` | Hacker News | ~5 min |
| `sports` | `{day:'YYYY-MM-DD', sport:'Soccer'}` or `{leagueId, mode:'next'|'past'}` | TheSportsDB | ~5 min |

Connector rules:

- Data is **recent**, not millisecond-live. Sports is for fixtures/results ("yesterday's scores", "tomorrow's games"), not second-by-second scoreboards.
- Every response includes `attribution`; generated creations must display it near the data.
- Connectors are cached globally because the data is public. `cpfeed:cache:*` holds fresh data, `cpfeed:stale:*` holds last-good data for stale-while-revalidate fallbacks, `cpfeed:budget:*` tracks per-connector budget windows, and `cpfeed:cb:*` tracks circuit-breaker cooldowns.
- Random connectors return a batch (`data.items`) so the artifact can pick one client-side; this prevents one upstream call per player.
- Redis keys all carry TTLs. Budget/circuit counters should not be evicted under memory pressure; avoid a shared-cache eviction policy that can silently drop those counters.

### Artifact storage

Creation HTML is still returned through `GET /api/builder/<id>` as `creation.html`, but the backing store is private R2 when available:

- Write path: after create/iterate, `backend.services.builder.store_artifact_html` uploads the HTML to R2 with a key like `private/creations/<id>/<updated_at>.html`, then stores that key in `creations.html_r2_key` and clears the inline blob.
- Read path: `get_creation` resolves `html_r2_key` through `download_bytes_from_r2`, with a short Redis body cache keyed by creation ID and `updated_at`; if R2 is unavailable or the key is absent, it falls back to `html_content`.
- Delete path: `delete_creation` deletes the private R2 object, `creation_data`, related `builder_jobs`, and the published post/dependents.
- Backfill: `scripts/backfill_builder_artifacts_to_r2.py` migrates legacy inline rows in batches and is idempotent.

### Public web publishing

Public web publishing is V1-scoped to websites and lightweight apps. Games remain inside C-Point because identity, saves, scores, leaderboards, and multiplayer are community/session-bound.

- Owner flow: `POST /api/builder/<id>/publish-web` validates ownership and kind, generates a stable slug, injects the public-safe bridge plus C-Point branding, uploads a public artifact copy to R2, and writes a slug manifest for the Cloudflare Worker.
- Public URL: `https://builds.c-point.co/<slug>` (staging Worker uses its own environment until DNS is wired).
- R2 keys: artifact copies use `public/builds/<slug>/<version>.html`; manifests use `public/builds/<slug>/manifest.json`.
- Worker: `services/public-builds-worker/` serves the manifest-resolved artifact from an R2 binding, applies strict security headers, and returns a branded 404 when unpublished or missing.
- Public bridge: `window.CPoint.isPublicBuild = true`; public builds can use vetted `CPoint.data` connectors, but private session features are disabled (`save/load`, scores, ratings, shared collections/forms, and multiplayer).
- Branding: the platform injects a fast C-Point loading splash and a persistent "Built with C-Point" badge linking to `https://www.c-point.co`.
- Unpublish/delete: `DELETE /api/builder/<id>/publish-web` removes the manifest and artifact copy; deleting a build also deletes any public manifest/artifact.

### Explore Creations

Explore Creations is an anonymous, opt-in gallery for creations inside C-Point:

- Public URL and gallery listing are separate. `public_status='published'` means the owner has an external shareable URL; `gallery_status='approved'` means the owner opted into Explore and signed-in C-Point members may open it at `/creation/<id>`.
- Owners opt in or remove listing with `POST /api/builder/<id>/gallery`. App admins can still approve/reject/delist with `POST /api/admin/builder/<id>/gallery`.
- `GET /api/builder/explore` returns only privacy-safe fields: title, kind, in-platform play URL, optional public URL, play count, and generic "Made with Steve" label. It never returns creator username, avatar, profile path, community id/name, or post id.
- Public-web publishing is optional and limited to eligible websites/apps; games and other session-bound creations can still appear in Explore through the in-platform play route.

### Persistence contract (save slots)

`localStorage`, `sessionStorage`, and cookies are blocked in the sandbox, so save slots are brokered to the host:

- Save: `POST /api/builder/<id>/data/save` `{ key, value }`; Load: `GET /api/builder/<id>/data/load?key=<key>`.
- Stored in MySQL `creation_data` under `namespace='save'`, **scoped per (creation, key, user)** — one player can never read another's save.
- Save keys are normalized by `_safe_save_key` (lowercase; whitespace → `_`; only `a-z 0-9 _ - . :` survive; max 64 chars; empty/junk → `save`). This preserves common generated slot names (`slot-1`, `saveSlot1`, `save slot 1`, `level:3`) instead of collapsing them to one bucket. Leaderboard/score keys keep the stricter `_safe_key` (`highscore` fallback).
- Limits: max ~`_SAVE_MAX_KEYS` (20) distinct slots per user/creation (`too_many_saves`); per-value size cap `_SAVE_MAX_BYTES` (`save_too_large`).
- The host broker logs save/load failures (`auth_required`, `not_found`, `rate_limited`, `save_too_large`, …) to the console so persistence never fails silently during QA.

### My Builds page

`/builds` (under `DashboardLayout`) lists the signed-in user's creations from `GET /api/builder/mine` so they can find, play/preview, or continue building without remembering which community they used. Reachable from a dashboard shortcut and the native sidebar.

Owners can permanently delete their builds from this page. The delete action calls `DELETE /api/builder/<id>` and removes the artifact row, `creation_data` rows (saves, scores, ratings), related `builder_jobs`, and the published community post if one exists. Deletion is owner-only and returns non-enumerating errors for non-owners.

### On-screen keyboard

The app runs with `KeyboardResize.None`, so the WebView never shrinks for the keyboard; instead `App.tsx` publishes the keyboard height as the `--keyboard-offset` CSS variable. The `PlayableCreation` surface consumes it (`paddingBottom: max(--sab-px, --keyboard-offset)`) so a focused text input in a generated creation is lifted above the keyboard instead of being hidden behind it. Generated creations get a 16px input font-size floor (`creationHtml.ts` `BASE_CSS`) to avoid the iOS focus-zoom, and the codegen prompt tells creations with inputs to use `100dvh`/`100%` layouts and `scrollIntoView` on focus.

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
