"""Steve @mention in human DMs must not leak into private steve inbox reads."""

from __future__ import annotations

from datetime import datetime

from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.dm_human_thread import ensure_human_dm_thread_column, human_pair_thread_key
from tests.fixtures import make_user


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _ensure_messages_table() -> None:
    """Create ``messages`` with every column ``fetch_dm_messages`` reads.

    ``CREATE TABLE IF NOT EXISTS`` is a no-op when another suite in the shared
    CI database created the table first, so a bare create here does NOT
    guarantee the media columns exist. ``/get_messages`` selects
    ``image_path``/``video_path``/``audio_path``/... in every branch of its
    fallback chain, so a missing column fails the whole read with
    ``success: False`` rather than degrading. Add each column explicitly.
    """
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
                human_dm_thread VARCHAR(191) NULL
            )
            """
        )
        for col, ddl in (
            ("image_path", "ALTER TABLE messages ADD COLUMN image_path VARCHAR(512) NULL"),
            ("video_path", "ALTER TABLE messages ADD COLUMN video_path VARCHAR(512) NULL"),
            ("audio_path", "ALTER TABLE messages ADD COLUMN audio_path VARCHAR(512) NULL"),
            ("audio_duration_seconds", "ALTER TABLE messages ADD COLUMN audio_duration_seconds INT NULL"),
            ("audio_mime", "ALTER TABLE messages ADD COLUMN audio_mime VARCHAR(100) NULL"),
            ("audio_summary", "ALTER TABLE messages ADD COLUMN audio_summary TEXT NULL"),
            ("media_paths", "ALTER TABLE messages ADD COLUMN media_paths TEXT NULL"),
            ("media_dims", "ALTER TABLE messages ADD COLUMN media_dims TEXT NULL"),
            ("file_path", "ALTER TABLE messages ADD COLUMN file_path VARCHAR(512) NULL"),
            ("file_name", "ALTER TABLE messages ADD COLUMN file_name VARCHAR(255) NULL"),
            ("is_encrypted", "ALTER TABLE messages ADD COLUMN is_encrypted TINYINT(1) DEFAULT 0"),
            ("encrypted_body", "ALTER TABLE messages ADD COLUMN encrypted_body TEXT NULL"),
            ("encrypted_body_for_sender", "ALTER TABLE messages ADD COLUMN encrypted_body_for_sender TEXT NULL"),
            ("edited_at", "ALTER TABLE messages ADD COLUMN edited_at DATETIME NULL"),
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
        ensure_human_dm_thread_column(c)


def _insert_steve_in_human_thread(
    *,
    peer_a: str,
    peer_b: str,
    body: str,
    receiver: str,
) -> None:
    ph = get_sql_placeholder()
    th = human_pair_thread_key(peer_a, peer_b)
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        ensure_human_dm_thread_column(c)
        c.execute(
            f"""
            INSERT INTO messages (sender, receiver, message, timestamp, human_dm_thread)
            VALUES ('steve', {ph}, {ph}, {ph}, {ph})
            """,
            (receiver, body, ts, th),
        )
        try:
            conn.commit()
        except Exception:
            pass


def _insert_private_steve_dm(*, viewer: str, body: str) -> None:
    ph = get_sql_placeholder()
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        ensure_human_dm_thread_column(c)
        c.execute(
            f"""
            INSERT INTO messages (sender, receiver, message, timestamp, human_dm_thread)
            VALUES ('steve', {ph}, {ph}, {ph}, NULL)
            """,
            (viewer, body, ts),
        )
        try:
            conn.commit()
        except Exception:
            pass


def _send_human_dm(*, sender: str, receiver: str, body: str) -> None:
    ph = get_sql_placeholder()
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        ensure_human_dm_thread_column(c)
        c.execute(
            f"""
            INSERT INTO messages (sender, receiver, message, timestamp, human_dm_thread)
            VALUES ({ph}, {ph}, {ph}, {ph}, NULL)
            """,
            (sender, receiver, body, ts),
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


def test_in_thread_steve_not_visible_in_private_steve_chat(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _ensure_messages_table()
    make_user("alice", subscription="premium")
    make_user("bob", subscription="premium")
    make_user("steve", subscription="free")

    _insert_steve_in_human_thread(
        peer_a="alice",
        peer_b="bob",
        body="In-thread @Steve reply for alice-bob",
        receiver="bob",
    )
    _insert_private_steve_dm(viewer="alice", body="Private steve chat only")

    client = bodybuilding_app.app.test_client()
    _login(client, "alice")
    steve_id = _user_id("steve")

    resp = client.post("/get_messages", data={"other_user_id": str(steve_id)})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    texts = [m.get("text") for m in body.get("messages") or []]
    assert "Private steve chat only" in texts
    assert "In-thread @Steve reply for alice-bob" not in texts


def test_in_thread_steve_visible_in_human_peer_dm(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _ensure_messages_table()
    make_user("alice", subscription="premium")
    make_user("bob", subscription="premium")
    make_user("steve", subscription="free")

    _insert_steve_in_human_thread(
        peer_a="alice",
        peer_b="bob",
        body="Visible in alice-bob thread",
        receiver="bob",
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "alice")
    bob_id = _user_id("bob")

    resp = client.post("/get_messages", data={"other_user_id": str(bob_id)})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    texts = [m.get("text") for m in body.get("messages") or []]
    assert "Visible in alice-bob thread" in texts


def test_in_thread_steve_rows_are_flagged_is_steve(mysql_dsn):
    """Steve's bubble inside a human DM must be distinguishable from the peer's.

    The DM payload carries no sender field (``sent`` is just a boolean), so
    without ``is_steve`` the client renders Steve's in-thread reply exactly like
    the human peer's messages and the reader cannot tell who is talking.
    """
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _ensure_messages_table()
    make_user("alice", subscription="premium")
    make_user("bob", subscription="premium")
    make_user("steve", subscription="free")

    _insert_steve_in_human_thread(
        peer_a="alice",
        peer_b="bob",
        body="Steve speaking in the pair thread",
        receiver="alice",
    )
    _send_human_dm(sender="bob", receiver="alice", body="Bob speaking")

    client = bodybuilding_app.app.test_client()
    _login(client, "alice")
    bob_id = _user_id("bob")

    resp = client.post("/get_messages", data={"other_user_id": str(bob_id)})
    assert resp.status_code == 200
    by_text = {m.get("text"): m for m in resp.get_json().get("messages") or []}

    assert by_text["Steve speaking in the pair thread"]["is_steve"] is True
    # A human peer's row must never be flagged — that would badge Bob as Steve.
    assert by_text["Bob speaking"]["is_steve"] is False
