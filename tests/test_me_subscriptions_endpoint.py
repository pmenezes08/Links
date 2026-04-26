from __future__ import annotations

import pytest
from flask import Flask

from backend.blueprints.subscriptions import subscriptions_bp
from backend.services import community_billing, user_billing
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
        current_period_end=1_767_225_600,
    )

    _login(client, "owner")
    resp = client.get("/api/me/subscriptions")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["personal"]["active"] is True
    assert data["personal"]["current_period_end"]
    assert data["communities"][0]["id"] == community_id
    assert data["communities"][0]["current_period_end"]
