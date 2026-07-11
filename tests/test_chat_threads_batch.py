"""Batched /api/chat_threads stats must exactly match the legacy per-thread loop.

``build_chat_threads_payload`` now computes last-message previews and unread
counts in 3 batched queries (``_batch_thread_stats``) instead of 2 per thread,
falling back to the legacy per-thread queries on any error. Every scenario here
asserts the payload AND that forcing the fallback produces an identical payload
(the strongest guard against semantic drift in the batch SQL).
"""

from __future__ import annotations

from datetime import datetime

import pytest

from backend.services import dm_chat_threads
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.dm_chat_threads import build_chat_threads_payload
from backend.services.dm_human_thread import human_pair_thread_key
from redis_cache import cache
from tests.fixtures import make_user


@pytest.fixture()
def needs_mysql(mysql_dsn):
    """Dependency ensures Docker MySQL is up (mysql_dsn skips if not)."""
    return mysql_dsn


def _ensure_tables() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """CREATE TABLE IF NOT EXISTS messages (
                id INT PRIMARY KEY AUTO_INCREMENT,
                sender VARCHAR(191) NOT NULL,
                receiver VARCHAR(191) NOT NULL,
                message TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_read TINYINT(1) DEFAULT 0,
                is_encrypted TINYINT(1) DEFAULT 0,
                human_dm_thread VARCHAR(191) NULL,
                image_path VARCHAR(512) NULL,
                video_path VARCHAR(512) NULL,
                audio_path VARCHAR(512) NULL,
                audio_summary TEXT NULL,
                media_paths TEXT NULL
            )"""
        )
        for col, ddl in (
            ("human_dm_thread", "ALTER TABLE messages ADD COLUMN human_dm_thread VARCHAR(191) NULL"),
            ("image_path", "ALTER TABLE messages ADD COLUMN image_path VARCHAR(512) NULL"),
            ("video_path", "ALTER TABLE messages ADD COLUMN video_path VARCHAR(512) NULL"),
            ("audio_path", "ALTER TABLE messages ADD COLUMN audio_path VARCHAR(512) NULL"),
            ("audio_summary", "ALTER TABLE messages ADD COLUMN audio_summary TEXT NULL"),
            ("media_paths", "ALTER TABLE messages ADD COLUMN media_paths TEXT NULL"),
            ("is_encrypted", "ALTER TABLE messages ADD COLUMN is_encrypted TINYINT(1) DEFAULT 0"),
        ):
            try:
                c.execute(f"SELECT {col} FROM messages LIMIT 1")
            except Exception:
                try:
                    c.execute(ddl)
                except Exception:
                    pass
        c.execute(
            """CREATE TABLE IF NOT EXISTS deleted_chat_threads (
                username VARCHAR(191) NOT NULL,
                other_username VARCHAR(191) NOT NULL,
                deleted_at DATETIME NULL,
                PRIMARY KEY (username, other_username)
            )"""
        )
        conn.commit()


def _send(
    sender: str,
    receiver: str,
    text: str | None,
    ts: str,
    *,
    is_read: int = 1,
    thr: str | None = None,
    image_path: str | None = None,
) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""INSERT INTO messages
                (sender, receiver, message, timestamp, is_read, human_dm_thread, image_path)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})""",
            (sender, receiver, text or "", ts, is_read, thr, image_path),
        )
        conn.commit()


def _mark_deleted(username: str, other: str, deleted_at: str) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""INSERT INTO deleted_chat_threads (username, other_username, deleted_at)
                VALUES ({ph}, {ph}, {ph})
                ON DUPLICATE KEY UPDATE deleted_at = VALUES(deleted_at)""",
            (username, other, deleted_at),
        )
        conn.commit()


def _fresh_payload(username: str) -> dict:
    cache.delete(f"chat_threads:{username}")
    payload = build_chat_threads_payload(username)
    assert payload.get("success") is True, payload
    return payload


def _threads_by_peer(payload: dict) -> dict[str, dict]:
    return {t["other_username"]: t for t in payload["threads"]}


def _assert_batch_matches_legacy(username: str, batch_payload: dict) -> None:
    """Force the legacy per-thread path and require an identical payload."""

    def _boom(*_args, **_kwargs):
        raise RuntimeError("forced legacy fallback")

    original = dm_chat_threads._batch_thread_stats
    dm_chat_threads._batch_thread_stats = _boom
    try:
        legacy_payload = _fresh_payload(username)
    finally:
        dm_chat_threads._batch_thread_stats = original
    assert batch_payload["threads"] == legacy_payload["threads"]


def test_basic_pair_preview_unread_and_sort(needs_mysql):
    _ensure_tables()
    make_user("ctb_v1")
    make_user("ctb_p1")
    make_user("ctb_p2")

    _send("ctb_v1", "ctb_p1", "hi p1", "2026-07-10 09:00:00")
    _send("ctb_p1", "ctb_v1", "unread one", "2026-07-10 09:01:00", is_read=0)
    _send("ctb_p1", "ctb_v1", "newest from p1", "2026-07-10 09:02:00", is_read=0)
    _send("ctb_p2", "ctb_v1", "p2 newest", "2026-07-10 10:00:00", is_read=1)

    payload = _fresh_payload("ctb_v1")
    threads = _threads_by_peer(payload)

    t1 = threads["ctb_p1"]
    assert t1["last_message_text"] == "newest from p1"
    assert t1["last_sender"] == "ctb_p1"
    assert t1["unread_count"] == 2
    # The shared CI `messages` table's timestamp column type depends on which
    # suite created it first (DATETIME → ISO "T", TEXT → stored spelling), so
    # compare normalized.
    assert str(t1["last_activity_time"]).replace(" ", "T") == "2026-07-10T09:02:00"

    t2 = threads["ctb_p2"]
    assert t2["last_message_text"] == "p2 newest"
    assert t2["unread_count"] == 0

    # Recency sort: p2 (10:00) before p1 (09:02).
    order = [t["other_username"] for t in payload["threads"] if t["other_username"] in ("ctb_p1", "ctb_p2")]
    assert order == ["ctb_p2", "ctb_p1"]

    _assert_batch_matches_legacy("ctb_v1", payload)


def test_own_sent_message_is_preview_but_not_unread(needs_mysql):
    _ensure_tables()
    make_user("ctb_v2")
    make_user("ctb_p3")

    _send("ctb_p3", "ctb_v2", "peer says", "2026-07-10 09:00:00", is_read=0)
    _send("ctb_v2", "ctb_p3", "my reply", "2026-07-10 09:05:00", is_read=0)

    payload = _fresh_payload("ctb_v2")
    t = _threads_by_peer(payload)["ctb_p3"]
    assert t["last_message_text"] == "my reply"
    assert t["last_sender"] == "ctb_v2"
    assert t["unread_count"] == 1  # only the peer's message counts

    _assert_batch_matches_legacy("ctb_v2", payload)


def test_media_only_message_gets_media_label(needs_mysql):
    _ensure_tables()
    make_user("ctb_v3")
    make_user("ctb_p4")

    _send("ctb_p4", "ctb_v3", None, "2026-07-10 09:00:00", image_path="uploads/x.jpg")

    payload = _fresh_payload("ctb_v3")
    t = _threads_by_peer(payload)["ctb_p4"]
    assert t["last_message_text"] == "Photo"

    _assert_batch_matches_legacy("ctb_v3", payload)


def test_steve_tagged_rows_belong_to_the_human_pair(needs_mysql):
    _ensure_tables()
    make_user("ctb_v4")
    make_user("ctb_p5")
    make_user("steve")

    thr = human_pair_thread_key("ctb_v4", "ctb_p5")

    # Human pair traffic, then a newer Steve in-thread reply tagged for the pair.
    _send("ctb_v4", "ctb_p5", "human msg", "2026-07-10 09:00:00")
    _send("steve", "ctb_v4", "steve in-thread answer", "2026-07-10 09:10:00", is_read=0, thr=thr)

    # Private Steve chat: untagged rows only.
    _send("ctb_v4", "steve", "private question", "2026-07-10 08:00:00")
    _send("steve", "ctb_v4", "private answer", "2026-07-10 08:01:00", is_read=0)

    payload = _fresh_payload("ctb_v4")
    threads = _threads_by_peer(payload)

    # The tagged Steve reply is the human pair's preview...
    pair = threads["ctb_p5"]
    assert pair["last_message_text"] == "steve in-thread answer"
    assert pair["last_sender"] == "steve"

    # ...and must NOT leak into the private Steve thread (preview or unread).
    steve_thread = threads["steve"]
    assert steve_thread["last_message_text"] == "private answer"
    assert steve_thread["unread_count"] == 1

    _assert_batch_matches_legacy("ctb_v4", payload)


def test_deleted_thread_cutoff_filters_preview_and_unread(needs_mysql):
    _ensure_tables()
    make_user("ctb_v5")
    make_user("ctb_p6")
    make_user("ctb_p7")

    # Fully deleted thread: everything before the cutoff.
    _send("ctb_p6", "ctb_v5", "old stuff", "2026-07-10 09:00:00", is_read=0)
    _mark_deleted("ctb_v5", "ctb_p6", "2026-07-10 12:00:00")

    # Deleted then re-messaged: only post-cutoff rows count.
    _send("ctb_p7", "ctb_v5", "before delete", "2026-07-10 09:00:00", is_read=0)
    _mark_deleted("ctb_v5", "ctb_p7", "2026-07-10 12:00:00")
    _send("ctb_p7", "ctb_v5", "after delete", "2026-07-10 13:00:00", is_read=0)

    payload = _fresh_payload("ctb_v5")
    threads = _threads_by_peer(payload)

    gone = threads["ctb_p6"]
    assert gone["last_message_text"] is None
    assert gone["unread_count"] == 0

    revived = threads["ctb_p7"]
    assert revived["last_message_text"] == "after delete"
    assert revived["unread_count"] == 1

    _assert_batch_matches_legacy("ctb_v5", payload)
