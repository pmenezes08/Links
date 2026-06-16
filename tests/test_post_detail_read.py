"""Smoke tests for ``backend.services.post_detail_read``."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import patch

from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user


def _insert_post(community_id: int, username: str, content: str) -> int:
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
        try:
            conn.commit()
        except Exception:
            pass
        return post_id


def _join_community(username: str, community_id: int, role: str = "member") -> None:
    """Attach an existing user to a community (membership = read access)."""
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


def test_read_community_post_detail_invalid_id_returns_400(mysql_dsn):
    from backend.services.post_detail_read import read_community_post_detail

    body, status = read_community_post_detail(0, "anyone")
    assert status == 400
    assert body["success"] is False
    assert "Post ID" in body.get("error", "")


def test_read_community_post_detail_missing_returns_404(mysql_dsn):
    from backend.services.post_detail_read import read_community_post_detail

    make_user("post_reader", subscription="premium")
    with patch("backend.services.firestore_reads.USE_FIRESTORE_READS", False):
        body, status = read_community_post_detail(987654321, "post_reader")
    assert status == 404
    assert body["success"] is False


def test_read_community_post_detail_mysql_returns_post_and_viewer_flags(mysql_dsn):
    from backend.services.post_detail_read import read_community_post_detail

    make_user("post_author_pd", subscription="premium")
    make_user("post_viewer_pd", subscription="premium")
    community_id = make_community(
        "post-detail-read",
        tier="free",
        creator_username="post_author_pd",
    )
    post_id = _insert_post(community_id, "post_author_pd", "hello detail")
    # The viewer must be a member to open a community post (privacy IDOR gate);
    # this test exercises read mechanics / viewer-flag hydration, not access.
    _join_community("post_viewer_pd", community_id)

    with patch("backend.services.firestore_reads.USE_FIRESTORE_READS", False):
        body, status = read_community_post_detail(post_id, "post_viewer_pd")

    assert status == 200
    assert body["success"] is True
    post = body["post"]
    assert post["id"] == post_id
    assert post["content"] == "hello detail"
    assert "user_reaction" in post
    assert "is_starred" in post
    assert "is_community_starred" in post
    assert "is_community_admin" in post
    assert "replies" in post and isinstance(post["replies"], list)


def test_read_community_post_detail_non_member_returns_404(mysql_dsn):
    """Privacy IDOR gate: a user who is not a member of the post's community
    gets a non-enumerating 404, not the post body."""
    from backend.services.post_detail_read import read_community_post_detail

    make_user("pd_author", subscription="premium")
    make_user("pd_outsider", subscription="premium")
    community_id = make_community(
        "pd-private", tier="free", creator_username="pd_author"
    )
    post_id = _insert_post(community_id, "pd_author", "members only")

    with patch("backend.services.firestore_reads.USE_FIRESTORE_READS", False):
        body, status = read_community_post_detail(post_id, "pd_outsider")

    assert status == 404
    assert body["success"] is False
    assert "post" not in body


def test_read_community_post_detail_general_feed_post_is_public(mysql_dsn):
    """General / home-feed posts (no community_id) remain readable by any
    authenticated user — the gate must not break the public feed."""
    from backend.services.post_detail_read import read_community_post_detail

    make_user("pd_gen_author", subscription="premium")
    make_user("pd_gen_reader", subscription="premium")
    post_id = _insert_post(None, "pd_gen_author", "public general post")

    with patch("backend.services.firestore_reads.USE_FIRESTORE_READS", False):
        body, status = read_community_post_detail(post_id, "pd_gen_reader")

    assert status == 200
    assert body["success"] is True
    assert body["post"]["content"] == "public general post"


def test_read_group_post_detail_invalid_id_returns_400_payload(mysql_dsn):
    from backend.services.post_detail_read import read_group_post_detail

    body, status = read_group_post_detail(0, "anyone")
    assert body["success"] is False
