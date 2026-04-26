"""Step E — Stripe webhook branch for community Paid Tier events.

The webhook now dispatches on ``metadata.sku``:

    sku='premium' (or missing)    → _handle_premium_event   (pre-existing)
    sku='community_tier'          → _handle_community_tier_event (new)

The personal-Premium path from Step D must keep working unchanged.
The community branch writes directly to ``communities`` via the new
``backend.services.community_billing`` module and appends a
``subscription_audit`` row tagged ``community_tier_*``.

We don't exercise signature verification here — that's covered in
``test_stripe_webhook.py`` upstream. We monkey-patch
``stripe.Webhook.construct_event`` so each test can drive any event
shape directly without needing a valid signature.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

import pytest
from flask import Flask

from backend.blueprints.subscription_webhooks import subscription_webhooks_bp
from backend.services import community_billing, subscription_audit, user_billing
from backend.services.database import get_db_connection, get_sql_placeholder

from tests.fixtures import make_community, make_user

pytestmark = pytest.mark.usefixtures("mysql_dsn")


# ── Fixtures ────────────────────────────────────────────────────────────


@pytest.fixture
def client(mysql_dsn, monkeypatch):
    """Flask app around just the webhook blueprint + a signature bypass.

    Every test sets ``STRIPE_WEBHOOK_SECRET`` so the endpoint gets past
    the "configured?" guard, then monkey-patches
    ``stripe.Webhook.construct_event`` to return whatever event shape
    the test wants.
    """
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_dummy")
    community_billing.ensure_tables()
    user_billing.ensure_tables()
    subscription_audit.ensure_tables()

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(subscription_webhooks_bp)
    with app.test_client() as c:
        yield c


def _install_event(monkeypatch, event: Dict[str, Any]) -> None:
    """Swap ``stripe.Webhook.construct_event`` with a fake returning ``event``."""
    import stripe  # type: ignore

    def _fake(payload, sig_header, secret):  # noqa: ARG001 - match stripe sig
        return event

    monkeypatch.setattr(stripe.Webhook, "construct_event", _fake)


def _post_event(client) -> Dict[str, Any]:
    resp = client.post(
        "/api/webhooks/stripe",
        data=b"{}",
        headers={"Stripe-Signature": "t=0,v1=ignored"},
    )
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()


def _audit_count_for(action: str, community_id: Optional[int] = None) -> int:
    ph = get_sql_placeholder()
    sql = "SELECT COUNT(*) FROM subscription_audit_log WHERE action = " + ph
    params: list = [action]
    if community_id is not None:
        # community_id is stored in metadata_json for these rows; fall
        # back to a simple LIKE match since we're not testing schema.
        sql += f" AND metadata_json LIKE {ph}"
        params.append(f'%"community_id": {community_id}%')
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(sql, tuple(params))
        row = c.fetchone()
    if not row:
        return 0
    if hasattr(row, "keys"):
        return int(list(row.values())[0] or 0)
    return int(row[0] or 0)


# ── 1. sku=community_tier branch ────────────────────────────────────────


class TestCommunityTierPurchased:
    def test_checkout_session_completed_activates_community(
        self, client, monkeypatch,
    ):
        make_user("comm_owner", subscription="free")
        cid = make_community(
            "c-activate", tier="free", creator_username="comm_owner",
        )
        event = {
            "type": "checkout.session.completed",
            "data": {"object": {
                "subscription": "sub_new_123",
                "customer": "cus_new_123",
                "client_reference_id": f"community:{cid}",
                "metadata": {
                    "sku": "community_tier",
                    "plan_id": "community_tier",
                    "username": "comm_owner",
                    "community_id": str(cid),
                    "tier_code": "paid_l2",
                },
            }},
        }
        _install_event(monkeypatch, event)

        body = _post_event(client)
        assert body["sku"] == "community_tier"

        state = community_billing.get_billing_state(cid)
        assert state is not None
        assert state["tier"] == "paid_l2"
        assert state["stripe_subscription_id"] == "sub_new_123"
        assert state["stripe_customer_id"] == "cus_new_123"
        assert state["subscription_status"] == "active"

        assert _audit_count_for("community_tier_purchased", community_id=cid) == 1
        # And the personal-Premium audit row must NOT fire.
        assert _audit_count_for("personal_premium_purchased") == 0


class TestCommunitySubscriptionDeleted:
    def test_deletion_marks_cancelled(self, client, monkeypatch):
        make_user("cancel_owner", subscription="free")
        cid = make_community(
            "c-cancel", tier="paid_l1", creator_username="cancel_owner",
        )
        community_billing.mark_subscription(
            cid,
            tier_code="paid_l1",
            subscription_id="sub_to_cancel",
            customer_id="cus_to_cancel",
            status="active",
        )
        # The subscription.deleted event carries metadata on the subscription
        # (we mirror it at checkout creation via ``subscription_data``).
        event = {
            "type": "customer.subscription.deleted",
            "data": {"object": {
                "id": "sub_to_cancel",
                "customer": "cus_to_cancel",
                "metadata": {
                    "sku": "community_tier",
                    "community_id": str(cid),
                    "tier_code": "paid_l1",
                },
            }},
        }
        _install_event(monkeypatch, event)

        _post_event(client)
        state = community_billing.get_billing_state(cid) or {}
        assert state["subscription_status"] == "cancelled"
        # Tier is deliberately unchanged by the deletion event — the
        # communities-lifecycle cron handles the downgrade so we don't
        # yank active members mid-cycle.
        assert state["tier"] == "paid_l1"

        assert _audit_count_for("community_tier_cancelled", community_id=cid) == 1

    def test_deletion_with_missing_metadata_falls_back_to_subscription_id(
        self, client, monkeypatch,
    ):
        """Stripe sometimes strips metadata on lifecycle events — we must
        still find the community by subscription_id in that case."""
        make_user("fallback_owner", subscription="free")
        cid = make_community(
            "c-fallback", tier="paid_l1",
            creator_username="fallback_owner",
        )
        community_billing.mark_subscription(
            cid,
            tier_code="paid_l1",
            subscription_id="sub_lookup_me",
            status="active",
        )
        event = {
            "type": "customer.subscription.deleted",
            "data": {"object": {
                "id": "sub_lookup_me",
                # NOTE: no community_id in metadata — only the sku marker.
                "metadata": {"sku": "community_tier"},
            }},
        }
        _install_event(monkeypatch, event)

        _post_event(client)
        state = community_billing.get_billing_state(cid) or {}
        assert state["subscription_status"] == "cancelled"


class TestCommunityPaymentFailed:
    def test_payment_failure_marks_past_due(self, client, monkeypatch):
        make_user("pastdue_owner", subscription="free")
        cid = make_community(
            "c-pastdue", tier="paid_l1",
            creator_username="pastdue_owner",
        )
        community_billing.mark_subscription(
            cid,
            tier_code="paid_l1",
            subscription_id="sub_pastdue",
            status="active",
        )
        event = {
            "type": "invoice.payment_failed",
            "data": {"object": {
                "id": "in_fail_1",
                "metadata": {
                    "sku": "community_tier",
                    "community_id": str(cid),
                },
            }},
        }
        _install_event(monkeypatch, event)

        _post_event(client)
        state = community_billing.get_billing_state(cid) or {}
        assert state["subscription_status"] == "past_due"

        assert _audit_count_for("community_tier_past_due", community_id=cid) == 1


class TestCommunitySubscriptionUpdated:
    def test_cancel_at_period_end_keeps_active_with_days_remaining(self, client, monkeypatch):
        make_user("cancel_later_owner", subscription="free")
        cid = make_community("c-cancel-later", tier="paid_l1", creator_username="cancel_later_owner")
        community_billing.mark_subscription(
            cid,
            tier_code="paid_l1",
            subscription_id="sub_cancel_later",
            customer_id="cus_cancel_later",
            status="active",
        )
        event = {
            "type": "customer.subscription.updated",
            "data": {"object": {
                "id": "sub_cancel_later",
                "customer": "cus_cancel_later",
                "status": "active",
                "cancel_at_period_end": True,
                "current_period_end": 1893456000,
                "metadata": {"sku": "community_tier"},
            }},
        }
        _install_event(monkeypatch, event)

        _post_event(client)
        state = community_billing.get_billing_state(cid) or {}
        assert state["subscription_status"] == "active"
        assert state["cancel_at_period_end"] is True
        assert state["is_canceling"] is True
        assert state["benefits_end_at"] is not None
        assert state["days_remaining"] is not None


# ── 2. Personal Premium path is unchanged ───────────────────────────────


class TestPremiumPathIntact:
    """Ensure the Step D personal-Premium flow still fires when
    ``metadata.sku`` is missing (legacy Checkouts) or set to 'premium'."""

    def _user_subscription(self, username: str) -> str:
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"SELECT subscription FROM users WHERE username = {ph}",
                (username,),
            )
            row = c.fetchone()
        if not row:
            return ""
        return str(row["subscription"] if hasattr(row, "keys") else row[0])

    def test_missing_sku_routes_to_premium(self, client, monkeypatch):
        make_user("legacy_user", subscription="free")
        event = {
            "type": "checkout.session.completed",
            "data": {"object": {
                "subscription": "sub_legacy",
                "customer": "cus_legacy",
                "metadata": {"username": "legacy_user"},
            }},
        }
        _install_event(monkeypatch, event)

        body = _post_event(client)
        assert body["sku"] == "premium"
        assert self._user_subscription("legacy_user") == "premium"
        assert _audit_count_for("personal_premium_purchased") == 1

    def test_explicit_premium_sku_routes_to_premium(self, client, monkeypatch):
        make_user("prem_user", subscription="free")
        event = {
            "type": "checkout.session.completed",
            "data": {"object": {
                "subscription": "sub_prem",
                "customer": "cus_prem",
                "metadata": {"sku": "premium", "username": "prem_user"},
            }},
        }
        _install_event(monkeypatch, event)

        _post_event(client)
        assert self._user_subscription("prem_user") == "premium"

    def test_community_tier_does_not_touch_users_subscription(
        self, client, monkeypatch,
    ):
        """Community Tier purchases MUST NOT flip the buyer's personal
        ``users.subscription`` column — that's the whole point of the
        two-axis monetization."""
        make_user("buyer_stays_free", subscription="free")
        cid = make_community(
            "c-two-axis", tier="free",
            creator_username="buyer_stays_free",
        )
        event = {
            "type": "checkout.session.completed",
            "data": {"object": {
                "subscription": "sub_two_axis",
                "customer": "cus_two_axis",
                "metadata": {
                    "sku": "community_tier",
                    "username": "buyer_stays_free",
                    "community_id": str(cid),
                    "tier_code": "paid_l1",
                },
            }},
        }
        _install_event(monkeypatch, event)

        _post_event(client)
        # Community got the tier.
        state = community_billing.get_billing_state(cid) or {}
        assert state["tier"] == "paid_l1"
        assert state["subscription_status"] == "active"
        # But the buyer's personal subscription stayed free.
        assert self._user_subscription("buyer_stays_free") == "free"
