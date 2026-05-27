"""DM/group chat mute preferences. Extracted from bodybuilding_app monolith."""

from __future__ import annotations

import logging
from typing import Any, Optional, Tuple

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)


def _ensure_user_muted_chats_table(cursor) -> None:
    try:
        cursor.execute("SELECT 1 FROM user_muted_chats LIMIT 1")
    except Exception:
        if USE_MYSQL:
            cursor.execute(
                "CREATE TABLE IF NOT EXISTS user_muted_chats "
                "(username VARCHAR(191) NOT NULL, chat_key VARCHAR(255) NOT NULL, "
                "muted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (username, chat_key))"
            )
        else:
            cursor.execute(
                "CREATE TABLE IF NOT EXISTS user_muted_chats "
                "(username TEXT NOT NULL, chat_key TEXT NOT NULL, "
                "muted_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (username, chat_key))"
            )


def apply_dm_thread_mute(
    username: str,
    *,
    other_username: Optional[str] = None,
    group_id: Any = None,
    muted: bool = True,
) -> Tuple[dict, int]:
    """Mute or unmute push notifications for a DM or group chat."""
    try:
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            _ensure_user_muted_chats_table(c)
            chat_key = (
                f"dm:{other_username}"
                if other_username
                else f"group:{group_id}"
                if group_id
                else None
            )
            if not chat_key:
                return {"success": False, "error": "other_username or group_id required"}, 400
            if muted:
                if USE_MYSQL:
                    c.execute(
                        f"INSERT INTO user_muted_chats (username, chat_key) VALUES ({ph},{ph}) "
                        f"ON DUPLICATE KEY UPDATE muted_at=NOW()",
                        (username, chat_key),
                    )
                else:
                    c.execute(
                        f"INSERT INTO user_muted_chats (username, chat_key) VALUES ({ph},{ph}) "
                        f"ON CONFLICT(username, chat_key) DO UPDATE SET muted_at=datetime('now')",
                        (username, chat_key),
                    )
            else:
                c.execute(
                    f"DELETE FROM user_muted_chats WHERE username={ph} AND chat_key={ph}",
                    (username, chat_key),
                )
            conn.commit()
            return {"success": True, "muted": bool(muted)}, 200
    except Exception as e:
        logger.error("apply_dm_thread_mute error: %s", e)
        return {"success": False, "error": "Server error"}, 500
