"""PDF document attachments for DM and group chat."""

from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any, Optional, Tuple

from werkzeug.utils import secure_filename

from backend.services.database import USE_MYSQL, get_sql_placeholder
from backend.services.dm_chats_tables import ensure_messages_document_columns
from backend.services.media import save_uploaded_file

logger = logging.getLogger(__name__)

PDF_EXTENSIONS = {"pdf"}
MAX_CHAT_PDF_BYTES = 25 * 1024 * 1024
MESSAGE_DOCUMENTS_SUBFOLDER = "message_documents"


def _pdf_size_ok(file_storage: Any) -> Tuple[bool, Optional[str]]:
    size = getattr(file_storage, "content_length", None)
    if size is None:
        try:
            pos = file_storage.stream.tell()
            file_storage.stream.seek(0, os.SEEK_END)
            size = file_storage.stream.tell()
            file_storage.stream.seek(pos)
        except Exception:
            size = None
    if size is not None and size > MAX_CHAT_PDF_BYTES:
        return False, "PDF too large (max 25 MB)"
    return True, None


def validate_chat_pdf(file_storage: Any) -> Tuple[bool, Optional[str]]:
    if not file_storage or not getattr(file_storage, "filename", ""):
        return False, "No file selected"
    filename = secure_filename(file_storage.filename) or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    mime = (getattr(file_storage, "mimetype", "") or "").lower()
    if ext not in PDF_EXTENSIONS and mime != "application/pdf":
        return False, "Only PDF files are allowed"
    return _pdf_size_ok(file_storage)


def display_file_name(file_storage: Any) -> str:
    raw = (getattr(file_storage, "filename", "") or "").strip()
    base = os.path.basename(raw.replace("\\", "/"))
    safe = secure_filename(base) or "document.pdf"
    if not safe.lower().endswith(".pdf"):
        safe = f"{safe}.pdf"
    return safe[:255]


def store_chat_pdf(file_storage: Any) -> Optional[str]:
    ok, err = validate_chat_pdf(file_storage)
    if not ok:
        logger.warning("chat PDF rejected: %s", err)
        return None
    try:
        if hasattr(file_storage, "seek"):
            file_storage.seek(0)
    except Exception:
        pass
    return save_uploaded_file(
        file_storage,
        subfolder=MESSAGE_DOCUMENTS_SUBFOLDER,
        allowed_extensions=PDF_EXTENSIONS,
    )


def _resolve_recipient_username(cursor, ph: str, recipient_id: str) -> Optional[str]:
    try:
        rid = int(recipient_id)
    except (TypeError, ValueError):
        return None
    cursor.execute(f"SELECT username FROM users WHERE id = {ph}", (rid,))
    row = cursor.fetchone()
    if not row:
        return None
    return row["username"] if hasattr(row, "keys") else row[0]


def _is_dm_blocked(cursor, ph: str, sender: str, recipient: str) -> bool:
    try:
        cursor.execute(
            f"""
            SELECT 1 FROM blocked_users
            WHERE (blocker_username = {ph} AND blocked_username = {ph})
               OR (blocker_username = {ph} AND blocked_username = {ph})
            LIMIT 1
            """,
            (sender, recipient, recipient, sender),
        )
        return cursor.fetchone() is not None
    except Exception:
        return False


def _format_utc_timestamp(raw) -> Optional[str]:
    if not raw:
        return None
    if isinstance(raw, datetime):
        s = raw.isoformat()
    else:
        s = str(raw)
    if s and not s.endswith("Z") and "+" not in s[-6:]:
        s = s.replace(" ", "T")
        if not s.endswith("Z"):
            s += "Z"
    return s


def _insert_dm_notification(cursor, ph: str, recipient: str, sender: str, preview: str) -> None:
    link = f"/user_chat/chat/{sender}"
    message = f"You have new messages from {sender}"
    try:
        if USE_MYSQL:
            cursor.execute(
                f"""
                INSERT INTO notifications (user_id, from_user, type, post_id, community_id, message, created_at, is_read, link, preview_text)
                VALUES ({ph}, {ph}, 'message', NULL, NULL, {ph}, NOW(), 0, {ph}, {ph})
                ON DUPLICATE KEY UPDATE
                    created_at = NOW(),
                    message = VALUES(message),
                    is_read = 0,
                    link = VALUES(link),
                    preview_text = VALUES(preview_text)
                """,
                (recipient, sender, message, link, preview),
            )
        else:
            cursor.execute(
                f"""
                INSERT INTO notifications (user_id, from_user, type, post_id, community_id, message, created_at, is_read, link, preview_text)
                VALUES ({ph}, {ph}, 'message', NULL, NULL, {ph}, datetime('now'), 0, {ph}, {ph})
                ON CONFLICT(user_id, from_user, type, post_id, community_id)
                DO UPDATE SET created_at = datetime('now'), is_read = 0, message = excluded.message,
                    link = excluded.link, preview_text = excluded.preview_text
                """,
                (recipient, sender, message, link, preview),
            )
    except Exception as e:
        logger.warning("DM document notification failed: %s", e)


def send_dm_pdf(
    conn: Any,
    cursor: Any,
    *,
    sender: str,
    recipient_id: str,
    file_storage: Any,
    caption: Optional[str] = None,
) -> Tuple[bool, dict, int]:
    """Insert a PDF DM message. Returns (ok, payload, http_status)."""
    ph = get_sql_placeholder()
    ensure_messages_document_columns(cursor)

    recipient_username = _resolve_recipient_username(cursor, ph, recipient_id)
    if not recipient_username:
        return False, {"success": False, "error": "Recipient not found"}, 404

    if _is_dm_blocked(cursor, ph, sender, recipient_username):
        return False, {"success": False, "error": "Unable to send message to this user"}, 403

    ok, err = validate_chat_pdf(file_storage)
    if not ok:
        return False, {"success": False, "error": err or "Invalid PDF"}, 400

    stored_path = store_chat_pdf(file_storage)
    if not stored_path:
        return False, {"success": False, "error": "Failed to upload PDF"}, 400

    file_name = display_file_name(file_storage)
    message_text = (caption or "").strip()

    if USE_MYSQL:
        cursor.execute(
            f"""
            INSERT INTO messages (sender, receiver, message, file_path, file_name, timestamp)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, NOW())
            """,
            (sender, recipient_username, message_text, stored_path, file_name),
        )
    else:
        cursor.execute(
            f"""
            INSERT INTO messages (sender, receiver, message, file_path, file_name, timestamp)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, datetime('now'))
            """,
            (sender, recipient_username, message_text, stored_path, file_name),
        )
    conn.commit()
    message_id = getattr(cursor, "lastrowid", None)

    inserted_time = None
    if message_id:
        try:
            cursor.execute(f"SELECT timestamp FROM messages WHERE id = {ph}", (message_id,))
            ts_row = cursor.fetchone()
            if ts_row:
                inserted_time = ts_row["timestamp"] if hasattr(ts_row, "keys") else ts_row[0]
        except Exception:
            pass

    try:
        from backend.services.firestore_writes import write_dm_message

        write_dm_message(
            sender=sender,
            receiver=recipient_username,
            message_id=message_id,
            text=message_text,
            file_path=stored_path,
            file_name=file_name,
            timestamp=inserted_time,
        )
    except Exception as fs_err:
        logger.warning("Firestore DM document write failed: %s", fs_err)

    try:
        from redis_cache import invalidate_message_cache

        invalidate_message_cache(sender, recipient_username)
    except Exception:
        pass

    preview = f"📄 {file_name}"
    _insert_dm_notification(cursor, ph, recipient_username, sender, preview)
    conn.commit()

    return True, {
        "success": True,
        "id": message_id,
        "file_path": stored_path,
        "file_name": file_name,
        "text": message_text,
        "time": _format_utc_timestamp(inserted_time),
    }, 200


def send_group_pdf(
    conn: Any,
    cursor: Any,
    *,
    sender: str,
    group_id: int,
    file_storage: Any,
    caption: Optional[str] = None,
) -> Tuple[bool, dict, int]:
    """Insert a PDF group chat message. Returns (ok, payload, http_status)."""
    ph = get_sql_placeholder()

    cursor.execute(
        f"""
        SELECT 1 FROM group_chat_members
        WHERE group_id = {ph} AND username = {ph}
        """,
        (group_id, sender),
    )
    if not cursor.fetchone():
        return False, {"success": False, "error": "Access denied"}, 403

    ok, err = validate_chat_pdf(file_storage)
    if not ok:
        return False, {"success": False, "error": err or "Invalid PDF"}, 400

    stored_path = store_chat_pdf(file_storage)
    if not stored_path:
        return False, {"success": False, "error": "Failed to upload PDF"}, 400

    file_name = display_file_name(file_storage)
    message_text = (caption or "").strip() or None
    now = datetime.now().isoformat()

    cursor.execute(
        f"""
        INSERT INTO group_chat_messages
            (group_id, sender_username, message_text, file_path, file_name, created_at)
        VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph})
        """,
        (group_id, sender, message_text, stored_path, file_name, now),
    )
    message_id = cursor.lastrowid
    cursor.execute(f"UPDATE group_chats SET updated_at = {ph} WHERE id = {ph}", (now, group_id))

    if USE_MYSQL:
        cursor.execute(
            f"""
            INSERT INTO group_chat_read_receipts (group_id, username, last_read_message_id, last_read_at)
            VALUES ({ph}, {ph}, {ph}, {ph})
            ON DUPLICATE KEY UPDATE
                last_read_message_id = VALUES(last_read_message_id),
                last_read_at = VALUES(last_read_at)
            """,
            (group_id, sender, message_id, now),
        )
    else:
        cursor.execute(
            f"""
            INSERT INTO group_chat_read_receipts (group_id, username, last_read_message_id, last_read_at)
            VALUES ({ph}, {ph}, {ph}, {ph})
            ON CONFLICT(group_id, username) DO UPDATE SET
                last_read_message_id = MAX(last_read_message_id, {ph}),
                last_read_at = {ph}
            """,
            (group_id, sender, message_id, now, message_id, now),
        )

    conn.commit()

    try:
        from backend.services.firestore_writes import write_group_chat_message

        write_group_chat_message(
            group_id=group_id,
            message_id=message_id,
            sender=sender,
            text=message_text,
            file_path=stored_path,
            file_name=file_name,
            timestamp=now,
        )
    except Exception as fs_err:
        logger.warning("Firestore group document write failed: %s", fs_err)

    return True, {
        "success": True,
        "message": {
            "id": message_id,
            "sender": sender,
            "text": message_text,
            "file_path": stored_path,
            "file_name": file_name,
            "document": stored_path,
            "created_at": now,
        },
    }, 200
