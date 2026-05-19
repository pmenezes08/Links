"""Community subscription tier changes.

This service owns the Stripe subscription mutation for paid community
tiers. Routes validate request/session concerns, then call this module
with explicit Stripe and pricing inputs so the billing logic stays small
and testable.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from backend.services import community_billing
from backend.services.community import (
    COMMUNITY_TIER_PAID_L1,
    COMMUNITY_TIER_PAID_L2,
    COMMUNITY_TIER_PAID_L3,
)


logger = logging.getLogger(__name__)

ALLOWED_TIER_CODES = {
    COMMUNITY_TIER_PAID_L1,
    COMMUNITY_TIER_PAID_L2,
    COMMUNITY_TIER_PAID_L3,
}

_TIER_RANK = {
    COMMUNITY_TIER_PAID_L1: 1,
    COMMUNITY_TIER_PAID_L2: 2,
    COMMUNITY_TIER_PAID_L3: 3,
}


class TierChangeError(Exception):
    """Expected tier-change failure with API-friendly metadata."""

    def __init__(self, message: str, *, reason: str, status_code: int = 400):
        super().__init__(message)
        self.reason = reason
        self.status_code = status_code


def change_community_tier(
    *,
    stripe_mod: Any,
    community_id: int,
    target_tier: str,
    target_price_id: str,
) -> Dict[str, Any]:
    """Change an active community Stripe subscription to ``target_tier``.

    The caller is responsible for permission, root-community, price, and
    member-cap validation. This function focuses on the Stripe mutation
    and local state persistence.
    """
    target_tier = (target_tier or "").strip().lower()
    if target_tier not in ALLOWED_TIER_CODES:
        raise TierChangeError("Unsupported community tier", reason="invalid_tier")
    if not target_price_id:
        raise TierChangeError("Pricing is not configured for this tier", reason="price_missing")

    state = community_billing.get_billing_state(community_id) or {}
    current_tier = str(state.get("tier") or "").strip().lower()
    if current_tier == target_tier:
        raise TierChangeError("This community is already on that tier", reason="same_tier", status_code=409)

    subscription_id = state.get("stripe_subscription_id")
    if not subscription_id:
        raise TierChangeError("This community has no Stripe subscription yet", reason="no_subscription", status_code=409)

    subscription = _retrieve_subscription(stripe_mod, str(subscription_id))
    item_id = _subscription_item_id(subscription)
    if not item_id:
        raise TierChangeError("Could not identify the Stripe subscription item", reason="missing_subscription_item", status_code=502)

    proration_behavior = _proration_behavior(current_tier, target_tier)
    metadata = {
        **_metadata_from_subscription(subscription),
        "sku": "community_tier",
        "community_id": str(community_id),
        "tier_code": target_tier,
        "tier_change_initiator": "app",
    }

    try:
        updated = stripe_mod.Subscription.modify(
            str(subscription_id),
            cancel_at_period_end=False,
            items=[{"id": item_id, "price": target_price_id}],
            metadata=metadata,
            proration_behavior=proration_behavior,
        )
    except Exception as exc:
        logger.exception("Stripe tier change failed for community %s", community_id)
        raise TierChangeError("Unable to change community tier in Stripe", reason="stripe_update_failed", status_code=502) from exc

    status = str(_value(updated, "status") or state.get("subscription_status") or "active").lower()
    period_end = _value(updated, "current_period_end") or state.get("current_period_end")
    cancel_at_period_end = bool(_value(updated, "cancel_at_period_end") or False)
    customer_id = _stripe_id(_value(updated, "customer")) or state.get("stripe_customer_id")

    community_billing.mark_subscription(
        community_id,
        tier_code=target_tier,
        subscription_id=str(subscription_id),
        customer_id=customer_id,
        status=status,
        current_period_end=period_end,
        cancel_at_period_end=cancel_at_period_end,
    )

    refreshed = community_billing.get_billing_state(community_id) or {}
    return {
        "community_id": community_id,
        "previous_tier": current_tier,
        "tier": target_tier,
        "stripe_subscription_id": str(subscription_id),
        "subscription_status": status,
        "current_period_end": refreshed.get("current_period_end"),
        "proration_behavior": proration_behavior,
        "change_direction": _change_direction(current_tier, target_tier),
    }


def _retrieve_subscription(stripe_mod: Any, subscription_id: str) -> Any:
    try:
        return stripe_mod.Subscription.retrieve(subscription_id)
    except Exception as exc:
        logger.exception("Stripe subscription retrieve failed for %s", subscription_id)
        raise TierChangeError("Unable to load Stripe subscription", reason="stripe_retrieve_failed", status_code=502) from exc


def _subscription_item_id(subscription: Any) -> Optional[str]:
    items = _value(subscription, "items") or {}
    data = _value(items, "data") or []
    if not data:
        return None
    first = data[0]
    return _stripe_id(first)


def _metadata_from_subscription(subscription: Any) -> Dict[str, str]:
    metadata = _value(subscription, "metadata") or {}
    if not isinstance(metadata, dict):
        return {}
    return {str(k): str(v) for k, v in metadata.items() if v is not None}


def _proration_behavior(current_tier: str, target_tier: str) -> str:
    env_value = (os.getenv("COMMUNITY_TIER_CHANGE_PRORATION_BEHAVIOR") or "").strip()
    if env_value in {"always_invoice", "create_prorations", "none"}:
        return env_value
    # Explicit default: apply the tier change immediately and let Stripe
    # prorate the billing adjustment.
    return "create_prorations"


def _change_direction(current_tier: str, target_tier: str) -> str:
    current_rank = _TIER_RANK.get(current_tier, 0)
    target_rank = _TIER_RANK.get(target_tier, 0)
    if target_rank > current_rank:
        return "upgrade"
    if target_rank < current_rank:
        return "downgrade"
    return "same"


def _stripe_id(value: Any) -> Optional[str]:
    if isinstance(value, dict):
        value = value.get("id")
    elif value is not None and not isinstance(value, (str, int)):
        value = _value(value, "id")
    text = str(value or "").strip()
    return text or None


def _value(obj: Any, key: str) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    try:
        return obj.get(key)
    except Exception:
        return getattr(obj, key, None)
