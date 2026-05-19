"""Shared helpers for validating Flask session usernames."""

from __future__ import annotations

import logging
from typing import Optional

from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)


def user_exists(username: Optional[str]) -> bool:
    """Return True only when the session username still has a users row."""
    if not username:
        return False
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(f"SELECT 1 FROM users WHERE username = {ph} LIMIT 1", (str(username),))
        return c.fetchone() is not None


def current_session_username(session_obj) -> Optional[str]:
    """Read the current username from a Flask session-like object."""
    username = session_obj.get("username")
    return str(username) if username else None


def clear_invalid_session(session_obj, username: Optional[str] = None) -> None:
    """Clear a ghost session and best-effort invalidate user-scoped caches."""
    stale_username = username or current_session_username(session_obj)
    try:
        session_obj.clear()
        session_obj.permanent = False
    except Exception:
        logger.exception("Failed to clear invalid session for %s", stale_username)

    if stale_username:
        try:
            from redis_cache import invalidate_user_cache

            invalidate_user_cache(stale_username)
        except Exception:
            logger.debug("Failed to invalidate cache for stale session user %s", stale_username, exc_info=True)


def valid_session_username(session_obj, *, clear_missing: bool = True) -> Optional[str]:
    """Return a valid session username, clearing the session if the user disappeared."""
    username = current_session_username(session_obj)
    if not username:
        return None
    if user_exists(username):
        return username
    if clear_missing:
        clear_invalid_session(session_obj, username)
    return None


__all__ = [
    "clear_invalid_session",
    "current_session_username",
    "user_exists",
    "valid_session_username",
]
