"""Regression tests for the group-chat message-read membership gate (privacy IDOR).

The vulnerability: ``fetch_group_messages`` read the Firestore branch
(``USE_FIRESTORE_READS``, default ``'true'`` in prod) WITHOUT a membership
check, so any authenticated user could read another group's full message history
by enumerating ``group_id``. The MySQL fallback branch was gated, but the test
environment has no Firestore client, so a naive non-member test falls through to
the gated MySQL branch and passes even against the vulnerable code (a false
green).

These tests force ``USE_FIRESTORE_READS=True`` and assert on whether the
Firestore reader (``get_group_chat_messages``) is reached, so they actually
exercise the formerly-ungated path. The gate sits at the top of the function,
before either branch, so it is backend-agnostic.
"""

from __future__ import annotations

from datetime import datetime

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.group_chat_messages import fetch_group_messages
from tests.fixtures import make_user


def _ensure_group_chat_schema(c) -> None:
    if not USE_MYSQL:
        return
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


def _create_group(member_username: str, *, name: str = "Gate Test Group") -> int:
    """Create a group whose only member is ``member_username`` (stored verbatim)."""
    ph = get_sql_placeholder()
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        _ensure_group_chat_schema(c)
        c.execute(
            f"INSERT INTO group_chats (name, creator_username, created_at, updated_at) "
            f"VALUES ({ph}, {ph}, {ph}, {ph})",
            (name, member_username, now, now),
        )
        group_id = c.lastrowid
        c.execute(
            f"INSERT INTO group_chat_members (group_id, username) VALUES ({ph}, {ph})",
            (group_id, member_username),
        )
        c.execute(
            f"INSERT INTO group_chat_messages "
            f"(group_id, sender_username, message_text, created_at, is_deleted) "
            f"VALUES ({ph}, {ph}, {ph}, {ph}, 0)",
            (group_id, member_username, "secret group content", now),
        )
        conn.commit()
        return group_id


def _force_firestore(monkeypatch) -> None:
    """Turn the Firestore read branch ON regardless of environment default."""
    monkeypatch.setattr("backend.services.firestore_reads.USE_FIRESTORE_READS", True)


def _arm_reader_must_not_be_called(monkeypatch) -> dict:
    """Replace the Firestore reader so any invocation fails the test."""
    calls = {"count": 0}

    def _boom(*args, **kwargs):
        calls["count"] += 1
        raise AssertionError(
            "get_group_chat_messages (Firestore read) was reached — the "
            "membership gate failed to block the read before the backend call"
        )

    monkeypatch.setattr(
        "backend.services.firestore_reads.get_group_chat_messages", _boom
    )
    return calls


def test_non_member_blocked_before_firestore_read(mysql_dsn, monkeypatch):
    """Non-member -> 403, and the Firestore reader is NEVER invoked.

    Forces the formerly-ungated Firestore path live and arms the reader to fail
    if reached. This is the test that actually locks the IDOR fix; the legacy
    non-member test passes even on vulnerable code because the test env lacks a
    Firestore client and silently falls back to the gated MySQL branch.
    """
    make_user("gate_member", subscription="premium")
    make_user("gate_outsider", subscription="premium")
    group_id = _create_group("gate_member")

    _force_firestore(monkeypatch)
    calls = _arm_reader_must_not_be_called(monkeypatch)

    payload, status = fetch_group_messages("gate_outsider", group_id)

    assert status == 403
    assert payload["success"] is False
    assert calls["count"] == 0  # reader never reached: the gate ran first


def test_member_passes_gate_on_firestore_path(mysql_dsn, monkeypatch):
    """Member -> 200 and the Firestore reader IS reached (gate allows members)."""
    make_user("gate_member", subscription="premium")
    group_id = _create_group("gate_member")

    _force_firestore(monkeypatch)

    seen = {"called": False}

    def _fake_reader(group_id_arg, username_arg, **kwargs):
        seen["called"] = True
        return [
            {
                "id": 4242,
                "sender": "gate_member",
                "text": "from firestore",
                "created_at": "2026-01-01T00:00:00",
            }
        ]

    monkeypatch.setattr(
        "backend.services.firestore_reads.get_group_chat_messages", _fake_reader
    )
    # Decouple from post-read enrichment internals so the assertion is about the
    # gate, not the hydration helpers.
    monkeypatch.setattr(
        "backend.blueprints.group_chat._enrich_group_message_profile_pictures",
        lambda messages: messages,
    )
    monkeypatch.setattr(
        "backend.blueprints.group_chat._merge_user_group_message_reactions",
        lambda cursor, messages, username, ph: None,
    )
    monkeypatch.setattr(
        "backend.services.chat_message_document_merge.enrich_messages_with_mysql_documents",
        lambda cursor, messages, **kwargs: messages,
    )

    payload, status = fetch_group_messages("gate_member", group_id)

    assert status == 200
    assert payload["success"] is True
    assert seen["called"] is True  # member was allowed through to the Firestore read
    assert any(m.get("text") == "from firestore" for m in payload["messages"])


def test_mixed_case_member_is_allowed(mysql_dsn):
    """Membership match is case-insensitive: a member stored with different
    casing than the session username must not be false-denied (LOWER on both
    sides). Membership rows are inserted verbatim, so this is a real case."""
    make_user("gate_mixed", subscription="premium")
    group_id = _create_group("Gate_Mixed")  # stored mixed-case, session is lower

    payload, status = fetch_group_messages("gate_mixed", group_id)

    assert status == 200
    assert payload["success"] is True


def test_gate_failure_fails_closed(mysql_dsn, monkeypatch):
    """If the membership gate query errors, fail CLOSED (500) and never read."""
    make_user("gate_member", subscription="premium")
    group_id = _create_group("gate_member")  # created before the DB is broken

    _force_firestore(monkeypatch)
    calls = _arm_reader_must_not_be_called(monkeypatch)

    def _broken_conn(*args, **kwargs):
        raise RuntimeError("simulated DB outage during membership gate")

    # The gate is the first DB access in the function, so this breaks it first.
    monkeypatch.setattr(
        "backend.services.group_chat_messages.get_db_connection", _broken_conn
    )

    payload, status = fetch_group_messages("gate_member", group_id)

    assert status == 500
    assert payload["success"] is False
    assert calls["count"] == 0  # no read attempted when authz cannot be verified
