"""Shared poll hydration for feed and post-detail surfaces."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Iterable, List

from backend.services.database import USE_MYSQL


def _row_dict(row: Any, fallback: Dict[str, Any] | None = None) -> Dict[str, Any]:
    if row is None:
        return {}
    if hasattr(row, "keys"):
        return dict(row)
    return dict(fallback or {})


def _is_expired(value: Any) -> bool:
    if not value:
        return False
    text = str(value).replace("T", " ").strip()
    for fmt, candidate in (
        ("%Y-%m-%d %H:%M:%S", text[:19]),
        ("%Y-%m-%d %H:%M", text[:16]),
        ("%Y-%m-%d", text[:10]),
    ):
        try:
            exp = datetime.strptime(candidate, fmt)
            return datetime.utcnow() >= exp
        except Exception:
            continue
    return False


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def attach_polls_to_posts(
    cursor: Any,
    ph: str,
    username: str | None,
    posts: Iterable[Dict[str, Any]],
    *,
    include_inactive: bool = False,
    include_expired: bool = False,
) -> None:
    """Mutate community post dicts with optional ``poll`` payloads."""
    post_list = [p for p in posts if p and p.get("id") is not None]
    post_ids = [int(p["id"]) for p in post_list]
    if not post_ids:
        return

    in_ph = ",".join([ph] * len(post_ids))
    active_clause = "" if include_inactive else " AND is_active = 1"
    cursor.execute(
        f"""
        SELECT * FROM polls
        WHERE post_id IN ({in_ph}){active_clause}
        """,
        tuple(post_ids),
    )
    poll_rows = cursor.fetchall() or []
    poll_by_post: Dict[int, Dict[str, Any]] = {}
    poll_post_map: Dict[int, int] = {}
    poll_ids: List[int] = []
    for row in poll_rows:
        if hasattr(row, "keys"):
            poll = dict(row)
        else:
            poll = {
                "id": row[0] if len(row) > 0 else None,
                "post_id": row[1] if len(row) > 1 else None,
                "question": row[2] if len(row) > 2 else "",
                "is_active": row[3] if len(row) > 3 else 1,
                "single_vote": row[4] if len(row) > 4 else 1,
                "expires_at": row[5] if len(row) > 5 else None,
            }
        poll_id = _int(poll.get("id"))
        post_id = _int(poll.get("post_id"))
        if not poll_id or not post_id:
            continue
        if not include_expired and _is_expired(poll.get("expires_at")):
            continue
        poll["options"] = []
        poll_by_post[post_id] = poll
        poll_post_map[poll_id] = post_id
        poll_ids.append(poll_id)

    if not poll_ids:
        for post in post_list:
            post.setdefault("poll", None)
        return

    _hydrate_options(
        cursor,
        ph,
        username,
        poll_by_post,
        poll_post_map,
        poll_ids,
        options_table="poll_options",
        votes_table="poll_votes",
        poll_id_column="poll_id",
    )
    for post in post_list:
        post["poll"] = poll_by_post.get(int(post["id"]))


def attach_group_polls_to_posts(
    cursor: Any,
    ph: str,
    username: str | None,
    posts: Iterable[Dict[str, Any]],
    *,
    include_inactive: bool = False,
    include_expired: bool = False,
) -> None:
    """Mutate group post dicts with optional ``poll`` payloads."""
    post_list = [p for p in posts if p and p.get("id") is not None]
    post_ids = [int(p["id"]) for p in post_list]
    if not post_ids:
        return

    gp = "`group_polls`" if USE_MYSQL else "group_polls"
    gpo = "`group_poll_options`" if USE_MYSQL else "group_poll_options"
    gpv = "`group_poll_votes`" if USE_MYSQL else "group_poll_votes"
    in_ph = ",".join([ph] * len(post_ids))
    active_clause = "" if include_inactive else " AND is_active = 1"
    cursor.execute(
        f"""
        SELECT * FROM {gp}
        WHERE group_post_id IN ({in_ph}){active_clause}
        """,
        tuple(post_ids),
    )
    poll_rows = cursor.fetchall() or []
    poll_by_post: Dict[int, Dict[str, Any]] = {}
    poll_post_map: Dict[int, int] = {}
    poll_ids: List[int] = []
    for row in poll_rows:
        poll = _row_dict(row)
        poll_id = _int(poll.get("id"))
        post_id = _int(poll.get("group_post_id"))
        if not poll_id or not post_id:
            continue
        if not include_expired and _is_expired(poll.get("expires_at")):
            continue
        poll_by_post[post_id] = {
            "id": poll_id,
            "question": poll.get("question") or "",
            "is_active": _int(poll.get("is_active"), 1),
            "single_vote": bool(_int(poll.get("single_vote"), 1)),
            "expires_at": poll.get("expires_at"),
            "options": [],
            "group_poll": True,
        }
        poll_post_map[poll_id] = post_id
        poll_ids.append(poll_id)

    if not poll_ids:
        for post in post_list:
            post.setdefault("poll", None)
        return

    _hydrate_options(
        cursor,
        ph,
        username,
        poll_by_post,
        poll_post_map,
        poll_ids,
        options_table=gpo,
        votes_table=gpv,
        poll_id_column="group_poll_id",
    )
    for post in post_list:
        post["poll"] = poll_by_post.get(int(post["id"]))


def _hydrate_options(
    cursor: Any,
    ph: str,
    username: str | None,
    poll_by_post: Dict[int, Dict[str, Any]],
    poll_post_map: Dict[int, int],
    poll_ids: List[int],
    *,
    options_table: str,
    votes_table: str,
    poll_id_column: str,
) -> None:
    poll_ph = ",".join([ph] * len(poll_ids))
    cursor.execute(
        f"""
        SELECT * FROM {options_table}
        WHERE {poll_id_column} IN ({poll_ph})
        ORDER BY {poll_id_column}, id
        """,
        tuple(poll_ids),
    )
    option_rows = cursor.fetchall() or []
    option_ids: List[int] = []
    option_poll_map: Dict[int, int] = {}
    for row in option_rows:
        if hasattr(row, "keys"):
            option = dict(row)
            option_id = _int(option.get("id"))
            poll_id = _int(option.get(poll_id_column))
        else:
            option_id = _int(row[0] if len(row) > 0 else None)
            poll_id = _int(row[1] if len(row) > 1 else None)
            option = {
                "id": option_id,
                poll_id_column: poll_id,
                "option_text": row[2] if len(row) > 2 else "",
            }
        post_id = poll_post_map.get(poll_id)
        if not option_id or not poll_id or not post_id or post_id not in poll_by_post:
            continue
        option_ids.append(option_id)
        option_poll_map[option_id] = poll_id
        option["poll_id"] = poll_id
        option["text"] = option.get("option_text", "")
        option["votes"] = 0
        option["user_voted"] = False
        poll_by_post[post_id].setdefault("options", []).append(option)

    if not option_ids:
        return

    opt_ph = ",".join([ph] * len(option_ids))
    cursor.execute(
        f"""
        SELECT option_id, COUNT(*) as count
        FROM {votes_table}
        WHERE option_id IN ({opt_ph})
        GROUP BY option_id
        """,
        tuple(option_ids),
    )
    for row in cursor.fetchall() or []:
        option_id = _int(row["option_id"] if hasattr(row, "keys") else row[0])
        count = _int(row["count"] if hasattr(row, "keys") else row[1])
        poll_id = option_poll_map.get(option_id)
        post_id = poll_post_map.get(poll_id) if poll_id else None
        if not post_id:
            continue
        for option in poll_by_post.get(post_id, {}).get("options", []):
            if _int(option.get("id")) == option_id:
                option["votes"] = count
                break

    user_voted_options = set()
    if username:
        cursor.execute(
            f"""
            SELECT option_id
            FROM {votes_table}
            WHERE option_id IN ({opt_ph}) AND username = {ph}
            """,
            tuple(option_ids) + (username,),
        )
        for row in cursor.fetchall() or []:
            user_voted_options.add(_int(row["option_id"] if hasattr(row, "keys") else row[0]))

    for poll in poll_by_post.values():
        total = 0
        user_vote = None
        single_vote = not (poll.get("single_vote") in (False, 0, "0", "false"))
        for option in poll.get("options", []):
            total += _int(option.get("votes"))
            if _int(option.get("id")) in user_voted_options:
                option["user_voted"] = True
                if single_vote:
                    user_vote = option.get("id")
        poll["total_votes"] = total
        poll["user_vote"] = user_vote if single_vote else None


def invalidate_community_poll_post_detail(cursor: Any, poll_id: Any) -> int | None:
    """Invalidate cached community post detail for a poll mutation."""
    try:
        cursor.execute("SELECT post_id FROM polls WHERE id = ?", (poll_id,))
        row = cursor.fetchone()
        post_id = _int(row["post_id"] if hasattr(row, "keys") else (row[0] if row else None))
        if post_id:
            from backend.services.post_detail_cache import invalidate_post_detail

            invalidate_post_detail(post_id, scope="community")
            return post_id
    except Exception:
        return None
    return None


def invalidate_group_poll_post_detail(cursor: Any, ph: str, group_poll_id: Any) -> int | None:
    """Invalidate cached group post detail for a group poll mutation."""
    try:
        gp = "`group_polls`" if USE_MYSQL else "group_polls"
        cursor.execute(f"SELECT group_post_id FROM {gp} WHERE id = {ph}", (group_poll_id,))
        row = cursor.fetchone()
        post_id = _int(row["group_post_id"] if hasattr(row, "keys") else (row[0] if row else None))
        if post_id:
            from backend.services.post_detail_cache import invalidate_post_detail

            invalidate_post_detail(post_id, scope="group")
            return post_id
    except Exception:
        return None
    return None
