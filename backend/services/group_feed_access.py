"""Exclusive access control for community-anchored group feeds (group_posts / group_replies).

Members with ``group_members.status == 'member'`` may access content. App admins,
community owners/admins for the group's ``community_id``, and the group's ``created_by``
may also access (moderation / ownership).
"""

from __future__ import annotations

from typing import Optional, Tuple

from backend.services.database import USE_MYSQL
from backend.services.community import is_app_admin, is_community_admin, is_community_owner

GROUPS_TABLE = "`groups`" if USE_MYSQL else "groups"
GROUP_MEMBERS_TABLE = "`group_members`" if USE_MYSQL else "group_members"


def check_group_feed_access(
    cursor,
    ph: str,
    username: str,
    group_id: int,
) -> Tuple[bool, Optional[str]]:
    """
    Returns (allowed, error_message). error_message is suitable for JSON ``error``.
    """
    cursor.execute(
        f"SELECT community_id, created_by FROM {GROUPS_TABLE} WHERE id = {ph}",
        (group_id,),
    )
    row = cursor.fetchone()
    if not row:
        return False, "Group not found"
    community_id = row["community_id"] if hasattr(row, "keys") else row[0]
    created_by = row["created_by"] if hasattr(row, "keys") else row[1]

    if is_app_admin(username):
        return True, None
    try:
        cid = int(community_id) if community_id is not None else None
    except (TypeError, ValueError):
        cid = None
    if cid is not None:
        if is_community_owner(username, cid) or is_community_admin(username, cid):
            return True, None
    if created_by and username == created_by:
        return True, None

    cursor.execute(
        f"SELECT status FROM {GROUP_MEMBERS_TABLE} WHERE group_id = {ph} AND username = {ph}",
        (group_id, username),
    )
    m = cursor.fetchone()
    status = m["status"] if m and hasattr(m, "keys") else (m[0] if m else None)
    if status == "member":
        return True, None
    return False, "Not a member of this group"


def fetch_group_id_for_group_post(cursor, ph: str, group_post_id: int) -> Optional[int]:
    gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
    cursor.execute(f"SELECT group_id FROM {gp_t} WHERE id = {ph}", (group_post_id,))
    row = cursor.fetchone()
    if not row:
        return None
    return int(row["group_id"] if hasattr(row, "keys") else row[0])


def fetch_group_id_for_group_reply(cursor, ph: str, group_reply_id: int) -> Optional[int]:
    gr_t = "`group_replies`" if USE_MYSQL else "group_replies"
    gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
    cursor.execute(
        f"SELECT gp.group_id FROM {gr_t} gr JOIN {gp_t} gp ON gp.id = gr.group_post_id "
        f"WHERE gr.id = {ph}",
        (group_reply_id,),
    )
    row = cursor.fetchone()
    if not row:
        return None
    return int(row["group_id"] if hasattr(row, "keys") else row[0])


def check_group_feed_access_for_group_post(
    cursor, ph: str, username: str, group_post_id: int
) -> Tuple[bool, Optional[str], Optional[int]]:
    """Returns (allowed, error_message, group_id)."""
    gid = fetch_group_id_for_group_post(cursor, ph, group_post_id)
    if gid is None:
        return False, "Post not found", None
    ok, err = check_group_feed_access(cursor, ph, username, gid)
    return ok, err, gid
