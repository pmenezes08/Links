"""18+ age gate (Option A — timestamp-only, no DOB storage).

Records confirmation or underage deletion scheduling on ``users``. Underage
accounts are retained up to :data:`UNDERGAGE_PURGE_DAYS` then removed by cron
(see ``/api/cron/purge-underage`` — implemented separately).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

UNDERGAGE_PURGE_DAYS = 7

_AGE_GATE_COLUMNS = (
    ("age_confirmed_at", "DATETIME NULL"),
    ("age_consent_given", "TINYINT(1) NULL"),
    ("underage_delete_scheduled_at", "DATETIME NULL"),
)


def utc_now() -> datetime:
    """Return naive UTC datetime for MySQL ``DATETIME`` columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def ensure_age_gate_columns(cursor=None) -> None:
    """Add age-gate columns to ``users`` if missing (idempotent)."""
    if cursor is not None:
        for column, col_def in _AGE_GATE_COLUMNS:
            try:
                cursor.execute(f"ALTER TABLE users ADD COLUMN {column} {col_def}")
            except Exception:
                pass
        return

    with get_db_connection() as conn:
        c = conn.cursor()
        ensure_age_gate_columns(c)
        try:
            conn.commit()
        except Exception:
            pass


def _row_value(row, key: str, index: int):
    if row is None:
        return None
    if hasattr(row, "keys"):
        return row[key]
    return row[index]


def _iso_utc(value) -> Optional[str]:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        if not text:
            return None
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            try:
                dt = datetime.strptime(text.split(".")[0], "%Y-%m-%d %H:%M:%S")
            except ValueError:
                return text
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.replace(microsecond=0).isoformat() + "Z"


def get_age_gate_status(username: str) -> Dict[str, Any]:
    """Return the current age-gate state for ``username``."""
    uname = (username or "").strip()
    if not uname:
        return {"status": "unknown", "username": None}

    ensure_age_gate_columns()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT age_confirmed_at, age_consent_given, underage_delete_scheduled_at
                FROM users WHERE username = {ph}
                """,
                (uname,),
            )
            row = c.fetchone()
        except Exception:
            logger.exception("get_age_gate_status SELECT failed for %s", uname)
            return {"status": "unknown", "username": uname}

    if not row:
        return {"status": "not_found", "username": uname}

    confirmed_at = _row_value(row, "age_confirmed_at", 0)
    consent = _row_value(row, "age_consent_given", 1)
    scheduled_at = _row_value(row, "underage_delete_scheduled_at", 2)

    if scheduled_at not in (None, ""):
        return {
            "status": "scheduled_deletion",
            "username": uname,
            "purge_at": _iso_utc(scheduled_at),
            "age_confirmed_at": _iso_utc(confirmed_at),
            "age_consent_given": int(consent) if consent is not None else 0,
        }

    if confirmed_at not in (None, "") and int(consent or 0) == 1:
        return {
            "status": "confirmed",
            "username": uname,
            "age_confirmed_at": _iso_utc(confirmed_at),
            "age_consent_given": 1,
        }

    return {
        "status": "pending",
        "username": uname,
        "age_confirmed_at": None,
        "age_consent_given": int(consent) if consent is not None else None,
    }


def revoke_user_access(username: str) -> None:
    """Invalidate sessions, remember-me tokens, and profile cache."""
    uname = (username or "").strip()
    if not uname:
        return

    try:
        from backend.services import session_revocation

        session_revocation.bump_session_version(uname)
    except Exception as exc:
        logger.warning("user_age_gate: session_revocation failed for %s: %s", uname, exc)

    try:
        from backend.services import remember_tokens

        remember_tokens.revoke_for_user(uname)
    except Exception as exc:
        logger.warning("user_age_gate: remember_tokens.revoke failed for %s: %s", uname, exc)

    try:
        from redis_cache import invalidate_user_cache

        invalidate_user_cache(uname)
    except Exception:
        pass


def schedule_underage_deletion(username: str) -> Dict[str, Any]:
    """Mark an underage account for purge after :data:`UNDERGAGE_PURGE_DAYS`."""
    uname = (username or "").strip()
    if not uname:
        return {"code": "not_found", "error": "Username required"}

    ensure_age_gate_columns()
    purge_at = utc_now() + timedelta(days=UNDERGAGE_PURGE_DAYS)
    ph = get_sql_placeholder()

    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT username FROM users WHERE username = {ph}", (uname,))
        if not c.fetchone():
            return {"code": "not_found", "error": "User not found"}

        c.execute(
            f"""
            UPDATE users
            SET age_confirmed_at = NULL,
                age_consent_given = 0,
                underage_delete_scheduled_at = {ph},
                is_active = 0
            WHERE username = {ph}
            """,
            (purge_at, uname),
        )
        conn.commit()

    revoke_user_access(uname)
    purge_iso = _iso_utc(purge_at)
    logger.info(
        "user_age_gate.schedule_underage_deletion username=%s purge_at=%s",
        uname,
        purge_iso,
    )
    return {
        "code": "scheduled",
        "status": "scheduled_deletion",
        "purge_at": purge_iso,
    }


def confirm_age_gate(username: str, *, confirmed: bool) -> Dict[str, Any]:
    """Persist age-gate outcome for ``username``.

    * ``confirmed=True`` — user declared 18+; store confirmation timestamp.
    * ``confirmed=False`` — user declared under 18; schedule deferred purge
      (does **not** call :func:`account_deletion.delete_user_in_connection`).
    """
    uname = (username or "").strip()
    if not uname:
        return {"code": "not_found", "error": "Username required"}

    current = get_age_gate_status(uname)
    if current.get("status") == "not_found":
        return {"code": "not_found", "error": "User not found"}

    if confirmed:
        if current.get("status") == "confirmed":
            return {
                "code": "already_confirmed",
                "status": "confirmed",
                "age_confirmed_at": current.get("age_confirmed_at"),
            }

        ensure_age_gate_columns()
        now = utc_now()
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""
                UPDATE users
                SET age_confirmed_at = {ph},
                    age_consent_given = 1,
                    underage_delete_scheduled_at = NULL,
                    is_active = 1
                WHERE username = {ph}
                """,
                (now, uname),
            )
            conn.commit()

        try:
            from redis_cache import invalidate_user_cache

            invalidate_user_cache(uname)
        except Exception:
            pass
        confirmed_iso = _iso_utc(now)
        logger.info("user_age_gate.confirm username=%s at=%s", uname, confirmed_iso)
        return {
            "code": "ok",
            "status": "confirmed",
            "age_confirmed_at": confirmed_iso,
        }

    if current.get("status") == "scheduled_deletion":
        return {
            "code": "already_scheduled",
            "status": "scheduled_deletion",
            "purge_at": current.get("purge_at"),
        }

    result = schedule_underage_deletion(uname)
    if result.get("code") == "not_found":
        return result
    return {
        "code": "ok",
        "status": "scheduled_deletion",
        "purge_at": result.get("purge_at"),
    }


def select_usernames_due_for_purge(*, limit: int = 100) -> List[str]:
    """Return usernames whose underage purge time has passed (for cron)."""
    ensure_age_gate_columns()
    ph = get_sql_placeholder()
    now = utc_now()
    safe_limit = max(1, min(int(limit or 100), 500))
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT username FROM users
            WHERE underage_delete_scheduled_at IS NOT NULL
              AND underage_delete_scheduled_at <= {ph}
            ORDER BY underage_delete_scheduled_at ASC
            LIMIT {safe_limit}
            """,
            (now,),
        )
        rows = c.fetchall() or []
    out: List[str] = []
    for row in rows:
        uname = _row_value(row, "username", 0)
        if uname:
            out.append(str(uname))
    return out


def purge_due_underage_accounts(*, dry_run: bool = False, limit: int = 100) -> Dict[str, Any]:
    """Delete underage accounts whose grace period expired.

    Intended for ``/api/cron/purge-underage`` (cron route implemented separately).
    """
    usernames = select_usernames_due_for_purge(limit=limit)
    if dry_run:
        return {"purged": 0, "due": len(usernames), "dry_run": True}

    from backend.services.account_deletion import (
        AccountDeletionMode,
        delete_user_in_connection,
    )

    purged = 0
    errors: List[str] = []
    for uname in usernames:
        try:
            with get_db_connection() as conn:
                delete_user_in_connection(conn, uname, AccountDeletionMode.SELF_SERVICE)
                conn.commit()
            purged += 1
            logger.info("user_age_gate.purge_due deleted username=%s", uname)
        except Exception as exc:
            logger.exception("user_age_gate.purge_due failed for %s", uname)
            errors.append(f"{uname}:{exc}")

    return {"purged": purged, "due": len(usernames), "errors": errors}


__all__ = [
    "UNDERGAGE_PURGE_DAYS",
    "confirm_age_gate",
    "ensure_age_gate_columns",
    "get_age_gate_status",
    "purge_due_underage_accounts",
    "revoke_user_access",
    "schedule_underage_deletion",
    "select_usernames_due_for_purge",
    "utc_now",
]
