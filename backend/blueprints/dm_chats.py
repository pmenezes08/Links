"""Direct-message thread list, unread counts, and clear/delete thread endpoints."""

from __future__ import annotations

import logging
from functools import wraps

from flask import Blueprint, abort, jsonify, request, session

from backend.services import api_errors, auth_session, session_identity
from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.dm_chat_threads import build_chat_threads_payload
from backend.services.dm_chats_tables import ensure_deleted_chat_threads_table
from backend.services.dm_unread import count_dm_unread_excluding_cleared, mark_dm_received_before_clear_as_read
from redis_cache import cache, invalidate_message_cache

logger = logging.getLogger(__name__)

dm_chats_bp = Blueprint("dm_chats", __name__)


@dm_chats_bp.after_request
def _no_store_user_scoped_responses(response):
    return auth_session.no_store(response)


def _login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if not session_identity.valid_session_username(session):
            if request.path.startswith("/api/") or request.path.startswith("/check_"):
                return api_errors.auth_required()
            from flask import redirect, url_for

            return redirect(url_for("auth.login"))
        return view_func(*args, **kwargs)

    return wrapper


@dm_chats_bp.route("/api/chat_threads", methods=["GET"])
@_login_required
def api_chat_threads():
    username = session.get("username")
    payload = build_chat_threads_payload(username)
    if payload.get("success"):
        return jsonify(payload)
    return jsonify(payload), 500


@dm_chats_bp.route("/check_unread_messages", methods=["GET"])
@_login_required
def check_unread_messages():
    username = session["username"]
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()

            dm_unread = count_dm_unread_excluding_cleared(c, username)

            group_unread = 0
            try:
                c.execute(
                    f"""
                    SELECT gcm.group_id, COALESCE(gcr.last_read_message_id, 0) as last_read
                    FROM group_chat_members gcm
                    LEFT JOIN group_chat_read_receipts gcr
                        ON gcm.group_id = gcr.group_id AND gcm.username = gcr.username
                    WHERE gcm.username = {ph}
                    """,
                    (username,),
                )

                for row in c.fetchall():
                    group_id = row["group_id"] if hasattr(row, "keys") else row[0]
                    last_read_id = row["last_read"] if hasattr(row, "keys") else row[1]

                    c.execute(
                        f"""
                        SELECT COUNT(*) as cnt FROM group_chat_messages
                        WHERE group_id = {ph} AND id > {ph} AND is_deleted = 0 AND sender_username != {ph}
                        """,
                        (group_id, last_read_id, username),
                    )
                    cnt_row = c.fetchone()
                    group_unread += cnt_row["cnt"] if hasattr(cnt_row, "keys") else cnt_row[0]
            except Exception as ge:
                logger.warning("Could not count group unread: %s", ge)

            total_unread = dm_unread + group_unread

        return jsonify(
            {
                "unread_count": total_unread,
                "dm_unread": dm_unread,
                "group_unread": group_unread,
            }
        )
    except Exception as e:
        logger.error("Error checking unread messages for %s: %s", username, e)
        abort(500)


@dm_chats_bp.route("/api/chat/clear_history", methods=["POST"])
@_login_required
def clear_chat_history():
    """Clear chat history for the requesting user only. Thread stays visible but empty."""
    username = session.get("username")
    data = request.get_json() or {}
    other_username = data.get("other_username")
    if not other_username:
        return api_errors.error_response("chat.dm.other_username_required", 400)
    ph = get_sql_placeholder()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_deleted_chat_threads_table(c)
            if USE_MYSQL:
                c.execute(
                    f"INSERT INTO deleted_chat_threads (username, other_username, deleted_at) VALUES ({ph},{ph},NOW()) ON DUPLICATE KEY UPDATE deleted_at=NOW()",
                    (username, other_username),
                )
            else:
                c.execute(
                    f"INSERT INTO deleted_chat_threads (username, other_username, deleted_at) VALUES ({ph},{ph},datetime('now')) ON CONFLICT(username, other_username) DO UPDATE SET deleted_at=datetime('now')",
                    (username, other_username),
                )
            mark_dm_received_before_clear_as_read(c, username, other_username)
            conn.commit()
            try:
                invalidate_message_cache(username, other_username)
            except Exception:
                try:
                    cache.delete(f"chat_threads:{username}")
                except Exception:
                    pass
        return jsonify({"success": True})
    except Exception as e:
        logger.error("clear_chat_history error: %s", e)
        return jsonify({"success": False, "error": "Server error"}), 500


@dm_chats_bp.route("/delete_chat_thread", methods=["POST"])
@_login_required
def delete_chat_thread():
    """WhatsApp-style one-sided delete: hides chat for deleter only, no message deletion."""
    username = session["username"]
    other_username = request.form.get("other_username")
    if not other_username:
        return jsonify({"success": False, "error": "Other username required"})
    ph = get_sql_placeholder()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_deleted_chat_threads_table(c)
            if USE_MYSQL:
                c.execute(
                    f"""
                    INSERT INTO deleted_chat_threads (username, other_username, deleted_at)
                    VALUES ({ph}, {ph}, NOW())
                    ON DUPLICATE KEY UPDATE deleted_at = NOW()
                    """,
                    (username, other_username),
                )
            else:
                c.execute(
                    f"""
                    INSERT INTO deleted_chat_threads (username, other_username, deleted_at)
                    VALUES ({ph}, {ph}, datetime('now'))
                    ON CONFLICT(username, other_username) DO UPDATE SET deleted_at = datetime('now')
                    """,
                    (username, other_username),
                )
            mark_dm_received_before_clear_as_read(c, username, other_username)
            conn.commit()
            try:
                invalidate_message_cache(username, other_username)
            except Exception:
                try:
                    cache.delete(f"chat_threads:{username}")
                except Exception:
                    pass
        return jsonify({"success": True})
    except Exception as e:
        logger.error("delete_chat_thread error for %s with %s: %s", username, other_username, e)
        return api_errors.error_response("chat.dm.failed_to_delete_chat", 500)


@dm_chats_bp.route("/api/chat/dm/remove_message_media", methods=["POST"])
@_login_required
def remove_dm_message_media():
    """Remove one attachment from a grouped DM media message (sender only)."""
    username = session.get("username")
    data = request.get_json() or {}
    message_id = data.get("message_id")
    media_url = (data.get("media_url") or "").strip()
    if message_id is None or not media_url:
        return api_errors.error_response("chat.dm.message_id_and_url_required", 400)
    try:
        mid = int(message_id)
    except (TypeError, ValueError):
        return api_errors.error_response("chat.dm.invalid_message_id", 400)

    from backend.services.message_media_utils import (
        parse_media_paths,
        find_media_index,
        first_image_and_video,
        media_paths_json,
    )
    from backend.services.firestore_writes import delete_dm_message, update_dm_message_media

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()

            c.execute(
                f"""
                SELECT sender, receiver, message, media_paths
                FROM messages
                WHERE id = {ph} AND (sender = {ph} OR receiver = {ph})
                """,
                (mid, username, username),
            )
            row = c.fetchone()
            if not row:
                return api_errors.error_response("chat.dm.message_not_found", 404)

            sender = row["sender"] if hasattr(row, "keys") else row[0]
            receiver = row["receiver"] if hasattr(row, "keys") else row[1]
            msg_body = row["message"] if hasattr(row, "keys") else row[2]
            media_raw = row["media_paths"] if hasattr(row, "keys") else row[3]

            if sender != username:
                return api_errors.error_response("chat.dm.edit_own_only", 403)

            paths = parse_media_paths(media_raw)
            if len(paths) < 2:
                return api_errors.error_response("chat.dm.nothing_to_remove", 400)

            idx = find_media_index(paths, media_url)
            if idx < 0:
                return api_errors.error_response("chat.dm.attachment_not_found", 404)

            paths.pop(idx)
            text_empty = not (msg_body or "").strip()

            if not paths:
                if text_empty:
                    c.execute(f"DELETE FROM messages WHERE id = {ph}", (mid,))
                    conn.commit()
                    try:
                        invalidate_message_cache(sender, receiver)
                    except Exception:
                        pass
                    try:
                        delete_dm_message(sender, receiver, mid)
                    except Exception:
                        pass
                    return jsonify({"success": True, "deleted_message": True, "media_paths": []})

                c.execute(
                    f"""
                    UPDATE messages
                    SET media_paths = NULL, image_path = NULL, video_path = NULL
                    WHERE id = {ph}
                    """,
                    (mid,),
                )
                conn.commit()
                try:
                    invalidate_message_cache(sender, receiver)
                except Exception:
                    pass
                try:
                    update_dm_message_media(sender, receiver, mid, None, None, None)
                except Exception:
                    pass
                return jsonify({"success": True, "deleted_message": False, "media_paths": []})

            mp_json = media_paths_json(paths)
            first_img, first_vid = first_image_and_video(paths)
            c.execute(
                f"""
                UPDATE messages
                SET media_paths = {ph}, image_path = {ph}, video_path = {ph}
                WHERE id = {ph}
                """,
                (mp_json, first_img, first_vid, mid),
            )
            conn.commit()
            try:
                invalidate_message_cache(sender, receiver)
            except Exception:
                pass
            try:
                update_dm_message_media(sender, receiver, mid, paths, first_img, first_vid)
            except Exception:
                pass
            return jsonify({"success": True, "deleted_message": False, "media_paths": paths})

    except Exception as e:
        logger.error("remove_dm_message_media: %s", e, exc_info=True)
        return api_errors.error_response("chat.dm.failed_to_update_message", 500)


@dm_chats_bp.route("/api/chat/dm/send_document", methods=["POST"])
@_login_required
def send_dm_document():
    """Upload and send a PDF document in a direct message."""
    username = session.get("username")
    recipient_id = request.form.get("recipient_id")
    document = request.files.get("document")
    caption = (request.form.get("message") or "").strip()

    if not recipient_id:
        return jsonify({"success": False, "error": "Recipient required"}), 400
    if not document or not document.filename:
        return jsonify({"success": False, "error": "No document provided"}), 400

    from backend.services.chat_document_send import send_dm_pdf

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ok, payload, status = send_dm_pdf(
                conn,
                c,
                sender=username,
                recipient_id=recipient_id,
                file_storage=document,
                caption=caption or None,
            )
            return jsonify(payload), status
    except Exception as e:
        logger.error("send_dm_document error for %s: %s", username, e, exc_info=True)
        return api_errors.error_response("chat.dm.failed_to_send", 500)


@dm_chats_bp.route("/api/chat/documents", methods=["GET"])
@_login_required
def get_dm_documents():
    """List PDF documents shared in a DM conversation."""
    username = session.get("username")
    peer = (request.args.get("peer") or "").strip()
    if not peer:
        return jsonify({"success": False, "error": "peer required"}), 400

    from backend.services.chat_documents_list import list_dm_documents

    ok, payload, status = list_dm_documents(username, peer)
    return jsonify(payload), status
