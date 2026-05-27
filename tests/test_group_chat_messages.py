"""Tests for group chat message read service."""

from __future__ import annotations

from datetime import datetime

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.group_chat_messages import fetch_group_messages
from tests.fixtures import make_user


def _ensure_group_tables() -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        if USE_MYSQL:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS group_chats (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    name VARCHAR(100) NOT NULL,
                    creator_username VARCHAR(100) NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS group_chat_members (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    group_id INT NOT NULL,
                    username VARCHAR(100) NOT NULL,
                    UNIQUE KEY unique_member (group_id, username)
                )
                """
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS group_chat_messages (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    group_id INT NOT NULL,
                    sender_username VARCHAR(100) NOT NULL,
                    message_text TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    is_deleted TINYINT DEFAULT 0
                )
                """
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS group_chat_read_receipts (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    group_id INT NOT NULL,
                    username VARCHAR(100) NOT NULL,
                    last_read_message_id INT DEFAULT 0,
                    last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_receipt (group_id, username)
                )
                """
            )
        now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        c.execute(
            f"INSERT INTO group_chats (name, creator_username, created_at, updated_at) VALUES ({ph}, {ph}, {ph}, {ph})",
            ("Test Group", "gmem_a", now, now),
        )
        group_id = c.lastrowid
        c.execute(
            f"INSERT INTO group_chat_members (group_id, username) VALUES ({ph}, {ph})",
            (group_id, "gmem_a"),
        )
        c.execute(
            f"""
            INSERT INTO group_chat_messages (group_id, sender_username, message_text, created_at, is_deleted)
            VALUES ({ph}, {ph}, {ph}, {ph}, 0)
            """,
            (group_id, "gmem_a", "group hello", now),
        )
        conn.commit()
        return group_id


def test_fetch_group_messages_denies_non_member(mysql_dsn):
    make_user("gmem_a", subscription="premium")
    make_user("gmem_out", subscription="premium")
    group_id = _ensure_group_tables()

    payload, status = fetch_group_messages("gmem_out", group_id)
    assert status == 403
    assert payload["success"] is False


def test_fetch_group_messages_returns_member_messages(mysql_dsn):
    make_user("gmem_a", subscription="premium")
    group_id = _ensure_group_tables()

    payload, status = fetch_group_messages("gmem_a", group_id)
    assert status == 200
    assert payload["success"] is True
    assert len(payload["messages"]) >= 1
    assert payload["messages"][0]["text"] == "group hello"


def test_get_group_messages_route(mysql_dsn):
    import bodybuilding_app

    make_user("gmem_a", subscription="premium")
    group_id = _ensure_group_tables()

    client = bodybuilding_app.app.test_client()
    with client.session_transaction() as sess:
        sess["username"] = "gmem_a"

    resp = client.get(f"/api/group_chat/{group_id}/messages")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert any(m.get("text") == "group hello" for m in body["messages"])
