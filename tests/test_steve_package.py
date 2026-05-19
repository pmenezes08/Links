"""Steve Community Package — Checkout Session creation + Stripe webhook writes."""

from __future__ import annotations

from typing import Any, Dict

import pytest
from flask import Flask

from backend.blueprints.subscription_webhooks import subscription_webhooks_bp
from backend.blueprints.subscriptions import subscriptions_bp
from backend.services import community_billing, knowledge_base as kb, subscription_audit

from tests.fixtures import make_community, make_user

pytestmark = pytest.mark.usefixtures("mysql_dsn")


@pytest.fixture
def webhook_client(mysql_dsn, monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_dummy")
    community_billing.ensure_tables()
    subscription_audit.ensure_tables()
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(subscription_webhooks_bp)
    with app.test_client() as c:
        yield c


@pytest.fixture
def checkout_client(mysql_dsn, monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "sk_test_dummy_for_tests")
    community_billing.ensure_tables()

    captured: dict = {}

    def _fake_create(**kwargs):
        captured["kwargs"] = kwargs
        return {"id": "cs_steve_fake", "url": "https://stripe.test/cs"}

    import stripe  # type: ignore

    monkeypatch.setattr(stripe.checkout.Session, "create", _fake_create)

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(subscriptions_bp)
    with app.test_client() as c:
        c._captured = captured  # type: ignore[attr-defined]
        yield c


def _install_webhook_event(monkeypatch, event: Dict[str, Any]) -> None:
    import stripe  # type: ignore

    def _fake(payload, sig_header, secret):  # noqa: ARG001
        return event

    monkeypatch.setattr(stripe.Webhook, "construct_event", _fake)


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _seed_steve_price(price_id: str = "price_steve_kb") -> None:
    kb.seed_default_pages(force=True)
    page = kb.get_page("community-tiers") or {}
    fields = list(page.get("fields") or [])
    for f in fields:
        if f.get("name") == "paid_steve_package_stripe_price_id_test":
            f["value"] = price_id
    kb.save_page(
        "community-tiers",
        fields=fields,
        reason="test-fixture",
        actor_username="test-fixture",
    )


class TestSteveCheckout:
    def test_owner_with_active_paid_tier_can_open_session(self, checkout_client):
        make_user("steve_co_owner", subscription="free")
        cid = make_community(
            "steve-co-net",
            tier="paid_l1",
            creator_username="steve_co_owner",
        )
        community_billing.mark_subscription(
            cid,
            tier_code="paid_l1",
            subscription_id="sub_tier_co",
            customer_id="cus_co_owner",
            status="active",
            current_period_end=2_000_000_000,
        )
        _seed_steve_price()
        _login(checkout_client, "steve_co_owner")

        resp = checkout_client.post(
            "/api/stripe/create_checkout_session",
            json={"plan_id": "steve_package", "community_id": cid},
        )
        assert resp.status_code == 200, resp.get_json()
        kwargs = checkout_client._captured["kwargs"]  # type: ignore[attr-defined]
        meta = kwargs.get("metadata") or {}
        assert meta.get("sku") == "steve_package"
        assert meta.get("community_id") == str(cid)
        assert kwargs.get("customer") == "cus_co_owner"

    def test_blocks_when_steve_already_active(self, checkout_client):
        make_user("dup_owner", subscription="free")
        cid = make_community(
            "dup-steve-net",
            tier="paid_l1",
            creator_username="dup_owner",
        )
        community_billing.mark_subscription(
            cid,
            tier_code="paid_l1",
            subscription_id="sub_tier_dup",
            customer_id="cus_dup",
            status="active",
            current_period_end=2_000_000_000,
        )
        community_billing.mark_steve_package_subscription(
            cid,
            subscription_id="sub_steve_dup",
            status="active",
        )
        _seed_steve_price()
        _login(checkout_client, "dup_owner")

        resp = checkout_client.post(
            "/api/stripe/create_checkout_session",
            json={"plan_id": "steve_package", "community_id": cid},
        )
        assert resp.status_code == 409
        body = resp.get_json() or {}
        assert body.get("reason") == "steve_package_already_active"

    def test_blocks_when_renewal_date_missing(self, checkout_client):
        make_user("mr_owner", subscription="free")
        cid = make_community(
            "mr-steve-net",
            tier="paid_l1",
            creator_username="mr_owner",
        )
        community_billing.mark_subscription(
            cid,
            tier_code="paid_l1",
            subscription_id="sub_tier_mr",
            customer_id="cus_mr",
            status="active",
        )
        _seed_steve_price()
        _login(checkout_client, "mr_owner")

        resp = checkout_client.post(
            "/api/stripe/create_checkout_session",
            json={"plan_id": "steve_package", "community_id": cid},
        )
        assert resp.status_code == 409
        body = resp.get_json() or {}
        assert body.get("reason") == "renewal_date_missing"
    def test_checkout_completed_writes_steve_columns(self, webhook_client, monkeypatch):
        make_user("wh_owner", subscription="free")
        cid = make_community(
            "wh-steve-net",
            tier="paid_l1",
            creator_username="wh_owner",
        )
        event = {
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "subscription": "sub_steve_new",
                    "customer": "cus_wh",
                    "client_reference_id": f"community:{cid}",
                    "metadata": {
                        "sku": "steve_package",
                        "plan_id": "steve_package",
                        "username": "wh_owner",
                        "community_id": str(cid),
                    },
                }
            },
        }
        _install_webhook_event(monkeypatch, event)

        import stripe  # type: ignore

        monkeypatch.setattr(
            stripe.Subscription,
            "retrieve",
            lambda sid: {
                "id": sid,
                "current_period_end": 1893456000,
                "cancel_at_period_end": False,
            },
        )

        resp = webhook_client.post(
            "/api/webhooks/stripe",
            data=b"{}",
            headers={"Stripe-Signature": "t=0,v1=ignored"},
        )
        assert resp.status_code == 200

        state = community_billing.get_billing_state(cid) or {}
        assert state.get("steve_package_stripe_subscription_id") == "sub_steve_new"
        assert state.get("steve_package_subscription_status") == "active"
