"""Aggregate community + group-chat activity for a user (excludes private DMs).

Used by the authenticated API and by Steve DM’s platform digest flow.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from backend.services.content_generation.llm import GROK_MODEL_FAST, XAI_API_KEY
from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

VALID_WINDOW_HOURS = frozenset({24, 72, 120, 168})

_PLATFORM_DIGEST_INTENT = re.compile(
    r"(?is)"
    r"(?:"
    r"(?:^|\b)(?:activity\s+digest|digest\s+of\s+(?:the\s+)?(?:platform|communities))"
    r"|(?:^|\b)platform\s+activity\b"
    r"|(?:catch\s+me\s+up|bring\s+me\s+up\s+to\s+speed)\s+(?:on\s+)?(?:the\s+)?(?:platform|communities|groups?|group\s+chats?)"
    r"|(?:what(?:'s|s)\s+been\s+happening|what\s+happened)\s+(?:on\s+the\s+)?(?:platform|(?:in\s+)?my\s+communities|communities)"
    r"|summar(?:y|ize)\s+(?:of\s+)?(?:recent\s+)?(?:community|communities|group)\s+(?:activity|chats?)"
    r")"
)

_WINDOW_PATTERNS: List[Tuple[int, re.Pattern[str]]] = [
    (168, re.compile(r"(?:past|last|past\s+)?\s*7\b\s*(?:day|days)\b|\bpast\s+week\b|\blast\s+week\b")),
    (
        120,
        re.compile(
            r"\b(?:last|past)\s+5\b\s*(?:day|days)\b|\bfive\b\s+(?:past\s+)?days\b",
            re.I,
        ),
    ),
    (72, re.compile(r"\b(?:last|past)\s+3\b\s*(?:day|days)\b|\bthree\b\s+(?:past\s+)?days\b|\blatest\s+3\s+days\b", re.I)),
    (24, re.compile(r"\b(?:last|past)\s+24\b\s*h(?:rs?|ours?)?\b|\b24[\s\-]*hours?\b")),
]


def _snippet(text: Any, *, limit: int = 200) -> str:
    raw = "" if text is None else str(text).strip()
    raw = " ".join(raw.split())
    if len(raw) > limit:
        return raw[: limit - 1].rstrip() + "…"
    return raw


def coerce_window_hours(raw: Optional[int]) -> Optional[int]:
    if raw is None:
        return None
    try:
        h = int(raw)
    except (TypeError, ValueError):
        return None
    return h if h in VALID_WINDOW_HOURS else None


def parse_digest_window_hours_from_message(message: str) -> int:
    """Choose 24 / 72 / 120 / 168 from phrases like “last 3 days”; default ``24``."""
    s = (message or "").lower()
    if not s.strip():
        return 24
    for hrs, patt in _WINDOW_PATTERNS:
        if patt.search(s):
            return hrs
    return 24


def message_looks_like_platform_digest_intent(message: str) -> bool:
    m = (message or "").strip()
    return bool(m) and len(m) >= 12 and bool(_PLATFORM_DIGEST_INTENT.search(m))


def build_platform_activity_digest(username: str, window_hours: int) -> Dict[str, Any]:
    """Return structured activity for Grok narration (never calls an LLM)."""
    uh = coerce_window_hours(window_hours) or 24
    cutoff = datetime.now(timezone.utc) - timedelta(hours=uh)

    communities: List[Dict[str, Any]] = []
    group_chats: List[Dict[str, Any]] = []

    ph = get_sql_placeholder()
    uh_s = str(int(uh))

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(f"SELECT id FROM users WHERE username = {ph} LIMIT 1", (username,))
            ur = c.fetchone()
            if not ur:
                return {
                    "window_hours": uh,
                    "cutoff_iso_utc": cutoff.isoformat(),
                    "communities": [],
                    "group_chats": [],
                }
            uid = int(ur["id"] if hasattr(ur, "keys") else ur[0])

            if USE_MYSQL:
                c.execute(
                    f"""
                    SELECT c.id AS community_id, c.name AS community_name, COUNT(p.id) AS post_count
                    FROM posts p
                    INNER JOIN communities c ON c.id = p.community_id
                    INNER JOIN user_communities uc ON uc.community_id = c.id AND uc.user_id = {ph}
                    WHERE p.timestamp >= (UTC_TIMESTAMP() - INTERVAL {ph} HOUR)
                    GROUP BY c.id, c.name
                    HAVING post_count > 0
                    ORDER BY post_count DESC, c.name ASC
                    LIMIT 40
                    """,
                    (uid, uh),
                )
            else:
                c.execute(
                    f"""
                    SELECT c.id AS community_id, c.name AS community_name, COUNT(p.id) AS post_count
                    FROM posts p
                    INNER JOIN communities c ON c.id = p.community_id
                    INNER JOIN user_communities uc ON uc.community_id = c.id AND uc.user_id = {ph}
                    WHERE datetime(p.timestamp) >= datetime('now', '-' || {ph} || ' hours')
                    GROUP BY c.id, c.name
                    HAVING post_count > 0
                    ORDER BY post_count DESC, c.name ASC
                    LIMIT 40
                    """,
                    (uid, uh_s),
                )

            comm_rows = c.fetchall() or []
            comm_ids: List[int] = []
            for row in comm_rows:
                cid = int(row["community_id"] if hasattr(row, "keys") else row[0])
                comm_ids.append(cid)
                name = row["community_name"] if hasattr(row, "keys") else row[1]
                pc = int(row["post_count"] if hasattr(row, "keys") else row[2])
                communities.append(
                    {
                        "community_id": cid,
                        "name": (name or "") or f"Community {cid}",
                        "post_count": pc,
                        "feed_path": f"/community_feed_react/{cid}",
                        "recent_snippets": [],
                    }
                )

            if comm_ids:
                placeholders = ",".join(ph for _ in comm_ids)
                if USE_MYSQL:
                    c.execute(
                        f"""
                        SELECT p.community_id, SUBSTR(p.content, 1, 400) AS snippet
                        FROM posts p
                        WHERE p.community_id IN ({placeholders})
                          AND p.timestamp >= (UTC_TIMESTAMP() - INTERVAL {ph} HOUR)
                        ORDER BY p.timestamp DESC
                        LIMIT 120
                        """,
                        (*comm_ids, uh),
                    )
                else:
                    c.execute(
                        f"""
                        SELECT p.community_id, SUBSTR(p.content, 1, 400) AS snippet
                        FROM posts p
                        WHERE p.community_id IN ({placeholders})
                          AND datetime(p.timestamp) >= datetime('now', '-' || {ph} || ' hours')
                        ORDER BY p.timestamp DESC
                        LIMIT 120
                        """,
                        (*comm_ids, uh_s),
                    )
                per_comm: Dict[int, int] = {}
                for row in c.fetchall() or []:
                    cid = int(row["community_id"] if hasattr(row, "keys") else row[0])
                    sn = row["snippet"] if hasattr(row, "keys") else row[1]
                    taken = per_comm.get(cid, 0)
                    if taken >= 2:
                        continue
                    for block in communities:
                        if block["community_id"] == cid:
                            block["recent_snippets"].append(_snippet(sn))
                            per_comm[cid] = taken + 1
                            break

            if USE_MYSQL:
                c.execute(
                    f"""
                    SELECT g.id, g.name AS group_name, mc.msg_count,
                           lm.created_at AS last_message_at, lm.message_text AS last_snippet
                    FROM group_chats g
                    INNER JOIN group_chat_members gm ON gm.group_id = g.id AND gm.username = {ph}
                    INNER JOIN (
                        SELECT m.group_id, COUNT(*) AS msg_count, MAX(m.id) AS max_id_window
                        FROM group_chat_messages m
                        WHERE m.created_at >= (UTC_TIMESTAMP() - INTERVAL {ph} HOUR)
                        GROUP BY m.group_id
                    ) mc ON mc.group_id = g.id
                    INNER JOIN group_chat_messages lm ON lm.id = mc.max_id_window
                    ORDER BY lm.created_at DESC
                    LIMIT 40
                    """,
                    (username, uh),
                )
            else:
                c.execute(
                    f"""
                    SELECT g.id, g.name AS group_name, mc.msg_count,
                           lm.created_at AS last_message_at, lm.message_text AS last_snippet
                    FROM group_chats g
                    INNER JOIN group_chat_members gm ON gm.group_id = g.id AND gm.username = {ph}
                    INNER JOIN (
                        SELECT m.group_id, COUNT(*) AS msg_count, MAX(m.id) AS max_id_window
                        FROM group_chat_messages m
                        WHERE datetime(m.created_at) >= datetime('now', '-' || {ph} || ' hours')
                        GROUP BY m.group_id
                    ) mc ON mc.group_id = g.id
                    INNER JOIN group_chat_messages lm ON lm.id = mc.max_id_window
                    ORDER BY lm.created_at DESC
                    LIMIT 40
                    """,
                    (username, uh_s),
                )

            for row in c.fetchall() or []:
                gid = int(row["id"] if hasattr(row, "keys") else row[0])
                gnm = row["group_name"] if hasattr(row, "keys") else row[1]
                mc = int(row["msg_count"] if hasattr(row, "keys") else row[2])
                last_ts = row["last_message_at"] if hasattr(row, "keys") else row[3]
                lsnip = row["last_snippet"] if hasattr(row, "keys") else row[4]
                group_chats.append(
                    {
                        "group_id": gid,
                        "name": (gnm or "") or f"Group chat {gid}",
                        "message_count": mc,
                        "last_activity": str(last_ts) if last_ts is not None else "",
                        "last_snippet": _snippet(lsnip),
                        "chat_path": f"/group_chat/{gid}",
                    }
                )

    except Exception:
        logger.exception("build_platform_activity_digest failed for user=%s", username)
        return {
            "window_hours": uh,
            "cutoff_iso_utc": cutoff.isoformat(),
            "communities": [],
            "group_chats": [],
            "error": "aggregation_failed",
        }

    return {
        "window_hours": uh,
        "cutoff_iso_utc": cutoff.isoformat(),
        "username": username,
        "communities": communities,
        "group_chats": group_chats,
    }


def _grok_narrate_digest(payload: Dict[str, Any], *, username: str) -> Tuple[Optional[str], Optional[int], Optional[int]]:
    """Return (body, tokens_in, tokens_out) or (None, None, None) on failure."""
    if not XAI_API_KEY:
        return None, None, None
    from openai import OpenAI

    client = OpenAI(api_key=XAI_API_KEY, base_url="https://api.x.ai/v1")
    system = (
        "You are Steve, a real person on C-Point — warm, direct, never stiff. "
        "The user asked for a quick sense of what’s been going on in their communities and group chats. "
        "You will get JSON facts only; turn them into a short, natural reply (a few short paragraphs or loose bullets). "
        "No dashboard tone, no labels like 'Post count:' or 'Summary:'. "
        "Mention community and group names in passing; weave in the given path links as plain paths (they open in the app). "
        "If a snippet is empty or thin, don’t invent drama — stay grounded in the data. "
        "If there’s almost nothing, say it in a friendly, human way (quiet spell, not a report). "
        "Do not use markdown headings. Match the user’s language if it’s clearly not English."
    )
    user_blob = json.dumps(payload, ensure_ascii=False, indent=2)
    try:
        completion = client.chat.completions.create(
            model=GROK_MODEL_FAST,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": f"Member username: {username}\n\nFacts JSON:\n{user_blob}"},
            ],
            temperature=0.55,
            max_tokens=900,
        )
        text = (completion.choices[0].message.content or "").strip() if completion.choices else ""
        usage = getattr(completion, "usage", None)
        tin = getattr(usage, "prompt_tokens", None) if usage else None
        tout = getattr(usage, "completion_tokens", None) if usage else None
        return (text or None), tin, tout
    except Exception as exc:
        logger.warning("platform digest Grok failed: %s", exc)
        return None, None, None


def try_handle_platform_activity_digest_dm(
    *,
    sender_username: str,
    user_message: str,
) -> Optional[str]:
    """If this is a digest request, return Steve’s reply body; else ``None``."""
    if not message_looks_like_platform_digest_intent(user_message):
        return None
    from backend.services import ai_usage
    from backend.services.content_generation.llm import GROK_MODEL_FAST as _model

    wh = parse_digest_window_hours_from_message(user_message)
    payload = build_platform_activity_digest(sender_username, wh)
    body, tin, tout = _grok_narrate_digest(payload, username=sender_username)
    if body:
        try:
            ai_usage.log_usage(
                sender_username,
                surface=ai_usage.SURFACE_DM,
                request_type="platform_activity_digest",
                model=_model,
                tokens_in=tin,
                tokens_out=tout,
            )
        except Exception:
            pass
        return body
    n_comm = len(payload.get("communities") or [])
    n_grp = len(payload.get("group_chats") or [])
    if n_comm == 0 and n_grp == 0:
        return (
            "Honestly? It’s been pretty quiet in your communities and group chats over that stretch — "
            "nothing much jumped out. If you want a longer window, say **last 3 days** or **past week**."
        )
    return (
        "I pulled the numbers, but I couldn’t quite put it into words just now. "
        "Try again in a moment — or ask for a shorter time window."
    )
