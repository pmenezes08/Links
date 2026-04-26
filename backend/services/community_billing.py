"""
Community-level Stripe billing state.

Owns the small slice of ``communities`` that tracks a community's
Stripe subscription:

    communities.stripe_subscription_id   — Stripe subscription ID
    communities.stripe_customer_id       — Stripe customer ID (the owner
                                           paying for this community)
    communities.subscription_status      — active / past_due / cancelled
    communities.current_period_end       — next renewal boundary

The columns are added idempotently via ``ensure_tables()`` — safe to call
on every boot (follows the same pattern as ``enterprise_membership`` and
``community_lifecycle``). Keep the write helpers here, not inside the
webhook blueprint, so the blueprint stays thin and the DB column layout
has a single owner.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from backend.services.community import _normalize_tier
from backend.services.database import get_db_connection, get_sql_placeholder


logger = logging.getLogger(__name__)


# ── Schema ──────────────────────────────────────────────────────────────


def ensure_tables() -> None:
    """Add community billing columns to ``communities`` if missing.

    Each ALTER is wrapped in try/except so repeat runs are no-ops on
    MySQL (which lacks ``ADD COLUMN IF NOT EXISTS`` on 5.7) and silently
    pass on SQLite (used by ``tests/conftest.py`` handrolls).
    """
    with get_db_connection() as conn:
        c = conn.cursor()
        for column, col_def in (
            ("stripe_subscription_id", "VARCHAR(64) NULL"),
            ("stripe_customer_id", "VARCHAR(64) NULL"),
            ("subscription_status", "VARCHAR(32) NULL"),
            ("current_period_end", "DATETIME NULL"),
            ("cancel_at_period_end", "TINYINT(1) NOT NULL DEFAULT 0"),
            ("canceled_at", "DATETIME NULL"),
        ):
            try:
                c.execute(f"ALTER TABLE communities ADD COLUMN {column} {col_def}")
            except Exception:
                pass
        try:
            conn.commit()
        except Exception:
            pass


# ── Read helpers ────────────────────────────────────────────────────────


def get_billing_state(community_id: int) -> Optional[Dict[str, Any]]:
    """Return the billing snapshot for a community, or ``None`` if missing.

    Swallows column-not-found errors so callers running against a
    pre-migration schema don't crash — they receive ``{}``-shaped
    defaults instead.
    """
    if not community_id:
        return None
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT tier, stripe_subscription_id, stripe_customer_id,
                       subscription_status, current_period_end,
                       cancel_at_period_end, canceled_at
                FROM communities WHERE id = {ph}
                """,
                (community_id,),
            )
        except Exception:
            # Pre-migration: only the tier column exists.
            try:
                c.execute(f"SELECT tier FROM communities WHERE id = {ph}", (community_id,))
                row = c.fetchone()
            except Exception:
                return None
            if not row:
                return None
            tier = row["tier"] if hasattr(row, "keys") else row[0]
            return {
                "tier": _normalize_tier(tier),
                "stripe_subscription_id": None,
                "stripe_customer_id": None,
                "subscription_status": None,
                "current_period_end": None,
                "cancel_at_period_end": False,
                "canceled_at": None,
                "is_canceling": False,
                "days_remaining": None,
                "benefits_end_at": None,
            }
        row = c.fetchone()
    if not row:
        return None

    def _g(key: str, idx: int) -> Any:
        if hasattr(row, "keys"):
            return row[key]
        return row[idx]

    current_period_end = _g("current_period_end", 4)
    current_period_end_str = str(current_period_end) if current_period_end else None
    cancel_at_period_end = bool(_g("cancel_at_period_end", 5))
    canceled_at = _g("canceled_at", 6)
    days_remaining = _days_until(current_period_end)
    return {
        "tier": _normalize_tier(_g("tier", 0)),
        "stripe_subscription_id": _g("stripe_subscription_id", 1),
        "stripe_customer_id": _g("stripe_customer_id", 2),
        "subscription_status": _g("subscription_status", 3),
        "current_period_end": current_period_end_str,
        "cancel_at_period_end": cancel_at_period_end,
        "canceled_at": str(canceled_at) if canceled_at else None,
        "is_canceling": cancel_at_period_end,
        "days_remaining": days_remaining,
        "benefits_end_at": current_period_end_str if cancel_at_period_end else None,
    }


def has_active_subscription(community_id: int) -> bool:
    """Return True when this community already has a live Stripe sub.

    Used as a preflight in checkout creation so owners can't double-pay.
    Past-due/cancelled do not count as active — those communities should
    re-enter checkout to restore service.
    """
    state = get_billing_state(community_id) or {}
    sub_id = state.get("stripe_subscription_id")
    status = (state.get("subscription_status") or "").lower()
    return bool(sub_id) and status == "active"


# ── Write helpers ───────────────────────────────────────────────────────


def _coerce_period_end(value: Any) -> Optional[str]:
    """Convert Stripe's unix-seconds ``current_period_end`` to a DB string."""
    if value in (None, "", 0):
        return None
    try:
        ts = int(value)
        return datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return None


def _days_until(value: Any) -> Optional[int]:
    when = _parse_datetime(value)
    if not when:
        return None
    delta = when - datetime.now(timezone.utc).replace(tzinfo=None)
    if delta.total_seconds() <= 0:
        return 0
    return max(1, int((delta.total_seconds() + 86399) // 86400))


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


def mark_subscription(
    community_id: int,
    *,
    tier_code: Optional[str] = None,
    subscription_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    status: Optional[str] = None,
    current_period_end: Any = None,
    cancel_at_period_end: Optional[bool] = None,
    canceled_at: Any = None,
) -> bool:
    """Write a community's Stripe state.

    Every argument is optional so webhook events can update partial
    state (e.g. ``invoice.payment_failed`` only changes ``status``).
    ``tier_code`` when provided is normalized; passing a value we don't
    recognise leaves the existing tier untouched.

    Returns True on success, False on DB error.
    """
    if not community_id:
        return False

    sets: list[str] = []
    params: list[Any] = []
    ph = get_sql_placeholder()

    norm_tier = _normalize_tier(tier_code) if tier_code else None
    if norm_tier:
        sets.append(f"tier = {ph}")
        params.append(norm_tier)
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
        params.append(_coerce_period_end(current_period_end))
    if cancel_at_period_end is not None:
        sets.append(f"cancel_at_period_end = {ph}")
        params.append(1 if cancel_at_period_end else 0)
    if canceled_at is not None:
        sets.append(f"canceled_at = {ph}")
        params.append(_coerce_period_end(canceled_at))

    if not sets:
        return True  # nothing to change — treat as success

    params.append(community_id)

    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"UPDATE communities SET {', '.join(sets)} WHERE id = {ph}",
                tuple(params),
            )
        except Exception:
            logger.exception(
                "community_billing.mark_subscription: UPDATE failed for %s",
                community_id,
            )
            return False
        try:
            conn.commit()
        except Exception:
            pass
    return True


def find_by_subscription_id(subscription_id: str) -> Optional[int]:
    """Look up the community that owns a Stripe subscription.

    Webhook events arrive with ``subscription.id`` but no community
    metadata (Stripe only stores metadata on Checkout Sessions, not on
    the subscription itself post-creation). We store the ID at webhook
    write time so later ``subscription.updated`` events can find the
    community again.
    """
    if not subscription_id:
        return None
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"SELECT id FROM communities WHERE stripe_subscription_id = {ph} LIMIT 1",
                (subscription_id,),
            )
            row = c.fetchone()
        except Exception:
            return None
    if not row:
        return None
    return int(row["id"] if hasattr(row, "keys") else row[0])
