"""DM voice message summary edits. Extracted from bodybuilding_app monolith."""

from __future__ import annotations

import logging
from typing import Any, Tuple

from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)


def update_dm_audio_summary(
    username: str,
    *,
    message_id: Any = None,
    new_summary: str = "",
) -> Tuple[dict, int]:
    """Update the AI summary for a DM voice message. Only the sender can edit."""
    if not message_id:
        return {"success": False, "error": "Message ID required"}, 400
    if not new_summary:
        return {"success": False, "error": "Summary cannot be empty"}, 400
    try:
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(f"SELECT sender FROM messages WHERE id = {ph}", (message_id,))
            row = c.fetchone()
            if not row:
                return {"success": False, "error": "Message not found"}, 404
            sender = row["sender"] if hasattr(row, "keys") else row[0]
            if sender != username:
                return {"success": False, "error": "You can only edit your own summaries"}, 403
            c.execute(
                f"UPDATE messages SET audio_summary = {ph} WHERE id = {ph}",
                (new_summary, message_id),
            )
            conn.commit()
            return {"success": True, "summary": new_summary}, 200
    except Exception as e:
        logger.error("update_dm_audio_summary error: %s", e)
        return {"success": False, "error": "Failed to update summary"}, 500
