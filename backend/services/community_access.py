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


def can_view_community_content(
    cursor: Any, ph: str, username: str, community_id: Any
) -> Tuple[bool, Optional[str]]:
    """Authorize READ access to a community's content (posts, replies, feed).

    Mirrors the membership policy enforced by the community feed endpoint
    (``GET /api/community_feed/<id>``) so that opening or acting on a post is
    consistent with seeing it listed in the feed: allow app admins, the
    community creator, direct members, and admins/owners of any ancestor
    community.

    A falsy ``community_id`` denotes a general / home-feed post that is not
    scoped to a community; such content remains readable (preserving existing
    behavior) and returns ``(True, None)``.

    Returns ``(allowed, reason)``. ``reason`` is ``"not_found"`` when the
    community does not exist and ``"forbidden"`` when the user lacks access;
    callers should map both to a single non-enumerating response (typically a
    404) so visibility cannot be probed by id.
    """
    if not community_id:
        return True, None
    try:
        community_id = int(community_id)
    except (TypeError, ValueError):
        return False, "not_found"

    cursor.execute(
        f"SELECT creator_username, parent_community_id FROM communities WHERE id = {ph}",
        (community_id,),
    )
    row = cursor.fetchone()
    if not row:
        return False, "not_found"
    creator_username = row["creator_username"] if hasattr(row, "keys") else row[0]
    parent_community_id = row["parent_community_id"] if hasattr(row, "keys") else row[1]

    if is_app_admin(username) or (creator_username and username == creator_username):
        return True, None

    # Direct member of this community?
    cursor.execute(
        f"""
        SELECT 1 FROM user_communities uc
        JOIN users u ON uc.user_id = u.id
        WHERE u.username = {ph} AND uc.community_id = {ph}
        LIMIT 1
        """,
        (username, community_id),
    )
    if cursor.fetchone():
        return True, None

    # Admin/owner of any ancestor community grants access to descendants.
    # ``seen`` guards against a malformed parent cycle.
    current_parent = parent_community_id
    seen: set = set()
    while current_parent and current_parent not in seen:
        seen.add(current_parent)
        cursor.execute(
            f"""
            SELECT uc.role, c.creator_username
            FROM user_communities uc
            JOIN communities c ON uc.community_id = c.id
            JOIN users u ON uc.user_id = u.id
            WHERE u.username = {ph} AND c.id = {ph}
            """,
            (username, current_parent),
        )
        ancestor = cursor.fetchone()
        if ancestor:
            role = ancestor["role"] if hasattr(ancestor, "keys") else ancestor[0]
            anc_creator = (
                ancestor["creator_username"] if hasattr(ancestor, "keys") else ancestor[1]
            )
            if role in ("admin", "owner") or (anc_creator and username == anc_creator):
                return True, None
        cursor.execute(
            f"SELECT parent_community_id FROM communities WHERE id = {ph}",
            (current_parent,),
        )
        prow = cursor.fetchone()
        current_parent = (
            (prow["parent_community_id"] if hasattr(prow, "keys") else prow[0])
            if prow
            else None
        )

    return False, "forbidden"


def _post_community_id(cursor: Any, ph: str, post_id: Any) -> Any:
    """Return a post's ``community_id`` (or None if the post is missing)."""
    if not post_id:
        return None
    cursor.execute(f"SELECT community_id FROM posts WHERE id = {ph}", (post_id,))
    row = cursor.fetchone()
    if not row:
        return None
    return row["community_id"] if hasattr(row, "keys") else row[0]


def can_view_post(cursor: Any, ph: str, username: str, post_id: Any) -> Tuple[bool, Optional[str]]:
    """Authorize read/act access to a post by id (resolves its community).

    A missing post resolves to a falsy community and is left to the caller's own
    existence check; a real community gates on membership. See
    :func:`can_view_community_content`.
    """
    return can_view_community_content(
        cursor, ph, username, _post_community_id(cursor, ph, post_id)
    )


def can_view_reply(cursor: Any, ph: str, username: str, reply_id: Any) -> Tuple[bool, Optional[str]]:
    """Authorize read/act access to a reply by id (via its parent post's community)."""
    if not reply_id:
        return True, None
    cursor.execute(f"SELECT post_id FROM replies WHERE id = {ph}", (reply_id,))
    row = cursor.fetchone()
    post_id = (row["post_id"] if hasattr(row, "keys") else row[0]) if row else None
    return can_view_post(cursor, ph, username, post_id)


def can_view_poll(cursor: Any, ph: str, username: str, poll_id: Any) -> Tuple[bool, Optional[str]]:
    """Authorize read/act access to a poll by id (via its post's community)."""
    if not poll_id:
        return True, None
    cursor.execute(f"SELECT post_id FROM polls WHERE id = {ph}", (poll_id,))
    row = cursor.fetchone()
    post_id = (row["post_id"] if hasattr(row, "keys") else row[0]) if row else None
    return can_view_post(cursor, ph, username, post_id)


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
