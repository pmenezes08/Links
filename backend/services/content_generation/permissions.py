"""Authorization helpers for content generation."""

from __future__ import annotations

from backend.services.community import is_community_admin, is_community_owner
from backend.services.database import get_db_connection


def is_app_admin(username: str | None) -> bool:
    normalized = (username or "").strip().lower()
    if not normalized:
        return False
    if normalized == "admin":
        return True
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT is_admin FROM users WHERE username = ?", (username,))
            row = c.fetchone()
            if not row:
                return False
            value = row["is_admin"] if hasattr(row, "keys") else row[0]
            return bool(value)
    except Exception:
        return False


def can_manage_community_jobs(username: str | None, community_id: int) -> bool:
    normalized = (username or "").strip()
    if not normalized or not community_id:
        return False
    return bool(
        is_app_admin(normalized)
        or is_community_owner(normalized, community_id)
        or is_community_admin(normalized, community_id)
    )


def can_manage_member_jobs(username: str | None) -> bool:
    return is_app_admin(username)

