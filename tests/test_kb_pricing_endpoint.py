"""Step E — ``/api/kb/pricing`` endpoint contract.

Three orthogonal invariants this page is in charge of:

1. **Shape** — the four SKU keys (``premium``, ``community_tier``,
   ``steve_package``, ``networking``) are always present and contain the
   KB-sourced copy that ``SubscriptionPlans.tsx`` renders. A missing KB
   field must degrade gracefully (empty / null) rather than 500.
2. **Mode filtering** — the response never leaks the opposite Stripe
   mode's price ID. Test mode (``sk_test_*`` key) emits ``*_test`` IDs,
   live mode emits ``*_live`` IDs. This is the admin's safety rail
   against accidental live-mode charges on staging.
3. **Purchasability** — cards without a populated price ID come back
   ``purchasable: False`` so the client renders a disabled CTA instead
   of surfacing a cryptic Stripe error post-click. The two "Coming
   soon" cards (``steve_package`` / ``networking``) are always
   ``purchasable: False`` regardless of whether the KB has an ID yet.

We deliberately don't test the admin KB CRUD path here — that lives in
``test_steve_knowledge_base.py``. We only verify the commerce-facing read.
"""

from __future__ import annotations

import pytest
from flask import Flask

from backend.blueprints.subscriptions import subscriptions_bp
from backend.services import knowledge_base as kb

from tests.fixtures import make_user

pytestmark = pytest.mark.usefixtures("mysql_dsn")


# ── Fixtures ────────────────────────────────────────────────────────────


@pytest.fixture
def client(mysql_dsn):
    """Spin up a minimal Flask app around the subscriptions blueprint.

    Mirrors the ``test_spend_ceiling_and_privacy`` pattern so we don't
    drag in the 300-route monolith just to exercise one endpoint.
    """
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(subscriptions_bp)
    with app.test_client() as c:
        yield c


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _set_stripe_mode(monkeypatch, mode: str) -> None:
    """Flip the module-level mode selector without importing stripe."""
    if mode == "live":
        monkeypatch.setenv("STRIPE_API_KEY", "sk_live_dummy_for_tests")
    else:
        monkeypatch.setenv("STRIPE_API_KEY", "sk_test_dummy_for_tests")


def _seed_pricing_kb(
    *,
    premium_test: str = "price_premium_test_123",
    premium_live: str = "price_premium_live_456",
    paid_l1_test: str = "price_l1_test",
    paid_l1_live: str = "price_l1_live",
    paid_l2_test: str = "price_l2_test",
    paid_l2_live: str = "price_l2_live",
    paid_l3_test: str = "price_l3_test",
    paid_l3_live: str = "price_l3_live",
    networking_test: str = "price_net_test",
    networking_live: str = "price_net_live",
) -> None:
    """Seed the three KB pages the pricing endpoint reads.

    The endpoint flattens fields across ``user-tiers``, ``community-tiers``
    and ``networking-page``. We use ``seed_default_pages`` to install the
    real shipping KB then ``save_page`` to override just the IDs we care
    about — that way a field we didn't touch (e.g. ``premium_price_early_eur``)
    still comes back populated.
    """
    kb.seed_default_pages(force=True)

    # Overlay the Stripe IDs on top of the default seed.
    def _override(slug: str, updates: dict) -> None:
        page = kb.get_page(slug) or {}
        fields = list(page.get("fields") or [])
        updated_names = set(updates.keys())
        for f in fields:
            name = f.get("name")
            if name in updated_names:
                f["value"] = updates[name]
        kb.save_page(
            slug,
            fields=fields,
            reason="test-fixture",
            actor_username="test-fixture",
        )

    _override("user-tiers", {
        "premium_stripe_price_id_test": premium_test,
        "premium_stripe_price_id_live": premium_live,
    })
    _override("community-tiers", {
        "paid_l1_stripe_price_id_test": paid_l1_test,
        "paid_l1_stripe_price_id_live": paid_l1_live,
        "paid_l2_stripe_price_id_test": paid_l2_test,
        "paid_l2_stripe_price_id_live": paid_l2_live,
        "paid_l3_stripe_price_id_test": paid_l3_test,
        "paid_l3_stripe_price_id_live": paid_l3_live,
    })
    _override("networking-page", {
        "networking_page_stripe_price_id_test": networking_test,
        "networking_page_stripe_price_id_live": networking_live,
    })


# ── 1. Auth gate ────────────────────────────────────────────────────────


class TestAuth:
    """``/api/kb/pricing`` is login-only — never reveal SKU data anon."""

    def test_anon_is_rejected(self, client):
        resp = client.get("/api/kb/pricing")
        assert resp.status_code == 401
        body = resp.get_json() or {}
        assert body.get("success") is False


# ── 2. Shape ────────────────────────────────────────────────────────────


class TestShape:
    """The four SKU cards must always be present with the expected keys."""

    def test_all_four_skus_present(self, client, monkeypatch):
        _set_stripe_mode(monkeypatch, "test")
        make_user("shape_user", subscription="free")
        _seed_pricing_kb()
        _login(client, "shape_user")

        resp = client.get("/api/kb/pricing")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["stripe_mode"] == "test"

        sku = body["sku"]
        assert set(sku.keys()) == {"premium", "community_tier",
                                   "steve_package", "networking"}

        # Premium card — must carry the bits the UI reads.
        premium = sku["premium"]
        assert premium["sku"] == "premium"
        assert premium["billing_cycle"] == "monthly"
        assert premium["currency"] == "EUR"
        assert isinstance(premium["features"], list) and premium["features"]
        assert "cta_label" in premium

        # Community tier card — three sub-tiers.
        ct = sku["community_tier"]
        assert ct["sku"] == "community_tier"
        codes = [t["tier_code"] for t in ct["tiers"]]
        assert codes == ["paid_l1", "paid_l2", "paid_l3"]
        for tier in ct["tiers"]:
            assert "max_members" in tier
            assert "price_eur" in tier
            assert "stripe_price_id" in tier

        # Coming soon cards — flagged.
        assert sku["steve_package"]["coming_soon"] is True
        assert sku["steve_package"]["purchasable"] is False
        assert sku["networking"]["coming_soon"] is True
        assert sku["networking"]["purchasable"] is False


# ── 3. Mode filtering ───────────────────────────────────────────────────


class TestModeFiltering:
    """Test mode must never surface live IDs and vice versa."""

    def test_test_mode_emits_test_ids(self, client, monkeypatch):
        _set_stripe_mode(monkeypatch, "test")
        make_user("mode_test_user", subscription="free")
        _seed_pricing_kb(
            premium_test="price_only_test_abc",
            premium_live="price_only_live_xyz",
            paid_l1_test="price_l1_test_abc",
            paid_l1_live="price_l1_live_xyz",
        )
        _login(client, "mode_test_user")

        body = client.get("/api/kb/pricing").get_json()
        assert body["stripe_mode"] == "test"
        assert body["sku"]["premium"]["stripe_price_id"] == "price_only_test_abc"
        l1 = next(t for t in body["sku"]["community_tier"]["tiers"]
                  if t["tier_code"] == "paid_l1")
        assert l1["stripe_price_id"] == "price_l1_test_abc"

        # The raw live IDs must not be leaked anywhere in the payload.
        import json
        serialized = json.dumps(body)
        assert "price_only_live_xyz" not in serialized
        assert "price_l1_live_xyz" not in serialized

    def test_live_mode_emits_live_ids(self, client, monkeypatch):
        _set_stripe_mode(monkeypatch, "live")
        make_user("mode_live_user", subscription="free")
        _seed_pricing_kb(
            premium_test="price_only_test_abc",
            premium_live="price_only_live_xyz",
            paid_l1_test="price_l1_test_abc",
            paid_l1_live="price_l1_live_xyz",
        )
        _login(client, "mode_live_user")

        body = client.get("/api/kb/pricing").get_json()
        assert body["stripe_mode"] == "live"
        assert body["sku"]["premium"]["stripe_price_id"] == "price_only_live_xyz"
        l1 = next(t for t in body["sku"]["community_tier"]["tiers"]
                  if t["tier_code"] == "paid_l1")
        assert l1["stripe_price_id"] == "price_l1_live_xyz"

        import json
        serialized = json.dumps(body)
        assert "price_only_test_abc" not in serialized
        assert "price_l1_test_abc" not in serialized


# ── 4. Graceful fallback ────────────────────────────────────────────────


class TestGracefulFallback:
    """Missing KB fields / unseeded KB must not 500 the endpoint."""

    def test_unseeded_kb_returns_coming_soon_cards(self, client, monkeypatch):
        _set_stripe_mode(monkeypatch, "test")
        make_user("empty_kb_user", subscription="free")
        # No seed call — KB is empty.
        _login(client, "empty_kb_user")

        resp = client.get("/api/kb/pricing")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True

        # Premium without an ID is rendered but not purchasable.
        assert body["sku"]["premium"]["stripe_price_id"] == ""
        assert body["sku"]["premium"]["purchasable"] is False

        # All three paid tiers: not purchasable, no ID.
        for tier in body["sku"]["community_tier"]["tiers"]:
            assert tier["stripe_price_id"] == ""
            assert tier["purchasable"] is False

    def test_id_populated_flips_purchasable_true(self, client, monkeypatch):
        _set_stripe_mode(monkeypatch, "test")
        make_user("purch_user", subscription="free")
        _seed_pricing_kb()
        _login(client, "purch_user")

        body = client.get("/api/kb/pricing").get_json()
        assert body["sku"]["premium"]["purchasable"] is True
        for tier in body["sku"]["community_tier"]["tiers"]:
            assert tier["purchasable"] is True

    def test_partial_seed_only_flips_present_ids(self, client, monkeypatch):
        """L1 populated, L2/L3 still blank → only L1 is purchasable."""
        _set_stripe_mode(monkeypatch, "test")
        make_user("partial_user", subscription="free")
        _seed_pricing_kb(
            paid_l1_test="price_l1_only",
            paid_l2_test="",
            paid_l3_test="",
        )
        _login(client, "partial_user")

        body = client.get("/api/kb/pricing").get_json()
        tiers_by_code = {t["tier_code"]: t
                         for t in body["sku"]["community_tier"]["tiers"]}
        assert tiers_by_code["paid_l1"]["purchasable"] is True
        assert tiers_by_code["paid_l2"]["purchasable"] is False
        assert tiers_by_code["paid_l3"]["purchasable"] is False
