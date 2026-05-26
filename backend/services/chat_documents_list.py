"""List PDF documents shared in DM and group chat threads."""

from __future__ import annotations

import logging
from typing import Any, List, Optional, Tuple

from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)


def list_dm_documents(username: str, peer: str) -> Tuple[bool, dict, int]:
    """Return PDF documents for a DM pair. Caller must have verified DM access."""
    ph = get_sql_placeholder()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""
                SELECT id, sender, file_path, file_name, timestamp
                FROM messages
                WHERE ((sender = {ph} AND receiver = {ph}) OR (sender = {ph} AND receiver = {ph}))
                  AND file_path IS NOT NULL AND file_path != ''
                ORDER BY timestamp DESC
                """,
                (username, peer, peer, username),
            )
            documents = []
            for idx, row in enumerate(c.fetchall() or [], start=1):
                if hasattr(row, "keys"):
                    msg_id = row["id"]
                    sender = row["sender"]
                    url = row["file_path"]
                    file_name = row.get("file_name")
                    created_at = row["timestamp"]
                else:
                    msg_id, sender, url, file_name, created_at = row[0], row[1], row[2], row[3], row[4]
                documents.append(
                    {
                        "id": idx,
                        "message_id": msg_id,
                        "sender": sender,
                        "url": url,
                        "file_name": file_name or "document.pdf",
                        "created_at": created_at,
                    }
                )
            return True, {"success": True, "documents": documents}, 200
    except Exception as e:
        logger.error("list_dm_documents failed for %s<->%s: %s", username, peer, e, exc_info=True)
        return False, {"success": False, "error": "Failed to load documents"}, 500


def list_group_documents(username: str, group_id: int, cleared_before_id: int = 0) -> Tuple[bool, dict, int]:
    """Return PDF documents for a group chat. Caller must have verified membership."""
    ph = get_sql_placeholder()
    cleared_sql = f" AND id > {ph}" if cleared_before_id > 0 else ""
    cleared_param: tuple = (cleared_before_id,) if cleared_before_id > 0 else ()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""
                SELECT id, sender_username, file_path, file_name, created_at
                FROM group_chat_messages
                WHERE group_id = {ph} AND is_deleted = 0
                  AND file_path IS NOT NULL AND file_path != ''
                  {cleared_sql}
                ORDER BY created_at DESC
                """,
                (group_id,) + cleared_param,
            )
            documents = []
            for idx, row in enumerate(c.fetchall() or [], start=1):
                if hasattr(row, "keys"):
                    msg_id = row["id"]
                    sender = row["sender_username"]
                    url = row["file_path"]
                    file_name = row.get("file_name")
                    created_at = row["created_at"]
                else:
                    msg_id, sender, url, file_name, created_at = row[0], row[1], row[2], row[3], row[4]
                documents.append(
                    {
                        "id": idx,
                        "message_id": msg_id,
                        "sender": sender,
                        "url": url,
                        "file_name": file_name or "document.pdf",
                        "created_at": created_at,
                    }
                )
            return True, {"success": True, "documents": documents}, 200
    except Exception as e:
        logger.error("list_group_documents failed for group %s: %s", group_id, e, exc_info=True)
        return False, {"success": False, "error": "Failed to load documents"}, 500
