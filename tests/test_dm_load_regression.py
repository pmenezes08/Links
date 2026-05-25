"""Regression tests for DM thread load (Steve lookup + Firestore/MySQL dual-read)."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import patch

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
        try:
            conn.commit()
        except Exception:
            pass


def _user_id(username: str) -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        assert row
        return row["id"] if hasattr(row, "keys") else row[0]


def test_steve_username_lookup_allowed_without_shared_community(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    make_user("dm_viewer", subscription="premium")
    make_user("steve", subscription="free")

    client = bodybuilding_app.app.test_client()
    _login(client, "dm_viewer")

    resp = client.post("/api/get_user_id_by_username", data={"username": "steve"})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["user_id"] == _user_id("steve")

    brief = client.get("/api/get_user_profile_brief?username=steve")
    assert brief.status_code == 200
    assert brief.get_json()["success"] is True


def test_get_messages_falls_back_to_mysql_when_firestore_empty(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _ensure_messages_table()
    make_user("dm_self", subscription="premium")
    _insert_dm("dm_self", "dm_self", "saved note in mysql")

    client = bodybuilding_app.app.test_client()
    _login(client, "dm_self")
    other_id = _user_id("dm_self")

    with patch("backend.services.firestore_reads.USE_FIRESTORE_READS", True):
        with patch(
            "backend.services.firestore_reads.get_dm_messages",
            return_value=([], False, False),
        ):
            resp = client.post("/get_messages", data={"other_user_id": str(other_id)})

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    texts = [m.get("text") for m in body.get("messages") or []]
    assert "saved note in mysql" in texts
