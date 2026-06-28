"""Tests for the two-player turn-based MATCH primitive (creation_match.py).

The critical invariants: only a seat can read/act, only the seat whose turn it
is may move, and a stale version is rejected (optimistic concurrency). Runs
against the MySQL testcontainer (skips when Docker is unavailable).
"""

from __future__ import annotations

import pytest

from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services import builder, creation_match as cm

pytestmark = pytest.mark.usefixtures("mysql_dsn")


@pytest.fixture(autouse=True)
def _tables():
    builder.ensure_tables()


def _user(username: str) -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"INSERT INTO users (username, subscription) VALUES ({ph}, {ph})", (username, "free"))
        uid = c.lastrowid
        conn.commit()
    return int(uid)


def _community(creator: str = "owner") -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"INSERT INTO communities (name, creator_username) VALUES ({ph}, {ph})", ("Games", creator))
        cid = c.lastrowid
        conn.commit()
    return int(cid)


def _join(uid: int, cid: int) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO user_communities (user_id, community_id, role) VALUES ({ph}, {ph}, 'member')",
            (uid, cid),
        )
        conn.commit()


def _creation(cid: int, owner: str = "alice") -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""INSERT INTO creations
                (community_id, created_by, title, kind, html_content, prompt_history,
                 parent_creation_id, status, published_post_id, created_at, updated_at)
                VALUES ({ph}, {ph}, 'Board Game', 'game', '<!doctype html>', NULL,
                        NULL, 'published', NULL, '2026-01-01 00:00:00', '2026-01-01 00:00:00')""",
            (cid, owner),
        )
        crid = c.lastrowid
        conn.commit()
    return int(crid)


def _seed_two() -> int:
    cid = _community()
    _join(_user("alice"), cid)
    _join(_user("bob"), cid)
    return cid


def test_challenge_accept_move_turn_enforcement():
    cid = _seed_two()
    crid = 7  # the service is creation-agnostic (the route gates access)

    # alice sees bob as an opponent (opaque handle + display/username)
    opps = cm.list_opponents(crid, cid, "alice")
    assert "bob" in [o["name"] for o in opps]
    assert all(o["handle"] and o["name"] != "alice" for o in opps)

    m = cm.create_match(creation_id=crid, community_id=cid, challenger="alice",
                        opponent_handle=cm._handle("bob"))
    assert m["status"] == "pending"
    mid = m["id"]

    cm.accept_match(mid, "bob")
    assert cm.get_match(mid, "alice")["your_turn"] is True

    r = cm.submit_move(mid, "alice", move={"m": "e4"}, state={"b": 1}, expected_version=0)
    assert r["ok"] and r["version"] == 1 and r["seq"] == 1

    with pytest.raises(PermissionError):  # not alice's turn anymore
        cm.submit_move(mid, "alice", move={"m": "x"}, state={"b": 2}, expected_version=1)
    with pytest.raises(ValueError):  # bob with a stale version
        cm.submit_move(mid, "bob", move={"m": "e5"}, state={"b": 2}, expected_version=0)

    r2 = cm.submit_move(mid, "bob", move={"m": "e5"}, state={"b": 2}, expected_version=1)
    assert r2["seq"] == 2

    p = cm.poll_match(mid, "bob", 0)
    assert [x["seq"] for x in p["moves"]] == [1, 2]
    assert p["moves"][0]["by"] == "them" and p["moves"][1]["by"] == "me"

    rw = cm.submit_move(mid, "alice", move={"m": "mate"}, state={"b": 3}, expected_version=2, result="win")
    assert rw["status"] == "finished" and rw["winner"] == "me"
    assert cm.get_match(mid, "bob")["winner"] == "them"


def test_dict_cursor_rows_and_scoped_match_access():
    cid = _seed_two()
    crid = 11
    other_crid = 12

    # Regression for PyMySQL DictCursor rows: positional reads must still work.
    assert cm._cell({"username": "alice"}, 0) == "alice"

    m = cm.create_match(creation_id=crid, community_id=cid, challenger="alice",
                        opponent_handle=cm._handle("bob"))
    cm.accept_match(m["id"], "bob", creation_id=crid, community_id=cid)
    assert cm.get_match(m["id"], "alice", creation_id=crid, community_id=cid)["id"] == m["id"]

    with pytest.raises(ValueError) as wrong_creation:
        cm.get_match(m["id"], "alice", creation_id=other_crid, community_id=cid)
    assert str(wrong_creation.value) == "match_not_found"
    with pytest.raises(ValueError) as wrong_move_scope:
        cm.submit_move(m["id"], "alice", move={}, state={}, expected_version=0,
                       creation_id=other_crid, community_id=cid)
    assert str(wrong_move_scope.value) == "match_not_found"


def test_list_matches_and_non_player_blocked():
    cid = _seed_two()
    crid = 8
    m = cm.create_match(creation_id=crid, community_id=cid, challenger="alice",
                        opponent_handle=cm._handle("bob"))
    cm.accept_match(m["id"], "bob")
    assert any(x["id"] == m["id"] for x in cm.list_matches(crid, "alice"))
    assert any(x["id"] == m["id"] for x in cm.list_matches(crid, "bob"))

    _user("eve")
    with pytest.raises(PermissionError):
        cm.get_match(m["id"], "eve")
    with pytest.raises(PermissionError):
        cm.submit_move(m["id"], "eve", move={}, state={}, expected_version=0)


def test_cannot_challenge_self_or_nonmember():
    cid = _seed_two()
    crid = 9
    with pytest.raises(ValueError):
        cm.create_match(creation_id=crid, community_id=cid, challenger="alice",
                        opponent_handle=cm._handle("alice"))
    _user("carol")  # not a member of this community
    with pytest.raises(ValueError):
        cm.create_match(creation_id=crid, community_id=cid, challenger="alice",
                        opponent_handle=cm._handle("carol"))


def test_decline_and_resign():
    cid = _seed_two()
    crid = 10
    m = cm.create_match(creation_id=crid, community_id=cid, challenger="alice",
                        opponent_handle=cm._handle("bob"))
    assert cm.decline_match(m["id"], "bob")["status"] == "declined"

    m_cancel = cm.create_match(creation_id=crid, community_id=cid, challenger="alice",
                               opponent_handle=cm._handle("bob"))
    assert cm.cancel_match(m_cancel["id"], "alice")["status"] == "cancelled"
    with pytest.raises(ValueError):
        cm.accept_match(m_cancel["id"], "bob")

    m2 = cm.create_match(creation_id=crid, community_id=cid, challenger="alice",
                         opponent_handle=cm._handle("bob"))
    cm.accept_match(m2["id"], "bob")
    rg = cm.resign_match(m2["id"], "alice")  # alice resigns -> bob wins
    assert rg["status"] == "finished" and rg["winner"] == "them"


def test_match_routes_full_flow_and_cross_creation_scope():
    from flask import Flask
    from backend.blueprints.builder import builder_bp

    cid = _seed_two()
    crid = _creation(cid)
    other_crid = _creation(cid)

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(builder_bp)
    client = app.test_client()

    def login(username: str) -> None:
        with client.session_transaction() as sess:
            sess["username"] = username

    login("alice")
    opponents = client.get(f"/api/builder/{crid}/match/opponents")
    assert opponents.status_code == 200
    handle = opponents.get_json()["opponents"][0]["handle"]

    created = client.post(f"/api/builder/{crid}/match/create", json={"opponent": handle})
    assert created.status_code == 200
    match_id = int(created.get_json()["match"]["id"])

    # Same player and same community, but wrong creation route: scoped as not found.
    wrong_scope = client.get(f"/api/builder/{other_crid}/match/{match_id}")
    assert wrong_scope.status_code == 404

    cancelled = client.post(f"/api/builder/{crid}/match/{match_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.get_json()["match"]["status"] == "cancelled"

    created = client.post(f"/api/builder/{crid}/match/create", json={"opponent": handle})
    assert created.status_code == 200
    match_id = int(created.get_json()["match"]["id"])

    login("bob")
    accepted = client.post(f"/api/builder/{crid}/match/{match_id}/accept")
    assert accepted.status_code == 200
    assert accepted.get_json()["match"]["status"] == "active"

    blocked = client.post(f"/api/builder/{crid}/match/{match_id}/move", json={
        "move": {"cell": 0}, "state": {"board": ["O"]}, "version": 0,
    })
    assert blocked.status_code == 403
    assert blocked.get_json()["error"] == "not_your_turn"

    login("alice")
    got = client.get(f"/api/builder/{crid}/match/{match_id}")
    assert got.status_code == 200
    assert got.get_json()["match"]["your_turn"] is True
    moved = client.post(f"/api/builder/{crid}/match/{match_id}/move", json={
        "move": {"cell": 0}, "state": {"board": ["X"]}, "version": 0,
    })
    assert moved.status_code == 200
    assert moved.get_json()["version"] == 1

    login("bob")
    polled = client.get(f"/api/builder/{crid}/match/{match_id}/poll?since=0")
    assert polled.status_code == 200
    assert polled.get_json()["moves"][0]["by"] == "them"
    declined = client.post(f"/api/builder/{crid}/match/{match_id}/decline")
    assert declined.status_code == 400
    resigned = client.post(f"/api/builder/{crid}/match/{match_id}/resign")
    assert resigned.status_code == 200
    assert resigned.get_json()["match"]["status"] == "finished"
