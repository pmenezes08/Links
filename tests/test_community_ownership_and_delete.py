from __future__ import annotations

import pytest
from flask import Flask

from backend.blueprints.communities import communities_bp
from backend.services import community as community_svc
from backend.services.database import get_db_connection, get_sql_placeholder
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
