"""Step E — ``POST /api/stripe/create_checkout_session`` (community tier).

The community-tier Checkout branch has three preflight gates the Stripe
API itself would not enforce for us — and any bug in them means we'd
happily take money for a configuration that can't ship:

1. **Owner-only** — only the community's creator (or the app-level
   ``admin`` user) can initiate the upgrade.
2. **Single active sub** — a community with an active Stripe
   subscription can't buy a second one. Upgrades / downgrades run via
   the billing portal, not a second Checkout.
3. **Cap fits member count** — you can't downgrade a 200-member
   community to Paid L1 (75-cap). Stripe would happily bill; our own
   enforcement would lock the community out next time someone tries to
   read it.

On top of those gates, the request body must carry both ``community_id``
and ``tier_code``; the price ID must come from the KB (not an env var);
and the metadata must include ``sku=community_tier`` + both IDs so the
webhook can route correctly. This test file asserts each.
"""

from __future__ import annotations

import pytest
from flask import Flask

from backend.blueprints.subscriptions import subscriptions_bp
from backend.services import community_billing, knowledge_base as kb

from tests.fixtures import (
    fill_community_members,
    make_community,
    make_user,
)

pytestmark = pytest.mark.usefixtures("mysql_dsn")


# ── Fixtures / helpers ──────────────────────────────────────────────────


class _FakeCheckoutSession(dict):
    """Stand-in for ``stripe.checkout.Session.create(...)`` return value.

    Stripe returns an object supporting both ``.get("id")`` and ``["id"]``.
    A plain ``dict`` satisfies both because the blueprint uses ``.get``.
    """


@pytest.fixture
def client(mysql_dsn, monkeypatch):
    """Flask app wrapping just the subscriptions blueprint + Stripe mock.

    We always set a non-default ``STRIPE_API_KEY`` so ``_stripe_client``
    returns a real module handle; the actual ``Session.create`` call is
    monkey-patched below so no HTTP traffic escapes the test.
    """
    monkeypatch.setenv("STRIPE_API_KEY", "sk_test_dummy_for_tests")
    community_billing.ensure_tables()

    captured: dict = {}

    def _fake_create(**kwargs):
        # Record the args for assertions + return a fake session object.
        captured["kwargs"] = kwargs
        return _FakeCheckoutSession(id="cs_test_fake_123",
                                    url="https://stripe.test/cs_test_fake_123")

    import stripe  # type: ignore
    monkeypatch.setattr(stripe.checkout.Session, "create", _fake_create)

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(subscriptions_bp)

    with app.test_client() as c:
        c._captured = captured  # type: ignore[attr-defined]
        yield c


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _seed_kb_with_l1_price(price_id: str = "price_l1_from_kb") -> None:
    """Seed the community-tiers page with a real L1 Stripe price ID."""
    kb.seed_default_pages(force=True)
    page = kb.get_page("community-tiers") or {}
    fields = list(page.get("fields") or [])
    for f in fields:
        if f.get("name") == "paid_l1_stripe_price_id_test":
            f["value"] = price_id
    kb.save_page(
        "community-tiers",
        fields=fields,
        reason="test-fixture",
        actor_username="test-fixture",
    )


# ── 1. Auth gate ────────────────────────────────────────────────────────


class TestAuth:
    def test_anon_is_rejected(self, client):
        resp = client.post("/api/stripe/create_checkout_session",
                           json={"plan_id": "community_tier",
                                 "community_id": 1,
                                 "tier_code": "paid_l1"})
        assert resp.status_code == 401


# ── 2. Missing params ───────────────────────────────────────────────────


class TestMissingParams:
    def test_missing_community_id(self, client):
        make_user("miss_user", subscription="free")
        _login(client, "miss_user")
        resp = client.post("/api/stripe/create_checkout_session",
                           json={"plan_id": "community_tier",
                                 "tier_code": "paid_l1"})
        assert resp.status_code == 400
        assert resp.get_json()["reason"] == "missing_params"

    def test_invalid_tier_code(self, client):
        make_user("bad_tier_user", subscription="free")
        cid = make_community("c-bad-tier", tier="free",
                             creator_username="bad_tier_user")
        _login(client, "bad_tier_user")
        resp = client.post("/api/stripe/create_checkout_session",
                           json={"plan_id": "community_tier",
                                 "community_id": cid,
                                 "tier_code": "platinum"})
        # Unknown tier codes are normalized to None -> same gate.
        assert resp.status_code == 400
        assert resp.get_json()["reason"] == "missing_params"

    def test_enterprise_tier_rejected(self, client):
        """Enterprise is sales-driven, not self-serve via Checkout."""
        make_user("ent_user", subscription="free")
        cid = make_community("c-ent", tier="free", creator_username="ent_user")
        _login(client, "ent_user")
        resp = client.post("/api/stripe/create_checkout_session",
                           json={"plan_id": "community_tier",
                                 "community_id": cid,
                                 "tier_code": "enterprise"})
        assert resp.status_code == 400
        assert resp.get_json()["reason"] == "invalid_tier"


# ── 3. Owner-only ───────────────────────────────────────────────────────


class TestOwnerOnly:
    def test_non_owner_is_blocked(self, client):
        make_user("owner_good", subscription="free")
        make_user("outsider", subscription="free")
        cid = make_community("c-owner", tier="free",
                             creator_username="owner_good")
        _seed_kb_with_l1_price()
        _login(client, "outsider")

        resp = client.post("/api/stripe/create_checkout_session",
                           json={"plan_id": "community_tier",
                                 "community_id": cid,
                                 "tier_code": "paid_l1"})
        assert resp.status_code == 403
        assert resp.get_json()["reason"] == "not_owner"

    def test_owner_is_allowed_through_preflight(self, client):
        make_user("owner_pass", subscription="free")
        cid = make_community("c-owner-pass", tier="free",
                             creator_username="owner_pass")
        _seed_kb_with_l1_price("price_l1_from_kb")
        _login(client, "owner_pass")

        resp = client.post("/api/stripe/create_checkout_session",
                           json={"plan_id": "community_tier",
                                 "community_id": cid,
                                 "tier_code": "paid_l1"})
        assert resp.status_code == 200, resp.get_json()
        body = resp.get_json()
        assert body["success"] is True
        assert body["sessionId"] == "cs_test_fake_123"


# ── 4. Already subscribed ───────────────────────────────────────────────


class TestAlreadySubscribed:
    def test_active_sub_blocks_second_checkout(self, client):
        make_user("already_owner", subscription="free")
        cid = make_community("c-already", tier="paid_l1",
                             creator_username="already_owner")
        community_billing.mark_subscription(
            cid,
            tier_code="paid_l1",
            subscription_id="sub_already_live",
            customer_id="cus_live",
            status="active",
        )
        _seed_kb_with_l1_price()
        _login(client, "already_owner")

        resp = client.post("/api/stripe/create_checkout_session",
                           json={"plan_id": "community_tier",
                                 "community_id": cid,
                                 "tier_code": "paid_l2"})
        assert resp.status_code == 409
        body = resp.get_json()
        assert body["reason"] == "already_subscribed"
        assert body["portal_required"] is True
        assert body["community_id"] == cid

    def test_cancelled_sub_does_not_block(self, client):
        """Cancelled/past-due owners re-enter Checkout to restore service."""
        make_user("cancelled_owner", subscription="free")
        cid = make_community("c-cancelled", tier="paid_l1",
                             creator_username="cancelled_owner")
        community_billing.mark_subscription(
            cid,
            tier_code="paid_l1",
            subscription_id="sub_cancelled_x",
            status="cancelled",
        )
        _seed_kb_with_l1_price()
        _login(client, "cancelled_owner")

        resp = client.post("/api/stripe/create_checkout_session",
                           json={"plan_id": "community_tier",
                                 "community_id": cid,
                                 "tier_code": "paid_l1"})
        assert resp.status_code == 200, resp.get_json()


# ── 5. Member cap fit ───────────────────────────────────────────────────


class TestMemberCapFit:
    def test_oversized_community_cannot_downgrade(self, client):
        """150-member community trying to buy L1 (75-cap) is blocked."""
        make_user("big_owner", subscription="free")
        cid = make_community("c-big", tier="free",
                             creator_username="big_owner")
        # Put 80 members in — over the 75 cap of paid_l1.
        fill_community_members(cid, 80)
        _seed_kb_with_l1_price()
        _login(client, "big_owner")

        resp = client.post("/api/stripe/create_checkout_session",
                           json={"plan_id": "community_tier",
                                 "community_id": cid,
                                 "tier_code": "paid_l1"})
        assert resp.status_code == 409
        body = resp.get_json()
        assert body["reason"] == "tier_too_small"
        assert body["current_members"] == 80
        assert body["tier_cap"] == 75


# ── 6. Price ID sourced from KB ─────────────────────────────────────────


class TestPriceFromKB:
    """Community tier prices have no env fallback — KB is the source."""

    def test_missing_kb_price_blocks_checkout(self, client):
        make_user("no_kb_owner", subscription="free")
        cid = make_community("c-no-kb", tier="free",
                             creator_username="no_kb_owner")
        # Seed KB but leave the L1 Stripe price ID empty.
        _seed_kb_with_l1_price(price_id="")
        _login(client, "no_kb_owner")

        resp = client.post("/api/stripe/create_checkout_session",
                           json={"plan_id": "community_tier",
                                 "community_id": cid,
                                 "tier_code": "paid_l1"})
        assert resp.status_code == 400
        body = resp.get_json()
        assert body["reason"] == "price_missing"
        assert body["tier_code"] == "paid_l1"

    def test_populated_kb_price_forwards_to_stripe(self, client):
        make_user("kb_owner", subscription="free")
        cid = make_community("c-kb", tier="free",
                             creator_username="kb_owner")
        _seed_kb_with_l1_price("price_unique_xyz")
        _login(client, "kb_owner")

        resp = client.post("/api/stripe/create_checkout_session",
                           json={"plan_id": "community_tier",
                                 "community_id": cid,
                                 "tier_code": "paid_l1"})
        assert resp.status_code == 200
        kwargs = client._captured["kwargs"]
        # The KB value is what we hand Stripe — confirms the endpoint
        # isn't silently falling back to an env var.
        assert kwargs["line_items"] == [{"price": "price_unique_xyz",
                                         "quantity": 1}]


# ── 7. Metadata + client_reference_id ───────────────────────────────────


class TestMetadata:
    """The webhook dispatcher depends on the metadata we send here."""

    def test_metadata_shape(self, client):
        make_user("meta_owner", subscription="free")
        cid = make_community("c-meta", tier="free",
                             creator_username="meta_owner")
        _seed_kb_with_l1_price("price_meta")
        _login(client, "meta_owner")

        resp = client.post("/api/stripe/create_checkout_session",
                           json={"plan_id": "community_tier",
                                 "community_id": cid,
                                 "tier_code": "paid_l1"})
        assert resp.status_code == 200
        kwargs = client._captured["kwargs"]

        meta = kwargs["metadata"]
        assert meta["sku"] == "community_tier"
        assert meta["plan_id"] == "community_tier"
        assert meta["username"] == "meta_owner"
        assert meta["community_id"] == str(cid)
        assert meta["tier_code"] == "paid_l1"

        # subscription_data must carry the same metadata so
        # ``customer.subscription.updated`` events dispatch correctly.
        assert kwargs["subscription_data"]["metadata"] == meta

        # client_reference_id is the webhook's fallback when metadata is
        # stripped (it's visible in Stripe CLI replay tools).
        assert kwargs["client_reference_id"] == f"community:{cid}"

    def test_mode_is_subscription_and_urls_carry_session_id(self, client):
        make_user("mode_owner", subscription="free")
        cid = make_community("c-mode", tier="free",
                             creator_username="mode_owner")
        _seed_kb_with_l1_price("price_mode")
        _login(client, "mode_owner")

        resp = client.post("/api/stripe/create_checkout_session",
                           json={"plan_id": "community_tier",
                                 "community_id": cid,
                                 "tier_code": "paid_l1"})
        assert resp.status_code == 200
        kwargs = client._captured["kwargs"]

        assert kwargs["mode"] == "subscription"
        # ``Success.tsx`` polls entitlements using session_id.
        assert "session_id={CHECKOUT_SESSION_ID}" in kwargs["success_url"]
        # Cancel flows back with the community_id so the picker can
        # preselect.
        assert str(cid) in kwargs["cancel_url"]
        assert "status=cancelled" in kwargs["cancel_url"]


# ── 8. Parent-community guard (root-only billing) ──────────────────────


class TestParentOnly:
    """Billing / tier checkout lives on the root community only.

    The cap-enforcement helpers in ``backend/services/community.py``
    (``ensure_free_parent_member_capacity`` and
    ``ensure_community_tier_member_capacity``) already short-circuit on
    ``parent_community_id``, so a paid subscription attached to a
    child community would silently grant nothing. The preflight and
    billing endpoints must reject sub-community ids up front.
    """

    def test_child_community_blocked_at_preflight(self, client):
        make_user("root_owner", subscription="free")
        parent_id = make_community("c-parent-ok", tier="free",
                                   creator_username="root_owner")
        child_id = make_community("c-child-blocked", tier="free",
                                  creator_username="root_owner",
                                  parent_community_id=parent_id)
        _seed_kb_with_l1_price("price_parent_guard")
        _login(client, "root_owner")

        resp = client.post("/api/stripe/create_checkout_session",
                           json={"plan_id": "community_tier",
                                 "community_id": child_id,
                                 "tier_code": "paid_l1"})
        assert resp.status_code == 409
        body = resp.get_json()
        assert body["reason"] == "not_root_community"
        # The client uses this id to redirect the user to the parent's
        # Manage Community page instead of leaving them stuck.
        assert body["root_community_id"] == parent_id

    def test_root_community_passes_the_guard(self, client):
        make_user("root_ok", subscription="free")
        parent_id = make_community("c-parent-pass", tier="free",
                                   creator_username="root_ok")
        _seed_kb_with_l1_price("price_root_ok")
        _login(client, "root_ok")

        resp = client.post("/api/stripe/create_checkout_session",
                           json={"plan_id": "community_tier",
                                 "community_id": parent_id,
                                 "tier_code": "paid_l1"})
        assert resp.status_code == 200

    def test_deep_nesting_resolves_to_top_root(self, client):
        """Grandchild → parent → root: root_community_id must be the top."""
        make_user("deep_owner", subscription="free")
        root_id = make_community("c-deep-root", tier="free",
                                 creator_username="deep_owner")
        mid_id = make_community("c-deep-mid", tier="free",
                                creator_username="deep_owner",
                                parent_community_id=root_id)
        leaf_id = make_community("c-deep-leaf", tier="free",
                                 creator_username="deep_owner",
                                 parent_community_id=mid_id)
        _seed_kb_with_l1_price("price_deep")
        _login(client, "deep_owner")

        resp = client.post("/api/stripe/create_checkout_session",
                           json={"plan_id": "community_tier",
                                 "community_id": leaf_id,
                                 "tier_code": "paid_l1"})
        assert resp.status_code == 409
        body = resp.get_json()
        assert body["reason"] == "not_root_community"
        assert body["root_community_id"] == root_id


# ── 9. Billing snapshot endpoint ────────────────────────────────────────


class TestBillingSnapshot:
    """``GET /api/communities/<id>/billing`` feeds the EditCommunity
    Billing panel for **any** community owner — root or sub.

    Tiers and Stripe state live exclusively on the root, so:

    * Root owners see the full panel (status, renewal, portal CTA).
    * Sub-community owners see a read-only inherited badge with the
      root community's tier and a pointer back to the root for any
      Stripe-mutating action.

    This is a flip from the earlier behaviour (children received a 409
    ``not_root_community``) so a group owner can finally see *which
    plan their group inherits* on Manage Community without having to
    open the parent.
    """

    def test_anon_is_rejected(self, client):
        resp = client.get("/api/communities/1/billing")
        assert resp.status_code == 401

    def test_non_owner_is_rejected(self, client):
        make_user("bill_owner", subscription="free")
        make_user("bill_outsider", subscription="free")
        cid = make_community("c-bill-owner", tier="free",
                             creator_username="bill_owner")
        _login(client, "bill_outsider")

        resp = client.get(f"/api/communities/{cid}/billing")
        assert resp.status_code == 403
        assert resp.get_json()["reason"] == "not_owner"

    def test_child_community_returns_inherited_snapshot(self, client):
        """Child community owner sees the root's tier with ``is_inherited=True``.

        Replaces the prior ``test_child_community_rejected_with_root_pointer``
        that 409'd on this exact case. The Manage Community panel now
        renders a small read-only badge for children — actual checkout
        / portal still 409s on a child id (covered by ``TestParentOnly``).
        """
        make_user("bill_root_owner", subscription="free")
        parent_id = make_community("c-bill-parent", tier="paid_l1",
                                   creator_username="bill_root_owner")
        child_id = make_community("c-bill-child", tier="free",
                                  creator_username="bill_root_owner",
                                  parent_community_id=parent_id)
        community_billing.mark_subscription(
            parent_id,
            tier_code="paid_l1",
            subscription_id="sub_inherited_snapshot",
            customer_id="cus_inherited_snapshot",
            status="active",
        )
        _seed_kb_with_l1_price("price_inherited_snapshot")
        _login(client, "bill_root_owner")

        resp = client.get(f"/api/communities/{child_id}/billing")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["community_id"] == child_id
        # Tier resolves to the root's tier, not the child's row.
        assert body["tier"] == "paid_l1"
        assert body["tier_label"] == "Paid L1"
        assert body["is_inherited"] is True
        assert body["inherited_from_root_id"] == parent_id
        assert body["inherited_from_root_name"] == "c-bill-parent"
        # Children must not expose the root's Stripe state — those rows
        # are the billing owner's, not theirs.
        assert body["subscription_status"] is None
        assert body["current_period_end"] is None
        assert body["has_stripe_customer"] is False

    def test_child_owner_not_root_owner_sees_inherited(self, client):
        """A group owner who isn't the root owner still sees inherited tier.

        Ownership in cpoint is per-community: a root owner can hand a
        sub-community over to someone else and we still want the
        sub-community owner to see "you're on Paid L1 (inherited from
        Paulo IST)" on their Manage Community screen.
        """
        make_user("root_owner_only", subscription="free")
        make_user("child_owner_only", subscription="free")
        parent_id = make_community("c-parent-x", tier="paid_l2",
                                   creator_username="root_owner_only")
        child_id = make_community("c-child-x", tier="free",
                                  creator_username="child_owner_only",
                                  parent_community_id=parent_id)
        community_billing.mark_subscription(
            parent_id,
            tier_code="paid_l2",
            subscription_id="sub_split_owner",
            customer_id="cus_split_owner",
            status="active",
        )
        _login(client, "child_owner_only")

        resp = client.get(f"/api/communities/{child_id}/billing")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["is_inherited"] is True
        assert body["inherited_from_root_id"] == parent_id
        assert body["inherited_from_root_name"] == "c-parent-x"
        assert body["tier"] == "paid_l2"

    def test_root_community_returns_snapshot(self, client):
        make_user("bill_root_pass", subscription="free")
        cid = make_community("c-bill-root-pass", tier="paid_l1",
                             creator_username="bill_root_pass")
        community_billing.mark_subscription(
            cid,
            tier_code="paid_l1",
            subscription_id="sub_bill_snapshot",
            customer_id="cus_bill_snapshot",
            status="active",
        )
        _seed_kb_with_l1_price("price_bill_snapshot")
        _login(client, "bill_root_pass")

        resp = client.get(f"/api/communities/{cid}/billing")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["community_id"] == cid
        assert body["tier"] == "paid_l1"
        assert body["tier_label"] == "Paid L1"
        assert body["is_inherited"] is False
        assert body["inherited_from_root_id"] is None
        assert body["inherited_from_root_name"] is None
        assert body["subscription_status"] == "active"
        assert body["has_stripe_customer"] is True
