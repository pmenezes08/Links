from __future__ import annotations

import pytest
from flask import Flask

from backend.blueprints import admin_subscriptions as admin_mod
from backend.services import knowledge_base, subscription_billing_ledger as ledger
from tests.fixtures import make_user, seed_kb


@pytest.fixture
def client(mysql_dsn, monkeypatch):
    knowledge_base.ensure_tables()
    ledger.ensure_tables()
    monkeypatch.setattr(admin_mod, "is_app_admin", lambda username: username == "admin")

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(admin_mod.admin_subscriptions_bp)
    with app.test_client() as c:
        yield c


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def test_users_report_includes_special_users_and_spend_fields(client):
    make_user("admin", is_admin=True)
    make_user("mary", is_special=True)
    seed_kb([
        {
            "slug": "user-tiers",
            "title": "User Tiers",
            "category": "pricing",
            "fields": [
                {"name": "premium_price_early_eur", "type": "number", "value": 9},
                {"name": "premium_stripe_price_id_test", "type": "text", "value": "price_test"},
            ],
        }
    ])
    ledger.record_invoice_payment({
        "id": "in_mary_1",
        "amount_paid": 900,
        "currency": "eur",
        "created": 1_735_689_600,
        "metadata": {"sku": "premium", "username": "mary"},
    })

    _login(client, "admin")
    resp = client.get("/api/admin/subscriptions/users")
    assert resp.status_code == 200
    rows = resp.get_json()["users"]
    mary = next(row for row in rows if row["username"] == "mary")
    assert mary["is_special"] is True
    assert mary["billing_kind"] == "special"
    assert mary["current_subscription_value_cents"] == 900
    assert mary["spent_total_cents"] == 900
    assert "spent_ytd_cents" in mary


def test_admin_report_requires_admin_session(client):
    make_user("regular")
    _login(client, "regular")
    resp = client.get("/api/admin/subscriptions/users")
    assert resp.status_code == 403
