"""End-to-end privacy-IDOR gate tests for community post WRITE/act routes.

``/post_reply`` and ``/add_reaction`` previously let any authenticated user
comment on / react to a post in any community by enumerating ``post_id``. The
membership gate (community_access.can_view_community_content) now blocks
non-members. These tests drive the real Flask routes to lock the wiring; the
policy itself is unit-tested in ``test_community_access_read.py``.
"""

from __future__ import annotations

from datetime import datetime

from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user


def _insert_post(community_id, username: str, content: str = "members only") -> int:
    ph = get_sql_placeholder()
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO posts (username, content, timestamp, community_id) "
            f"VALUES ({ph}, {ph}, {ph}, {ph})",
            (username, content, ts, community_id),
        )
        pid = int(c.lastrowid)
        try:
            conn.commit()
        except Exception:
            pass
        return pid


def _join(username: str, community_id: int, role: str = "member") -> None:
    ph = get_sql_placeholder()
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        uid = row["id"] if hasattr(row, "keys") else row[0]
        c.execute(
            f"INSERT INTO user_communities (user_id, community_id, role, joined_at) "
            f"VALUES ({ph}, {ph}, {ph}, {ph})",
            (int(uid), community_id, role, ts),
        )
        try:
            conn.commit()
        except Exception:
            pass


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def test_post_reply_blocks_non_member(mysql_dsn):
    import bodybuilding_app

    make_user("wpr_author")
    make_user("wpr_outsider")
    cid = make_community("wpr-priv", creator_username="wpr_author")
    pid = _insert_post(cid, "wpr_author")

    client = bodybuilding_app.app.test_client()
    _login(client, "wpr_outsider")
    resp = client.post("/post_reply", data={"post_id": str(pid), "content": "let me in"})

    assert resp.status_code == 404
    assert resp.get_json()["success"] is False


def test_post_reply_allows_member(mysql_dsn):
    import bodybuilding_app

    make_user("wpr_author2")
    make_user("wpr_member")
    cid = make_community("wpr-priv2", creator_username="wpr_author2")
    _join("wpr_member", cid)
    pid = _insert_post(cid, "wpr_author2")

    client = bodybuilding_app.app.test_client()
    _login(client, "wpr_member")
    resp = client.post("/post_reply", data={"post_id": str(pid), "content": "hello team"})

    # The membership gate must not block a legitimate member (the reply flow
    # itself returns 200); asserting "not 404" isolates the authz decision from
    # unrelated reply-pipeline behavior.
    assert resp.status_code != 404


def test_add_reaction_blocks_non_member(mysql_dsn):
    import bodybuilding_app

    make_user("wrx_author")
    make_user("wrx_outsider")
    cid = make_community("wrx-priv", creator_username="wrx_author")
    pid = _insert_post(cid, "wrx_author")

    client = bodybuilding_app.app.test_client()
    _login(client, "wrx_outsider")
    resp = client.post("/add_reaction", data={"post_id": str(pid), "reaction": "like"})

    assert resp.status_code == 404
    assert resp.get_json()["success"] is False
