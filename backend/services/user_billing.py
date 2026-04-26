"""
Personal Premium Stripe billing state.

This mirrors ``community_billing`` for user-level Premium subscriptions.
The users table remains the source of truth for entitlements, while these
helpers own the Stripe identifiers and lifecycle timestamps needed by the
success page, billing portal, and admin reporting.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from backend.services.database import get_db_connection, get_sql_placeholder


logger = logging.getLogger(__name__)


def ensure_tables() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        for column, col_def in (
            ("stripe_customer_id", "VARCHAR(64) NULL"),
            ("stripe_subscription_id", "VARCHAR(64) NULL"),
            ("subscription_status", "VARCHAR(32) NULL"),
            ("current_period_end", "DATETIME NULL"),
            ("cancel_at_period_end", "TINYINT(1) NOT NULL DEFAULT 0"),
            ("canceled_at", "DATETIME NULL"),
            ("subscription_provider", "VARCHAR(32) NULL"),
        ):
            try:
                c.execute(f"ALTER TABLE users ADD COLUMN {column} {col_def}")
            except Exception:
                pass
        try:
            conn.commit()
        except Exception:
            pass


def get_billing_state(username: str) -> Optional[Dict[str, Any]]:
    if not username:
        return None
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT username, email, subscription, stripe_customer_id,
                       stripe_subscription_id, subscription_status,
                       current_period_end, cancel_at_period_end, canceled_at,
                       subscription_provider
                FROM users WHERE LOWER(username) = LOWER({ph})
                """,
                (username,),
            )
            row = c.fetchone()
        except Exception:
            try:
                c.execute(
                    f"SELECT username, email, subscription FROM users WHERE LOWER(username) = LOWER({ph})",
                    (username,),
                )
                row = c.fetchone()
            except Exception:
                return None
            if not row:
                return None
            return {
                "username": _row_value(row, "username", 0),
                "email": _row_value(row, "email", 1) or "",
                "subscription": _row_value(row, "subscription", 2) or "free",
                "stripe_customer_id": None,
                "stripe_subscription_id": None,
                "subscription_status": None,
                "current_period_end": None,
                "cancel_at_period_end": False,
                "canceled_at": None,
                "subscription_provider": None,
                "is_canceling": False,
                "days_remaining": None,
                "benefits_end_at": None,
            }

    if not row:
        return None
    current_period_end = _row_value(row, "current_period_end", 6)
    current_period_end_str = str(current_period_end) if current_period_end else None
    cancel_at_period_end = bool(_row_value(row, "cancel_at_period_end", 7))
    canceled_at = _row_value(row, "canceled_at", 8)
    return {
        "username": _row_value(row, "username", 0),
        "email": _row_value(row, "email", 1) or "",
        "subscription": _row_value(row, "subscription", 2) or "free",
        "stripe_customer_id": _row_value(row, "stripe_customer_id", 3),
        "stripe_subscription_id": _row_value(row, "stripe_subscription_id", 4),
        "subscription_status": _row_value(row, "subscription_status", 5),
        "current_period_end": current_period_end_str,
        "cancel_at_period_end": cancel_at_period_end,
        "canceled_at": str(canceled_at) if canceled_at else None,
        "subscription_provider": _row_value(row, "subscription_provider", 9),
        "is_canceling": cancel_at_period_end,
        "days_remaining": _days_until(current_period_end),
        "benefits_end_at": current_period_end_str if cancel_at_period_end else None,
    }


def mark_subscription(
    username: str,
    *,
    subscription: Optional[str] = None,
    subscription_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    status: Optional[str] = None,
    current_period_end: Any = None,
    cancel_at_period_end: Optional[bool] = None,
    canceled_at: Any = None,
    provider: Optional[str] = "stripe",
) -> bool:
    if not username:
        return False

    sets: list[str] = []
    params: list[Any] = []
    ph = get_sql_placeholder()

    if subscription is not None:
        sets.append(f"subscription = {ph}")
        params.append((subscription or "free").strip().lower() or "free")
    if subscription_id is not None:
        sets.append(f"stripe_subscription_id = {ph}")
        params.append(subscription_id or None)
    if customer_id is not None:
        sets.append(f"stripe_customer_id = {ph}")
        params.append(customer_id or None)
    if status is not None:
        sets.append(f"subscription_status = {ph}")
        params.append((status or "").strip().lower() or None)
    if current_period_end is not None:
        sets.append(f"current_period_end = {ph}")
        params.append(_coerce_datetime(current_period_end))
    if cancel_at_period_end is not None:
        sets.append(f"cancel_at_period_end = {ph}")
        params.append(1 if cancel_at_period_end else 0)
    if canceled_at is not None:
        sets.append(f"canceled_at = {ph}")
        params.append(_coerce_datetime(canceled_at))
    if provider is not None:
        sets.append(f"subscription_provider = {ph}")
        params.append(provider or None)

    if not sets:
        return True
    params.append(username)

    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"UPDATE users SET {', '.join(sets)} WHERE LOWER(username) = LOWER({ph})",
                tuple(params),
            )
            conn.commit()
        except Exception:
            logger.exception("user_billing.mark_subscription failed for %s", username)
            return False
    return True


def find_by_subscription_id(subscription_id: str) -> Optional[str]:
    if not subscription_id:
        return None
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"SELECT username FROM users WHERE stripe_subscription_id = {ph} LIMIT 1",
                (subscription_id,),
            )
            row = c.fetchone()
        except Exception:
            return None
    if not row:
        return None
    return str(_row_value(row, "username", 0))


def _row_value(row: Any, key: str, index: int) -> Any:
    if hasattr(row, "keys") and key in row.keys():
        return row[key]
    if isinstance(row, dict):
        return row.get(key)
    if isinstance(row, (list, tuple)) and len(row) > index:
        return row[index]
    return None


def _coerce_datetime(value: Any) -> Optional[str]:
    dt = _parse_datetime(value)
    return dt.strftime("%Y-%m-%d %H:%M:%S") if dt else None


def _parse_datetime(value: Any) -> Optional[datetime]:
    if value in (None, "", 0):
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    try:
        return datetime.utcfromtimestamp(int(value))
    except Exception:
        pass
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt)
        except Exception:
            continue
    return None


def _days_until(value: Any) -> Optional[int]:
    when = _parse_datetime(value)
    if not when:
        return None
    delta = when - datetime.now(timezone.utc).replace(tzinfo=None)
    if delta.total_seconds() <= 0:
        return 0
    return max(1, int((delta.total_seconds() + 86399) // 86400))
