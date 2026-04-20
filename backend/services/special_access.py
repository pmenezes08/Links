"""
Special-user access: schema, query helpers, and KB → DB sync.

A *Special* user has unlimited business-level entitlements (communities,
media quota, Steve credits) but still hits the **technical** caps defined
on the Hard Limits KB page. The authoritative list lives on the
``special-users`` KB page; this module mirrors every KB save into the
``users`` table and appends an audit row to ``special_access_log``.

Columns added to ``users``:
    is_special             BOOLEAN NOT NULL DEFAULT 0
    special_granted_by     VARCHAR(191) NULL
    special_granted_at     TIMESTAMP NULL
    special_reason         VARCHAR(512) NULL
    special_expires_at     TIMESTAMP NULL
    canonical_email        VARCHAR(191) NULL   (used by abuse prevention)

Table created:
    special_access_log (id, username, action, actor_username, reason,
                        category, expires_at, created_at)
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)


def _utc_now_str() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def _ensure_column(cursor, table: str, column: str, column_def_sql: str) -> None:
    """Idempotently add a column via ALTER TABLE."""
    try:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_def_sql}")
    except Exception:
        pass  # column already exists — both MySQL and SQLite raise here


def ensure_tables() -> None:
    """Add special-user columns to ``users`` and create ``special_access_log``.

    Idempotent. Safe to call on every app boot.
    """
    with get_db_connection() as conn:
        c = conn.cursor()

        # Extend users table with special-access fields.
        _ensure_column(c, "users", "is_special", "BOOLEAN NOT NULL DEFAULT 0")
        _ensure_column(c, "users", "special_granted_by", "VARCHAR(191) NULL")
        _ensure_column(c, "users", "special_granted_at", "TIMESTAMP NULL")
        _ensure_column(c, "users", "special_reason", "VARCHAR(512) NULL")
        _ensure_column(c, "users", "special_expires_at", "TIMESTAMP NULL")
        _ensure_column(c, "users", "canonical_email", "VARCHAR(191) NULL")

        # Audit log.
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS special_access_log (
                id INT PRIMARY KEY AUTO_INCREMENT,
                username VARCHAR(191) NOT NULL,
                action VARCHAR(32) NOT NULL,
                actor_username VARCHAR(191) NOT NULL,
                reason VARCHAR(512) NULL,
                category VARCHAR(32) NULL,
                expires_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        try:
            conn.commit()
        except Exception:
            pass


def is_special(username: str) -> bool:
    """Return True if ``username`` is currently flagged special in the DB."""
    if not username:
        return False
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"SELECT is_special FROM users WHERE username = {ph}",
                (username,),
            )
        except Exception:
            # is_special column may not exist yet on a very old DB.
            return False
        row = c.fetchone()
    if not row:
        return False
    val = row["is_special"] if hasattr(row, "keys") else row[0]
    try:
        return bool(int(val or 0))
    except Exception:
        return bool(val)


def list_special_usernames() -> List[str]:
    """Return all usernames currently flagged ``is_special = 1``."""
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute("SELECT username FROM users WHERE is_special = 1")
        except Exception:
            return []
        rows = c.fetchall() or []
    out: List[str] = []
    for r in rows:
        name = r["username"] if hasattr(r, "keys") else r[0]
        if name:
            out.append(str(name))
    return out


def _user_exists(cursor, username: str) -> bool:
    ph = get_sql_placeholder()
    cursor.execute(
        f"SELECT 1 FROM users WHERE username = {ph} LIMIT 1",
        (username,),
    )
    return cursor.fetchone() is not None


def _log(cursor, *, username: str, action: str, actor: str,
         reason: Optional[str], category: Optional[str],
         expires_at: Optional[str]) -> None:
    ph = get_sql_placeholder()
    cursor.execute(
        f"""
        INSERT INTO special_access_log
            (username, action, actor_username, reason, category, expires_at, created_at)
        VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
        """,
        (username, action, actor, reason, category, expires_at or None, _utc_now_str()),
    )


def grant(
    username: str,
    *,
    actor_username: str,
    reason: str,
    category: Optional[str] = None,
    expires_at: Optional[str] = None,
    source: str = "admin-ui",
) -> Dict[str, Any]:
    """Flip ``users.is_special = 1`` for ``username`` and append an audit row.

    Unlike :func:`sync_from_kb`, this is a **single-user** operation used by
    the admin Users tab Grant button. The KB ``special-users`` page is the
    source of truth for bulk declarations; this helper is for ad-hoc
    admin-UI grants. It's safe to call repeatedly — re-granting just logs a
    ``modified`` action.
    """
    ensure_tables()
    if not username:
        raise ValueError("username is required")
    if not (reason or "").strip():
        raise ValueError("reason is required")
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        if not _user_exists(c, username):
            raise ValueError(f"User '{username}' not found")
        was_special = is_special(username)
        c.execute(
            f"""
            UPDATE users SET
                is_special = 1,
                special_granted_by = {ph},
                special_granted_at = {ph},
                special_reason = {ph},
                special_expires_at = {ph}
            WHERE username = {ph}
            """,
            (
                actor_username,
                _utc_now_str(),
                reason,
                expires_at or None,
                username,
            ),
        )
        _log(
            c,
            username=username,
            action="modified" if was_special else "granted",
            actor=actor_username,
            reason=f"[{source}] {reason}",
            category=category,
            expires_at=expires_at,
        )
        try:
            conn.commit()
        except Exception:
            pass
    return {"username": username, "is_special": True, "was_special": was_special}


def revoke(
    username: str,
    *,
    actor_username: str,
    reason: str,
    source: str = "admin-ui",
) -> Dict[str, Any]:
    """Flip ``users.is_special = 0`` and log a ``revoked`` audit row.

    No-op (but still audited) if the user wasn't flagged.
    """
    ensure_tables()
    if not username:
        raise ValueError("username is required")
    if not (reason or "").strip():
        raise ValueError("reason is required")
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        if not _user_exists(c, username):
            raise ValueError(f"User '{username}' not found")
        was_special = is_special(username)
        c.execute(
            f"""
            UPDATE users SET
                is_special = 0,
                special_reason = {ph},
                special_expires_at = NULL
            WHERE username = {ph}
            """,
            (f"Revoked via {source}: {reason}", username),
        )
        _log(
            c,
            username=username,
            action="revoked",
            actor=actor_username,
            reason=f"[{source}] {reason}",
            category=None,
            expires_at=None,
        )
        try:
            conn.commit()
        except Exception:
            pass
    return {"username": username, "is_special": False, "was_special": was_special}


def sync_from_kb(
    special_users: Iterable[Dict[str, Any]],
    actor_username: str,
    save_reason: Optional[str] = None,
) -> Dict[str, Any]:
    """Mirror the KB ``special_users`` list into the ``users`` table.

    Diff semantics:
        * Present in KB list, not flagged in DB → flip on, log ``granted``.
        * Flagged in DB, missing from KB list   → flip off, log ``revoked``.
        * Present in both, any field changed    → update, log ``modified``.

    Args:
        special_users: list of dicts shaped like the KB schema
            (username, display_name, category, granted_by, granted_at,
            reason, expires_at).
        actor_username: the admin username performing the KB save.
        save_reason: the ``reason`` supplied on the KB save request.

    Returns a summary dict.
    """
    ensure_tables()

    # Normalize incoming list.
    wanted: Dict[str, Dict[str, Any]] = {}
    unknown: List[str] = []
    for entry in special_users or []:
        if not isinstance(entry, dict):
            continue
        uname = str(entry.get("username") or "").strip()
        if not uname:
            continue
        wanted[uname.lower()] = {
            "username": uname,
            "category": (entry.get("category") or None),
            "granted_by": (entry.get("granted_by") or actor_username),
            "granted_at": (entry.get("granted_at") or None),
            "reason": (entry.get("reason") or None),
            "expires_at": (entry.get("expires_at") or None),
        }

    ph = get_sql_placeholder()
    granted: List[str] = []
    revoked: List[str] = []
    modified: List[str] = []

    with get_db_connection() as conn:
        c = conn.cursor()

        # Read current state.
        try:
            c.execute(
                "SELECT username, is_special, special_granted_by, special_reason, "
                "special_expires_at FROM users"
            )
            rows = c.fetchall() or []
        except Exception:
            rows = []

        current_flagged: Dict[str, Dict[str, Any]] = {}
        for r in rows:
            if hasattr(r, "keys"):
                uname = r["username"]
                flagged = bool(int(r["is_special"] or 0))
                gb = r["special_granted_by"]
                rsn = r["special_reason"]
                exp = r["special_expires_at"]
            else:
                uname, flagged_raw, gb, rsn, exp = r
                flagged = bool(int(flagged_raw or 0))
            if uname and flagged:
                current_flagged[str(uname).lower()] = {
                    "username": str(uname),
                    "granted_by": gb,
                    "reason": rsn,
                    "expires_at": str(exp) if exp else None,
                }

        # Apply adds / updates.
        for key, w in wanted.items():
            if not _user_exists(c, w["username"]):
                unknown.append(w["username"])
                continue
            if key in current_flagged:
                # Update-only if any of granted_by / reason / expires_at differ.
                existing = current_flagged[key]
                same = (
                    (existing.get("granted_by") or "") == (w.get("granted_by") or "")
                    and (existing.get("reason") or "") == (w.get("reason") or "")
                    and (existing.get("expires_at") or "") == (w.get("expires_at") or "")
                )
                if same:
                    continue
                c.execute(
                    f"""
                    UPDATE users SET
                        special_granted_by = {ph},
                        special_reason = {ph},
                        special_expires_at = {ph}
                    WHERE username = {ph}
                    """,
                    (
                        w["granted_by"],
                        w["reason"],
                        w["expires_at"] or None,
                        w["username"],
                    ),
                )
                _log(
                    c,
                    username=w["username"],
                    action="modified",
                    actor=actor_username,
                    reason=save_reason or w.get("reason"),
                    category=w.get("category"),
                    expires_at=w.get("expires_at"),
                )
                modified.append(w["username"])
            else:
                c.execute(
                    f"""
                    UPDATE users SET
                        is_special = 1,
                        special_granted_by = {ph},
                        special_granted_at = {ph},
                        special_reason = {ph},
                        special_expires_at = {ph}
                    WHERE username = {ph}
                    """,
                    (
                        w["granted_by"],
                        w.get("granted_at") or _utc_now_str(),
                        w["reason"],
                        w["expires_at"] or None,
                        w["username"],
                    ),
                )
                _log(
                    c,
                    username=w["username"],
                    action="granted",
                    actor=actor_username,
                    reason=save_reason or w.get("reason"),
                    category=w.get("category"),
                    expires_at=w.get("expires_at"),
                )
                granted.append(w["username"])

        # Apply removals (flagged in DB but not in KB list).
        for key, cur in current_flagged.items():
            if key in wanted:
                continue
            uname = cur["username"]
            c.execute(
                f"""
                UPDATE users SET
                    is_special = 0,
                    special_reason = {ph},
                    special_expires_at = NULL
                WHERE username = {ph}
                """,
                (f"Revoked via KB save: {save_reason or 'no reason given'}", uname),
            )
            _log(
                c,
                username=uname,
                action="revoked",
                actor=actor_username,
                reason=save_reason or "Removed from KB special users list",
                category=None,
                expires_at=None,
            )
            revoked.append(uname)

        try:
            conn.commit()
        except Exception:
            pass

    result = {
        "granted": granted,
        "revoked": revoked,
        "modified": modified,
        "unknown_users": unknown,
    }
    logger.info("special_access.sync_from_kb done: %s", result)
    return result


def list_audit_log(username: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    """Return recent special-access log entries, newest first."""
    ensure_tables()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        if username:
            c.execute(
                f"""
                SELECT id, username, action, actor_username, reason, category,
                       expires_at, created_at
                FROM special_access_log
                WHERE username = {ph}
                ORDER BY created_at DESC, id DESC
                LIMIT {int(limit)}
                """,
                (username,),
            )
        else:
            c.execute(
                f"""
                SELECT id, username, action, actor_username, reason, category,
                       expires_at, created_at
                FROM special_access_log
                ORDER BY created_at DESC, id DESC
                LIMIT {int(limit)}
                """
            )
        rows = c.fetchall() or []
    out: List[Dict[str, Any]] = []
    for r in rows:
        def _g(key, idx):
            return r[key] if hasattr(r, "keys") else r[idx]
        out.append({
            "id": _g("id", 0),
            "username": _g("username", 1),
            "action": _g("action", 2),
            "actor_username": _g("actor_username", 3),
            "reason": _g("reason", 4),
            "category": _g("category", 5),
            "expires_at": str(_g("expires_at", 6)) if _g("expires_at", 6) else None,
            "created_at": str(_g("created_at", 7)) if _g("created_at", 7) else None,
        })
    return out


def revoke_expired(now: Optional[datetime] = None) -> Dict[str, Any]:
    """Revoke any special grants whose ``special_expires_at`` has passed.

    Intended for a nightly cron. Returns a summary dict.
    """
    ensure_tables()
    ts = (now or datetime.utcnow()).strftime("%Y-%m-%d %H:%M:%S")
    ph = get_sql_placeholder()
    revoked: List[str] = []
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT username FROM users
                WHERE is_special = 1
                  AND special_expires_at IS NOT NULL
                  AND special_expires_at <= {ph}
                """,
                (ts,),
            )
            rows = c.fetchall() or []
        except Exception:
            rows = []
        for r in rows:
            uname = r["username"] if hasattr(r, "keys") else r[0]
            if not uname:
                continue
            c.execute(
                f"""
                UPDATE users SET
                    is_special = 0,
                    special_reason = {ph}
                WHERE username = {ph}
                """,
                ("Auto-revoked: expiry reached", uname),
            )
            _log(
                c,
                username=str(uname),
                action="auto_revoked",
                actor="system",
                reason="Auto-revoke: special_expires_at reached",
                category=None,
                expires_at=None,
            )
            revoked.append(str(uname))
        try:
            conn.commit()
        except Exception:
            pass
    return {"revoked": revoked, "count": len(revoked)}
