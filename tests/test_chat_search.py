"""Tests for per-thread keyword search (backend/services/chat_search.py)."""

import pytest
import sqlite3
from unittest.mock import patch


@pytest.fixture
def search_db(tmp_path):
    """Create an in-memory SQLite DB with messages and group_chat_messages tables."""
    db_path = str(tmp_path / "test.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL
        )
    """)
    c.execute("INSERT INTO users (username) VALUES ('alice')")
    c.execute("INSERT INTO users (username) VALUES ('bob')")
    c.execute("INSERT INTO users (username) VALUES ('carol')")

    c.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender TEXT NOT NULL,
            receiver TEXT NOT NULL,
            message TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            is_read INTEGER DEFAULT 0,
            human_dm_thread TEXT,
            image_path TEXT,
            video_path TEXT,
            audio_path TEXT,
            audio_duration_seconds REAL,
            audio_mime TEXT,
            edited_at TEXT,
            audio_summary TEXT,
            reaction TEXT,
            reaction_by TEXT,
            media_paths TEXT,
            file_path TEXT,
            file_name TEXT
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS deleted_chat_threads (
            username TEXT NOT NULL,
            other_username TEXT NOT NULL,
            deleted_at TEXT,
            PRIMARY KEY (username, other_username)
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS group_chats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT
        )
    """)
    c.execute("INSERT INTO group_chats (name) VALUES ('Test Group')")

    c.execute("""
        CREATE TABLE IF NOT EXISTS group_chat_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            UNIQUE(group_id, username)
        )
    """)
    c.execute("INSERT INTO group_chat_members (group_id, username) VALUES (1, 'alice')")
    c.execute("INSERT INTO group_chat_members (group_id, username) VALUES (1, 'bob')")

    c.execute("""
        CREATE TABLE IF NOT EXISTS group_chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            sender_username TEXT NOT NULL,
            message_text TEXT,
            image_path TEXT,
            voice_path TEXT,
            video_path TEXT,
            media_paths TEXT,
            client_key TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            is_deleted INTEGER DEFAULT 0,
            is_edited INTEGER DEFAULT 0,
            audio_summary TEXT,
            file_path TEXT,
            file_name TEXT
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS group_chat_read_receipts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            last_read_message_id INTEGER DEFAULT 0,
            last_read_at TEXT,
            cleared_before_message_id INTEGER DEFAULT NULL,
            UNIQUE(group_id, username)
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS user_profiles (
            username TEXT PRIMARY KEY,
            profile_picture TEXT
        )
    """)
    c.execute("INSERT INTO user_profiles (username, profile_picture) VALUES ('alice', NULL)")
    c.execute("INSERT INTO user_profiles (username, profile_picture) VALUES ('bob', NULL)")

    msgs = [
        ('alice', 'bob', 'Hey, want to grab dinner tonight?', '2025-01-15T10:00:00Z'),
        ('bob', 'alice', 'Sure! Where for dinner?', '2025-01-15T10:01:00Z'),
        ('alice', 'bob', 'How about Italian?', '2025-01-15T10:02:00Z'),
        ('bob', 'alice', 'Sounds good, dinner at 7pm', '2025-01-15T10:03:00Z'),
        ('alice', 'bob', 'See you then!', '2025-01-15T10:04:00Z'),
    ]
    for sender, receiver, msg, ts in msgs:
        c.execute(
            "INSERT INTO messages (sender, receiver, message, timestamp) VALUES (?, ?, ?, ?)",
            (sender, receiver, msg, ts),
        )

    group_msgs = [
        (1, 'alice', 'Lets plan dinner for the team', '2025-01-15T10:00:00'),
        (1, 'bob', 'Great idea! dinner sounds fun', '2025-01-15T10:01:00'),
        (1, 'alice', 'I will book a table', '2025-01-15T10:02:00'),
        (1, 'bob', 'What time for dinner?', '2025-01-15T10:03:00'),
    ]
    for gid, sender, text, ts in group_msgs:
        c.execute(
            "INSERT INTO group_chat_messages (group_id, sender_username, message_text, created_at) VALUES (?, ?, ?, ?)",
            (gid, sender, text, ts),
        )

    conn.commit()

    yield conn, db_path

    conn.close()


def _patch_db(search_db):
    """Return context managers that patch database helpers to use test SQLite."""
    conn, db_path = search_db
    import contextlib

    @contextlib.contextmanager
    def fake_get_db():
        test_conn = sqlite3.connect(db_path)
        test_conn.row_factory = sqlite3.Row
        try:
            yield test_conn
        finally:
            test_conn.close()

    return (
        patch("backend.services.chat_search.get_db_connection", fake_get_db),
        patch("backend.services.chat_search.USE_MYSQL", False),
        patch("backend.services.chat_search.get_sql_placeholder", return_value="?"),
    )


class TestSearchDmThread:
    def test_basic_search(self, search_db):
        p1, p2, p3 = _patch_db(search_db)
        with p1, p2, p3:
            from backend.services.chat_search import search_dm_thread
            total, messages, has_more = search_dm_thread("alice", "bob", "dinner")
            assert total == 3
            assert len(messages) == 3
            assert all("dinner" in m["text"].lower() for m in messages)

    def test_no_results(self, search_db):
        p1, p2, p3 = _patch_db(search_db)
        with p1, p2, p3:
            from backend.services.chat_search import search_dm_thread
            total, messages, has_more = search_dm_thread("alice", "bob", "pizza")
            assert total == 0
            assert len(messages) == 0

    def test_pagination(self, search_db):
        p1, p2, p3 = _patch_db(search_db)
        with p1, p2, p3:
            from backend.services.chat_search import search_dm_thread
            total, messages, has_more = search_dm_thread("alice", "bob", "dinner", limit=2, offset=0)
            assert total == 3
            assert len(messages) == 2
            assert has_more is True

            total2, messages2, has_more2 = search_dm_thread("alice", "bob", "dinner", limit=2, offset=2)
            assert total2 == 3
            assert len(messages2) == 1
            assert has_more2 is False

    def test_sent_flag(self, search_db):
        p1, p2, p3 = _patch_db(search_db)
        with p1, p2, p3:
            from backend.services.chat_search import search_dm_thread
            _, messages, _ = search_dm_thread("alice", "bob", "dinner")
            for m in messages:
                if "want to grab" in m["text"]:
                    assert m["sent"] is True
                elif "Where for dinner" in m["text"]:
                    assert m["sent"] is False

    def test_deleted_thread_filter(self, search_db):
        conn, db_path = search_db
        c = conn.cursor()
        c.execute(
            "INSERT INTO deleted_chat_threads (username, other_username, deleted_at) VALUES (?, ?, ?)",
            ("alice", "bob", "2025-01-15T10:02:30"),
        )
        conn.commit()

        p1, p2, p3 = _patch_db(search_db)
        with p1, p2, p3:
            from backend.services.chat_search import search_dm_thread
            total, messages, _ = search_dm_thread("alice", "bob", "dinner")
            assert total == 1
            assert messages[0]["text"] == "Sounds good, dinner at 7pm"

    def test_message_shape(self, search_db):
        p1, p2, p3 = _patch_db(search_db)
        with p1, p2, p3:
            from backend.services.chat_search import search_dm_thread
            _, messages, _ = search_dm_thread("alice", "bob", "dinner")
            msg = messages[0]
            assert "id" in msg
            assert "text" in msg
            assert "sent" in msg
            assert "time" in msg


class TestSearchGroupThread:
    def test_basic_search(self, search_db):
        p1, p2, p3 = _patch_db(search_db)
        with p1, p2, p3:
            from backend.services.chat_search import search_group_thread
            total, messages, has_more = search_group_thread("alice", 1, "dinner")
            assert total == 3
            assert len(messages) == 3

    def test_non_member_gets_empty(self, search_db):
        p1, p2, p3 = _patch_db(search_db)
        with p1, p2, p3:
            from backend.services.chat_search import search_group_thread
            total, messages, _ = search_group_thread("carol", 1, "dinner")
            assert total == 0
            assert len(messages) == 0

    def test_no_results(self, search_db):
        p1, p2, p3 = _patch_db(search_db)
        with p1, p2, p3:
            from backend.services.chat_search import search_group_thread
            total, messages, _ = search_group_thread("alice", 1, "pizza")
            assert total == 0

    def test_pagination(self, search_db):
        p1, p2, p3 = _patch_db(search_db)
        with p1, p2, p3:
            from backend.services.chat_search import search_group_thread
            total, messages, has_more = search_group_thread("alice", 1, "dinner", limit=2, offset=0)
            assert total == 3
            assert len(messages) == 2
            assert has_more is True

    def test_deleted_messages_excluded(self, search_db):
        conn, db_path = search_db
        c = conn.cursor()
        c.execute("UPDATE group_chat_messages SET is_deleted = 1 WHERE id = 1")
        conn.commit()

        p1, p2, p3 = _patch_db(search_db)
        with p1, p2, p3:
            from backend.services.chat_search import search_group_thread
            total, messages, _ = search_group_thread("alice", 1, "dinner")
            assert total == 2

    def test_cleared_before_filter(self, search_db):
        conn, db_path = search_db
        c = conn.cursor()
        c.execute(
            "INSERT INTO group_chat_read_receipts (group_id, username, last_read_message_id, cleared_before_message_id) VALUES (?, ?, ?, ?)",
            (1, "alice", 4, 2),
        )
        conn.commit()

        p1, p2, p3 = _patch_db(search_db)
        with p1, p2, p3:
            from backend.services.chat_search import search_group_thread
            total, messages, _ = search_group_thread("alice", 1, "dinner")
            assert total == 1
            assert all(m["id"] > 2 for m in messages)

    def test_message_shape(self, search_db):
        p1, p2, p3 = _patch_db(search_db)
        with p1, p2, p3:
            from backend.services.chat_search import search_group_thread
            _, messages, _ = search_group_thread("alice", 1, "dinner")
            msg = messages[0]
            assert "id" in msg
            assert "text" in msg
            assert "sender" in msg
            assert "created_at" in msg
