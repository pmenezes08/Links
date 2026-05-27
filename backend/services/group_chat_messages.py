"""Group chat message read path (GET /api/group_chat/<id>/messages). Extracted from group_chat blueprint."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Optional, Tuple

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.steve_dm_typing import is_group_typing

logger = logging.getLogger(__name__)


def fetch_group_messages(
    username: str,
    group_id: int,
    *,
    before_id: Optional[int] = None,
    since_id: Optional[int] = None,
    limit: int = 50,
) -> Tuple[dict, int]:
    """Load group chat messages for a member. Returns (payload, http_status)."""
    if before_id:
        since_id = None
    elif since_id is not None and since_id <= 0:
        since_id = None
    limit = min(limit, 100)

    try:
        from backend.services.firestore_reads import USE_FIRESTORE_READS

        if USE_FIRESTORE_READS:
            from backend.services.firestore_reads import get_group_chat_messages as fs_get_gcm

            from backend.blueprints import group_chat as gc

            cleared_fs = 0
            try:
                with get_db_connection() as _cconn:
                    _cc = _cconn.cursor()
                    gc._ensure_group_chat_tables(_cc)
                    gc._ensure_cleared_before_message_id_column(_cc)
                    _cph = get_sql_placeholder()
                    cleared_fs = gc._get_cleared_before_message_id(_cc, group_id, username, _cph)
            except Exception:
                pass

            messages = fs_get_gcm(
                group_id,
                username,
                before_id=before_id,
                since_id=since_id if since_id and since_id > 0 else None,
                limit=limit,
                min_id_exclusive=cleared_fs,
            )
            messages = gc._enrich_group_message_profile_pictures(messages)
            logger.info("Firestore group chat read: %s messages for group %s", len(messages), group_id)
            fs_initial_empty = (
                not before_id and not (since_id and since_id > 0) and not messages
            )
            if fs_initial_empty:
                logger.info(
                    "Firestore group chat empty on initial load for group %s; falling back to MySQL",
                    group_id,
                )
            else:
                try:
                    from backend.services.chat_message_document_merge import enrich_messages_with_mysql_documents

                    with get_db_connection() as _doc_conn:
                        _doc_c = _doc_conn.cursor()
                        messages = enrich_messages_with_mysql_documents(
                            _doc_c, messages, group_id=group_id
                        )
                except Exception as _doc_merge_err:
                    logger.warning("Group document merge failed: %s", _doc_merge_err)
                if messages:
                    try:
                        max_id = max(m["id"] for m in messages if m.get("id", 0) > 0)
                        if max_id > 0:
                            now_str = datetime.now().isoformat()
                            with get_db_connection() as _conn:
                                _c = _conn.cursor()
                                _ph = get_sql_placeholder()
                                gc._merge_user_group_message_reactions(_c, messages, username, _ph)
                                if USE_MYSQL:
                                    _c.execute(
                                        f"""
                                        INSERT INTO group_chat_read_receipts (group_id, username, last_read_message_id, last_read_at)
                                        VALUES ({_ph}, {_ph}, {_ph}, {_ph})
                                        ON DUPLICATE KEY UPDATE
                                            last_read_message_id = GREATEST(last_read_message_id, VALUES(last_read_message_id)),
                                            last_read_at = VALUES(last_read_at)
                                    """,
                                        (group_id, username, max_id, now_str),
                                    )
                                else:
                                    _c.execute(
                                        f"""
                                        INSERT INTO group_chat_read_receipts (group_id, username, last_read_message_id, last_read_at)
                                        VALUES ({_ph}, {_ph}, {_ph}, {_ph})
                                        ON CONFLICT(group_id, username) DO UPDATE SET
                                            last_read_message_id = MAX(last_read_message_id, {_ph}),
                                            last_read_at = {_ph}
                                    """,
                                        (group_id, username, max_id, now_str, max_id, now_str),
                                    )
                                _conn.commit()
                    except Exception as rr_err:
                        logger.warning("Failed to update read receipt on Firestore path: %s", rr_err)

                _steve_typing = is_group_typing(group_id)
                return (
                    {
                        "success": True,
                        "messages": messages,
                        "has_more": len(messages) == limit,
                        "steve_is_typing": _steve_typing,
                    },
                    200,
                )
    except Exception as fs_err:
        logger.warning("Firestore group chat read failed, falling back to MySQL: %s", fs_err)

    try:
        from backend.blueprints import group_chat as gc

        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()

            gc._ensure_group_chat_tables(c)
            gc._ensure_group_chat_tables(c)

            c.execute(
                f"""
                SELECT 1 FROM group_chat_members
                WHERE group_id = {ph} AND username = {ph}
            """,
                (group_id, username),
            )

            if not c.fetchone():
                return {"success": False, "error": "Access denied"}, 403

            gc._ensure_cleared_before_message_id_column(c)
            cleared_before_id = gc._get_cleared_before_message_id(c, group_id, username, ph)
            cleared_sql = f" AND m.id > {ph}" if cleared_before_id > 0 else ""
            cleared_param = (cleared_before_id,) if cleared_before_id > 0 else ()

            if before_id:
                c.execute(
                    f"""
                    SELECT m.id, m.sender_username, m.message_text, m.image_path, m.voice_path, m.video_path, m.media_paths, m.client_key, m.created_at,
                           up.profile_picture, m.is_edited, m.audio_summary, m.file_path, m.file_name
                    FROM group_chat_messages m
                    LEFT JOIN user_profiles up ON m.sender_username = up.username
                    WHERE m.group_id = {ph} AND m.id < {ph} AND m.is_deleted = 0{cleared_sql}
                    ORDER BY m.created_at DESC
                    LIMIT {ph}
                """,
                    (group_id, before_id) + cleared_param + (limit,),
                )
            elif since_id and since_id > 0:
                c.execute(
                    f"""
                    SELECT m.id, m.sender_username, m.message_text, m.image_path, m.voice_path, m.video_path, m.media_paths, m.client_key, m.created_at,
                           up.profile_picture, m.is_edited, m.audio_summary, m.file_path, m.file_name
                    FROM group_chat_messages m
                    LEFT JOIN user_profiles up ON m.sender_username = up.username
                    WHERE m.group_id = {ph} AND m.id > {ph} AND m.is_deleted = 0{cleared_sql}
                    ORDER BY m.id ASC
                    LIMIT {ph}
                """,
                    (group_id, since_id) + cleared_param + (limit,),
                )
            else:
                c.execute(
                    f"""
                    SELECT m.id, m.sender_username, m.message_text, m.image_path, m.voice_path, m.video_path, m.media_paths, m.client_key, m.created_at,
                           up.profile_picture, m.is_edited, m.audio_summary, m.file_path, m.file_name
                    FROM group_chat_messages m
                    LEFT JOIN user_profiles up ON m.sender_username = up.username
                    WHERE m.group_id = {ph} AND m.is_deleted = 0{cleared_sql}
                    ORDER BY m.created_at DESC
                    LIMIT {ph}
                """,
                    (group_id,) + cleared_param + (limit,),
                )

            messages = []
            for row in c.fetchall():
                media_paths_raw = row["media_paths"] if hasattr(row, "keys") else row[6]
                media_paths = None
                if media_paths_raw:
                    try:
                        media_paths = json.loads(media_paths_raw)
                        logger.debug("Parsed media_paths for message: %s", media_paths)
                    except Exception as e:
                        logger.warning("Failed to parse media_paths: %s, error: %s", media_paths_raw, e)

                msg_id = row["id"] if hasattr(row, "keys") else row[0]
                is_edited_raw = row["is_edited"] if hasattr(row, "keys") else row[10]
                is_edited = bool(is_edited_raw) if is_edited_raw is not None else False
                audio_summary = row["audio_summary"] if hasattr(row, "keys") else row[11]
                file_path = row["file_path"] if hasattr(row, "keys") else (row[12] if len(row) > 12 else None)
                file_name = row["file_name"] if hasattr(row, "keys") else (row[13] if len(row) > 13 else None)

                msg_data = {
                    "id": msg_id,
                    "sender": row["sender_username"] if hasattr(row, "keys") else row[1],
                    "text": row["message_text"] if hasattr(row, "keys") else row[2],
                    "image": row["image_path"] if hasattr(row, "keys") else row[3],
                    "voice": row["voice_path"] if hasattr(row, "keys") else row[4],
                    "video": row["video_path"] if hasattr(row, "keys") else row[5],
                    "media_paths": media_paths,
                    "file_path": file_path,
                    "file_name": file_name,
                    "document": file_path,
                    "client_key": row["client_key"] if hasattr(row, "keys") else row[7],
                    "created_at": row["created_at"] if hasattr(row, "keys") else row[8],
                    "profile_picture": gc._public_profile_picture_url(
                        row["profile_picture"] if hasattr(row, "keys") else row[9]
                    ),
                    "is_edited": is_edited,
                    "audio_summary": audio_summary,
                    "reaction": None,
                }
                messages.append(msg_data)

            gc._merge_user_group_message_reactions(c, messages, username, ph)

            if messages:
                max_id = max(m["id"] for m in messages)
                now = datetime.now().isoformat()
                try:
                    c.execute(
                        f"""
                        INSERT INTO group_chat_read_receipts (group_id, username, last_read_message_id, last_read_at)
                        VALUES ({ph}, {ph}, {ph}, {ph})
                        ON CONFLICT(group_id, username) DO UPDATE SET
                            last_read_message_id = MAX(last_read_message_id, {ph}),
                            last_read_at = {ph}
                    """,
                        (group_id, username, max_id, now, max_id, now),
                    )
                except Exception:
                    c.execute(
                        f"""
                        INSERT INTO group_chat_read_receipts (group_id, username, last_read_message_id, last_read_at)
                        VALUES ({ph}, {ph}, {ph}, {ph})
                        ON DUPLICATE KEY UPDATE
                            last_read_message_id = GREATEST(last_read_message_id, {ph}),
                            last_read_at = {ph}
                    """,
                        (group_id, username, max_id, now, max_id, now),
                    )
                conn.commit()

            if not (since_id and since_id > 0):
                messages.reverse()
            messages = gc._enrich_group_message_profile_pictures(messages)

            steve_is_typing = is_group_typing(group_id)

            return (
                {
                    "success": True,
                    "messages": messages,
                    "steve_is_typing": steve_is_typing,
                    "has_more": len(messages) == limit,
                },
                200,
            )

    except Exception as e:
        logger.error("Error getting messages for group %s: %s", group_id, e)
        return {"success": False, "error": "Failed to load messages"}, 500
