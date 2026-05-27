"""DM message edit (5-minute window). Extracted from bodybuilding_app monolith."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional, Tuple

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from redis_cache import invalidate_message_cache

logger = logging.getLogger(__name__)


def _ensure_edited_at_column(cursor) -> None:
    try:
        if USE_MYSQL:
            cursor.execute("SHOW COLUMNS FROM messages LIKE 'edited_at'")
            if not cursor.fetchone():
                cursor.execute("ALTER TABLE messages ADD COLUMN edited_at DATETIME NULL")
        else:
            cursor.execute("PRAGMA table_info(messages)")
            cols = [row[1] for row in cursor.fetchall()]
            if "edited_at" not in cols:
                cursor.execute("ALTER TABLE messages ADD COLUMN edited_at TEXT")
    except Exception:
        pass


def edit_dm_message(
    username: str,
    *,
    message_id: Any = None,
    new_text: Optional[str] = None,
) -> Tuple[dict, int]:
    """Edit an existing message's text. Only the sender can edit. Records edited_at."""
    if not message_id or new_text is None:
        return {"success": False, "error": "message_id and text required"}, 400
    new_text = new_text.strip()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            _ensure_edited_at_column(c)
            ph = get_sql_placeholder()
            c.execute(f"SELECT sender, receiver, timestamp FROM messages WHERE id = {ph}", (message_id,))
            row = c.fetchone()
            if not row:
                return {"success": False, "error": "Not found"}, 404
            sender = row["sender"] if hasattr(row, "keys") else row[0]
            receiver = row["receiver"] if hasattr(row, "keys") else row[1]
            sent_ts_val = row["timestamp"] if hasattr(row, "keys") else row[2]
            if str(sender) != str(username):
                return {"success": False, "error": "Not permitted"}, 403

            from datetime import datetime as _dt

            sent_dt = None
            s = str(sent_ts_val or "")
            try:
                sent_dt = _dt.strptime(s[:19].replace("T", " "), "%Y-%m-%d %H:%M:%S")
            except Exception:
                for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d"):
                    try:
                        sent_dt = _dt.strptime(s, fmt)
                        break
                    except Exception:
                        continue
            if not sent_dt:
                return {"success": False, "error": "Invalid timestamp"}, 400
            if (_dt.now() - sent_dt).total_seconds() > 5 * 60:
                return {"success": False, "error": "Edit window expired"}, 400

            edited_at_val = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            try:
                c.execute(
                    f"""UPDATE messages
                       SET message = {ph}, edited_at = {ph}, is_encrypted = 0,
                           encrypted_body = NULL, encrypted_body_for_sender = NULL
                       WHERE id = {ph} AND sender = {ph}""",
                    (new_text, edited_at_val, message_id, username),
                )
            except Exception:
                c.execute(
                    f"UPDATE messages SET message = {ph}, edited_at = {ph} WHERE id = {ph} AND sender = {ph}",
                    (new_text, edited_at_val, message_id, username),
                )
            if c.rowcount == 0:
                return {"success": False, "error": "Not found or not permitted"}, 403
            conn.commit()

        try:
            invalidate_message_cache(username, receiver)
        except Exception:
            pass
        try:
            from backend.services.firestore_writes import edit_dm_message as fs_edit_dm_message

            fs_edit_dm_message(username, receiver, message_id, new_text, edited_at_val)
        except Exception:
            pass
        return {"success": True}, 200
    except Exception as e:
        logger.error("edit_dm_message error: %s", e)
        return {"success": False, "error": "Failed to edit message"}, 500
