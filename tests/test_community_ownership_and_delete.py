from __future__ import annotations

import pytest
from flask import Flask

from backend.blueprints.communities import communities_bp
from backend.services import community as community_svc
from backend.services import community_billing, community_lifecycle
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.user_activity_tables import ensure_user_activity_tables
from tests.fixtures import make_community, make_user


pytestmark = pytest.mark.usefixtures("mysql_dsn")


@pytest.fixture
def client(monkeypatch):
    """Small app containing only the communities blueprint."""
    import backend.blueprints.communities as communities_mod

    monkeypatch.setattr(communities_mod, "invalidate_community_cache", lambda *_: None)
    monkeypatch.setattr(communities_mod, "invalidate_user_cache", lambda *_: None)

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(communities_bp)

    with app.test_client() as c:
        yield c


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _community_exists(community_id: int) -> bool:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT 1 FROM communities WHERE id = {ph}", (community_id,))
        return c.fetchone() is not None


class _FakeStripeSubscription:
    calls: list[tuple[str, dict]] = []

    @classmethod
    def retrieve(cls, subscription_id: str):
        return {"id": subscription_id, "metadata": {"existing": "kept"}}

    @classmethod
    def modify(cls, subscription_id: str, **kwargs):
        cls.calls.append((subscription_id, kwargs))
        return {
            "id": subscription_id,
            "status": "active",
            "current_period_end": 1_800_000_000,
            "cancel_at_period_end": True,
        }


class _FakeStripe:
    Subscription = _FakeStripeSubscription


def test_can_manage_community_handles_mixed_case_owner_and_admin():
    make_user("Paulo", subscription="free")
    cid = make_community("owner-case", creator_username="Paulo")

    assert community_svc.can_manage_community("Paulo", cid) is True
    assert community_svc.can_manage_community("paulo", cid) is True
    assert community_svc.can_manage_community("PAULO", cid) is True
    assert community_svc.can_manage_community("admin", cid) is True
    assert community_svc.can_manage_community("outsider", cid) is False


def test_delete_community_cascade_returns_honest_rowcount():
    make_user("cascade_owner", subscription="free")
    cid = make_community("cascade-rowcount", creator_username="cascade_owner")

    with get_db_connection() as conn:
        c = conn.cursor()
        assert community_svc.delete_community_cascade(c, cid) == 1
        assert community_svc.delete_community_cascade(c, cid) == 0
        conn.commit()


def test_delete_community_cascade_removes_visit_history():
    make_user("visit_history_owner", subscription="free")
    cid = make_community("cascade-visit-history", creator_username="visit_history_owner")
    ph = get_sql_placeholder()

    with get_db_connection() as conn:
        ensure_user_activity_tables(conn)
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO community_visit_history (username, community_id, visit_time)
            VALUES ({ph}, {ph}, {ph})
            """,
            ("visit_history_owner", cid, "2026-05-04T15:29:00Z"),
        )

        assert community_svc.delete_community_cascade(c, cid) == 1

        c.execute(f"SELECT 1 FROM community_visit_history WHERE community_id = {ph}", (cid,))
        assert c.fetchone() is None
        conn.commit()


def test_delete_community_accepts_mixed_case_owner(client):
    make_user("Paulo", subscription="free")
    cid = make_community("mixed-case-delete", creator_username="Paulo")
    _login(client, "paulo")

    resp = client.post("/delete_community", data={"community_id": str(cid)})

    assert resp.status_code == 200
    assert resp.get_json()["success"] is True
    assert _community_exists(cid) is False


def test_admin_can_delete_someone_elses_community(client):
    make_user("regular_owner", subscription="free")
    cid = make_community("admin-delete", creator_username="regular_owner")
    _login(client, "admin")

    resp = client.post("/api/admin/delete_community", json={"community_id": cid})

    assert resp.status_code == 200
    assert resp.get_json()["success"] is True
    assert _community_exists(cid) is False


def test_delete_blocks_nested_community_owned_by_someone_else(client):
    make_user("root_owner", subscription="free")
    make_user("child_owner", subscription="free")
    parent_id = make_community("delete-parent", creator_username="root_owner")
    child_id = make_community(
        "delete-child",
        creator_username="child_owner",
        parent_community_id=parent_id,
    )
    _login(client, "root_owner")

    resp = client.post("/delete_community", data={"community_id": str(parent_id)})

    body = resp.get_json()
    assert resp.status_code == 403
    assert body["success"] is False
    assert body["blocking_id"] == child_id
    assert _community_exists(parent_id) is True
    assert _community_exists(child_id) is True


def test_delete_rolls_back_when_cascade_fails(client, monkeypatch):
    make_user("rollback_owner", subscription="free")
    cid = make_community("rollback-delete", creator_username="rollback_owner")
    _login(client, "rollback_owner")

    def fail_after_delete(cursor, community_id: int) -> int:
        ph = get_sql_placeholder()
        cursor.execute(f"DELETE FROM communities WHERE id = {ph}", (community_id,))
        raise RuntimeError("simulated cascade failure")

    monkeypatch.setattr(community_svc, "delete_community_cascade", fail_after_delete)

    resp = client.post("/delete_community", data={"community_id": str(cid)})

    assert resp.status_code == 500
    assert resp.get_json()["success"] is False
    assert _community_exists(cid) is True


def test_delete_active_subscription_requires_confirmation(client):
    make_user("paid_owner", subscription="free")
    cid = make_community("paid-delete-warning", creator_username="paid_owner", tier="paid_l1")
    community_billing.mark_subscription(
        cid,
        tier_code="paid_l1",
        subscription_id="sub_live_delete",
        customer_id="cus_delete",
        status="active",
        current_period_end=1_800_000_000,
    )
    _login(client, "paid_owner")

    resp = client.post("/delete_community", data={"community_id": str(cid)})

    body = resp.get_json()
    assert resp.status_code == 409
    assert body["reason"] == "active_subscription_requires_confirmation"
    assert body["subscriptions"][0]["stripe_subscription_id"] == "sub_live_delete"
    assert _community_exists(cid) is True


def test_confirmed_delete_schedules_subscription_cancellation(client, monkeypatch):
    import backend.blueprints.communities as communities_mod

    _FakeStripeSubscription.calls = []
    monkeypatch.setattr(communities_mod, "_stripe_client", lambda: _FakeStripe)
    make_user("confirmed_owner", subscription="free")
    cid = make_community("confirmed-paid-delete", creator_username="confirmed_owner", tier="paid_l2")
    community_billing.mark_subscription(
        cid,
        tier_code="paid_l2",
        subscription_id="sub_confirm_delete",
        customer_id="cus_confirm",
        status="active",
        current_period_end=1_800_000_000,
    )
    _login(client, "confirmed_owner")

    resp = client.post(
        "/delete_community",
        data={"community_id": str(cid), "confirm_active_subscription": "true"},
    )

    assert resp.status_code == 200
    assert resp.get_json()["success"] is True
    assert _FakeStripeSubscription.calls == [
        (
            "sub_confirm_delete",
            {
                "cancel_at_period_end": True,
                "metadata": {"existing": "kept", "cancellation_initiator": "app"},
            },
        )
    ]
    assert _community_exists(cid) is False


def test_admin_delete_notifies_owner(client, monkeypatch):
    import backend.blueprints.communities as communities_mod

    notifications = []
    monkeypatch.setattr(
        communities_mod.community_admin_notifications,
        "notify_owner_of_admin_action",
        lambda **kwargs: notifications.append(kwargs) or True,
    )
    make_user("notified_owner", subscription="free")
    cid = make_community("admin-delete-notify", creator_username="notified_owner")
    _login(client, "admin")

    resp = client.post("/api/admin/delete_community", json={"community_id": cid})

    assert resp.status_code == 200
    assert notifications == [
        {
            "community_id": cid,
            "action": "deleted",
            "actor_username": "admin",
            "extra": {
                "community_id": cid,
                "community_name": "admin-delete-notify",
                "owner_username": "notified_owner",
            },
        }
    ]


def test_freeze_and_unfreeze_community_requires_owner(client):
    make_user("freeze_owner", subscription="free")
    make_user("freeze_outsider", subscription="free")
    cid = make_community("freeze-me", creator_username="freeze_owner")

    _login(client, "freeze_outsider")
    denied = client.post(f"/api/communities/{cid}/freeze", json={})
    assert denied.status_code == 403

    _login(client, "freeze_owner")
    frozen = client.post(f"/api/communities/{cid}/freeze", json={"reason": "test"})
    assert frozen.status_code == 200
    assert frozen.get_json()["is_frozen"] is True

    unfrozen = client.post(f"/api/communities/{cid}/unfreeze", json={})
    assert unfrozen.status_code == 200
    assert unfrozen.get_json()["is_frozen"] is False


def test_frozen_access_payload_blocks_members_but_not_owner():
    make_user("frozen_owner", subscription="free")
    make_user("frozen_member", subscription="free")
    cid = make_community("frozen-access", creator_username="frozen_owner")
    state = community_lifecycle.set_freeze_state(
        cid,
        frozen=True,
        actor_username="frozen_owner",
    )
    community = {
        "id": cid,
        "creator_username": "frozen_owner",
        "is_frozen": state["is_frozen"],
    }

    blocked = community_lifecycle.frozen_access_payload("frozen_member", community)
    assert blocked is not None
    assert blocked["reason"] == "community_frozen"
    assert community_lifecycle.frozen_access_payload("frozen_owner", community) is None
