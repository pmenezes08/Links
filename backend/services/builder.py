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
from datetime import datetime
from typing import Any, Dict, List, Optional

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
# Output ceiling. Kept well above what a rich single-file artifact needs so the
# 400KB byte limit (not the token budget) is the real ceiling — a low ceiling
# silently truncates ambitious builds mid-document (and truncation often does
# NOT throw, so the client error net never sees it).
_CODEGEN_MAX_TOKENS = 64000

_SYSTEM_PROMPT = (
    "You are Steve, a world-class creative front-end engineer and game designer. Build a single self-contained web "
    "creation a community will want to PLAY and SHARE — something that makes someone go 'whoa, you made this?'. "
    "Aim for genuine polish and delight; never ship something that feels like a basic demo. "
    "Return ONE complete HTML document and nothing else — no explanation, no commentary, no markdown fences. "
    "Everything inline in a single `<!doctype html>` file (inline `<style>` and `<script>`).\n"
    "MAKE IT FEEL ALIVE AND SATISFYING — every creation MUST have:\n"
    "- JUICE: nothing snaps — animate with easing; scale-pop elements on success; burst particles/confetti on rewards; "
    "screenshake on big moments; count numbers up instead of jumping.\n"
    "- SOUND: generate audio procedurally (Tone.js or the Web Audio API — no audio files): a soft tap sound on every "
    "interaction plus success/fail cues; include a sound on/off toggle.\n"
    "- MOTION: fade or slide between screens (never hard-cut); animate entrances.\n"
    "- ART DIRECTION: a deliberate 2-3 colour palette plus one accent; a display font from Google Fonts; a living "
    "background (animated gradient or drifting particles); generous radius and spacing; use emoji/SVG/canvas as art.\n"
    "- A SATISFYING ENDING: a results/score screen with a count-up, a celebratory confetti moment, a 'Play again' button, "
    "and a 'Share' affordance.\n"
    "REACH FOR THE RIGHT LIBRARY instead of hand-rolling (load a pinned version from cdnjs.cloudflare.com, "
    "cdn.jsdelivr.net or unpkg.com; degrade gracefully if it fails to load): kaboom.js or Phaser for games, p5.js for "
    "generative visuals, three.js for 3D, anime.js for motion, Tone.js for sound, canvas-confetti for celebration.\n"
    "Aim for this bar: a juicy one-thumb arcade game with particles + sound + screenshake; a screenshot-worthy "
    "personality quiz with animated cards and a designed result; a physical-feeling spin-the-wheel; a beautiful "
    "generative-art toy. Surprise people.\n"
    "TECHNICAL REQUIREMENTS (all MUST hold):\n"
    "1) Front-end only: no backend, no database, no fetch/XHR/websocket to anything except the allowed CDNs above and "
    "fonts.googleapis.com / fonts.gstatic.com. Runs inside a sandboxed iframe with no access to cookies or storage.\n"
    "2) Include <meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">.\n"
    "3) MOBILE-FIRST: fully responsive, fit a ~390px-wide phone screen with NO horizontal scrolling; use relative units "
    "(%, vw, vh, flexbox, clamp()); never hard-code widths wider than the screen; scale boards/canvases to the width.\n"
    "4) TOUCH-ONLY (no physical keyboard): clearly visible on-screen buttons for ALL controls; anything that needs "
    "starting begins on a tap/touch (on-screen Start or auto-start) — never 'press a key to start'.\n"
    "5) Dark background; no analytics, ads, tracking, or login; keep the document under 400KB.\n"
    "6) Set a short, catchy, human-friendly <title> that NAMES the creation (e.g. \"Neon Block Drop\", "
    "\"Which Pizza Are You?\") — never \"Document\", \"Untitled\", or a copy of the user's prompt.\n"
    "COMMUNITY DATA (optional — use ONLY when the creation has a score, a result, or something worth rating, "
    "e.g. a game high score or a quiz): a `window.CPoint` API may exist at runtime for community-shared data. "
    "ALWAYS feature-detect (`if (window.CPoint) { ... }`) and work fully without it (degrade to local-only). "
    "It returns Promises: `CPoint.submitScore(n)` saves the player's score; `CPoint.getLeaderboard()` -> "
    "`{entries:[{name,value,rank}], mine}` for a top-scores list; `CPoint.rate(1..5)` and `CPoint.getResults()` -> "
    "`{average,count,mine}` for ratings. For a score-based game, call `submitScore` on game over and render the "
    "returned leaderboard on the result screen. Never block gameplay on it; wrap calls in try/catch."
)

_CREATION_COLS = [
    "id", "community_id", "created_by", "title", "kind", "html_content",
    "prompt_history", "parent_creation_id", "status", "published_post_id",
    "created_at", "updated_at",
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
                    community_id INT NOT NULL,
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
                    community_id INTEGER NOT NULL,
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
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    UNIQUE KEY uq_creation_data (creation_id, namespace, data_key, username),
                    INDEX idx_creation_data_board (creation_id, namespace, num_value),
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
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE (creation_id, namespace, data_key, username)
                )
                """
            )
            for stmt in (
                "CREATE INDEX IF NOT EXISTS idx_creation_data_board ON creation_data (creation_id, namespace, num_value)",
                "CREATE INDEX IF NOT EXISTS idx_creation_data_community ON creation_data (community_id, namespace)",
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


def _append_history(prior_json: Optional[str], message: str) -> str:
    try:
        history = json.loads(prior_json) if prior_json else []
        if not isinstance(history, list):
            history = []
    except Exception:
        history = []
    history.append({"role": "user", "content": message})
    return json.dumps(history[-40:])


def generate_artifact(prompt: str, *, prior_html: Optional[str] = None, temperature: float = 0.8,
                     model: Optional[str] = None) -> str:
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
    return html


def _generate_with_fallback(prompt: str, *, prior_html: Optional[str] = None,
                           temperature: float, model: str) -> tuple:
    """Generate via ``model``; if a non-fast model (e.g. OpenAI 'best') errors,
    fall back to the fast model so a build never hard-fails. Returns
    ``(html, model_actually_used)``."""
    try:
        return generate_artifact(prompt, prior_html=prior_html, temperature=temperature, model=model), model
    except Exception:
        if model != _MODEL_FAST:
            logger.warning("builder: model %s failed; falling back to %s", model, _MODEL_FAST)
            return (generate_artifact(prompt, prior_html=prior_html, temperature=temperature, model=_MODEL_FAST),
                    _MODEL_FAST)
        raise


def create_creation(*, username: str, community_id: int, prompt: str,
                    title: Optional[str] = None, tier: str = "fast") -> Dict[str, Any]:
    """Generate a first artifact from ``prompt`` and persist it as a draft."""
    html, model_used = _generate_with_fallback(prompt, temperature=0.8, model=resolve_model(tier))
    resolved_title = (title or _extract_title(html, prompt))[:200]
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
            (community_id, username, resolved_title, "web", html,
             history, "draft", now, now),
        )
        creation_id = c.lastrowid
        conn.commit()
    return {"id": creation_id, "title": resolved_title, "html": html, "status": "draft", "model": model_used}


def get_creation(creation_id: int) -> Optional[Dict[str, Any]]:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT id, community_id, created_by, title, kind, html_content,
                   prompt_history, parent_creation_id, status, published_post_id,
                   created_at, updated_at
            FROM creations WHERE id = {ph}
            """,
            (creation_id,),
        )
        row = c.fetchone()
    return _row_to_dict(row) if row else None


def iterate_creation(*, creation_id: int, username: str, message: str, tier: str = "fast") -> Dict[str, Any]:
    """Revise an existing creation with a follow-up instruction (full-file regen)."""
    row = get_creation(creation_id)
    if not row or row.get("created_by") != username:
        raise PermissionError("creation not found")
    html, model_used = _generate_with_fallback(
        message, prior_html=row.get("html_content"), temperature=0.2, model=resolve_model(tier))
    history = _append_history(row.get("prompt_history"), message)
    now = _now()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"UPDATE creations SET html_content = {ph}, prompt_history = {ph}, updated_at = {ph} WHERE id = {ph}",
            (html, history, now, creation_id),
        )
        conn.commit()
    return {"id": creation_id, "title": row.get("title"), "html": html, "status": row.get("status"), "model": model_used}


def publish_creation(*, creation_id: int, username: str,
                    caption: Optional[str] = None) -> Dict[str, Any]:
    """Create a community post that references the creation (publish = post)."""
    row = get_creation(creation_id)
    if not row or row.get("created_by") != username:
        raise PermissionError("creation not found")
    if row.get("published_post_id"):
        return {"post_id": row["published_post_id"], "already_published": True}
    content = (caption or row.get("title") or "Check out what I built").strip()
    now = _now()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO posts (username, content, timestamp, community_id, creation_id) "
            f"VALUES ({ph}, {ph}, {ph}, {ph}, {ph})",
            (username, content, now, row["community_id"], creation_id),
        )
        post_id = c.lastrowid
        c.execute(
            f"UPDATE creations SET status = 'published', published_post_id = {ph}, updated_at = {ph} WHERE id = {ph}",
            (post_id, now, creation_id),
        )
        conn.commit()
    return {"post_id": post_id, "already_published": False}


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
    k = key.strip().lower() if isinstance(key, str) else ""
    return k if _KEY_RE.match(k) else "highscore"


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
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""SELECT num_value FROM creation_data
                WHERE creation_id = {ph} AND namespace = {ph} AND data_key = {ph} AND username = {ph}""",
            (creation_id, namespace, key, username),
        )
        existing = c.fetchone()
        if existing is None:
            c.execute(
                f"""INSERT INTO creation_data
                    (creation_id, community_id, namespace, data_key, username, display_name,
                     num_value, created_at, updated_at)
                    VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})""",
                (creation_id, community_id, namespace, key, username, display_name, value, now, now),
            )
        else:
            prev = _cell(existing, 0)
            new_value = max(float(prev), value) if (keep_max and prev is not None) else value
            c.execute(
                f"""UPDATE creation_data SET num_value = {ph}, display_name = {ph}, updated_at = {ph}
                    WHERE creation_id = {ph} AND namespace = {ph} AND data_key = {ph} AND username = {ph}""",
                (new_value, display_name, now, creation_id, namespace, key, username),
            )
        conn.commit()


def get_leaderboard(creation_id: int, *, key: str = "highscore", limit: int = 10,
                    username: Optional[str] = None) -> Dict[str, Any]:
    key = _safe_key(key)
    limit = max(1, min(int(limit or 10), _LEADERBOARD_MAX))
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""SELECT display_name, num_value, username FROM creation_data
                WHERE creation_id = {ph} AND namespace = 'score' AND data_key = {ph}
                ORDER BY num_value DESC LIMIT {ph}""",
            (creation_id, key, limit),
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


def get_results(creation_id: int, *, username: Optional[str] = None) -> Dict[str, Any]:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""SELECT AVG(num_value), COUNT(*) FROM creation_data
                WHERE creation_id = {ph} AND namespace = 'rating'""",
            (creation_id,),
        )
        agg = c.fetchone()
        mine = None
        if username:
            c.execute(
                f"""SELECT num_value FROM creation_data
                    WHERE creation_id = {ph} AND namespace = 'rating' AND username = {ph}""",
                (creation_id, username),
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
    board = get_leaderboard(creation_id, key=key, username=username)
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
    res = get_results(creation_id, username=username)
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


def get_summary(creation_id: int) -> Dict[str, Any]:
    """Aggregate stats for the feed card strip: plays, top score, rating."""
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT play_count FROM creations WHERE id = {ph}", (creation_id,))
        prow = c.fetchone()
        c.execute(
            f"""SELECT MAX(num_value) FROM creation_data
                WHERE creation_id = {ph} AND namespace = 'score' AND data_key = 'highscore'""",
            (creation_id,),
        )
        top = c.fetchone()
        c.execute(
            f"""SELECT AVG(num_value), COUNT(*) FROM creation_data
                WHERE creation_id = {ph} AND namespace = 'rating'""",
            (creation_id,),
        )
        ragg = c.fetchone()
    avg = _cell(ragg, 0)
    return {
        "plays": int(_cell(prow, 0) or 0),
        "top_score": _cell(top, 0),
        "rating_avg": round(float(avg), 1) if avg is not None else None,
        "rating_count": int(_cell(ragg, 1) or 0),
    }
