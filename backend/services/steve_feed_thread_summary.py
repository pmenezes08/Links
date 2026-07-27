"""Rolling summary of the older part of long feed / group-post threads.

The comment window shows Steve only the newest N comments (default 24). On a
100-comment thread everything older simply vanished from his context — the
"knows everything" promise failed for the thread itself. This service keeps a
cached, structured summary of the comments *older than the window*, refreshed
incrementally, so Steve carries the whole thread the way a member who read it
all would.

Shape mirrors ``steve_thread_memory`` (the DM/group-chat rolling summary):
cached text + trigger/refresh thresholds + exactly one metered LLM call per
refresh (via ``llm.usage_context`` → real-token ``ai_usage`` row on the feed
surface, request_type ``steve_feed_thread_summary``). The cache lives on the
Firestore ``posts/{post_id}`` mirror doc (``gp_{id}`` for group posts),
``merge=True`` so feed dual-writes are untouched.

KB config (community-tiers page, ``paid_steve_package`` group):
``feed_thread_summary_enabled`` / ``_trigger_older`` / ``_refresh_every`` /
``_max_chars``.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, List, Optional

logger = logging.getLogger(__name__)

POSTS_COLLECTION = "posts"
FIELD_SUMMARY = "steve_feed_thread_summary"
FIELD_OLDER_COUNT = "steve_feed_thread_summary_older_count"
FIELD_UPDATED_AT = "steve_feed_thread_summary_updated_at"
OLDER_FETCH_CAP = 300

_SYSTEM_PROMPT = (
    "You produce a compact, structured summary of the OLDER part of a community "
    "post thread. Your output is background context for Steve, a member of "
    "C-Point — the newest comments will be shown to him verbatim separately.\n"
    "Rules:\n"
    "- Structured roll-up in plain bullet points, no markdown headers.\n"
    "- Preserve key FACTS, decisions, who said what when it matters, tallies, "
    "dates, and open questions.\n"
    "- Do NOT invent information.\n"
    "- Keep it under {max_chars} characters.\n"
    "- Match the dominant language of the thread."
)


def _fs_doc_id(post_id: int, *, is_group_post: bool) -> str:
    return f"gp_{int(post_id)}" if is_group_post else str(int(post_id))


def _count_replies(cursor: Any, ph: str, *, post_id: int, table: str, id_column: str) -> int:
    try:
        cursor.execute(
            f"SELECT COUNT(*) AS n FROM {table} WHERE {id_column} = {ph}",
            (int(post_id),),
        )
        row = cursor.fetchone()
        if row is None:
            return 0
        try:
            if hasattr(row, "keys") and "n" in row.keys():
                return int(row["n"] or 0)
        except Exception:
            pass
        return int(row[0] or 0)
    except Exception as exc:
        logger.debug("Feed summary: count failed for %s %s: %s", table, post_id, exc)
        return 0


def _fetch_older_lines(
    cursor: Any,
    ph: str,
    *,
    post_id: int,
    older_count: int,
    table: str,
    id_column: str,
    ts_column: str,
) -> List[str]:
    """Oldest-first lines for the comments before the visible window."""
    limit = min(int(older_count), OLDER_FETCH_CAP)
    if limit <= 0:
        return []
    try:
        cursor.execute(
            f"""
            SELECT username, content, {ts_column}
            FROM {table}
            WHERE {id_column} = {ph}
            ORDER BY {ts_column} ASC
            LIMIT {limit}
            """,
            (int(post_id),),
        )
        lines: List[str] = []
        for row in cursor.fetchall() or []:
            try:
                username = row["username"] if hasattr(row, "keys") else row[0]
                content = row["content"] if hasattr(row, "keys") else row[1]
                ts = row[ts_column] if hasattr(row, "keys") else row[2]
            except Exception:
                continue
            body = str(content or "").strip()
            if not body:
                continue
            lines.append(f"[{str(ts or '')[:16]}] {username}: {body[:300]}")
        return lines
    except Exception as exc:
        logger.warning("Feed summary: older-comment fetch failed for %s: %s", post_id, exc)
        return []


def _load_cached(fs_client: Any, doc_id: str) -> tuple[Optional[str], int]:
    try:
        doc = fs_client.collection(POSTS_COLLECTION).document(doc_id).get()
        if not doc.exists:
            return None, 0
        data = doc.to_dict() or {}
        summary = data.get(FIELD_SUMMARY)
        count = int(data.get(FIELD_OLDER_COUNT, 0) or 0)
        return (str(summary) if summary else None), count
    except Exception as exc:
        logger.debug("Feed summary: cache load failed for %s: %s", doc_id, exc)
        return None, 0


def _save_cached(fs_client: Any, doc_id: str, *, summary: str, older_count: int) -> None:
    try:
        fs_client.collection(POSTS_COLLECTION).document(doc_id).set(
            {
                FIELD_SUMMARY: summary,
                FIELD_OLDER_COUNT: int(older_count),
                FIELD_UPDATED_AT: datetime.now(timezone.utc).isoformat(),
            },
            merge=True,
        )
    except Exception as exc:
        logger.warning("Feed summary: cache save failed for %s: %s", doc_id, exc)


def maybe_get_feed_thread_summary(
    cursor: Any,
    ph: str,
    *,
    post_id: int,
    visible_count: int,
    sender_username: str,
    steve_config: Any,
    community_id: Optional[int] = None,
    original_post: str = "",
    is_group_post: bool = False,
    replies_table: str = "replies",
    replies_id_column: str = "post_id",
    replies_ts_column: str = "timestamp",
) -> Optional[str]:
    """Return the older-thread summary to inject, or None.

    Cached-fresh → returned without an LLM call. One metered call per refresh,
    no retries. Never raises.
    """
    try:
        if not bool(getattr(steve_config, "feed_thread_summary_enabled", False)):
            return None
        trigger = max(1, int(getattr(steve_config, "feed_thread_summary_trigger_older", 10)))
        refresh_every = max(1, int(getattr(steve_config, "feed_thread_summary_refresh_every", 20)))
        max_chars = max(200, int(getattr(steve_config, "feed_thread_summary_max_chars", 1500)))

        total = _count_replies(
            cursor, ph, post_id=post_id, table=replies_table, id_column=replies_id_column
        )
        older_count = max(0, total - max(0, int(visible_count)))
        if older_count < trigger:
            return None

        from backend.services.firestore_writes import USE_FIRESTORE_WRITES, _get_client

        if not USE_FIRESTORE_WRITES:
            return None
        fs = _get_client()
        doc_id = _fs_doc_id(post_id, is_group_post=is_group_post)
        cached, cached_count = _load_cached(fs, doc_id)
        if cached and (older_count - cached_count) < refresh_every:
            return cached

        lines = _fetch_older_lines(
            cursor,
            ph,
            post_id=post_id,
            older_count=older_count,
            table=replies_table,
            id_column=replies_id_column,
            ts_column=replies_ts_column,
        )
        if not lines:
            return cached

        from backend.services import ai_usage
        from backend.services.content_generation import llm

        user_prompt = ""
        if original_post:
            user_prompt += f"Original post: {original_post[:400]}\n\n"
        if cached:
            user_prompt += (
                f"Update this existing summary with the thread excerpt below — merge new facts, "
                f"revise tallies, keep it structured.\n\nEXISTING SUMMARY:\n{cached}\n\n"
            )
        user_prompt += f"OLDER THREAD COMMENTS ({len(lines)} shown, oldest first):\n" + "\n".join(lines)

        try:
            with llm.usage_context(
                username=sender_username,
                request_type="steve_feed_thread_summary",
                community_id=int(community_id) if community_id is not None else None,
                surface=ai_usage.SURFACE_GROUP if is_group_post else ai_usage.SURFACE_FEED,
            ):
                summary = llm.generate_text(
                    _SYSTEM_PROMPT.format(max_chars=max_chars),
                    user_prompt,
                    max_tokens=800,
                    temperature=0.3,
                    caps=None,
                )
        except Exception as exc:
            logger.warning("Feed summary LLM call failed for post %s (no retry): %s", post_id, exc)
            return cached

        summary = (summary or "").strip()[:max_chars]
        if not summary:
            return cached
        _save_cached(fs, doc_id, summary=summary, older_count=older_count)
        return summary
    except Exception as exc:
        logger.warning("Feed thread summary failed for post %s: %s", post_id, exc)
        return None
