# Steve Build — Improvement Plan (July 2026)

Status: **approved** (grill-me session, 2026-07-01). Decisions recorded inline
as **[DECIDED]**. Source: full review of the `build`/staging Steve Build stack
(`backend/services/builder.py`, `backend/services/creation_match.py`,
`backend/blueprints/builder.py`, `client/src/utils/creationHtml.ts`,
`client/src/components/builder/PlayableCreation.tsx`, `backend/services/builder_guide.md`,
`backend/services/vision_judge.py`).

Overall verdict: the platform architecture (async jobs, sandbox, brokered CPoint
API, vision-judge repair loop, public publishing) is production-grade. The gaps
are (1) live two-player play reliability, (2) the polish ceiling of default
generated output, and (3) image quality for websites. Work is ordered by impact.

---

## Workstream 1 — Two-player live play (P0: "players can't play each other")

**[DECIDED] Phases 1.1 and 1.2 ship as ONE bundled PR** ("multiplayer runtime
hardening + host-owned lobby"). Runtime fixes propagate to ALL existing games
because the bridge is injected at render time by `PlayableCreation`, not baked
into stored artifacts.

Observed/confirmed failure modes (code-verified, including mid-game sync — the
reported "moves not syncing while both players are in an active match"):

- **Poll death (root cause of mid-game sync loss):** when a poll detects a
  change, `matchController.open()` calls `stopPolling()` FIRST and then awaits
  `match.get(id)`. If that one request fails (8s bridge timeout, transient
  network/DB blip, backgrounded WebView), the tick's catch swallows it and the
  timer is never restarted — the waiting player never sees another move until
  they close and reopen the game.
- **Overlapping polls:** the `setInterval` poll callback is async with no
  in-flight guard; any round trip slower than `pollMs` (1s) fires a second
  poll with the same `since` — duplicate `open()`s race on `current`/`state`,
  `onOpponentMove` fires twice, boards flicker/revert.
- **Post-move tap window:** between the opponent's move landing server-side
  and the client reload, taps throw `illegal_move`; `stale_version` conflicts
  reload but still THROW into generated game code, which rarely handles it.
- Player B never sees Player A's invite: `shouldPoll()` only polls while
  `pending_sent` or `opponent_turn` — a player sitting in the LOBBY has no
  polling at all; invites appear only after a manual reload.
- Resigns/accepts aren't seen while it's your turn (same `shouldPoll()` gap).
- **Context-mismatch 404s:** every op on an existing match filters by the
  CALLER's community context; players entering the same creation via
  different surfaces (multi-share, Explore, My Builds, deep link) get
  `match_not_found` on every op. `list_matches` being unscoped amplifies it.
- The whole lobby/invite UI is regenerated per game by the LLM, so one
  generation mistake breaks the entire flow — and nothing exercises it (the
  vision judge sees a static screenshot).

### Phase 1.1 — Runtime hardening (bundled with 1.2)

File: `client/src/utils/creationHtml.ts` (matchController + turnBasedGame).

1. **Never-dying polling:** `open()` failures must re-enter a retry loop with
   backoff instead of leaving the timer dead. Restructure so `stopPolling()`
   is only committed once the reload SUCCEEDS, and any failure schedules a
   retry (backoff up to ~10s) while keeping `onReconnect` semantics.
2. **In-flight guard + generation token:** skip a poll tick while a poll or
   reload is in flight; stamp reloads with a monotonically increasing token
   and discard stale completions, so overlapping requests can never clobber
   newer state or double-fire `onOpponentMove`.
3. **Conflict auto-retry:** on `illegal_move` right after a reload, and on
   `stale_version`/`not_your_turn` from the server, the runtime reloads and
   retries/absorbs internally instead of throwing at generated game code
   (still surfaces a final error if genuinely illegal).
4. Add lobby polling: while no match is open and the tab is visible, re-run
   `refreshLobby()` every ~5s and call `onLobby` only when the match list
   actually changed (compare ids/status/last_seq hash to avoid render churn).
5. Broaden `shouldPoll()`: poll active matches on `your_turn` too (slower
   cadence, ~5s) so resigns and accepts surface everywhere; keep the 1s fast
   path while `pending_sent`/`opponent_turn`.

Files: `backend/services/creation_match.py`, `backend/blueprints/builder.py`.

6. **[DECIDED] Seat-based authorization for existing-match ops:** `get`,
   `poll`, `move`, `accept`, `decline`, `cancel`, `resign` authorize by "caller
   is seat 1 or seat 2" plus the MATCH's own stored community (defense-in-depth
   membership re-check) — the caller-context `community_id` filter is dropped
   for these ops. Context remains authoritative only for `opponents`, `create`,
   and `list` (lobby is per-community; new matches pin to creation context).
7. Scope `list_matches(creation_id, username)` by the caller's community
   context (per-community lobby isolation).

Server load note: lobby polling at 5s/user is bounded by `_data_read_ok`-style
throttles; add a match-list read throttle if needed.

Acceptance: two logged-in browsers, same community, same creation —
invite appears on B's lobby within 5s; accept flips A into the game within 1s;
moves sync both ways for 20+ consecutive moves with airplane-mode blips
injected (sync always recovers); a resign while it's A's turn appears within
5s; a match opened from a notification deep link or Explore works even when
the other player entered via the community feed; a match created in community
X never shows in community Y's lobby.

### Phase 1.2 — Host-owned lobby overlay (bundled; the big reliability win)

**[DECIDED] Option A — runtime-signalled.** Move lobby/invite UX out of
generated code:

- When the injected `turnBasedGame` runtime boots, it posts a message to the
  host declaring the game turn-based multiplayer; the host then renders a
  native lobby overlay and the runtime SKIPS its own lobby boot path.
- `PlayableCreation.tsx` renders the native lobby (opponents list, your games,
  invites with Accept/Decline, sent invites with Cancel, New game) using the
  existing `/api/builder/<id>/match/*` routes directly (React, brand-styled,
  i18n-ready).
- The iframe is only handed an ACTIVE match via the existing
  `window.CPoint.startMatchId` mechanism (srcDoc reload).
- Coverage: ALL `turnBasedGame`-based games — past and future — get the host
  lobby with no regeneration and no double-lobby. Legacy games that hand-rolled
  `matchController`/raw `match.*` keep their own lobby but still benefit from
  every Phase 1.1 hardening fix.
- `builder_guide.md` is updated so new multiplayer builds implement ONLY board
  + rules (`initialState/canMove/applyMove/getResult/render`).

Living docs rule: update `backend/services/builder_guide.md` (CAPS section) and
`docs/STEVE_BUILD.md` in the same change.

### Phase 1.3 — Built-in rules + automated two-session QA

1. Rules modules for the classics: ship vetted, tested JS implementations of
   tic-tac-toe, Connect-4, checkers (and later chess) exposed via the bridge
   (e.g. `CPoint.rules('connect4')` returning `canMove/applyMove/getResult`),
   so the model stops reimplementing move legality per build.
2. Two-session QA harness: a Playwright script that logs in two test users,
   opens a generated multiplayer creation, and runs lobby → invite → accept →
   3 moves → resign. Run it in CI against a seeded fixture game, and (later)
   as an optional post-build verification step feeding the existing
   `_repair_regen` loop.

### Phase 1.4 — Latency + lifecycle hardening (later)

- SSE (or long-poll) endpoint for move delivery to replace 1s polling.
- Match expiry: nudge notification after 48h of no move; auto-expire after 14
  days (new `sweep` case in the existing cron).
- Optional server-side result validation for known rule modules (anti-cheat).

---

## Workstream 2 — Default design quality (P1: "impress from the first build")

Today: `builder_guide.md` sets a strong bar in prose, but enforcement
(`vision_judge` design-refine) only runs for the `best` tier below score 70.
Default (`balanced`) builds never get a design fix.

1. **[DECIDED] Design-refine on balanced tier** (`backend/services/builder.py`):
   run the refine pass for `balanced` (the default tier) at
   `_DESIGN_REFINE_THRESHOLD` raised 70 → 80; `fast` stays untouched (cheap
   and quick by contract); `best` keeps refine + gains best-of-2. Render +
   judge already run on every async build, so the only added cost is one
   conditional low-temperature regen on sub-80 balanced builds.
2. **Theme packs (few-shot tokens):** add 4–6 curated art directions
   (editorial, dark-premium/glass, neon-arcade, warm-light, sporty-kinetic,
   playful-pastel) as concrete ~40-line CSS token + component blocks in a new
   `backend/services/builder_themes.py`; pick by kind/topic keywords and inject
   ONE into the codegen prompt. Models follow real token blocks far better
   than adjectives.
   **[DECIDED] The dark-only rule is relaxed:** the technical contract changes
   from "dark background" to "committed background — dark-premium by DEFAULT
   (brand-aligned), light editorial allowed when the art direction/topic calls
   for it or the user asks." The host already adapts (BG reporter matches the
   creation's body background), so this is a prompt-contract change only.
3. **Baseline CSS floor:** extend `BASE_CSS` in `creationHtml.ts` with a
   minimal floor (font smoothing, focus-visible rings, button/input resets,
   `prefers-reduced-motion` guard) so even weak generations inherit polish.
4. **Best-tier best-of-2:** for first builds on `best`, generate two
   candidates, vision-judge both, keep the winner (judge already exists and is
   surface-logged separately, so this doesn't eat build turns).
5. Log `design_score` onto `creations` so improvements are measurable week
   over week.

Acceptance: median judge `design_score` for balanced-tier first builds rises
measurably; zero "default purple gradient / unstyled" builds in QA sampling.

---

## Workstream 3 — Websites + images (P1: "great right from the get-go")

Images are the weakest link: `search_images` is Openverse-only (low-res
thumbnails, mediocre relevance) which caps how good a website hero can look.

1. **[DECIDED] Multi-provider image search — both keyless and keyed**
   (`backend/services/builder.py`): ship Wikimedia Commons (keyless) + better
   ranking immediately; code Pexels and Unsplash as OPTIONAL providers behind
   `PEXELS_API_KEY` / `UNSPLASH_ACCESS_KEY` env vars (owner will create the
   accounts — Pexels first), degrading gracefully when absent. Merge +
   de-dupe + rank (prefer larger, landscape for heroes); keep the existing
   route contract `{url, full, title, creator, license}` so no client/bridge
   changes are needed. Cache per query as today.
2. **Build-time hero selection:** during website/app builds, fetch image
   candidates for the main subject, let the vision judge pick the best hero,
   and bake it in via an `engine:"images"` capsule (mechanism already exists)
   so the hero is stable, attributed, and never a broken hotlink.
3. **Copywriting pass for websites:** a cheap fast-model pass that rewrites
   hero headline/subhead/CTA and section copy to editorial quality before
   codegen (feeds the brief, costs no build turn — separate `ai_usage`
   surface like chat).
4. **Public build share polish** (`services/public-builds-worker/`,
   publish-web path in `builder.py`): inject SEO/OG meta (title, description,
   OG image) at publish time; generate the OG image from the existing
   render-service screenshot.
5. **[DECIDED] No visible "Sources"/citation blocks in creations.** The
   codegen guide's mandate for a visible Sources section (build-time research)
   is REMOVED. License-required attribution (Open-Meteo CC-BY, Wikipedia
   CC BY-SA, Openverse per-photo CC) moves to one discreet affordance: a small
   corner/footer "ⓘ" in muted micro-text that expands on tap. Update
   `builder_guide.md` (§4 data/connector rules + §7 data accuracy) and
   `docs/STEVE_BUILD.md` connector rules accordingly; keep `attribution` in
   API responses unchanged.

Acceptance: a "restaurant website" prompt produces a hero with a relevant,
high-res photo and editorial copy on the FIRST build; published links unfurl
with a real preview card in chat apps.

---

## Workstream 4 — Verification & rollout

- Unit tests: matchController lobby-poll logic (extend
  `client/src/utils/creationHtml.test.ts`), `list_matches` community scoping
  (`tests/test_creation_match*.py`), image provider merge/rank, theme pack
  selection.
- Two-session Playwright multiplayer test in CI (Phase 1.3).
- Update living docs in the same PRs: `docs/STEVE_BUILD.md`,
  `backend/services/builder_guide.md`, `docs/QA_CHECKLIST.md` (add the
  two-browser multiplayer QA steps), `docs/BACKEND_ROUTES.md` if routes change.
- Rollout: each phase lands on staging behind normal deploy; multiplayer
  Phase 1.1 first (small diff, immediately fixes "can't play each other"),
  then 1.2; design/image workstreams can proceed in parallel.

## Suggested sequence

| Order | Item | Size |
| --- | --- | --- |
| 1 | 1.1 + 1.2 bundled: runtime hardening, seat-based auth, host-owned lobby | L |
| 2 | 2.1 design-refine on balanced tier (threshold 80) | S |
| 3 | 3.1 multi-provider images (keyless now, keyed env-ready) | M |
| 4 | 2.2–2.4 theme packs (incl. light), CSS floor, best-of-2, sources removal | M |
| 5 | 3.2–3.4 hero selection, copy pass, OG cards | M |
| 6 | 1.3 rules modules + two-session QA harness | L |
| 7 | 1.4 SSE + match lifecycle | L |
