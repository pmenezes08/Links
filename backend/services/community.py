"""Community-related helper utilities shared across the backend."""

from __future__ import annotations

import logging
from collections import deque
from typing import Any, Dict, List, Optional, Set, Tuple

from backend.services.database import get_db_connection, get_sql_placeholder


logger = logging.getLogger(__name__)


def is_community_owner(username, community_id):
    """Check if a user is the owner of a community."""
    norm_username = (username or "").strip().lower()
    if not norm_username or not community_id:
        return False

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(f"SELECT creator_username FROM communities WHERE id = {ph}", (community_id,))
            result = c.fetchone()
            if not result:
                return False
            creator = result["creator_username"] if hasattr(result, "keys") else result[0]
            return bool(creator and str(creator).strip().lower() == norm_username)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("is_community_owner failed: %s", exc)
        return False


def is_community_admin(username, community_id):
    """Check if a user is an admin of a community."""
    norm_username = (username or "").strip().lower()
    if not norm_username or not community_id:
        return False

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            try:
                c.execute(
                    f"""
                    SELECT uc.role
                    FROM user_communities uc
                    JOIN users u ON uc.user_id = u.id
                    WHERE LOWER(u.username) = LOWER({ph}) AND uc.community_id = {ph}
                    """,
                    (username, community_id),
                )
                row = c.fetchone()
                if row:
                    role = row["role"] if hasattr(row, "keys") else row[0]
                    normalized_role = (role or "").strip().lower()
                    if normalized_role in {"admin", "owner", "moderator", "manager"}:
                        return True
            except Exception:
                pass

            c.execute(
                f"SELECT 1 FROM community_admins WHERE community_id = {ph} AND LOWER(username) = LOWER({ph})",
                (community_id, username),
            )
            return c.fetchone() is not None
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("is_community_admin failed: %s", exc)
        return False


def get_parent_chain_ids(cursor, community_id: int) -> List[int]:
    """Return ordered list of parent community IDs (direct parent first) up to root."""
    parents: List[int] = []
    visited: set[int] = set()
    current = community_id
    placeholder = get_sql_placeholder()
    while current:
        cursor.execute(f"SELECT parent_community_id FROM communities WHERE id = {placeholder}", (current,))
        row = cursor.fetchone()
        if not row:
            break
        parent_id = row["parent_community_id"] if hasattr(row, "keys") else row[0]
        if not parent_id or parent_id in visited:
            break
        visited.add(parent_id)
        parents.append(parent_id)
        current = parent_id
    return parents


def fetch_community_names(cursor, community_ids: List[int]) -> List[str]:
    """Fetch community names preserving order of provided IDs."""
    ids = [cid for cid in community_ids if cid is not None]
    if not ids:
        return []
    placeholders = ",".join([get_sql_placeholder()] * len(ids))
    cursor.execute(f"SELECT id, name FROM communities WHERE id IN ({placeholders})", tuple(ids))
    rows = cursor.fetchall()
    id_to_name: Dict[int, str] = {}
    for row in rows:
        cid = row["id"] if hasattr(row, "keys") else row[0]
        name = row["name"] if hasattr(row, "keys") else row[1]
        id_to_name[cid] = name
    return [id_to_name[cid] for cid in ids if cid in id_to_name]


def get_community_basic(cursor, community_id: int) -> Optional[Dict[str, Any]]:
    placeholder = get_sql_placeholder()
    cursor.execute(
        f"SELECT id, creator_username, parent_community_id FROM communities WHERE id = {placeholder}",
        (community_id,),
    )
    row = cursor.fetchone()
    if not row:
        return None
    if hasattr(row, "keys"):
        return {
            "id": row.get("id"),
            "creator_username": row.get("creator_username"),
            "parent_community_id": row.get("parent_community_id"),
        }
    return {
        "id": row[0] if len(row) > 0 else None,
        "creator_username": row[1] if len(row) > 1 else None,
        "parent_community_id": row[2] if len(row) > 2 else None,
    }


def get_community_ancestors(cursor, community_id: int) -> List[Dict[str, Any]]:
    """Return list of ancestor community records starting from the specified community."""
    ancestors: List[Dict[str, Any]] = []
    current_id = community_id
    visited: Set[int] = set()
    while current_id:
        if current_id in visited:
            break
        visited.add(current_id)
        info = get_community_basic(cursor, current_id)
        if not info:
            break
        ancestors.append(info)
        current_id = info.get("parent_community_id")
    return ancestors


def get_descendant_community_ids(cursor, community_id: int) -> List[int]:
    """Return descendant community IDs (including the provided one) ordered deepest-first."""
    try:
        queue = deque([(community_id, 0)])
        pop_left = True
    except Exception:  # pragma: no cover - fallback for limited environments
        queue = [(community_id, 0)]  # type: ignore
        pop_left = False

    seen: Set[int] = set()
    results: List[Tuple[int, int]] = []

    while queue:
        if pop_left:
            current_id, depth = queue.popleft()  # type: ignore
        else:  # pragma: no cover - fallback branch
            current_id, depth = queue.pop(0)  # type: ignore

        if current_id in seen:
            continue
        seen.add(current_id)
        results.append((current_id, depth))

        placeholder = get_sql_placeholder()
        try:
            cursor.execute(f"SELECT id FROM communities WHERE parent_community_id = {placeholder}", (current_id,))
            rows = cursor.fetchall() or []
        except Exception as child_err:
            logger.warning("Failed to load child communities for %s: %s", current_id, child_err)
            rows = []

        for row in rows:
            child_id = row["id"] if hasattr(row, "keys") else row[0]
            if child_id and child_id not in seen:
                if pop_left:
                    queue.append((child_id, depth + 1))  # type: ignore
                else:  # pragma: no cover - fallback branch
                    queue.append((child_id, depth + 1))  # type: ignore

    results.sort(key=lambda item: item[1], reverse=True)
    return [cid for cid, _ in results]
