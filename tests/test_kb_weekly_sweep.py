"""Unit tests for the weekly KB auto-synthesis sweep.

Covers:

  * ``username_bucket`` returns stable, deterministic values in ``[0, N)``
  * ``get_active_usernames_for_kb_sweep`` picks up users from both
    ``posts`` and ``replies`` within the window and ignores older rows
  * Users outside the given bucket are excluded
  * The helper tolerates a missing ``replies`` table (posts-only fallback)

Uses the shared MySQL testcontainer via the ``mysql_dsn`` fixture — the
tests skip cleanly when Docker isn't available.
"""

from __future__ import annotations

import zlib
from datetime import datetime, timedelta
from typing import List

import pytest

pytestmark = pytest.mark.usefixtures("mysql_dsn")


from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.steve_knowledge_base import (
    get_active_usernames_for_kb_sweep,
    username_bucket,
)


# ── Fixture helpers ─────────────────────────────────────────────────────


def _insert_post(username: str, *, days_ago: int = 0) -> None:
    ts = datetime.utcnow() - timedelta(days=days_ago)
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"INSERT INTO posts (community_id, username, content, timestamp) "
            f"VALUES ({ph}, {ph}, {ph}, {ph})",
            (1, username, "hello", ts),
        )
        conn.commit()


def _insert_reply(username: str, *, days_ago: int = 0) -> None:
    ts = datetime.utcnow() - timedelta(days=days_ago)
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"INSERT INTO replies (post_id, community_id, username, content, timestamp) "
            f"VALUES ({ph}, {ph}, {ph}, {ph}, {ph})",
            (1, 1, username, "hi there", ts),
        )
        conn.commit()


def _pick_usernames_for_bucket(target_bucket: int, *, buckets: int = 7, count: int = 3) -> List[str]:
    """Return ``count`` usernames that hash to ``target_bucket`` mod ``buckets``."""
    found: List[str] = []
    i = 0
    while len(found) < count and i < 10_000:
        candidate = f"user_{target_bucket}_{i}"
        if zlib.crc32(candidate.encode("utf-8")) % buckets == target_bucket:
            found.append(candidate)
        i += 1
    assert len(found) == count, "could not synthesize enough bucketed usernames"
    return found


# ── Tests ───────────────────────────────────────────────────────────────


class TestUsernameBucket:
    def test_matches_crc32_mod_n(self):
        assert username_bucket("alice", 7) == zlib.crc32(b"alice") % 7
        assert username_bucket("bob", 7) == zlib.crc32(b"bob") % 7

    def test_is_deterministic(self):
        assert username_bucket("alice", 7) == username_bucket("alice", 7)

    def test_respects_bucket_count(self):
        for n in (1, 2, 3, 7, 14):
            assert 0 <= username_bucket("alice", n) < n

    def test_empty_string_is_bucket_zero(self):
        # CRC32 of an empty string is 0 — this keeps behaviour predictable
        # when a row has NULL username that somehow leaks through.
        assert username_bucket("", 7) == 0


class TestActiveUserSweep:
    def test_picks_up_active_users_from_posts_and_replies(self):
        bucket = 3
        users = _pick_usernames_for_bucket(bucket, count=3)
        _insert_post(users[0], days_ago=1)
        _insert_reply(users[1], days_ago=2)
        _insert_post(users[2], days_ago=6)  # still inside 7-day window

        result = get_active_usernames_for_kb_sweep(bucket, buckets=7, window_days=7)

        assert sorted(result) == sorted(users)

    def test_excludes_users_outside_window(self):
        bucket = 2
        [active_user] = _pick_usernames_for_bucket(bucket, count=1)
        stale_user_pool = _pick_usernames_for_bucket(bucket, count=2)
        stale_user = stale_user_pool[1]  # different from active_user

        _insert_post(active_user, days_ago=1)
        _insert_post(stale_user, days_ago=30)  # way outside window

        result = get_active_usernames_for_kb_sweep(bucket, buckets=7, window_days=7)

        assert active_user in result
        assert stale_user not in result

    def test_excludes_users_in_other_buckets(self):
        target_bucket = 1
        other_bucket = 4
        [mine] = _pick_usernames_for_bucket(target_bucket, count=1)
        [theirs] = _pick_usernames_for_bucket(other_bucket, count=1)

        _insert_post(mine, days_ago=0)
        _insert_post(theirs, days_ago=0)

        result = get_active_usernames_for_kb_sweep(target_bucket, buckets=7, window_days=7)

        assert mine in result
        assert theirs not in result

    def test_replies_only_user_is_included(self):
        bucket = 0
        [u] = _pick_usernames_for_bucket(bucket, count=1)
        _insert_reply(u, days_ago=0)

        result = get_active_usernames_for_kb_sweep(bucket, buckets=7, window_days=7)

        assert u in result

    def test_deduplicates_users_with_both_posts_and_replies(self):
        bucket = 5
        [u] = _pick_usernames_for_bucket(bucket, count=1)
        _insert_post(u, days_ago=1)
        _insert_reply(u, days_ago=1)

        result = get_active_usernames_for_kb_sweep(bucket, buckets=7, window_days=7)

        assert result.count(u) == 1

    def test_respects_limit(self):
        bucket = 6
        users = _pick_usernames_for_bucket(bucket, count=3)
        for u in users:
            _insert_post(u, days_ago=0)

        result = get_active_usernames_for_kb_sweep(bucket, buckets=7, window_days=7, limit=2)

        assert len(result) == 2
        # Sort order is stable (alphabetical) so we know which two came back.
        assert result == sorted(users)[:2]

    def test_empty_result_when_no_activity(self):
        result = get_active_usernames_for_kb_sweep(0, buckets=7, window_days=7)
        assert result == []

    def test_missing_replies_table_is_tolerated(self):
        """Dropping the replies table mid-run should not crash the sweep;
        posts coverage alone is still returned."""
        bucket = 4
        [u] = _pick_usernames_for_bucket(bucket, count=1)
        _insert_post(u, days_ago=0)

        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("DROP TABLE replies")
            conn.commit()

        try:
            result = get_active_usernames_for_kb_sweep(bucket, buckets=7, window_days=7)
            assert u in result
        finally:
            # Restore the schema so the autouse cleanup fixture doesn't
            # choke on the missing TRUNCATE target.
            with get_db_connection() as conn:
                c = conn.cursor()
                c.execute(
                    """
                    CREATE TABLE IF NOT EXISTS replies (
                        id INT PRIMARY KEY AUTO_INCREMENT,
                        post_id INT,
                        community_id INT,
                        username VARCHAR(191),
                        content TEXT,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_replies_user_ts (username, timestamp)
                    )
                    """
                )
                conn.commit()
