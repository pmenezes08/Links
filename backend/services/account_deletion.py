"""Transactional user account removal for self-service and admin purge.

Centralizes FK-safe ordering so MySQL does not raise 1451 on ``users`` deletes.
"""

from __future__ import annotations

import logging
from enum import Enum
from typing import Any, List, Optional, Sequence

from backend.services import remember_tokens
from backend.services.database import USE_MYSQL, get_sql_placeholder

logger = logging.getLogger(__name__)

FIRESTORE_USER_STATE_COLLECTIONS = ("steve_onboarding", "steve_user_profiles")

# ---------------------------------------------------------------------------
# Firestore helpers — DM and group-chat cleanup on account deletion
# ---------------------------------------------------------------------------

def _delete_firestore_dm_convs(username: str, peers: List[str], db: Optional[Any] = None) -> None:
    """Delete all DM conversation documents (and their messages subcollection) where username was a participant."""
    if not peers:
        return
    try:
        fs = db
        if fs is None:
            from backend.services.firestore_reads import _get_client
            fs = _get_client()
        for peer in peers:
            a, b = sorted([username.lower(), peer.lower()])
            conv_id = f"{a}_{b}"
            conv_ref = fs.collection("dm_conversations").document(conv_id)
            try:
                for msg_doc in conv_ref.collection("messages").stream():
                    msg_doc.reference.delete()
            except Exception as e:
                logger.warning("dm_conversations/messages delete failed conv=%s: %s", conv_id, e)
            try:
                conv_ref.delete()
            except Exception as e:
                logger.warning("dm_conversations delete failed conv=%s: %s", conv_id, e)
    except Exception as e:
        logger.warning("_delete_firestore_dm_convs failed for %s: %s", username, e)


def _delete_firestore_group_sender_messages(username: str, group_ids: List[int], db: Optional[Any] = None) -> None:
    """Delete this user's messages from each group's Firestore chat document."""
    if not group_ids:
        return
    try:
        fs = db
        if fs is None:
            from backend.services.firestore_reads import _get_client
            fs = _get_client()
        for gid in group_ids:
            try:
                msgs_ref = fs.collection("group_chats").document(str(gid)).collection("messages")
                for msg_doc in msgs_ref.where("sender", "==", username).stream():
                    msg_doc.reference.delete()
            except Exception as e:
                logger.warning("group_chats/messages delete failed gid=%s user=%s: %s", gid, username, e)
    except Exception as e:
        logger.warning("_delete_firestore_group_sender_messages failed for %s: %s", username, e)


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


def delete_firestore_user_state(username: str, db: Optional[Any] = None) -> int:
    """Best-effort cleanup for Firestore docs keyed by username."""
    if not username:
        return 0
    try:
        fs = db
        if fs is None:
            from backend.services.firestore_reads import _get_client

            fs = _get_client()
        deleted = 0
        for collection in FIRESTORE_USER_STATE_COLLECTIONS:
            fs.collection(collection).document(username).delete()
            deleted += 1
        return deleted
    except Exception as e:
        logger.warning("firestore account state cleanup failed for %s: %s", username, e)
        return 0


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
    grv = _gtable("group_reply_views")
    try:
        c.execute(f"DELETE FROM {grv} WHERE username={ph}", (username,))
    except Exception as e:
        logger.debug("group_reply_views delete: %s", e)
    gpv = _gtable("group_post_views")
    try:
        c.execute(f"DELETE FROM {gpv} WHERE username={ph}", (username,))
    except Exception as e:
        logger.debug("group_post_views delete: %s", e)
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

    c.execute(f"SELECT id, email FROM users WHERE username={ph}", (username,))
    row = c.fetchone()
    if not row:
        raise ValueError("user_not_found")
    user_id = row["id"] if hasattr(row, "keys") else row[0]
    user_email = (row["email"] if hasattr(row, "keys") else (row[1] if len(row) > 1 else "")) or ""
    user_id = int(user_id)

    # Collect data for out-of-band cleanup before MySQL rows are removed.
    dm_peers: List[str] = []
    try:
        c.execute(
            f"SELECT DISTINCT CASE WHEN LOWER(sender)=LOWER({ph}) THEN receiver ELSE sender END AS peer"
            f" FROM messages WHERE LOWER(sender)=LOWER({ph}) OR LOWER(receiver)=LOWER({ph})",
            (username, username, username),
        )
        for r in c.fetchall() or []:
            peer = (r["peer"] if hasattr(r, "keys") else r[0]) or ""
            if peer:
                dm_peers.append(peer)
    except Exception as e:
        logger.warning("dm_peers collection failed for %s: %s", username, e)

    group_ids: List[int] = []
    try:
        c.execute(f"SELECT group_id FROM group_members WHERE username={ph}", (username,))
        for r in c.fetchall() or []:
            gid = r["group_id"] if hasattr(r, "keys") else r[0]
            if gid is not None:
                group_ids.append(int(gid))
    except Exception as e:
        logger.warning("group_ids collection failed for %s: %s", username, e)

    cv_r2_key: Optional[str] = None
    try:
        c.execute(f"SELECT professional_cv_r2_key FROM users WHERE username={ph}", (username,))
        cv_row = c.fetchone()
        if cv_row:
            cv_r2_key = (cv_row["professional_cv_r2_key"] if hasattr(cv_row, "keys") else cv_row[0]) or None
    except Exception as e:
        logger.warning("cv_r2_key fetch failed for %s: %s", username, e)

    former_community_ids = _former_community_ids(c, ph, user_id)
    delete_firestore_user_state(username)
    _delete_firestore_dm_convs(username, dm_peers)
    _delete_firestore_group_sender_messages(username, group_ids)

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
        f"""
        UPDATE community_invitations
        SET status='cancelled', responded_at=CURRENT_TIMESTAMP
        WHERE used=0
          AND COALESCE(status, 'pending')='pending'
          AND (LOWER(invited_username)=LOWER({ph}) OR LOWER(invited_email)=LOWER({ph}))
        """,
        (username, user_email),
    )
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

    _exec_optional(c, f"DELETE FROM ai_usage_log WHERE username={ph}", (username,))
    _exec_optional(c, f"DELETE FROM steve_chat_sessions WHERE username={ph}", (username,))
    _exec_optional(c, f"DELETE FROM steve_recommendation_feedback WHERE username={ph}", (username,))

    c.execute(f"DELETE FROM users WHERE username={ph}", (username,))

    if cv_r2_key:
        try:
            from backend.services.r2_storage import delete_from_r2
            delete_from_r2(cv_r2_key)
        except Exception as e:
            logger.warning("CV R2 delete failed for %s: %s", username, e)

    return former_community_ids


__all__ = [
    "AccountDeletionMode",
    "delete_firestore_user_state",
    "delete_user_in_connection",
    "_delete_firestore_dm_convs",
    "_delete_firestore_group_sender_messages",
]
