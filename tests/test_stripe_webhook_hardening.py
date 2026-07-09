"""Stripe webhook hardening — pre-ads-launch billing fixes.

Covers the four correctness gaps found in the 2026-07 billing audit:

    1. Invoice events route by the *subscription's* metadata
       (``parent.subscription_details.metadata``) — invoices carry their
       own empty metadata, which used to send every ``invoice.payment_failed``
       to the personal-Premium handler.
    2. ``customer.subscription.updated`` follows the Stripe status instead
       of unconditionally re-stamping ``premium`` (stale/retried events
       must not re-grant after a terminal status).
    3. Failed DB writes return 500 so Stripe redelivers instead of the
       grant/revoke being silently dropped.
    4. Duplicate checkouts, disputes and refunds get handled:
       auto-cancel, revoke, and audit-only respectively.

Signature verification is bypassed the same way as in
``test_stripe_webhook_community.py`` — we monkey-patch
``stripe.Webhook.construct_event``.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import pytest
from flask import Flask

from backend.blueprints import subscription_webhooks as webhooks_mod
from backend.blueprints.subscription_webhooks import subscription_webhooks_bp
from backend.services import community_billing, subscription_audit, user_billing
from backend.services.database import get_db_connection, get_sql_placeholder

from tests.fixtures import make_community, make_user

pytestmark = pytest.mark.usefixtures("mysql_dsn")


# ── Fixtures ────────────────────────────────────────────────────────────


@pytest.fixture
def client(mysql_dsn, monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_dummy")
    community_billing.ensure_tables()
    user_billing.ensure_tables()
    subscription_audit.ensure_tables()

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(subscription_webhooks_bp)
    with app.test_client() as c:
        yield c


@pytest.fixture
def notif_spy(monkeypatch) -> List[Dict[str, Any]]:
    """Record in-app/push notifications instead of writing them."""
    calls: List[Dict[str, Any]] = []

    def _fake_create(user_id, from_user, notification_type, **kwargs):
        calls.append({"kind": "in_app", "recipient": user_id,
                      "type": notification_type, **kwargs})

    def _fake_push(username, payload):
        calls.append({"kind": "push", "recipient": username, "payload": payload})

    monkeypatch.setattr(webhooks_mod, "create_notification", _fake_create)
    monkeypatch.setattr(webhooks_mod, "send_push_to_user", _fake_push)
    return calls


def _install_event(monkeypatch, event: Dict[str, Any]) -> None:
    import stripe  # type: ignore

    def _fake(payload, sig_header, secret):  # noqa: ARG001
        return event

    monkeypatch.setattr(stripe.Webhook, "construct_event", _fake)


def _stub_subscription_retrieve(monkeypatch, snapshot: Optional[Dict[str, Any]] = None) -> None:
    import stripe  # type: ignore

    def _fake_retrieve(subscription_id, **kwargs):  # noqa: ARG001
        return dict(snapshot or {})

    monkeypatch.setattr(stripe.Subscription, "retrieve", staticmethod(_fake_retrieve))


def _post_event(client, expected_status: int = 200) -> Dict[str, Any]:
    resp = client.post(
        "/api/webhooks/stripe",
        data=b"{}",
        headers={"Stripe-Signature": "t=0,v1=ignored"},
    )
    assert resp.status_code == expected_status, resp.get_json()
    return resp.get_json()


def _user_row(username: str) -> Tuple[str, Optional[str], Optional[str]]:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT subscription, subscription_status, stripe_subscription_id "
            f"FROM users WHERE username = {ph}",
            (username,),
        )
        row = c.fetchone()
    assert row is not None
    if hasattr(row, "keys"):
        return (row["subscription"], row["subscription_status"], row["stripe_subscription_id"])
    return (row[0], row[1], row[2])


def _community_status(community_id: int) -> Optional[str]:
    state = community_billing.get_billing_state(community_id) or {}
    return state.get("subscription_status")


def _audit_count(action: str) -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT COUNT(*) FROM subscription_audit_log WHERE action = {ph}",
            (action,),
        )
        row = c.fetchone()
    if not row:
        return 0
    if hasattr(row, "keys"):
        return int(list(row.values())[0] or 0)
    return int(row[0] or 0)


def _grant_premium(username: str, sub_id: str, customer_id: str = "") -> None:
    assert user_billing.mark_subscription(
        username,
        subscription="premium",
        subscription_id=sub_id,
        customer_id=customer_id or f"cus_{username}",
        status="active",
        provider="stripe",
        stripe_mode="test",
    )


# ── 1. Invoice events route by subscription metadata ────────────────────


def test_invoice_payment_failed_routes_to_community(client, monkeypatch, notif_spy):
    owner = make_user("wh_hard_owner1")
    community_id = make_community(
        "Hardening Riders", creator_username=owner["username"]
    )
    assert community_billing.mark_subscription(
        community_id,
        tier_code="paid_l1",
        subscription_id="sub_comm_hard_1",
        customer_id="cus_comm_hard_1",
        status="active",
        stripe_mode="test",
    )

    _install_event(monkeypatch, {
        "type": "invoice.payment_failed",
        "data": {"object": {
            "id": "in_hard_1",
            "object": "invoice",
            "metadata": {},  # invoices carry their own (empty) metadata
            "parent": {"subscription_details": {
                "subscription": "sub_comm_hard_1",
                "metadata": {
                    "sku": "community_tier",
                    "community_id": str(community_id),
                    "username": owner["username"],
                },
            }},
        }},
    })
    body = _post_event(client)

    assert body["sku"] == "community_tier"
    assert _community_status(community_id) == "past_due"
    # The owner's personal billing row must be untouched.
    subscription, status, _ = _user_row(owner["username"])
    assert subscription == "free"
    assert status is None
    assert _audit_count("community_tier_past_due") == 1
    # Owner got the dunning signal.
    in_app = [c for c in notif_spy if c["kind"] == "in_app"
              and c["type"] == "billing_payment_failed"]
    assert in_app and in_app[0]["recipient"] == owner["username"]


def test_invoice_payment_failed_personal_audit_and_notification(client, monkeypatch, notif_spy):
    user = make_user("wh_hard_dunned")
    _grant_premium(user["username"], "sub_dun_1")

    _install_event(monkeypatch, {
        "type": "invoice.payment_failed",
        "data": {"object": {
            "id": "in_hard_2",
            "object": "invoice",
            "metadata": {},
            "parent": {"subscription_details": {
                "subscription": "sub_dun_1",
                "metadata": {"sku": "premium", "username": user["username"]},
            }},
        }},
    })
    _post_event(client)

    subscription, status, _ = _user_row(user["username"])
    assert subscription == "premium"  # grace: past_due keeps the tier
    assert status == "past_due"
    assert _audit_count("personal_premium_past_due") == 1
    assert _audit_count("personal_premium_cancelled") == 0
    recipients = {c["recipient"] for c in notif_spy if c["kind"] == "in_app"}
    assert user["username"] in recipients


# ── 2. Status-gated customer.subscription.updated ───────────────────────


def _updated_event(username: str, sub_id: str, status: str) -> Dict[str, Any]:
    return {
        "type": "customer.subscription.updated",
        "data": {"object": {
            "id": sub_id,
            "object": "subscription",
            "customer": f"cus_{username}",
            "status": status,
            "cancel_at_period_end": False,
            "metadata": {"sku": "premium", "username": username},
        }},
    }


def test_updated_terminal_status_revokes(client, monkeypatch):
    user = make_user("wh_hard_unpaid")
    _grant_premium(user["username"], "sub_term_1")

    _install_event(monkeypatch, _updated_event(user["username"], "sub_term_1", "unpaid"))
    _post_event(client)

    subscription, status, _ = _user_row(user["username"])
    assert subscription == "free"
    assert status == "unpaid"
    assert _audit_count("personal_premium_cancelled") == 1


def test_updated_past_due_keeps_premium(client, monkeypatch):
    user = make_user("wh_hard_pastdue")
    _grant_premium(user["username"], "sub_pd_1")

    _install_event(monkeypatch, _updated_event(user["username"], "sub_pd_1", "past_due"))
    _post_event(client)

    subscription, status, _ = _user_row(user["username"])
    assert subscription == "premium"
    assert status == "past_due"
    assert _audit_count("personal_premium_past_due") == 1


def test_stale_updated_after_delete_does_not_regrant(client, monkeypatch):
    user = make_user("wh_hard_stale")
    # State after customer.subscription.deleted was applied:
    assert user_billing.mark_subscription(
        user["username"],
        subscription="free",
        subscription_id="sub_stale_1",
        status="cancelled",
        provider="stripe",
        stripe_mode="test",
    )

    # A delayed/retried `updated` for the same subscription arrives late.
    _install_event(monkeypatch, _updated_event(user["username"], "sub_stale_1", "canceled"))
    _post_event(client)

    subscription, _, _ = _user_row(user["username"])
    assert subscription == "free"


def test_updated_active_grants_premium(client, monkeypatch):
    user = make_user("wh_hard_active")
    _grant_premium(user["username"], "sub_act_1")

    _install_event(monkeypatch, _updated_event(user["username"], "sub_act_1", "active"))
    _post_event(client)

    subscription, status, _ = _user_row(user["username"])
    assert subscription == "premium"
    assert status == "active"


# ── 3. DB failure → 500 so Stripe retries ───────────────────────────────


def test_db_failure_returns_500(client, monkeypatch):
    user = make_user("wh_hard_dbfail")
    _stub_subscription_retrieve(monkeypatch, {})
    monkeypatch.setattr(user_billing, "mark_subscription", lambda *a, **k: False)

    _install_event(monkeypatch, {
        "type": "checkout.session.completed",
        "data": {"object": {
            "id": "cs_hard_1",
            "object": "checkout.session",
            "customer": "cus_dbfail",
            "subscription": "sub_dbfail_1",
            "metadata": {"sku": "premium", "username": user["username"]},
        }},
    })
    body = _post_event(client, expected_status=500)
    assert body["error"] == "processing_failed"


# ── 4. Duplicate checkout / dispute / refund ────────────────────────────


def test_duplicate_checkout_auto_cancelled(client, monkeypatch, notif_spy):
    import stripe  # type: ignore

    user = make_user("wh_hard_dup")
    _grant_premium(user["username"], "sub_orig_1")

    cancelled: List[str] = []
    refunds: List[Dict[str, Any]] = []
    monkeypatch.setattr(
        stripe.Subscription, "cancel",
        staticmethod(lambda sub_id, **kw: cancelled.append(str(sub_id))),
        raising=False,
    )
    monkeypatch.setattr(
        stripe.Refund, "create",
        staticmethod(lambda **kw: refunds.append(kw)),
        raising=False,
    )
    _stub_subscription_retrieve(
        monkeypatch, {"latest_invoice": {"payment_intent": "pi_dup_1"}}
    )

    # Second tab completed a second Checkout for the same product.
    _install_event(monkeypatch, {
        "type": "checkout.session.completed",
        "data": {"object": {
            "id": "cs_hard_2",
            "object": "checkout.session",
            "customer": "cus_wh_hard_dup",
            "subscription": "sub_dup_2",
            "metadata": {"sku": "premium", "username": user["username"]},
        }},
    })
    _post_event(client)

    # Original subscription untouched; duplicate cancelled + refunded.
    subscription, _, sub_id = _user_row(user["username"])
    assert subscription == "premium"
    assert sub_id == "sub_orig_1"
    assert cancelled == ["sub_dup_2"]
    assert refunds and refunds[0].get("payment_intent") == "pi_dup_1"
    assert _audit_count("duplicate_subscription_auto_cancelled") == 1
    assert any(c["kind"] == "in_app" and c["type"] == "billing_alert"
               for c in notif_spy)


def test_retried_checkout_same_subscription_not_cancelled(client, monkeypatch):
    import stripe  # type: ignore

    user = make_user("wh_hard_retry")
    _grant_premium(user["username"], "sub_retry_1")

    cancelled: List[str] = []
    monkeypatch.setattr(
        stripe.Subscription, "cancel",
        staticmethod(lambda sub_id, **kw: cancelled.append(str(sub_id))),
        raising=False,
    )
    _stub_subscription_retrieve(monkeypatch, {})

    # Stripe redelivers the original checkout event: same subscription id.
    _install_event(monkeypatch, {
        "type": "checkout.session.completed",
        "data": {"object": {
            "id": "cs_hard_3",
            "object": "checkout.session",
            "customer": "cus_wh_hard_retry",
            "subscription": "sub_retry_1",
            "metadata": {"sku": "premium", "username": user["username"]},
        }},
    })
    _post_event(client)

    subscription, _, sub_id = _user_row(user["username"])
    assert subscription == "premium"
    assert sub_id == "sub_retry_1"
    assert cancelled == []
    assert _audit_count("duplicate_subscription_auto_cancelled") == 0


def test_dispute_revokes_premium(client, monkeypatch, notif_spy):
    import stripe  # type: ignore

    user = make_user("wh_hard_dispute")
    _grant_premium(user["username"], "sub_disp_1", customer_id="cus_disp_1")

    cancelled: List[str] = []
    monkeypatch.setattr(
        stripe.Subscription, "cancel",
        staticmethod(lambda sub_id, **kw: cancelled.append(str(sub_id))),
        raising=False,
    )
    monkeypatch.setattr(
        stripe.Charge, "retrieve",
        staticmethod(lambda charge_id, **kw: {"id": charge_id, "customer": "cus_disp_1"}),
    )

    _install_event(monkeypatch, {
        "type": "charge.dispute.created",
        "data": {"object": {
            "id": "dp_hard_1",
            "object": "dispute",
            "charge": "ch_disp_1",
            "reason": "fraudulent",
            "amount": 799,
        }},
    })
    _post_event(client)

    subscription, status, _ = _user_row(user["username"])
    assert subscription == "free"
    assert status == "cancelled"
    assert cancelled == ["sub_disp_1"]
    assert _audit_count("billing_dispute_created") == 1


def test_refund_audits_without_revoking(client, monkeypatch, notif_spy):
    user = make_user("wh_hard_refund")
    _grant_premium(user["username"], "sub_ref_1", customer_id="cus_ref_1")

    _install_event(monkeypatch, {
        "type": "charge.refunded",
        "data": {"object": {
            "id": "ch_ref_1",
            "object": "charge",
            "customer": "cus_ref_1",
            "invoice": "in_ref_1",
            "amount_refunded": 799,
        }},
    })
    _post_event(client)

    subscription, _, _ = _user_row(user["username"])
    assert subscription == "premium"  # goodwill refunds keep entitlement
    assert _audit_count("billing_charge_refunded") == 1
    assert any(c["kind"] == "in_app" and c["type"] == "billing_alert"
               for c in notif_spy)
