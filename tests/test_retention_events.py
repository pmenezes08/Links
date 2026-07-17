"""Retention attribution events + checkout_started funnel markers.

Covers the two instrumentation sinks added for the conversion/retention MVP:

* ``backend/services/retention_events.py`` + ``POST /api/retention/event`` —
  closed event/source vocabulary, login gate, never-raises writes.
* ``checkout_started`` audit rows written by
  ``POST /api/stripe/create_checkout_session`` — one row per Checkout
  session created, carrying the (closed-set) CTA ``source``.
"""

from __future__ import annotations

import json

import pytest
from flask import Flask

from backend.services import retention_events
from backend.services.database import get_db_connection, get_sql_placeholder

from tests.fixtures import make_community, make_user

pytestmark = pytest.mark.usefixtures("mysql_dsn")


# ── Service-level normalization ─────────────────────────────────────────


class TestNormalize:
    def test_unknown_event_type_is_rejected(self):
        assert retention_events.normalize_event(
            event_type="totally_new_thing", source="owner_dashboard") is None

    def test_unknown_source_collapses_to_direct(self):
        n = retention_events.normalize_event(
            event_type="digest_opened", source="from_the_future")
        assert n is not None
        assert n["source"] == "direct"

    def test_ids_are_coerced_or_dropped(self):
        n = retention_events.normalize_event(
            event_type="digest_opened", source="weekly_digest_push",
            community_id="42", group_id="not-a-number")
        assert n["community_id"] == 42
        assert n["group_id"] is None

    def test_detail_is_truncated(self):
        n = retention_events.normalize_event(
            event_type="owner_action_tapped", source="owner_dashboard",
            detail="x" * 500)
        assert len(n["detail"]) == 64

    def test_record_requires_username(self):
        assert retention_events.record_event(
            "", event_type="digest_opened", source="direct") is False


# ── Blueprint route ─────────────────────────────────────────────────────


@pytest.fixture
def client(mysql_dsn):
    from backend.blueprints.retention_events import retention_events_bp

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(retention_events_bp)
    with app.test_client() as c:
        yield c


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _rows_for(username: str):
    retention_events.ensure_events_table()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT event_type, source, community_id, group_id, detail "
            f"FROM retention_events WHERE username = {ph} ORDER BY id",
            (username,),
        )
        rows = c.fetchall() or []
    out = []
    for r in rows:
        if hasattr(r, "keys"):
            out.append(dict(r))
        else:
            out.append({"event_type": r[0], "source": r[1],
                        "community_id": r[2], "group_id": r[3], "detail": r[4]})
    return out


class TestRoute:
    def test_anon_is_rejected(self, client):
        resp = client.post("/api/retention/event",
                           json={"event_type": "digest_opened"})
        assert resp.status_code == 401

    def test_valid_event_is_recorded(self, client):
        make_user("ret_user")
        _login(client, "ret_user")
        resp = client.post("/api/retention/event", json={
            "event_type": "digest_opened",
            "source": "weekly_digest_push",
            "community_id": 7,
        })
        assert resp.status_code == 200
        assert resp.get_json()["recorded"] is True
        rows = _rows_for("ret_user")
        assert len(rows) == 1
        assert rows[0]["event_type"] == "digest_opened"
        assert rows[0]["source"] == "weekly_digest_push"
        assert int(rows[0]["community_id"]) == 7

    def test_invalid_event_type_returns_200_not_recorded(self, client):
        make_user("ret_bad")
        _login(client, "ret_bad")
        resp = client.post("/api/retention/event",
                           json={"event_type": "nonsense", "source": "direct"})
        assert resp.status_code == 200
        assert resp.get_json()["recorded"] is False
        assert _rows_for("ret_bad") == []

    def test_owner_action_tap_with_detail(self, client):
        make_user("ret_owner")
        _login(client, "ret_owner")
        resp = client.post("/api/retention/event", json={
            "event_type": "owner_action_tapped",
            "source": "owner_dashboard",
            "community_id": 3,
            "detail": "owner.steve.action_invite",
        })
        assert resp.get_json()["recorded"] is True
        rows = _rows_for("ret_owner")
        assert rows[0]["detail"] == "owner.steve.action_invite"


# ── checkout_started audit rows ─────────────────────────────────────────


class _FakeCheckoutSession(dict):
    pass


@pytest.fixture
def checkout_client(mysql_dsn, monkeypatch):
    from backend.blueprints.subscriptions import subscriptions_bp
    from backend.services import community_billing

    monkeypatch.setenv("STRIPE_API_KEY", "sk_test_dummy_for_tests")
    community_billing.ensure_tables()

    def _fake_create(**kwargs):
        return _FakeCheckoutSession(id="cs_test_fake_123",
                                    url="https://stripe.test/cs_test_fake_123")

    import stripe  # type: ignore
    monkeypatch.setattr(stripe.checkout.Session, "create", _fake_create)

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(subscriptions_bp)
    with app.test_client() as c:
        yield c


def _seed_kb_l1_price(price_id: str = "price_l1_from_kb") -> None:
    from backend.services import knowledge_base as kb

    kb.seed_default_pages(force=True)
    page = kb.get_page("community-tiers") or {}
    fields = list(page.get("fields") or [])
    for f in fields:
        if f.get("name") == "paid_l1_stripe_price_id_test":
            f["value"] = price_id
    kb.save_page("community-tiers", fields=fields,
                 reason="test-fixture", actor_username="test-fixture")


def _audit_rows(username: str, action: str):
    from backend.services import subscription_audit

    subscription_audit.ensure_tables()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT community_id, metadata_json FROM subscription_audit_log "
            f"WHERE username = {ph} AND action = {ph} ORDER BY id",
            (username, action),
        )
        rows = c.fetchall() or []
    out = []
    for r in rows:
        cid = r["community_id"] if hasattr(r, "keys") else r[0]
        md_raw = r["metadata_json"] if hasattr(r, "keys") else r[1]
        out.append({"community_id": cid,
                    "metadata": json.loads(md_raw) if md_raw else None})
    return out


class TestCheckoutStartedAudit:
    def test_community_tier_checkout_writes_audit_with_source(self, checkout_client):
        make_user("ck_owner", subscription="free")
        cid = make_community("c-ck-audit", tier="free",
                             creator_username="ck_owner")
        _seed_kb_l1_price()
        _login(checkout_client, "ck_owner")

        resp = checkout_client.post("/api/stripe/create_checkout_session", json={
            "plan_id": "community_tier",
            "community_id": cid,
            "tier_code": "paid_l1",
            "source": "owner_dashboard",
        })
        assert resp.status_code == 200, resp.get_json()

        rows = _audit_rows("ck_owner", "community_tier_checkout_started")
        assert len(rows) == 1
        assert int(rows[0]["community_id"]) == cid
        assert rows[0]["metadata"]["source"] == "owner_dashboard"
        assert rows[0]["metadata"]["tier_code"] == "paid_l1"

    def test_unknown_source_collapses_to_direct(self, checkout_client):
        make_user("ck_owner2", subscription="free")
        cid = make_community("c-ck-audit2", tier="free",
                             creator_username="ck_owner2")
        _seed_kb_l1_price()
        _login(checkout_client, "ck_owner2")

        resp = checkout_client.post("/api/stripe/create_checkout_session", json={
            "plan_id": "community_tier",
            "community_id": cid,
            "tier_code": "paid_l1",
            "source": "instagram_bio",
        })
        assert resp.status_code == 200
        rows = _audit_rows("ck_owner2", "community_tier_checkout_started")
        assert rows[0]["metadata"]["source"] == "direct"

    def test_blocked_checkout_writes_no_audit(self, checkout_client):
        """Preflight rejections are not checkout starts."""
        make_user("ck_outsider", subscription="free")
        make_user("ck_owner3", subscription="free")
        cid = make_community("c-ck-audit3", tier="free",
                             creator_username="ck_owner3")
        _seed_kb_l1_price()
        _login(checkout_client, "ck_outsider")

        resp = checkout_client.post("/api/stripe/create_checkout_session", json={
            "plan_id": "community_tier",
            "community_id": cid,
            "tier_code": "paid_l1",
            "source": "owner_dashboard",
        })
        assert resp.status_code == 403
        assert _audit_rows("ck_outsider", "community_tier_checkout_started") == []
