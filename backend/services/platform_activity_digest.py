"""Aggregate community + group-chat activity for a user (excludes private DMs).

Used by the authenticated API and by Steve DM’s platform digest flow.
"""

from __future__ import annotations

import json
import logging
import os
import re
from collections import defaultdict
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

MAX_POSTS_PER_COMMUNITY = 6
MAX_GROUP_MESSAGES_TRANSCRIPT = 24


def _snippet(text: Any, *, limit: int = 400) -> str:
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


def _digest_message_has_time_window(message: str) -> bool:
    """True if typical “last / past / N hours / days” phrasing matches."""
    s = (message or "").lower()
    if not s.strip():
        return False
    return any(p.search(s) for _, p in _WINDOW_PATTERNS)


def message_looks_like_platform_digest_intent(message: str) -> bool:
    """True when user wants the SQL-backed activity snapshot (same pipeline as `/api/me/platform-activity-digest`)."""
    m = (message or "").strip()
    if not m or len(m) < 12:
        return False
    if _PLATFORM_DIGEST_INTENT.search(m):
        return True
    low = m.lower()

    if re.search(r"\b(?:give\s+me\s+a\s+)?(?:quick\s+)?rundown\b", low):
        if _digest_message_has_time_window(m) or re.search(
            r"\b(?:platform|communit|groups?|group\s+chats?|activity|c-point|app\.c-point)\b",
            low,
        ):
            return True

    if _digest_message_has_time_window(m) and re.search(
        r"\b(?:here|on\s+(?:the\s+)?platform|on\s+c-point|in\s+my\s+communities|c-point)\b",
        low,
    ):
        if re.search(
            r"\b(?:what|anything|happening|happened|rundown|catch|missed|summary|recap|activity|communities|groups?)\b",
            low,
        ):
            return True

    return False


def _digest_app_base_url() -> str:
    return (os.environ.get("PUBLIC_BASE_URL") or "").strip().rstrip("/") or "https://app.c-point.co"


def _feed_path(community_id: int) -> str:
    return f"/community_feed_react/{community_id}"


def _group_path(group_id: int) -> str:
    return f"/group_chat/{group_id}"


def _https_feed_url(community_id: int) -> str:
    return f"{_digest_app_base_url()}{_feed_path(community_id)}"


def _https_group_chat_url(group_id: int) -> str:
    return f"{_digest_app_base_url()}{_group_path(group_id)}"


def _parse_ts_utc(val: Any) -> Optional[datetime]:
    if val is None:
        return None
    if isinstance(val, datetime):
        if val.tzinfo is None:
            return val.replace(tzinfo=timezone.utc)
        return val.astimezone(timezone.utc)
    s = str(val).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def format_digest_last_activity_label(ts_val: Any, *, now_utc: Optional[datetime] = None) -> str:
    """Date-only for past days; today uses minutes or hours ago."""
    now_utc = now_utc or datetime.now(timezone.utc)
    dt = _parse_ts_utc(ts_val)
    if not dt:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    cal_today = now_utc.date()
    cal_msg = dt.date()
    if cal_msg < cal_today:
        return dt.strftime("%b %d, %Y")
    delta = now_utc - dt
    sec = max(0, int(delta.total_seconds()))
    if sec < 3600:
        m = max(1, sec // 60)
        return f"{m} min ago"
    if sec < 86400:
        h = max(1, sec // 3600)
        return f"{h} hour{'s' if h != 1 else ''} ago"
    return dt.strftime("%b %d, %Y")


def _digest_opener_line(window_hours: int) -> str:
    uh = coerce_window_hours(window_hours) or 24
    if uh == 24:
        span = "the past **24 hours**"
    elif uh == 72:
        span = "the past **3 days**"
    elif uh == 120:
        span = "the past **5 days**"
    else:
        span = "the past **7 days**"
    return (
        f"Here’s your **activity snapshot** over {span} — from communities and group chats "
        "you’re in (**excluding your own posts/messages**; **no private DMs** counted).\n\n"
    )


def _digest_markdown_preserves_required_paths(text: str, payload: Dict[str, Any]) -> bool:
    """Every feed/group path from aggregation must appear verbatim."""
    for comm in payload.get("communities") or []:
        p = (comm.get("feed_path") or "").strip()
        if p and p not in (text or ""):
            return False
    for gc in payload.get("group_chats") or []:
        p = (gc.get("chat_path") or "").strip()
        if p and p not in (text or ""):
            return False
    return True


def _ts_face(val: Any) -> str:
    if val is None:
        return ""
    if hasattr(val, "isoformat"):
        try:
            return val.isoformat()
        except Exception:
            pass
    return str(val)


def _author_label_from_row(username: str, author_label: Any) -> str:
    u = (username or "").strip() or "member"
    lab = (str(author_label).strip() if author_label is not None else "") or ""
    return lab if lab else f"@{u}"


def build_platform_activity_digest(username: str, window_hours: int) -> Dict[str, Any]:
    """Return structured activity for digest LLM narration (never calls an LLM)."""
    uh = coerce_window_hours(window_hours) or 24
    cutoff = datetime.now(timezone.utc) - timedelta(hours=uh)
    now_utc = datetime.now(timezone.utc)

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
                    SELECT c.id AS community_id, c.name AS community_name,
                           COUNT(p.id) AS post_count_others,
                           MAX(p.timestamp) AS last_from_others_at
                    FROM posts p
                    INNER JOIN communities c ON c.id = p.community_id
                    INNER JOIN user_communities uc ON uc.community_id = c.id AND uc.user_id = {ph}
                    WHERE p.timestamp >= (UTC_TIMESTAMP() - INTERVAL {ph} HOUR)
                      AND LOWER(p.username) <> LOWER({ph})
                    GROUP BY c.id, c.name
                    HAVING post_count_others > 0
                    ORDER BY last_from_others_at DESC, post_count_others DESC, c.name ASC
                    LIMIT 40
                    """,
                    (uid, uh, username),
                )
            else:
                c.execute(
                    f"""
                    SELECT c.id AS community_id, c.name AS community_name,
                           COUNT(p.id) AS post_count_others,
                           MAX(p.timestamp) AS last_from_others_at
                    FROM posts p
                    INNER JOIN communities c ON c.id = p.community_id
                    INNER JOIN user_communities uc ON uc.community_id = c.id AND uc.user_id = {ph}
                    WHERE datetime(p.timestamp) >= datetime('now', '-' || {ph} || ' hours')
                      AND LOWER(p.username) <> LOWER({ph})
                    GROUP BY c.id, c.name
                    HAVING COUNT(p.id) > 0
                    ORDER BY MAX(p.timestamp) DESC, COUNT(p.id) DESC, c.name ASC
                    LIMIT 40
                    """,
                    (uid, uh_s, username),
                )

            comm_rows = c.fetchall() or []
            comm_ids: List[int] = []
            for row in comm_rows:
                cid = int(row["community_id"] if hasattr(row, "keys") else row[0])
                comm_ids.append(cid)
                name = row["community_name"] if hasattr(row, "keys") else row[1]
                pc = int(row["post_count_others"] if hasattr(row, "keys") else row[2])
                last_o = row["last_from_others_at"] if hasattr(row, "keys") else row[3]
                last_iso = _ts_face(last_o)
                communities.append(
                    {
                        "community_id": cid,
                        "name": (name or "") or f"Community {cid}",
                        "post_count_others": pc,
                        "last_from_others_at": last_iso,
                        "last_activity_label": format_digest_last_activity_label(last_o, now_utc=now_utc),
                        "feed_path": _feed_path(cid),
                        "feed_url_https": _https_feed_url(cid),
                        "recent_posts": [],
                        "recent_snippets": [],
                    }
                )

            posts_by_comm: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
            if comm_ids:
                placeholders = ",".join(ph for _ in comm_ids)
                if USE_MYSQL:
                    c.execute(
                        f"""
                        SELECT p.id AS post_id, p.community_id, p.username,
                               p.content, p.image_path, p.media_paths, p.timestamp,
                               TRIM(CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,''))) AS author_label
                        FROM posts p
                        LEFT JOIN users u ON LOWER(u.username) = LOWER(p.username)
                        WHERE p.community_id IN ({placeholders})
                          AND p.timestamp >= (UTC_TIMESTAMP() - INTERVAL {ph} HOUR)
                          AND LOWER(p.username) <> LOWER({ph})
                        ORDER BY p.community_id, p.timestamp DESC
                        """,
                        (*comm_ids, uh, username),
                    )
                else:
                    c.execute(
                        f"""
                        SELECT p.id AS post_id, p.community_id, p.username,
                               p.content, p.image_path, p.media_paths, p.timestamp,
                               TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) AS author_label
                        FROM posts p
                        LEFT JOIN users u ON LOWER(u.username) = LOWER(p.username)
                        WHERE p.community_id IN ({placeholders})
                          AND datetime(p.timestamp) >= datetime('now', '-' || {ph} || ' hours')
                          AND LOWER(p.username) <> LOWER({ph})
                        ORDER BY p.community_id, p.timestamp DESC
                        """,
                        (*comm_ids, uh_s, username),
                    )
                per_count: Dict[int, int] = defaultdict(int)
                for row in c.fetchall() or []:
                    cid = int(row["community_id"] if hasattr(row, "keys") else row[1])
                    if per_count[cid] >= MAX_POSTS_PER_COMMUNITY:
                        continue
                    per_count[cid] += 1
                    pid = int(row["post_id"] if hasattr(row, "keys") else row[0])
                    un = row["username"] if hasattr(row, "keys") else row[2]
                    content = row["content"] if hasattr(row, "keys") else row[3]
                    img = row["image_path"] if hasattr(row, "keys") else row[4]
                    media = row["media_paths"] if hasattr(row, "keys") else row[5]
                    ts = row["timestamp"] if hasattr(row, "keys") else row[6]
                    alab = row["author_label"] if hasattr(row, "keys") else row[7]
                    has_img = bool((img and str(img).strip() and str(img).lower() not in ("none", "null")))
                    if not has_img and media:
                        has_img = True
                    posts_by_comm[cid].append(
                        {
                            "post_id": pid,
                            "author_username": str(un or "").strip(),
                            "author_label": _author_label_from_row(str(un or ""), alab),
                            "content": _snippet(content, limit=1200),
                            "has_image": has_img,
                            "image_path": (str(img).strip() if img else None) or None,
                            "timestamp_iso": _ts_face(ts),
                        }
                    )

            for block in communities:
                cid = block["community_id"]
                block["recent_posts"] = posts_by_comm.get(cid, [])
                block["recent_snippets"] = [p["content"] for p in block["recent_posts"][:2] if p.get("content")]

            if USE_MYSQL:
                c.execute(
                    f"""
                    SELECT g.id, g.name AS group_name, mc.msg_count,
                           mc.last_message_at, mc.last_message_at AS sort_ts
                    FROM group_chats g
                    INNER JOIN group_chat_members gm ON gm.group_id = g.id AND gm.username = {ph}
                    INNER JOIN (
                        SELECT m.group_id, COUNT(*) AS msg_count, MAX(m.created_at) AS last_message_at
                        FROM group_chat_messages m
                        WHERE m.created_at >= (UTC_TIMESTAMP() - INTERVAL {ph} HOUR)
                          AND LOWER(m.sender_username) <> LOWER({ph})
                        GROUP BY m.group_id
                    ) mc ON mc.group_id = g.id
                    WHERE mc.msg_count > 0
                    ORDER BY sort_ts DESC
                    LIMIT 40
                    """,
                    (username, uh, username),
                )
            else:
                c.execute(
                    f"""
                    SELECT g.id, g.name AS group_name, mc.msg_count,
                           mc.last_message_at, mc.last_message_at AS sort_ts
                    FROM group_chats g
                    INNER JOIN group_chat_members gm ON gm.group_id = g.id AND gm.username = {ph}
                    INNER JOIN (
                        SELECT m.group_id, COUNT(*) AS msg_count, MAX(m.created_at) AS last_message_at
                        FROM group_chat_messages m
                        WHERE datetime(m.created_at) >= datetime('now', '-' || {ph} || ' hours')
                          AND LOWER(m.sender_username) <> LOWER({ph})
                        GROUP BY m.group_id
                    ) mc ON mc.group_id = g.id
                    WHERE mc.msg_count > 0
                    ORDER BY sort_ts DESC
                    LIMIT 40
                    """,
                    (username, uh_s, username),
                )

            g_rows = c.fetchall() or []
            group_ids: List[int] = []
            for row in g_rows:
                gid = int(row["id"] if hasattr(row, "keys") else row[0])
                group_ids.append(gid)
                gnm = row["group_name"] if hasattr(row, "keys") else row[1]
                mc = int(row["msg_count"] if hasattr(row, "keys") else row[2])
                last_ts = row["last_message_at"] if hasattr(row, "keys") else row[3]
                last_iso = _ts_face(last_ts)
                group_chats.append(
                    {
                        "group_id": gid,
                        "name": (gnm or "") or f"Group chat {gid}",
                        "message_count_others": mc,
                        "last_activity": last_iso,
                        "last_activity_label": format_digest_last_activity_label(last_ts, now_utc=now_utc),
                        "chat_path": _group_path(gid),
                        "chat_url_https": _https_group_chat_url(gid),
                        "transcript": [],
                    }
                )

            msgs_desc: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
            if group_ids:
                gph = ",".join(ph for _ in group_ids)
                if USE_MYSQL:
                    c.execute(
                        f"""
                        SELECT m.group_id, m.sender_username, m.message_text, m.created_at
                        FROM group_chat_messages m
                        WHERE m.group_id IN ({gph})
                          AND m.created_at >= (UTC_TIMESTAMP() - INTERVAL {ph} HOUR)
                          AND LOWER(m.sender_username) <> LOWER({ph})
                        ORDER BY m.group_id, m.created_at DESC
                        """,
                        (*group_ids, uh, username),
                    )
                else:
                    c.execute(
                        f"""
                        SELECT m.group_id, m.sender_username, m.message_text, m.created_at
                        FROM group_chat_messages m
                        WHERE m.group_id IN ({gph})
                          AND datetime(m.created_at) >= datetime('now', '-' || {ph} || ' hours')
                          AND LOWER(m.sender_username) <> LOWER({ph})
                        ORDER BY m.group_id, m.created_at DESC
                        """,
                        (*group_ids, uh_s, username),
                    )
                per_g_cut: Dict[int, int] = defaultdict(int)
                for row in c.fetchall() or []:
                    gid = int(row["group_id"] if hasattr(row, "keys") else row[0])
                    if per_g_cut[gid] >= MAX_GROUP_MESSAGES_TRANSCRIPT:
                        continue
                    per_g_cut[gid] += 1
                    snd = row["sender_username"] if hasattr(row, "keys") else row[1]
                    mt = row["message_text"] if hasattr(row, "keys") else row[2]
                    ca = row["created_at"] if hasattr(row, "keys") else row[3]
                    msgs_desc[gid].append(
                        {
                            "sender_username": str(snd or "").strip(),
                            "text": _snippet(mt, limit=500),
                            "timestamp_iso": _ts_face(ca),
                        }
                    )

            for block in group_chats:
                gid = block["group_id"]
                lst = list(reversed(msgs_desc.get(gid, [])))
                block["transcript"] = lst

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


def _grok_digest_intent_confirm(
    user_message: str,
    suggested_window_hours: int,
) -> Tuple[bool, int, Optional[int], Optional[int]]:
    """Second gate: LLM confirms digest vs false positive. Returns (proceed, window_hours, tin, tout)."""
    if not XAI_API_KEY:
        return True, suggested_window_hours, None, None
    from openai import OpenAI

    client = OpenAI(api_key=XAI_API_KEY, base_url="https://api.x.ai/v1")
    sys = (
        "You classify whether the user is asking for a **platform activity recap** "
        "(communities + group chats they belong to, not private DMs). "
        "Reply with **only** JSON: {\"digest\": true|false, \"window_hours\": 24|72|120|168}. "
        "If digest, pick window_hours closest to their wording (default 24)."
    )
    user = f"User message:\n{user_message}\n\nSuggested window from heuristics: {suggested_window_hours}h"
    try:
        completion = client.chat.completions.create(
            model=GROK_MODEL_FAST,
            messages=[{"role": "system", "content": sys}, {"role": "user", "content": user}],
            temperature=0.1,
            max_tokens=120,
        )
        text = (completion.choices[0].message.content or "").strip() if completion.choices else ""
        usage = getattr(completion, "usage", None)
        tin = getattr(usage, "prompt_tokens", None) if usage else None
        tout = getattr(usage, "completion_tokens", None) if usage else None
        m = text.find("{")
        n = text.rfind("}")
        blob = json.loads(text[m : n + 1] if m >= 0 and n > m else text)
        dig = bool(blob.get("digest"))
        wh = coerce_window_hours(blob.get("window_hours")) or suggested_window_hours
        if wh not in VALID_WINDOW_HOURS:
            wh = suggested_window_hours
        return dig, wh, tin, tout
    except Exception as exc:
        logger.warning("digest intent classifier failed: %s", exc)
        return True, suggested_window_hours, None, None


def _grok_compose_digest_from_facts(
    *,
    viewer_username: str,
    user_message: str,
    window_hours: int,
    facts: Dict[str, Any],
) -> Tuple[Optional[str], Optional[int], Optional[int]]:
    """Grounded narrative + required path links. No invention beyond JSON facts."""
    if not XAI_API_KEY:
        return None, None, None
    from openai import OpenAI

    client = OpenAI(api_key=XAI_API_KEY, base_url="https://api.x.ai/v1")
    system = (
        "You are Steve on C-Point. You receive **only** JSON facts about the member’s communities and group chats "
        "(posts and messages from **other members** in the time window — the viewer’s own posts/messages are excluded). "
        "Write a warm, sectioned digest in markdown.\n"
        "**Rules (strict):**\n"
        "- Summarize **only** what appears in the JSON. **Never** invent users, posts, URLs, titles, or events.\n"
        "- Use **author_label** / **author_username** from `recent_posts` and **sender_username** from group `transcript`. "
        "Do not say “others” when a name exists.\n"
        "- For posts with `has_image` true, describe the **caption/text** and note that a photo/image was shared if `content` is thin; "
        "do **not** claim you saw the image pixels unless vision was used (you only have text paths in JSON).\n"
        "- For each group, summarize **what was discussed** from the transcript lines, not message counts.\n"
        "- Include **exactly one** line per community: `[Open feed](FEED_PATH)` where FEED_PATH is the `feed_path` string from JSON for that community.\n"
        "- Include **exactly one** line per group: `[Open chat](CHAT_PATH)` where CHAT_PATH is the `chat_path` string from JSON.\n"
        "  Those paths MUST be copied **verbatim** (they start with `/`).\n"
        "- Include a **Last activity:** line per section using `last_activity_label` when present (human-friendly).\n"
        "- No `#` headings. Separate sections with a blank line.\n"
        "- Match the user’s language if clearly not English."
    )
    blob = json.dumps(facts, ensure_ascii=False, indent=2)
    user_blob = (
        f"Viewer (recipient, do not treat as author of listed posts): {viewer_username}\n"
        f"They asked (for tone only): {user_message!r}\n"
        f"Window hours: {window_hours}\n\n"
        f"FACTS_JSON:\n{blob}"
    )
    try:
        completion = client.chat.completions.create(
            model=GROK_MODEL_FAST,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_blob},
            ],
            temperature=0.35,
            max_tokens=3200,
        )
        text = (completion.choices[0].message.content or "").strip() if completion.choices else ""
        usage = getattr(completion, "usage", None)
        tin = getattr(usage, "prompt_tokens", None) if usage else None
        tout = getattr(usage, "completion_tokens", None) if usage else None
        return (text or None), tin, tout
    except Exception as exc:
        logger.warning("digest compose Grok failed: %s", exc)
        return None, None, None


def _fallback_deterministic_digest_body(payload: Dict[str, Any]) -> str:
    """Minimal grounded body if LLM unavailable; uses names from JSON."""
    parts: List[str] = []
    for comm in payload.get("communities") or []:
        name = (comm.get("name") or "").strip() or "Community"
        lines = [f"**{name}**", ""]
        la = (comm.get("last_activity_label") or "").strip()
        if la:
            lines.append(f"Last activity: {la}.")
        for p in comm.get("recent_posts") or []:
            who = (p.get("author_label") or p.get("author_username") or "Member") or "Member"
            cx = (p.get("content") or "").strip()
            if cx:
                lines.append(f"• **{who}:** {_snippet(cx, limit=280)}")
        lines.append("")
        lines.append(f"[Open feed]({(comm.get('feed_path') or '').strip()})")
        parts.append("\n".join(lines))

    for gc in payload.get("group_chats") or []:
        name = (gc.get("name") or "").strip() or "Group chat"
        lines = [f"**{name}**", ""]
        la = (gc.get("last_activity_label") or "").strip()
        if la:
            lines.append(f"Last activity: {la}.")
        for t in gc.get("transcript") or []:
            who = (t.get("sender_username") or "someone").strip()
            tx = (t.get("text") or "").strip()
            if tx:
                lines.append(f"• **@{who}:** {_snippet(tx, limit=240)}")
        lines.append("")
        lines.append(f"[Open chat]({(gc.get('chat_path') or '').strip()})")
        parts.append("\n".join(lines))

    return "\n\n".join(parts).strip()


def try_handle_platform_activity_digest_dm(
    *,
    sender_username: str,
    user_message: str,
) -> Optional[str]:
    """If this is a digest request, return Steve’s reply body; else ``None``."""
    if not message_looks_like_platform_digest_intent(user_message):
        return None

    from backend.services import ai_usage

    wh_hint = parse_digest_window_hours_from_message(user_message)
    intent_ok, wh_use, it_in, it_out = _grok_digest_intent_confirm(user_message, wh_hint)
    if not intent_ok:
        return None

    payload = build_platform_activity_digest(sender_username, wh_use)

    total_in: Optional[int] = it_in
    total_out: Optional[int] = it_out

    n_comm = len(payload.get("communities") or [])
    n_grp = len(payload.get("group_chats") or [])

    def _log_digest_usage(tin: Optional[int], tout: Optional[int], model_id: str) -> None:
        try:
            ai_usage.log_usage(
                sender_username,
                surface=ai_usage.SURFACE_DM,
                request_type="platform_activity_digest",
                model=model_id,
                tokens_in=tin,
                tokens_out=tout,
            )
        except Exception:
            pass

    if n_comm == 0 and n_grp == 0:
        msg = (
            "Honestly? It’s been pretty quiet in your communities and group chats over that stretch — "
            "nothing much jumped out. If you want a longer window, say **last 3 days** or **past week**."
        )
        _log_digest_usage(None, None, "n/a")
        return msg

    wh_payload = int(payload.get("window_hours") or wh_use)
    body_llm, c_in, c_out = _grok_compose_digest_from_facts(
        viewer_username=sender_username,
        user_message=user_message,
        window_hours=wh_payload,
        facts=payload,
    )
    parts_in = [x for x in (it_in, c_in) if x is not None]
    parts_out = [x for x in (it_out, c_out) if x is not None]
    total_in = sum(parts_in) if parts_in else None
    total_out = sum(parts_out) if parts_out else None

    opener = _digest_opener_line(wh_payload)
    if body_llm and _digest_markdown_preserves_required_paths(body_llm, payload):
        reply = opener + body_llm.strip()
        _log_digest_usage(total_in, total_out, GROK_MODEL_FAST)
        return reply

    fallback = opener + _fallback_deterministic_digest_body(payload)
    _log_digest_usage(total_in, total_out, GROK_MODEL_FAST if body_llm else "n/a")
    return fallback
