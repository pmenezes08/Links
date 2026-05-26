"""Tests for DM message reactions (blueprint + service)."""

from __future__ import annotations

from datetime import datetime

from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_user


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _ensure_messages_with_reactions() -> None:
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
                reaction VARCHAR(32) NULL,
                reaction_by VARCHAR(191) NULL
            )
            """
        )
        for col, ddl in (
            ("reaction", "ALTER TABLE messages ADD COLUMN reaction VARCHAR(32) NULL"),
            ("reaction_by", "ALTER TABLE messages ADD COLUMN reaction_by VARCHAR(191) NULL"),
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


def _insert_dm(sender: str, receiver: str, text: str) -> int:
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
        c.execute("SELECT LAST_INSERT_ID() AS id")
        row = c.fetchone()
        return row["id"] if hasattr(row, "keys") else row[0]


def _user_id(username: str) -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        assert row
        return row["id"] if hasattr(row, "keys") else row[0]


def test_peer_can_react_to_dm_message(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _ensure_messages_with_reactions()
    make_user("alice", subscription="premium")
    make_user("bob", subscription="premium")
    msg_id = _insert_dm("alice", "bob", "hello there")

    client = bodybuilding_app.app.test_client()
    _login(client, "bob")
    resp = client.post(
        "/api/chat/react_to_message",
        json={"message_id": msg_id, "emoji": "👍"},
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["reaction"] == "👍"
    assert body["reaction_by"] == "bob"


def test_unauthorized_user_cannot_react(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _ensure_messages_with_reactions()
    make_user("alice", subscription="premium")
    make_user("bob", subscription="premium")
    make_user("carol", subscription="premium")
    msg_id = _insert_dm("alice", "bob", "private")

    client = bodybuilding_app.app.test_client()
    _login(client, "carol")
    resp = client.post(
        "/api/chat/react_to_message",
        json={"message_id": msg_id, "emoji": "👍"},
    )
    assert resp.status_code == 403
    assert resp.get_json()["success"] is False
