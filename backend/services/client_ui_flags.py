"""Durable client UX flags stored in the DB (one-time modals / tours).

LocalStorage alone is unreliable (private mode, multi-device, login on new
browser). These columns back /api/profile_me and explicit mark-* endpoints.
"""

from __future__ import annotations


def ensure_user_ui_columns(cursor) -> None:
    """Idempotent schema for per-user tour flags."""
    for stmt in (
        "ALTER TABLE users ADD COLUMN communities_spotlight_tour_seen TINYINT(1) DEFAULT 0",
    ):
        try:
            cursor.execute(stmt)
        except Exception:
            pass


def ensure_community_ui_columns(cursor) -> None:
    """Idempotent schema for per-community owner feed onboarding."""
    for stmt in (
        "ALTER TABLE communities ADD COLUMN owner_feed_setup_intro_seen TINYINT(1) DEFAULT 0",
    ):
        try:
            cursor.execute(stmt)
        except Exception:
            pass
