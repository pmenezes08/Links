"""Community and group access checks for useful resource mutations."""

from __future__ import annotations

from typing import Any, Optional, Tuple

from backend.services.community import is_app_admin
from backend.services.group_feed_access import check_group_feed_access


def user_is_member_of_community(cursor: Any, ph: str, username: str, community_id: int) -> bool:
    """Return True when ``username`` belongs to ``community_id`` (or its parent)."""
    if not username or not community_id:
        return False
    cursor.execute(
        f"""
        SELECT 1 FROM user_communities uc
        JOIN users u ON uc.user_id = u.id
        WHERE u.username = {ph} AND uc.community_id = {ph}
        """,
        (username, int(community_id)),
    )
    if cursor.fetchone():
        return True

    cursor.execute(f"SELECT parent_community_id FROM communities WHERE id = {ph}", (int(community_id),))
    row = cursor.fetchone()
    if not row:
        return False
    parent_id = row["parent_community_id"] if hasattr(row, "keys") else row[0]
    if not parent_id:
        return False
    cursor.execute(
        f"""
        SELECT 1 FROM user_communities uc
        JOIN users u ON uc.user_id = u.id
        WHERE u.username = {ph} AND uc.community_id = {ph}
        """,
        (username, int(parent_id)),
    )
    return cursor.fetchone() is not None


def user_is_member_of_community_tree(cursor: Any, ph: str, username: str, community_id: int) -> bool:
    """Return True when ``username`` belongs to ``community_id`` or any of its
    direct sub-communities.

    This mirrors the roster scope the networking surfaces load (the community
    plus its children), so authorization and data exposure cover the exact
    same set. Used as the server-side gate for the Steve networking routes —
    profile visibility is an authorization decision (AGENTS.md § Privacy).
    """
    if not username or not community_id:
        return False
    try:
        community_id = int(community_id)
    except (TypeError, ValueError):
        return False
    cursor.execute(
        f"SELECT id FROM communities WHERE id = {ph} OR parent_community_id = {ph}",
        (community_id, community_id),
    )
    ids = [(r["id"] if hasattr(r, "keys") else r[0]) for r in cursor.fetchall()]
    if not ids:
        return False
    comm_ph = ",".join([ph] * len(ids))
    cursor.execute(
        f"""
        SELECT 1 FROM user_communities uc
        JOIN users u ON uc.user_id = u.id
        WHERE u.username = {ph} AND uc.community_id IN ({comm_ph})
        """,
        (username, *ids),
    )
    return cursor.fetchone() is not None


def check_useful_resource_mutation_access(
    cursor: Any,
    ph: str,
    username: str,
    *,
    community_id_raw: str | None,
    group_id_int: int | None,
) -> Tuple[bool, Optional[str]]:
    """Authorize create/upload mutations for useful links and docs."""
    if group_id_int is not None:
        return check_group_feed_access(cursor, ph, username, int(group_id_int))

    community_id_raw = (community_id_raw or "").strip()
    if not community_id_raw:
        return True, None

    try:
        community_id = int(community_id_raw)
    except (TypeError, ValueError):
        return False, "Invalid community_id"

    if is_app_admin(username) or user_is_member_of_community(cursor, ph, username, community_id):
        return True, None
    return False, "Forbidden"
