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


def _insert_post(community_id: int, username: str = "poster") -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO posts (community_id, username, content, timestamp)
            VALUES ({ph}, {ph}, {ph}, NOW())
            """,
            (community_id, username, "hello"),
        )
        pid = c.lastrowid
        try:
            conn.commit()
        except Exception:
            pass
    return int(pid)


def _insert_post_view(post_id: int, username: str) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO post_views (post_id, username, viewed_at)
            VALUES ({ph}, {ph}, NOW())
            """,
            (post_id, username),
        )
        try:
            conn.commit()
        except Exception:
            pass


def test_count_unread_posts_by_community_ids_per_node():
    make_user("alice", subscription="free")
    cid_a = make_community("unread-a", creator_username="alice")
    cid_b = make_community("unread-b", creator_username="alice")

    p1 = _insert_post(cid_a, "bob")
    p2 = _insert_post(cid_a, "bob")
    _insert_post(cid_b, "bob")
    _insert_post_view(p1, "alice")

    with get_db_connection() as conn:
        c = conn.cursor()
        m = community_svc.count_unread_posts_by_community_ids(c, [cid_a, cid_b], "alice")

    assert m.get(cid_a) == 1
    assert m.get(cid_b) == 1


def test_count_unread_posts_in_community_ids_rollup():
    make_user("rollup_u", subscription="free")
    parent_id = make_community("unread-parent", creator_username="rollup_u")
    child_id = make_community(
        "unread-child", creator_username="rollup_u", parent_community_id=parent_id
    )

    _insert_post(parent_id, "x")
    _insert_post(child_id, "y")
    _insert_post(child_id, "z")

    with get_db_connection() as conn:
        c = conn.cursor()
        tree = community_svc.get_descendant_community_ids(c, parent_id)
        total = community_svc.count_unread_posts_in_community_ids(c, tree, "rollup_u")

    assert total == 3


def test_post_views_username_is_case_insensitive_for_unread():
    make_user("Charlie", subscription="free")
    cid = make_community("case-c", creator_username="Charlie")
    p = _insert_post(cid, "bob")
    _insert_post_view(p, "charlie")

    with get_db_connection() as conn:
        c = conn.cursor()
        n = community_svc.count_unread_posts_in_community_ids(c, [cid], "CHARLIE")

    assert n == 0


def test_unread_excludes_viewers_own_posts_without_post_view():
    make_user("self_reader", subscription="free")
    cid = make_community("self-r", creator_username="self_reader")
    _insert_post(cid, "self_reader")
    _insert_post(cid, "bob")
    _insert_post(cid, "bob")

    with get_db_connection() as conn:
        c = conn.cursor()
        m = community_svc.count_unread_posts_by_community_ids(c, [cid], "self_reader")

    assert m.get(cid) == 2

    with get_db_connection() as conn:
        c = conn.cursor()
        n = community_svc.count_unread_posts_in_community_ids(c, [cid], "self_reader")

    assert n == 2


def test_unread_rollup_excludes_own_posts_only():
    make_user("roll_self", subscription="free")
    parent_id = make_community("roll-parent", creator_username="roll_self")
    child_id = make_community(
        "roll-child", creator_username="roll_self", parent_community_id=parent_id
    )
    _insert_post(parent_id, "roll_self")
    _insert_post(child_id, "other")
    _insert_post(child_id, "other")

    with get_db_connection() as conn:
        c = conn.cursor()
        tree = community_svc.get_descendant_community_ids(c, parent_id)
        total = community_svc.count_unread_posts_in_community_ids(c, tree, "roll_self")

    assert total == 2


def test_user_parent_community_includes_unread_posts_count(client):
    make_user("dash_u", subscription="free")
    parent_id = make_community("dash-parent", creator_username="dash_u")
    child_id = make_community(
        "dash-child", creator_username="dash_u", parent_community_id=parent_id
    )
    _insert_post(parent_id, "other")
    _insert_post(child_id, "childpost")

    _login(client, "dash_u")
    resp = client.get("/api/user_parent_community")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    comms = data["communities"]
    assert len(comms) >= 1
    row = next(x for x in comms if x["id"] == parent_id)
    assert "unread_posts_count" in row
    assert row["unread_posts_count"] == 2


def test_user_communities_hierarchical_includes_unread_per_node(client):
    make_user("tree_u", subscription="free")
    parent_id = make_community("tree-parent", creator_username="tree_u")
    child_id = make_community(
        "tree-child", creator_username="tree_u", parent_community_id=parent_id
    )
    _insert_post(parent_id, "p")
    _insert_post(child_id, "c")

    _login(client, "tree_u")
    resp = client.get("/api/user_communities_hierarchical")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    roots = data["communities"]
    root = next(r for r in roots if r["id"] == parent_id)
    assert root["unread_posts_count"] == 1
    assert len(root["children"]) >= 1
    ch = next(x for x in root["children"] if x["id"] == child_id)
    assert ch["unread_posts_count"] == 1
