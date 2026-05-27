"""Tests for DM thread mute, archive, and active-chat endpoints."""

from __future__ import annotations

from datetime import datetime

from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_user


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _ensure_messages_table() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INT PRIMARY KEY AUTO_INCREMENT,
                sender VARCHAR(191) NOT NULL,
                receiver VARCHAR(191) NOT NULL,
                message TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_read TINYINT(1) DEFAULT 0,
                is_encrypted TINYINT(1) DEFAULT 0
            )
            """
        )
        try:
            conn.commit()
        except Exception:
            pass


def _insert_dm(sender: str, receiver: str, text: str) -> None:
    ph = get_sql_placeholder()
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO messages (sender, receiver, message, timestamp, is_read, is_encrypted)
            VALUES ({ph}, {ph}, {ph}, {ph}, 0, 0)
            """,
            (sender, receiver, text, ts),
        )
        conn.commit()


def test_mute_and_unmute_dm_thread(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    make_user("alice", subscription="premium")
    make_user("bob", subscription="premium")

    client = bodybuilding_app.app.test_client()
    _login(client, "alice")

    resp = client.post(
        "/api/chat/mute",
        json={"other_username": "bob", "muted": True},
    )
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True
    assert resp.get_json()["muted"] is True

    resp = client.post(
        "/api/chat/mute",
        json={"other_username": "bob", "muted": False},
    )
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True
    assert resp.get_json()["muted"] is False


def test_archive_unarchive_and_list_threads(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _ensure_messages_table()
    make_user("alice", subscription="premium")
    make_user("bob", subscription="premium")
    _insert_dm("alice", "bob", "hello archived")

    client = bodybuilding_app.app.test_client()
    _login(client, "alice")

    resp = client.post(
        "/api/archive_chat",
        data={"other_username": "bob"},
        content_type="application/x-www-form-urlencoded",
    )
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True

    resp = client.get("/api/archived_chats")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert len(body["threads"]) == 1
    assert body["threads"][0]["other_username"] == "bob"
    assert body["threads"][0]["is_archived"] is True

    resp = client.post(
        "/api/unarchive_chat",
        data={"other_username": "bob"},
        content_type="application/x-www-form-urlencoded",
    )
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True

    resp = client.get("/api/archived_chats")
    assert resp.status_code == 200
    assert resp.get_json()["threads"] == []


def test_active_chat_presence(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    make_user("alice", subscription="premium")
    make_user("bob", subscription="premium")

    client = bodybuilding_app.app.test_client()
    _login(client, "alice")

    resp = client.post("/api/active_chat", json={"peer": "bob"})
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT peer FROM active_chat_status WHERE user = {ph} AND peer = {ph}",
            ("alice", "bob"),
        )
        row = c.fetchone()
        assert row is not None
