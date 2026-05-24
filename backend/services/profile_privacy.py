"""Profile visibility gates shared by profile and username lookup routes."""

from __future__ import annotations

from typing import Any, Optional, Set

from backend.services.database import get_db_connection, get_sql_placeholder


_MAX_PARENT_DEPTH = 32


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
    try:
        ph = get_sql_placeholder()
        cursor.execute(
            f"SELECT is_admin FROM users WHERE LOWER(username) = LOWER({ph})",
            (username,),
        )
        row = cursor.fetchone()
        return bool(_row_value(row, "is_admin", 0))
    except Exception:
        return False


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

    try:
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
    except Exception:
        return set()


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

    if cursor is None:
        with get_db_connection() as conn:
            return can_view_profile(viewer, target, conn.cursor())

    if is_app_admin_username(cursor, viewer):
        return True
    return share_any_community(viewer, target, cursor)
