"""
Persisted admin revocation of the signup free-trial window.

Trial tier is normally computed from ``users.created_at`` inside
:mod:`backend.services.entitlements`. Setting ``trial_revoked_at`` forces the
account off trial regardless of age until/unless an operator clears the column.
"""

from __future__ import annotations

import logging
from typing import Optional, Tuple

from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)


def ensure_trial_columns() -> None:
    """Add ``users.trial_revoked_at`` if missing (idempotent)."""
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                "ALTER TABLE users ADD COLUMN trial_revoked_at DATETIME NULL"
            )
        except Exception:
            pass
        try:
            conn.commit()
        except Exception:
            pass


def trial_revoked_at(username: str) -> Optional[str]:
    """Return timestamp string if trial was revoked, else ``None``."""
    if not (username or "").strip():
        return None
    ensure_trial_columns()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT trial_revoked_at FROM users WHERE username = {ph}
                """,
                (username.strip(),),
            )
            row = c.fetchone()
        except Exception:
            return None
    if not row:
        return None
    raw = row["trial_revoked_at"] if hasattr(row, "keys") else row[0]
    return str(raw).strip() if raw else None


def revoke_trial_admin(
    username: str,
    *,
    actor_username: str,
    reason: str,
) -> Tuple[str, Optional[str]]:
    """Apply ``trial_revoked_at`` for an admin action.

    Returns ``(code, message)`` where ``code`` is one of:

    * ``ok`` — column set or already set (idempotent when revoked)
    * ``not_found`` — unknown username or UPDATE failure
    * ``not_on_trial`` — resolver tier is not ``trial`` and column was unset
    """
    uname = (username or "").strip()
    if not uname:
        return ("not_found", "Username required")

    ensure_trial_columns()

    from backend.services.entitlements import resolve_entitlements

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"SELECT trial_revoked_at FROM users WHERE username = {ph}",
                (uname,),
            )
            row = c.fetchone()
        except Exception:
            logger.exception("revoke_trial_admin: SELECT failed for %s", uname)
            return ("not_found", "User lookup failed")

    if not row:
        return ("not_found", "User not found")

    revoked_raw = row["trial_revoked_at"] if hasattr(row, "keys") else row[0]
    if revoked_raw not in (None, ""):
        return ("ok", None)

    try:
        ent = resolve_entitlements(uname) or {}
        tier = str(ent.get("tier") or "").strip().lower()
        if tier != "trial":
            return ("not_on_trial", "User is not on trial tier")
    except Exception:
        logger.exception("resolve_entitlements failed in revoke_trial_admin for %s", uname)
        return ("not_on_trial", "Could not resolve trial status")

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""
                UPDATE users SET trial_revoked_at = NOW()
                WHERE username = {ph} AND trial_revoked_at IS NULL
                """,
                (uname,),
            )
            conn.commit()
    except Exception:
        logger.exception("revoke_trial_admin: UPDATE failed for %s", uname)
        return ("not_found", "Failed to update user")

    try:
        from redis_cache import invalidate_user_cache

        invalidate_user_cache(uname)
    except Exception:
        pass

    try:
        from backend.services import subscription_audit

        subscription_audit.log(
            username=uname,
            action="trial_revoked_by_admin",
            source="admin-ui",
            actor_username=actor_username,
            reason=(reason or "").strip()[:512] or None,
            metadata={"prior_tier": "trial"},
        )
    except Exception:
        logger.warning("subscription_audit.log failed after trial revoke for %s", uname)

    return ("ok", None)
