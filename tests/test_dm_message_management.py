"""Tests for DM message delete, edit, audio summary, and media list endpoints."""

from __future__ import annotations

import json
from datetime import datetime, timedelta

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
                is_encrypted TINYINT(1) DEFAULT 0,
                image_path TEXT NULL,
                video_path TEXT NULL,
                media_paths TEXT NULL,
                audio_summary TEXT NULL,
                edited_at DATETIME NULL
            )
            """
        )
        for col, ddl in (
            ("image_path", "ALTER TABLE messages ADD COLUMN image_path TEXT NULL"),
            ("video_path", "ALTER TABLE messages ADD COLUMN video_path TEXT NULL"),
            ("media_paths", "ALTER TABLE messages ADD COLUMN media_paths TEXT NULL"),
            ("audio_summary", "ALTER TABLE messages ADD COLUMN audio_summary TEXT NULL"),
            ("edited_at", "ALTER TABLE messages ADD COLUMN edited_at DATETIME NULL"),
        ):
            try:
                c.execute(f"SELECT {col} FROM messages LIMIT 1")
            except Exception:
                try:
                    c.execute(ddl)
                except Exception:
                    pass
        try:
            conn.commit()
        except Exception:
            pass


def _insert_dm(
    sender: str,
    receiver: str,
    *,
    text: str = "hello",
    image_path: str | None = None,
    video_path: str | None = None,
    media_paths: list | None = None,
    audio_summary: str | None = None,
    timestamp: datetime | None = None,
) -> int:
    ph = get_sql_placeholder()
    ts = (timestamp or datetime.utcnow()).strftime("%Y-%m-%d %H:%M:%S")
    mp_json = json.dumps(media_paths) if media_paths else None
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO messages (
                sender, receiver, message, timestamp, is_read, is_encrypted,
                image_path, video_path, media_paths, audio_summary
            )
            VALUES ({ph}, {ph}, {ph}, {ph}, 0, 0, {ph}, {ph}, {ph}, {ph})
            """,
            (sender, receiver, text, ts, image_path, video_path, mp_json, audio_summary),
        )
        conn.commit()
        c.execute("SELECT LAST_INSERT_ID() AS id")
        row = c.fetchone()
        return row["id"] if hasattr(row, "keys") else row[0]


def test_participant_can_delete_message(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _ensure_messages_table()
    make_user("alice", subscription="premium")
    make_user("bob", subscription="premium")
    msg_id = _insert_dm("alice", "bob", text="delete me")

    client = bodybuilding_app.app.test_client()
    _login(client, "bob")
    resp = client.post(
        "/delete_message",
        data={"message_id": str(msg_id)},
        content_type="application/x-www-form-urlencoded",
    )
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM messages WHERE id = {ph}", (msg_id,))
        assert c.fetchone() is None


def test_sender_can_edit_message_within_window(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _ensure_messages_table()
    make_user("alice", subscription="premium")
    make_user("bob", subscription="premium")
    msg_id = _insert_dm("alice", "bob", text="original")

    client = bodybuilding_app.app.test_client()
    _login(client, "alice")
    resp = client.post(
        "/api/chat/edit_message",
        json={"message_id": msg_id, "text": "edited text"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT message FROM messages WHERE id = {ph}", (msg_id,))
        row = c.fetchone()
        assert (row["message"] if hasattr(row, "keys") else row[0]) == "edited text"


def test_edit_window_expired(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _ensure_messages_table()
    make_user("alice", subscription="premium")
    make_user("bob", subscription="premium")
    old_ts = datetime.utcnow() - timedelta(minutes=10)
    msg_id = _insert_dm("alice", "bob", text="old", timestamp=old_ts)

    client = bodybuilding_app.app.test_client()
    _login(client, "alice")
    resp = client.post(
        "/api/chat/edit_message",
        json={"message_id": msg_id, "text": "too late"},
    )
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "Edit window expired"


def test_sender_can_update_audio_summary(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _ensure_messages_table()
    make_user("alice", subscription="premium")
    make_user("bob", subscription="premium")
    msg_id = _insert_dm("alice", "bob", text="", audio_summary="old summary")

    client = bodybuilding_app.app.test_client()
    _login(client, "alice")
    resp = client.post(
        "/api/chat/update_audio_summary",
        json={"message_id": msg_id, "summary": "new summary"},
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["summary"] == "new summary"


def test_non_sender_cannot_update_audio_summary(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _ensure_messages_table()
    make_user("alice", subscription="premium")
    make_user("bob", subscription="premium")
    msg_id = _insert_dm("alice", "bob", text="", audio_summary="mine")

    client = bodybuilding_app.app.test_client()
    _login(client, "bob")
    resp = client.post(
        "/api/chat/update_audio_summary",
        json={"message_id": msg_id, "summary": "hacked"},
    )
    assert resp.status_code == 403


def test_list_dm_chat_media(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _ensure_messages_table()
    make_user("alice", subscription="premium")
    make_user("bob", subscription="premium")
    _insert_dm(
        "alice",
        "bob",
        text="",
        image_path="https://cdn.example/photo.jpg",
        media_paths=["https://cdn.example/clip.mp4"],
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "alice")
    resp = client.get("/api/chat/media?peer=bob")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert len(body["media"]) == 2
    types = {item["type"] for item in body["media"]}
    assert types == {"image", "video"}
