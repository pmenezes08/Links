"""Push token re-activation guard and logout deactivation tests.

Verifies that:
- Unauthenticated register_fcm requests never flip an owned token back to is_active=1
- Authenticated re-register activates tokens normally
- Logout deactivates all push rows for the user
- Legacy push_tokens table is also deactivated on logout
"""

from __future__ import annotations

import pytest

from backend.services.native_push import (
    deactivate_all_push_for_user,
    upsert_fcm_token,
    upsert_native_push_token,
)


@pytest.fixture()
def _require_mysql():
    from backend.services.database import USE_MYSQL

    if not USE_MYSQL:
        pytest.skip("push token tests require the MySQL testcontainer")


@pytest.fixture()
def _ensure_push_tables(_require_mysql):
    """Create push tables if they don't exist yet (they live in the monolith DDL)."""
    from backend.services.database import get_db_connection

    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """CREATE TABLE IF NOT EXISTS fcm_tokens (
                 id INT AUTO_INCREMENT PRIMARY KEY,
                 token VARCHAR(255) UNIQUE NOT NULL,
                 username VARCHAR(100),
                 platform VARCHAR(20) DEFAULT 'ios',
                 device_name VARCHAR(255),
                 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                 last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                 is_active TINYINT(1) DEFAULT 1,
                 INDEX idx_fcm_username (username),
                 INDEX idx_fcm_active (is_active)
             ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS native_push_tokens (
                 id INT AUTO_INCREMENT PRIMARY KEY,
                 token VARCHAR(191) NOT NULL UNIQUE,
                 username VARCHAR(191),
                 install_id VARCHAR(191),
                 platform VARCHAR(50) NOT NULL DEFAULT 'ios',
                 environment VARCHAR(20) NOT NULL DEFAULT 'sandbox',
                 bundle_id VARCHAR(191) NOT NULL DEFAULT 'co.cpoint.app',
                 device_name VARCHAR(191),
                 last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                 is_active TINYINT(1) DEFAULT 1,
                 INDEX idx_native_push_user (username),
                 INDEX idx_native_push_install (install_id)
             ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS push_subscriptions (
                 id INT AUTO_INCREMENT PRIMARY KEY,
                 username VARCHAR(191) NOT NULL,
                 endpoint TEXT NOT NULL,
                 p256dh TEXT,
                 auth TEXT,
                 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                 UNIQUE KEY uq_endpoint (endpoint(191))
             ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS push_tokens (
                 id INT AUTO_INCREMENT PRIMARY KEY,
                 username VARCHAR(191) NOT NULL,
                 token VARCHAR(255) NOT NULL,
                 platform VARCHAR(20) DEFAULT 'ios',
                 is_active TINYINT(1) DEFAULT 1,
                 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                 UNIQUE KEY uq_user_platform (username, platform)
             ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"""
        )
        conn.commit()


def _get_fcm_row(token: str):
    from backend.services.database import get_db_connection

    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute("SELECT username, is_active FROM fcm_tokens WHERE token = %s", (token,))
        row = c.fetchone()
    if row is None:
        return None
    return {
        "username": row["username"] if hasattr(row, "keys") else row[0],
        "is_active": row["is_active"] if hasattr(row, "keys") else row[1],
    }


def _get_native_row(token: str):
    from backend.services.database import get_db_connection

    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute("SELECT username, is_active FROM native_push_tokens WHERE token = %s", (token,))
        row = c.fetchone()
    if row is None:
        return None
    return {
        "username": row["username"] if hasattr(row, "keys") else row[0],
        "is_active": row["is_active"] if hasattr(row, "keys") else row[1],
    }


# ── upsert_fcm_token guard ──────────────────────────────────────────────


class TestUpsertFcmTokenGuard:
    """Verify that unauthenticated upserts never re-activate an owned row."""

    def test_anonymous_insert_creates_active_row(self, _ensure_push_tables):
        upsert_fcm_token("tok_anon_new", username=None, platform="android")
        row = _get_fcm_row("tok_anon_new")
        assert row is not None
        assert row["username"] is None
        assert row["is_active"] == 1

    def test_authenticated_insert_creates_owned_row(self, _ensure_push_tables):
        upsert_fcm_token("tok_auth_new", username="alice", platform="ios")
        row = _get_fcm_row("tok_auth_new")
        assert row["username"] == "alice"
        assert row["is_active"] == 1

    def test_anonymous_upsert_does_not_reactivate_owned_row(self, _ensure_push_tables):
        upsert_fcm_token("tok_guard", username="alice", platform="ios")
        # Deactivate (simulates logout)
        deactivate_all_push_for_user("alice")
        row = _get_fcm_row("tok_guard")
        assert row["is_active"] == 0
        assert row["username"] == "alice"

        # Anonymous re-register must NOT flip is_active back to 1
        upsert_fcm_token("tok_guard", username=None, platform="ios")
        row = _get_fcm_row("tok_guard")
        assert row["is_active"] == 0, "Anonymous upsert must not re-activate an owned row"
        assert row["username"] == "alice", "Username must not be cleared"

    def test_authenticated_upsert_reactivates_owned_row(self, _ensure_push_tables):
        upsert_fcm_token("tok_relogin", username="alice", platform="ios")
        deactivate_all_push_for_user("alice")
        assert _get_fcm_row("tok_relogin")["is_active"] == 0

        # Authenticated re-register SHOULD re-activate
        upsert_fcm_token("tok_relogin", username="alice", platform="ios")
        row = _get_fcm_row("tok_relogin")
        assert row["is_active"] == 1
        assert row["username"] == "alice"

    def test_anonymous_upsert_on_anonymous_row_stays_active(self, _ensure_push_tables):
        upsert_fcm_token("tok_anon_again", username=None, platform="android")
        assert _get_fcm_row("tok_anon_again")["is_active"] == 1

        # Second anonymous upsert — should stay active (no owner)
        upsert_fcm_token("tok_anon_again", username=None, platform="android")
        assert _get_fcm_row("tok_anon_again")["is_active"] == 1


# ── upsert_native_push_token guard ──────────────────────────────────────


class TestUpsertNativePushTokenGuard:
    def test_anonymous_upsert_does_not_reactivate_owned_native_row(self, _ensure_push_tables):
        upsert_native_push_token("nat_guard", username="bob", platform="ios")
        deactivate_all_push_for_user("bob")
        assert _get_native_row("nat_guard")["is_active"] == 0

        upsert_native_push_token("nat_guard", username=None, platform="ios")
        row = _get_native_row("nat_guard")
        assert row["is_active"] == 0
        assert row["username"] == "bob"


# ── deactivate_all_push_for_user ─────────────────────────────────────────


class TestDeactivateAllPush:
    def test_deactivates_all_token_types(self, _ensure_push_tables):
        from backend.services.database import get_db_connection

        upsert_fcm_token("all_fcm", username="carol", platform="ios")
        upsert_native_push_token("all_nat", username="carol", platform="ios")

        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                "INSERT INTO push_subscriptions (username, endpoint) VALUES (%s, %s)",
                ("carol", "https://push.example/carol"),
            )
            c.execute(
                "INSERT INTO push_tokens (username, token, platform, is_active) VALUES (%s, %s, %s, 1)",
                ("carol", "legacy_tok", "ios"),
            )
            conn.commit()

        result = deactivate_all_push_for_user("carol")
        assert result["fcm_tokens"] >= 1
        assert result["native_push_tokens"] >= 1
        assert result["push_subscriptions"] >= 1
        assert result["push_tokens"] >= 1

        assert _get_fcm_row("all_fcm")["is_active"] == 0
        assert _get_native_row("all_nat")["is_active"] == 0

        # push_subscriptions should be deleted (not just deactivated)
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT COUNT(*) FROM push_subscriptions WHERE username = %s", ("carol",))
            count = c.fetchone()
            assert (count[0] if not hasattr(count, "keys") else count["COUNT(*)"]) == 0

        # Legacy push_tokens should be deactivated
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT is_active FROM push_tokens WHERE username = %s", ("carol",))
            row = c.fetchone()
            active = row["is_active"] if hasattr(row, "keys") else row[0]
            assert active == 0
