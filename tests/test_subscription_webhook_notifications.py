from __future__ import annotations

import pytest

from backend.blueprints import subscription_webhooks as webhooks
from backend.services import community_billing, community_lifecycle
from tests.fixtures import (
    fill_community_members,
    kb_override_field,
    make_community,
    make_user,
)


pytestmark = pytest.mark.usefixtures("mysql_dsn")


def test_stripe_side_community_cancel_notifies_owner_and_admin(monkeypatch):
    owner_calls = []
    admin_calls = []
    monkeypatch.setattr(
        webhooks.community_admin_notifications,
        "notify_owner_of_admin_action",
        lambda **kwargs: owner_calls.append(kwargs) or True,
    )
    monkeypatch.setattr(
        webhooks.community_admin_notifications,
        "notify_platform_admins_of_stripe_cancellation",
        lambda **kwargs: admin_calls.append(kwargs) or 1,
    )
    make_user("cancel_owner")
    cid = make_community("Stripe Cancel", creator_username="cancel_owner", tier="paid_l1")
    community_billing.mark_subscription(
        cid,
        tier_code="paid_l1",
        subscription_id="sub_cancel",
        customer_id="cus_cancel",
        status="active",
    )

    webhooks._handle_community_tier_event(
        "customer.subscription.deleted",
        {"id": "sub_cancel", "metadata": {"sku": "community_tier", "community_id": str(cid)}},
        "cancel_owner",
    )

    assert owner_calls[0]["action"] == "stripe_cancelled"
    assert owner_calls[0]["community_id"] == cid
    assert admin_calls == [{"community_id": cid}]


def test_app_initiated_cancel_does_not_notify(monkeypatch):
    owner_calls = []
    admin_calls = []
    monkeypatch.setattr(
        webhooks.community_admin_notifications,
        "notify_owner_of_admin_action",
        lambda **kwargs: owner_calls.append(kwargs) or True,
    )
    monkeypatch.setattr(
        webhooks.community_admin_notifications,
        "notify_platform_admins_of_stripe_cancellation",
        lambda **kwargs: admin_calls.append(kwargs) or 1,
    )
    make_user("app_cancel_owner")
    cid = make_community("App Cancel", creator_username="app_cancel_owner", tier="paid_l1")
    community_billing.mark_subscription(
        cid,
        tier_code="paid_l1",
        subscription_id="sub_app_cancel",
        customer_id="cus_app_cancel",
        status="active",
    )

    webhooks._handle_community_tier_event(
        "customer.subscription.deleted",
        {
            "id": "sub_app_cancel",
            "metadata": {
                "sku": "community_tier",
                "community_id": str(cid),
                "cancellation_initiator": "app",
            },
        },
        "app_cancel_owner",
    )

    assert owner_calls == []
    assert admin_calls == []


def test_stripe_side_tier_change_notifies_owner(monkeypatch):
    owner_calls = []
    monkeypatch.setattr(
        webhooks.community_admin_notifications,
        "notify_owner_of_admin_action",
        lambda **kwargs: owner_calls.append(kwargs) or True,
    )
    monkeypatch.setattr(webhooks, "_tier_from_subscription_price", lambda obj: "paid_l2")
    make_user("tier_owner")
    cid = make_community("Stripe Tier Change", creator_username="tier_owner", tier="paid_l1")
    community_billing.mark_subscription(
        cid,
        tier_code="paid_l1",
        subscription_id="sub_tier",
        customer_id="cus_tier",
        status="active",
    )

    webhooks._handle_community_tier_event(
        "customer.subscription.updated",
        {
            "id": "sub_tier",
            "status": "active",
            "metadata": {"sku": "community_tier", "community_id": str(cid)},
        },
        "tier_owner",
    )

    assert owner_calls[0]["action"] == "tier_upgraded"
    assert owner_calls[0]["community_id"] == cid
    assert (community_billing.get_billing_state(cid) or {})["tier"] == "paid_l2"


def test_stripe_subscription_deleted_triggers_auto_freeze(monkeypatch):
    """Stripe-side cancellation freezes a community over the Free cap."""
    monkeypatch.setattr(
        webhooks.community_admin_notifications,
        "notify_owner_of_admin_action",
        lambda **kwargs: True,
    )
    monkeypatch.setattr(
        webhooks.community_admin_notifications,
        "notify_platform_admins_of_stripe_cancellation",
        lambda **kwargs: 1,
    )
    freeze_calls = []
    monkeypatch.setattr(
        community_lifecycle,
        "_notify_owner_subscription_freeze",
        lambda **kwargs: freeze_calls.append(kwargs),
    )

    kb_override_field(
        "community-tiers", "free_community_max_members", 25,
        field_type="integer",
    )
    kb_override_field(
        "community-tiers",
        "community_lifecycle_notifications_enabled",
        True,
        field_type="boolean",
    )

    make_user("freeze_webhook_owner")
    cid = make_community(
        "Freeze Webhook", creator_username="freeze_webhook_owner", tier="paid_l1"
    )
    fill_community_members(cid, 30)
    community_billing.mark_subscription(
        cid,
        tier_code="paid_l1",
        subscription_id="sub_freeze_webhook",
        customer_id="cus_freeze_webhook",
        status="active",
    )

    webhooks._handle_community_tier_event(
        "customer.subscription.deleted",
        {
            "id": "sub_freeze_webhook",
            "metadata": {"sku": "community_tier", "community_id": str(cid)},
        },
        "freeze_webhook_owner",
    )

    state = community_lifecycle.get_freeze_state(cid)
    assert state["is_frozen"] is True
    assert state["frozen_reason"] == "subscription_expired"
    assert len(freeze_calls) == 1


def test_stripe_subscription_deleted_no_freeze_under_cap(monkeypatch):
    """No freeze when the community fits within the Free cap."""
    monkeypatch.setattr(
        webhooks.community_admin_notifications,
        "notify_owner_of_admin_action",
        lambda **kwargs: True,
    )
    monkeypatch.setattr(
        webhooks.community_admin_notifications,
        "notify_platform_admins_of_stripe_cancellation",
        lambda **kwargs: 1,
    )
    freeze_calls = []
    monkeypatch.setattr(
        community_lifecycle,
        "_notify_owner_subscription_freeze",
        lambda **kwargs: freeze_calls.append(kwargs),
    )

    kb_override_field(
        "community-tiers", "free_community_max_members", 25,
        field_type="integer",
    )

    make_user("no_freeze_owner")
    cid = make_community(
        "No Freeze", creator_username="no_freeze_owner", tier="paid_l1"
    )
    fill_community_members(cid, 5)
    community_billing.mark_subscription(
        cid,
        tier_code="paid_l1",
        subscription_id="sub_no_freeze",
        customer_id="cus_no_freeze",
        status="active",
    )

    webhooks._handle_community_tier_event(
        "customer.subscription.deleted",
        {
            "id": "sub_no_freeze",
            "metadata": {"sku": "community_tier", "community_id": str(cid)},
        },
        "no_freeze_owner",
    )

    state = community_lifecycle.get_freeze_state(cid)
    assert state["is_frozen"] is False
    assert freeze_calls == []
