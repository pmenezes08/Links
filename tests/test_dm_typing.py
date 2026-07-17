"""Tests for ``backend.services.dm_typing`` — the /get_messages typing piggyback.

``peer_is_typing_for_viewer`` resolves the peer by ``users.id`` and reads the
``typing_status`` row (peer → viewer) with the same 5s freshness window as the
monolith ``GET /api/typing``. It must never raise: typing is auxiliary UX on
the message-poll hot path.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.dm_typing import (
    TYPING_TTL_SECONDS,
    _typing_row_is_fresh,
    peer_is_typing_for_viewer,
)
from tests.fixtures import make_user


@pytest.fixture()
def needs_mysql(mysql_dsn):
    """Dependency ensures Docker MySQL is up (mysql_dsn skips if not)."""
    return mysql_dsn


def _fmt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _user_id(username: str) -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        return row["id"] if hasattr(row, "keys") else row[0]


def _ensure_typing_table() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """CREATE TABLE IF NOT EXISTS typing_status (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user VARCHAR(191) NOT NULL,
                peer VARCHAR(191) NOT NULL,
                is_typing INT DEFAULT 0,
                updated_at TEXT NOT NULL,
                UNIQUE KEY unique_typing (user, peer)
            )"""
        )
        conn.commit()


def _set_typing(user: str, peer: str, is_typing: int, updated_at: datetime) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO typing_status (user, peer, is_typing, updated_at)
            VALUES ({ph}, {ph}, {ph}, {ph})
            ON DUPLICATE KEY UPDATE is_typing = VALUES(is_typing), updated_at = VALUES(updated_at)
            """,
            (user, peer, is_typing, _fmt(updated_at)),
        )
        conn.commit()


# ── Pure freshness logic ─────────────────────────────────────────────────


def test_fresh_row_within_ttl_is_typing():
    assert _typing_row_is_fresh(1, _fmt(datetime.now())) is True


def test_row_older_than_ttl_is_not_typing():
    stale = datetime.now() - timedelta(seconds=TYPING_TTL_SECONDS + 2)
    assert _typing_row_is_fresh(1, _fmt(stale)) is False


def test_not_typing_flag_wins_even_when_fresh():
    assert _typing_row_is_fresh(0, _fmt(datetime.now())) is False


def test_datetime_and_iso_updated_at_both_parse():
    now = datetime.now()
    assert _typing_row_is_fresh(1, now) is True
    assert _typing_row_is_fresh(1, now.isoformat(sep="T", timespec="seconds")) is True


def test_garbage_updated_at_is_not_typing():
    assert _typing_row_is_fresh(1, "not-a-date") is False
    assert _typing_row_is_fresh(1, None) is False


# ── DB-backed resolution ─────────────────────────────────────────────────


def test_peer_typing_resolved_by_user_id(needs_mysql):
    _ensure_typing_table()
    make_user("typing_viewer")
    make_user("typing_peer")
    peer_id = _user_id("typing_peer")
    _set_typing("typing_peer", "typing_viewer", 1, datetime.now())

    assert peer_is_typing_for_viewer("typing_viewer", peer_id) is True


def test_peer_typing_stale_or_absent_is_false(needs_mysql):
    _ensure_typing_table()
    make_user("typing_viewer2")
    make_user("typing_peer2")
    peer_id = _user_id("typing_peer2")

    # No row at all.
    assert peer_is_typing_for_viewer("typing_viewer2", peer_id) is False

    # Stale row.
    stale = datetime.now() - timedelta(seconds=TYPING_TTL_SECONDS + 3)
    _set_typing("typing_peer2", "typing_viewer2", 1, stale)
    assert peer_is_typing_for_viewer("typing_viewer2", peer_id) is False


def test_unknown_user_id_and_empty_inputs_are_false(needs_mysql):
    _ensure_typing_table()
    assert peer_is_typing_for_viewer("whoever", 99999999) is False
    assert peer_is_typing_for_viewer("", 1) is False
    assert peer_is_typing_for_viewer("whoever", None) is False
