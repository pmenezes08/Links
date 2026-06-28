from __future__ import annotations

from datetime import datetime

from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _insert_post(community_id: int, username: str, content: str = "poll thread") -> int:
    ph = get_sql_placeholder()
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO posts (username, content, timestamp, community_id)
            VALUES ({ph}, {ph}, {ph}, {ph})
            """,
            (username, content, ts, community_id),
        )
        post_id = int(c.lastrowid)
        conn.commit()
        return post_id


def _insert_poll(post_id: int, username: str, *, active: bool) -> int:
    ph = get_sql_placeholder()
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO polls (post_id, question, created_by, created_at, single_vote, is_active)
            VALUES ({ph}, {ph}, {ph}, {ph}, 1, {ph})
            """,
            (post_id, "Final score?", username, ts, 1 if active else 0),
        )
        poll_id = int(c.lastrowid)
        c.execute(
            f"INSERT INTO poll_options (poll_id, option_text, votes) VALUES ({ph}, {ph}, 0)",
            (poll_id, "Team A"),
        )
        option_a = int(c.lastrowid)
        c.execute(
            f"INSERT INTO poll_options (poll_id, option_text, votes) VALUES ({ph}, {ph}, 0)",
            (poll_id, "Team B"),
        )
        c.execute(
            f"INSERT INTO poll_votes (poll_id, option_id, username, voted_at) VALUES ({ph}, {ph}, {ph}, {ph})",
            (poll_id, option_a, username, ts),
        )
        conn.commit()
        return poll_id


def test_group_feed_hydrates_closed_poll_as_final_result(mysql_dsn):
    from backend.services.community_group_feed import build_group_feed_post_dicts

    make_user("closed_feed_author", subscription="premium")
    community_id = make_community(
        "closed-feed-poll-community",
        creator_username="closed_feed_author",
    )
    post_id = _insert_post(community_id, "closed_feed_author")
    poll_id = _insert_poll(post_id, "closed_feed_author", active=False)

    rows = [
        {
            "id": post_id,
            "username": "closed_feed_author",
            "content": "poll thread",
            "community_id": community_id,
            "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
            "image_path": None,
            "video_path": None,
            "audio_path": None,
            "audio_summary": None,
        }
    ]
    with get_db_connection() as conn:
        posts = build_group_feed_post_dicts(
            conn.cursor(),
            rows,
            "closed_feed_author",
            get_sql_placeholder(),
            {community_id: "Closed Feed Poll Community"},
        )

    poll = posts[0]["poll"]
    assert poll["id"] == poll_id
    assert poll["is_active"] == 0
    assert poll["question"] == "Final score?"
    assert poll["total_votes"] == 1


def test_delete_poll_removes_backing_feed_post(mysql_dsn):
    import bodybuilding_app

    make_user("delete_poll_author", subscription="premium")
    community_id = make_community(
        "delete-poll-community",
        creator_username="delete_poll_author",
    )
    post_id = _insert_post(community_id, "delete_poll_author")
    poll_id = _insert_poll(post_id, "delete_poll_author", active=True)

    client = bodybuilding_app.app.test_client()
    _login(client, "delete_poll_author")

    resp = client.post("/delete_poll", json={"poll_id": poll_id})
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM polls WHERE id = {ph}", (poll_id,))
        assert c.fetchone() is None
        c.execute(f"SELECT id FROM posts WHERE id = {ph}", (post_id,))
        assert c.fetchone() is None
