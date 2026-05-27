"""DM photo/video/audio/grouped-media send paths. Extracted from bodybuilding_app monolith."""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Optional, Tuple

from backend.services.chat_message_preview import format_chat_message_preview
from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.media import save_uploaded_file
from backend.services.notifications import push_privacy_summary, send_push_to_user
from backend.services.steve_dm_reply import start_steve_dm_reply_if_allowed
from redis_cache import invalidate_message_cache

logger = logging.getLogger(__name__)


def _resolve_recipient(cursor, recipient_id: Any) -> Optional[str]:
    ph = get_sql_placeholder()
    cursor.execute(f"SELECT username FROM users WHERE id = {ph}", (recipient_id,))
    row = cursor.fetchone()
    if not row:
        return None
    return row["username"] if hasattr(row, "keys") else row[0]


def _blocked_pair(cursor, username: str, recipient_username: str) -> bool:
    try:
        ph = get_sql_placeholder()
        cursor.execute(
            f"""
            SELECT 1 FROM blocked_users
            WHERE (blocker_username = {ph} AND blocked_username = {ph})
            OR (blocker_username = {ph} AND blocked_username = {ph})
        """,
            (username, recipient_username, recipient_username, username),
        )
        return cursor.fetchone() is not None
    except Exception as block_check_err:
        logger.warning("Could not check blocked status: %s", block_check_err)
        return False


def _upsert_dm_notification(
    cursor,
    conn,
    *,
    recipient_username: str,
    sender_username: str,
    link: str,
    preview: str,
) -> None:
    try:
        if USE_MYSQL:
            cursor.execute(
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
                    sender_username,
                    f"You have new messages from {sender_username}",
                    link,
                    preview,
                ),
            )
        else:
            cursor.execute(
                """
                INSERT INTO notifications (user_id, from_user, type, post_id, community_id, message, created_at, is_read, link, preview_text)
                VALUES (?, ?, 'message', NULL, NULL, ?, datetime('now'), 0, ?, ?)
                ON CONFLICT(user_id, from_user, type, post_id, community_id)
                DO UPDATE SET created_at = datetime('now'), is_read = 0, message = excluded.message, link = excluded.link, preview_text = excluded.preview_text
            """,
                (
                    recipient_username,
                    sender_username,
                    f"You have new messages from {sender_username}",
                    link,
                    preview,
                ),
            )
        conn.commit()
    except Exception as notif_e:
        logger.warning("Could not create/update DM notification: %s", notif_e)


def _should_push_dm(recipient_username: str, sender_username: str, *, check_mute: bool = True) -> bool:
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
                    (recipient_username, sender_username),
                )
            else:
                c2.execute(
                    """
                    SELECT 1 FROM active_chat_status
                    WHERE user=? AND peer=? AND datetime(updated_at) > datetime('now','-20 seconds')
                    LIMIT 1
                """,
                    (recipient_username, sender_username),
                )
            if c2.fetchone():
                should_push = False
    except Exception as pe:
        logger.warning("active chat presence check failed: %s", pe)

    if should_push and check_mute:
        try:
            with get_db_connection() as conn3:
                c3 = conn3.cursor()
                ph = get_sql_placeholder()
                c3.execute(
                    f"SELECT 1 FROM user_muted_chats WHERE username={ph} AND chat_key={ph}",
                    (recipient_username, f"dm:{sender_username}"),
                )
                if c3.fetchone():
                    should_push = False
                    logger.debug(
                        "Suppressing push for %s - DM with %s is muted",
                        recipient_username,
                        sender_username,
                    )
        except Exception as mute_err:
            logger.warning("Mute check failed: %s", mute_err)
    return should_push


def send_dm_photo_message(
    username: str,
    *,
    recipient_id: Any = None,
    message: str = "",
    photo: Any = None,
) -> dict:
    """Send a photo DM. Returns JSON-serializable payload (HTTP 200)."""
    if not recipient_id:
        return {"success": False, "error": "Recipient required"}
    if not photo:
        return {"success": False, "error": "No photo uploaded"}
    if getattr(photo, "filename", "") == "":
        return {"success": False, "error": "No photo selected"}

    try:
        with get_db_connection() as conn:
            c = conn.cursor()

            recipient_username = _resolve_recipient(c, recipient_id)
            if not recipient_username:
                return {"success": False, "error": "Recipient not found"}

            if _blocked_pair(c, username, recipient_username):
                return {"success": False, "error": "Unable to send message to this user"}

            stored_path = save_uploaded_file(
                photo,
                subfolder="message_photos",
                allowed_extensions={"png", "jpg", "jpeg", "gif", "webp"},
            )
            if not stored_path:
                return {"success": False, "error": "Failed to save photo"}

            relative_path = stored_path

            c.execute(
                """
                SELECT id FROM messages
                WHERE sender = ? AND receiver = ? AND image_path = ?
                AND timestamp > DATE_SUB(NOW(), INTERVAL 5 SECOND)
                LIMIT 1
            """,
                (username, recipient_username, relative_path),
            )

            if c.fetchone():
                return {"success": True, "message": "Photo already sent"}

            c.execute(
                """
                INSERT INTO messages (sender, receiver, message, image_path, timestamp)
                VALUES (?, ?, ?, ?, NOW())
            """,
                (username, recipient_username, message, relative_path),
            )

            conn.commit()
            inserted_id = getattr(c, "lastrowid", None)
            inserted_time = None
            if inserted_id:
                try:
                    if USE_MYSQL:
                        c.execute("SELECT timestamp FROM messages WHERE id = %s", (inserted_id,))
                    else:
                        c.execute("SELECT timestamp FROM messages WHERE id = ?", (inserted_id,))
                    row = c.fetchone()
                    if row is not None:
                        inserted_time = row["timestamp"] if hasattr(row, "keys") else row[0]
                except Exception:
                    inserted_time = None

            try:
                from backend.services.firestore_writes import write_dm_message

                write_dm_message(
                    sender=username,
                    receiver=recipient_username,
                    message_id=inserted_id,
                    text=message,
                    image_path=relative_path,
                )
            except Exception:
                pass

            invalidate_message_cache(username, recipient_username)

            _photo_dm_link = f"/user_chat/chat/{username}"
            _photo_preview = format_chat_message_preview(message, image_path=relative_path) or "Photo"
            _upsert_dm_notification(
                c,
                conn,
                recipient_username=recipient_username,
                sender_username=username,
                link=_photo_dm_link,
                preview=_photo_preview,
            )

            try:
                if _should_push_dm(recipient_username, username):
                    send_push_to_user(
                        recipient_username,
                        {
                            "title": f"Photo from {username}",
                            "body": _photo_preview,
                            "summary_body": push_privacy_summary(
                                recipient_username, "dm_photo", author=username
                            ),
                            "url": f"/user_chat/chat/{username}",
                            "tag": f"message-{username}-{inserted_id}",
                        },
                    )
            except Exception as _e:
                logger.warning("push send_photo_message warn: %s", _e)

            photo_caption = (message or "").strip()
            from backend.services.steve_chat_images import STEVE_SHARED_PHOTO_USER_MESSAGE

            steve_trigger_msg = photo_caption if photo_caption else STEVE_SHARED_PHOTO_USER_MESSAGE
            steve_started, _steve_ent = start_steve_dm_reply_if_allowed(
                username,
                steve_trigger_msg,
                recipient_username,
            )

            response_payload = {
                "success": True,
                "message": "Photo sent successfully",
                "image_path": relative_path,
                "id": inserted_id,
                "time": inserted_time,
            }
            if steve_started:
                response_payload["steve_is_typing"] = True
            if _steve_ent:
                response_payload["entitlements_error"] = _steve_ent
            return response_payload

    except Exception as e:
        logger.error("Error sending photo message: %s", e)
        return {"success": False, "error": "Failed to send photo"}


def send_dm_grouped_media(
    username: str,
    *,
    recipient_id: Any = None,
    media_files: list | None = None,
    media_urls: list | None = None,
    upload_only: bool = False,
) -> Tuple[dict, int]:
    """Upload and send grouped photo/video DM. Returns (payload, http_status)."""
    if not recipient_id:
        return {"success": False, "error": "Recipient required"}, 400

    files_to_upload = media_files or []
    url_list = media_urls or []

    if not files_to_upload and not url_list:
        return {"success": False, "error": "No media provided"}, 400

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()

            recipient_username = _resolve_recipient(c, recipient_id)
            if not recipient_username:
                return {"success": False, "error": "Recipient not found"}, 404

            if _blocked_pair(c, username, recipient_username):
                return {"success": False, "error": "Unable to send message to this user"}, 403

            uploaded_paths = []
            for media_type, f in files_to_upload:
                if media_type == "photo":
                    allowed_ext = {"png", "jpg", "jpeg", "gif", "webp"}
                    subfolder = "message_photos"
                else:
                    allowed_ext = {"mp4", "mov", "m4v", "webm", "avi"}
                    subfolder = "message_videos"
                try:
                    stored = save_uploaded_file(f, subfolder=subfolder, allowed_extensions=allowed_ext)
                    if stored:
                        uploaded_paths.append(stored)
                except Exception as ue:
                    logger.warning("send_dm_media upload error: %s", ue)

            for url in url_list:
                uploaded_paths.append(url)

            if not uploaded_paths:
                return {"success": False, "error": "All uploads failed"}, 400

            if upload_only:
                return {"success": True, "media_paths": uploaded_paths}, 200

            media_paths_json = json.dumps(uploaded_paths)
            first_image = next(
                (
                    p
                    for p in uploaded_paths
                    if any(p.lower().endswith(e) for e in (".png", ".jpg", ".jpeg", ".gif", ".webp"))
                ),
                None,
            )
            first_video = next(
                (
                    p
                    for p in uploaded_paths
                    if any(p.lower().endswith(e) for e in (".mp4", ".mov", ".m4v", ".webm", ".avi"))
                ),
                None,
            )

            if USE_MYSQL:
                c.execute(
                    """
                    INSERT INTO messages (sender, receiver, message, image_path, video_path, media_paths, timestamp)
                    VALUES (%s, %s, %s, %s, %s, %s, NOW())
                """,
                    (username, recipient_username, "", first_image, first_video, media_paths_json),
                )
            else:
                c.execute(
                    """
                    INSERT INTO messages (sender, receiver, message, image_path, video_path, media_paths, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                """,
                    (username, recipient_username, "", first_image, first_video, media_paths_json),
                )

            conn.commit()
            inserted_id = getattr(c, "lastrowid", None)
            inserted_time = None
            if inserted_id:
                try:
                    c.execute(f"SELECT timestamp FROM messages WHERE id = {ph}", (inserted_id,))
                    ts_row = c.fetchone()
                    if ts_row:
                        inserted_time = ts_row["timestamp"] if hasattr(ts_row, "keys") else ts_row[0]
                except Exception:
                    pass

            try:
                from backend.services.firestore_writes import write_dm_message

                write_dm_message(
                    sender=username,
                    receiver=recipient_username,
                    message_id=inserted_id,
                    text="",
                    image_path=first_image,
                    video_path=first_video,
                    media_paths=uploaded_paths,
                )
            except Exception:
                pass

            invalidate_message_cache(username, recipient_username)

            count = len(uploaded_paths)
            _ = count  # preserved from monolith (unused)
            _dm_media_preview = (
                format_chat_message_preview(
                    "",
                    image_path=first_image,
                    video_path=first_video,
                    media_paths=uploaded_paths,
                )
                or ("Photo" if first_image else "Video")
            )
            _dm_media_link = f"/user_chat/chat/{username}"

            try:
                if USE_MYSQL:
                    c.execute(
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
                        (
                            recipient_username,
                            username,
                            f"You have new messages from {username}",
                            _dm_media_link,
                            _dm_media_preview,
                        ),
                    )
                else:
                    c.execute(
                        f"""
                        INSERT INTO notifications (user_id, from_user, type, post_id, community_id, message, created_at, is_read, link, preview_text)
                        VALUES ({ph}, {ph}, 'message', NULL, NULL, {ph}, datetime('now'), 0, {ph}, {ph})
                        ON CONFLICT(user_id, from_user, type, post_id, community_id)
                        DO UPDATE SET created_at = datetime('now'), is_read = 0, message = excluded.message, link = excluded.link, preview_text = excluded.preview_text
                    """,
                        (
                            recipient_username,
                            username,
                            f"You have new messages from {username}",
                            _dm_media_link,
                            _dm_media_preview,
                        ),
                    )
                conn.commit()
            except Exception:
                pass

            try:
                if _should_push_dm(recipient_username, username):
                    send_push_to_user(
                        recipient_username,
                        {
                            "title": f"Media from {username}",
                            "body": _dm_media_preview,
                            "summary_body": push_privacy_summary(
                                recipient_username, "dm_media", author=username
                            ),
                            "url": f"/user_chat/chat/{username}",
                            "tag": f"message-{username}-{inserted_id}",
                        },
                    )
            except Exception:
                pass

            from backend.services.steve_chat_images import STEVE_SHARED_PHOTO_USER_MESSAGE

            steve_started, _steve_ent = (False, None)
            if first_image:
                steve_started, _steve_ent = start_steve_dm_reply_if_allowed(
                    username,
                    STEVE_SHARED_PHOTO_USER_MESSAGE,
                    recipient_username,
                )

            media_response = {
                "success": True,
                "id": inserted_id,
                "media_paths": uploaded_paths,
                "time": inserted_time,
            }
            if steve_started:
                media_response["steve_is_typing"] = True
            if _steve_ent:
                media_response["entitlements_error"] = _steve_ent
            return media_response, 200

    except Exception as e:
        logger.error("Error in send_dm_media: %s", e, exc_info=True)
        return {"success": False, "error": "Failed to send media"}, 500


def send_dm_video_message(
    username: str,
    *,
    recipient_id: Any = None,
    message: str = "",
    video: Any = None,
    video_url: str = "",
) -> dict:
    """Send a video DM. Returns JSON-serializable payload (HTTP 200)."""
    if not recipient_id:
        return {"success": False, "error": "Recipient required"}

    video_url = (video_url or "").strip()
    if video_url and video_url.startswith("http"):
        relative_path = video_url
    elif video is not None:
        if getattr(video, "filename", "") == "":
            return {"success": False, "error": "No video selected"}
        stored_path = save_uploaded_file(video, subfolder="message_videos")
        if not stored_path:
            return {"success": False, "error": "Invalid video type"}
        relative_path = stored_path[7:] if stored_path.startswith("uploads/") else stored_path
    else:
        return {"success": False, "error": "No video uploaded"}

    try:
        with get_db_connection() as conn:
            c = conn.cursor()

            recipient_username = _resolve_recipient(c, recipient_id)
            if not recipient_username:
                return {"success": False, "error": "Recipient not found"}

            c.execute(
                """
                INSERT INTO messages (sender, receiver, message, video_path, timestamp)
                VALUES (?, ?, ?, ?, NOW())
            """,
                (username, recipient_username, message, relative_path),
            )
            conn.commit()

            inserted_id = getattr(c, "lastrowid", None)
            inserted_time = None
            if inserted_id:
                try:
                    if USE_MYSQL:
                        c.execute("SELECT timestamp FROM messages WHERE id = %s", (inserted_id,))
                    else:
                        c.execute("SELECT timestamp FROM messages WHERE id = ?", (inserted_id,))
                    row = c.fetchone()
                    if row is not None:
                        inserted_time = row["timestamp"] if hasattr(row, "keys") else row[0]
                except Exception:
                    inserted_time = None

            try:
                from backend.services.firestore_writes import write_dm_message

                write_dm_message(
                    sender=username,
                    receiver=recipient_username,
                    message_id=inserted_id,
                    text=message,
                    video_path=relative_path,
                )
            except Exception:
                pass

            invalidate_message_cache(username, recipient_username)

            _video_dm_link = f"/user_chat/chat/{username}"
            _video_preview = format_chat_message_preview(message, video_path=relative_path) or "Video"
            _upsert_dm_notification(
                c,
                conn,
                recipient_username=recipient_username,
                sender_username=username,
                link=_video_dm_link,
                preview=_video_preview,
            )

            try:
                if _should_push_dm(recipient_username, username, check_mute=False):
                    send_push_to_user(
                        recipient_username,
                        {
                            "title": f"Video from {username}",
                            "body": _video_preview,
                            "summary_body": push_privacy_summary(
                                recipient_username, "dm_video", author=username
                            ),
                            "url": f"/user_chat/chat/{username}",
                            "tag": f"message-{username}-{inserted_id}",
                        },
                    )
            except Exception as _e:
                logger.warning("push send_video_message warn: %s", _e)

            time_str = None
            if inserted_time is not None:
                if hasattr(inserted_time, "strftime"):
                    time_str = inserted_time.strftime("%Y-%m-%d %H:%M:%S")
                else:
                    time_str = str(inserted_time)

            return {
                "success": True,
                "video_path": relative_path,
                "id": inserted_id,
                "time": time_str,
            }
    except Exception as e:
        logger.error("Error sending video message: %s", e, exc_info=True)
        return {"success": False, "error": "Failed to send video"}


def send_dm_audio_message(
    username: str,
    *,
    recipient_id: Any = None,
    audio: Any = None,
    duration_seconds: Optional[int] = None,
    include_summary: bool = False,
) -> dict:
    """Send a voice DM. Returns JSON-serializable payload (HTTP 200)."""
    _ = include_summary  # monolith reads but does not branch on it
    if not recipient_id:
        return {"success": False, "error": "Recipient required"}
    if not audio:
        return {"success": False, "error": "No audio uploaded"}
    if getattr(audio, "filename", "") == "":
        return {"success": False, "error": "No audio selected"}

    allowed_mimes = {
        "audio/webm": "webm",
        "audio/ogg": "ogg",
        "audio/mpeg": "mp3",
        "audio/mp4": "m4a",
        "audio/x-m4a": "m4a",
        "audio/aac": "aac",
        "audio/wav": "wav",
        "audio/3gpp": "3gp",
        "audio/3gpp2": "3g2",
    }
    mime = (getattr(audio, "mimetype", None) or "").lower()
    if mime in allowed_mimes:
        ext = allowed_mimes[mime]
    else:
        try:
            ext = audio.filename.rsplit(".", 1)[1].lower()
        except Exception:
            ext = "webm"
    _ = ext  # monolith assigns but only uses for logging context

    try:
        with get_db_connection() as conn:
            c = conn.cursor()

            recipient_username = _resolve_recipient(c, recipient_id)
            if not recipient_username:
                return {"success": False, "error": "Recipient not found"}

            stored_path = save_uploaded_file(
                audio,
                subfolder="voice_messages",
                allowed_extensions={
                    "webm",
                    "ogg",
                    "mp3",
                    "m4a",
                    "wav",
                    "opus",
                    "aac",
                    "caf",
                    "3gp",
                    "3g2",
                    "mpeg",
                    "mp4",
                },
            )
            if not stored_path:
                logger.error(
                    "Failed to save audio: filename=%s, mimetype=%s, content_length=%s",
                    getattr(audio, "filename", None),
                    getattr(audio, "mimetype", None),
                    getattr(audio, "content_length", None),
                )
                return {"success": False, "error": "Failed to save audio - unsupported format"}

            rel_path = stored_path

            audio_summary = None
            try:
                logger.info("Generating AI summary for chat voice note: %s", rel_path)
                from bodybuilding_app import process_audio_for_summary

                audio_summary = process_audio_for_summary(
                    rel_path,
                    username=username,
                    duration_seconds=duration_seconds,
                )
                if audio_summary:
                    logger.info("AI summary generated for chat: %s...", audio_summary[:100])
            except Exception as e:
                logger.error("Error generating AI summary for chat voice note: %s", e)
                audio_summary = None

            try:
                c.execute("ALTER TABLE messages ADD COLUMN audio_summary TEXT")
                conn.commit()
            except Exception:
                pass

            c.execute(
                """
                INSERT INTO messages (sender, receiver, message, audio_path, audio_duration_seconds, audio_mime, audio_summary, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
            """,
                (username, recipient_username, "", rel_path, duration_seconds, mime, audio_summary),
            )
            conn.commit()

            message_id = c.lastrowid

            try:
                from backend.services.firestore_writes import write_dm_message

                write_dm_message(
                    sender=username,
                    receiver=recipient_username,
                    message_id=message_id,
                    audio_path=rel_path,
                    audio_duration_seconds=duration_seconds,
                    audio_mime=mime,
                    audio_summary=audio_summary,
                )
            except Exception:
                pass

            invalidate_message_cache(username, recipient_username)

            _audio_dm_link = f"/user_chat/chat/{username}"
            _audio_preview = (
                format_chat_message_preview("", audio_path=rel_path, audio_summary=audio_summary)
                or "Voice message"
            )
            _upsert_dm_notification(
                c,
                conn,
                recipient_username=recipient_username,
                sender_username=username,
                link=_audio_dm_link,
                preview=_audio_preview,
            )

            try:
                if _should_push_dm(recipient_username, username):
                    send_push_to_user(
                        recipient_username,
                        {
                            "title": f"Voice message from {username}",
                            "body": _audio_preview,
                            "summary_body": push_privacy_summary(
                                recipient_username, "dm_voice", author=username
                            ),
                            "url": f"/user_chat/chat/{username}",
                            "tag": f"message-{username}-audio-{int(time.time() * 1000)}",
                        },
                    )
            except Exception as _e:
                logger.warning("push send_audio_message warn: %s", _e)

            return {
                "success": True,
                "message_id": message_id,
                "audio_path": rel_path,
                "audio_summary": audio_summary,
            }
    except Exception as e:
        logger.error("Error sending audio message: %s", e)
        return {"success": False, "error": "Failed to send audio"}


def parse_grouped_media_request(form, files) -> Tuple[list, list, bool]:
    """Parse multipart form for send_dm_grouped_media from Flask request."""
    upload_only = form.get("upload_only", "").lower() in ("1", "true", "yes")

    files_to_upload = []
    for f in files.getlist("media"):
        if f and f.filename:
            if f.mimetype and f.mimetype.startswith("video/"):
                files_to_upload.append(("video", f))
            else:
                files_to_upload.append(("photo", f))

    media_urls = []
    try:
        urls_json = form.get("media_urls", "")
        if urls_json:
            parsed = json.loads(urls_json)
            if isinstance(parsed, list):
                media_urls = [u for u in parsed if isinstance(u, str) and u.startswith("http")]
    except (json.JSONDecodeError, TypeError):
        pass

    return files_to_upload, media_urls, upload_only
