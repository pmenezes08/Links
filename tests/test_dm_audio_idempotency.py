"""Idempotency for ``send_dm_audio_message``.

A retry with the same ``client_key`` must return the original voice note instead of
saving the file again and inserting a duplicate row — parity with DM text/media sends.
The idempotency check runs before ``save_uploaded_file``/AI summary, so a lightweight
fake audio object is enough to exercise it.
"""

from __future__ import annotations

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.dm_send_media import send_dm_audio_message
from tests.fixtures import make_user


class _FakeAudio:
    filename = "voice.webm"
    mimetype = "audio/webm"


def _ensure_messages_table() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        if USE_MYSQL:
            c.execute(
                """CREATE TABLE IF NOT EXISTS messages (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    sender VARCHAR(191),
                    receiver VARCHAR(191),
                    message TEXT,
                    audio_path VARCHAR(512),
                    audio_duration_seconds INT NULL,
                    audio_mime VARCHAR(64),
                    audio_summary TEXT,
                    client_key VARCHAR(191),
                    is_read TINYINT(1) DEFAULT 0,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                )"""
            )
        conn.commit()


def test_send_audio_message_is_idempotent_on_client_key(mysql_dsn):
    _ensure_messages_table()
    make_user("aud_sender")
    make_user("aud_recipient")

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", ("aud_recipient",))
        row = c.fetchone()
        recipient_id = row["id"] if hasattr(row, "keys") else row[0]

        # A first (successful) send already landed this voice note.
        c.execute(
            f"INSERT INTO messages (sender, receiver, message, audio_path, audio_mime, client_key) "
            f"VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph})",
            ("aud_sender", "aud_recipient", "", "voice_messages/a.webm", "audio/webm", "aud_ck_1"),
        )
        conn.commit()

    # The retry must return the original row, not insert a second one.
    payload = send_dm_audio_message(
        "aud_sender",
        recipient_id=recipient_id,
        audio=_FakeAudio(),
        duration_seconds=3,
        client_key="aud_ck_1",
    )
    assert payload["success"] is True
    assert payload["audio_path"] == "voice_messages/a.webm"

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"SELECT COUNT(*) AS cnt FROM messages WHERE client_key = {ph} AND sender = {ph}",
            ("aud_ck_1", "aud_sender"),
        )
        row = c.fetchone()
        cnt = row["cnt"] if hasattr(row, "keys") else row[0]
        assert cnt == 1  # no duplicate voice note inserted
