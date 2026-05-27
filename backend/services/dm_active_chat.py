"""Active chat presence for push suppression. Extracted from bodybuilding_app monolith."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Tuple

from backend.services.database import USE_MYSQL, get_db_connection

logger = logging.getLogger(__name__)


def record_active_chat(username: str, *, peer: str) -> Tuple[dict, int]:
    """Record that the current user is actively viewing a chat with peer."""
    if not peer:
        return {"success": False, "error": "peer required"}, 400
    try:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with get_db_connection() as conn:
            c = conn.cursor()
            if USE_MYSQL:
                c.execute(
                    """
                    INSERT INTO active_chat_status (user, peer, updated_at)
                    VALUES (?, ?, NOW())
                    ON DUPLICATE KEY UPDATE updated_at=NOW()
                    """,
                    (username, peer),
                )
            else:
                c.execute(
                    """
                    INSERT INTO active_chat_status (user, peer, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(user, peer) DO UPDATE SET updated_at=excluded.updated_at
                    """,
                    (username, peer, now),
                )
            conn.commit()
        return {"success": True}, 200
    except Exception as e:
        logger.error("record_active_chat error: %s", e)
        return {"success": False}, 500
