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
- `POST /api/internal/builder/jobs/<id>/run` - protected worker entry point.
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
2. Backend gates the turn with `entitlements_gate.gate_builder_or_reason`.
3. Backend creates a `builder_jobs` row and returns `202`.
4. The client can leave the screen and poll while open.
5. The worker runs generation server-side.
6. On success, the worker writes/updates the creation, logs `ai_usage`, and sends in-app plus push notification.
7. The notification deep-links back to the Builder page with the finished `creation_id`.

Production durability should use Cloud Tasks with:

- `BUILDER_TASKS_QUEUE`
- `BUILDER_TASKS_LOCATION`
- `PUBLIC_BASE_URL`
- `BUILDER_JOB_SECRET` or `CRON_SHARED_SECRET`

Without Cloud Tasks config, the code falls back to an in-process worker for local/staging convenience.

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
- `CPoint.save(key, value)` - save per-player progress/state/preferences.
- `CPoint.load(key)` - load per-player saved state.
- `CPoint.images(query, opts)` - fetch real freely licensed web photos.
- `CPoint.gameOver(opts)` - signal the native result overlay.

Important: generated creations must not call arbitrary private services or invent backend APIs. The host bridge is the approved boundary.

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
- Test save/load inside a generated creation.
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
