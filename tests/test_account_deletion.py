"""MySQL integration: account_deletion service removes users blocked by typing_status FK."""

from __future__ import annotations

import pytest

from backend.services import account_deletion as account_deletion_service
from backend.services.account_deletion import (
    AccountDeletionMode,
    delete_firestore_user_state,
    delete_user_in_connection,
)
from backend.services.database import get_db_connection, get_sql_placeholder


class _FakeDocument:
    def __init__(self, collection_name, username, calls):
        self.collection_name = collection_name
        self.username = username
        self.calls = calls

    def delete(self):
        self.calls.append((self.collection_name, self.username))


class _FakeCollection:
    def __init__(self, name, calls):
        self.name = name
        self.calls = calls

    def document(self, username):
        return _FakeDocument(self.name, username, self.calls)


class _FakeFirestore:
    def __init__(self):
        self.calls = []

    def collection(self, name):
        return _FakeCollection(name, self.calls)


def test_delete_firestore_user_state_removes_onboarding_and_profile_docs():
    db = _FakeFirestore()

    deleted = delete_firestore_user_state("deleted_user", db=db)

    assert deleted == 2
    assert db.calls == [
        ("steve_onboarding", "deleted_user"),
        ("steve_user_profiles", "deleted_user"),
    ]


class _FakeCursor:
    def __init__(self):
        self.fetchone_called = False

    def execute(self, sql, params=()):
        return None

    def fetchone(self):
        if self.fetchone_called:
            return None
        self.fetchone_called = True
        return {"id": 123}

    def fetchall(self):
        return []


class _FakeConnection:
    def __init__(self):
        self.cursor_obj = _FakeCursor()

    def cursor(self):
        return self.cursor_obj


def test_delete_user_in_connection_attempts_firestore_state_cleanup(monkeypatch):
    calls = []
    monkeypatch.setattr(
        account_deletion_service,
        "delete_firestore_user_state",
        lambda username: calls.append(username) or 2,
    )

    delete_user_in_connection(_FakeConnection(), "deleted_user", AccountDeletionMode.SELF_SERVICE)

    assert calls == ["deleted_user"]


@pytest.fixture()
def needs_mysql(mysql_dsn):
    """Dependency ensures Docker MySQL is up (mysql_dsn skips if not)."""
    return mysql_dsn


def test_delete_user_removes_typing_status_fk(needs_mysql):
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        uname = "acct_del_typing_test"
        try:
            c.execute(f"DELETE FROM typing_status WHERE user={ph} OR peer={ph}", (uname, uname))
            c.execute(f"DELETE FROM users WHERE username={ph}", (uname,))
            conn.commit()
        except Exception:
            pass

        c.execute(
            """
            CREATE TABLE IF NOT EXISTS typing_status (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user VARCHAR(191) NOT NULL,
                peer VARCHAR(191) NOT NULL,
                is_typing TINYINT DEFAULT 0,
                updated_at VARCHAR(64) NOT NULL,
                UNIQUE KEY uq_typing (user, peer),
                CONSTRAINT fk_typing_user_test FOREIGN KEY (user) REFERENCES users (username)
            )
            """
        )
        conn.commit()

        c.execute(
            f"""
            INSERT INTO users (username, email, subscription)
            VALUES ({ph}, {ph}, 'free')
            """,
            (uname, f"{uname}@example.invalid"),
        )
        c.execute(
            f"""
            INSERT INTO typing_status (`user`, peer, is_typing, updated_at)
            VALUES ({ph}, {ph}, 0, '2026-01-01')
            """,
            (uname, "peer_u"),
        )
        conn.commit()

    with get_db_connection() as conn2:
        delete_user_in_connection(conn2, uname, AccountDeletionMode.SELF_SERVICE)
        conn2.commit()

    with get_db_connection() as conn3:
        c3 = conn3.cursor()
        c3.execute(f"SELECT id FROM users WHERE username={get_sql_placeholder()}", (uname,))
        assert c3.fetchone() is None
