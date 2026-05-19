"""Stripe ``Subscription.retrieve`` → MySQL billing columns (repair tooling).

Used by admin endpoints and offline scripts — **not** on hot request paths.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict

from backend.services import community_billing, user_billing

logger = logging.getLogger(__name__)

_DEFAULT_STRIPE_API_KEY = "sk_test_your_stripe_key"


def _stripe_client():
    try:
        import stripe  # type: ignore
    except Exception:
        return None
    key = (os.getenv("STRIPE_API_KEY") or "").strip()
    if not key or key == _DEFAULT_STRIPE_API_KEY:
        return None
    stripe.api_key = key
    return stripe


def sync_community_tier_subscription_from_stripe(community_id: int) -> Dict[str, Any]:
    """Refresh tier subscription status + ``current_period_end`` from Stripe."""
    stripe_mod = _stripe_client()
    if stripe_mod is None:
        return {"success": False, "error": "stripe_not_configured"}

    state = community_billing.get_billing_state(community_id) or {}
    sub_id = state.get("stripe_subscription_id")
    sub_str = str(sub_id).strip() if sub_id else ""
    if not sub_str:
        return {"success": False, "error": "no_stripe_subscription_id"}

    try:
        sub = stripe_mod.Subscription.retrieve(sub_str)
    except Exception as exc:
        logger.warning(
            "stripe_subscription_sync: Subscription.retrieve failed id=%s: %s",
            sub_str,
            exc,
        )
        return {"success": False, "error": "stripe_retrieve_failed", "detail": str(exc)}

    status = (sub.get("status") or "").strip().lower() or None
    cpe = sub.get("current_period_end")
    cancel_at = bool(sub.get("cancel_at_period_end"))
    canceled_at = sub.get("canceled_at")
    cust_s = str(sub.get("customer") or "").strip()
    kwargs: Dict[str, Any] = {
        "subscription_id": sub_str,
        "status": status,
        "current_period_end": cpe,
        "cancel_at_period_end": cancel_at,
        "canceled_at": canceled_at,
    }
    if cust_s:
        kwargs["customer_id"] = cust_s
    ok = community_billing.mark_subscription(community_id, **kwargs)
    return {
        "success": ok,
        "community_id": community_id,
        "stripe_subscription_id": sub_str,
        "subscription_status": status,
        "current_period_end": cpe,
    }


def sync_user_subscription_from_stripe(username: str) -> Dict[str, Any]:
    """Refresh personal Premium Stripe columns from Stripe."""
    stripe_mod = _stripe_client()
    if stripe_mod is None:
        return {"success": False, "error": "stripe_not_configured"}

    state = user_billing.get_billing_state(username) or {}
    sub_id = state.get("stripe_subscription_id")
    sub_str = str(sub_id).strip() if sub_id else ""
    if not sub_str:
        return {"success": False, "error": "no_stripe_subscription_id"}

    try:
        sub = stripe_mod.Subscription.retrieve(sub_str)
    except Exception as exc:
        logger.warning(
            "stripe_subscription_sync: user Subscription.retrieve failed id=%s: %s",
            sub_str,
            exc,
        )
        return {"success": False, "error": "stripe_retrieve_failed", "detail": str(exc)}

    status = (sub.get("status") or "").strip().lower() or None
    cpe = sub.get("current_period_end")
    cancel_at = bool(sub.get("cancel_at_period_end"))
    canceled_at = sub.get("canceled_at")
    cust_s = str(sub.get("customer") or "").strip()
    ok = user_billing.mark_subscription(
        username,
        subscription="premium",
        subscription_id=sub_str,
        customer_id=cust_s if cust_s else None,
        status=status,
        current_period_end=cpe,
        cancel_at_period_end=cancel_at,
        canceled_at=canceled_at,
        provider="stripe",
    )
    return {
        "success": ok,
        "username": username,
        "stripe_subscription_id": sub_str,
        "subscription_status": status,
        "current_period_end": cpe,
    }
