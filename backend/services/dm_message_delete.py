"""DM message delete. Extracted from bodybuilding_app monolith."""

from __future__ import annotations

import logging
from typing import Any, Tuple

from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)


def delete_dm_message(
    username: str,
    *,
    message_id: Any = None,
) -> Tuple[dict, int]:
    """Delete a DM message for participants who are sender or receiver."""
    if not message_id:
        return {"success": False, "error": "Message ID required"}, 200
    try:
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"SELECT sender, receiver FROM messages WHERE id={ph} AND (sender={ph} OR receiver={ph})",
                (message_id, username, username),
            )
            row = c.fetchone()
            if not row:
                return {"success": False, "error": "Message not found or not yours"}, 200
            sender = row["sender"] if hasattr(row, "keys") else row[0]
            receiver = row["receiver"] if hasattr(row, "keys") else row[1]
            c.execute(f"DELETE FROM messages WHERE id={ph}", (message_id,))
            conn.commit()

            try:
                from backend.services.firestore_writes import USE_FIRESTORE_WRITES, _dm_conv_id, _get_client

                if USE_FIRESTORE_WRITES:
                    fs = _get_client()
                    conv_id = _dm_conv_id(sender, receiver)
                    fs.collection("dm_conversations").document(conv_id).collection("messages").document(
                        str(message_id)
                    ).delete()
            except Exception as fs_err:
                logger.warning("Firestore DM message delete failed (non-fatal): %s", fs_err)

        return {"success": True}, 200
    except Exception as e:
        logger.error("delete_dm_message error for %s: %s", username, e)
        return {"success": False, "error": "Failed to delete message"}, 500
