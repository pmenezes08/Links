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

# Codegen quality depends heavily on the model. Default to a *reasoning* Grok
# model (the fast non-reasoning content model produces poor code). Override
# via STEVE_BUILDER_MODEL to A/B a different model without touching other
# Steve surfaces.
BUILDER_MODEL = os.getenv("STEVE_BUILDER_MODEL", "grok-4.3")
MODEL_LABEL = BUILDER_MODEL
MAX_HTML_BYTES = 400_000  # reject pathologically large artifacts
_CODEGEN_MAX_TOKENS = 32000

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
    "5) Dark background; no analytics, ads, tracking, or login; keep the document under 400KB."
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


def generate_artifact(prompt: str, *, prior_html: Optional[str] = None, temperature: float = 0.8) -> str:
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
            model=BUILDER_MODEL,
        )
    )
    if not html:
        raise ValueError("Steve returned an empty artifact")
    if len(html.encode("utf-8")) > MAX_HTML_BYTES:
        raise ValueError("Generated artifact exceeds size limit")
    return html


def create_creation(*, username: str, community_id: int, prompt: str,
                    title: Optional[str] = None) -> Dict[str, Any]:
    """Generate a first artifact from ``prompt`` and persist it as a draft."""
    html = generate_artifact(prompt)
    resolved_title = (title or _derive_title(prompt))[:200]
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
    return {"id": creation_id, "title": resolved_title, "html": html, "status": "draft"}


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


def iterate_creation(*, creation_id: int, username: str, message: str) -> Dict[str, Any]:
    """Revise an existing creation with a follow-up instruction (full-file regen)."""
    row = get_creation(creation_id)
    if not row or row.get("created_by") != username:
        raise PermissionError("creation not found")
    html = generate_artifact(message, prior_html=row.get("html_content"), temperature=0.2)
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
    return {"id": creation_id, "title": row.get("title"), "html": html, "status": row.get("status")}


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
