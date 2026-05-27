"""DM text message send path. Extracted from bodybuilding_app monolith."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

from backend.services.chat_message_preview import format_chat_message_preview
from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.notifications import push_privacy_summary, send_push_to_user
from backend.services.steve_dm_reply import start_steve_dm_reply_if_allowed
from redis_cache import cache, invalidate_message_cache

logger = logging.getLogger(__name__)


def send_dm_text_message(
    username: str,
    *,
    recipient_id: Any = None,
    message: str = "",
    client_key: Optional[str] = None,
    is_encrypted: bool = False,
    encrypted_body: str = "",
    encrypted_body_for_sender: str = "",
) -> dict:
    """Send a text DM (supports E2E encryption). Returns JSON-serializable payload."""
    if not recipient_id:
        return {"success": False, "error": "Recipient required"}

    if not is_encrypted and not message:
        return {"success": False, "error": "Message required"}

    try:
        with get_db_connection() as conn:
            c = conn.cursor()

            c.execute("SELECT username FROM users WHERE id = ?", (recipient_id,))
            recipient = c.fetchone()
            if not recipient:
                return {"success": False, "error": "Recipient not found"}

            recipient_username = recipient["username"] if hasattr(recipient, "keys") else recipient[0]

            try:
                c.execute(
                    """
                    SELECT 1 FROM blocked_users
                    WHERE (blocker_username = ? AND blocked_username = ?)
                    OR (blocker_username = ? AND blocked_username = ?)
                """,
                    (username, recipient_username, recipient_username, username),
                )
                if c.fetchone():
                    return {"success": False, "error": "Unable to send message to this user"}
            except Exception as block_check_err:
                logger.warning("Could not check blocked status: %s", block_check_err)

            if client_key:
                try:
                    if USE_MYSQL:
                        c.execute(
                            "SELECT id, timestamp FROM messages WHERE client_key = %s AND sender = %s LIMIT 1",
                            (client_key, username),
                        )
                    else:
                        c.execute(
                            "SELECT id, timestamp FROM messages WHERE client_key = ? AND sender = ? LIMIT 1",
                            (client_key, username),
                        )
                    existing = c.fetchone()
                    if existing:
                        eid = existing["id"] if hasattr(existing, "keys") else existing[0]
                        etime = existing["timestamp"] if hasattr(existing, "keys") else existing[1]
                        return {
                            "success": True,
                            "message": "Message already sent",
                            "message_id": eid,
                            "time": etime,
                        }
                except Exception as ik_err:
                    logger.warning("client_key idempotency check failed (non-fatal): %s", ik_err)

            if USE_MYSQL:
                c.execute(
                    """
                    SELECT id, timestamp FROM messages
                    WHERE sender = %s AND receiver = %s AND message = %s
                    AND timestamp > DATE_SUB(NOW(), INTERVAL 5 SECOND)
                    LIMIT 1
                """,
                    (username, recipient_username, message),
                )
            else:
                c.execute(
                    """
                    SELECT id, timestamp FROM messages
                    WHERE sender = ? AND receiver = ? AND message = ?
                    AND datetime(timestamp) > datetime('now','-5 seconds')
                    LIMIT 1
                """,
                    (username, recipient_username, message),
                )

            dup_row = c.fetchone()
            if dup_row:
                dup_id = dup_row["id"] if hasattr(dup_row, "keys") else dup_row[0]
                dup_time = dup_row["timestamp"] if hasattr(dup_row, "keys") else dup_row[1]
                return {
                    "success": True,
                    "message": "Message already sent",
                    "message_id": dup_id,
                    "time": dup_time,
                }

            if USE_MYSQL:
                c.execute(
                    """
                    INSERT INTO messages (sender, receiver, message, is_encrypted, encrypted_body, encrypted_body_for_sender, client_key, timestamp)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                """,
                    (
                        username,
                        recipient_username,
                        message if not is_encrypted else "",
                        1 if is_encrypted else 0,
                        encrypted_body if is_encrypted else None,
                        encrypted_body_for_sender if is_encrypted else None,
                        client_key,
                    ),
                )
            else:
                _ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                c.execute(
                    """
                    INSERT INTO messages (sender, receiver, message, is_encrypted, encrypted_body, encrypted_body_for_sender, client_key, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                    (
                        username,
                        recipient_username,
                        message if not is_encrypted else "",
                        1 if is_encrypted else 0,
                        encrypted_body if is_encrypted else None,
                        encrypted_body_for_sender if is_encrypted else None,
                        client_key,
                        _ts,
                    ),
                )

            conn.commit()
            inserted_id = None
            inserted_time = None
            try:
                inserted_id = getattr(c, "lastrowid", None)
                if inserted_id:
                    if USE_MYSQL:
                        c.execute("SELECT timestamp FROM messages WHERE id = %s", (inserted_id,))
                    else:
                        c.execute("SELECT timestamp FROM messages WHERE id = ?", (inserted_id,))
                    row = c.fetchone()
                    if row is not None:
                        inserted_time = row["timestamp"] if hasattr(row, "keys") else row[0]
            except Exception:
                inserted_id = None
                inserted_time = None

            invalidate_message_cache(username, recipient_username)

            try:
                cache.delete(f"chat_threads:{username}")
                cache.delete(f"chat_threads:{recipient_username}")
            except Exception:
                pass

            _dm_link = f"/user_chat/chat/{username}"
            if is_encrypted:
                _dm_preview = "Encrypted message"
            else:
                _dm_preview = format_chat_message_preview(message) or f"Message from {username}"
            try:
                if USE_MYSQL:
                    c.execute(
                        """
                        INSERT INTO notifications (user_id, from_user, type, post_id, community_id, message, created_at, is_read, link, preview_text)
                        VALUES (?, ?, 'message', NULL, NULL, ?, NOW(), 0, ?, ?)
                        ON DUPLICATE KEY UPDATE
                            created_at = NOW(),
                            message = VALUES(message),
                            is_read = 0,
                            link = VALUES(link),
                            preview_text = VALUES(preview_text)
                    """,
                        (
                            recipient_username,
                            username,
                            f"You have new messages from {username}",
                            _dm_link,
                            _dm_preview,
                        ),
                    )
                else:
                    c.execute(
                        """
                        INSERT INTO notifications (user_id, from_user, type, post_id, community_id, message, created_at, is_read, link, preview_text)
                        VALUES (?, ?, 'message', NULL, NULL, ?, datetime('now'), 0, ?, ?)
                        ON CONFLICT(user_id, from_user, type, post_id, community_id)
                        DO UPDATE SET created_at = datetime('now'), is_read = 0, message = excluded.message, link = excluded.link, preview_text = excluded.preview_text
                    """,
                        (
                            recipient_username,
                            username,
                            f"You have new messages from {username}",
                            _dm_link,
                            _dm_preview,
                        ),
                    )
                conn.commit()
            except Exception as notif_e:
                logger.warning("Could not create/update message notification: %s", notif_e)

            try:
                should_push = True
                try:
                    with get_db_connection() as conn2:
                        c2 = conn2.cursor()
                        if USE_MYSQL:
                            c2.execute(
                                """
                                SELECT 1 FROM active_chat_status
                                WHERE user=? AND peer=? AND updated_at > DATE_SUB(NOW(), INTERVAL 20 SECOND)
                                LIMIT 1
                            """,
                                (recipient_username, username),
                            )
                        else:
                            c2.execute(
                                """
                                SELECT 1 FROM active_chat_status
                                WHERE user=? AND peer=? AND datetime(updated_at) > datetime('now','-20 seconds')
                                LIMIT 1
                            """,
                                (recipient_username, username),
                            )
                        if c2.fetchone():
                            should_push = False
                except Exception as pe:
                    logger.warning("active chat presence check failed: %s", pe)
                if should_push:
                    try:
                        _mute_ph = get_sql_placeholder()
                        c.execute(
                            f"SELECT 1 FROM user_muted_chats WHERE username={_mute_ph} AND chat_key={_mute_ph}",
                            (recipient_username, f"dm:{username}"),
                        )
                        if c.fetchone():
                            should_push = False
                            logger.debug(
                                "Suppressing push for %s - DM with %s is muted",
                                recipient_username,
                                username,
                            )
                    except Exception as mute_err:
                        logger.warning("Mute check failed: %s", mute_err)
                if should_push:
                    send_push_to_user(
                        recipient_username,
                        {
                            "title": f"Message from {username}",
                            "body": _dm_preview,
                            "summary_body": push_privacy_summary(
                                recipient_username, "dm_message", author=username
                            ),
                            "url": f"/user_chat/chat/{username}",
                            "tag": f"message-{username}-{inserted_id}",
                        },
                    )
            except Exception as _e:
                logger.warning("push send_message warn: %s", _e)

            dm_success_payload = {
                "success": True,
                "message": "Message sent successfully",
                "message_id": inserted_id,
                "time": inserted_time,
            }

            steve_started, steve_ent_err = start_steve_dm_reply_if_allowed(
                username,
                message,
                recipient_username,
                is_encrypted=is_encrypted,
            )
            if steve_ent_err:
                dm_success_payload["entitlements_error"] = steve_ent_err
            if steve_started:
                dm_success_payload["steve_is_typing"] = True

            try:
                from backend.services.firestore_writes import write_dm_message

                write_dm_message(
                    sender=username,
                    receiver=recipient_username,
                    message_id=inserted_id,
                    text=message if not is_encrypted else "",
                    is_encrypted=is_encrypted,
                    timestamp=datetime.strptime(str(inserted_time), "%Y-%m-%d %H:%M:%S")
                    if inserted_time
                    else None,
                )
            except Exception as fs_err:
                logger.warning("Firestore DM dual-write failed (non-fatal): %s", fs_err)

            return dm_success_payload

    except Exception as e:
        logger.error("Error sending message: %s", e)
        return {"success": False, "error": "Failed to send message"}
