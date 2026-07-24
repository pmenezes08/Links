"""Per-user email consent / suppression state — the truth lifecycle mail checks.

One row per user, created lazily on first lifecycle send (or on unsubscribe).
Two independent axes plus a deliverability kill:

* ``lifecycle_optout`` — user unsubscribed from lifecycle/relational email
  (welcome, activation nudges). Opt-OUT model: absent row = may send.
* ``marketing_optin`` — explicit opt-IN for broadcast/announcement email.
  Absent row = may NOT send. Kept separate so broadcasts can never inherit
  lifecycle's send-by-default.
* ``hard_suppressed`` — bounce/complaint kill switch; overrides everything
  except genuinely transactional mail (password reset, verification).

The ``unsubscribe_token`` is a permanent random token stored here (not an
HMAC over a secret): revocable per-user, and immune to the key-rotation
footgun that would invalidate every unsubscribe link already in inboxes.

Transactional mail (password reset, signup verification, community invites)
never consults this table — see :mod:`backend.services.lifecycle_email` for
the classification rules.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime
from typing import Any, Dict, Optional

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

_MAX_USERNAME_LEN = 191
_TABLE_READY = False


def ensure_table() -> None:
    global _TABLE_READY
    if _TABLE_READY:
        return
    with get_db_connection() as conn:
        c = conn.cursor()
        if USE_MYSQL:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS email_preferences (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(191) NOT NULL,
                    email VARCHAR(191) NULL,
                    lifecycle_optout TINYINT(1) NOT NULL DEFAULT 0,
                    marketing_optin TINYINT(1) NOT NULL DEFAULT 0,
                    hard_suppressed TINYINT(1) NOT NULL DEFAULT 0,
                    suppressed_reason VARCHAR(32) NULL,
                    unsubscribe_token VARCHAR(64) NOT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    UNIQUE KEY uq_email_prefs_user (username),
                    UNIQUE KEY uq_email_prefs_token (unsubscribe_token)
                )
                """
            )
        else:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS email_preferences (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    email TEXT,
                    lifecycle_optout INTEGER NOT NULL DEFAULT 0,
                    marketing_optin INTEGER NOT NULL DEFAULT 0,
                    hard_suppressed INTEGER NOT NULL DEFAULT 0,
                    suppressed_reason TEXT,
                    unsubscribe_token TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
        try:
            conn.commit()
        except Exception:
            pass
    _TABLE_READY = True


def _row_to_dict(row) -> Dict[str, Any]:
    if hasattr(row, "keys"):
        return {k: row[k] for k in row.keys()}
    # Positional fallback matches the SELECT column order used below.
    cols = (
        "id", "username", "email", "lifecycle_optout", "marketing_optin",
        "hard_suppressed", "suppressed_reason", "unsubscribe_token",
        "created_at", "updated_at",
    )
    return dict(zip(cols, row))


_SELECT_COLS = (
    "id, username, email, lifecycle_optout, marketing_optin, hard_suppressed,"
    " suppressed_reason, unsubscribe_token, created_at, updated_at"
)


def get_for_user(username: str) -> Optional[Dict[str, Any]]:
    uname = str(username or "").strip()[:_MAX_USERNAME_LEN]
    if not uname:
        return None
    ensure_table()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT {_SELECT_COLS} FROM email_preferences WHERE username = {ph}",
            (uname,),
        )
        row = c.fetchone()
    return _row_to_dict(row) if row else None


def get_by_token(token: str) -> Optional[Dict[str, Any]]:
    tok = str(token or "").strip()
    if not tok or len(tok) > 64:
        return None
    ensure_table()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT {_SELECT_COLS} FROM email_preferences WHERE unsubscribe_token = {ph}",
            (tok,),
        )
        row = c.fetchone()
    return _row_to_dict(row) if row else None


def get_or_create(username: str, email: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Return the user's preference row, creating it (send-allowed defaults)
    on first touch. Loser of a concurrent-create race re-reads."""
    uname = str(username or "").strip()[:_MAX_USERNAME_LEN]
    if not uname:
        return None
    existing = get_for_user(uname)
    if existing:
        if email and not existing.get("email"):
            _update_email_snapshot(uname, email)
            existing["email"] = email
        return existing
    ensure_table()
    ph = get_sql_placeholder()
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    token = secrets.token_urlsafe(32)
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""
                INSERT INTO email_preferences
                    (username, email, lifecycle_optout, marketing_optin,
                     hard_suppressed, unsubscribe_token, created_at, updated_at)
                VALUES ({ph}, {ph}, 0, 0, 0, {ph}, {ph}, {ph})
                """,
                (uname, (email or None), token, now, now),
            )
            conn.commit()
    except Exception:
        # UNIQUE(username) race — another writer created it first.
        pass
    return get_for_user(uname)


def _update_email_snapshot(username: str, email: str) -> None:
    ph = get_sql_placeholder()
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"UPDATE email_preferences SET email = {ph}, updated_at = {ph} WHERE username = {ph}",
                (email, now, username),
            )
            conn.commit()
    except Exception:
        logger.warning("email snapshot update failed for %s", username, exc_info=True)


def set_lifecycle_optout_by_token(token: str, optout: bool) -> bool:
    """Flip the lifecycle opt-out for the row owning ``token``.

    Returns True when a row was updated. Callers must stay non-enumerating:
    an invalid token gets the same generic response as a valid one.
    """
    row = get_by_token(token)
    if not row:
        return False
    ph = get_sql_placeholder()
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"UPDATE email_preferences SET lifecycle_optout = {ph}, updated_at = {ph}"
                f" WHERE unsubscribe_token = {ph}",
                (1 if optout else 0, now, row["unsubscribe_token"]),
            )
            conn.commit()
        return True
    except Exception:
        logger.warning("set_lifecycle_optout_by_token failed", exc_info=True)
        return False


def hard_suppress(username: str, reason: str) -> bool:
    """Deliverability kill (bounce/complaint webhook or manual op)."""
    row = get_or_create(username)
    if not row:
        return False
    ph = get_sql_placeholder()
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"UPDATE email_preferences SET hard_suppressed = 1,"
                f" suppressed_reason = {ph}, updated_at = {ph} WHERE username = {ph}",
                (str(reason or "manual")[:32], now, row["username"]),
            )
            conn.commit()
        return True
    except Exception:
        logger.warning("hard_suppress failed for %s", username, exc_info=True)
        return False


def may_send(username: str, *, category: str) -> bool:
    """Central consent check. ``category`` is 'lifecycle' or 'marketing'.

    Fail-closed on lookup errors — a mistaken skip beats a mistaken send
    to someone who opted out.
    """
    try:
        row = get_for_user(username)
    except Exception:
        logger.warning("may_send lookup failed for %s", username, exc_info=True)
        return False
    if row is None:
        # No row yet: lifecycle is opt-out (allowed), marketing is opt-in.
        return category == "lifecycle"
    if int(row.get("hard_suppressed") or 0):
        return False
    if category == "marketing":
        return bool(int(row.get("marketing_optin") or 0))
    return not int(row.get("lifecycle_optout") or 0)


def purge_user(cursor, username: str) -> None:
    """Remove the user's preference row (account-deletion path).

    Takes the deletion transaction's cursor so the purge commits (or rolls
    back) atomically with the rest of the account wipe.
    """
    ph = get_sql_placeholder()
    try:
        cursor.execute(
            f"DELETE FROM email_preferences WHERE username = {ph}", (username,)
        )
    except Exception:
        # Table may not exist yet in this environment — nothing to purge.
        pass
