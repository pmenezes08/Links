"""Profile visibility gates shared by profile and username lookup routes."""

from __future__ import annotations

from typing import Any, Optional, Set

from backend.services.database import get_db_connection, get_sql_placeholder


_MAX_PARENT_DEPTH = 32

# Product/system DM peers — not community members but always reachable in DMs.
_SYSTEM_DM_PEER_USERNAMES = frozenset({"steve"})


def _row_value(row: Any, key: str, idx: int) -> Any:
    if row is None:
        return None
    try:
        if hasattr(row, "keys") and key in row.keys():
            return row[key]
    except Exception:
        pass
    try:
        return row[idx]
    except Exception:
        return None


def _normalize_username(username: Optional[str]) -> str:
    return str(username or "").strip().lower()


def is_system_dm_peer_username(username: Optional[str]) -> bool:
    """Return true for built-in DM peers (e.g. Steve) that are not in user communities."""
    return _normalize_username(username) in _SYSTEM_DM_PEER_USERNAMES


def resolve_username_case(cursor: Any, username: str) -> Optional[str]:
    """Return the stored username casing for a case-insensitive lookup."""
    username = str(username or "").strip()
    if not username:
        return None
    ph = get_sql_placeholder()
    cursor.execute(
        f"SELECT username FROM users WHERE LOWER(username) = LOWER({ph})",
        (username,),
    )
    row = cursor.fetchone()
    return _row_value(row, "username", 0)


def is_app_admin_username(cursor: Any, username: Optional[str]) -> bool:
    """Check the global admin flag without opening a second DB connection."""
    norm = _normalize_username(username)
    if not norm:
        return False
    if norm == "admin":
        return True
    ph = get_sql_placeholder()
    cursor.execute(
        f"SELECT is_admin FROM users WHERE LOWER(username) = LOWER({ph})",
        (username,),
    )
    row = cursor.fetchone()
    return bool(_row_value(row, "is_admin", 0))


def _resolve_root_community_id(cursor: Any, community_id: Any) -> Optional[int]:
    try:
        current = int(community_id)
    except (TypeError, ValueError):
        return None

    ph = get_sql_placeholder()
    seen: Set[int] = set()
    for _ in range(_MAX_PARENT_DEPTH):
        if current in seen:
            break
        seen.add(current)
        cursor.execute(
            f"SELECT parent_community_id FROM communities WHERE id = {ph}",
            (current,),
        )
        row = cursor.fetchone()
        if not row:
            break
        parent = _row_value(row, "parent_community_id", 0)
        if parent is None or parent == "":
            break
        try:
            current = int(parent)
        except (TypeError, ValueError):
            break
    return current


def user_root_community_ids(cursor: Any, username: str) -> Set[int]:
    """Return root networks a user belongs to or owns.

    Ownership is included because older community rows can have
    ``creator_username`` without a matching ``user_communities`` row.
    """
    username = str(username or "").strip()
    if not username:
        return set()

    ph = get_sql_placeholder()
    cursor.execute(
        f"""
        SELECT DISTINCT community_id
        FROM (
            SELECT uc.community_id AS community_id
            FROM user_communities uc
            JOIN users u ON u.id = uc.user_id
            WHERE LOWER(u.username) = LOWER({ph})
            UNION
            SELECT c.id AS community_id
            FROM communities c
            WHERE LOWER(c.creator_username) = LOWER({ph})
        ) roots
        """,
        (username, username),
    )
    roots: Set[int] = set()
    for row in cursor.fetchall() or []:
        root_id = _resolve_root_community_id(cursor, _row_value(row, "community_id", 0))
        if root_id is not None:
            roots.add(root_id)
    return roots


def share_any_community(
    viewer_username: str,
    target_username: str,
    cursor: Any,
) -> bool:
    """Return true when viewer and target share at least one root network."""
    viewer_roots = user_root_community_ids(cursor, viewer_username)
    if not viewer_roots:
        return False
    target_roots = user_root_community_ids(cursor, target_username)
    return bool(viewer_roots.intersection(target_roots))


def has_pending_join_request_to_managed_community(
    viewer_username: str,
    target_username: str,
    cursor: Any,
) -> bool:
    """True while ``target`` has a *pending* join request to a community
    ``viewer`` manages (creator or owner/admin role).

    Knocking on the door is consent to be looked at by the people deciding:
    the deciding admins may open the requester's profile while the request
    is pending. The grant expires with the decision — accept converges to
    the shared-community rule, reject/withdraw closes the door again.
    """
    viewer = str(viewer_username or "").strip()
    target = str(target_username or "").strip()
    if not viewer or not target:
        return False
    ph = get_sql_placeholder()
    try:
        cursor.execute(
            f"""
            SELECT 1
            FROM community_join_requests r
            JOIN communities c2 ON c2.id = r.community_id
            WHERE LOWER(r.username) = LOWER({ph}) AND r.status = 'pending'
              AND (
                    LOWER(c2.creator_username) = LOWER({ph})
                    OR EXISTS (
                        SELECT 1 FROM user_communities uc
                        JOIN users au ON uc.user_id = au.id
                        WHERE uc.community_id = r.community_id
                          AND LOWER(au.username) = LOWER({ph})
                          AND uc.role IN ('owner', 'admin')
                    )
                  )
            LIMIT 1
            """,
            (target, viewer, viewer),
        )
        return cursor.fetchone() is not None
    except Exception:
        # Table is created lazily by community_join_requests.ensure_tables();
        # its absence means no requests exist — never widen access on error.
        return False


def can_view_profile(
    viewer_username: Optional[str],
    target_username: str,
    cursor: Optional[Any] = None,
) -> bool:
    """Authorize profile or profile-derived lookup access."""
    viewer = str(viewer_username or "").strip()
    target = str(target_username or "").strip()
    if not viewer or not target:
        return False
    if _normalize_username(viewer) == _normalize_username(target):
        return True
    if is_system_dm_peer_username(target):
        return True

    if cursor is None:
        with get_db_connection() as conn:
            return can_view_profile(viewer, target, conn.cursor())

    if is_app_admin_username(cursor, viewer):
        return True
    if share_any_community(viewer, target, cursor):
        return True
    return has_pending_join_request_to_managed_community(viewer, target, cursor)
