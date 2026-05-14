"""Thread JSON for ``group_replies`` (parity with ``/api/reply`` for community replies)."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

from backend.services.database import USE_MYSQL
from backend.services.reactions import get_group_reply_reaction_summary

logger = logging.getLogger(__name__)


def _as_row_dict(row) -> dict:
    if row is None:
        return {}
    if hasattr(row, "keys"):
        return dict(row)
    return {}


def _isoish(value) -> Any:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _hydrate_timestamp(entity: dict) -> None:
    raw = entity.get("timestamp") or entity.get("created_at")
    entity["timestamp"] = _isoish(raw)


def ensure_group_reply_views_table(cursor) -> None:
    try:
        if USE_MYSQL:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS `group_reply_views` (
                    id INTEGER PRIMARY KEY AUTO_INCREMENT,
                    group_reply_id INTEGER NOT NULL,
                    username VARCHAR(191) NOT NULL,
                    viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_grp_reply_view (group_reply_id, username),
                    KEY idx_grp_reply_views_reply (group_reply_id),
                    CONSTRAINT fk_grp_reply_views_reply
                        FOREIGN KEY (group_reply_id)
                        REFERENCES `group_replies`(id) ON DELETE CASCADE
                )
                """
            )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS group_reply_views (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    group_reply_id INTEGER NOT NULL,
                    username TEXT NOT NULL,
                    viewed_at TEXT DEFAULT (datetime('now')),
                    UNIQUE(group_reply_id, username),
                    FOREIGN KEY (group_reply_id) REFERENCES group_replies(id) ON DELETE CASCADE
                )
                """
            )
    except Exception as e:
        logger.warning("Could not ensure group_reply_views table: %s", e)


def _count_group_reply_views_excluding_admin(cursor, ph: str, group_reply_id: int) -> int:
    try:
        grv = "`group_reply_views`" if USE_MYSQL else "group_reply_views"
        cursor.execute(
            f"""
            SELECT COUNT(*) as cnt FROM {grv}
            WHERE group_reply_id = {ph} AND LOWER(username) <> LOWER({ph})
            """,
            (group_reply_id, "admin"),
        )
        row = cursor.fetchone()
        if row and hasattr(row, "keys"):
            return int(row.get("cnt") or 0)
        return int(row[0]) if row else 0
    except Exception:
        return 0


def count_group_reply_views_excluding_admin(
    cursor, ph: str, group_reply_id: int
) -> int:
    """Public alias for reactors modal (same implementation as internal counter)."""
    return _count_group_reply_views_excluding_admin(cursor, ph, group_reply_id)


def upsert_group_reply_view(
    cursor, ph: str, group_reply_id: int, username: Optional[str]
) -> int:
    ensure_group_reply_views_table(cursor)
    if not username:
        return _count_group_reply_views_excluding_admin(cursor, ph, group_reply_id)
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    grv_tbl = "`group_reply_views`" if USE_MYSQL else "group_reply_views"
    try:
        if USE_MYSQL:
            cursor.execute(
                f"INSERT IGNORE INTO {grv_tbl} (group_reply_id, username, viewed_at) VALUES (%s,%s,%s)",
                (group_reply_id, username, now_str),
            )
        else:
            cursor.execute(
                f"INSERT OR IGNORE INTO {grv_tbl} (group_reply_id, username, viewed_at) VALUES (?,?,?)",
                (group_reply_id, username, now_str),
            )
    except Exception as e:
        logger.warning("Failed inserting group_reply_view for %s: %s", group_reply_id, e)
    return _count_group_reply_views_excluding_admin(cursor, ph, group_reply_id)


def assemble_group_reply_thread(cursor, ph: str, reply_id: int, username: str) -> dict:
    """Build ``success/reply/post/parent_chain`` dict. Caller verified access and reply exists."""
    gr_t = "`group_replies`" if USE_MYSQL else "group_replies"
    gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
    g_t = "`groups`" if USE_MYSQL else "groups"

    cursor.execute(f"SELECT * FROM {gr_t} WHERE id = {ph}", (reply_id,))
    reply_raw = cursor.fetchone()
    reply = _as_row_dict(reply_raw)
    group_post_id = reply.get("group_post_id")
    _hydrate_timestamp(reply)

    cursor.execute(
        f"""
        SELECT gp.id, gp.username, gp.content, gp.image_path, gp.group_id,
               g.community_id, gp.created_at
        FROM {gp_t} gp
        JOIN {g_t} g ON g.id = gp.group_id
        WHERE gp.id = {ph}
        """,
        (group_post_id,),
    )
    post_raw = cursor.fetchone()
    post_info: Optional[dict] = None
    if post_raw:
        pr = _as_row_dict(post_raw)
        post_info = {
            "id": pr.get("id"),
            "username": pr.get("username"),
            "content": pr.get("content"),
            "community_id": pr.get("community_id"),
            "group_id": pr.get("group_id"),
            "is_group_post": True,
            "timestamp": _isoish(pr.get("created_at")),
            "image_path": pr.get("image_path"),
        }

    try:
        cursor.execute(
            f"SELECT profile_picture FROM user_profiles WHERE username = {ph}",
            (reply.get("username"),),
        )
        pp = cursor.fetchone()
        reply["profile_picture"] = (
            pp["profile_picture"]
            if pp and hasattr(pp, "keys")
            else (pp[0] if pp else None)
        )
    except Exception:
        reply["profile_picture"] = None

    r_counts, r_user = get_group_reply_reaction_summary(cursor, reply_id, username)
    reply["reactions"] = r_counts
    reply["user_reaction"] = r_user
    try:
        ensure_group_reply_views_table(cursor)
        reply["view_count"] = _count_group_reply_views_excluding_admin(
            cursor, ph, reply_id
        )
    except Exception:
        reply["view_count"] = 0

    cursor.execute(
        f"SELECT * FROM {gr_t} WHERE parent_reply_id = {ph} ORDER BY created_at ASC",
        (reply_id,),
    )
    nested_raw = cursor.fetchall() or []
    nested_replies = [_as_row_dict(r) for r in nested_raw]
    nested_usernames = {r["username"] for r in nested_replies if r.get("username")}
    pp_map: dict[str, Any] = {}
    if nested_usernames:
        user_placeholders = ",".join([ph for _ in nested_usernames])
        cursor.execute(
            f"SELECT username, profile_picture FROM user_profiles WHERE username IN ({user_placeholders})",
            tuple(nested_usernames),
        )
        for r in cursor.fetchall() or []:
            uname = r["username"] if hasattr(r, "keys") else r[0]
            pic = r["profile_picture"] if hasattr(r, "keys") else r[1]
            pp_map[uname] = pic

    for nr in nested_replies:
        _hydrate_timestamp(nr)
        nr["profile_picture"] = pp_map.get(nr.get("username"))
        nr_counts, nr_user = get_group_reply_reaction_summary(
            cursor, int(nr["id"]), username
        )
        nr["reactions"] = nr_counts
        nr["user_reaction"] = nr_user
        try:
            nr["view_count"] = _count_group_reply_views_excluding_admin(
                cursor, ph, int(nr["id"])
            )
        except Exception:
            nr["view_count"] = 0
        cursor.execute(
            f"SELECT COUNT(*) as cnt FROM {gr_t} WHERE parent_reply_id = {ph}",
            (nr["id"],),
        )
        cnt_row = cursor.fetchone()
        nr["reply_count"] = (
            cnt_row["cnt"]
            if cnt_row and hasattr(cnt_row, "keys")
            else (cnt_row[0] if cnt_row else 0)
        )

    reply["nested_replies"] = nested_replies

    cursor.execute(
        f"SELECT COUNT(*) as cnt FROM {gr_t} WHERE parent_reply_id = {ph}",
        (reply_id,),
    )
    cnt_row = cursor.fetchone()
    reply["reply_count"] = (
        cnt_row["cnt"]
        if cnt_row and hasattr(cnt_row, "keys")
        else (cnt_row[0] if cnt_row else 0)
    )

    parent_chain: list = []
    current_parent_id = reply.get("parent_reply_id")
    while current_parent_id:
        cursor.execute(
            f"""
            SELECT id, username, content, created_at, parent_reply_id,
                   image_path, video_path, audio_path, audio_summary
            FROM {gr_t} WHERE id = {ph}
            """,
            (current_parent_id,),
        )
        parent_raw = cursor.fetchone()
        if not parent_raw:
            break
        parent_data = _as_row_dict(parent_raw)
        _hydrate_timestamp(parent_data)
        cursor.execute(
            f"SELECT profile_picture FROM user_profiles WHERE username = {ph}",
            (parent_data.get("username"),),
        )
        pp = cursor.fetchone()
        parent_data["profile_picture"] = (
            pp["profile_picture"]
            if pp and hasattr(pp, "keys")
            else (pp[0] if pp else None)
        )
        parent_chain.insert(0, parent_data)
        current_parent_id = parent_data.get("parent_reply_id")

    if post_info:
        cursor.execute(
            f"SELECT profile_picture FROM user_profiles WHERE username = {ph}",
            (post_info["username"],),
        )
        pp = cursor.fetchone()
        post_info["profile_picture"] = (
            pp["profile_picture"]
            if pp and hasattr(pp, "keys")
            else (pp[0] if pp else None)
        )

    return {
        "success": True,
        "reply": reply,
        "post": post_info,
        "parent_chain": parent_chain,
    }
