"""User login / community visit tables used for admin analytics and visit tracking."""

from __future__ import annotations

import logging
import sqlite3
import threading
from datetime import datetime

from backend.services.database import USE_MYSQL

logger = logging.getLogger(__name__)

_visit_repair_lock = threading.Lock()


def _is_missing_community_visit_table_error(exc: BaseException) -> bool:
    """True only when the failure is due to community_visit_history not existing."""
    msg = str(exc).lower()
    if isinstance(exc, sqlite3.OperationalError):
        return "no such table" in msg and "community_visit" in msg
    args = getattr(exc, "args", None)
    if args and len(args) >= 1 and args[0] == 1146:
        return "community_visit" in msg
    if "1146" in msg and ("community_visit" in msg or "doesn't exist" in msg):
        return True
    if ("doesn't exist" in msg or "does not exist" in msg) and "community_visit" in msg:
        return True
    return False


def ensure_user_activity_tables(conn) -> None:
    """Create user_login_history and community_visit_history if missing. Idempotent."""
    c = conn.cursor()
    try:
        if USE_MYSQL:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS user_login_history (
                    id INTEGER PRIMARY KEY AUTO_INCREMENT,
                    username VARCHAR(255) NOT NULL,
                    login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    ip_address VARCHAR(45),
                    user_agent TEXT,
                    FOREIGN KEY (username) REFERENCES users (username)
                )
                """
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS community_visit_history (
                    id INTEGER PRIMARY KEY AUTO_INCREMENT,
                    username VARCHAR(191) NOT NULL,
                    community_id INTEGER NOT NULL,
                    visit_time TEXT NOT NULL,
                    FOREIGN KEY (username) REFERENCES users (username),
                    FOREIGN KEY (community_id) REFERENCES communities (id)
                )
                """
            )
        else:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS user_login_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    ip_address TEXT,
                    user_agent TEXT,
                    FOREIGN KEY (username) REFERENCES users (username)
                )
                """
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS community_visit_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    community_id INTEGER NOT NULL,
                    visit_time TEXT NOT NULL,
                    FOREIGN KEY (username) REFERENCES users (username),
                    FOREIGN KEY (community_id) REFERENCES communities (id)
                )
                """
            )
        try:
            c.execute("CREATE INDEX IF NOT EXISTS idx_login_username ON user_login_history(username)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_login_time ON user_login_history(login_time)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_visit_username ON community_visit_history(username)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_visit_community ON community_visit_history(community_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_visit_time ON community_visit_history(visit_time)")
        except Exception:
            pass
        try:
            conn.commit()
        except Exception:
            pass
    except Exception as e:
        logger.warning("ensure_user_activity_tables: %s", e)


def record_community_feed_visit(conn, username: str, community_id: int) -> None:
    """Record a community feed view for DAU/MAU. Insert-first; DDL only if table is missing."""
    visit_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    c = conn.cursor()

    def _insert() -> None:
        c.execute(
            "INSERT INTO community_visit_history (username, community_id, visit_time) VALUES (?, ?, ?)",
            (username, community_id, visit_time),
        )

    try:
        _insert()
        try:
            conn.commit()
        except Exception:
            pass
    except Exception as first_exc:
        if not _is_missing_community_visit_table_error(first_exc):
            logger.warning("community_visit_history insert failed: %s", first_exc)
            return
        with _visit_repair_lock:
            try:
                ensure_user_activity_tables(conn)
                _insert()
                try:
                    conn.commit()
                except Exception:
                    pass
            except Exception as repair_exc:
                logger.warning(
                    "community_visit_history repair/insert failed: %s (initial: %s)",
                    repair_exc,
                    first_exc,
                )
