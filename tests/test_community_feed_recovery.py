from __future__ import annotations

from datetime import datetime

from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _attach_member(username: str, community_id: int) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        user_id = row["id"] if hasattr(row, "keys") else row[0]
        c.execute(
            f"""
            INSERT INTO user_communities (user_id, community_id, role, joined_at)
            VALUES ({ph}, {ph}, {ph}, {ph})
            """,
            (user_id, community_id, "member", datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")),
        )
        conn.commit()


def _insert_post(username: str, community_id: int, content: str = "hello") -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO posts (community_id, username, content, timestamp)
            VALUES ({ph}, {ph}, {ph}, {ph})
            """,
            (community_id, username, content, datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")),
        )
        post_id = int(c.lastrowid)
        conn.commit()
        return post_id


def _insert_reply(username: str, community_id: int, post_id: int, content: str = "reply") -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO replies (post_id, community_id, username, content, timestamp)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph})
            """,
            (post_id, community_id, username, content, datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")),
        )
        reply_id = int(c.lastrowid)
        conn.commit()
        return reply_id


def test_empty_stories_do_not_run_schema_ensure(mysql_dsn, monkeypatch):
    import bodybuilding_app
    from backend.services import community_stories

    make_user("story_empty_owner", subscription="premium")
    community_id = make_community("story-empty-community", creator_username="story_empty_owner")

    def fail_if_called(_cursor):
        raise AssertionError("story list must not ensure schema on the read path")

    monkeypatch.setattr(community_stories, "ensure_story_tables", fail_if_called)

    client = bodybuilding_app.app.test_client()
    _login(client, "story_empty_owner")

    resp = client.get(f"/api/community_stories/{community_id}")
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["success"] is True
    assert payload["stories"] == []
    assert payload["groups"] == []


def test_post_reply_rejects_parent_from_another_post(mysql_dsn):
    import bodybuilding_app

    make_user("reply_guard_owner", subscription="premium")
    community_id = make_community("reply-guard-community", creator_username="reply_guard_owner")
    _attach_member("reply_guard_owner", community_id)
    post_id = _insert_post("reply_guard_owner", community_id, "target")
    other_post_id = _insert_post("reply_guard_owner", community_id, "other")
    other_reply_id = _insert_reply("reply_guard_owner", community_id, other_post_id, "other reply")

    client = bodybuilding_app.app.test_client()
    _login(client, "reply_guard_owner")

    resp = client.post(
        "/post_reply",
        data={
            "post_id": str(post_id),
            "parent_reply_id": str(other_reply_id),
            "content": "nested reply",
        },
    )
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "Parent reply does not belong to this post"


def test_steve_reply_rejects_invalid_parent_before_ai(mysql_dsn, monkeypatch):
    import bodybuilding_app

    make_user("steve_guard_owner", subscription="premium")
    make_user("Steve", subscription="premium")
    community_id = make_community("steve-guard-community", creator_username="steve_guard_owner")
    _attach_member("steve_guard_owner", community_id)
    post_id = _insert_post("steve_guard_owner", community_id, "target @Steve")
    other_post_id = _insert_post("steve_guard_owner", community_id, "other")
    other_reply_id = _insert_reply("steve_guard_owner", community_id, other_post_id, "other reply")

    class NoAiClient:
        def __init__(self, *args, **kwargs):
            raise AssertionError("AI client should not be created for an invalid parent reply")

    monkeypatch.setattr(bodybuilding_app, "XAI_API_KEY", "test-key")
    monkeypatch.setattr(bodybuilding_app, "OpenAI", NoAiClient)

    client = bodybuilding_app.app.test_client()
    _login(client, "steve_guard_owner")

    resp = client.post(
        "/api/ai/steve_reply",
        json={
            "post_id": post_id,
            "parent_reply_id": other_reply_id,
            "community_id": community_id,
            "user_message": "@Steve can you answer here?",
        },
    )
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "Parent reply does not belong to this post"
