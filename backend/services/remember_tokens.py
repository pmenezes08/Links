"""Persistent remember-me token lifecycle helpers."""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta
from typing import Any, Optional

from flask import current_app

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services import session_identity


logger = logging.getLogger(__name__)

COOKIE_NAME = "remember_token"


def _get_auth_session_lifetime_days() -> int:
    try:
        return max(30, int(current_app.config.get("AUTH_SESSION_LIFETIME_DAYS", 365)))
    except Exception:
        return 365


def _cookie_attrs() -> dict[str, Any]:
    return {
        "secure": True,
        "httponly": True,
        "samesite": "Lax",
        "domain": current_app.config.get("SESSION_COOKIE_DOMAIN") or None,
        "path": "/",
    }


def cookie_hash(request) -> Optional[str]:
    """Return the SHA-256 hash for the incoming remember cookie, if present."""
    raw = request.cookies.get(COOKIE_NAME)
    if not raw:
        return None
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _row_value(row, key: str, index: int):
    if row is None:
        return None
    if hasattr(row, "keys"):
        return row[key]
    return row[index]


def _parse_datetime(value) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value)
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        try:
            return datetime.strptime(text.split(".")[0], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None


def ensure_tables() -> None:
    """Create the remember token table and indexes when missing."""
    with get_db_connection() as conn:
        c = conn.cursor()
        if USE_MYSQL:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS remember_tokens (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    username VARCHAR(191) NOT NULL,
                    token_hash CHAR(64) NOT NULL,
                    created_at DATETIME NOT NULL,
                    expires_at DATETIME NOT NULL,
                    INDEX idx_remember_token_hash (token_hash),
                    INDEX idx_remember_username (username),
                    INDEX idx_remember_expires (expires_at)
                )
                """
            )
        else:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS remember_tokens (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username VARCHAR(191) NOT NULL,
                    token_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                )
                """
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_remember_token_hash ON remember_tokens(token_hash)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_remember_username ON remember_tokens(username)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_remember_expires ON remember_tokens(expires_at)")
        conn.commit()


def issue(response, username: str) -> str:
    """Create a persistent remember-me token and attach it to the response."""
    ensure_tables()
    lifetime_days = _get_auth_session_lifetime_days()
    raw = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    now = datetime.utcnow()
    expires = now + timedelta(days=lifetime_days)

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"""
            INSERT INTO remember_tokens (username, token_hash, created_at, expires_at)
            VALUES ({ph}, {ph}, {ph}, {ph})
            """,
            (username, token_hash, now, expires),
        )
        conn.commit()

    response.set_cookie(
        COOKIE_NAME,
        raw,
        max_age=lifetime_days * 24 * 60 * 60,
        **_cookie_attrs(),
    )
    return token_hash


def restore_session(request, session) -> Optional[str]:
    """Restore the session from a valid remember_token cookie."""
    token_hash = cookie_hash(request)
    if not token_hash:
        return None

    ensure_tables()
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"""
            SELECT username, expires_at
            FROM remember_tokens
            WHERE token_hash={ph}
            ORDER BY id DESC
            LIMIT 1
            """,
            (token_hash,),
        )
        row = c.fetchone()

    if not row:
        return None

    expires_at = _parse_datetime(_row_value(row, "expires_at", 1))
    if not expires_at or expires_at < datetime.utcnow():
        revoke_by_token_hash(token_hash)
        return None

    username = _row_value(row, "username", 0)
    if not username:
        return None

    if not session_identity.user_exists(str(username)):
        revoke_by_token_hash(token_hash)
        return None

    session.permanent = True
    session["username"] = username
    return str(username)


def revoke_by_cookie(request) -> int:
    """Delete the remember-token row matching the incoming cookie."""
    token_hash = cookie_hash(request)
    if not token_hash:
        return 0
    return revoke_by_token_hash(token_hash)


def revoke_by_token_hash(token_hash: Optional[str]) -> int:
    """Delete a remember-token row by hash and return the affected count."""
    if not token_hash:
        return 0
    ensure_tables()
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(f"DELETE FROM remember_tokens WHERE token_hash={ph}", (token_hash,))
        deleted = c.rowcount or 0
        conn.commit()
    return int(deleted)


def revoke_for_user(username: Optional[str]) -> int:
    """Delete all remember tokens for a user."""
    if not username:
        return 0
    ensure_tables()
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(f"DELETE FROM remember_tokens WHERE username={ph}", (username,))
        deleted = c.rowcount or 0
        conn.commit()
    return int(deleted)


def clear_cookie(response) -> None:
    """Expire the remember-token cookie with the same attrs used by issue()."""
    response.set_cookie(COOKIE_NAME, "", max_age=0, expires=0, **_cookie_attrs())


__all__ = [
    "COOKIE_NAME",
    "clear_cookie",
    "cookie_hash",
    "ensure_tables",
    "issue",
    "restore_session",
    "revoke_by_cookie",
    "revoke_by_token_hash",
    "revoke_for_user",
]
