"""Tests for user_activity_tables (ensure + visit recording)."""

import sqlite3
from unittest.mock import patch

from backend.services.user_activity_tables import (
    ensure_user_activity_tables,
    record_community_feed_visit,
)


def _base_conn():
    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(
        """
        CREATE TABLE users (username TEXT PRIMARY KEY);
        CREATE TABLE communities (id INTEGER PRIMARY KEY, name TEXT);
        """
    )
    conn.execute("INSERT INTO users VALUES ('u1')")
    conn.execute("INSERT INTO communities VALUES (1, 'c1')")
    conn.commit()
    return conn


def test_ensure_user_activity_tables_idempotent():
    conn = _base_conn()
    ensure_user_activity_tables(conn)
    ensure_user_activity_tables(conn)
    cur = conn.cursor()
    cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='community_visit_history'"
    )
    assert cur.fetchone() is not None


def test_record_community_feed_visit_inserts_row():
    conn = _base_conn()
    ensure_user_activity_tables(conn)
    record_community_feed_visit(conn, "u1", 1)
    cur = conn.cursor()
    cur.execute("SELECT username, community_id FROM community_visit_history")
    row = cur.fetchone()
    assert row == ("u1", 1)


def test_record_community_feed_visit_insert_first_does_not_call_ensure_when_table_exists():
    conn = _base_conn()
    ensure_user_activity_tables(conn)
    with patch(
        "backend.services.user_activity_tables.ensure_user_activity_tables"
    ) as mock_ensure:
        record_community_feed_visit(conn, "u1", 1)
        mock_ensure.assert_not_called()


def test_record_repairs_missing_visit_table():
    conn = _base_conn()
    cur = conn.cursor()
    cur.execute("DROP TABLE IF EXISTS community_visit_history")
    cur.execute("DROP TABLE IF EXISTS user_login_history")
    conn.commit()
    record_community_feed_visit(conn, "u1", 1)
    cur.execute("SELECT COUNT(*) FROM community_visit_history")
    assert cur.fetchone()[0] == 1
