"""
One-time winback promo for users whose Enterprise seat ended.

Policy (from KB Enterprise Seat — End Flow):

    * Eligibility: the user had personal Premium at join, cancelled to join
      Enterprise (``return_intent = 1`` on the seat row), and their seat
      ended in the last ``winback_window_days`` days (default 14).
    * Offer: first month at ``winback_first_month_price_eur`` (€3.99),
      then ``winback_then_price_eur`` (€7.99) standard.
    * Delivery: email + in-app banner. Each user gets **one** promo per
      ended-seat event; reusing a redeemed/expired token returns 410.

Schema: ``winback_tokens (id, username, token, offered_at, expires_at,
first_month_price_eur, then_price_eur, status, redeemed_at)``.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from backend.services import enterprise_membership, subscription_audit
from backend.services.database import get_db_connection, get_sql_placeholder


logger = logging.getLogger(__name__)

VALID_STATUSES = {"pending", "sent", "redeemed", "expired"}


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
                CREATE TABLE IF NOT EXISTS winback_tokens (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    username VARCHAR(191) NOT NULL,
                    token VARCHAR(64) NOT NULL UNIQUE,
                    offered_at TIMESTAMP NOT NULL,
                    expires_at TIMESTAMP NOT NULL,
                    first_month_price_eur DECIMAL(10,2) NOT NULL,
                    then_price_eur DECIMAL(10,2) NOT NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'pending',
                    redeemed_at TIMESTAMP NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_winback_user (username, status),
                    INDEX idx_winback_status (status, expires_at)
                )
                """
            )
        except Exception:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS winback_tokens (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username VARCHAR(191) NOT NULL,
                    token VARCHAR(64) NOT NULL UNIQUE,
                    offered_at TIMESTAMP NOT NULL,
                    expires_at TIMESTAMP NOT NULL,
                    first_month_price_eur REAL NOT NULL,
                    then_price_eur REAL NOT NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'pending',
                    redeemed_at TIMESTAMP NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        try:
            conn.commit()
        except Exception:
            pass


def _user_has_outstanding(username: str) -> Optional[Dict[str, Any]]:
    """Return an existing non-expired, non-redeemed token for this user, if any."""
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT id, token, expires_at, status, first_month_price_eur, then_price_eur
            FROM winback_tokens
            WHERE username = {ph}
              AND status IN ('pending','sent')
              AND expires_at > {ph}
            ORDER BY id DESC LIMIT 1
            """,
            (username, _utc_now_str()),
        )
        row = c.fetchone()
    if not row:
        return None
    def g(key, idx):
        return row[key] if hasattr(row, "keys") else row[idx]
    return {
        "id": int(g("id", 0)),
        "token": g("token", 1),
        "expires_at": str(g("expires_at", 2)) if g("expires_at", 2) else None,
        "status": g("status", 3),
        "first_month_price_eur": float(g("first_month_price_eur", 4) or 0),
        "then_price_eur": float(g("then_price_eur", 5) or 0),
    }


def issue_if_eligible(username: str, source: str = "seat_end") -> Optional[Dict[str, Any]]:
    """Create a winback token for ``username`` when eligibility rules pass.

    Returns a dict (new or existing) when a token is available, or ``None``
    if the user isn't eligible.
    """
    ensure_tables()
    # Dedup: don't issue a second token if one is still live.
    existing = _user_has_outstanding(username)
    if existing:
        return existing

    seat = enterprise_membership.active_seat_for(username)
    # We want the most recent *ended* seat with return_intent=1 within window.
    recent = _latest_ended_seat(username)
    if not recent:
        return None
    if not recent.get("return_intent"):
        return None

    window = enterprise_membership.winback_window_days()
    ended_at = _parse_dt(recent.get("ended_at"))
    if not ended_at:
        return None
    if _utc_now() - ended_at > timedelta(days=window):
        return None

    # Don't offer if they're currently on an active seat again.
    if seat and seat.get("active"):
        return None

    token = secrets.token_urlsafe(24)
    offered_at = _utc_now_str()
    expires_at = (_utc_now() + timedelta(days=window)).strftime("%Y-%m-%d %H:%M:%S")
    first = enterprise_membership.winback_first_month_price_eur()
    then = enterprise_membership.winback_then_price_eur()

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO winback_tokens
                (username, token, offered_at, expires_at,
                 first_month_price_eur, then_price_eur, status, created_at)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, 'pending', {ph})
            """,
            (username, token, offered_at, expires_at, first, then, offered_at),
        )
        try:
            conn.commit()
        except Exception:
            pass

    subscription_audit.log(
        username=username,
        action="winback_promo_sent",
        source=source,
        metadata={"token": token, "expires_at": expires_at,
                  "first_month_eur": first, "then_eur": then},
    )

    return {
        "token": token,
        "expires_at": expires_at,
        "first_month_price_eur": first,
        "then_price_eur": then,
        "status": "pending",
    }


def redeem(token: str, *, username: Optional[str] = None) -> Dict[str, Any]:
    """Mark a token redeemed.

    Caller is responsible for actually applying the discount when creating
    the Stripe checkout session (by using a matching coupon ID, looked up
    via the price metadata). This function only handles state.

    Returns ``{"success": True, "token": ...}`` or raises :class:`ValueError`.
    """
    ensure_tables()
    if not token:
        raise ValueError("Token required")
    ph = get_sql_placeholder()
    now_str = _utc_now_str()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT id, username, expires_at, status, first_month_price_eur, then_price_eur
            FROM winback_tokens WHERE token = {ph}
            """,
            (token,),
        )
        row = c.fetchone()
        if not row:
            raise ValueError("Token not found")
        def g(key, idx):
            return row[key] if hasattr(row, "keys") else row[idx]
        row_user = g("username", 1)
        if username and row_user != username:
            raise ValueError("Token does not belong to this user")
        status = g("status", 3)
        if status == "redeemed":
            raise ValueError("Token already redeemed")
        if status == "expired" or _parse_dt(g("expires_at", 2)) and _parse_dt(g("expires_at", 2)) <= _utc_now():
            raise ValueError("Token expired")
        c.execute(
            f"""
            UPDATE winback_tokens SET status = 'redeemed', redeemed_at = {ph}
            WHERE id = {ph}
            """,
            (now_str, int(g("id", 0))),
        )
        try:
            conn.commit()
        except Exception:
            pass
    subscription_audit.log(
        username=row_user,
        action="winback_promo_redeemed",
        source="user-action",
        metadata={"token": token},
        effective_at=now_str,
    )
    return {
        "success": True,
        "token": token,
        "first_month_price_eur": float(g("first_month_price_eur", 4) or 0),
        "then_price_eur": float(g("then_price_eur", 5) or 0),
    }


def sweep_expired(now: Optional[datetime] = None) -> Dict[str, Any]:
    """Flip ``pending`` / ``sent`` tokens whose ``expires_at`` has passed.

    Emits one ``winback_promo_expired`` audit row per token. Idempotent.
    """
    ensure_tables()
    ts = (now or _utc_now()).strftime("%Y-%m-%d %H:%M:%S")
    ph = get_sql_placeholder()
    expired: List[Dict[str, Any]] = []
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT id, username, token FROM winback_tokens
            WHERE status IN ('pending','sent') AND expires_at <= {ph}
            """,
            (ts,),
        )
        rows = c.fetchall() or []
        for r in rows:
            def g(key, idx):
                return r[key] if hasattr(r, "keys") else r[idx]
            c.execute(
                f"UPDATE winback_tokens SET status = 'expired' WHERE id = {ph}",
                (int(g("id", 0)),),
            )
            expired.append({"username": g("username", 1), "token": g("token", 2)})
            subscription_audit.log(
                username=g("username", 1),
                action="winback_promo_expired",
                source="cron",
                metadata={"token": g("token", 2)},
            )
        try:
            conn.commit()
        except Exception:
            pass
    return {"expired": expired, "count": len(expired)}


def _latest_ended_seat(username: str) -> Optional[Dict[str, Any]]:
    """Return the seat row that most recently had ``ended_at`` set."""
    enterprise_membership.ensure_tables()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT username, community_id, ended_at, end_reason,
                       return_intent, grace_until
                FROM user_enterprise_seats
                WHERE username = {ph} AND ended_at IS NOT NULL
                ORDER BY ended_at DESC, id DESC LIMIT 1
                """,
                (username,),
            )
            row = c.fetchone()
        except Exception:
            return None
    if not row:
        return None
    def g(key, idx):
        return row[key] if hasattr(row, "keys") else row[idx]
    return {
        "username": g("username", 0),
        "community_id": g("community_id", 1),
        "ended_at": str(g("ended_at", 2)) if g("ended_at", 2) else None,
        "end_reason": g("end_reason", 3),
        "return_intent": bool(int(g("return_intent", 4) or 0)),
        "grace_until": str(g("grace_until", 5)) if g("grace_until", 5) else None,
    }


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
