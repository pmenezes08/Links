"""Assemble feed/group post thread context for Steve @Steve replies."""

from __future__ import annotations

import re
from dataclasses import dataclass, replace as dataclass_replace
from datetime import datetime
from typing import Any, List, Optional, Sequence, Tuple

from backend.services.steve_thread_memory import format_msg_timestamp

STEVE_USERNAME = "steve"
STEVE_PRIOR_REPLY_LABEL = "[Steve — your prior reply]"
DEFAULT_THREAD_CHARS_MAX = 12000
MIN_COMMENTS_TO_KEEP = 3
HARD_COMMENT_LIMIT_MAX = 50
# Steve's own replies are the longest text in a thread (up to 1400 output
# tokens vs one-line human comments). Re-injecting them all verbatim lets his
# prose dominate the context budget and conditions him to restate himself —
# so only the newest few stay verbatim; older ones become one-line stubs.
STEVE_VERBATIM_REPLIES_KEPT = 2
STEVE_REPLY_STUB_MAX_CHARS = 140

# Any @handle other than @steve in the current message.
_OTHER_MENTION_RE = re.compile(r"@(?!steve\b)[A-Za-z0-9_]+", re.IGNORECASE)


def _stub_content(content: str) -> str:
    """Condense an older Steve reply to its opening line."""
    first_line = (content or "").strip().splitlines()[0] if (content or "").strip() else ""
    if len(first_line) > STEVE_REPLY_STUB_MAX_CHARS:
        first_line = first_line[:STEVE_REPLY_STUB_MAX_CHARS].rstrip()
    return f"{first_line} […condensed; do not restate…]"


def _compress_older_steve_replies(comments: List["ThreadComment"]) -> List["ThreadComment"]:
    """Keep the newest ``STEVE_VERBATIM_REPLIES_KEPT`` Steve replies verbatim; stub the rest."""
    steve_indexes = [
        idx for idx, c in enumerate(comments) if c.username.lower() == STEVE_USERNAME
    ]
    to_stub = set(steve_indexes[:-STEVE_VERBATIM_REPLIES_KEPT]) if len(steve_indexes) > STEVE_VERBATIM_REPLIES_KEPT else set()
    if not to_stub:
        return comments
    return [
        dataclass_replace(c, content=_stub_content(c.content)) if idx in to_stub else c
        for idx, c in enumerate(comments)
    ]


@dataclass
class ThreadComment:
    id: int
    username: str
    content: str
    parent_reply_id: Optional[int]
    sort_key: Any = None


def _row_value(row: Any, key: str, index: int, default: Any = None) -> Any:
    if row is None:
        return default
    try:
        if hasattr(row, "keys") and key in row.keys():
            return row[key]
    except Exception:
        pass
    try:
        return row[index]
    except Exception:
        return default


def _rows_to_comments(rows: Sequence[Any]) -> List[ThreadComment]:
    comments: List[ThreadComment] = []
    for row in rows or []:
        content = str(_row_value(row, "content", 1, "") or "").strip()
        if not content:
            continue
        comments.append(
            ThreadComment(
                id=int(_row_value(row, "id", 2, 0) or 0),
                username=str(_row_value(row, "username", 0, "") or ""),
                content=content,
                parent_reply_id=_row_value(row, "parent_reply_id", 3),
                sort_key=_row_value(row, "timestamp", 4) or _row_value(row, "created_at", 4),
            )
        )
    return comments


def _clamp_limit(limit: int) -> int:
    return max(0, min(HARD_COMMENT_LIMIT_MAX, int(limit or 0)))


def fetch_recent_post_comments(
    cursor: Any,
    ph: str,
    *,
    post_id: int,
    limit: int,
) -> List[ThreadComment]:
    """Return the most recent ``limit`` community post replies, chronological."""
    limit = _clamp_limit(limit)
    if limit <= 0:
        return []
    cursor.execute(
        f"""
        SELECT username, content, id, parent_reply_id, timestamp
        FROM replies
        WHERE post_id = {ph}
        ORDER BY timestamp DESC
        LIMIT {limit}
        """,
        (int(post_id),),
    )
    return list(reversed(_rows_to_comments(cursor.fetchall() or [])))


def fetch_recent_group_comments(
    cursor: Any,
    ph: str,
    *,
    group_post_id: int,
    limit: int,
    table_name: str = "group_replies",
) -> List[ThreadComment]:
    """Return the most recent ``limit`` group post replies, chronological."""
    limit = _clamp_limit(limit)
    if limit <= 0:
        return []
    cursor.execute(
        f"""
        SELECT username, content, id, parent_reply_id, created_at
        FROM {table_name}
        WHERE group_post_id = {ph}
        ORDER BY id DESC
        LIMIT {limit}
        """,
        (int(group_post_id),),
    )
    return list(reversed(_rows_to_comments(cursor.fetchall() or [])))


def _format_comment_line(
    comment: ThreadComment,
    *,
    number: int,
    id_to_number: dict[int, int],
) -> str:
    prefix = ""
    if comment.parent_reply_id is not None:
        parent_num = id_to_number.get(int(comment.parent_reply_id))
        if parent_num is not None:
            prefix = f"↳ reply to #{parent_num} "
    if comment.username.lower() == STEVE_USERNAME:
        speaker = STEVE_PRIOR_REPLY_LABEL
    else:
        speaker = comment.username
    ts = format_msg_timestamp(comment.sort_key)
    return f"{ts}#{number} {prefix}{speaker}: {comment.content}"


def _trim_comments_for_budget(
    comments: List[ThreadComment],
    *,
    post_description: str,
    current_username: str,
    current_message: str,
    max_chars: int,
) -> List[ThreadComment]:
    if max_chars <= 0 or not comments:
        return comments
    trimmed = list(comments)
    while len(trimmed) > MIN_COMMENTS_TO_KEEP:
        id_to_number = {c.id: idx for idx, c in enumerate(trimmed, start=1)}
        trial_lines = [
            _format_comment_line(c, number=idx, id_to_number=id_to_number)
            for idx, c in enumerate(trimmed, start=1)
        ]
        trial_block = "\n".join(
            [
                post_description,
                "",
                f"--- Thread (most recent {len(trimmed)} comments; #n = comment number) ---",
                *trial_lines,
                "--- End of thread ---",
                "",
                f"User {current_username} now says: {current_message}",
            ]
        )
        if len(trial_block) <= max_chars:
            return trimmed
        trimmed.pop(0)
    return trimmed


def format_thread_for_steve(
    comments: Sequence[ThreadComment],
    *,
    post_description: str,
    current_username: str,
    current_message: str,
    max_chars: Optional[int] = None,
    include_multi_user_note: bool = True,
) -> Tuple[str, List[str]]:
    """Build the user-message thread block and a plain content list for doc gates."""
    comment_list = _compress_older_steve_replies(list(comments or []))
    budget = int(max_chars) if max_chars is not None else DEFAULT_THREAD_CHARS_MAX
    if budget > 0 and comment_list:
        comment_list = _trim_comments_for_budget(
            comment_list,
            post_description=post_description,
            current_username=current_username,
            current_message=current_message,
            max_chars=budget,
        )

    # Human comments only: this list seeds doc-retrieval queries and resource
    # gates. Including Steve's own replies made retrieval self-reinforcing —
    # once he mentioned a doc/topic, his own mention kept re-triggering it.
    plain_contents = [
        c.content
        for c in comment_list
        if c.content and c.username.lower() != STEVE_USERNAME
    ]
    parts: List[str] = [post_description]
    if comment_list:
        id_to_number = {c.id: idx for idx, c in enumerate(comment_list, start=1)}
        parts.append("")
        parts.append(f"--- Thread (most recent {len(comment_list)} comments; #n = comment number) ---")
        for idx, comment in enumerate(comment_list, start=1):
            parts.append(_format_comment_line(comment, number=idx, id_to_number=id_to_number))
        parts.append("--- End of thread ---")

    parts.append("")
    parts.append(f"User {current_username} now says: {current_message}")
    current_datetime = datetime.utcnow()
    parts.append(f"\n[Current date and time: {current_datetime.strftime('%A, %B %d, %Y at %H:%M UTC')}]")
    # Only when the current message actually addresses another user — as an
    # always-on note it pointed Steve backwards into the thread on every turn.
    if include_multi_user_note and _OTHER_MENTION_RE.search(current_message or ""):
        parts.append(
            "\nNote: If the user asks you to respond to or help another user, look through the comments above "
            "to find that user's question or message and address it directly."
        )
    return "\n".join(parts), plain_contents
