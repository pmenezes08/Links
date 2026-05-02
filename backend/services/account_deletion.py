"""Transactional user account removal for self-service and admin purge.

Centralizes FK-safe ordering so MySQL does not raise 1451 on ``users`` deletes.
"""

from __future__ import annotations

import logging
from enum import Enum
from typing import List, Sequence

from backend.services import remember_tokens
from backend.services.database import USE_MYSQL, get_sql_placeholder

logger = logging.getLogger(__name__)


class AccountDeletionMode(Enum):
    """SELF: reassign community/group posts to ``admin``; ADMIN: delete target's posts."""

    SELF_SERVICE = "self"
    ADMIN_PURGE = "admin"


def _gtable(base: str) -> str:
    """Quote reserved group table names on MySQL."""
    if USE_MYSQL:
        return f"`{base}`"
    return base


def _exec_optional(c, sql: str, params: Sequence) -> None:
    try:
        c.execute(sql, tuple(params))
    except Exception as e:
        logger.debug("account_deletion optional SQL skipped: %s", e)


def _former_community_ids(c, ph: str, user_id: int) -> List[int]:
    try:
        c.execute(f"SELECT community_id FROM user_communities WHERE user_id={ph}", (user_id,))
        out: List[int] = []
        for r in c.fetchall() or []:
            cid = r["community_id"] if hasattr(r, "keys") else r[0]
            if cid is not None:
                out.append(int(cid))
        return out
    except Exception:
        return []


def _purge_user_posts_admin(c, ph: str, username: str) -> None:
    """Remove posts authored by ``username`` and dependent rows (no ON DELETE CASCADE on replies)."""
    c.execute(f"SELECT id FROM posts WHERE username={ph}", (username,))
    post_ids: List[int] = []
    for row in c.fetchall() or []:
        pid = row["id"] if hasattr(row, "keys") else row[0]
        if pid is not None:
            post_ids.append(int(pid))
    for pid in post_ids:
        try:
            c.execute(
                f"DELETE FROM reply_reactions WHERE reply_id IN (SELECT id FROM replies WHERE post_id={ph})",
                (pid,),
            )
        except Exception as e:
            logger.debug("reply_reactions purge for post %s: %s", pid, e)
        try:
            c.execute(f"DELETE FROM replies WHERE post_id={ph}", (pid,))
        except Exception as e:
            logger.debug("replies purge for post %s: %s", pid, e)
        try:
            c.execute(f"DELETE FROM reactions WHERE post_id={ph}", (pid,))
        except Exception as e:
            logger.debug("reactions purge for post %s: %s", pid, e)
    c.execute(f"DELETE FROM posts WHERE username={ph}", (username,))


def _purge_group_content(c, ph: str, username: str, mode: AccountDeletionMode) -> None:
    grr = _gtable("group_reply_reactions")
    gr = _gtable("group_replies")
    gpr = _gtable("group_post_reactions")
    gp = _gtable("group_posts")
    try:
        c.execute(f"DELETE FROM {grr} WHERE username={ph}", (username,))
    except Exception as e:
        logger.debug("group_reply_reactions delete: %s", e)
    try:
        c.execute(f"DELETE FROM {gr} WHERE username={ph}", (username,))
    except Exception as e:
        logger.debug("group_replies delete: %s", e)
    try:
        c.execute(f"DELETE FROM {gpr} WHERE username={ph}", (username,))
    except Exception as e:
        logger.debug("group_post_reactions delete: %s", e)
    try:
        if mode is AccountDeletionMode.ADMIN_PURGE:
            c.execute(f"DELETE FROM {gp} WHERE username={ph}", (username,))
        else:
            c.execute(f"UPDATE {gp} SET username={ph} WHERE username={ph}", ("admin", username))
    except Exception as e:
        logger.warning("group_posts cleanup failed for %s: %s", username, e)


def delete_user_in_connection(conn, username: str, mode: AccountDeletionMode) -> List[int]:
    """Delete ``username`` and dependent rows. Caller must ``commit`` (or ``rollback``).

    Returns ``former_community_ids`` for lifecycle auto-unfreeze hooks.
    Raises on missing user or critical SQL failure.
    """
    c = conn.cursor()
    ph = get_sql_placeholder()

    c.execute(f"SELECT id FROM users WHERE username={ph}", (username,))
    row = c.fetchone()
    if not row:
        raise ValueError("user_not_found")
    user_id = row["id"] if hasattr(row, "keys") else row[0]
    user_id = int(user_id)

    former_community_ids = _former_community_ids(c, ph, user_id)

    _exec_optional(
        c,
        f"DELETE FROM notifications WHERE user_id={ph} OR from_user={ph}",
        (username, username),
    )
    _exec_optional(
        c,
        f"DELETE FROM messages WHERE sender={ph} OR receiver={ph}",
        (username, username),
    )
    _exec_optional(
        c,
        f"DELETE FROM typing_status WHERE user={ph} OR peer={ph}",
        (username, username),
    )
    _exec_optional(c, f"DELETE FROM user_login_history WHERE username={ph}", (username,))
    _exec_optional(
        c,
        f"DELETE FROM community_visit_history WHERE username={ph}",
        (username,),
    )

    _exec_optional(c, f"DELETE FROM replies WHERE username={ph}", (username,))
    _exec_optional(c, f"DELETE FROM reactions WHERE username={ph}", (username,))
    _exec_optional(c, f"DELETE FROM reply_reactions WHERE username={ph}", (username,))

    _purge_group_content(c, ph, username, mode)

    _exec_optional(
        c,
        f"DELETE FROM follows WHERE follower_username={ph} OR followed_username={ph}",
        (username, username),
    )
    _exec_optional(c, f"DELETE FROM group_members WHERE username={ph}", (username,))
    _exec_optional(c, f"DELETE FROM poll_votes WHERE username={ph}", (username,))
    _exec_optional(c, f"DELETE FROM task_assignees WHERE username={ph}", (username,))
    _exec_optional(
        c,
        f"DELETE FROM event_attendees WHERE user_id={ph}",
        (user_id,),
    )

    _exec_optional(
        c,
        f"DELETE FROM community_story_reactions WHERE username={ph}",
        (username,),
    )
    _exec_optional(
        c,
        f"DELETE FROM community_story_views WHERE username={ph}",
        (username,),
    )
    _exec_optional(c, f"DELETE FROM community_stories WHERE username={ph}", (username,))

    _exec_optional(
        c,
        f"DELETE FROM push_subscriptions WHERE username={ph}",
        (username,),
    )
    _exec_optional(c, f"DELETE FROM native_push_tokens WHERE username={ph}", (username,))
    _exec_optional(c, f"DELETE FROM fcm_tokens WHERE username={ph}", (username,))

    try:
        remember_tokens.revoke_for_user(username)
    except Exception as e:
        logger.warning("remember_tokens.revoke_for_user failed: %s", e)

    c.execute(f"DELETE FROM user_communities WHERE user_id={ph}", (user_id,))
    _exec_optional(
        c,
        f"DELETE FROM community_admins WHERE username={ph}",
        (username,),
    )

    if mode is AccountDeletionMode.ADMIN_PURGE:
        _purge_user_posts_admin(c, ph, username)
    else:
        _exec_optional(
            c,
            f"UPDATE communities SET creator_username={ph} WHERE creator_username={ph}",
            ("admin", username),
        )
        _exec_optional(
            c,
            f"UPDATE posts SET username={ph} WHERE username={ph}",
            ("admin", username),
        )
        _exec_optional(
            c,
            f"UPDATE community_invitations SET invited_by_username={ph} WHERE invited_by_username={ph}",
            ("admin", username),
        )

    try:
        c.execute(f"DELETE FROM event_rsvps WHERE username={ph}", (username,))
        c.execute(
            f"DELETE FROM event_invitations WHERE invited_username={ph} OR invited_by={ph}",
            (username, username),
        )
        c.execute(f"DELETE FROM calendar_events WHERE username={ph}", (username,))
    except Exception as e:
        logger.warning("calendar/event cleanup for %s: %s", username, e)

    _exec_optional(c, f"DELETE FROM user_profiles WHERE username={ph}", (username,))

    try:
        c.execute(f"DELETE FROM exercises WHERE username={ph}", (username,))
        c.execute(f"DELETE FROM workouts WHERE username={ph}", (username,))
        c.execute(f"DELETE FROM crossfit_entries WHERE username={ph}", (username,))
    except Exception as e:
        logger.debug("fitness tables cleanup: %s", e)

    c.execute(f"DELETE FROM users WHERE username={ph}", (username,))
    return former_community_ids


__all__ = ["AccountDeletionMode", "delete_user_in_connection"]
