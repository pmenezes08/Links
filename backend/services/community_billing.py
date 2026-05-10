"""
Community-level Stripe billing state.

Owns the small slice of ``communities`` that tracks a community's
Stripe subscription:

    communities.stripe_subscription_id   — Stripe subscription ID
    communities.stripe_customer_id       — Stripe customer ID (the owner
                                           paying for this community)
    communities.subscription_status      — active / past_due / cancelled
    communities.current_period_end       — next renewal boundary

The tier Stripe subscription lives in ``stripe_subscription_id``. The
optional **Steve Community Package** is a **second** Stripe subscription
tracked in separate columns so tier lifecycle webhooks never overwrite
Steve state and vice versa:

    steve_package_stripe_subscription_id
    steve_package_subscription_status
    steve_package_current_period_end
    steve_package_cancel_at_period_end
    steve_package_canceled_at

Columns are added idempotently via ``ensure_tables()`` — safe to call on
every boot (follows the same pattern as ``enterprise_membership`` and
``community_lifecycle``). Keep the write helpers here, not inside the
webhook blueprint, so the blueprint stays thin and the DB column layout
has a single owner.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from backend.services.community import (
    COMMUNITY_TIER_ENTERPRISE,
    COMMUNITY_TIER_PAID_L1,
    COMMUNITY_TIER_PAID_L2,
    COMMUNITY_TIER_PAID_L3,
    _normalize_tier,
    resolve_root_community_id,
)
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
            ("steve_package_stripe_subscription_id", "VARCHAR(64) NULL"),
            ("steve_package_subscription_status", "VARCHAR(32) NULL"),
            ("steve_package_current_period_end", "DATETIME NULL"),
            ("steve_package_cancel_at_period_end", "TINYINT(1) NOT NULL DEFAULT 0"),
            ("steve_package_canceled_at", "DATETIME NULL"),
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

    Billing rows are stored on the **root** network only; sub-community ids
    resolve to their root so Stripe tier / Steve pool behaviour matches
    the network owner checkout.

    Swallows column-not-found errors so callers running against a
    pre-migration schema don't crash — they receive ``{}``-shaped
    defaults instead.
    """
    if not community_id:
        return None
    root_id, _ = resolve_root_community_id(int(community_id))
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT tier, stripe_subscription_id, stripe_customer_id,
                       subscription_status, current_period_end,
                       cancel_at_period_end, canceled_at,
                       steve_package_stripe_subscription_id,
                       steve_package_subscription_status,
                       steve_package_current_period_end,
                       steve_package_cancel_at_period_end,
                       steve_package_canceled_at
                FROM communities WHERE id = {ph}
                """,
                (root_id,),
            )
        except Exception:
            # Pre-migration: only the tier column exists.
            try:
                c.execute(f"SELECT tier FROM communities WHERE id = {ph}", (root_id,))
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
                "steve_package_stripe_subscription_id": None,
                "steve_package_subscription_status": None,
                "steve_package_current_period_end": None,
                "steve_package_cancel_at_period_end": False,
                "steve_package_canceled_at": None,
                "steve_package_subscription_active": False,
                "steve_package_is_canceling": False,
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

    steve_sub_id = _g("steve_package_stripe_subscription_id", 7)
    steve_status = _g("steve_package_subscription_status", 8)
    steve_period_end = _g("steve_package_current_period_end", 9)
    steve_cancel_end = bool(_g("steve_package_cancel_at_period_end", 10))
    steve_canceled_at = _g("steve_package_canceled_at", 11)

    steve_period_end_str = (
        str(steve_period_end) if steve_period_end else None
    )
    steve_active = bool(steve_sub_id) and str(steve_status or "").lower() == "active"

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
        "steve_package_stripe_subscription_id": steve_sub_id,
        "steve_package_subscription_status": steve_status,
        "steve_package_current_period_end": steve_period_end_str,
        "steve_package_cancel_at_period_end": steve_cancel_end,
        "steve_package_canceled_at": (
            str(steve_canceled_at) if steve_canceled_at else None
        ),
        "steve_package_subscription_active": steve_active,
        "steve_package_is_canceling": steve_cancel_end,
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


def tier_subscription_is_live(state: Optional[Dict[str, Any]]) -> bool:
    """True when the Paid tier Stripe subscription is usable for add-ons and UX.

    Requires ``stripe_subscription_id``, Stripe-like ``subscription_status`` of
    ``active`` or ``trialing``, and a ``current_period_end`` that parses and is
    still in the future (renewal boundary not elapsed).

    Rows missing ``current_period_end`` while claiming ``active`` are treated as
    not live — Stripe webhooks should always populate the renewal boundary when
    the tier subscription moves to ``active``/``trialing``.
    """
    if not state:
        return False
    sub_id = state.get("stripe_subscription_id")
    if not sub_id or not str(sub_id).strip():
        return False
    status = str(state.get("subscription_status") or "").strip().lower()
    if status not in ("active", "trialing"):
        return False
    raw = state.get("current_period_end")
    if raw in (None, "", 0):
        logger.warning(
            "tier_subscription_is_live: missing current_period_end for tier subscription "
            "(subscription_status=%s)",
            status,
        )
        return False
    end = _parse_datetime(raw)
    if not end:
        logger.warning(
            "tier_subscription_is_live: unparseable current_period_end=%r",
            raw,
        )
        return False
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return end > now


def community_eligible_for_steve_addon(community_id: int) -> bool:
    """Paid tier root billing row eligible for Steve-package checkout (API/list)."""
    state = get_billing_state(community_id) or {}
    tier = str(state.get("tier") or "").strip().lower()
    if tier == COMMUNITY_TIER_ENTERPRISE:
        return False
    if tier not in (
        COMMUNITY_TIER_PAID_L1,
        COMMUNITY_TIER_PAID_L2,
        COMMUNITY_TIER_PAID_L3,
    ):
        return False
    if state.get("steve_package_subscription_active"):
        return False
    return tier_subscription_is_live(state)


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


def has_active_steve_package(community_id: int) -> bool:
    """Return True when the root community has an active Steve-package Stripe sub."""
    state = get_billing_state(community_id) or {}
    return bool(state.get("steve_package_subscription_active"))


def mark_steve_package_subscription(
    community_id: int,
    *,
    subscription_id: Optional[str] = None,
    status: Optional[str] = None,
    current_period_end: Any = None,
    cancel_at_period_end: Optional[bool] = None,
    canceled_at: Any = None,
) -> bool:
    """Persist Steve-package Stripe columns only (never tier subscription fields)."""
    if not community_id:
        return False

    sets: list[str] = []
    params: list[Any] = []
    ph = get_sql_placeholder()

    if subscription_id is not None:
        sets.append(f"steve_package_stripe_subscription_id = {ph}")
        params.append(subscription_id or None)
    if status is not None:
        sets.append(f"steve_package_subscription_status = {ph}")
        params.append((status or "").strip().lower() or None)
    if current_period_end is not None:
        sets.append(f"steve_package_current_period_end = {ph}")
        params.append(_coerce_period_end(current_period_end))
    if cancel_at_period_end is not None:
        sets.append(f"steve_package_cancel_at_period_end = {ph}")
        params.append(1 if cancel_at_period_end else 0)
    if canceled_at is not None:
        sets.append(f"steve_package_canceled_at = {ph}")
        params.append(_coerce_period_end(canceled_at))

    if not sets:
        return True

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
                "community_billing.mark_steve_package_subscription: UPDATE failed for %s",
                community_id,
            )
            return False
        try:
            conn.commit()
        except Exception:
            pass
    return True


def find_by_steve_package_subscription_id(subscription_id: str) -> Optional[int]:
    """Resolve community root id from a Steve-package Stripe subscription id."""
    if not subscription_id:
        return None
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT id FROM communities
                WHERE steve_package_stripe_subscription_id = {ph}
                LIMIT 1
                """,
                (subscription_id,),
            )
            row = c.fetchone()
        except Exception:
            return None
    if not row:
        return None
    return int(row["id"] if hasattr(row, "keys") else row[0])
