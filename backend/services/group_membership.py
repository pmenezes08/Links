"""Group join-request management (approval-required groups).

``/api/groups/join`` writes ``group_members.status = 'pending'`` for
approval-required groups, but until July 2026 nothing surfaced those rows
to anyone who could act on them — requests sat pending forever. This
module gives the group-management surfaces (the rebuilt Groups tab) their
read/decide primitives.

Authorization mirrors group creation/deletion: the group's creator, the
app admin, or an owner/admin of the owning community (or its root
network) — resolved by the caller through
:func:`backend.services.community.can_create_group_in_community`.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from backend.services.database import USE_MYSQL, get_sql_placeholder


logger = logging.getLogger(__name__)

_GM_TABLE = "`group_members`" if USE_MYSQL else "group_members"
_G_TABLE = "`groups`" if USE_MYSQL else "groups"


def get_group_basic(cursor, group_id: int) -> Optional[Dict[str, Any]]:
    """Return ``{id, name, community_id, created_by, approval_required}`` or None."""
    ph = get_sql_placeholder()
    cursor.execute(
        f"SELECT id, name, community_id, created_by, approval_required FROM {_G_TABLE} WHERE id = {ph}",
        (int(group_id),),
    )
    row = cursor.fetchone()
    if not row:
        return None

    def g(key: str, idx: int) -> Any:
        return row[key] if hasattr(row, "keys") else row[idx]

    return {
        "id": int(g("id", 0)),
        "name": g("name", 1),
        "community_id": g("community_id", 2),
        "created_by": g("created_by", 3),
        "approval_required": bool(g("approval_required", 4) or 0),
    }


def list_pending_requests(cursor, group_id: int) -> List[Dict[str, Any]]:
    """Pending join requests for a group, oldest first.

    ``group_members`` stamps rows with ``created_at``; environments whose
    table predates that column fall back to id order without a timestamp.
    """
    ph = get_sql_placeholder()
    try:
        cursor.execute(
            f"""
            SELECT username, created_at FROM {_GM_TABLE}
            WHERE group_id = {ph} AND status = 'pending'
            ORDER BY id ASC
            """,
            (int(group_id),),
        )
        rows = cursor.fetchall() or []
        with_ts = True
    except Exception:
        cursor.execute(
            f"""
            SELECT username FROM {_GM_TABLE}
            WHERE group_id = {ph} AND status = 'pending'
            ORDER BY id ASC
            """,
            (int(group_id),),
        )
        rows = cursor.fetchall() or []
        with_ts = False
    out: List[Dict[str, Any]] = []
    for row in rows:
        username = row["username"] if hasattr(row, "keys") else row[0]
        requested_at = None
        if with_ts:
            raw = row["created_at"] if hasattr(row, "keys") else row[1]
            requested_at = str(raw) if raw else None
        out.append({"username": username, "requested_at": requested_at})
    return out


def decide_request(cursor, group_id: int, username: str, *, approve: bool) -> bool:
    """Approve (→ member) or deny (row removed) one pending request.

    Returns False when no pending row existed — idempotent, so a double-tap
    or a race with the requester withdrawing never errors.
    """
    if not username:
        return False
    ph = get_sql_placeholder()
    if approve:
        cursor.execute(
            f"""
            UPDATE {_GM_TABLE} SET status = 'member'
            WHERE group_id = {ph} AND username = {ph} AND status = 'pending'
            """,
            (int(group_id), username),
        )
    else:
        cursor.execute(
            f"""
            DELETE FROM {_GM_TABLE}
            WHERE group_id = {ph} AND username = {ph} AND status = 'pending'
            """,
            (int(group_id), username),
        )
    try:
        return int(cursor.rowcount or 0) > 0
    except Exception:
        return True
