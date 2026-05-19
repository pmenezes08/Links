"""Unit tests for ``subscription_health`` derivation (no DB)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from backend.services.subscription_health import (
    STEVE_REASON_ELIGIBLE,
    STEVE_REASON_ENTERPRISE_INCLUDED,
    STEVE_REASON_RENEWAL_DATE_EXPIRED,
    STEVE_REASON_RENEWAL_DATE_MISSING,
    STEVE_REASON_STEVE_ALREADY_ACTIVE,
    STEVE_REASON_TIER_SUBSCRIPTION_INACTIVE,
    derive_community_subscription_health,
    derive_personal_subscription_health,
)


def _future_ts(seconds: int = 86400 * 30) -> int:
    return int(datetime.now(timezone.utc).timestamp()) + seconds


def _past_ts(seconds: int = 86400 * 30) -> int:
    return int(datetime.now(timezone.utc).timestamp()) - seconds


@pytest.mark.parametrize(
    "enterprise_included,expect_reason",
    [(True, STEVE_REASON_ENTERPRISE_INCLUDED), (False, STEVE_REASON_ELIGIBLE)],
)
def test_enterprise_steve_included_blocks_addon(enterprise_included, expect_reason):
    state = {
        "tier": "enterprise",
        "stripe_subscription_id": "sub_x",
        "subscription_status": "active",
        "current_period_end": _future_ts(),
        "steve_package_subscription_active": False,
    }
    h = derive_community_subscription_health(
        state,
        enterprise_steve_package_included=enterprise_included,
    )
    if enterprise_included:
        assert h["steve_addon_eligible"] is False
        assert h["steve_addon_reason"] == expect_reason
        assert h["tier_subscription_active"] is True
    else:
        assert h["steve_addon_eligible"] is True
        assert h["steve_addon_reason"] == STEVE_REASON_ELIGIBLE


def test_paid_active_future_eligible():
    state = {
        "tier": "paid_l2",
        "stripe_subscription_id": "sub_t",
        "subscription_status": "active",
        "current_period_end": _future_ts(),
        "steve_package_subscription_active": False,
    }
    h = derive_community_subscription_health(state, enterprise_steve_package_included=True)
    assert h["tier_subscription_active"] is True
    assert h["needs_attention"] is False
    assert h["steve_addon_eligible"] is True
    assert h["steve_addon_reason"] == STEVE_REASON_ELIGIBLE


def test_paid_active_missing_renewal():
    state = {
        "tier": "paid_l1",
        "stripe_subscription_id": "sub_t",
        "subscription_status": "active",
        "current_period_end": None,
        "steve_package_subscription_active": False,
    }
    h = derive_community_subscription_health(state, enterprise_steve_package_included=True)
    assert h["tier_subscription_active"] is False
    assert h["needs_attention"] is True
    assert h["steve_addon_eligible"] is False
    assert h["steve_addon_reason"] == STEVE_REASON_RENEWAL_DATE_MISSING


def test_paid_active_expired_renewal():
    state = {
        "tier": "paid_l1",
        "stripe_subscription_id": "sub_t",
        "subscription_status": "active",
        "current_period_end": _past_ts(),
        "steve_package_subscription_active": False,
    }
    h = derive_community_subscription_health(state, enterprise_steve_package_included=True)
    assert h["steve_addon_eligible"] is False
    assert h["steve_addon_reason"] == STEVE_REASON_RENEWAL_DATE_EXPIRED


def test_past_due_not_eligible():
    state = {
        "tier": "paid_l3",
        "stripe_subscription_id": "sub_t",
        "subscription_status": "past_due",
        "current_period_end": _future_ts(),
        "steve_package_subscription_active": False,
    }
    h = derive_community_subscription_health(state, enterprise_steve_package_included=True)
    assert h["tier_subscription_active"] is False
    assert h["steve_addon_eligible"] is False
    assert h["steve_addon_reason"] == STEVE_REASON_TIER_SUBSCRIPTION_INACTIVE


def test_paid_tier_no_subscription_id():
    state = {
        "tier": "paid_l2",
        "stripe_subscription_id": "",
        "subscription_status": "active",
        "current_period_end": _future_ts(),
        "steve_package_subscription_active": False,
    }
    h = derive_community_subscription_health(state, enterprise_steve_package_included=True)
    assert h["needs_attention"] is True
    assert h["steve_addon_eligible"] is False


def test_steve_already_active_reason():
    state = {
        "tier": "paid_l1",
        "stripe_subscription_id": "sub_t",
        "subscription_status": "active",
        "current_period_end": _future_ts(),
        "steve_package_subscription_active": True,
    }
    h = derive_community_subscription_health(state, enterprise_steve_package_included=True)
    assert h["steve_addon_eligible"] is False
    assert h["steve_addon_reason"] == STEVE_REASON_STEVE_ALREADY_ACTIVE


def test_personal_past_due_needs_attention():
    billing = {
        "stripe_subscription_id": "sub_u",
        "subscription_status": "past_due",
        "current_period_end": _future_ts(),
    }
    h = derive_personal_subscription_health(
        billing,
        subscription_value="premium",
        is_special=False,
    )
    assert h["subscription_active"] is False
    assert h["needs_attention"] is True


def test_personal_active_future():
    billing = {
        "stripe_subscription_id": "sub_u",
        "subscription_status": "active",
        "current_period_end": _future_ts(),
    }
    h = derive_personal_subscription_health(
        billing,
        subscription_value="premium",
        is_special=False,
    )
    assert h["subscription_active"] is True
    assert h["needs_attention"] is False


def test_personal_special_skips_stripe():
    h = derive_personal_subscription_health({}, subscription_value="free", is_special=True)
    assert h["subscription_active"] is True
    assert h["needs_attention"] is False
