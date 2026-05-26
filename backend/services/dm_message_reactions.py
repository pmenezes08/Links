"""DM message reaction write path. Extracted from bodybuilding_app monolith."""

from __future__ import annotations

import logging
from typing import Any, Optional, Tuple

from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.notifications import (
    create_notification,
    push_privacy_summary,
    send_push_to_user,
)

logger = logging.getLogger(__name__)


def parse_reaction_request(
    *,
    use_json: bool,
    json_payload: Optional[dict],
    form_message_id: Any,
    form_emoji: str,
) -> Tuple[Any, str]:
    if use_json:
        data = json_payload or {}
        message_id = data.get("message_id")
        emoji = (data.get("emoji") or "").strip()
    else:
        message_id = form_message_id
        emoji = (form_emoji or "").strip()
    return message_id, emoji


def apply_dm_message_reaction(
    viewer_username: str,
    *,
    message_id: Any = None,
    emoji: str = "",
) -> Tuple[dict, int]:
    """Set or clear a reaction on a DM message. Returns (payload, http_status)."""
    username = viewer_username

    if not message_id:
        return {"success": False, "error": "message_id required"}, 400

    try:
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"SELECT sender, receiver, message FROM messages WHERE id = {ph}",
                (message_id,),
            )
            row = c.fetchone()
            if not row:
                return {"success": False, "error": "Message not found"}, 404

            sender = row["sender"] if hasattr(row, "keys") else row[0]
            receiver = row["receiver"] if hasattr(row, "keys") else row[1]
            message_text = row["message"] if hasattr(row, "keys") else row[2]

            if str(username) != str(sender) and str(username) != str(receiver):
                return {"success": False, "error": "Not authorized"}, 403

            if emoji:
                c.execute(
                    f"UPDATE messages SET reaction = {ph}, reaction_by = {ph} WHERE id = {ph}",
                    (emoji, username, message_id),
                )
            else:
                c.execute(
                    f"UPDATE messages SET reaction = NULL, reaction_by = NULL WHERE id = {ph} AND reaction_by = {ph}",
                    (message_id, username),
                )
            conn.commit()

            try:
                from backend.services.firestore_writes import write_dm_reaction

                write_dm_reaction(
                    sender=sender,
                    receiver=receiver,
                    message_id=int(message_id),
                    reaction=emoji if emoji else None,
                    reaction_by=username if emoji else None,
                )
            except Exception as fs_err:
                logger.warning("Firestore DM reaction write failed (non-fatal): %s", fs_err)

            if str(sender) == str(username):
                notify_user = receiver
            else:
                notify_user = sender

            if emoji and notify_user:
                preview = (message_text or "").strip()[:50]
                if len(message_text or "") > 50:
                    preview += "..."

                should_push = True
                try:
                    c2 = conn.cursor()
                    c2.execute(
                        f"SELECT 1 FROM active_chat_presence WHERE username = {ph} AND peer = {ph} "
                        f"AND last_ping > DATE_SUB(NOW(), INTERVAL 30 SECOND)",
                        (notify_user, username),
                    )
                    if c2.fetchone():
                        should_push = False
                except Exception as pe:
                    logger.warning("active chat presence check (reaction) failed: %s", pe)

                if should_push:
                    notif_message = (
                        f'{username} reacted {emoji} to: "{preview}"'
                        if preview
                        else f"{username} reacted {emoji} to your message"
                    )
                    notif_link = f"/user_chat/chat/{username}"
                    create_notification(
                        user_id=notify_user,
                        from_user=username,
                        notification_type="reaction",
                        post_id=None,
                        community_id=None,
                        message=notif_message,
                        link=notif_link,
                    )
                    send_push_to_user(
                        notify_user,
                        {
                            "title": f"{username} reacted {emoji}",
                            "body": f'to: "{preview}"' if preview else "to your message",
                            "summary_body": push_privacy_summary(
                                notify_user, "dm_reaction", author=username
                            ),
                            "url": notif_link,
                            "tag": f"reaction-{username}-{message_id}",
                        },
                    )

            return {
                "success": True,
                "reaction": emoji,
                "reaction_by": username if emoji else None,
            }, 200
    except Exception as e:
        logger.error("apply_dm_message_reaction error: %s", e)
        return {"success": False, "error": "Failed to save reaction"}, 500
