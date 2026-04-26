"""Authorization helpers for content generation."""

from __future__ import annotations

from backend.services.community import (
    is_app_admin,
    is_community_admin,
    is_community_owner,
)


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

