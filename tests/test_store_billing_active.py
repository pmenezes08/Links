"""Store-billed rows must block Stripe portal and change-tier paths."""

from __future__ import annotations

import pytest
from flask import Flask

from backend.blueprints.me import me_bp
from backend.blueprints.subscriptions import subscriptions_bp
from backend.services import community_billing, user_billing

from tests.fixtures import make_community, make_user

pytestmark = pytest.mark.usefixtures("mysql_dsn")


@pytest.fixture
def client(mysql_dsn, monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "sk_test_dummy_for_tests")
    community_billing.ensure_tables()
    user_billing.ensure_tables()

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(me_bp)
    app.register_blueprint(subscriptions_bp)

    with app.test_client() as c:
        yield c


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def test_personal_portal_blocks_apple_provider(client):
    make_user("store_user", subscription="premium")
    user_billing.mark_subscription(
        "store_user",
        subscription="premium",
        subscription_id="apple_tx_1",
        status="active",
        provider="apple",
    )
    _login(client, "store_user")

    res = client.post(
        "/api/me/billing/portal",
        json={"return_path": "/account_settings"},
        headers={"Content-Type": "application/json"},
    )
    body = res.get_json()
    assert res.status_code == 409
    assert body["reason"] == "store_billing_active"
    assert body["billing_provider"] == "apple"


def test_community_change_tier_blocks_google_provider(client):
    owner = "owner_google"
    make_user(owner)
    community_id = make_community("Paid Group", creator_username=owner, tier="paid_l1")
    community_billing.mark_subscription(
        community_id,
        tier_code="paid_l1",
        subscription_id="play_token_abc",
        status="active",
        provider="google",
    )
    _login(client, owner)

    res = client.post(
        f"/api/communities/{community_id}/billing/change-tier",
        json={"tier_code": "paid_l2"},
        headers={"Content-Type": "application/json"},
    )
    body = res.get_json()
    assert res.status_code == 409
    assert body["reason"] == "store_billing_active"
    assert body["billing_provider"] == "google"
