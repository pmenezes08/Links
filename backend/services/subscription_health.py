"""Derived subscription health for commerce UI and Steve-package preflight.

Single source of truth for tier labels vs Stripe subscription reality, renewal
boundary classification, and Steve add-on eligibility reasons. Keeps HTTP and
clients aligned without duplicating eligibility logic in React.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from backend.services.community import (
    COMMUNITY_TIER_ENTERPRISE,
    COMMUNITY_TIER_FREE,
    COMMUNITY_TIER_PAID_L1,
    COMMUNITY_TIER_PAID_L2,
    COMMUNITY_TIER_PAID_L3,
)

logger = logging.getLogger(__name__)

RENEWAL_VALID = "valid"
RENEWAL_MISSING = "missing"
RENEWAL_EXPIRED = "expired"
RENEWAL_NOT_APPLICABLE = "not_applicable"

STEVE_REASON_ELIGIBLE = "eligible"
STEVE_REASON_TIER_NOT_PAID = "tier_not_paid"
STEVE_REASON_ENTERPRISE_INCLUDED = "enterprise_included"
STEVE_REASON_TIER_SUBSCRIPTION_INACTIVE = "tier_subscription_inactive"
STEVE_REASON_RENEWAL_DATE_MISSING = "renewal_date_missing"
STEVE_REASON_RENEWAL_DATE_EXPIRED = "renewal_date_expired"
STEVE_REASON_STEVE_ALREADY_ACTIVE = "steve_already_active"

_PREMIUM_LIKE_SUBSCRIPTION_VALUES = frozenset({"premium", "special", "pro", "paid"})
_STRIPE_OK_STATUSES = frozenset({"active", "trialing"})
_TERMINAL_OR_PROBLEM_STATUSES = frozenset({
    "canceled",
    "cancelled",
    "unpaid",
    "past_due",
    "incomplete",
    "incomplete_expired",
})


def _now_naive_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


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


def classify_period_end(raw: Any, *, now_naive_utc: Optional[datetime] = None) -> str:
    """Return ``valid`` | ``missing`` | ``expired`` for a renewal boundary."""
    now = now_naive_utc or _now_naive_utc()
    if raw in (None, "", 0):
        return RENEWAL_MISSING
    end = _parse_datetime(raw)
    if not end:
        return RENEWAL_MISSING
    if end <= now:
        return RENEWAL_EXPIRED
    return RENEWAL_VALID


def derive_community_subscription_health(
    state: Optional[Dict[str, Any]],
    *,
    enterprise_steve_package_included: bool,
    now_naive_utc: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Compute display + Steve add-on fields from ``community_billing.get_billing_state``."""
    now = now_naive_utc or _now_naive_utc()
    default = {
        "renewal_date_status": RENEWAL_NOT_APPLICABLE,
        "tier_subscription_active": False,
        "needs_attention": False,
        "steve_addon_eligible": False,
        "steve_addon_reason": STEVE_REASON_TIER_NOT_PAID,
        "steve_addon_message": (
            "Community Paid tier subscription required before purchasing add-ons."
        ),
    }
    if not state:
        return default

    tier = str(state.get("tier") or COMMUNITY_TIER_FREE).strip().lower()
    raw_end = state.get("current_period_end")
    sub_id = state.get("stripe_subscription_id")
    sub_id_str = str(sub_id).strip() if sub_id else ""
    status = str(state.get("subscription_status") or "").strip().lower()

    paid_tiers = {
        COMMUNITY_TIER_PAID_L1,
        COMMUNITY_TIER_PAID_L2,
        COMMUNITY_TIER_PAID_L3,
    }

    def _with_steve(
        *,
        renewal_status: str,
        tier_active: bool,
        needs_attention: bool,
        eligible: bool,
        reason: str,
        message: str,
    ) -> Dict[str, Any]:
        return {
            "renewal_date_status": renewal_status,
            "tier_subscription_active": tier_active,
            "needs_attention": needs_attention,
            "steve_addon_eligible": eligible,
            "steve_addon_reason": reason,
            "steve_addon_message": message,
        }

    # Enterprise — Steve usually redundant; rare KB flag allows add-on path.
    if tier == COMMUNITY_TIER_ENTERPRISE:
        renewal_status_ent = classify_period_end(raw_end, now_naive_utc=now)
        tier_active = (
            bool(sub_id_str)
            and status in _STRIPE_OK_STATUSES
            and renewal_status_ent == RENEWAL_VALID
        )
        needs_ent = False
        if not sub_id_str:
            needs_ent = True
        elif status in _TERMINAL_OR_PROBLEM_STATUSES:
            needs_ent = True
        elif status in _STRIPE_OK_STATUSES and renewal_status_ent != RENEWAL_VALID:
            needs_ent = True

        if enterprise_steve_package_included:
            return _with_steve(
                renewal_status=renewal_status_ent,
                tier_active=tier_active,
                needs_attention=needs_ent,
                eligible=False,
                reason=STEVE_REASON_ENTERPRISE_INCLUDED,
                message=(
                    "Enterprise communities already include Steve capabilities "
                    "for this product configuration."
                ),
            )

        if state.get("steve_package_subscription_active"):
            return _with_steve(
                renewal_status=renewal_status_ent,
                tier_active=tier_active,
                needs_attention=not tier_active,
                eligible=False,
                reason=STEVE_REASON_STEVE_ALREADY_ACTIVE,
                message=(
                    "This community already has an active Steve Community Package subscription."
                ),
            )

        eligible = tier_active
        reason = STEVE_REASON_ELIGIBLE if eligible else STEVE_REASON_TIER_SUBSCRIPTION_INACTIVE
        message = (
            "You can add the Steve Community Package to this community."
            if eligible
            else (
                "Fix enterprise billing (active subscription + renewal date) "
                "before adding Steve."
            )
        )
        return _with_steve(
            renewal_status=renewal_status_ent,
            tier_active=tier_active,
            needs_attention=needs_ent,
            eligible=eligible,
            reason=reason,
            message=message,
        )

    if tier not in paid_tiers:
        return default

    renewal_status = classify_period_end(raw_end, now_naive_utc=now)

    if state.get("steve_package_subscription_active"):
        tier_active = (
            bool(sub_id_str)
            and status in _STRIPE_OK_STATUSES
            and renewal_status == RENEWAL_VALID
        )
        return _with_steve(
            renewal_status=renewal_status,
            tier_active=tier_active,
            needs_attention=not tier_active,
            eligible=False,
            reason=STEVE_REASON_STEVE_ALREADY_ACTIVE,
            message="This community already has an active Steve Community Package subscription.",
        )

    if not sub_id_str:
        return _with_steve(
            renewal_status=renewal_status,
            tier_active=False,
            needs_attention=True,
            eligible=False,
            reason=STEVE_REASON_TIER_SUBSCRIPTION_INACTIVE,
            message=(
                "This community shows a Paid tier but has no Stripe subscription on file. "
                "Open Manage → billing or complete checkout to reconnect billing."
            ),
        )

    if status in _TERMINAL_OR_PROBLEM_STATUSES:
        return _with_steve(
            renewal_status=renewal_status,
            tier_active=False,
            needs_attention=True,
            eligible=False,
            reason=STEVE_REASON_TIER_SUBSCRIPTION_INACTIVE,
            message=(
                f"Community tier billing status is “{status or 'unknown'}”. "
                "Resolve payment in the billing portal before purchasing add-ons."
            ),
        )

    if status not in _STRIPE_OK_STATUSES:
        return _with_steve(
            renewal_status=renewal_status,
            tier_active=False,
            needs_attention=True,
            eligible=False,
            reason=STEVE_REASON_TIER_SUBSCRIPTION_INACTIVE,
            message=(
                "Community tier subscription is not active or trialing. "
                "Check billing before purchasing add-ons."
            ),
        )

    # active / trialing
    if renewal_status == RENEWAL_MISSING:
        logger.warning(
            "derive_community_subscription_health: missing renewal for active tier "
            "community (subscription_status=%s)",
            status,
        )
        return _with_steve(
            renewal_status=RENEWAL_MISSING,
            tier_active=False,
            needs_attention=True,
            eligible=False,
            reason=STEVE_REASON_RENEWAL_DATE_MISSING,
            message=(
                "Stripe subscription is active but renewal date is missing in billing data. "
                "Use admin sync or wait for webhooks; billing portal may refresh payment details."
            ),
        )

    if renewal_status == RENEWAL_EXPIRED:
        return _with_steve(
            renewal_status=RENEWAL_EXPIRED,
            tier_active=False,
            needs_attention=True,
            eligible=False,
            reason=STEVE_REASON_RENEWAL_DATE_EXPIRED,
            message=(
                "Community tier renewal date is in the past. "
                "Renew or fix billing before purchasing add-ons."
            ),
        )

    return _with_steve(
        renewal_status=RENEWAL_VALID,
        tier_active=True,
        needs_attention=False,
        eligible=True,
        reason=STEVE_REASON_ELIGIBLE,
        message="You can add the Steve Community Package to this community.",
    )


def derive_personal_subscription_health(
    billing_state: Dict[str, Any],
    *,
    subscription_value: str,
    is_special: bool,
    now_naive_utc: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Stripe-backed personal Premium display flags for ``/api/me/subscriptions``."""
    now = now_naive_utc or _now_naive_utc()
    sub_val = str(subscription_value or "").strip().lower()

    base = {
        "renewal_date_status": RENEWAL_NOT_APPLICABLE,
        "subscription_active": False,
        "needs_attention": False,
    }

    if is_special:
        return {
            **base,
            "renewal_date_status": RENEWAL_NOT_APPLICABLE,
            "subscription_active": True,
            "needs_attention": False,
        }

    raw_end = billing_state.get("current_period_end")
    sub_id = billing_state.get("stripe_subscription_id")
    sub_id_str = str(sub_id).strip() if sub_id else ""
    status = str(billing_state.get("subscription_status") or "").strip().lower()

    expects_stripe = bool(sub_id_str) or sub_val in _PREMIUM_LIKE_SUBSCRIPTION_VALUES

    if not expects_stripe:
        return base

    renewal_status = classify_period_end(raw_end, now_naive_utc=now)

    if not sub_id_str:
        return {
            "renewal_date_status": renewal_status
            if renewal_status != RENEWAL_NOT_APPLICABLE
            else RENEWAL_MISSING,
            "subscription_active": False,
            "needs_attention": True,
        }

    if status in _TERMINAL_OR_PROBLEM_STATUSES:
        return {
            "renewal_date_status": renewal_status,
            "subscription_active": False,
            "needs_attention": True,
        }

    if status not in _STRIPE_OK_STATUSES:
        return {
            "renewal_date_status": renewal_status,
            "subscription_active": False,
            "needs_attention": True,
        }

    if renewal_status == RENEWAL_MISSING:
        return {
            "renewal_date_status": RENEWAL_MISSING,
            "subscription_active": False,
            "needs_attention": True,
        }
    if renewal_status == RENEWAL_EXPIRED:
        return {
            "renewal_date_status": RENEWAL_EXPIRED,
            "subscription_active": False,
            "needs_attention": True,
        }

    return {
        "renewal_date_status": RENEWAL_VALID,
        "subscription_active": True,
        "needs_attention": False,
    }
