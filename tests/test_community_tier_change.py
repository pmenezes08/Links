from __future__ import annotations

import pytest
from flask import Flask

from backend.blueprints.subscriptions import subscriptions_bp
from backend.services import community_billing, knowledge_base as kb
from tests.fixtures import fill_community_members, make_community, make_user


pytestmark = pytest.mark.usefixtures("mysql_dsn")


@pytest.fixture
def client(mysql_dsn, monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "sk_test_dummy_for_tests")
    community_billing.ensure_tables()
    _seed_tier_prices()

    captured: dict = {}

    def _fake_retrieve(subscription_id):
        captured["retrieved"] = subscription_id
        return {
            "id": subscription_id,
            "customer": "cus_test",
            "status": "active",
            "current_period_end": 1_767_225_600,
            "metadata": {"sku": "community_tier", "community_id": "1", "tier_code": "paid_l2"},
            "items": {"data": [{"id": "si_test_123"}]},
        }

    def _fake_modify(subscription_id, **kwargs):
        captured["modified"] = {"subscription_id": subscription_id, **kwargs}
        return {
            "id": subscription_id,
            "customer": "cus_test",
            "status": "active",
            "current_period_end": 1_767_225_600,
            "cancel_at_period_end": False,
            "items": {"data": [{"id": "si_test_123"}]},
        }

    import stripe  # type: ignore
    monkeypatch.setattr(stripe.Subscription, "retrieve", _fake_retrieve)
    monkeypatch.setattr(stripe.Subscription, "modify", _fake_modify)

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(subscriptions_bp)

    with app.test_client() as c:
        c._captured = captured  # type: ignore[attr-defined]
        yield c


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _seed_tier_prices() -> None:
    kb.seed_default_pages(force=True)
    page = kb.get_page("community-tiers") or {}
    fields = list(page.get("fields") or [])
    values = {
        "paid_l1_stripe_price_id_test": "price_l1_test",
        "paid_l2_stripe_price_id_test": "price_l2_test",
        "paid_l3_stripe_price_id_test": "price_l3_test",
    }
    for field in fields:
        name = field.get("name")
        if name in values:
            field["value"] = values[name]
    kb.save_page(
        "community-tiers",
        fields=fields,
        reason="test-fixture",
        actor_username="test-fixture",
    )


def test_owner_can_upgrade_active_community_tier(client):
    make_user("tier_owner")
    cid = make_community("tier-change-root", tier="paid_l2", creator_username="tier_owner")
    community_billing.mark_subscription(
        cid,
        tier_code="paid_l2",
        subscription_id="sub_test_123",
        customer_id="cus_test",
        status="active",
        current_period_end=1_767_225_600,
    )
    _login(client, "tier_owner")

    resp = client.post(
        f"/api/communities/{cid}/billing/change-tier",
        json={"tier_code": "paid_l3"},
    )

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["tier"] == "paid_l3"
    assert body["change_direction"] == "upgrade"
    modified = client._captured["modified"]  # type: ignore[attr-defined]
    assert modified["items"] == [{"id": "si_test_123", "price": "price_l3_test"}]
    assert modified["cancel_at_period_end"] is False
    assert modified["proration_behavior"] == "create_prorations"
    assert community_billing.get_billing_state(cid)["tier"] == "paid_l3"


def test_downgrade_rejects_when_member_count_exceeds_target_cap(client):
    make_user("busy_owner")
    cid = make_community("busy-tier-change-root", tier="paid_l2", creator_username="busy_owner")
    fill_community_members(cid, 100, prefix="busy_member")
    community_billing.mark_subscription(
        cid,
        tier_code="paid_l2",
        subscription_id="sub_busy_123",
        customer_id="cus_busy",
        status="active",
        current_period_end=1_767_225_600,
    )
    _login(client, "busy_owner")

    resp = client.post(
        f"/api/communities/{cid}/billing/change-tier",
        json={"tier_code": "paid_l1"},
    )

    assert resp.status_code == 409
    body = resp.get_json()
    assert body["reason"] == "tier_too_small"
    assert "modified" not in client._captured  # type: ignore[attr-defined]
