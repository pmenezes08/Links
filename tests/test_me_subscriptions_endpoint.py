from __future__ import annotations

import pytest
from flask import Flask

from backend.blueprints.subscriptions import subscriptions_bp
from backend.services import ai_usage, community_billing, knowledge_base, user_billing
from tests.fixtures import make_community, make_user


@pytest.fixture
def client(mysql_dsn):
    user_billing.ensure_tables()
    community_billing.ensure_tables()
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(subscriptions_bp)
    with app.test_client() as c:
        yield c


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def test_me_subscriptions_returns_personal_and_owned_community(client):
    make_user("owner", subscription="premium")
    community_id = make_community("Paid Root", tier="paid_l1", creator_username="owner")
    user_billing.mark_subscription(
        "owner",
        subscription="premium",
        subscription_id="sub_user",
        customer_id="cus_user",
        status="active",
        current_period_end=1_767_225_600,
    )
    community_billing.mark_subscription(
        community_id,
        tier_code="paid_l1",
        subscription_id="sub_comm",
        customer_id="cus_comm",
        status="active",
        current_period_end=2_000_000_000,
    )

    _login(client, "owner")
    resp = client.get("/api/me/subscriptions")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["personal"]["active"] is True
    assert data["personal"]["current_period_end"]
    assert data["communities"][0]["id"] == community_id
    assert data["communities"][0]["current_period_end"]
    assert data["communities"][0]["tier_subscription_live"] is True
    assert data["communities"][0]["tier_subscription_active"] is True
    assert data["communities"][0]["steve_addon_eligible"] is True
    assert data["personal"]["subscription_active"] is True
    assert data["personal"]["needs_attention"] is False


def test_me_subscriptions_community_missing_renewal_not_eligible_for_steve(client):
    make_user("owner2", subscription="free")
    community_id = make_community("Broken Renewal", tier="paid_l1", creator_username="owner2")
    community_billing.mark_subscription(
        community_id,
        tier_code="paid_l1",
        subscription_id="sub_comm_br",
        customer_id="cus_comm_br",
        status="active",
    )

    _login(client, "owner2")
    resp = client.get("/api/me/subscriptions")
    assert resp.status_code == 200
    data = resp.get_json()
    row = next((c for c in data["communities"] if c["id"] == community_id), None)
    assert row is not None
    assert row["tier_subscription_active"] is False
    assert row["needs_attention"] is True
    assert row["steve_addon_eligible"] is False
    assert row.get("steve_addon_reason") == "renewal_date_missing"


def test_me_subscriptions_personal_past_due_needs_attention(client):
    make_user("pastdue_u", subscription="premium")
    user_billing.mark_subscription(
        "pastdue_u",
        subscription="premium",
        subscription_id="sub_pd",
        customer_id="cus_pd",
        status="past_due",
        current_period_end=1_999_999_999,
    )
    _login(client, "pastdue_u")
    resp = client.get("/api/me/subscriptions")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["personal"]["active"] is False
    assert data["personal"]["subscription_active"] is False
    assert data["personal"]["needs_attention"] is True


def test_community_billing_returns_steve_pool_usage(client):
    knowledge_base.seed_default_pages(force=True)
    ai_usage.ensure_tables()
    make_user("pool_billing_owner", subscription="free")
    community_id = make_community(
        "Pool Billing",
        tier="paid_l1",
        creator_username="pool_billing_owner",
    )
    community_billing.mark_steve_package_subscription(
        community_id,
        subscription_id="sub_steve_billing",
        status="active",
    )
    ai_usage.log_usage(
        "pool_billing_owner",
        surface=ai_usage.SURFACE_FEED,
        request_type="steve_post_reply",
        community_id=community_id,
    )

    _login(client, "pool_billing_owner")
    resp = client.get(f"/api/communities/{community_id}/billing")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["steve_package_subscription_active"] is True
    assert data["steve_pool_cap"] == 300
    assert data["steve_pool_used"] == 1
    assert data["steve_pool_remaining"] == 299
