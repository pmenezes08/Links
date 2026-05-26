"""Tests for chat PDF document send service and blueprint routes."""

from __future__ import annotations

import io
from datetime import datetime
from unittest.mock import MagicMock, patch

from backend.services.chat_document_send import (
    MAX_CHAT_PDF_BYTES,
    display_file_name,
    send_dm_pdf,
    send_group_pdf,
    validate_chat_pdf,
)
from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.dm_chats_tables import ensure_messages_document_columns
from tests.fixtures import make_user


def _pdf_file(name: str = "report.pdf", content: bytes = b"%PDF-1.4 test") -> MagicMock:
    f = MagicMock()
    f.filename = name
    f.mimetype = "application/pdf"
    f.content_length = len(content)
    f.stream = io.BytesIO(content)
    f.seek = f.stream.seek
    return f


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _ensure_messages_table(cursor) -> None:
    if USE_MYSQL:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INT PRIMARY KEY AUTO_INCREMENT,
                sender VARCHAR(191) NOT NULL,
                receiver VARCHAR(191) NOT NULL,
                message TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_read TINYINT(1) DEFAULT 0,
                file_path TEXT,
                file_name VARCHAR(255)
            )
            """
        )
    else:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender TEXT NOT NULL,
                receiver TEXT NOT NULL,
                message TEXT,
                timestamp TEXT,
                is_read INTEGER DEFAULT 0,
                file_path TEXT,
                file_name TEXT
            )
            """
        )


def test_validate_chat_pdf_accepts_pdf():
    ok, err = validate_chat_pdf(_pdf_file())
    assert ok is True
    assert err is None


def test_validate_chat_pdf_rejects_non_pdf():
    f = _pdf_file("notes.txt", b"hello")
    f.mimetype = "text/plain"
    ok, err = validate_chat_pdf(f)
    assert ok is False
    assert "PDF" in (err or "")


def test_validate_chat_pdf_rejects_oversize():
    f = _pdf_file(content=b"x" * (MAX_CHAT_PDF_BYTES + 1))
    ok, err = validate_chat_pdf(f)
    assert ok is False
    assert "large" in (err or "").lower()


def test_display_file_name_preserves_pdf_suffix():
    assert display_file_name(_pdf_file("Quarterly Plan.pdf")).endswith(".pdf")


@patch("backend.services.firestore_writes.write_dm_message")
@patch("backend.services.chat_document_send.store_chat_pdf", return_value="message_documents/doc.pdf")
def test_send_dm_pdf_inserts_message(mock_store, mock_write, mysql_dsn):
    make_user("doc_sender", subscription="premium")
    make_user("doc_recv", subscription="premium")
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        _ensure_messages_table(c)
        ensure_messages_document_columns(c)
        c.execute(f"SELECT id FROM users WHERE username = {ph}", ("doc_recv",))
        row = c.fetchone()
        recipient_id = row["id"] if hasattr(row, "keys") else row[0]

    with get_db_connection() as conn:
        c = conn.cursor()
        ok, payload, status = send_dm_pdf(
            conn,
            c,
            sender="doc_sender",
            recipient_id=str(recipient_id),
            file_storage=_pdf_file(),
            caption="See attached",
        )
        assert ok is True
        assert status == 200
        assert payload["success"] is True
        assert payload["file_name"].endswith(".pdf")
        assert mock_store.called
        assert mock_write.called


@patch("backend.services.firestore_writes.write_group_chat_message")
@patch("backend.services.chat_document_send.store_chat_pdf", return_value="message_documents/group.pdf")
def test_send_group_pdf_requires_membership(mock_write, mock_store, mysql_dsn):
    make_user("grp_doc_sender", subscription="premium")
    make_user("grp_doc_other", subscription="premium")
    ph = get_sql_placeholder()

    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute("SELECT 1 FROM group_chats LIMIT 1")
        except Exception:
            if USE_MYSQL:
                cursor = c
                cursor.execute(
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
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS group_chat_members (
                        id INT PRIMARY KEY AUTO_INCREMENT,
                        group_id INT NOT NULL,
                        username VARCHAR(100) NOT NULL,
                        UNIQUE KEY unique_member (group_id, username)
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS group_chat_messages (
                        id INT PRIMARY KEY AUTO_INCREMENT,
                        group_id INT NOT NULL,
                        sender_username VARCHAR(100) NOT NULL,
                        message_text TEXT,
                        file_path TEXT,
                        file_name VARCHAR(255),
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        is_deleted TINYINT DEFAULT 0
                    )
                    """
                )
                cursor.execute(
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
            conn.commit()

        now = datetime.utcnow().isoformat()
        c.execute(
            f"INSERT INTO group_chats (name, creator_username, created_at, updated_at) VALUES ({ph}, {ph}, {ph}, {ph})",
            ("Doc Group", "grp_doc_sender", now, now),
        )
        group_id = c.lastrowid
        c.execute(
            f"INSERT INTO group_chat_members (group_id, username) VALUES ({ph}, {ph})",
            (group_id, "grp_doc_sender"),
        )
        conn.commit()

        ok, payload, status = send_group_pdf(
            conn,
            c,
            sender="grp_doc_other",
            group_id=group_id,
            file_storage=_pdf_file(),
        )
        assert ok is False
        assert status == 403

        ok, payload, status = send_group_pdf(
            conn,
            c,
            sender="grp_doc_sender",
            group_id=group_id,
            file_storage=_pdf_file(),
        )
        assert ok is True
        assert status == 200
        assert payload["message"]["file_name"].endswith(".pdf")
        assert mock_write.called


def test_dm_send_document_route(mysql_dsn):
    import bodybuilding_app

    make_user("route_sender", subscription="premium")
    make_user("route_recv", subscription="premium")
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        _ensure_messages_table(c)
        ensure_messages_document_columns(c)
        c.execute(f"SELECT id FROM users WHERE username = {ph}", ("route_recv",))
        row = c.fetchone()
        recipient_id = row["id"] if hasattr(row, "keys") else row[0]
        conn.commit()

    client = bodybuilding_app.app.test_client()
    _login(client, "route_sender")

    data = {
        "recipient_id": str(recipient_id),
        "document": (io.BytesIO(b"%PDF-1.4 route test"), "brief.pdf"),
    }
    with patch("backend.services.chat_document_send.store_chat_pdf", return_value="message_documents/brief.pdf"):
        resp = client.post(
            "/api/chat/dm/send_document",
            data=data,
            content_type="multipart/form-data",
        )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["file_name"] == "brief.pdf"
