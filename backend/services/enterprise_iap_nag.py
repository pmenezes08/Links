"""
Daily in-app nag for users who joined Enterprise while still paying a
mobile-IAP Premium subscription.

Policy (from KB Enterprise Seat — Join Flow):

    * ``iap_grace_days``       — we give the user this many days to cancel
                                 before the nag starts firing (default 7).
    * ``iap_nag_stop_after_days`` — we stop nagging after this many days
                                    regardless (default 14). Past that the
                                    user is assumed to knowingly double-pay.

We never auto-cancel an Apple / Google subscription — the stores forbid it.
All we do is surface a banner + push notification each day and stop once
the user taps "I've cancelled" or the limit is hit.

Schema: ``enterprise_iap_nag (username, community_id, started_at,
last_sent_at, sent_count, status)``

Status values: ``pending`` | ``acknowledged`` | ``stopped``.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from backend.services import enterprise_membership, subscription_audit
from backend.services.database import get_db_connection, get_sql_placeholder


logger = logging.getLogger(__name__)

VALID_STATUSES = {"pending", "acknowledged", "stopped"}


def _utc_now() -> datetime:
    return datetime.utcnow()


def _utc_now_str() -> str:
    return _utc_now().strftime("%Y-%m-%d %H:%M:%S")


def ensure_tables() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS enterprise_iap_nag (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    username VARCHAR(191) NOT NULL,
                    community_id INT NOT NULL,
                    started_at TIMESTAMP NOT NULL,
                    last_sent_at TIMESTAMP NULL,
                    sent_count INT NOT NULL DEFAULT 0,
                    status VARCHAR(32) NOT NULL DEFAULT 'pending',
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_nag_user_comm (username, community_id),
                    INDEX idx_nag_status (status)
                )
                """
            )
        except Exception:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS enterprise_iap_nag (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username VARCHAR(191) NOT NULL,
                    community_id INTEGER NOT NULL,
                    started_at TIMESTAMP NOT NULL,
                    last_sent_at TIMESTAMP NULL,
                    sent_count INTEGER NOT NULL DEFAULT 0,
                    status VARCHAR(32) NOT NULL DEFAULT 'pending',
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (username, community_id)
                )
                """
            )
        try:
            conn.commit()
        except Exception:
            pass


def start_nag(*, username: str, community_id: int) -> Dict[str, Any]:
    """Open or re-open a nag record for this (user, community). Idempotent."""
    ensure_tables()
    ph = get_sql_placeholder()
    now_str = _utc_now_str()
    with get_db_connection() as conn:
        c = conn.cursor()
        # Try update first; insert if no row exists.
        c.execute(
            f"""
            SELECT id, status FROM enterprise_iap_nag
            WHERE username = {ph} AND community_id = {ph}
            """,
            (username, int(community_id)),
        )
        row = c.fetchone()
        if row:
            def g(key, idx):
                return row[key] if hasattr(row, "keys") else row[idx]
            if g("status", 1) in ("acknowledged", "stopped"):
                c.execute(
                    f"""
                    UPDATE enterprise_iap_nag SET
                        status = 'pending', sent_count = 0,
                        last_sent_at = NULL, started_at = {ph},
                        updated_at = {ph}
                    WHERE id = {ph}
                    """,
                    (now_str, now_str, g("id", 0)),
                )
        else:
            c.execute(
                f"""
                INSERT INTO enterprise_iap_nag
                    (username, community_id, started_at, status, updated_at)
                VALUES ({ph}, {ph}, {ph}, 'pending', {ph})
                """,
                (username, int(community_id), now_str, now_str),
            )
        try:
            conn.commit()
        except Exception:
            pass
    return {"username": username, "community_id": int(community_id), "status": "pending"}


def acknowledge(*, username: str, community_id: Optional[int] = None, actor: Optional[str] = None) -> int:
    """User tapped "I've cancelled" — stop nagging and log.

    If ``community_id`` is omitted, acknowledges all pending rows for this user.
    Returns the number of rows updated.
    """
    ensure_tables()
    ph = get_sql_placeholder()
    now_str = _utc_now_str()
    updated = 0
    with get_db_connection() as conn:
        c = conn.cursor()
        if community_id is not None:
            c.execute(
                f"""
                UPDATE enterprise_iap_nag SET status = 'acknowledged', updated_at = {ph}
                WHERE username = {ph} AND community_id = {ph} AND status = 'pending'
                """,
                (now_str, username, int(community_id)),
            )
        else:
            c.execute(
                f"""
                UPDATE enterprise_iap_nag SET status = 'acknowledged', updated_at = {ph}
                WHERE username = {ph} AND status = 'pending'
                """,
                (now_str, username),
            )
        updated = int(getattr(c, "rowcount", 0) or 0)
        try:
            conn.commit()
        except Exception:
            pass
    if updated:
        subscription_audit.log(
            username=username,
            action="iap_nag_acknowledged",
            source="user-action",
            community_id=community_id,
            actor_username=actor,
            metadata={"rows_updated": updated},
        )
    return updated


def stop(*, username: str, community_id: int, reason: str = "limit_reached") -> None:
    """Hard-stop nagging for this user. Used by the dispatcher when the
    iap_nag_stop_after_days threshold is hit."""
    ensure_tables()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            UPDATE enterprise_iap_nag SET status = 'stopped', updated_at = {ph}
            WHERE username = {ph} AND community_id = {ph}
            """,
            (_utc_now_str(), username, int(community_id)),
        )
        try:
            conn.commit()
        except Exception:
            pass
    subscription_audit.log(
        username=username,
        action="iap_nag_stopped",
        source="cron",
        community_id=int(community_id),
        reason=reason,
    )


def pending_for_user(username: str) -> List[Dict[str, Any]]:
    """Rows the client should render as banner + push. Cheap: no external API."""
    ensure_tables()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT id, username, community_id, started_at, last_sent_at,
                   sent_count, status
            FROM enterprise_iap_nag
            WHERE username = {ph} AND status = 'pending'
            """,
            (username,),
        )
        rows = c.fetchall() or []
    out: List[Dict[str, Any]] = []
    for r in rows:
        def g(key, idx):
            return r[key] if hasattr(r, "keys") else r[idx]
        out.append({
            "id": g("id", 0),
            "username": g("username", 1),
            "community_id": g("community_id", 2),
            "started_at": str(g("started_at", 3)) if g("started_at", 3) else None,
            "last_sent_at": str(g("last_sent_at", 4)) if g("last_sent_at", 4) else None,
            "sent_count": int(g("sent_count", 5) or 0),
        })
    return out


def dispatch_due(now: Optional[datetime] = None) -> Dict[str, Any]:
    """Increment ``sent_count`` and stamp ``last_sent_at`` for all rows due today.

    "Due" = pending, outside the ``iap_grace_days`` window from ``started_at``,
    not already sent today, and under the ``iap_nag_stop_after_days`` limit.

    The actual push/email dispatch is handled by the caller (Wave 6 cron) —
    this function only updates state and emits audit rows so it's safe to
    call from a test.
    """
    ensure_tables()
    nowv = now or _utc_now()
    now_str = nowv.strftime("%Y-%m-%d %H:%M:%S")
    today_prefix = nowv.strftime("%Y-%m-%d")
    grace_days = enterprise_membership.iap_grace_days()
    stop_after = enterprise_membership.iap_nag_stop_after_days()

    ph = get_sql_placeholder()
    fired: List[Dict[str, Any]] = []
    stopped: List[Dict[str, Any]] = []

    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """
            SELECT id, username, community_id, started_at, last_sent_at, sent_count
            FROM enterprise_iap_nag
            WHERE status = 'pending'
            """
        )
        rows = c.fetchall() or []
        for r in rows:
            def g(key, idx):
                return r[key] if hasattr(r, "keys") else r[idx]
            started_at = _parse_dt(g("started_at", 3))
            if not started_at:
                continue
            days_since_start = (nowv - started_at).days
            # Still in grace: skip.
            if days_since_start < grace_days:
                continue
            # Over the stop-after threshold: hard stop.
            if days_since_start >= stop_after:
                try:
                    c.execute(
                        f"""
                        UPDATE enterprise_iap_nag SET status = 'stopped', updated_at = {ph}
                        WHERE id = {ph}
                        """,
                        (now_str, int(g("id", 0))),
                    )
                except Exception:
                    pass
                stopped.append({"username": g("username", 1),
                                "community_id": g("community_id", 2)})
                subscription_audit.log(
                    username=g("username", 1),
                    action="iap_nag_stopped",
                    source="cron",
                    community_id=g("community_id", 2),
                    reason=f"reached_iap_nag_stop_after_days ({stop_after})",
                    metadata={"sent_count": int(g("sent_count", 5) or 0)},
                )
                continue
            # Already fired today? Skip.
            last_sent = g("last_sent_at", 4)
            if last_sent and str(last_sent).startswith(today_prefix):
                continue
            # Dispatch.
            try:
                c.execute(
                    f"""
                    UPDATE enterprise_iap_nag SET
                        last_sent_at = {ph},
                        sent_count = sent_count + 1,
                        updated_at = {ph}
                    WHERE id = {ph}
                    """,
                    (now_str, now_str, int(g("id", 0))),
                )
            except Exception:
                continue
            fired.append({
                "username": g("username", 1),
                "community_id": g("community_id", 2),
                "sent_count": int(g("sent_count", 5) or 0) + 1,
            })
            subscription_audit.log(
                username=g("username", 1),
                action="iap_nag_sent",
                source="cron",
                community_id=g("community_id", 2),
                metadata={"day": int(days_since_start),
                          "sent_count": int(g("sent_count", 5) or 0) + 1},
            )
        try:
            conn.commit()
        except Exception:
            pass
    return {"fired": fired, "stopped": stopped, "now": now_str,
            "grace_days": grace_days, "stop_after_days": stop_after}


def _parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    s = str(value)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[: len(fmt)], fmt)
        except Exception:
            continue
    return None
