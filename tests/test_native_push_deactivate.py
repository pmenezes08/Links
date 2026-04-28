from __future__ import annotations

from backend.services import native_push
from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder


def _ensure_push_tables() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        if USE_MYSQL:
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
                    is_active TINYINT(1) DEFAULT 1,
                    INDEX idx_native_push_install (install_id)
                )
                """
            )
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
        else:
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
            c.execute("CREATE INDEX IF NOT EXISTS idx_native_push_install ON native_push_tokens(install_id)")
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
        conn.commit()


def _seed(token: str, username: str, install_id: str, active: int = 1) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO native_push_tokens (token, username, install_id, platform, environment, bundle_id, is_active)
            VALUES ({ph}, {ph}, {ph}, 'ios', 'sandbox', 'co.cpoint.app', {ph})
            """,
            (token, username, install_id, active),
        )
        c.execute(
            f"""
            INSERT INTO fcm_tokens (token, username, platform, is_active)
            VALUES ({ph}, {ph}, 'ios', {ph})
            """,
            (token, username, active),
        )
        conn.commit()


def _active_counts() -> tuple[int, int]:
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute("SELECT COUNT(*) AS count FROM native_push_tokens WHERE is_active=1")
        native = c.fetchone()
        c.execute("SELECT COUNT(*) AS count FROM fcm_tokens WHERE is_active=1")
        fcm = c.fetchone()
    native_count = native["count"] if hasattr(native, "keys") else native[0]
    fcm_count = fcm["count"] if hasattr(fcm, "keys") else fcm[0]
    return native_count, fcm_count


def test_deactivate_for_install_flips_all_rows(mysql_dsn):
    _ensure_push_tables()
    _seed("token-a", "alice", "install-1")
    _seed("token-b", "bob", "install-1")
    _seed("token-c", "alice", "install-1")
    _seed("token-d", "carol", "install-2")

    result = native_push.deactivate_for_install("install-1")

    assert result == {"native_push_tokens": 3, "fcm_tokens": 3}
    assert _active_counts() == (1, 1)


def test_deactivate_for_install_unknown_id_is_noop(mysql_dsn):
    _ensure_push_tables()
    _seed("token-a", "alice", "install-1")

    result = native_push.deactivate_for_install("missing")

    assert result == {"native_push_tokens": 0, "fcm_tokens": 0}
    assert _active_counts() == (1, 1)
