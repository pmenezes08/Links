"""Tests for compute_admin_metrics service."""

import sqlite3
from datetime import datetime

from backend.services.admin_metrics import compute_admin_metrics


def _seed_metrics_db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    c.executescript(
        """
        CREATE TABLE users (username TEXT PRIMARY KEY, subscription TEXT, created_at TEXT);
        CREATE TABLE communities (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE posts (id INTEGER PRIMARY KEY, username TEXT, timestamp TEXT, community_id INT);
        CREATE TABLE reactions (id INTEGER PRIMARY KEY, post_id INT, username TEXT,
          reaction_type TEXT, created_at TEXT);
        CREATE TABLE poll_votes (id INTEGER PRIMARY KEY, poll_id INT, option_id INT,
          username TEXT, voted_at TEXT);
        CREATE TABLE community_visit_history (id INTEGER PRIMARY KEY, username TEXT,
          community_id INT, visit_time TEXT);
        CREATE TABLE messages (id INTEGER PRIMARY KEY, sender TEXT, receiver TEXT,
          message TEXT, timestamp TEXT);
        """
    )
    c.execute(
        "INSERT INTO users VALUES ('alice', 'free', ?)",
        (now,),
    )
    c.execute("INSERT INTO users VALUES ('admin', 'premium', ?)", (now,))
    c.execute("INSERT INTO communities VALUES (1, 'c1')")
    c.execute(
        "INSERT INTO posts VALUES (1, 'alice', ?, 1)",
        (now,),
    )
    conn.commit()
    return conn, c


def test_compute_admin_metrics_contract_and_dau():
    conn, c = _seed_metrics_db()
    stats = compute_admin_metrics(c, "", ())
    assert stats["dau"] >= 1
    assert "mau" in stats
    assert "avg_dau_30" in stats
    assert "leaderboards" in stats
    assert "cohorts" in stats
    conn.close()


def test_compute_admin_metrics_empty_tables_no_crash():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.executescript(
        """
        CREATE TABLE users (username TEXT PRIMARY KEY, subscription TEXT, created_at TEXT);
        CREATE TABLE communities (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE posts (id INTEGER PRIMARY KEY, username TEXT, timestamp TEXT, community_id INT);
        CREATE TABLE reactions (id INTEGER PRIMARY KEY, post_id INT, username TEXT,
          reaction_type TEXT, created_at TEXT);
        CREATE TABLE poll_votes (id INTEGER PRIMARY KEY, poll_id INT, option_id INT,
          username TEXT, voted_at TEXT);
        CREATE TABLE community_visit_history (id INTEGER PRIMARY KEY, username TEXT,
          community_id INT, visit_time TEXT);
        CREATE TABLE messages (id INTEGER PRIMARY KEY, sender TEXT, receiver TEXT,
          message TEXT, timestamp TEXT);
        """
    )
    stats = compute_admin_metrics(c, "", ())
    assert stats["total_users"] == 0
    assert stats["dau"] == 0
    conn.close()
