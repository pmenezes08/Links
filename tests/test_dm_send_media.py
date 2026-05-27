"""Tests for DM media send endpoints and services."""

from __future__ import annotations

import io
from unittest.mock import patch

from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.dm_send_media import send_dm_grouped_media, send_dm_photo_message
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
                image_path TEXT NULL,
                video_path TEXT NULL,
                media_paths TEXT NULL
            )
            """
        )
        try:
            conn.commit()
        except Exception:
            pass


def _recipient_id(username: str) -> str:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        return str(row["id"] if hasattr(row, "keys") else row[0])


class _FakeFile:
    def __init__(self, filename: str, mimetype: str = "image/jpeg"):
        self.filename = filename
        self.mimetype = mimetype
        self.stream = io.BytesIO(b"fake")


@patch("backend.services.firestore_writes.write_dm_message")
@patch("backend.services.notifications.send_push_to_user")
@patch("backend.services.dm_send_media.save_uploaded_file", return_value="https://cdn.example/photo.jpg")
def test_send_photo_message_route(mock_save, mock_push, mock_fs, mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _ensure_messages_table()
    make_user("photo_a", subscription="premium")
    make_user("photo_b", subscription="premium")
    rid = _recipient_id("photo_b")

    client = bodybuilding_app.app.test_client()
    _login(client, "photo_a")
    resp = client.post(
        "/send_photo_message",
        data={
            "recipient_id": rid,
            "message": "look",
            "photo": (io.BytesIO(b"jpg"), "x.jpg"),
        },
        content_type="multipart/form-data",
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["image_path"] == "https://cdn.example/photo.jpg"
    assert mock_save.called


@patch("backend.services.firestore_writes.write_dm_message")
@patch("backend.services.notifications.send_push_to_user")
def test_send_dm_media_requires_media(mock_push, mock_fs, mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _ensure_messages_table()
    make_user("media_a", subscription="premium")
    make_user("media_b", subscription="premium")
    rid = _recipient_id("media_b")

    client = bodybuilding_app.app.test_client()
    _login(client, "media_a")
    resp = client.post("/send_dm_media", data={"recipient_id": rid})
    assert resp.status_code == 400
    assert resp.get_json()["success"] is False


@patch("backend.services.firestore_writes.write_dm_message")
@patch("backend.services.notifications.send_push_to_user")
@patch("backend.services.dm_send_media.save_uploaded_file", return_value="https://cdn.example/a.jpg")
def test_send_dm_grouped_media_upload_only(mock_save, mock_push, mock_fs, mysql_dsn):
    _ensure_messages_table()
    make_user("grp_a", subscription="premium")
    make_user("grp_b", subscription="premium")
    rid = _recipient_id("grp_b")

    payload, status = send_dm_grouped_media(
        "grp_a",
        recipient_id=rid,
        media_files=[("photo", _FakeFile("a.jpg"))],
        upload_only=True,
    )
    assert status == 200
    assert payload["success"] is True
    assert payload["media_paths"] == ["https://cdn.example/a.jpg"]

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT COUNT(*) AS cnt FROM messages WHERE sender = {ph}", ("grp_a",))
        row = c.fetchone()
        cnt = row["cnt"] if hasattr(row, "keys") else row[0]
        assert cnt == 0


@patch("backend.services.firestore_writes.write_dm_message")
@patch("backend.services.notifications.send_push_to_user")
@patch("backend.services.dm_send_media.save_uploaded_file", return_value="https://cdn.example/p.jpg")
def test_send_photo_message_service(mock_save, mock_push, mock_fs, mysql_dsn):
    _ensure_messages_table()
    make_user("ph_a", subscription="premium")
    make_user("ph_b", subscription="premium")

    payload = send_dm_photo_message(
        "ph_a",
        recipient_id=_recipient_id("ph_b"),
        message="pic",
        photo=_FakeFile("pic.jpg"),
    )
    assert payload["success"] is True
    assert payload["image_path"] == "https://cdn.example/p.jpg"
