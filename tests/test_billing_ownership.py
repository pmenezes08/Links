from __future__ import annotations

from backend.blueprints import subscriptions
from backend.services import billing_ownership


def test_apple_owned_root_blocks_stripe_tier_change(monkeypatch):
    monkeypatch.setattr(
        subscriptions.community_svc,
        "is_community_owner",
        lambda _username, _community_id: True,
    )
    monkeypatch.setattr(
        subscriptions.community_svc,
        "resolve_root_community_id",
        lambda community_id: (community_id, True),
    )
    monkeypatch.setattr(
        billing_ownership,
        "resolve_root_community_id",
        lambda community_id: (community_id, True),
    )
    monkeypatch.setattr(
        subscriptions.community_billing,
        "get_billing_state",
        lambda _community_id: {
            "tier": "paid_l1",
            "billing_provider": "apple",
            "stripe_subscription_id": "apple_original_tx",
            "subscription_status": "active",
        },
    )
    monkeypatch.setattr(billing_ownership.iap_links, "list_for_community", lambda _community_id: [])
    monkeypatch.setattr(
        subscriptions.community_billing,
        "has_active_subscription",
        lambda _community_id: True,
    )

    blocked = subscriptions._preflight_community_tier("owner", 123, "paid_l2")

    assert blocked is not None
    payload, status = blocked
    assert status == 409
    assert payload["reason"] == "managed_by_other_provider"
    assert payload["current_provider"] == "apple"


def test_stripe_owned_root_allows_stripe_steve_package(monkeypatch):
    monkeypatch.setattr(
        subscriptions.community_svc,
        "is_community_owner",
        lambda _username, _community_id: True,
    )
    monkeypatch.setattr(
        subscriptions.community_svc,
        "resolve_root_community_id",
        lambda community_id: (community_id, True),
    )
    monkeypatch.setattr(
        billing_ownership,
        "resolve_root_community_id",
        lambda community_id: (community_id, True),
    )
    monkeypatch.setattr(
        subscriptions.community_billing,
        "get_billing_state",
        lambda _community_id: {
            "tier": "paid_l1",
            "billing_provider": "stripe",
            "stripe_subscription_id": "sub_comm",
            "subscription_status": "active",
            "stripe_mode": "test",
        },
    )
    monkeypatch.setattr(billing_ownership.iap_links, "list_for_community", lambda _community_id: [])
    monkeypatch.setattr(subscriptions, "_kb_field_map", lambda _slug: {})
    monkeypatch.setattr(subscriptions, "_kb_truthy", lambda _fields, _key, _default=True: True)
    monkeypatch.setattr(
        subscriptions,
        "derive_community_subscription_health",
        lambda _state, enterprise_steve_package_included=True: {
            "steve_addon_eligible": True,
        },
    )

    assert subscriptions._preflight_steve_package("owner", 123) is None


def test_user_premium_needs_reconciliation_when_store_and_stripe_active(monkeypatch):
    monkeypatch.setattr(
        billing_ownership.user_billing,
        "get_billing_state",
        lambda _username: {
            "subscription": "premium",
            "subscription_provider": "stripe",
            "stripe_subscription_id": "sub_live",
            "subscription_status": "active",
            "stripe_mode": "live",
        },
    )
    monkeypatch.setattr(
        billing_ownership.iap_links,
        "list_for_user",
        lambda _username: [{
            "provider": "apple",
            "purchase_key": "apple_tx",
            "sku": "premium",
            "status": "active",
            "environment": "Production",
        }],
    )

    decision = billing_ownership.check_premium(
        "JohnDoe",
        incoming_provider="apple",
        incoming_mode="Production",
        incoming_id="apple_tx",
    )

    assert decision.allowed is False
    assert decision.reason == billing_ownership.DECISION_NEEDS_RECONCILIATION
