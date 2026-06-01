"""Tests for resumable chat media upload sessions."""

from __future__ import annotations

import pytest

from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_user


@pytest.fixture
def chat_upload_tables(mysql_dsn):
    from backend.services import chat_uploads

    chat_uploads.ensure_tables()
    yield
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM chat_upload_sessions")
        conn.commit()


def test_ensure_tables_idempotent(chat_upload_tables):
    from backend.services import chat_uploads

    chat_uploads.ensure_tables()
    chat_uploads.ensure_tables()


def test_init_rejects_oversized_file(chat_upload_tables, mysql_dsn, monkeypatch):
    from backend.services import chat_uploads

    monkeypatch.setattr(chat_uploads, "R2_ENABLED", True)
    monkeypatch.setattr(chat_uploads, "R2_PUBLIC_URL", "https://cdn.example.test")
    monkeypatch.setattr(chat_uploads, "create_multipart_upload", lambda *a, **k: "upload-id")

    make_user("upload_alice", subscription="premium")
    make_user("upload_bob", subscription="premium")
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT id FROM users WHERE username = {ph}", ("upload_bob",))
        row = cur.fetchone()
        bob_id = row["id"] if hasattr(row, "keys") else row[0]

    payload, status = chat_uploads.init_upload_session(
        "upload_alice",
        context={"type": "dm", "recipient_id": str(bob_id)},
        filename="big.mp4",
        content_type="video/mp4",
        expected_bytes=900 * 1024 * 1024,
        media_kind="video",
    )
    assert status == 413
    assert payload.get("code") == "upload_size_limit"


def test_init_rejects_unknown_recipient(chat_upload_tables, mysql_dsn, monkeypatch):
    from backend.services import chat_uploads

    monkeypatch.setattr(chat_uploads, "R2_ENABLED", True)
    monkeypatch.setattr(chat_uploads, "R2_PUBLIC_URL", "https://cdn.example.test")
    monkeypatch.setattr(chat_uploads, "create_multipart_upload", lambda *a, **k: "upload-id")

    make_user("upload_carol", subscription="premium")
    payload, status = chat_uploads.init_upload_session(
        "upload_carol",
        context={"type": "dm", "recipient_id": "99999"},
        filename="v.mp4",
        content_type="video/mp4",
        expected_bytes=1024,
        media_kind="video",
    )
    assert status == 404


def test_object_key_naming():
    from backend.services import chat_uploads

    key = chat_uploads._object_key("message_videos", "clip.MP4", "mp4")
    assert key.startswith("message_videos/")
    assert key.endswith(".mp4")


def test_janitor_dry_run(chat_upload_tables, mysql_dsn):
    from backend.services import chat_uploads

    result = chat_uploads.janitor_expired_sessions(limit=10, dry_run=True)
    assert "cleaned" in result
    assert result.get("dry_run") is True


def test_normalize_client_parts_accepts_etags():
    from backend.services import chat_uploads

    parts = chat_uploads._normalize_client_parts(
        [{"part_number": 2, "etag": '"abc"'}, {"part_number": 1, "ETag": "def"}]
    )
    assert parts == [{"PartNumber": 2, "ETag": "abc"}, {"PartNumber": 1, "ETag": "def"}]


def test_normalize_client_parts_skips_missing_etag():
    from backend.services import chat_uploads

    assert chat_uploads._normalize_client_parts([{"part_number": 1}]) == []


def test_resolve_multipart_parts_falls_back_to_r2(monkeypatch):
    from backend.services import chat_uploads

    monkeypatch.setattr(
        chat_uploads,
        "list_multipart_upload_parts",
        lambda key, upload_id: [{"PartNumber": 1, "ETag": "r2-etag"}],
    )
    resolved = chat_uploads._resolve_multipart_parts("k", "u", [{"part_number": 1}])
    assert resolved == [{"PartNumber": 1, "ETag": "r2-etag"}]
