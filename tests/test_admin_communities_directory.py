from __future__ import annotations

import pytest
from flask import Flask

from backend.blueprints import admin_communities as ac_mod
from backend.services import ai_usage, community_billing
from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import fill_community_members, make_community, make_user


@pytest.fixture
def client(mysql_dsn, monkeypatch):
    community_billing.ensure_tables()
    monkeypatch.setattr(ac_mod, "is_app_admin", lambda username: username == "boss")

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(ac_mod.admin_communities_bp)
    with app.test_client() as c:
        yield c


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def test_directory_requires_admin_session(client):
    resp = client.get("/api/admin/communities/directory")
    assert resp.status_code == 401


def test_directory_forbids_non_admin(client):
    make_user("regular")
    _login(client, "regular")
    resp = client.get("/api/admin/communities/directory")
    assert resp.status_code == 403


def test_directory_returns_rows_and_admins(client):
    make_user("boss", is_admin=True)
    make_user("alice")
    root_id = make_community("RootNet", creator_username="alice")
    sub_id = make_community("SubNet", creator_username="alice", parent_community_id=root_id)
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            f"""
            INSERT INTO community_admins (community_id, username, appointed_by)
            VALUES ({ph}, {ph}, {ph})
            """,
            (root_id, "boss", "alice"),
        )
    fill_community_members(root_id, 2)

    _login(client, "boss")
    resp = client.get("/api/admin/communities/directory")
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["success"] is True
    rows = {r["id"]: r for r in payload["communities"]}

    root = rows[root_id]
    assert root["name"] == "RootNet"
    assert root["creator_username"] == "alice"
    assert root["direct_child_count"] == 1
    assert root["member_count"] >= 2
    assert "boss" in root["admin_usernames"]

    sub = rows[sub_id]
    assert sub["parent_community_id"] == root_id
    assert sub["direct_child_count"] == 0


def test_directory_returns_steve_pool_usage_for_active_package(client, monkeypatch):
    make_user("boss", is_admin=True)
    make_user("pool_owner")
    root_id = make_community("PoolRoot", creator_username="pool_owner")
    sub_id = make_community("PoolSub", creator_username="pool_owner", parent_community_id=root_id)
    community_billing.mark_steve_package_subscription(
        root_id,
        subscription_id="sub_steve_admin_dir",
        status="active",
    )
    monkeypatch.setattr(ac_mod, "_steve_pool_cap_from_kb", lambda: 300)
    ai_usage.log_usage(
        "pool_owner",
        surface=ai_usage.SURFACE_FEED,
        request_type="steve_post_reply",
        community_id=root_id,
    )

    _login(client, "boss")
    resp = client.get("/api/admin/communities/directory")
    assert resp.status_code == 200
    rows = {r["id"]: r for r in resp.get_json()["communities"]}

    root = rows[root_id]
    assert root["steve_package_subscription_active"] is True
    assert root["steve_package_subscription_status"] == "active"
    assert root["steve_pool_cap"] == 300
    assert root["steve_pool_used"] == 1
    assert root["steve_pool_remaining"] == 299

    sub = rows[sub_id]
    assert sub["steve_package_subscription_active"] is True
    assert sub["steve_pool_used"] == 1


def test_steve_pool_snapshot_counts_against_root_for_subcommunity(monkeypatch):
    monkeypatch.setattr(ac_mod.community_billing, "resolve_root_community_id", lambda cid: (10, None))
    monkeypatch.setattr(
        ac_mod.community_billing,
        "get_billing_state",
        lambda cid: {
            "steve_package_subscription_active": True,
            "steve_package_subscription_status": "active",
        },
    )
    monkeypatch.setattr(ac_mod.ai_usage, "community_monthly_steve_pool_usage", lambda cid: 7 if cid == 10 else 0)

    snapshot = ac_mod._steve_pool_snapshot(99, 300)

    assert snapshot["steve_package_subscription_active"] is True
    assert snapshot["steve_pool_cap"] == 300
    assert snapshot["steve_pool_used"] == 7
    assert snapshot["steve_pool_remaining"] == 293
