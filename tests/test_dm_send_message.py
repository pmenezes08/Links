"""Tests for DM text send endpoint and service."""

from __future__ import annotations

from unittest.mock import patch

from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.dm_send_message import send_dm_text_message
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
                client_key VARCHAR(191) NULL,
                encrypted_body TEXT NULL,
                encrypted_body_for_sender TEXT NULL
            )
            """
        )
        for col, ddl in (
            ("client_key", "ALTER TABLE messages ADD COLUMN client_key VARCHAR(191) NULL"),
            ("encrypted_body", "ALTER TABLE messages ADD COLUMN encrypted_body TEXT NULL"),
            ("encrypted_body_for_sender", "ALTER TABLE messages ADD COLUMN encrypted_body_for_sender TEXT NULL"),
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


def _recipient_id(username: str) -> str:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        return str(row["id"] if hasattr(row, "keys") else row[0])


@patch("backend.services.firestore_writes.write_dm_message")
@patch("backend.services.notifications.send_push_to_user")
def test_send_message_requires_recipient(mock_push, mock_fs, mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _ensure_messages_table()
    make_user("snd_a", subscription="premium")

    client = bodybuilding_app.app.test_client()
    _login(client, "snd_a")
    resp = client.post("/send_message", data={"message": "hi"})
    assert resp.status_code == 200
    assert resp.get_json()["success"] is False
    assert resp.get_json()["error"] == "Recipient required"


@patch("backend.services.firestore_writes.write_dm_message")
@patch("backend.services.notifications.send_push_to_user")
def test_send_message_inserts_row(mock_push, mock_fs, mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _ensure_messages_table()
    make_user("snd_b", subscription="premium")
    make_user("snd_c", subscription="premium")
    rid = _recipient_id("snd_c")

    client = bodybuilding_app.app.test_client()
    _login(client, "snd_b")
    resp = client.post(
        "/send_message",
        data={"recipient_id": rid, "message": "hello there"},
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body.get("message_id")

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT message FROM messages WHERE sender = {ph} AND receiver = {ph}",
            ("snd_b", "snd_c"),
        )
        row = c.fetchone()
        assert row is not None
        text = row["message"] if hasattr(row, "keys") else row[0]
        assert text == "hello there"
    assert mock_fs.called


@patch("backend.services.firestore_writes.write_dm_message")
@patch("backend.services.notifications.send_push_to_user")
def test_send_dm_text_message_service_validation(mock_push, mock_fs, mysql_dsn):
    _ensure_messages_table()
    make_user("svc_a", subscription="premium")
    make_user("svc_b", subscription="premium")

    payload = send_dm_text_message("svc_a", recipient_id=None, message="x")
    assert payload["success"] is False

    payload = send_dm_text_message("svc_a", recipient_id=_recipient_id("svc_b"), message="")
    assert payload["success"] is False
    assert payload["error"] == "Message required"
