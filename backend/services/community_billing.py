"""
Community-level Stripe billing state.

Owns the small slice of ``communities`` that tracks a community's
Stripe subscription:

    communities.stripe_subscription_id   — Stripe subscription ID
    communities.stripe_customer_id       — Stripe customer ID (the owner
                                           paying for this community)
    communities.subscription_status      — active / past_due / cancelled
    communities.current_period_end       — next renewal boundary
    communities.billing_provider         — stripe / apple / google

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
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from backend.services.community import (
    _normalize_tier,
    resolve_root_community_id,
)
from backend.services.subscription_health import derive_community_subscription_health
from backend.services.database import get_db_connection, get_sql_placeholder


logger = logging.getLogger(__name__)


# ── Steve package trial (synthetic, non-Stripe) ─────────────────────────
#
# New root communities get the Steve Community Package free for 14 days so
# members taste Steve inside the community and demand lands on the owner.
# The trial is a synthetic subscription row (id ``trial_pkg_<community_id>``,
# status ``trialing``) — no Stripe object exists, so expiry is enforced at
# read time in ``get_billing_state`` instead of via webhooks. Buying the
# real package simply overwrites these columns through the normal webhook
# path.
STEVE_PACKAGE_TRIAL_SUB_PREFIX = "trial_pkg_"
STEVE_PACKAGE_TRIAL_DAYS = 14


def is_synthetic_steve_package_trial(state: Optional[Dict[str, Any]]) -> bool:
    """True when the package columns hold our synthetic trial, not Stripe."""
    sub_id = str((state or {}).get("steve_package_stripe_subscription_id") or "")
    return sub_id.startswith(STEVE_PACKAGE_TRIAL_SUB_PREFIX)


def grant_steve_package_trial(
    community_id: int,
    *,
    trial_days: int = STEVE_PACKAGE_TRIAL_DAYS,
) -> bool:
    """Activate the Steve Community Package as a one-off trial for a new
    root community.

    Root communities only; never overwrites an existing package record
    (one trial per community, and a real Stripe sub must never be
    clobbered). Best-effort: returns False instead of raising so the
    community-creation path can call it inline.
    """
    try:
        if not community_id:
            return False
        root_id, is_root = resolve_root_community_id(int(community_id))
        if not is_root or int(root_id) != int(community_id):
            return False
        state = get_billing_state(community_id) or {}
        if state.get("steve_package_stripe_subscription_id"):
            return False
        period_end = datetime.utcnow() + timedelta(days=int(trial_days))
        granted = mark_steve_package_subscription(
            community_id,
            subscription_id=f"{STEVE_PACKAGE_TRIAL_SUB_PREFIX}{int(community_id)}",
            status="trialing",
            current_period_end=period_end.strftime("%Y-%m-%d %H:%M:%S"),
        )
        if granted:
            logger.info(
                "Steve package trial granted: community=%s ends=%s",
                community_id,
                period_end.isoformat(),
            )
        return granted
    except Exception:
        logger.exception("grant_steve_package_trial failed for community %s", community_id)
        return False


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
            ("billing_provider", "VARCHAR(32) NULL"),
            ("stripe_mode", "VARCHAR(16) NULL"),
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
                       subscription_status, billing_provider, stripe_mode, current_period_end,
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
                "billing_provider": None,
                "stripe_mode": None,
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

    current_period_end = _g("current_period_end", 6)
    current_period_end_str = str(current_period_end) if current_period_end else None
    cancel_at_period_end = bool(_g("cancel_at_period_end", 7))
    canceled_at = _g("canceled_at", 8)

    steve_sub_id = _g("steve_package_stripe_subscription_id", 9)
    steve_status = _g("steve_package_subscription_status", 10)
    steve_period_end = _g("steve_package_current_period_end", 11)
    steve_cancel_end = bool(_g("steve_package_cancel_at_period_end", 12))
    steve_canceled_at = _g("steve_package_canceled_at", 13)

    steve_period_end_str = (
        str(steve_period_end) if steve_period_end else None
    )
    steve_st = str(steve_status or "").strip().lower()
    # Trials expire at read time: synthetic (non-Stripe) trials have no
    # webhook to flip their status, so a past period_end means inactive.
    steve_trial_expired = False
    if steve_st == "trialing":
        trial_end = _parse_datetime(steve_period_end)
        if trial_end is not None and trial_end <= datetime.utcnow():
            steve_trial_expired = True
    steve_active = (
        bool(steve_sub_id)
        and steve_st in ("active", "trialing")
        and not steve_trial_expired
    )

    days_remaining = _days_until(current_period_end)
    return {
        "tier": _normalize_tier(_g("tier", 0)),
        "stripe_subscription_id": _g("stripe_subscription_id", 1),
        "stripe_customer_id": _g("stripe_customer_id", 2),
        "subscription_status": _g("subscription_status", 3),
        "billing_provider": _g("billing_provider", 4) or "stripe",
        "stripe_mode": _g("stripe_mode", 5),
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
    """Return True when this community already has a live billing sub.

    Used as a preflight in checkout creation so owners can't double-pay.
    Past-due/cancelled do not count as active — those communities should
    re-enter checkout to restore service.
    """
    state = get_billing_state(community_id) or {}
    sub_id = state.get("stripe_subscription_id")
    status = (state.get("subscription_status") or "").lower()
    return bool(sub_id) and status in ("active", "trialing")


def tier_subscription_is_live(
    state: Optional[Dict[str, Any]],
    *,
    enterprise_steve_package_included: bool = False,
) -> bool:
    """Backward-compatible alias for :func:`subscription_health.derive_community_subscription_health`.

    ``enterprise_steve_package_included`` defaults False so callers that don't
    pass KB context still get correct Paid-tier activation without accidentally
    treating Enterprise Steve messaging as tier activation.
    """
    health = derive_community_subscription_health(
        state or {},
        enterprise_steve_package_included=enterprise_steve_package_included,
    )
    return bool(health.get("tier_subscription_active"))


def community_eligible_for_steve_addon(
    community_id: int,
    *,
    enterprise_steve_package_included: bool = True,
) -> bool:
    """True when Steve-package checkout is allowed (mirrors subscription health)."""
    state = get_billing_state(community_id) or {}
    health = derive_community_subscription_health(
        state,
        enterprise_steve_package_included=enterprise_steve_package_included,
    )
    return bool(health.get("steve_addon_eligible"))


# ── Write helpers ───────────────────────────────────────────────────────


def _coerce_period_end(value: Any) -> Optional[str]:
    """Convert Stripe's unix-seconds ``current_period_end`` to a DB string."""
    if value in (None, "", 0):
        return None
    try:
        ts = int(value)
        if ts > 1_000_000_000_000:
            ts = ts // 1000
        return datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        dt = _parse_datetime(value)
        return dt.strftime("%Y-%m-%d %H:%M:%S") if dt else None


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
    provider: Optional[str] = "stripe",
    stripe_mode: Optional[str] = None,
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
    if provider is not None:
        sets.append(f"billing_provider = {ph}")
        params.append((provider or "").strip().lower() or None)
    if stripe_mode is not None:
        sets.append(f"stripe_mode = {ph}")
        params.append((stripe_mode or "").strip().lower() or None)
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


def find_by_customer_id(customer_id: str) -> Optional[int]:
    if not customer_id:
        return None
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"SELECT id FROM communities WHERE stripe_customer_id = {ph} LIMIT 1",
                (customer_id,),
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
