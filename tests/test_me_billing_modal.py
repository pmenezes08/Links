from __future__ import annotations

from flask import Flask

from backend.blueprints import me as me_mod
from backend.blueprints.me import me_bp
from backend.services import community_billing, subscription_billing_ledger, user_billing
from tests.fixtures import make_community, make_user


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _invoice(invoice_id: str, subscription_id: str, amount: int = 799) -> dict:
    return {
        "id": invoice_id,
        "subscription": subscription_id,
        "customer": "cus_test",
        "amount_paid": amount,
        "currency": "eur",
        "created": 1_767_225_600,
        "status_transitions": {"paid_at": 1_767_225_600},
        "lines": {
            "data": [
                {
                    "period": {
                        "start": 1_767_139_200,
                        "end": 1_769_817_600,
                    },
                },
            ],
        },
        "hosted_invoice_url": "https://invoice.stripe.test/example",
    }


def test_me_billing_prefers_stored_subscription_state(mysql_dsn, monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "sk_test_dummy_for_tests")
    user_billing.ensure_tables()
    make_user("billing_local", subscription="premium")
    user_billing.mark_subscription(
        "billing_local",
        subscription="premium",
        subscription_id="sub_local",
        customer_id="cus_local",
        status="active",
        current_period_end=1_767_225_600,
        provider="stripe",
        stripe_mode="test",
    )

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(me_bp)
    with app.test_client() as client:
        _login(client, "billing_local")
        resp = client.get("/api/me/billing")

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["stripe"]["subscription"]["subscription_id"] == "sub_local"
    assert body["stripe"]["subscription"]["customer_id"] == "cus_local"
    assert body["stripe"]["subscription"]["current_period_end"] == 1_767_225_600
    assert body["stripe"]["portal_available"] is True


def test_me_billing_uses_active_stripe_when_stored_state_is_stale(mysql_dsn, monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "sk_live_dummy_for_tests")
    user_billing.ensure_tables()
    make_user("billing_stale", email="stale@example.com", subscription="free")
    user_billing.mark_subscription(
        "billing_stale",
        subscription="free",
        subscription_id="sub_old_test",
        customer_id="cus_old_test",
        status="cancelled",
        current_period_end=1_767_225_600,
        provider="stripe",
        stripe_mode="test",
    )
    monkeypatch.setattr(me_mod, "_stripe_client", lambda: object())
    monkeypatch.setattr(
        me_mod,
        "_find_stripe_subscription",
        lambda _stripe, email: {
            "customer_id": "cus_live",
            "subscription_id": "sub_live",
            "status": "active",
            "cancel_at_period_end": False,
            "current_period_end": 1_782_154_145,
            "trial_end": None,
            "price_amount_cents": 799,
            "price_interval": "month",
            "price_currency": "EUR",
        } if email == "stale@example.com" else None,
    )

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(me_bp)
    with app.test_client() as client:
        _login(client, "billing_stale")
        resp = client.get("/api/me/billing")

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["stripe"]["subscription"]["subscription_id"] == "sub_live"
    assert body["stripe"]["subscription"]["status"] == "active"
    assert body["stripe"]["subscription"]["current_period_end"] == 1_782_154_145
    assert body["stripe"]["billing_state_source"] == "stripe_email"
    assert body["stripe"]["needs_sync"] is True
    assert body["stripe"]["portal_available"] is True


def test_me_payment_history_returns_personal_and_community_invoices(mysql_dsn):
    user_billing.ensure_tables()
    community_billing.ensure_tables()
    subscription_billing_ledger.ensure_tables()
    make_user("pay_history", subscription="premium")
    community_id = make_community("Growth Network", creator_username="pay_history", tier="paid_l1")
    user_billing.mark_subscription(
        "pay_history",
        subscription="premium",
        subscription_id="sub_personal_history",
        customer_id="cus_personal_history",
        status="active",
    )
    community_billing.mark_subscription(
        community_id,
        tier_code="paid_l1",
        subscription_id="sub_community_history",
        customer_id="cus_community_history",
        status="active",
    )
    subscription_billing_ledger.record_invoice_payment(
        _invoice("in_personal_history", "sub_personal_history", 799),
    )
    subscription_billing_ledger.record_invoice_payment(
        _invoice("in_community_history", "sub_community_history", 4999),
    )

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(me_bp)
    with app.test_client() as client:
        _login(client, "pay_history")
        resp = client.get("/api/me/payment-history")

    assert resp.status_code == 200
    body = resp.get_json()
    invoices = {row["stripe_invoice_id"]: row for row in body["payments"]}
    assert invoices["in_personal_history"]["scope"] == "personal"
    assert invoices["in_community_history"]["scope"] == "community"
    assert invoices["in_community_history"]["community_name"] == "Growth Network"


def test_payment_history_resolves_invoice_by_customer_id(mysql_dsn):
    user_billing.ensure_tables()
    subscription_billing_ledger.ensure_tables()
    make_user("pay_customer", subscription="premium")
    user_billing.mark_subscription(
        "pay_customer",
        subscription="premium",
        subscription_id="sub_current",
        customer_id="cus_current",
        status="active",
    )

    inserted = subscription_billing_ledger.record_invoice_payment({
        **_invoice("in_customer_history", "sub_old", 799),
        "customer": "cus_current",
    })

    assert inserted is True
    rows = subscription_billing_ledger.list_for_user("pay_customer")
    assert rows[0]["stripe_invoice_id"] == "in_customer_history"
