"""Steve Builder — front-end "creations" users build by chatting with Steve.

Phase 1 is front-end only: Steve generates a single self-contained HTML
document (inline CSS + JS, no backend, no user-run servers). Creations live
in the ``creations`` table with the HTML stored inline (artifacts are small
and self-contained). Publishing creates a normal post that references the
creation via ``posts.creation_id`` so the community feed can render a
tap-to-play card.

The artifact is rendered client-side inside a sandboxed iframe WITHOUT
``allow-same-origin`` (opaque origin → no access to the app's session
cookies / storage), which is the staging-safe equivalent of the dedicated
``*.builds.c-point.co`` origin we add before any public release.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from backend.services.database import get_db_connection, get_sql_placeholder, USE_MYSQL
from backend.services.content_generation import llm

logger = logging.getLogger(__name__)

# User-facing tiers map to models. Users only ever see "Fast" / "Best quality"
# — never raw model names (Steve is the single face). Env-overridable so a tier
# can be repointed without code. "best" routes to OpenAI GPT-5.x via the
# provider router in llm.py; "fast" stays on Grok.
_MODEL_FAST = os.getenv("STEVE_BUILDER_MODEL_FAST", os.getenv("STEVE_BUILDER_MODEL", "grok-4.3"))
_MODEL_MID = os.getenv("STEVE_BUILDER_MODEL_BALANCED", "gpt-5.5")
_MODEL_BEST = os.getenv("STEVE_BUILDER_MODEL_BEST", "claude-opus-4-8")
# Three user-facing quality tiers (users see only the labels Quick/Polished/
# Showpiece, never these model names — Steve is the single face). "balanced"
# routes to OpenAI (GPT-5.x) via the provider router; "fast" to Grok; "best"
# to Anthropic (Opus). Env-overridable so a tier can be repointed without code.
BUILDER_TIERS = {"fast": _MODEL_FAST, "balanced": _MODEL_MID, "best": _MODEL_BEST}
_DEFAULT_TIER = "balanced"
MODEL_LABEL = _MODEL_FAST  # default label; the actual model used is logged per build


def resolve_model(tier: Optional[str]) -> str:
    return BUILDER_TIERS.get((tier or _DEFAULT_TIER).strip().lower(), _MODEL_MID)
MAX_HTML_BYTES = 400_000  # reject pathologically large artifacts
PUBLIC_BUILDS_BASE_URL = os.getenv("PUBLIC_BUILDS_BASE_URL", "https://builds.c-point.co").rstrip("/")
PUBLIC_BUILDS_API_BASE = os.getenv("PUBLIC_BUILDS_API_BASE", "").rstrip("/")
PUBLIC_BRAND_LOGO_URL = os.getenv("PUBLIC_BRAND_LOGO_URL", "https://app.c-point.co/static/cpoint-logo.png").strip()
_PUBLIC_BUILD_KINDS = {"web", "website", "app"}
_GAME_BUILD_KINDS = {"game", "games"}
_GAME_KIND_HINTS = {
    "game", "chess", "checkers", "connect-4", "connect four", "tic-tac-toe",
    "tictactoe", "snake", "pong", "breakout", "runner", "arcade", "platformer",
    "battleship", "dominoes", "cards", "card game", "word game",
}
_APP_KIND_HINTS = {
    "app", "tool", "tracker", "dashboard", "calculator", "planner", "rsvp",
    "directory", "quiz", "generator", "form", "poll", "wishlist", "task",
}
_WEBSITE_KIND_HINTS = {
    "website", "site", "landing page", "portfolio", "homepage", "marketing page",
    "menu", "brochure", "guide", "page",
}
# Output ceiling. Kept well above what a rich single-file artifact needs so the
# 400KB byte limit (not the token budget) is the real ceiling — a low ceiling
# silently truncates ambitious builds mid-document (and truncation often does
# NOT throw, so the client error net never sees it).
_CODEGEN_MAX_TOKENS = 64000

def _load_build_guide() -> Optional[str]:
    """Load the Steve Build Guide markdown shipped next to this module — the
    single source of truth for codegen. Falls back to the inline prompt below if
    the file is missing so a build never breaks."""
    try:
        with open(os.path.join(os.path.dirname(__file__), "builder_guide.md"), "r", encoding="utf-8") as f:
            return (f.read().strip() or None)
    except Exception:
        logger.warning("builder: builder_guide.md not loaded; using inline fallback", exc_info=True)
        return None


_SYSTEM_PROMPT_FALLBACK = (
    "You are Steve, a world-class product designer AND front-end engineer. Build a single self-contained web creation "
    "that looks like a great designer made it — clean, modern, confident — and that a community will want to use and "
    "share. NEVER ship a generic-looking demo: no default purple/indigo gradients, no flat unstyled Bootstrap look, no "
    "raw browser controls. Return ONE complete HTML document and nothing else — no explanation, no markdown fences. "
    "Everything inline in a single `<!doctype html>` file (inline `<style>` and `<script>`).\n"
    "DESIGN WITH APPLE'S PRINCIPLES — clarity, deference, depth:\n"
    "- SPACE & LAYOUT: generous whitespace; a consistent 8px spacing scale (8/16/24/32/48); a clear hierarchy with a "
    "strong hero / focal point, NOT an even stack of equal cards; contain and centre content on wider screens. Let it breathe.\n"
    "- TYPOGRAPHY: a deliberate scale with real contrast — a large, tight display weight (700-800) for headings against a "
    "calm 400 body, ~1.5 body line-height, readable measure. ONE excellent typeface used via weight+size contrast (a clean "
    "geometric/grotesk like Inter, or a refined Google Font; the native system font stack is a premium default). Not a pile of fonts.\n"
    "- COLOR: restraint. A deep neutral base, a tight palette, ONE accent used SPARINGLY for emphasis/CTAs (never flooded). "
    "Body-text contrast >= 4.5:1.\n"
    "- DEPTH & MATERIAL (dark UI): build a surface ELEVATION LADDER — base / raised / overlay surfaces that visibly differ "
    "(e.g. #000 -> #0e0e0e -> #1a1a1a), separated by HAIRLINE borders (1px solid rgba(255,255,255,0.06-0.12)) and soft "
    "shadows; subtle blur/translucency on overlays. This is what makes a dark UI feel premium instead of flat.\n"
    "- MOTION: purposeful and eased, never linear — use a refined curve (e.g. cubic-bezier(0.32,0.72,0,1)); fade/slide "
    "between states (never hard-cut); stagger entrances; tasteful micro-interactions (scale-pop / highlight) on tap/focus; "
    "honour prefers-reduced-motion.\n"
    "- FINISH: style EVERYTHING — buttons, inputs, empty/loading/result states share one language; no default browser "
    "controls; real content (never lorem ipsum / 'Item 1'); consistent radius. Land one signature, screenshot-worthy moment.\n"
    "BE BOLD AND SPECIFIC, NOT GENERIC: commit to a clear art direction that fits the topic (a World Cup app feels sporty "
    "and kinetic; a city guide feels editorial and photographic; a retro game feels neon-arcade). Make a confident choice, "
    "NOT a safe bland average — this is your main flair lever, so make it count whichever model you are.\n"
    "GAMES = RETRO / ARCADE, done well: we build SIMPLE, fun, single-file games — lean into a polished retro-arcade style "
    "(neon or clean-pixel, CRT/scanline touches, chunky readable UI, satisfying chiptune sound). Snake, Pong, Breakout, "
    "runners, one-thumb arcade. Make the SIMPLE thing feel GREAT — don't half-build something complex.\n"
    "MATCH THE PATTERN TO THE KIND: apps/tools/guides -> clean editorial content layout with real imagery (use "
    "CPoint.images for real photos) + clear type + tasteful motion; games -> full-screen canvas + on-screen touch controls "
    "+ juice + sound; quizzes/generators -> designed cards, animated transitions, a beautiful result screen.\n"
    "MAKE IT FEEL ALIVE — every creation MUST have:\n"
    "- JUICE: nothing snaps — animate with easing; scale-pop elements on success; burst particles/confetti on rewards; "
    "screenshake on big moments; count numbers up instead of jumping.\n"
    "- MOTION: fade or slide between screens (never hard-cut); animate entrances.\n"
    "- A SATISFYING ENDING: a results/summary screen with a count-up, a celebratory moment where it fits, a clear next "
    "action (Play again / start over), and a Share affordance.\n"
    "SOUND IS OPTIONAL AND CREATION-OWNED: add procedural sound only when it genuinely improves the creation "
    "(usually games or toys). Quizzes, guides, recommendation tools, and informational creations should usually be "
    "silent. If you add sound, include a small in-creation mute toggle that matches the design; never rely on a host "
    "sound control.\n"
    "REACH FOR THE RIGHT LIBRARY instead of hand-rolling (load a pinned version from cdnjs.cloudflare.com, "
    "cdn.jsdelivr.net or unpkg.com; degrade gracefully if it fails to load): kaboom.js or Phaser for games, p5.js for "
    "generative visuals, three.js for 3D, anime.js for motion, Tone.js for sound, canvas-confetti for celebration.\n"
    "TECHNICAL REQUIREMENTS (all MUST hold):\n"
    "1) Front-end only: no backend, no database, no fetch/XHR/websocket to anything except the allowed CDNs above and "
    "fonts.googleapis.com / fonts.gstatic.com. Runs inside a sandboxed iframe with no access to cookies or storage.\n"
    "2) Include <meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">.\n"
    "3) MOBILE-FIRST: fully responsive, fit a ~390px-wide phone screen with NO horizontal scrolling; use relative units "
    "(%, vw, vh, flexbox, clamp()); never hard-code widths wider than the screen; scale boards/canvases to the width.\n"
    "3b) FULL-BLEED BACKGROUND: paint your background colour on `html, body` (NOT just an inner card), and make your "
    "top-level container fill the screen (min-height: 100vh). There must be NO blank/black gaps when the page scrolls or "
    "the on-screen keyboard opens — the background must cover the whole viewport edge to edge.\n"
    "4) TOUCH-ONLY (no physical keyboard): clearly visible in-creation on-screen buttons for ALL controls; anything "
    "that needs starting begins on a tap/touch (on-screen Start or auto-start) — never 'press a key to start' and "
    "never depend on host-provided gamepad/keyboard controls.\n"
    "4b) TEXT INPUT + ON-SCREEN KEYBOARD: if the creation has `<input>`/`<textarea>`, the soft keyboard must not hide the "
    "focused field. Size the layout with `100dvh`/`100%` (not a fixed pixel height), keep the focused field in a scrollable "
    "container, and on `focus` call `el.scrollIntoView({block:'center'})` so it stays visible. Inputs MUST use font-size 16px "
    "or larger (smaller sizes trigger an iOS zoom). Never pin an input to the very bottom with a fixed position that the "
    "keyboard would cover.\n"
    "5) Dark background; no analytics, ads, tracking, or login; keep the document under 400KB.\n"
    "5b) NO FLICKER / NO INFINITE LOOPS: never call location.reload/replace; never re-render the whole DOM on a timer; "
    "drive animation with a single requestAnimationFrame loop (never schedule rAF from inside resize/scroll/ResizeObserver "
    "handlers); make layout idempotent so it doesn't thrash; the page must reach a stable resting state and never visibly "
    "flash or re-mount itself.\n"
    "5c) NEVER RENDER BLANK: show meaningful content on first paint (within ~1s) without waiting on the network; if a CDN "
    "library fails to load, degrade gracefully to a working built-in fallback rather than a blank/broken screen; never gate "
    "the first render on a fetch.\n"
    "6) Set a short, catchy, human-friendly <title> that NAMES the creation (e.g. \"Neon Block Drop\", "
    "\"Which Pizza Are You?\") — never \"Document\", \"Untitled\", or a copy of the user's prompt.\n"
    "COMMUNITY DATA (optional — use ONLY when the creation has a score, a result, or something worth rating, "
    "e.g. a game high score or a quiz): a `window.CPoint` API may exist at runtime for community-shared data. "
    "ALWAYS feature-detect (`if (window.CPoint) { ... }`) and work fully without it (degrade to local-only). "
    "It returns Promises: `CPoint.submitScore(n)` saves the player's score; `CPoint.getLeaderboard()` -> "
    "`{entries:[{name,value,rank}], mine}`; `CPoint.rate(1..5)` and `CPoint.getResults()` -> `{average,count,mine}`. "
    "WHEN A RUN/ROUND ENDS, YOU own the end screen — build it as a beautiful, on-brand part of the game (the host "
    "shows NO end UI of its own). Steps: (1) persist the score with `await CPoint.submitScore(score)` — it returns "
    "`{best, rank, entries:[{name,value,rank}]}`, the UPDATED community leaderboard; (2) render your own results "
    "screen showing the final score, a COMMUNITY LEADERBOARD (render the top scores from that `entries` data, or "
    "from `CPoint.getLeaderboard()` — ALWAYS from this server data, NEVER a local-only list, so scores persist "
    "across sessions and players), a Play again button that restarts IN-GAME (never reload the page), and optionally "
    "a star rating via `CPoint.rate(1..5)` / `CPoint.getResults()`. Always feature-detect and degrade to a local "
    "end screen + in-memory scores when CPoint is absent. "
    "TO SAVE per-player progress/state/preferences (game saves, settings, 'continue where I left off'), use "
    "`CPoint.save(key, value)` (value = any JSON) and `CPoint.load(key)` -> `{value}`. CRITICAL: localStorage, "
    "sessionStorage and cookies are BLOCKED in this sandbox and will NOT persist — NEVER use them to save; always use "
    "CPoint.save/load. PERSISTENCE PATTERN: on boot, if `window.CPoint?.load` exists, "
    "`const r = await CPoint.load('slot-1'); if (r && r.value) restore(r.value);` (degrade to fresh in-memory state if "
    "CPoint is missing or there is no saved value). On each checkpoint / level-up / settings change, "
    "`await CPoint.save('slot-1', state);`. Use short, stable keys — valid examples: `slot-1`, `slot-2`, `settings` "
    "(letters, digits, `-`, `_`; one key per save slot, max ~20 slots). Wrap save/load in try/catch and never block gameplay on them. "
    "FOR REAL PHOTOS from the web (places, food, recommendations, etc.), call `CPoint.images(query)` -> "
    "`{images:[{url, full, title}]}` and set an `<img>` src to `url` (display-ready, real freely-licensed photos). "
    "Fetch at RUNTIME; show a graceful placeholder while loading and if none return; NEVER hard-code image URLs from "
    "memory (they 404). Always feature-detect (`if (window.CPoint)`), never block gameplay on it, and wrap calls in try/catch. "
    "REAL-TIME / RECENT PUBLIC DATA: if the user's idea needs public facts, weather, fixtures/results, recipes, cocktails, "
    "Pokemon, jokes, facts, advice, tech news, or Wikipedia, use `CPoint.data(connector, params)` only after feature-detecting "
    "`if (window.CPoint?.data)`. Available connectors and common params: `weather` {place} or {lat,lon}; `country` {name|code}; "
    "`wikipedia` {search|title}; `recipe` {search} or {random:true}; `cocktail` {search} or {random:true}; `pokemon` {name|id}; "
    "`joke` {category}; `fact` {random:true}; `advice` {search} or {}; `technews` {feed:'top'|'new'|'best',limit}; "
    "`sports` {day:'YYYY-MM-DD',sport:'Soccer'} or {leagueId,mode:'next'|'past'} or {teamId,mode:'next'|'past'}. "
    "This data is RECENT and cached, not millisecond-live; for sports, build fixtures/results apps such as yesterday's scores "
    "or tomorrow's games, not live minute-by-minute scoreboards. Always render useful fallback content first, update when data "
    "arrives, wrap in try/catch, and display the returned `attribution` string visibly near the data. Random connectors return "
    "a batch in `data.items`; pick one client-side so many players can share one cached fetch. "
    "TWO-PLAYER TURN-BASED MULTIPLAYER (chess, checkers, connect-4, tic-tac-toe, battleship, dominoes, card games): when "
    "the user wants two people to play EACH OTHER, feature-detect `if (window.CPoint?.hasMultiplayer)` and use the "
    "`CPoint.match.*` Promises. YOU build ALL the UI and game rules; the server only stores the shared game state, enforces "
    "whose turn it is, and notifies the opponent. FLOW: (1) LOBBY on boot — `const {matches} = await CPoint.match.list()` "
    "lists the player's games (each `{id,status,your_turn,opponent,winner}`); show 'your turn' games first + a 'New game' "
    "button, and any pending invites to accept. (2) CHALLENGE — `const {opponents} = await CPoint.match.opponents()` returns "
    "`[{handle,name}]` community members; let the user pick one, then `await CPoint.match.create(handle)` (status 'pending' "
    "until they accept; the opponent is notified). (3) An invited player calls `CPoint.match.accept(id)` or `decline(id)`. "
    "(4) PLAY — `const m = await CPoint.match.get(id)` -> `{your_seat,your_turn,opponent,status,state,version,winner}`; render "
    "the board from `m.state` (state is NULL on a brand-new game — draw the starting position). On the user's move, compute the "
    "NEW full game state and `await CPoint.match.move(id,{move, state:newState, version:m.version, result})` — omit `result` "
    "for a normal move, or pass 'win'|'lose'|'draw' (from YOUR perspective) to end the game. ALWAYS send the `version` you read; "
    "if move rejects with 'not_your_turn' or 'stale_version', re-`get(id)` and re-render (the opponent already moved). (5) LIVE "
    "SYNC — while it's the OPPONENT's turn and the board is open, poll `await CPoint.match.poll(id, lastSeq)` -> "
    "`{moves,your_turn,status,winner}` every ~2.5s and apply new moves (clear the interval when you leave the board or it becomes "
    "your turn). Opponents also get a push notification, so async play works across days. `CPoint.match.resign(id)` forfeits. Keep "
    "`state` compact. DEGRADE: if `hasMultiplayer` is false, offer local hot-seat (both players, one device)."
)

# The authored guide is the source of truth; the inline string above is the fallback.
_SYSTEM_PROMPT = _load_build_guide() or _SYSTEM_PROMPT_FALLBACK
logger.info("builder: codegen prompt = %s (%d chars)",
            "builder_guide.md" if _SYSTEM_PROMPT is not _SYSTEM_PROMPT_FALLBACK else "INLINE FALLBACK",
            len(_SYSTEM_PROMPT))


def _extract_caps(text: str) -> str:
    """Pull the shared CAPABILITIES block (between the CAPS markers) out of the
    guide so chat and codegen describe what Steve can do from ONE source. Returns
    '' when the markers are absent (e.g. the inline fallback has none)."""
    a, b = text.find("<!-- CAPS:START -->"), text.find("<!-- CAPS:END -->")
    if a == -1 or b == -1 or b < a:
        return ""
    return text[a + len("<!-- CAPS:START -->"):b].strip()


# Concise capabilities summary used in chat if the guide/markers can't be read.
_CAPS_FALLBACK = (
    "Your creations run as ONE offline, sandboxed front-end file; identity is the user's C-Point session (no login of "
    "their own). They CAN: show real web photos; pull recent public data (weather, country, Wikipedia, recipes, "
    "cocktails, jokes, facts, advice, tech news, sports fixtures/results); bake in REAL facts you research from the web "
    "AT BUILD TIME (so never say you 'can't fetch from the web'); save per-player state; track community scores, "
    "leaderboards and ratings; and host invite-a-friend TWO-PLAYER turn-based multiplayer (live + async, persisted, with "
    "notifications). They CANNOT: have their own accounts/login, call arbitrary external APIs at runtime, take payments, "
    "send email/SMS, use native phone features, or do simultaneous real-time action (multiplayer is turn-based)."
)

_CAPS_BLOCK = _extract_caps(_SYSTEM_PROMPT) or _CAPS_FALLBACK

_CREATION_COLS = [
    "id", "community_id", "created_by", "title", "kind", "html_content",
    "prompt_history", "parent_creation_id", "status", "published_post_id",
    "created_at", "updated_at", "html_r2_key", "public_slug",
    "public_status", "public_html_r2_key", "public_published_at",
    "public_unpublished_at", "public_kind", "gallery_status",
    "gallery_requested_at", "gallery_reviewed_at", "gallery_reviewed_by",
    "gallery_rejection_reason",
]

_JOB_COLS = [
    "id", "username", "community_id", "creation_id", "kind", "prompt", "tier",
    "status", "result_creation_id", "error", "attempts", "max_attempts",
    "worker_token", "lease_expires_at", "notified_at", "created_at",
    "updated_at", "started_at", "finished_at",
]


def ensure_tables(cursor: Optional[Any] = None) -> None:
    """Create the ``creations`` table and add ``posts.creation_id``. Idempotent."""
    owns_connection = cursor is None
    conn = None
    if cursor is None:
        conn = get_db_connection()
        cursor = conn.cursor()
    try:
        if USE_MYSQL:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS creations (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    community_id INT NULL,
                    created_by VARCHAR(191) NOT NULL,
                    title VARCHAR(200) NOT NULL DEFAULT 'Untitled',
                    kind VARCHAR(32) NOT NULL DEFAULT 'web',
                    html_content MEDIUMTEXT NOT NULL,
                    prompt_history MEDIUMTEXT,
                    parent_creation_id INT,
                    status VARCHAR(16) NOT NULL DEFAULT 'draft',
                    published_post_id INT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    INDEX idx_creations_community (community_id, status),
                    INDEX idx_creations_owner (created_by),
                    INDEX idx_creations_parent (parent_creation_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
                """
            )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS creations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    community_id INTEGER,
                    created_by TEXT NOT NULL,
                    title TEXT NOT NULL DEFAULT 'Untitled',
                    kind TEXT NOT NULL DEFAULT 'web',
                    html_content TEXT NOT NULL,
                    prompt_history TEXT,
                    parent_creation_id INTEGER,
                    status TEXT NOT NULL DEFAULT 'draft',
                    published_post_id INTEGER,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            for stmt in (
                "CREATE INDEX IF NOT EXISTS idx_creations_community ON creations (community_id, status)",
                "CREATE INDEX IF NOT EXISTS idx_creations_owner ON creations (created_by)",
                "CREATE INDEX IF NOT EXISTS idx_creations_parent ON creations (parent_creation_id)",
            ):
                try:
                    cursor.execute(stmt)
                except Exception:
                    pass
        # Migration-light: link a post back to the creation it published.
        try:
            cursor.execute("ALTER TABLE posts ADD COLUMN creation_id INTEGER")
        except Exception:
            pass
        # Migration-light: total play count surfaced on the feed card.
        try:
            cursor.execute("ALTER TABLE creations ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0")
        except Exception:
            pass
        # Migration-light: private R2 object key for artifact HTML. html_content
        # remains as a legacy fallback when R2 is disabled or unavailable.
        try:
            cursor.execute("ALTER TABLE creations ADD COLUMN html_r2_key " + ("VARCHAR(512)" if USE_MYSQL else "TEXT"))
        except Exception:
            pass
        # Migration-light: the full design conversation so the user can return to it.
        try:
            cursor.execute("ALTER TABLE creations ADD COLUMN chat_history " + ("MEDIUMTEXT" if USE_MYSQL else "TEXT"))
        except Exception:
            pass
        if USE_MYSQL:
            for stmt in (
                "ALTER TABLE creations MODIFY community_id INT NULL",
                "ALTER TABLE builder_jobs MODIFY community_id INT NULL",
            ):
                try:
                    cursor.execute(stmt)
                except Exception:
                    pass
        # Public web publishing metadata. Existing community publishing remains
        # separate: these fields describe the externally shareable build copy.
        for column, ddl in (
            ("public_slug", "VARCHAR(96)" if USE_MYSQL else "TEXT"),
            ("public_status", "VARCHAR(16)" if USE_MYSQL else "TEXT"),
            ("public_html_r2_key", "VARCHAR(512)" if USE_MYSQL else "TEXT"),
            ("public_published_at", "DATETIME" if USE_MYSQL else "TEXT"),
            ("public_unpublished_at", "DATETIME" if USE_MYSQL else "TEXT"),
            ("public_kind", "VARCHAR(16)" if USE_MYSQL else "TEXT"),
            ("gallery_status", "VARCHAR(16) NOT NULL DEFAULT 'not_listed'" if USE_MYSQL else "TEXT DEFAULT 'not_listed'"),
            ("gallery_requested_at", "DATETIME" if USE_MYSQL else "TEXT"),
            ("gallery_reviewed_at", "DATETIME" if USE_MYSQL else "TEXT"),
            ("gallery_reviewed_by", "VARCHAR(191)" if USE_MYSQL else "TEXT"),
            ("gallery_rejection_reason", "VARCHAR(255)" if USE_MYSQL else "TEXT"),
        ):
            try:
                cursor.execute(f"ALTER TABLE creations ADD COLUMN {column} {ddl}")
            except Exception:
                pass
        for stmt in (
            "CREATE INDEX idx_creations_public_slug ON creations (public_slug)",
            "CREATE INDEX idx_creations_public_status ON creations (public_status)",
            "CREATE INDEX idx_creations_gallery_status ON creations (gallery_status, gallery_reviewed_at, updated_at)",
        ):
            try:
                cursor.execute(stmt if USE_MYSQL else stmt.replace("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS "))
            except Exception:
                pass
        # Community-scoped interaction data (scores, ratings). One row per user
        # per (creation, namespace, key) — UNIQUE makes "one score/rating per
        # user" a DB invariant (upsert). The artifact never writes here directly;
        # the session-authed host brokers every write (see blueprints/builder.py).
        if USE_MYSQL:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS creation_data (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    creation_id INT NOT NULL,
                    community_id INT NOT NULL,
                    namespace VARCHAR(16) NOT NULL,
                    data_key VARCHAR(64) NOT NULL DEFAULT '',
                    username VARCHAR(191) NOT NULL,
                    display_name VARCHAR(64),
                    num_value DOUBLE,
                    data_value MEDIUMTEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    UNIQUE KEY uq_creation_data (creation_id, community_id, namespace, data_key, username),
                    INDEX idx_creation_data_board (creation_id, community_id, namespace, num_value),
                    INDEX idx_creation_data_community (community_id, namespace)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
                """
            )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS creation_data (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    creation_id INTEGER NOT NULL,
                    community_id INTEGER NOT NULL,
                    namespace TEXT NOT NULL,
                    data_key TEXT NOT NULL DEFAULT '',
                    username TEXT NOT NULL,
                    display_name TEXT,
                    num_value REAL,
                    data_value TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE (creation_id, community_id, namespace, data_key, username)
                )
                """
            )
            for stmt in (
                "CREATE INDEX IF NOT EXISTS idx_creation_data_board ON creation_data (creation_id, community_id, namespace, num_value)",
                "CREATE INDEX IF NOT EXISTS idx_creation_data_community ON creation_data (community_id, namespace)",
            ):
                try:
                    cursor.execute(stmt)
                except Exception:
                    pass
        if USE_MYSQL:
            for stmt in (
                "ALTER TABLE creation_data DROP INDEX uq_creation_data",
                "ALTER TABLE creation_data ADD UNIQUE KEY uq_creation_data (creation_id, community_id, namespace, data_key, username)",
                "CREATE INDEX idx_creation_data_board_scoped ON creation_data (creation_id, community_id, namespace, num_value)",
            ):
                try:
                    cursor.execute(stmt)
                except Exception:
                    pass
        # Migration-light: per-player save slot (game saves / preferences). The
        # sandbox blocks localStorage, so saving is host-brokered into this column.
        try:
            cursor.execute("ALTER TABLE creation_data ADD COLUMN data_value " + ("MEDIUMTEXT" if USE_MYSQL else "TEXT"))
        except Exception:
            pass
        # Two-player turn-based MATCH state — game-agnostic shared state between the
        # two seats of a creation. The build supplies ALL rules + UI; the server only
        # stores the shared state blob + a move log and enforces seat, turn order,
        # and optimistic concurrency (version). See backend/services/creation_match.py.
        if USE_MYSQL:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS creation_matches (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    creation_id INT NOT NULL,
                    community_id INT NOT NULL,
                    seat1_username VARCHAR(191) NOT NULL,
                    seat2_username VARCHAR(191) NOT NULL,
                    status VARCHAR(16) NOT NULL DEFAULT 'pending',
                    turn_seat TINYINT NULL,
                    state_json MEDIUMTEXT NULL,
                    version INT NOT NULL DEFAULT 0,
                    last_seq INT NOT NULL DEFAULT 0,
                    winner_seat TINYINT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    last_move_at DATETIME NULL,
                    INDEX idx_matches_seat1 (creation_id, seat1_username, status),
                    INDEX idx_matches_seat2 (creation_id, seat2_username, status),
                    INDEX idx_matches_status (status)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
                """
            )
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS creation_match_moves (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    match_id INT NOT NULL,
                    seq INT NOT NULL,
                    by_seat TINYINT NOT NULL,
                    move_json MEDIUMTEXT NULL,
                    created_at DATETIME NOT NULL,
                    UNIQUE KEY uq_match_move (match_id, seq),
                    INDEX idx_match_moves (match_id, seq)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
                """
            )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS creation_matches (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    creation_id INTEGER NOT NULL,
                    community_id INTEGER NOT NULL,
                    seat1_username TEXT NOT NULL,
                    seat2_username TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    turn_seat INTEGER NULL,
                    state_json TEXT NULL,
                    version INTEGER NOT NULL DEFAULT 0,
                    last_seq INTEGER NOT NULL DEFAULT 0,
                    winner_seat INTEGER NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_move_at TEXT NULL
                )
                """
            )
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS creation_match_moves (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    match_id INTEGER NOT NULL,
                    seq INTEGER NOT NULL,
                    by_seat INTEGER NOT NULL,
                    move_json TEXT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE (match_id, seq)
                )
                """
            )
            for stmt in (
                "CREATE INDEX IF NOT EXISTS idx_matches_seat1 ON creation_matches (creation_id, seat1_username, status)",
                "CREATE INDEX IF NOT EXISTS idx_matches_seat2 ON creation_matches (creation_id, seat2_username, status)",
                "CREATE INDEX IF NOT EXISTS idx_matches_status ON creation_matches (status)",
                "CREATE INDEX IF NOT EXISTS idx_match_moves ON creation_match_moves (match_id, seq)",
            ):
                try:
                    cursor.execute(stmt)
                except Exception:
                    pass
        if USE_MYSQL:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS builder_jobs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(191) NOT NULL,
                    community_id INT NULL,
                    creation_id INT NULL,
                    kind VARCHAR(16) NOT NULL,
                    prompt MEDIUMTEXT NOT NULL,
                    tier VARCHAR(16) NOT NULL DEFAULT 'balanced',
                    status VARCHAR(16) NOT NULL DEFAULT 'queued',
                    result_creation_id INT NULL,
                    error VARCHAR(255) NULL,
                    attempts INT NOT NULL DEFAULT 0,
                    max_attempts INT NOT NULL DEFAULT 3,
                    worker_token VARCHAR(64) NULL,
                    lease_expires_at DATETIME NULL,
                    notified_at DATETIME NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    started_at DATETIME NULL,
                    finished_at DATETIME NULL,
                    INDEX idx_builder_jobs_user_status (username, status, created_at),
                    INDEX idx_builder_jobs_status (status, created_at),
                    INDEX idx_builder_jobs_creation (creation_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
                """
            )
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS creation_shares (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    creation_id INT NOT NULL,
                    community_id INT NOT NULL,
                    post_id INT NOT NULL,
                    shared_by VARCHAR(191) NOT NULL,
                    created_at DATETIME NOT NULL,
                    UNIQUE KEY uq_creation_share (creation_id, community_id),
                    INDEX idx_creation_shares_community (community_id, created_at),
                    INDEX idx_creation_shares_creation (creation_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
                """
            )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS builder_jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    community_id INTEGER,
                    creation_id INTEGER NULL,
                    kind TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    tier TEXT NOT NULL DEFAULT 'balanced',
                    status TEXT NOT NULL DEFAULT 'queued',
                    result_creation_id INTEGER NULL,
                    error TEXT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    max_attempts INTEGER NOT NULL DEFAULT 3,
                    worker_token TEXT NULL,
                    lease_expires_at TEXT NULL,
                    notified_at TEXT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT NULL,
                    finished_at TEXT NULL
                )
                """
            )
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS creation_shares (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    creation_id INTEGER NOT NULL,
                    community_id INTEGER NOT NULL,
                    post_id INTEGER NOT NULL,
                    shared_by TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE (creation_id, community_id)
                )
                """
            )
            for stmt in (
                "CREATE INDEX IF NOT EXISTS idx_builder_jobs_user_status ON builder_jobs (username, status, created_at)",
                "CREATE INDEX IF NOT EXISTS idx_builder_jobs_status ON builder_jobs (status, created_at)",
                "CREATE INDEX IF NOT EXISTS idx_builder_jobs_creation ON builder_jobs (creation_id)",
                "CREATE INDEX IF NOT EXISTS idx_creation_shares_community ON creation_shares (community_id, created_at)",
                "CREATE INDEX IF NOT EXISTS idx_creation_shares_creation ON creation_shares (creation_id)",
            ):
                try:
                    cursor.execute(stmt)
                except Exception:
                    pass
        # Migration-light: reliability columns for the atomic-claim + lease +
        # idempotent-notify model. Existing builder_jobs tables predate these.
        _int = "INT" if USE_MYSQL else "INTEGER"
        _dt = "DATETIME" if USE_MYSQL else "TEXT"
        _txt = "VARCHAR(64)" if USE_MYSQL else "TEXT"
        for stmt in (
            f"ALTER TABLE builder_jobs ADD COLUMN max_attempts {_int} NOT NULL DEFAULT 3",
            f"ALTER TABLE builder_jobs ADD COLUMN worker_token {_txt} NULL",
            f"ALTER TABLE builder_jobs ADD COLUMN lease_expires_at {_dt} NULL",
            f"ALTER TABLE builder_jobs ADD COLUMN notified_at {_dt} NULL",
        ):
            try:
                cursor.execute(stmt)
            except Exception:
                pass
        if owns_connection and conn is not None:
            conn.commit()
    finally:
        if owns_connection and conn is not None:
            conn.close()


def _now() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def _clean_html(raw: str) -> str:
    """Strip any stray markdown fence Grok may wrap the document in."""
    text = (raw or "").strip()
    if text.startswith("```"):
        match = re.search(r"```(?:html)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
        if match:
            text = match.group(1).strip()
    return text


def _derive_title(prompt: str) -> str:
    words = re.sub(r"\s+", " ", (prompt or "").strip()).split(" ")
    if not words or not words[0]:
        return "Creation"
    title = " ".join(words[:6]).strip(" .,!?-")
    return (title[:1].upper() + title[1:])[:200] or "Creation"


_GENERIC_TITLES = {"document", "untitled", "title", "creation", "index", "page", "home", "html", "app"}


def _extract_title(html: str, prompt: str) -> str:
    """Prefer a meaningful name from the artifact itself — the model is told to
    set a descriptive <title> — falling back to the artifact's <h1>, then to a
    prompt-derived title (last resort, the old behaviour)."""
    for pattern in (r"<title[^>]*>([\s\S]*?)</title>", r"<h1[^>]*>([\s\S]*?)</h1>"):
        m = re.search(pattern, html or "", re.IGNORECASE)
        if not m:
            continue
        cand = re.sub(r"<[^>]+>", " ", m.group(1))  # strip any nested markup
        cand = re.sub(r"\s+", " ", cand).strip(" .,!?-—|·")
        if cand and len(cand) >= 2 and cand.lower() not in _GENERIC_TITLES:
            return cand[:200]
    return _derive_title(prompt)


def _row_to_dict(row: Any) -> Dict[str, Any]:
    if hasattr(row, "keys"):
        return {k: row[k] for k in row.keys()}
    return {col: row[i] for i, col in enumerate(_CREATION_COLS)}


def artifact_r2_key(creation_id: int, updated_at: Optional[str] = None) -> str:
    stamp = re.sub(r"[^0-9A-Za-z]+", "-", updated_at or _now()).strip("-") or uuid.uuid4().hex
    return f"private/creations/{int(creation_id)}/{stamp}.html"


def _artifact_cache_key(creation_id: int, updated_at: Optional[str]) -> str:
    return f"cpbuild:html:{creation_id}:{updated_at or 'unknown'}"


def _cache_artifact_html(creation_id: int, updated_at: Optional[str], html: str) -> None:
    if not html or len(html.encode("utf-8", errors="ignore")) > MAX_HTML_BYTES:
        return
    try:
        from redis_cache import cache
        cache.set(_artifact_cache_key(creation_id, updated_at), html, ttl=300)
    except Exception:
        pass


def _cached_artifact_html(creation_id: int, updated_at: Optional[str]) -> Optional[str]:
    try:
        from redis_cache import cache
        hit = cache.get(_artifact_cache_key(creation_id, updated_at))
        return hit if isinstance(hit, str) else None
    except Exception:
        return None


def _delete_cached_artifact_html(creation_id: int, updated_at: Optional[str]) -> None:
    try:
        from redis_cache import cache
        cache.delete(_artifact_cache_key(creation_id, updated_at))
    except Exception:
        pass


def store_artifact_html(creation_id: int, html: str, *, updated_at: Optional[str] = None) -> Optional[str]:
    """Upload artifact HTML to private R2. Returns the object key on success."""
    try:
        from backend.services.r2_storage import upload_private_bytes_to_r2
        key = artifact_r2_key(creation_id, updated_at)
        ok = upload_private_bytes_to_r2(html.encode("utf-8"), key, content_type="text/html; charset=utf-8")
        if ok:
            _cache_artifact_html(creation_id, updated_at, html)
            return key
    except Exception:
        logger.warning("builder: R2 artifact upload failed for creation %s", creation_id, exc_info=True)
    return None


def load_artifact_html(creation_id: int, html_r2_key: Optional[str], *,
                       updated_at: Optional[str] = None) -> Optional[str]:
    if not html_r2_key:
        return None
    cached = _cached_artifact_html(creation_id, updated_at)
    if cached is not None:
        return cached
    try:
        from backend.services.r2_storage import download_bytes_from_r2
        raw = download_bytes_from_r2(str(html_r2_key))
        if raw is None:
            return None
        html = raw.decode("utf-8", errors="replace")
        _cache_artifact_html(creation_id, updated_at, html)
        return html
    except Exception:
        logger.warning("builder: R2 artifact download failed for creation %s", creation_id, exc_info=True)
        return None


def delete_artifact_html(html_r2_key: Optional[str], *, creation_id: Optional[int] = None,
                         updated_at: Optional[str] = None) -> None:
    if creation_id is not None:
        _delete_cached_artifact_html(int(creation_id), updated_at)
    if not html_r2_key:
        return
    try:
        from backend.services.r2_storage import delete_from_r2
        delete_from_r2(str(html_r2_key))
    except Exception:
        logger.debug("builder: R2 artifact delete skipped for key %s", html_r2_key, exc_info=True)


def _slugify_public_title(title: Any, creation_id: int) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", str(title or "build").lower()).strip("-")
    base = re.sub(r"-{2,}", "-", base)[:64].strip("-") or "build"
    return f"{base}-{int(creation_id)}"


def public_build_url(slug: str) -> str:
    return f"{PUBLIC_BUILDS_BASE_URL}/{str(slug).strip('/')}"


def public_artifact_r2_key(slug: str, version: Optional[str] = None) -> str:
    stamp = re.sub(r"[^0-9A-Za-z]+", "-", version or _now()).strip("-") or uuid.uuid4().hex
    return f"public/builds/{slug}/{stamp}.html"


def public_manifest_r2_key(slug: str) -> str:
    return f"public/builds/{slug}/manifest.json"


def _public_kind(kind: Any) -> str:
    k = str(kind or "web").strip().lower()
    if k in {"web", "website", "site", "landing"}:
        return "website"
    if k in {"app", "tool", "application", "quiz", "dashboard", "tracker"}:
        return "app"
    if k in _GAME_BUILD_KINDS:
        return "game"
    return k or "website"


def public_publish_eligible(kind: Any) -> bool:
    return _public_kind(kind) in {"website", "app"}


def infer_creation_kind(prompt: Any, title: Any = None) -> str:
    text = f"{prompt or ''} {title or ''}".lower()
    if any(hint in text for hint in _GAME_KIND_HINTS):
        return "game"
    if any(hint in text for hint in _APP_KIND_HINTS):
        return "app"
    if any(hint in text for hint in _WEBSITE_KIND_HINTS):
        return "website"
    return "website"


def public_bridge_and_branding_script(*, slug: str, title: str) -> str:
    safe_slug = json.dumps(str(slug))
    safe_title = json.dumps(str(title or "C-Point build"))
    api_base = json.dumps(PUBLIC_BUILDS_API_BASE)
    logo_url = json.dumps(PUBLIC_BRAND_LOGO_URL)
    return f"""<script>
(function(){{
  var slug={safe_slug}, title={safe_title}, apiBase={api_base}, logoUrl={logo_url};
  var root=document.documentElement;
  root.setAttribute('data-cpoint-public-build','true');
  window.CPoint=Object.assign({{}}, window.CPoint||{{}}, {{
    isPublicBuild:true,
    publicSlug:slug,
    publicTitle:title,
    hasPersistence:false,
    hasCreationData:false,
    hasMultiplayer:false,
    hasMatchController:false,
    hasTurnBasedGame:false,
    hasData:true,
    images:function(query, opts){{
      var qs=new URLSearchParams();
      qs.set('q', query||'');
      qs.set('slug', slug);
      qs.set('limit', String((opts&&opts.limit)||8));
      var endpoint=apiBase
        ? apiBase + '/api/builder/public/' + encodeURIComponent(slug) + '/data/images?' + qs.toString()
        : '/api/data/images?' + qs.toString();
      return fetch(endpoint, {{
        credentials:'omit',
        headers:{{'Accept':'application/json'}}
      }}).then(function(r){{return r.json().then(function(j){{if(!r.ok||!j.success) throw new Error((j&&j.error)||'images_error'); return j;}});}});
    }},
    data:function(connector, params, opts){{
      var qs=new URLSearchParams();
      qs.set('connector', connector||'');
      qs.set('params', JSON.stringify(params||{{}}));
      qs.set('slug', slug);
      if(opts&&opts.refresh) qs.set('refresh','1');
      var endpoint=apiBase
        ? apiBase + '/api/builder/public/' + encodeURIComponent(slug) + '/data/feed?' + qs.toString()
        : '/api/data/feed?' + qs.toString();
      return fetch(endpoint, {{
        credentials:'omit',
        headers:{{'Accept':'application/json'}}
      }}).then(function(r){{return r.json().then(function(j){{if(!r.ok||!j.success) throw new Error((j&&j.error)||'data_error'); return j;}});}});
    }},
    save:function(){{return Promise.reject(new Error('public_build_no_private_persistence'));}},
    load:function(){{return Promise.resolve({{value:null, publicBuild:true}});}},
    submitScore:function(){{return Promise.reject(new Error('public_build_no_scores'));}},
    getLeaderboard:function(){{return Promise.resolve({{scores:[], publicBuild:true}});}},
    match:null
  }});
  function mountBrand(){{
    if(document.getElementById('cpoint-public-brand')) return;
    var splash=document.createElement('div');
    splash.id='cpoint-public-splash';
    splash.innerHTML='<div class="cp-logo"><img src="'+logoUrl+'" alt="C-Point" /></div><div class="cp-copy">Built with C-Point</div>';
    var badge=document.createElement('a');
    badge.id='cpoint-public-brand';
    badge.href='https://www.c-point.co';
    badge.target='_blank';
    badge.rel='noopener noreferrer';
    badge.setAttribute('aria-label','Built with C-Point');
    badge.innerHTML='<span class="cp-dot"><img src="'+logoUrl+'" alt="" /></span><span>Built with C-Point</span>';
    badge.addEventListener('click',function(e){{
      e.preventDefault();
      e.stopPropagation();
      try{{
        var opened=window.open('https://www.c-point.co','_blank','noopener,noreferrer');
        if(!opened) window.location.href='https://www.c-point.co';
      }}catch(_){{ window.location.href='https://www.c-point.co'; }}
    }});
    document.body.appendChild(splash);
    document.body.appendChild(badge);
    window.setTimeout(function(){{ splash.className='cp-hide'; }}, 900);
    window.setTimeout(function(){{ if(splash&&splash.parentNode) splash.parentNode.removeChild(splash); }}, 1600);
  }}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mountBrand,{{once:true}});
  else mountBrand();
}})();
</script>"""


def public_branding_style() -> str:
    return """<style>
#cpoint-public-splash{position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#000;color:#f6ffff;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;transition:opacity .45s ease,visibility .45s ease}
#cpoint-public-splash.cp-hide{opacity:0;visibility:hidden}
#cpoint-public-splash .cp-logo{width:64px;height:64px;border-radius:22px;display:flex;align-items:center;justify-content:center;background:#061817;box-shadow:0 20px 60px rgba(0,206,200,.25);overflow:hidden}
#cpoint-public-splash .cp-logo img{width:100%;height:100%;object-fit:contain;display:block}
#cpoint-public-splash .cp-copy{font-size:14px;letter-spacing:.02em;color:rgba(246,255,255,.82)}
#cpoint-public-brand{position:fixed;right:max(8px,env(safe-area-inset-right));top:50%;transform:translateY(-50%);z-index:2147483645;display:inline-flex;align-items:center;gap:7px;padding:8px 10px;border-radius:999px;background:rgba(0,0,0,.68);color:#efffff;text-decoration:none;font:600 12px/1 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.28);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.14)}
#cpoint-public-brand .cp-dot{width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;background:#061817}
#cpoint-public-brand .cp-dot img{width:100%;height:100%;object-fit:contain;display:block}
@media(max-width:520px){#cpoint-public-brand{right:max(6px,env(safe-area-inset-right));top:50%;bottom:auto;transform:translateY(-50%);font-size:11px;padding:7px 9px;opacity:.86}}
</style>"""


def prepare_public_creation_html(html: str, *, slug: str, title: str) -> str:
    """Inject public-only CPoint bridge plus mandatory C-Point branding."""
    injection = public_branding_style() + public_bridge_and_branding_script(slug=slug, title=title)
    if re.search(r"<head[^>]*>", html or "", re.I):
        return re.sub(r"<head[^>]*>", lambda m: m.group(0) + injection, html, count=1, flags=re.I)
    if re.search(r"<html[^>]*>", html or "", re.I):
        return re.sub(r"<html[^>]*>", lambda m: m.group(0) + "<head>" + injection + "</head>", html, count=1, flags=re.I)
    return "<!doctype html><html><head>" + injection + "</head><body>" + (html or "") + "</body></html>"


def _public_manifest(*, creation_id: int, slug: str, title: str, artifact_key: str,
                     kind: str, published_at: str) -> Dict[str, Any]:
    return {
        "schema": 1,
        "status": "published",
        "creationId": int(creation_id),
        "slug": slug,
        "title": title,
        "kind": kind,
        "artifactKey": artifact_key,
        "publishedAt": published_at,
    }


def _upload_public_json(key: str, payload: Dict[str, Any]) -> bool:
    try:
        from backend.services.r2_storage import upload_public_bytes_to_r2
        raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        return upload_public_bytes_to_r2(
            raw, key, content_type="application/json; charset=utf-8",
            cache_control="public, max-age=30",
        )
    except Exception:
        logger.warning("builder: public manifest upload failed for key %s", key, exc_info=True)
        return False


def _upload_public_html(key: str, html: str) -> bool:
    try:
        from backend.services.r2_storage import upload_public_bytes_to_r2
        return upload_public_bytes_to_r2(
            html.encode("utf-8"), key, content_type="text/html; charset=utf-8",
            cache_control="public, max-age=300",
        )
    except Exception:
        logger.warning("builder: public artifact upload failed for key %s", key, exc_info=True)
        return False


def _job_row_to_dict(row: Any) -> Dict[str, Any]:
    if hasattr(row, "keys"):
        return {k: row[k] for k in row.keys()}
    return {col: row[i] for i, col in enumerate(_JOB_COLS)}


def _append_history(prior_json: Optional[str], message: str) -> str:
    try:
        history = json.loads(prior_json) if prior_json else []
        if not isinstance(history, list):
            history = []
    except Exception:
        history = []
    history.append({"role": "user", "content": message})
    return json.dumps(history[-40:])


_PLAN_SYSTEM = (
    "You are Steve, a friendly maker. In ONE or TWO short first-person sentences, tell the user what you're "
    "about to make (or change) for them — concrete and a little playful. Name the key things you'll include "
    "(controls, sound, a score or leaderboard, the look/vibe). NO code, no preamble, no lists, no markdown — "
    "just the sentence(s)."
)


def plan_build(prompt: str, *, is_iteration: bool = False) -> str:
    """A quick, cheap 'here's what I'll do' line shown while the real build runs
    so Steve narrates his intent. Best-effort — returns '' on any failure so it
    never blocks or delays a build. Always uses the fast model (it's narration)."""
    try:
        intro = ("The user wants to change their current creation: " if is_iteration
                 else "The user asked you to make: ")
        text = llm.generate_text(
            _PLAN_SYSTEM, intro + (prompt or "").strip(),
            max_tokens=200, temperature=0.7, caps=None, model=_MODEL_FAST,
        )
        return re.sub(r"\s+", " ", (text or "").strip())[:400]
    except Exception:
        logger.warning("builder: plan_build failed", exc_info=True)
        return ""


_CONVERSE_BASE = (
    "You are Steve, a friendly, imaginative maker who builds small FRONT-END web creations (games, quizzes, "
    "generators, simple sites) WITH the user, through conversation. You are a creative collaborator, not an order-taker.\n"
    "In this chat you:\n"
    "- REASON about what the user actually wants.\n"
    "- CONTRIBUTE IDEAS: proactively offer 1-2 concrete, exciting suggestions or directions that make it better — never just repeat the request back.\n"
    "- Ask a clarifying question ONLY when something essential is genuinely unclear. Most people want to see something fast, so keep momentum and don't interrogate.\n"
    "- FORMAT FOR MOBILE: keep replies easy to scan. Use short paragraphs, blank lines between ideas, and bullets when "
    "listing features, options, or a build plan. Avoid long walls of text. Default to 2-4 short chunks unless the user "
    "explicitly asks for depth.\n"
    "- KNOW EXACTLY WHAT YOUR CREATIONS CAN AND CANNOT DO (your source of truth — affirm and offer what's supported, "
    "NEVER wrongly refuse it, and explain a real limit plainly with its honest reason). When you BUILD you research real "
    "facts from the web and bake them in, so 'use the real scorecard / actual menu / current prices / real photos / add a "
    "leaderboard / two people play chess / invite a friend / play live or async / save the game so we resume it' are all "
    "YES. Capabilities & limits:\n"
    + _CAPS_BLOCK + "\n"
    "If the user asks for something genuinely out of reach, say so kindly and offer the closest thing you CAN make.\n"
    "- NEVER FABRICATE DATA SOURCES, and DON'T UNDERSELL what you can do. If the current build's facts look approximate or "
    "uncited (e.g. pars from general knowledge), do NOT just offer to add a disclaimer note — offer to RESEARCH THE REAL "
    "VALUES FROM THE WEB AND REBUILD with them (you can — build-time research is real), citing the sources you find. If "
    "asked where data came from, look at the ACTUAL build (incl. any 'Sources' it shows) and answer truthfully: cite real "
    "links if present; if absent, say the values may be approximate and offer to rebuild with verified web data.\n"
)
_CONVERSE_AGENT = (
    "You are in AGENT mode: you can build. When you have enough to make a great first version, PROPOSE a concrete plan "
    "in plain language and ASK the user to confirm before you build — do not start building without a yes.\n"
    "IMPORTANT for existing creations: when the user explicitly asks you to fix, update, apply, implement, do it, "
    "fix all listed issues, or make the changes, DO NOT ask which direction to explore and DO NOT keep explaining. "
    "Return ready=true with a concise build brief covering exactly those requested fixes. Ask a question only if the "
    "request is impossible, contradictory, or missing information that would make the change unsafe.\n"
)
_CONVERSE_ASK = (
    "You are in ASK mode: you can ONLY discuss, advise, brainstorm, and explain — you CANNOT build or change anything "
    "right now. Never propose to build, never say you're building, and ALWAYS return ready=false with an empty brief. "
    "If the user wants you to actually make it, tell them to switch to Agent mode (the Mode setting) and you'll build it together.\n"
)
_CONVERSE_SIMPLE = (
    "The user is NON-TECHNICAL. Never use technical words or jargon (no 'API', 'function', 'code', 'deploy', "
    "'framework', 'database', etc.) and never show code. Talk warmly about what the creation will DO and FEEL like.\n"
)
_CONVERSE_TECH = (
    "The user is comfortable with technical detail — you may briefly discuss approach, libraries, and trade-offs when it helps.\n"
)
_CONVERSE_JSON = (
    "Reply with ONLY a JSON object, nothing else:\n"
    '{"reply": "<what you say to the user, in their register, formatted with short paragraphs and bullets where useful; if proposing, end with a clear yes/no confirmation question>", '
    '"ready": <true ONLY when you have proposed a concrete plan and are asking to start building; false while still discussing or ideating>, '
    '"brief": "<when ready=true: a concise but complete build brief, ideally under 3000 characters, capturing only the agreed requirements Steve needs to build from this alone; otherwise empty>"}'
)


def _converse_system(*, mode: str, agent_mode: bool, has_creation: bool) -> str:
    capability = _CONVERSE_AGENT if agent_mode else _CONVERSE_ASK
    register = _CONVERSE_TECH if mode == "technical" else _CONVERSE_SIMPLE
    ctx = (
        "The user already has a creation in progress and its FULL current code is provided below. "
        "READ IT and reason WITH it — inspect what is ACTUALLY there before you answer. Reference the real "
        "existing features and behaviour, and base every answer, assessment, and proposal on the real current "
        "state of the build, never on assumptions. If the user asks why something happens or what to change, "
        "look at the code first. When you propose a change (Agent mode), the brief should describe just the "
        "change to make to this existing build.\n"
        if has_creation else "")
    return _CONVERSE_BASE + capability + register + ctx + _CONVERSE_JSON


def _parse_converse(raw: str) -> Dict[str, Any]:
    text = (raw or "").strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if m:
        text = m.group(1).strip()
    s, e = text.find("{"), text.rfind("}")
    if s != -1 and e > s:
        try:
            obj = json.loads(text[s:e + 1])
            reply = str(obj.get("reply") or "").strip()
            brief = str(obj.get("brief") or "").strip()
            if reply:
                return {"reply": reply, "ready": bool(obj.get("ready")) and bool(brief), "brief": brief}
        except Exception:
            pass
    return {"reply": text or "Tell me a bit more about what you'd like to make.", "ready": False, "brief": ""}


def converse(history: List[Dict[str, str]], message: str, *, mode: str = "simple",
             agent_mode: bool = True, has_creation: bool = False,
             current_html: Optional[str] = None, tier: str = "balanced") -> Dict[str, Any]:
    """Steve's design conversation: reason, ideate, discuss honestly — WITH the
    actual current build in context (he reads the real code, not just the
    prompt). In Agent mode he may propose a concrete plan and ask the user to
    confirm before building; in Ask mode he can only discuss (never proposes).
    Returns {reply, ready, brief}. Reasons with the SELECTED tier's model
    (Polished/Showpiece actually reason; Quick stays snappy)."""
    lines = []
    for h in (history or [])[-20:]:
        t = (h.get("text") or "").strip()
        if not t:
            continue
        lines.append(f"{'User' if h.get('role') == 'user' else 'Steve'}: {t}")
    convo = "\n".join(lines)
    build_ctx = ""
    if current_html:
        build_ctx = (
            "CURRENT BUILD — this is the actual code of what exists right now. Read it and reason with it:\n"
            "<<<BUILD>>>\n" + current_html + "\n<<<END BUILD>>>\n\n")
    user = build_ctx + (f"Conversation so far:\n{convo}\n\n" if convo else "") + \
        f"User's latest message: {message}\n\nReply with ONLY the JSON object."
    try:
        raw = llm.generate_text(_converse_system(mode=mode, agent_mode=agent_mode, has_creation=has_creation), user,
                                max_tokens=4000, temperature=0.7, caps=None, model=resolve_model(tier))
    except Exception:
        logger.warning("builder: converse failed", exc_info=True)
        return {"reply": "I had a hiccup there — could you say that again?", "ready": False, "brief": ""}
    result = _parse_converse(raw)
    if not agent_mode:  # Ask mode can never trigger a build, whatever the model returned
        result["ready"] = False
        result["brief"] = ""
    return result


_RESEARCH_SYSTEM = (
    "You are a research assistant for an app a user is building. ACTUALLY SEARCH THE WEB to gather SPECIFIC, REAL, "
    "ACCURATE facts the app needs — real names and details of places, golf course pars/scorecards (hole by hole), menus, "
    "prices, opening hours, statistics, sports/team data, schedules, current events, reviews and recommendations — "
    "anything where guessing or relying on memory would make the app WRONG. Do NOT answer from memory; search, and "
    "include the source links you used. Reply as clear plain TEXT: the real facts (with EXACT values), then the sources. "
    "If — and only if — the app needs NO real-world data at all (a falling-blocks game, a generic personality quiz, a "
    "calculator), reply with EXACTLY the single word: NONE. When in doubt, search. Never invent facts or sources."
)


def _extract_source_urls(text: str) -> List[str]:
    """Pull cited http(s) source URLs out of research text (deduped, trimmed, capped)."""
    out: List[str] = []
    for u in re.findall(r"https?://[^\s)\]<>\"']+", text or ""):
        u = u.rstrip(".,);]'\"")
        if u and u not in out:
            out.append(u)
        if len(out) >= 12:
            break
    return out


def research_for_build(brief: str) -> Tuple[str, List[str]]:
    """Build-TIME web research: when a creation needs real, accurate facts (current
    OR static — e.g. golf pars), fetch them now via REAL web search and return the
    raw text (facts) plus the cited source URLs, to bake statically into the
    artifact. We use raw text, NOT JSON — the search model returns prose/citations,
    and JSON parsing was silently dropping every real result. Best-effort — returns
    ('', []) on failure or when no real-world data is needed, so it never blocks a
    build."""
    b = (brief or "").strip()
    if not b:
        return "", []
    try:
        text = llm.web_search_text(
            _RESEARCH_SYSTEM,
            f"The user is building this app:\n{b}\n\nResearch and report as instructed.",
            max_output_tokens=2600,
        )
    except Exception:
        logger.warning("builder: research_for_build failed", exc_info=True)
        return "", []
    t = (text or "").strip().strip("*").strip()  # drop a leading markdown-bold wrapper
    if not t or len(t) < 25 or t.upper().startswith("NONE"):
        return "", []
    facts = t[:9000]
    return facts, _extract_source_urls(facts)


def _domain_of(url: str) -> str:
    m = re.match(r"https?://(?:www\.)?([^/\s:]+)", url or "")
    return m.group(1).lower() if m else ""


_RESEARCH_TOKEN_RE = re.compile(
    r"[A-Z][a-zA-Z.'\-]{2,}(?:\s+[A-Z][a-zA-Z.'\-]{2,}){0,3}|\d[\d.,:%\-]{1,}"
)


def _distinctive_tokens(facts: str) -> List[str]:
    """Distinctive proper-noun phrases and numbers from the facts — a weak fallback
    grounding signal used only when no source URLs were captured."""
    out: List[str] = []
    for tok in _RESEARCH_TOKEN_RE.findall(facts or ""):
        tok = tok.strip()
        if len(tok) >= 3 and tok not in out:
            out.append(tok)
        if len(out) >= 10:
            break
    return out


def _research_landed(html: str, facts: str, sources: List[str]) -> bool:
    """Heuristic: did the researched facts actually get grounded into the artifact?
    Not a guarantee — a strong 'the model ignored the data' detector. Returns True
    (assume fine) when there are no facts to judge or no signal to check on."""
    if not facts:
        return True
    h = (html or "").lower()
    if not h:
        return False
    if sources:
        for url in sources:
            u = url.lower()
            if u and u in h:
                return True
            dom = _domain_of(u)
            if dom and dom in h:
                return True
        return False  # had sources to cite, cited none -> strong miss
    tokens = _distinctive_tokens(facts)
    if not tokens:
        return True
    hits = sum(1 for t in tokens if t.lower() in h)
    return hits >= max(1, len(tokens) // 3)


def generate_artifact(prompt: str, *, prior_html: Optional[str] = None, temperature: float = 0.8,
                     model: Optional[str] = None, verify: bool = False,
                     username: Optional[str] = None, community_id: Optional[int] = None) -> str:
    """Generate (or revise) a self-contained HTML artifact via Steve/Grok.

    ``caps`` is deliberately not passed to ``llm.generate_text`` — the small
    chat per-turn token ceilings would truncate the document. Builder cost is
    governed by the monthly turn cap, not per-turn tokens. First builds use a
    higher temperature for flair; iteration passes a low temperature to
    preserve what already works.
    """
    if prior_html:
        user_prompt = (
            "Here is the current HTML document for the creation:\n\n"
            f"{prior_html}\n\n"
            "Apply ONLY the following change and return the COMPLETE updated HTML document "
            "(the full file, not a diff). Preserve everything that already works — do not refactor, "
            f"rename, restyle, or remove existing features:\n{prompt}"
        )
    else:
        user_prompt = f"Build this as a single self-contained HTML document:\n{prompt}"

    # Build-time web research: if the creation needs current real-world info,
    # fetch it now and bake it in statically (the running app stays offline).
    facts, sources = research_for_build(prompt)
    if facts:
        user_prompt = (
            "REAL-WORLD DATA (fetched from the web just now via search — use these REAL facts EXACTLY; do NOT invent or "
            "use stale/remembered values; bake them statically into the HTML). Include a small, tasteful 'Sources' line "
            "or section in the app citing the source links so the data is verifiable:\n"
            f"{facts}\n\n"
        ) + user_prompt

    html = _clean_html(
        llm.generate_text(
            _SYSTEM_PROMPT,
            user_prompt,
            max_tokens=_CODEGEN_MAX_TOKENS,
            temperature=temperature,
            caps=None,
            model=model or _MODEL_FAST,
        )
    )
    if not html:
        raise ValueError("Steve returned an empty artifact")
    if len(html.encode("utf-8")) > MAX_HTML_BYTES:
        raise ValueError("Generated artifact exceeds size limit")

    # Verify the researched data actually landed; one targeted repair if not. The
    # model is only ASKED to use the facts — under a long prompt it can summarize,
    # approximate, or omit them, and success vs silent-failure look identical.
    if facts and not _research_landed(html, facts, sources):
        logger.info("builder: researched data not grounded in artifact; repairing once")
        try:
            repaired = _clean_html(
                llm.generate_text(
                    _SYSTEM_PROMPT,
                    (
                        "Here is the current HTML document for the creation:\n\n"
                        f"{html}\n\n"
                        "It OMITS required real-world data that MUST appear in the app. Integrate these EXACT "
                        "facts (do not invent or round them) and add a visible 'Sources' section that links the "
                        "source URLs below. Return the COMPLETE updated HTML document — preserve everything that "
                        "already works; change nothing else:\n"
                        f"{facts}\n\nSOURCE LINKS:\n" + "\n".join(sources)
                    ),
                    max_tokens=_CODEGEN_MAX_TOKENS,
                    temperature=0.2,
                    caps=None,
                    model=model or _MODEL_FAST,
                )
            )
        except Exception:
            logger.warning("builder: research repair pass failed; shipping original", exc_info=True)
            repaired = ""
        if (repaired and len(repaired.encode("utf-8")) <= MAX_HTML_BYTES
                and _research_landed(repaired, facts, sources)):
            html = repaired
        else:
            logger.warning("builder: research repair did not ground the data; shipping best effort")

    # Phase B render + vision-judge quality pass — async path only, best-effort.
    # Renders the artifact in real Chromium and applies up to a couple of targeted
    # repairs (render-fix, web-data verification, design-refine). No-ops when the
    # render service isn't configured, so sync/local/test paths are unaffected.
    if verify:
        html = _render_quality_pass(
            html, prompt=prompt, facts=facts, sources=sources,
            model=model or _MODEL_FAST, username=username, community_id=community_id,
        )
    return html


_DESIGN_REFINE_THRESHOLD = 70  # below "polished" on the judge's 0-100 craft scale

# The render/judge/repair pass runs on the SYNCHRONOUS build path, so it must be
# strictly time-bounded — a build that overruns Cloud Run's request timeout (600s)
# / job lease gets killed mid-flight and orphaned (the "endless loop" incident).
# We cap the whole pass to a wall-clock budget, allow AT MOST ONE repair regen,
# and give every upstream call a tight timeout. Worst realistic case:
# render(45) + judge(60) + one regen(150) + re-render(45) ~= 300s, well under 600s.
_QUALITY_BUDGET_SECONDS = 180
_RENDER_TIMEOUT_SECONDS = 45
_JUDGE_TIMEOUT_SECONDS = 60
_REGEN_TIMEOUT_SECONDS = 150
# Don't START a step unless at least this much budget remains (a started step is
# allowed to finish, but its own timeout caps the overrun).
_MIN_BUDGET_FOR_REGEN = 90
_MIN_BUDGET_FOR_JUDGE = 25


def _repair_regen(html: str, model: str, instruction: str,
                  timeout: float = _REGEN_TIMEOUT_SECONDS) -> Optional[str]:
    """One low-temperature, preserve-everything regeneration with a repair
    instruction. ``timeout`` caps the upstream call. Returns the cleaned HTML,
    or None on failure / size overflow."""
    try:
        out = _clean_html(
            llm.generate_text(
                _SYSTEM_PROMPT,
                "Here is the current HTML document for the creation:\n\n" + html + "\n\n" + instruction,
                max_tokens=_CODEGEN_MAX_TOKENS,
                temperature=0.2,
                caps=None,
                model=model,
                timeout=timeout,
            )
        )
    except Exception:
        logger.warning("builder: repair regen failed", exc_info=True)
        return None
    if out and len(out.encode("utf-8")) <= MAX_HTML_BYTES:
        return out
    return None


def _render_quality_pass(html: str, *, prompt: str, facts: str, sources: List[str],
                        model: str, username: Optional[str],
                        community_id: Optional[int]) -> str:
    """Render the artifact, judge it, and apply AT MOST ONE targeted repair, all
    within a hard wall-clock budget. Entirely best-effort: any failure (service
    down, render/judge error, low budget) returns the artifact unchanged, and the
    whole pass can never push the build past its request/lease timeout."""
    from backend.services import render_service, vision_judge  # lazy: optional infra

    if not render_service.is_configured():
        return html

    deadline = time.monotonic() + _QUALITY_BUDGET_SECONDS

    def budget_left() -> float:
        return deadline - time.monotonic()

    if budget_left() < _RENDER_TIMEOUT_SECONDS:
        return html
    try:
        shot = render_service.render(html, read_timeout=min(_RENDER_TIMEOUT_SECONDS, budget_left()))
    except Exception:
        logger.warning("builder: render quality pass failed to render", exc_info=True)
        return html
    if not shot:
        return html

    fixed = False  # at most ONE repair regen per build (time + cost bound)

    # 1) Render-fix (highest priority): blank page or JS console errors.
    if (shot.get("blank") or shot.get("console_errors")) and budget_left() > _MIN_BUDGET_FOR_REGEN:
        errs = shot.get("console_errors") or []
        reason = "the page rendered completely blank/empty" if shot.get("blank") \
            else "the page logged JavaScript errors at runtime"
        instruction = (
            f"When rendered in a real browser, {reason}. Find and fix the bug so the app renders "
            "and works correctly. Return the COMPLETE corrected HTML; preserve the intended design "
            "and all features."
        )
        if errs:
            instruction += "\n\nConsole errors observed:\n" + "\n".join(errs[:8])
        repaired = _repair_regen(html, model, instruction, timeout=min(_REGEN_TIMEOUT_SECONDS, budget_left()))
        if repaired:
            html = repaired
            fixed = True
            if budget_left() > _RENDER_TIMEOUT_SECONDS:
                try:
                    shot2 = render_service.render(html, read_timeout=min(_RENDER_TIMEOUT_SECONDS, budget_left()))
                    if shot2:
                        shot = shot2
                except Exception:
                    pass

    # 2) Vision-judge the screenshot: data accuracy + design craft.
    if budget_left() < _MIN_BUDGET_FOR_JUDGE:
        return html
    verdict = vision_judge.judge(
        shot.get("screenshot", ""), username=username or "", brief=prompt, facts=facts,
        console_errors=shot.get("console_errors") or [], community_id=community_id,
        timeout=min(_JUDGE_TIMEOUT_SECONDS, budget_left()),
    )
    if not verdict:
        return html

    # 2a) Web-data verification: on-screen values must match the researched data.
    if (not fixed and facts and verdict.get("data_verified") == "no"
            and budget_left() > _MIN_BUDGET_FOR_REGEN):
        issues = verdict.get("data_issues") or []
        instruction = (
            "The data shown on screen does NOT match the required real-world data. Correct EVERY value "
            "to exactly match the facts below, and keep a visible 'Sources' section linking the source "
            "URLs. Return the COMPLETE updated HTML; change nothing else."
        )
        if issues:
            instruction += "\n\nSpecific problems found:\n- " + "\n- ".join(issues)
        instruction += f"\n\nREAL DATA:\n{facts}\n\nSOURCE LINKS:\n" + "\n".join(sources)
        repaired = _repair_regen(html, model, instruction, timeout=min(_REGEN_TIMEOUT_SECONDS, budget_left()))
        if repaired:
            html = repaired
            fixed = True

    # 2b) Design-refine: only the 'best' tier, only when clearly below the bar.
    if (not fixed and model == _MODEL_BEST and budget_left() > _MIN_BUDGET_FOR_REGEN
            and verdict.get("design_score", 100) < _DESIGN_REFINE_THRESHOLD):
        critique = verdict.get("critique") or []
        if critique:
            instruction = (
                "Raise the visual craft of this app. Apply these specific improvements while preserving "
                "ALL functionality and content. Return the COMPLETE updated HTML:\n- " + "\n- ".join(critique)
            )
            repaired = _repair_regen(html, model, instruction, timeout=min(_REGEN_TIMEOUT_SECONDS, budget_left()))
            if repaired:
                html = repaired
                fixed = True

    return html


def _generate_with_fallback(prompt: str, *, prior_html: Optional[str] = None,
                           temperature: float, model: str, verify: bool = False,
                           username: Optional[str] = None, community_id: Optional[int] = None) -> tuple:
    """Generate via ``model``; if a non-fast model (e.g. OpenAI 'best') errors,
    fall back to the fast model so a build never hard-fails. Returns
    ``(html, model_actually_used)``."""
    try:
        return generate_artifact(prompt, prior_html=prior_html, temperature=temperature, model=model,
                                 verify=verify, username=username, community_id=community_id), model
    except Exception:
        if model != _MODEL_FAST:
            logger.warning("builder: model %s failed; falling back to %s", model, _MODEL_FAST)
            return (generate_artifact(prompt, prior_html=prior_html, temperature=temperature,
                                      model=_MODEL_FAST, verify=verify, username=username,
                                      community_id=community_id),
                    _MODEL_FAST)
        raise


def create_creation(*, username: str, community_id: Optional[int], prompt: str,
                    title: Optional[str] = None, tier: str = "fast",
                    verify: bool = False) -> Dict[str, Any]:
    """Generate a first artifact from ``prompt`` and persist it as a draft."""
    html, model_used = _generate_with_fallback(
        prompt, temperature=0.8, model=resolve_model(tier),
        verify=verify, username=username, community_id=community_id)
    resolved_title = (title or _extract_title(html, prompt))[:200]
    creation_kind = infer_creation_kind(prompt, resolved_title)
    history = _append_history(None, prompt)
    now = _now()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO creations
                (community_id, created_by, title, kind, html_content,
                 prompt_history, status, created_at, updated_at)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            """,
            (community_id, username, resolved_title, creation_kind, html,
             history, "draft", now, now),
        )
        creation_id = c.lastrowid
        conn.commit()
    html_r2_key = store_artifact_html(int(creation_id), html, updated_at=now)
    if html_r2_key:
        try:
            with get_db_connection() as conn:
                c = conn.cursor()
                c.execute(
                    f"UPDATE creations SET html_r2_key = {ph}, html_content = {ph} WHERE id = {ph}",
                    (html_r2_key, "", creation_id),
                )
                conn.commit()
        except Exception:
            logger.warning("builder: failed to store R2 artifact key for creation %s", creation_id, exc_info=True)
    return {"id": creation_id, "title": resolved_title, "html": html, "status": "draft",
            "kind": creation_kind, "community_id": community_id, "model": model_used}


def get_creation(creation_id: int) -> Optional[Dict[str, Any]]:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT id, community_id, created_by, title, kind, html_content,
                   prompt_history, parent_creation_id, status, published_post_id,
                   created_at, updated_at, html_r2_key, public_slug,
                   public_status, public_html_r2_key, public_published_at,
                   public_unpublished_at, public_kind, gallery_status,
                   gallery_requested_at, gallery_reviewed_at, gallery_reviewed_by,
                   gallery_rejection_reason
            FROM creations WHERE id = {ph}
            """,
            (creation_id,),
        )
        row = c.fetchone()
    if not row:
        return None
    out = _row_to_dict(row)
    html = load_artifact_html(
        int(out["id"]), out.get("html_r2_key"), updated_at=str(out.get("updated_at") or "")
    )
    if html is not None:
        out["html_content"] = html
    if out.get("public_slug"):
        out["public_url"] = public_build_url(str(out["public_slug"]))
    return out


def iterate_creation(*, creation_id: int, username: str, message: str, tier: str = "fast",
                    verify: bool = False) -> Dict[str, Any]:
    """Revise an existing creation with a follow-up instruction (full-file regen)."""
    row = get_creation(creation_id)
    if not row or row.get("created_by") != username:
        raise PermissionError("creation not found")
    html, model_used = _generate_with_fallback(
        message, prior_html=row.get("html_content"), temperature=0.2, model=resolve_model(tier),
        verify=verify, username=username, community_id=row.get("community_id"))
    history = _append_history(row.get("prompt_history"), message)
    now = _now()
    ph = get_sql_placeholder()
    old_r2_key = row.get("html_r2_key")
    html_r2_key = store_artifact_html(int(creation_id), html, updated_at=now)
    stored_html = "" if html_r2_key else html
    stored_r2_key = html_r2_key if html_r2_key else None
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"UPDATE creations SET html_content = {ph}, html_r2_key = {ph}, prompt_history = {ph}, updated_at = {ph} WHERE id = {ph}",
            (stored_html, stored_r2_key, history, now, creation_id),
        )
        conn.commit()
    if old_r2_key and old_r2_key != stored_r2_key:
        delete_artifact_html(old_r2_key)
    return {"id": creation_id, "title": row.get("title"), "html": html, "status": row.get("status"), "kind": row.get("kind"), "model": model_used}


# --- Async build jobs ---------------------------------------------------------

_ACTIVE_JOB_STATUSES = ("queued", "running")
# A worker holds a lease for this long; the sweep cron reclaims jobs whose
# lease expired (worker crashed / Cloud Run instance recycled mid-build).
_LEASE_SECONDS = 600


def create_build_job(*, username: str, community_id: Optional[int], prompt: str, tier: str,
                     kind: str = "create", creation_id: Optional[int] = None) -> Dict[str, Any]:
    """Persist a build request so generation can continue after the client leaves.

    ``kind`` is ``create`` for a new artifact or ``iterate`` for updating an
    existing creation. The actual model call runs later via ``run_build_job``.
    """
    ensure_tables()
    k = kind if kind in ("create", "iterate") else "create"
    now = _now()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""INSERT INTO builder_jobs
                (username, community_id, creation_id, kind, prompt, tier, status, created_at, updated_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, 'queued', {ph}, {ph})""",
            (username, community_id, creation_id, k, prompt, tier or _DEFAULT_TIER, now, now),
        )
        job_id = c.lastrowid
        conn.commit()
    return get_build_job(job_id) or {"id": job_id, "status": "queued"}


def get_build_job(job_id: int) -> Optional[Dict[str, Any]]:
    ensure_tables()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""SELECT id, username, community_id, creation_id, kind, prompt, tier, status,
                       result_creation_id, error, attempts, max_attempts, worker_token,
                       lease_expires_at, notified_at, created_at, updated_at, started_at, finished_at
                FROM builder_jobs WHERE id = {ph}""",
            (job_id,),
        )
        row = c.fetchone()
    return _job_row_to_dict(row) if row else None


def user_has_active_job(username: str) -> bool:
    """Limit each user to one in-flight build to avoid accidental queue spam."""
    ensure_tables()
    ph = get_sql_placeholder()
    placeholders = ", ".join([ph for _ in _ACTIVE_JOB_STATUSES])
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT id FROM builder_jobs WHERE username = {ph} AND status IN ({placeholders}) LIMIT 1",
            (username, *_ACTIVE_JOB_STATUSES),
        )
        return c.fetchone() is not None


def _set_job_status(job_id: int, status: str, *, result_creation_id: Optional[int] = None,
                    error: Optional[str] = None, started: bool = False, finished: bool = False,
                    clear_worker: bool = False) -> None:
    """Update a job's terminal/intermediate state.

    Builds the SET clause with the live placeholder directly — never via a
    string ``replace('?', ph)``, which would corrupt any value containing a
    literal ``?`` (e.g. a prompt-derived error string).
    """
    now = _now()
    ph = get_sql_placeholder()
    parts = [f"status = {ph}", f"updated_at = {ph}"]
    params: List[Any] = [status, now]
    if result_creation_id is not None:
        parts.append(f"result_creation_id = {ph}")
        params.append(result_creation_id)
    if error is not None:
        parts.append(f"error = {ph}")
        params.append(error[:255])
    if started:
        parts.append(f"started_at = {ph}")
        params.append(now)
        parts.append("attempts = attempts + 1")
    if finished:
        parts.append(f"finished_at = {ph}")
        params.append(now)
    if clear_worker:
        # Release the lease so a re-queued job can be re-claimed cleanly.
        parts.append("worker_token = NULL")
        parts.append("lease_expires_at = NULL")
    sql = f"UPDATE builder_jobs SET {', '.join(parts)} WHERE id = {ph}"
    params.append(job_id)
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(sql, tuple(params))
        conn.commit()


def claim_build_job(job_id: int, worker_token: str, lease_seconds: int = _LEASE_SECONDS) -> bool:
    """Atomically claim a job for this worker.

    Cloud Tasks is at-least-once: a job can be delivered more than once. This
    single conditional UPDATE is the concurrency gate — only the worker whose
    UPDATE affects exactly one row owns the run, so duplicate deliveries cannot
    both produce a creation / usage row. A ``running`` job whose lease has
    expired (crashed worker) is reclaimable; one at ``max_attempts`` is not.
    """
    ensure_tables()
    ph = get_sql_placeholder()
    now = _now()
    lease = (datetime.utcnow() + timedelta(seconds=lease_seconds)).strftime("%Y-%m-%d %H:%M:%S")
    sql = (
        f"UPDATE builder_jobs SET status='running', worker_token={ph}, started_at={ph}, "
        f"lease_expires_at={ph}, attempts=attempts+1, updated_at={ph} "
        f"WHERE id={ph} AND attempts < max_attempts AND ("
        f"status IN ('queued','failed') OR "
        f"(status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at < {ph}))"
    )
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(sql, (worker_token, now, lease, now, job_id, now))
        claimed = c.rowcount == 1
        conn.commit()
    return claimed


def _mark_notified(job_id: int) -> bool:
    """Stamp ``notified_at`` exactly once. Returns True for the first caller
    only, so a retried/duplicated worker never re-sends the completion push."""
    ph = get_sql_placeholder()
    now = _now()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"UPDATE builder_jobs SET notified_at={ph} WHERE id={ph} AND notified_at IS NULL",
            (now, job_id),
        )
        won = c.rowcount == 1
        conn.commit()
    return won


# Generation/validation failures are terminal (the same prompt will fail again);
# only genuine infra blips warrant a Cloud Tasks retry. Default to terminal so a
# bad build never retry-storms log_usage(success=0).
_TRANSIENT_MARKERS = (
    "timeout", "timed out", "temporarily", "rate limit", "rate_limit", "429",
    "502", "503", "504", "connection", "unavailable", "overloaded",
)


def _is_transient_error(exc: Exception) -> bool:
    if isinstance(exc, (TimeoutError, ConnectionError)):
        return True
    msg = str(exc).lower()
    return any(marker in msg for marker in _TRANSIENT_MARKERS)


def _notify_build_complete(username: str, *, community_id: Optional[int], creation_id: int,
                           title: str, failed: bool = False) -> None:
    """Send in-app + push notification when an async build finishes."""
    try:
        from backend.services import notification_copy
        from backend.services.notifications import create_notification, send_push_to_user

        event = "builder_failed" if failed else "builder_complete"
        locale = notification_copy.recipient_locale(username)
        safe_title = (title or "your build")[:120]
        link_base = f"/community/{community_id}/builder" if community_id else "/builder"
        link = f"{link_base}?creation_id={creation_id}" if creation_id else link_base
        params = {"title": safe_title}
        create_notification(
            user_id=username,
            from_user="steve",
            notification_type=event,
            community_id=community_id,
            message=notification_copy.in_app_text(event, locale, **params),
            link=link,
        )
        payload = notification_copy.push_payload(event, locale, **params)
        payload.update({"url": link, "tag": f"builder:{creation_id}:{event}"})
        send_push_to_user(username, payload)
    except Exception:
        logger.warning("builder: completion notification failed", exc_info=True)


def run_build_job(job_id: int) -> Dict[str, Any]:
    """Execute a queued builder job. Safe for Cloud Tasks at-least-once delivery.

    Concurrency/idempotency is enforced by ``claim_build_job``: only the worker
    that wins the atomic claim runs generation and produces side effects
    (creation write, one ``ai_usage`` row, one completion notification). A
    duplicate delivery loses the claim and is a no-op. The return dict carries a
    ``transient`` flag so the HTTP worker can ask Cloud Tasks to retry only when
    a retry could actually help.
    """
    job = get_build_job(job_id)
    if not job:
        return {"success": False, "error": "not_found"}
    if job.get("status") == "succeeded":
        return {"success": True, "already_done": True, "job": job}

    worker_token = uuid.uuid4().hex
    if not claim_build_job(job_id, worker_token):
        # Lost the claim: another worker owns it, or it is terminal / exhausted.
        fresh = get_build_job(job_id) or job
        status = fresh.get("status")
        if status == "succeeded":
            return {"success": True, "already_done": True, "job": fresh}
        if status == "running":
            return {"success": True, "already_running": True, "job": fresh}
        return {"success": False, "error": "not_claimable", "transient": False, "job": fresh}

    job_id_int = int(job["id"])
    username = str(job["username"])
    community_id = int(job["community_id"]) if job.get("community_id") is not None else None
    kind = str(job.get("kind") or "create")
    prompt = str(job.get("prompt") or "")
    tier = str(job.get("tier") or _DEFAULT_TIER)
    creation_id = job.get("creation_id")
    request_type = "builder_iterate" if kind == "iterate" else "builder_create"

    try:
        if kind == "iterate":
            creation = iterate_creation(
                creation_id=int(creation_id), username=username, message=prompt, tier=tier,
                verify=True,
            )
        else:
            creation = create_creation(
                username=username, community_id=community_id, prompt=prompt, tier=tier,
                verify=True,
            )
        result_id = int(creation["id"])
        _set_job_status(job_id_int, "succeeded", result_creation_id=result_id,
                        finished=True, clear_worker=True)
        try:
            from backend.services import ai_usage
            ai_usage.log_usage(
                username,
                surface=ai_usage.SURFACE_BUILDER,
                request_type=request_type,
                community_id=community_id,
                model=creation.get("model") or MODEL_LABEL,
            )
        except Exception:
            logger.warning("builder: usage logging failed for job %s", job_id, exc_info=True)
        if _mark_notified(job_id_int):
            _notify_build_complete(
                username, community_id=community_id, creation_id=result_id,
                title=creation.get("title") or "your build",
            )
        return {"success": True, "creation": creation, "job": get_build_job(job_id_int)}
    except Exception as exc:
        if _is_transient_error(exc):
            fresh = get_build_job(job_id_int) or job
            attempts = int(fresh.get("attempts") or 0)
            max_attempts = int(fresh.get("max_attempts") or 3)
            if attempts < max_attempts:
                # Release the claim and let Cloud Tasks retry. No usage row, no
                # notification — this build has not reached a terminal outcome.
                logger.warning("builder: transient error on job %s (attempt %s/%s); will retry",
                               job_id, attempts, max_attempts, exc_info=True)
                _set_job_status(job_id_int, "queued", clear_worker=True)
                return {"success": False, "error": "transient", "transient": True,
                        "job": get_build_job(job_id_int)}
            # Attempts exhausted → fall through to a terminal failure.
        logger.exception("builder: run_build_job failed (terminal)")
        _set_job_status(job_id_int, "failed", error="build_failed", finished=True, clear_worker=True)
        try:
            from backend.services import ai_usage
            ai_usage.log_usage(
                username,
                surface=ai_usage.SURFACE_BUILDER,
                request_type=request_type,
                success=False,
                reason_blocked="generation_error",
                community_id=community_id,
                model=MODEL_LABEL,
            )
        except Exception:
            logger.warning("builder: failure usage logging failed for job %s", job_id, exc_info=True)
        if _mark_notified(job_id_int):
            _notify_build_complete(
                username, community_id=community_id, creation_id=int(creation_id or 0),
                title="your build", failed=True,
            )
        return {"success": False, "error": str(exc)[:255], "transient": False,
                "job": get_build_job(job_id_int)}


def _cloud_tasks_config() -> Dict[str, str]:
    return {
        "queue": (os.getenv("BUILDER_TASKS_QUEUE") or "").strip(),
        "location": (os.getenv("BUILDER_TASKS_LOCATION") or "").strip(),
        "project": (os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("GCP_PROJECT") or "").strip(),
        "base_url": (os.getenv("PUBLIC_BASE_URL") or "").strip().rstrip("/"),
        "secret": (os.getenv("BUILDER_JOB_SECRET") or os.getenv("CRON_SHARED_SECRET") or "").strip(),
    }


def builder_async_health() -> Dict[str, Any]:
    """Report (and log once) whether async builds run via durable Cloud Tasks or
    the in-process thread fallback. Called at startup so prod never silently
    degrades to the non-durable path without an operator noticing."""
    cfg = _cloud_tasks_config()
    ready = all(cfg.values())
    missing = [k for k, v in cfg.items() if not v]
    info = {"cloud_tasks_ready": ready, "missing": missing}
    if ready:
        logger.info("builder: async builds via Cloud Tasks (queue=%s location=%s)",
                    cfg["queue"], cfg["location"])
    else:
        logger.warning(
            "builder: async builds using IN-PROCESS THREAD fallback (NOT durable). "
            "Set Cloud Tasks env to enable the durable path. Missing: %s",
            ", ".join(missing) or "(none)",
        )
    return info


def enqueue_build_job(job_id: int) -> bool:
    """Enqueue a builder job.

    Production can set ``BUILDER_TASKS_QUEUE`` + ``BUILDER_TASKS_LOCATION`` to
    use Cloud Tasks. Without that config, a daemon thread keeps local/staging
    development functional, but Cloud Tasks is the durable production path.
    """
    cfg = _cloud_tasks_config()
    if all(cfg.values()):
        try:
            from google.cloud import tasks_v2

            client = tasks_v2.CloudTasksClient()
            parent = client.queue_path(cfg["project"], cfg["location"], cfg["queue"])
            url = f"{cfg['base_url']}/api/internal/builder/jobs/{job_id}/run"
            task = {
                "http_request": {
                    "http_method": tasks_v2.HttpMethod.POST,
                    "url": url,
                    "headers": {"X-Builder-Job-Secret": cfg["secret"]},
                }
            }
            client.create_task(request={"parent": parent, "task": task})
            return True
        except Exception:
            logger.warning("builder: Cloud Tasks enqueue failed; falling back to local thread", exc_info=True)

    def _worker() -> None:
        # Tiny delay lets the request return before CPU-heavy generation starts.
        time.sleep(0.2)
        run_build_job(job_id)

    threading.Thread(target=_worker, name=f"builder-job-{job_id}", daemon=True).start()
    return False


def sweep_build_jobs(*, now: Optional[str] = None) -> Dict[str, int]:
    """Reaper: reclaim jobs orphaned by a crashed worker / recycled instance.

    A ``running`` job whose lease expired is requeued and re-dispatched if it
    still has attempts left; otherwise it is marked terminally ``failed`` with a
    single block row + (idempotent) notification. Invoked by Cloud Scheduler at
    ``/api/cron/builder/sweep``.
    """
    ensure_tables()
    ph = get_sql_placeholder()
    now_s = now or _now()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""SELECT id, username, community_id, creation_id, attempts, max_attempts
                FROM builder_jobs
                WHERE status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at < {ph}""",
            (now_s,),
        )
        rows = c.fetchall() or []

    def _field(row: Any, idx: int, key: str) -> Any:
        return row[key] if hasattr(row, "keys") else row[idx]

    requeued = 0
    failed = 0
    for row in rows:
        jid = int(_field(row, 0, "id"))
        username = str(_field(row, 1, "username"))
        raw_community_id = _field(row, 2, "community_id")
        community_id = int(raw_community_id) if raw_community_id is not None else None
        creation_id = _field(row, 3, "creation_id")
        attempts = int(_field(row, 4, "attempts") or 0)
        max_attempts = int(_field(row, 5, "max_attempts") or 3)
        if attempts >= max_attempts:
            _set_job_status(jid, "failed", error="build_timed_out", finished=True, clear_worker=True)
            try:
                from backend.services import ai_usage
                ai_usage.log_block(username, surface=ai_usage.SURFACE_BUILDER,
                                   reason="build_timed_out", community_id=community_id)
            except Exception:
                logger.warning("builder: sweep block logging failed for job %s", jid, exc_info=True)
            if _mark_notified(jid):
                _notify_build_complete(username, community_id=community_id,
                                       creation_id=int(creation_id or 0), title="your build", failed=True)
            failed += 1
        else:
            _set_job_status(jid, "queued", clear_worker=True)
            enqueue_build_job(jid)
            requeued += 1
    if requeued or failed:
        logger.info("builder: sweep requeued=%s failed=%s", requeued, failed)
    return {"requeued": requeued, "failed": failed}


def publish_creation(*, creation_id: int, username: str, community_id: Optional[int] = None,
                    caption: Optional[str] = None) -> Dict[str, Any]:
    """Create a community post that references the creation (publish = post)."""
    row = get_creation(creation_id)
    if not row or row.get("created_by") != username:
        raise PermissionError("creation not found")
    target_community_id = int(community_id or row.get("community_id") or 0)
    if target_community_id <= 0:
        raise ValueError("community_required")
    existing_share = get_creation_share(creation_id=creation_id, community_id=target_community_id)
    if existing_share:
        return {"post_id": existing_share["post_id"], "already_published": True, "community_id": target_community_id}
    content = (caption or row.get("title") or "Check out what I built").strip()
    now = _now()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO posts (username, content, timestamp, community_id, creation_id) "
            f"VALUES ({ph}, {ph}, {ph}, {ph}, {ph})",
            (username, content, now, target_community_id, creation_id),
        )
        post_id = c.lastrowid
        c.execute(
            f"""INSERT INTO creation_shares
                (creation_id, community_id, post_id, shared_by, created_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph})""",
            (creation_id, target_community_id, post_id, username, now),
        )
        update_cols = f"status = 'published', updated_at = {ph}"
        params: List[Any] = [now]
        if not row.get("published_post_id"):
            update_cols += f", published_post_id = {ph}"
            params.append(post_id)
        if row.get("community_id") is None:
            update_cols += f", community_id = {ph}"
            params.append(target_community_id)
        params.append(creation_id)
        c.execute(
            f"UPDATE creations SET {update_cols} WHERE id = {ph}",
            tuple(params),
        )
        conn.commit()
    return {"post_id": post_id, "already_published": False, "community_id": target_community_id}


def get_creation_share(*, creation_id: int, community_id: int) -> Optional[Dict[str, Any]]:
    ensure_tables()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""SELECT id, creation_id, community_id, post_id, shared_by, created_at
                FROM creation_shares WHERE creation_id = {ph} AND community_id = {ph}""",
            (creation_id, community_id),
        )
        row = c.fetchone()
    if not row:
        return None
    return {
        "id": _cell(row, 0),
        "creation_id": _cell(row, 1),
        "community_id": _cell(row, 2),
        "post_id": _cell(row, 3),
        "shared_by": _cell(row, 4),
        "created_at": str(_cell(row, 5)) if _cell(row, 5) is not None else None,
    }


def publish_creation_to_web(*, creation_id: int, username: str) -> Dict[str, Any]:
    """Publish a website/app creation to the public builds domain."""
    row = get_creation(creation_id)
    if not row or row.get("created_by") != username:
        raise PermissionError("creation not found")

    kind = _public_kind(row.get("public_kind") or row.get("kind"))
    if kind == "game" or not public_publish_eligible(kind):
        raise ValueError("public_publish_not_supported_for_games")

    html = row.get("html_content") or ""
    if not html.strip():
        raise ValueError("artifact_missing")

    now = _now()
    slug = str(row.get("public_slug") or _slugify_public_title(row.get("title"), creation_id))
    artifact_key = public_artifact_r2_key(slug, version=now)
    public_html = prepare_public_creation_html(html, slug=slug, title=str(row.get("title") or "C-Point build"))
    if not _upload_public_html(artifact_key, public_html):
        raise RuntimeError("public_artifact_upload_failed")

    manifest = _public_manifest(
        creation_id=creation_id, slug=slug, title=str(row.get("title") or "Untitled build"),
        artifact_key=artifact_key, kind=kind, published_at=now,
    )
    if not _upload_public_json(public_manifest_r2_key(slug), manifest):
        try:
            from backend.services.r2_storage import delete_from_r2
            delete_from_r2(artifact_key)
        except Exception:
            pass
        raise RuntimeError("public_manifest_upload_failed")

    old_public_key = row.get("public_html_r2_key")
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            UPDATE creations
            SET public_slug = {ph}, public_status = {ph}, public_html_r2_key = {ph},
                public_published_at = {ph}, public_unpublished_at = NULL,
                public_kind = {ph}, updated_at = {ph}
            WHERE id = {ph} AND created_by = {ph}
            """,
            (slug, "published", artifact_key, now, kind, now, creation_id, username),
        )
        conn.commit()

    if old_public_key and old_public_key != artifact_key:
        try:
            from backend.services.r2_storage import delete_from_r2
            delete_from_r2(str(old_public_key))
        except Exception:
            logger.debug("builder: old public artifact cleanup skipped for %s", creation_id, exc_info=True)

    return {
        "public_slug": slug,
        "public_url": public_build_url(slug),
        "public_status": "published",
        "public_kind": kind,
        "public_published_at": now,
    }


def unpublish_creation_from_web(*, creation_id: int, username: str) -> Dict[str, Any]:
    row = get_creation(creation_id)
    if not row or row.get("created_by") != username:
        raise PermissionError("creation not found")

    slug = row.get("public_slug")
    public_key = row.get("public_html_r2_key")
    now = _now()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            UPDATE creations
            SET public_status = {ph}, public_unpublished_at = {ph},
                gallery_status = CASE WHEN gallery_status = 'approved' THEN 'delisted' ELSE gallery_status END,
                updated_at = {ph}
            WHERE id = {ph} AND created_by = {ph}
            """,
            ("unpublished", now, now, creation_id, username),
        )
        conn.commit()

    try:
        from backend.services.r2_storage import delete_from_r2
        if slug:
            delete_from_r2(public_manifest_r2_key(str(slug)))
        if public_key:
            delete_from_r2(str(public_key))
    except Exception:
        logger.debug("builder: public unpublish R2 cleanup skipped for %s", creation_id, exc_info=True)

    return {
        "public_slug": slug,
        "public_url": public_build_url(str(slug)) if slug else None,
        "public_status": "unpublished",
        "public_unpublished_at": now,
    }


_GALLERY_STATUSES = {"not_listed", "pending", "approved", "rejected", "delisted"}


def update_gallery_status(*, creation_id: int, username: str, action: str,
                          reviewer: Optional[str] = None,
                          reason: Optional[str] = None) -> Dict[str, Any]:
    """Owner request/unlist and app-admin review state for Explore Creations."""
    row = get_creation(creation_id)
    if not row:
        raise PermissionError("creation not found")
    actor_is_owner = row.get("created_by") == username
    now = _now()
    action_key = (action or "").strip().lower()
    ph = get_sql_placeholder()
    if action_key == "request":
        if not actor_is_owner:
            raise PermissionError("creation not found")
        status = "approved"
        sql = f"""UPDATE creations SET gallery_status = {ph}, gallery_requested_at = {ph},
                  gallery_reviewed_at = {ph}, gallery_reviewed_by = {ph},
                  gallery_rejection_reason = NULL, updated_at = {ph}
                  WHERE id = {ph} AND created_by = {ph}"""
        params = (status, now, now, username, now, creation_id, username)
    elif action_key == "unlist":
        if not actor_is_owner:
            raise PermissionError("creation not found")
        status = "not_listed"
        sql = f"""UPDATE creations SET gallery_status = {ph}, updated_at = {ph}
                  WHERE id = {ph} AND created_by = {ph}"""
        params = (status, now, creation_id, username)
    elif action_key in ("approve", "reject", "delist"):
        status = "approved" if action_key == "approve" else ("rejected" if action_key == "reject" else "delisted")
        sql = f"""UPDATE creations SET gallery_status = {ph}, gallery_reviewed_at = {ph},
                  gallery_reviewed_by = {ph}, gallery_rejection_reason = {ph}, updated_at = {ph}
                  WHERE id = {ph}"""
        params = (status, now, reviewer or username, (reason or "")[:255] if status == "rejected" else None, now, creation_id)
    else:
        raise ValueError("invalid_gallery_action")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(sql, params)
        conn.commit()
    updated = get_creation(creation_id) or {}
    return {
        "gallery_status": updated.get("gallery_status") or status,
        "gallery_requested_at": str(updated.get("gallery_requested_at")) if updated.get("gallery_requested_at") else None,
        "gallery_reviewed_at": str(updated.get("gallery_reviewed_at")) if updated.get("gallery_reviewed_at") else None,
        "gallery_rejection_reason": updated.get("gallery_rejection_reason"),
    }


def list_explore_creations(*, limit: int = 30) -> List[Dict[str, Any]]:
    ph = get_sql_placeholder()
    limit = max(1, min(int(limit or 30), 60))
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""SELECT id, title, kind, public_slug, public_kind, public_published_at, play_count
                FROM creations
                WHERE gallery_status = 'approved'
                ORDER BY COALESCE(gallery_reviewed_at, public_published_at, updated_at) DESC
                LIMIT {ph}""",
            (limit,),
        )
        rows = c.fetchall() or []
    return [{
        "id": _cell(r, 0),
        "title": _cell(r, 1) or "Untitled",
        "kind": _cell(r, 2),
        "play_url": f"/creation/{_cell(r, 0)}",
        "public_url": public_build_url(str(_cell(r, 3))) if _cell(r, 3) else None,
        "public_kind": _cell(r, 4),
        "public_published_at": str(_cell(r, 5)) if _cell(r, 5) is not None else None,
        "plays": int(_cell(r, 6) or 0),
        "label": "Made with Steve",
    } for r in rows]


def public_creation_for_slug(slug: str) -> Optional[Dict[str, Any]]:
    cleaned = re.sub(r"[^a-z0-9-]+", "", str(slug or "").lower())[:96]
    if not cleaned:
        return None
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT id, community_id, created_by, title, kind, html_content,
                   prompt_history, parent_creation_id, status, published_post_id,
                   created_at, updated_at, html_r2_key, public_slug,
                   public_status, public_html_r2_key, public_published_at,
                   public_unpublished_at, public_kind, gallery_status,
                   gallery_requested_at, gallery_reviewed_at, gallery_reviewed_by,
                   gallery_rejection_reason
            FROM creations
            WHERE public_slug = {ph} AND public_status = 'published'
            """,
            (cleaned,),
        )
        row = c.fetchone()
    if not row:
        return None
    out = _row_to_dict(row)
    out["public_url"] = public_build_url(cleaned)
    return out


def _try_delete_post_dependents(c, ph: str, post_id: int) -> None:
    """Best-effort cleanup for rows that point at a published creation post.

    Older deployments may not have every auxiliary table, so missing-table
    errors are logged at debug level and deletion continues.
    """
    for sql, params in (
        (
            f"DELETE FROM reply_reactions WHERE reply_id IN (SELECT id FROM replies WHERE post_id = {ph})",
            (post_id,),
        ),
        (f"DELETE FROM replies WHERE post_id = {ph}", (post_id,)),
        (f"DELETE FROM reactions WHERE post_id = {ph}", (post_id,)),
        (f"DELETE FROM notifications WHERE post_id = {ph}", (post_id,)),
        (f"DELETE FROM post_views WHERE post_id = {ph}", (post_id,)),
    ):
        try:
            c.execute(sql, params)
        except Exception as exc:
            logger.debug("builder: post dependent cleanup skipped for post %s: %s", post_id, exc)


def delete_creation(username: str, creation_id: int) -> Tuple[Dict[str, Any], int]:
    """Owner-only permanent deletion for a Steve Build creation.

    Removes the artifact row, all CPoint data (saves/scores/ratings), the
    published feed post if present, and related builder job history.
    """
    ph = get_sql_placeholder()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""SELECT id, created_by, published_post_id, html_r2_key, updated_at,
                           community_id, public_slug, public_html_r2_key
                    FROM creations WHERE id = {ph}""",
                (creation_id,),
            )
            row = c.fetchone()
            if not row or _cell(row, 1) != username:
                return {"success": False, "error": "not_found"}, 404

            published_post_id = _cell(row, 2)
            html_r2_key = _cell(row, 3)
            updated_at = _cell(row, 4)
            community_id = _cell(row, 5)
            public_slug = _cell(row, 6)
            public_html_r2_key = _cell(row, 7)

            # Delete EVERY post that references this creation (not just the one
            # recorded on the row), plus each post's dependents — otherwise a
            # stray post keeps rendering a playable card on the feed.
            c.execute(f"SELECT id FROM posts WHERE creation_id = {ph}", (creation_id,))
            post_ids = {int(_cell(r, 0)) for r in (c.fetchall() or [])}
            if published_post_id is not None:
                post_ids.add(int(published_post_id))
            c.execute(f"SELECT post_id FROM creation_shares WHERE creation_id = {ph}", (creation_id,))
            for r in (c.fetchall() or []):
                if _cell(r, 0) is not None:
                    post_ids.add(int(_cell(r, 0)))
            for pid in post_ids:
                _try_delete_post_dependents(c, ph, pid)
                c.execute(f"DELETE FROM posts WHERE id = {ph}", (pid,))

            c.execute(f"DELETE FROM creation_shares WHERE creation_id = {ph}", (creation_id,))
            c.execute(f"DELETE FROM creation_data WHERE creation_id = {ph}", (creation_id,))
            try:
                c.execute(f"DELETE FROM creation_runtime_data WHERE creation_id = {ph}", (creation_id,))
            except Exception:
                # Older deployments may not have created the runtime table yet.
                pass
            c.execute(f"DELETE FROM builder_jobs WHERE creation_id = {ph}", (creation_id,))
            c.execute(f"DELETE FROM creations WHERE id = {ph}", (creation_id,))
            conn.commit()

        delete_artifact_html(html_r2_key, creation_id=creation_id, updated_at=str(updated_at or ""))
        try:
            from backend.services.r2_storage import delete_from_r2
            if public_slug:
                delete_from_r2(public_manifest_r2_key(str(public_slug)))
            if public_html_r2_key:
                delete_from_r2(str(public_html_r2_key))
        except Exception:
            logger.debug("builder: public artifact delete skipped for creation %s", creation_id, exc_info=True)

        try:
            from redis_cache import cache
            cache.delete(f"cpdata:summary:{creation_id}")
        except Exception:
            logger.debug("builder: delete cache cleanup skipped for creation %s", creation_id, exc_info=True)

        # Drop the cached community feed so the deleted build's post stops
        # rendering immediately (the feed payload is cached per user).
        try:
            from redis_cache import invalidate_community_cache
            if community_id is not None:
                invalidate_community_cache(int(community_id))
        except Exception:
            logger.debug("builder: feed cache invalidation skipped for creation %s", creation_id, exc_info=True)

        return {"success": True}, 200
    except Exception:
        logger.exception("builder: delete_creation failed for %s", creation_id)
        return {"success": False, "error": "delete_failed"}, 500


# --- Community-scoped interaction data (scores / ratings / plays) -------------
# Front-end-only artifacts can't be trusted, so every value is clamped and the
# writer's username is stamped server-side. The artifact never reaches these
# functions directly — the session-authed host brokers the call.

_KEY_RE = re.compile(r"^[a-z0-9_]{1,64}$")
_LEADERBOARD_MAX = 50


def _clamp_score(value: Any) -> Optional[float]:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v != v or v in (float("inf"), float("-inf")):  # NaN / Inf
        return None
    return max(-1e12, min(1e12, v))


def _clean_display_name(name: Any, fallback: str) -> str:
    s = name if isinstance(name, str) else ""
    s = re.sub(r"[\x00-\x1f\x7f]", "", s)  # strip control chars
    s = re.sub(r"\s+", " ", s).strip()[:40]
    return s or (fallback or "Player")[:40]


def _safe_key(key: Any) -> str:
    """Strict normalizer for leaderboard/score keys. Falls back to 'highscore'."""
    k = key.strip().lower() if isinstance(key, str) else ""
    return k if _KEY_RE.match(k) else "highscore"


# Save-slot keys are more permissive than score keys so common generated names
# survive normalization instead of collapsing to a single bucket.
_SAVE_KEY_DISALLOWED = re.compile(r"[^a-z0-9_.\-:]")


def _safe_save_key(key: Any) -> str:
    """Normalize a save-slot key while preserving common generated names like
    'slot-1', 'saveSlot1', 'save slot 1', and 'level:3'. Whitespace collapses to
    '_', the result is lowercased for stable lookup, and disallowed characters
    are dropped. Falls back to 'save' (never 'highscore') so save slots never
    collide with leaderboard rows."""
    if not isinstance(key, str):
        return "save"
    k = re.sub(r"\s+", "_", key.strip().lower())
    k = _SAVE_KEY_DISALLOWED.sub("", k)
    k = k.strip("_.-:")[:64]
    return k or "save"


def _cell(row: Any, idx: int) -> Any:
    """Read the idx-th SELECTed column from a tuple / sqlite3.Row / dict row."""
    if row is None:
        return None
    try:
        return row[idx]  # tuple, sqlite3.Row
    except (KeyError, TypeError, IndexError):
        try:
            return list(row.values())[idx]  # dict-style cursor (column order preserved)
        except Exception:
            return None


def _upsert_value(*, creation_id: int, community_id: int, namespace: str, key: str,
                  username: str, value: float, display_name: str, keep_max: bool) -> None:
    """Insert or update the single row for (creation, namespace, key, user).
    keep_max=True keeps the best (highest) value; otherwise the latest wins."""
    now = _now()
    ph = get_sql_placeholder()
    # ATOMIC upsert: a SELECT-then-INSERT race (two rapid/concurrent submits) used
    # to both see "no row" and both INSERT -> the 2nd hit the UNIQUE key and 500'd
    # (IntegrityError), so the score never saved. ON DUPLICATE KEY / ON CONFLICT
    # collapses it to one race-free statement; keep_max picks the greater in-SQL.
    vals = (creation_id, community_id, namespace, key, username, display_name, value, now, now)
    with get_db_connection() as conn:
        c = conn.cursor()
        if USE_MYSQL:
            set_value = ("num_value = GREATEST(num_value, VALUES(num_value))" if keep_max
                         else "num_value = VALUES(num_value)")
            c.execute(
                f"""INSERT INTO creation_data
                    (creation_id, community_id, namespace, data_key, username, display_name,
                     num_value, created_at, updated_at)
                    VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                    ON DUPLICATE KEY UPDATE {set_value},
                        display_name = VALUES(display_name), updated_at = VALUES(updated_at)""",
                vals,
            )
        else:
            set_value = ("num_value = MAX(num_value, excluded.num_value)" if keep_max
                         else "num_value = excluded.num_value")
            c.execute(
                f"""INSERT INTO creation_data
                    (creation_id, community_id, namespace, data_key, username, display_name,
                     num_value, created_at, updated_at)
                    VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                    ON CONFLICT (creation_id, community_id, namespace, data_key, username) DO UPDATE SET {set_value},
                        display_name = excluded.display_name, updated_at = excluded.updated_at""",
                vals,
            )
        conn.commit()


_SAVE_MAX_BYTES = 40_000
_SAVE_MAX_KEYS = 20


def save_record(*, creation_id: int, community_id: int, username: str, key: str, value: Any) -> Dict[str, Any]:
    """Per-player save slot (game saves / preferences). localStorage is blocked
    in the sandbox, so saving is brokered here. One row per (creation, key, user)."""
    k = _safe_save_key(key)
    payload = value if isinstance(value, str) else json.dumps(value)
    if len(payload.encode("utf-8")) > _SAVE_MAX_BYTES:
        raise ValueError("save_too_large")
    now = _now()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        # Best-effort per-user slot cap: only gate when this would be a NEW key.
        c.execute(
            f"""SELECT 1 FROM creation_data
                WHERE creation_id = {ph} AND community_id = {ph}
                  AND namespace = 'save' AND data_key = {ph} AND username = {ph}""",
            (creation_id, community_id, k, username),
        )
        if c.fetchone() is None:
            c.execute(
                f"""SELECT COUNT(*) FROM creation_data
                    WHERE creation_id = {ph} AND community_id = {ph}
                      AND namespace = 'save' AND username = {ph}""",
                (creation_id, community_id, username),
            )
            if int(_cell(c.fetchone(), 0) or 0) >= _SAVE_MAX_KEYS:
                raise ValueError("too_many_saves")
        # ATOMIC upsert (latest wins) — same race fix as _upsert_value.
        save_vals = (creation_id, community_id, k, username, payload, now, now)
        if USE_MYSQL:
            c.execute(
                f"""INSERT INTO creation_data
                    (creation_id, community_id, namespace, data_key, username, data_value, created_at, updated_at)
                    VALUES ({ph}, {ph}, 'save', {ph}, {ph}, {ph}, {ph}, {ph})
                    ON DUPLICATE KEY UPDATE data_value = VALUES(data_value), updated_at = VALUES(updated_at)""",
                save_vals,
            )
        else:
            c.execute(
                f"""INSERT INTO creation_data
                    (creation_id, community_id, namespace, data_key, username, data_value, created_at, updated_at)
                    VALUES ({ph}, {ph}, 'save', {ph}, {ph}, {ph}, {ph}, {ph})
                    ON CONFLICT (creation_id, community_id, namespace, data_key, username) DO UPDATE SET
                        data_value = excluded.data_value, updated_at = excluded.updated_at""",
                save_vals,
            )
        conn.commit()
    return {"success": True}


def load_record(creation_id: int, *, community_id: Optional[int] = None, username: str, key: str = "save") -> Dict[str, Any]:
    k = _safe_save_key(key)
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        if community_id is None:
            c.execute(
                f"""SELECT data_value FROM creation_data
                    WHERE creation_id = {ph} AND namespace = 'save' AND data_key = {ph} AND username = {ph}
                    ORDER BY updated_at DESC LIMIT 1""",
                (creation_id, k, username),
            )
        else:
            c.execute(
                f"""SELECT data_value FROM creation_data
                    WHERE creation_id = {ph} AND community_id = {ph}
                      AND namespace = 'save' AND data_key = {ph} AND username = {ph}""",
                (creation_id, community_id, k, username),
            )
        row = c.fetchone()
    raw = _cell(row, 0) if row else None
    value: Any = None
    if raw:
        try:
            value = json.loads(raw)
        except Exception:
            value = raw
    return {"success": True, "value": value}


_OPENVERSE_URL = "https://api.openverse.org/v1/images/"


def search_images(query: str, *, limit: int = 8) -> List[Dict[str, Any]]:
    """Real, freely-licensed photos for a query (keyless Openverse). Lets a
    creation pull actual web images (places, recommendations, etc.). Best-effort
    — returns [] on any failure; the route caches results to limit outbound calls.
    Returns [{url (display-ready thumbnail), full, title, creator, license}]."""
    q = re.sub(r"\s+", " ", (query or "").strip())[:120]
    if not q:
        return []
    n = max(1, min(int(limit or 8), 20))
    try:
        import requests
        resp = requests.get(
            _OPENVERSE_URL,
            params={"q": q, "page_size": n, "mature": "false"},
            headers={"User-Agent": "C-Point-Builder/1.0 (+https://c-point.co)"},
            timeout=8,
        )
        if resp.status_code != 200:
            return []
        data = resp.json()
    except Exception:
        logger.warning("builder: image search failed", exc_info=True)
        return []
    out: List[Dict[str, Any]] = []
    for r in (data.get("results") or [])[:n]:
        thumb = r.get("thumbnail") or r.get("url")
        if not thumb:
            continue
        out.append({
            "url": thumb,                       # display-ready (Openverse thumbnail proxy; hotlinkable)
            "full": r.get("url") or thumb,
            "title": (r.get("title") or "")[:140],
            "creator": (r.get("creator") or "")[:80],
            "license": r.get("license") or "",
        })
    return out


def get_leaderboard(creation_id: int, *, community_id: Optional[int] = None, key: str = "highscore", limit: int = 10,
                    username: Optional[str] = None) -> Dict[str, Any]:
    key = _safe_key(key)
    limit = max(1, min(int(limit or 10), _LEADERBOARD_MAX))
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        if community_id is None:
            c.execute(
                f"""SELECT display_name, num_value, username FROM creation_data
                    WHERE creation_id = {ph} AND namespace = 'score' AND data_key = {ph}
                    ORDER BY num_value DESC LIMIT {ph}""",
                (creation_id, key, limit),
            )
        else:
            c.execute(
                f"""SELECT display_name, num_value, username FROM creation_data
                    WHERE creation_id = {ph} AND community_id = {ph}
                      AND namespace = 'score' AND data_key = {ph}
                    ORDER BY num_value DESC LIMIT {ph}""",
                (creation_id, community_id, key, limit),
            )
        rows = c.fetchall() or []
    entries = [{"name": _cell(r, 0) or "Player", "value": _cell(r, 1), "rank": i + 1}
               for i, r in enumerate(rows)]
    mine = None
    if username:
        for i, r in enumerate(rows):
            if _cell(r, 2) == username:
                mine = {"value": _cell(r, 1), "rank": i + 1}
                break
    return {"entries": entries, "mine": mine}


def get_results(creation_id: int, *, community_id: Optional[int] = None, username: Optional[str] = None) -> Dict[str, Any]:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        if community_id is None:
            c.execute(
                f"""SELECT AVG(num_value), COUNT(*) FROM creation_data
                    WHERE creation_id = {ph} AND namespace = 'rating'""",
                (creation_id,),
            )
        else:
            c.execute(
                f"""SELECT AVG(num_value), COUNT(*) FROM creation_data
                    WHERE creation_id = {ph} AND community_id = {ph} AND namespace = 'rating'""",
                (creation_id, community_id),
            )
        agg = c.fetchone()
        mine = None
        if username:
            if community_id is None:
                c.execute(
                    f"""SELECT num_value FROM creation_data
                        WHERE creation_id = {ph} AND namespace = 'rating' AND username = {ph}
                        ORDER BY updated_at DESC LIMIT 1""",
                    (creation_id, username),
                )
            else:
                c.execute(
                    f"""SELECT num_value FROM creation_data
                        WHERE creation_id = {ph} AND community_id = {ph}
                          AND namespace = 'rating' AND username = {ph}""",
                    (creation_id, community_id, username),
                )
            row = c.fetchone()
            mine = _cell(row, 0) if row else None
    avg = _cell(agg, 0)
    count = _cell(agg, 1) or 0
    return {"average": round(float(avg), 2) if avg is not None else None,
            "count": int(count), "mine": mine}


def submit_score(*, creation_id: int, community_id: int, username: str, value: Any,
                 key: str = "highscore", display_name: Optional[str] = None) -> Dict[str, Any]:
    v = _clamp_score(value)
    if v is None:
        raise ValueError("invalid score")
    _upsert_value(creation_id=creation_id, community_id=community_id, namespace="score",
                  key=_safe_key(key), username=username,
                  value=v, display_name=_clean_display_name(display_name, username), keep_max=True)
    board = get_leaderboard(creation_id, community_id=community_id, key=key, username=username)
    return {"success": True, "best": (board["mine"] or {}).get("value", v),
            "rank": (board["mine"] or {}).get("rank"), "entries": board["entries"]}


def rate_creation(*, creation_id: int, community_id: int, username: str, value: Any,
                  display_name: Optional[str] = None) -> Dict[str, Any]:
    try:
        iv = int(value)
    except (TypeError, ValueError):
        raise ValueError("invalid rating")
    iv = max(1, min(iv, 5))
    _upsert_value(creation_id=creation_id, community_id=community_id, namespace="rating",
                  key="", username=username, value=float(iv),
                  display_name=_clean_display_name(display_name, username), keep_max=False)
    res = get_results(creation_id, community_id=community_id, username=username)
    return {"success": True, **res}


def record_play(creation_id: int) -> Dict[str, Any]:
    """Increment the total play count. Best-effort (never raises to the caller)."""
    ph = get_sql_placeholder()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(f"UPDATE creations SET play_count = play_count + 1 WHERE id = {ph}", (creation_id,))
            conn.commit()
            c.execute(f"SELECT play_count FROM creations WHERE id = {ph}", (creation_id,))
            row = c.fetchone()
        return {"plays": int(_cell(row, 0) or 0)}
    except Exception:
        logger.warning("builder: record_play failed", exc_info=True)
        return {"plays": 0}


def list_creations(username: str, *, limit: int = 50) -> List[Dict[str, Any]]:
    """The user's own creations (drafts + published), newest first, so they can
    return to unfinished work. Lightweight — no HTML (fetch that via get_creation)."""
    ph = get_sql_placeholder()
    limit = max(1, min(int(limit or 50), 100))
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""SELECT id, title, kind, status, community_id, published_post_id,
                       updated_at, play_count, public_slug, public_status,
                       public_published_at, public_kind, gallery_status,
                       gallery_requested_at, gallery_reviewed_at, gallery_rejection_reason
                FROM creations WHERE created_by = {ph}
                ORDER BY updated_at DESC LIMIT {ph}""",
            (username, limit),
        )
        rows = c.fetchall() or []
        creation_ids = [int(_cell(r, 0)) for r in rows if _cell(r, 0) is not None]
        shares_by_creation: Dict[int, List[int]] = {cid: [] for cid in creation_ids}
        if creation_ids:
            placeholders = ",".join([ph] * len(creation_ids))
            c.execute(
                f"""SELECT creation_id, community_id
                    FROM creation_shares
                    WHERE creation_id IN ({placeholders})""",
                tuple(creation_ids),
            )
            for share_row in c.fetchall() or []:
                crid = int(_cell(share_row, 0) or 0)
                cid = int(_cell(share_row, 1) or 0)
                if crid and cid:
                    shares_by_creation.setdefault(crid, []).append(cid)
    return [{
        "id": _cell(r, 0), "title": _cell(r, 1), "kind": _cell(r, 2), "status": _cell(r, 3),
        "community_id": _cell(r, 4), "published_post_id": _cell(r, 5),
        "updated_at": str(_cell(r, 6)) if _cell(r, 6) is not None else None,
        "plays": int(_cell(r, 7) or 0),
        "public_slug": _cell(r, 8),
        "public_status": _cell(r, 9),
        "public_url": public_build_url(str(_cell(r, 8))) if _cell(r, 8) else None,
        "public_published_at": str(_cell(r, 10)) if _cell(r, 10) is not None else None,
        "public_kind": _cell(r, 11),
        "gallery_status": _cell(r, 12) or "not_listed",
        "gallery_requested_at": str(_cell(r, 13)) if _cell(r, 13) is not None else None,
        "gallery_reviewed_at": str(_cell(r, 14)) if _cell(r, 14) is not None else None,
        "gallery_rejection_reason": _cell(r, 15),
        "shared_community_ids": sorted(set(shares_by_creation.get(int(_cell(r, 0) or 0), []))),
    } for r in rows]


def get_chat_history(creation_id: int) -> Optional[List[Dict[str, Any]]]:
    """The stored design conversation for a creation (list of {role, text, creation_id?})."""
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT chat_history FROM creations WHERE id = {ph}", (creation_id,))
        row = c.fetchone()
    raw = _cell(row, 0) if row else None
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else None
    except Exception:
        return None


def save_chat_history(*, creation_id: int, username: str, messages: List[Dict[str, Any]]) -> bool:
    """Persist the design conversation (owner-scoped) so the user can resume it.
    Stores a lean list of {role, text, creation_id?} — never the artifact HTML."""
    lean: List[Dict[str, Any]] = []
    for m in (messages or [])[-200:]:
        if not isinstance(m, dict):
            continue
        item: Dict[str, Any] = {
            "role": "user" if m.get("role") == "user" else "steve",
            "text": str(m.get("text") or "")[:8000],
        }
        cidv = m.get("creation_id", m.get("creationId"))
        if cidv is not None:
            try:
                item["creation_id"] = int(cidv)
            except (TypeError, ValueError):
                pass
        lean.append(item)
    payload = json.dumps(lean)[:600_000]
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"UPDATE creations SET chat_history = {ph}, updated_at = {ph} WHERE id = {ph} AND created_by = {ph}",
            (payload, _now(), creation_id, username),
        )
        conn.commit()
        return (c.rowcount or 0) > 0


def get_summary(creation_id: int, *, community_id: Optional[int] = None) -> Dict[str, Any]:
    """Aggregate stats for the feed card strip: plays, top score, rating."""
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT play_count FROM creations WHERE id = {ph}", (creation_id,))
        prow = c.fetchone()
        if community_id is None:
            c.execute(
                f"""SELECT MAX(num_value) FROM creation_data
                    WHERE creation_id = {ph} AND namespace = 'score' AND data_key = 'highscore'""",
                (creation_id,),
            )
        else:
            c.execute(
                f"""SELECT MAX(num_value) FROM creation_data
                    WHERE creation_id = {ph} AND community_id = {ph}
                      AND namespace = 'score' AND data_key = 'highscore'""",
                (creation_id, community_id),
            )
        top = c.fetchone()
        if community_id is None:
            c.execute(
                f"""SELECT AVG(num_value), COUNT(*) FROM creation_data
                    WHERE creation_id = {ph} AND namespace = 'rating'""",
                (creation_id,),
            )
        else:
            c.execute(
                f"""SELECT AVG(num_value), COUNT(*) FROM creation_data
                    WHERE creation_id = {ph} AND community_id = {ph} AND namespace = 'rating'""",
                (creation_id, community_id),
            )
        ragg = c.fetchone()
    avg = _cell(ragg, 0)
    return {
        "plays": int(_cell(prow, 0) or 0),
        "top_score": _cell(top, 0),
        "rating_avg": round(float(avg), 1) if avg is not None else None,
        "rating_count": int(_cell(ragg, 1) or 0),
    }
