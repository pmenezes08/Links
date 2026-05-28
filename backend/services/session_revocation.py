"""Per-user session version for server-side invalidation of client-signed cookies.

When a user logs out (or changes their password), their session_version is
bumped. On the next request from any other device holding a stale cookie,
the version mismatch triggers a session.clear() — forcing re-authentication.

Redis is used as a short-TTL cache (60 s) to avoid a DB hit on every request.
If Redis is unavailable, falls back to MySQL. If both are down, fails open
(the app behaves as before — no new single point of failure).
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

_SESSION_VERSION_KEY = "session_ver:{}"
_CACHE_TTL = 60  # seconds

_tables_ensured = False


def _ensure_columns() -> None:
    """Add session_version + session_invalidated_at to users if missing."""
    global _tables_ensured
    if _tables_ensured:
        return
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            if USE_MYSQL:
                c.execute(
                    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' "
                    "AND COLUMN_NAME = 'session_version'"
                )
                if not c.fetchone():
                    c.execute(
                        "ALTER TABLE users "
                        "ADD COLUMN session_version INT UNSIGNED NOT NULL DEFAULT 1, "
                        "ADD COLUMN session_invalidated_at DATETIME DEFAULT NULL"
                    )
                    conn.commit()
                    logger.info("session_revocation: added session_version + session_invalidated_at columns")
            else:
                try:
                    c.execute("SELECT session_version FROM users LIMIT 1")
                except Exception:
                    c.execute("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1")
                    c.execute("ALTER TABLE users ADD COLUMN session_invalidated_at TEXT DEFAULT NULL")
                    conn.commit()
                    logger.info("session_revocation: added columns (sqlite)")
        _tables_ensured = True
    except Exception as exc:
        logger.warning("session_revocation._ensure_columns failed: %s", exc)
        _tables_ensured = True


def _get_cache():
    """Lazy import redis_cache to avoid circular imports at module load."""
    try:
        from redis_cache import cache
        if cache and cache.enabled:
            return cache
    except Exception:
        pass
    return None


def get_session_version(username: str) -> int:
    """Return the current session_version for a user (Redis → MySQL → default 1)."""
    if not username:
        return 1

    cache = _get_cache()
    cache_key = _SESSION_VERSION_KEY.format(username)

    if cache:
        try:
            cached = cache.get(cache_key)
            if cached is not None:
                return int(cached)
        except Exception:
            pass

    _ensure_columns()
    version = 1
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(
                f"SELECT session_version FROM users WHERE username={ph} LIMIT 1",
                (username,),
            )
            row = c.fetchone()
            if row:
                version = int(row["session_version"] if isinstance(row, dict) else row[0]) or 1
    except Exception as exc:
        logger.warning("session_revocation.get_session_version DB error: %s", exc)
        return 1

    if cache:
        try:
            cache.set(cache_key, version, _CACHE_TTL)
        except Exception:
            pass

    return version


def bump_session_version(username: Optional[str]) -> int:
    """Increment session_version and set session_invalidated_at. Returns new version."""
    if not username:
        return 0
    _ensure_columns()

    new_version = 1
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            now = datetime.utcnow()
            c.execute(
                f"UPDATE users SET session_version = session_version + 1, "
                f"session_invalidated_at = {ph} WHERE username = {ph}",
                (now, username),
            )
            conn.commit()
            c.execute(
                f"SELECT session_version FROM users WHERE username={ph} LIMIT 1",
                (username,),
            )
            row = c.fetchone()
            if row:
                new_version = int(row["session_version"] if isinstance(row, dict) else row[0]) or 1
    except Exception as exc:
        logger.warning("session_revocation.bump_session_version DB error: %s", exc)
        return 0

    cache = _get_cache()
    if cache:
        try:
            cache.delete(_SESSION_VERSION_KEY.format(username))
        except Exception:
            pass

    logger.info("session_revocation.bump username=%s new_version=%d", username, new_version)
    return new_version


def stamp_session(session_obj, username: Optional[str] = None) -> None:
    """Write the current session_version into the session cookie as '_sv'."""
    uname = username or session_obj.get("username")
    if not uname:
        return
    version = get_session_version(uname)
    session_obj["_sv"] = version
    session_obj["_created_at"] = datetime.utcnow().isoformat()
    session_obj.modified = True


def is_session_revoked(session_obj) -> bool:
    """Check if the session's version is outdated (i.e. user logged out elsewhere).

    Returns False for legacy sessions without '_sv' — those are lazily enrolled.
    Fails open (returns False) if infrastructure is unreachable.
    """
    sv = session_obj.get("_sv")
    if sv is None:
        stamp_session(session_obj)
        return False

    username = session_obj.get("username")
    if not username:
        return False

    try:
        current = get_session_version(username)
        return int(sv) != current
    except Exception as exc:
        logger.warning("session_revocation.is_session_revoked error (fail-open): %s", exc)
        return False
