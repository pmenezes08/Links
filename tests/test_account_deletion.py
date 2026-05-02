"""MySQL integration: account_deletion service removes users blocked by typing_status FK."""

from __future__ import annotations

import pytest

from backend.services.account_deletion import AccountDeletionMode, delete_user_in_connection
from backend.services.database import get_db_connection, get_sql_placeholder


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
