"""Anonymous register_fcm must not reactivate tokens deactivated on logout."""

from __future__ import annotations

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder


def _ensure_push_tables() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        if USE_MYSQL:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS fcm_tokens (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    token VARCHAR(255) UNIQUE NOT NULL,
                    username VARCHAR(100),
                    platform VARCHAR(20) DEFAULT 'ios',
                    device_name VARCHAR(255),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    is_active TINYINT(1) DEFAULT 1,
                    INDEX idx_fcm_active (is_active)
                )
                """
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS native_push_tokens (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    token VARCHAR(191) NOT NULL UNIQUE,
                    username VARCHAR(191),
                    install_id VARCHAR(191),
                    platform VARCHAR(50) NOT NULL DEFAULT 'ios',
                    environment VARCHAR(20) NOT NULL DEFAULT 'sandbox',
                    bundle_id VARCHAR(191) NOT NULL DEFAULT 'co.cpoint.app',
                    device_name VARCHAR(191),
                    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    is_active TINYINT(1) DEFAULT 1
                )
                """
            )
        else:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS fcm_tokens (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    token TEXT UNIQUE NOT NULL,
                    username TEXT,
                    platform TEXT DEFAULT 'ios',
                    device_name TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    is_active INTEGER DEFAULT 1
                )
                """
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS native_push_tokens (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    token TEXT NOT NULL UNIQUE,
                    username TEXT,
                    install_id TEXT,
                    platform TEXT NOT NULL DEFAULT 'ios',
                    environment TEXT NOT NULL DEFAULT 'sandbox',
                    bundle_id TEXT NOT NULL DEFAULT 'co.cpoint.app',
                    device_name TEXT,
                    last_seen TEXT DEFAULT (datetime('now')),
                    created_at TEXT DEFAULT (datetime('now')),
                    is_active INTEGER DEFAULT 1
                )
                """
            )
        conn.commit()


def _seed_deactivated_apns(token: str, username: str) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO fcm_tokens (token, username, platform, is_active)
            VALUES ({ph}, {ph}, 'ios', 0)
            """,
            (token, username),
        )
        c.execute(
            f"""
            INSERT INTO native_push_tokens (token, username, platform, environment, bundle_id, is_active)
            VALUES ({ph}, {ph}, 'ios', 'production', 'co.cpoint.app', 0)
            """,
            (token, username),
        )
        conn.commit()


def _counts(token: str) -> tuple[int | None, str | None, int | None, str | None]:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT is_active, username FROM fcm_tokens WHERE token = {ph}", (token,))
        fcm = c.fetchone()
        c.execute(f"SELECT is_active, username FROM native_push_tokens WHERE token = {ph}", (token,))
        native = c.fetchone()
    if hasattr(fcm, "keys"):
        fcm_active, fcm_user = fcm["is_active"], fcm["username"]
        native_active, native_user = native["is_active"], native["username"]
    else:
        fcm_active, fcm_user = fcm[0], fcm[1]
        native_active, native_user = native[0], native[1]
    return fcm_active, fcm_user, native_active, native_user


def test_anonymous_register_fcm_does_not_reactivate_logged_out_token(mysql_dsn):
    """Regression: AppDelegate POST after logout must not bind token back to user."""
    from bodybuilding_app import app as monolith

    _ensure_push_tables()
    apns_hex = "aabbccdd00112233445566778899aabbccdd00112233445566778899aabb"
    _seed_deactivated_apns(apns_hex, "Paulo")

    with monolith.test_client() as client:
        resp = client.post(
            "/api/push/register_fcm",
            json={"token": apns_hex, "platform": "ios", "device_name": "iPhone"},
        )
        assert resp.status_code == 200

    fcm_active, fcm_user, native_active, native_user = _counts(apns_hex)
    assert fcm_active == 0
    assert fcm_user in (None, "")
    assert native_active == 0
    assert native_user in (None, "")


def test_authenticated_register_fcm_activates_token(mysql_dsn):
    from bodybuilding_app import app as monolith

    _ensure_push_tables()
    apns_hex = "bbccddee00112233445566778899aabbccddee00112233445566778899aabb"
    _seed_deactivated_apns(apns_hex, "Paulo")

    with monolith.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "Paulo"
        resp = client.post(
            "/api/push/register_fcm",
            json={"token": apns_hex, "platform": "ios"},
        )
        assert resp.status_code == 200

    fcm_active, fcm_user, native_active, native_user = _counts(apns_hex)
    assert fcm_active == 1
    assert fcm_user == "Paulo"
    assert native_active == 1
    assert native_user == "Paulo"


def test_register_fcm_blocked_after_unregister_does_not_reactivate(mysql_dsn):
    """Session push_registration_blocked must win over a still-present username cookie."""
    from bodybuilding_app import app as monolith

    _ensure_push_tables()
    apns_hex = "ccddeeff00112233445566778899aabbccddeeff00112233445566778899aabb"
    _seed_deactivated_apns(apns_hex, "Paulo")

    with monolith.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "Paulo"
            sess["push_registration_blocked"] = True
        resp = client.post(
            "/api/push/register_fcm",
            json={"token": apns_hex, "platform": "ios"},
        )
        assert resp.status_code == 200

    fcm_active, fcm_user, native_active, native_user = _counts(apns_hex)
    assert fcm_active == 0
    assert fcm_user in (None, "")
    assert native_active == 0
    assert native_user in (None, "")
