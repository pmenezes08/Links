"""Notification-related routes and cron endpoints."""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from functools import wraps

from flask import (
    Blueprint,
    current_app,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)

from backend.services.database import USE_MYSQL, get_db_connection
from backend.services.notifications import (
    check_single_event_notifications,
    check_single_poll_notifications,
)


notifications_bp = Blueprint("notifications", __name__)


def _login_required(view_func):
    """Lightweight login_required that avoids circular imports."""

    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            try:
                current_app.logger.info("No username in session for %s, redirecting to login", request.path)
            except Exception:
                pass
            return redirect(url_for("auth.login"))
        return view_func(*args, **kwargs)

    return wrapper


@notifications_bp.route("/notifications", endpoint="notifications_page")
@_login_required
def notifications_page():
    """Display notifications page: Mobile -> React SPA, Desktop -> HTML template."""
    logger = current_app.logger
    username = session.get("username")
    logger.info("Notifications page accessed by %s", username)
    try:
        ua = request.headers.get("User-Agent", "")
        is_mobile = any(k in ua for k in ("Mobi", "Android", "iPhone", "iPad"))
        if is_mobile:
            base_dir = current_app.root_path
            dist_dir = os.path.join(base_dir, "client", "dist")
            return send_from_directory(dist_dir, "index.html")
    except Exception as exc:
        logger.warning("React notifications fallback: %s", exc)
    return render_template("notifications.html", username=username)


@notifications_bp.route("/api/notifications/check", endpoint="check_new_notifications")
@_login_required
def check_new_notifications():
    """Check for new notifications since last check timestamp."""
    username = session["username"]
    last_check = request.args.get("since", "")

    try:
        if not last_check:
            last_check = (datetime.now() - timedelta(seconds=5)).strftime("%Y-%m-%d %H:%M:%S")

        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                """
                SELECT id, from_user, type, post_id, community_id, message, is_read, created_at, link
                FROM notifications
                WHERE user_id = ? AND is_read = 0 AND created_at > ?
                ORDER BY created_at DESC
                LIMIT 10
                """,
                (username, last_check),
            )

            notifications = []
            for row in c.fetchall():
                notifications.append(
                    {
                        "id": row["id"],
                        "from_user": row["from_user"],
                        "type": row["type"],
                        "post_id": row["post_id"],
                        "community_id": row["community_id"],
                        "message": row["message"],
                        "is_read": row["is_read"],
                        "created_at": row["created_at"],
                        "link": row.get("link") if hasattr(row, "get") else None,
                    }
                )

            return jsonify(
                {
                    "success": True,
                    "notifications": notifications,
                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                }
            )
    except Exception as exc:
        current_app.logger.error("Error checking notifications: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@notifications_bp.route("/api/notifications", endpoint="get_notifications")
@_login_required
def get_notifications():
    """Get notifications for the current user."""
    username = session["username"]
    show_all = request.args.get("all", "false").lower() == "true"

    try:
        with get_db_connection() as conn:
            c = conn.cursor()

            if USE_MYSQL:
                c.execute(
                    """
                    DELETE FROM notifications
                    WHERE user_id = ?
                    AND is_read = 1
                    AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
                    """,
                    (username,),
                )
            else:
                c.execute(
                    """
                    DELETE FROM notifications
                    WHERE user_id = ?
                    AND is_read = 1
                    AND datetime(created_at) < datetime('now','-7 day')
                    """,
                    (username,),
                )
            conn.commit()

            if show_all:
                c.execute(
                    """
                    SELECT id, from_user, type, post_id, community_id, message, is_read, created_at, link
                    FROM notifications
                    WHERE user_id = ?
                    ORDER BY created_at DESC
                    LIMIT 50
                    """,
                    (username,),
                )
            else:
                c.execute(
                    """
                    SELECT id, from_user, type, post_id, community_id, message, is_read, created_at, link
                    FROM notifications
                    WHERE user_id = ? AND is_read = 0
                    ORDER BY created_at DESC
                    LIMIT 50
                    """,
                    (username,),
                )

            notifications = []
            for row in c.fetchall():
                notifications.append(
                    {
                        "id": row["id"],
                        "from_user": row["from_user"],
                        "type": row["type"],
                        "post_id": row["post_id"],
                        "community_id": row["community_id"],
                        "message": row["message"],
                        "link": row.get("link") if hasattr(row, "get") else None,
                        "is_read": bool(row["is_read"]),
                        "created_at": row["created_at"],
                    }
                )

            current_app.logger.info(
                "User %s has %d notifications, %d unread",
                username,
                len(notifications),
                sum(1 for n in notifications if not n["is_read"]),
            )
            return jsonify({"success": True, "notifications": notifications})
    except Exception as exc:
        current_app.logger.error("Error getting notifications: %s", exc)
        return jsonify({"success": False, "error": "Server error"}), 500


@notifications_bp.route(
    "/api/notifications/<int:notification_id>/read",
    methods=["POST"],
    endpoint="mark_notification_read",
)
@_login_required
def mark_notification_read(notification_id: int):
    """Mark a notification as read."""
    username = session["username"]

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                """
                UPDATE notifications
                SET is_read = 1
                WHERE id = ? AND user_id = ?
                """,
                (notification_id, username),
            )
            conn.commit()
        return jsonify({"success": True})
    except Exception as exc:
        current_app.logger.error("Error marking notification as read: %s", exc)
        return jsonify({"success": False, "error": "Server error"}), 500


@notifications_bp.route("/api/notifications/mark-all-read", methods=["POST"], endpoint="mark_all_notifications_read")
@_login_required
def mark_all_notifications_read():
    """Mark all notifications as read for the current user."""
    username = session["username"]
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                """
                UPDATE notifications
                SET is_read = 1
                WHERE user_id = ? AND is_read = 0
                """,
                (username,),
            )
            conn.commit()
        return jsonify({"success": True})
    except Exception as exc:
        current_app.logger.error("Error marking all notifications as read: %s", exc)
        return jsonify({"success": False, "error": "Server error"}), 500


@notifications_bp.route("/api/notifications/delete-read", methods=["POST"], endpoint="delete_read_notifications")
@_login_required
def delete_read_notifications():
    """Delete all read notifications for the current user."""
    username = session["username"]
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                """
                DELETE FROM notifications
                WHERE user_id = ? AND is_read = 1
                """,
                (username,),
            )
            conn.commit()
            deleted_count = c.rowcount
        return jsonify({"success": True, "deleted": deleted_count})
    except Exception as exc:
        current_app.logger.error("Error deleting read notifications: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@notifications_bp.route("/api/admin/broadcast_notification", methods=["POST"], endpoint="admin_broadcast_notification")
@_login_required
def admin_broadcast_notification():
    """Send a platform-wide notification from the admin dashboard."""
    from bodybuilding_app import is_app_admin

    username = session.get("username")
    if not is_app_admin(username):
        return jsonify({"success": False, "error": "Unauthorized"}), 403

    try:
        payload = request.get_json() or {}
    except Exception:
        payload = {}

    title = (payload.get("title") or "").strip()
    message_body = (payload.get("message") or "").strip()
    link = (payload.get("link") or "").strip()

    if not title and not message_body:
        return jsonify({"success": False, "error": "Message is required"}), 400
    if len(title) > 140:
        return jsonify({"success": False, "error": "Title must be 140 characters or fewer"}), 400

    composite_message = title if title else ""
    if message_body:
        composite_message = f"{title}\n\n{message_body}".strip() if composite_message else message_body
    if len(composite_message) > 2000:
        return jsonify({"success": False, "error": "Message is too long (max 2000 characters)"}), 400

    link_value = link or None
    broadcast_token = datetime.now().strftime("%Y%m%d%H%M%S")
    notification_type = f"admin_broadcast:{broadcast_token}"
    created_at_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT username FROM users WHERE COALESCE(is_active, 1) = 1")
            rows = c.fetchall() or []
            notified = 0

            for row in rows:
                target_username = row["username"] if hasattr(row, "keys") else row[0]
                if not target_username:
                    continue
                try:
                    if USE_MYSQL:
                        c.execute(
                            """
                            INSERT INTO notifications (user_id, from_user, type, message, created_at, is_read, link)
                            VALUES (%s, %s, %s, %s, NOW(), 0, %s)
                            """,
                            (target_username, username, notification_type, composite_message, link_value),
                        )
                    else:
                        c.execute(
                            """
                            INSERT INTO notifications (user_id, from_user, type, message, created_at, is_read, link)
                            VALUES (?, ?, ?, ?, ?, 0, ?)
                            """,
                            (target_username, username, notification_type, composite_message, created_at_iso, link_value),
                        )
                    notified += 1
                except Exception as insert_err:
                    current_app.logger.warning("Broadcast notification insert failed for %s: %s", target_username, insert_err)

            conn.commit()
        return jsonify({"success": True, "notified": notified})
    except Exception as exc:
        current_app.logger.error("Error broadcasting notification: %s", exc)
        return jsonify({"success": False, "error": "Failed to send notification"}), 500


@notifications_bp.route("/api/poll_notification_check", methods=["POST"], endpoint="api_poll_notification_check")
def api_poll_notification_check():
    """
    Cron job endpoint to check poll deadlines and send notifications.
    Public endpoint with optional API key protection.
    """
    api_key = request.headers.get("X-API-Key") or request.form.get("api_key")
    expected_key = os.getenv("POLL_CRON_API_KEY")

    if expected_key and api_key != expected_key:
        current_app.logger.warning("Poll notification check called with invalid API key: %s", api_key)
        return jsonify({"success": False, "error": "Invalid API key"}), 401

    try:
        now = datetime.utcnow()
        logger = current_app.logger
        logger.info("🔍 Poll notification check starting - USE_MYSQL=%s", USE_MYSQL)

        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                """
                SELECT p.id, p.expires_at, p.created_at
                FROM polls p
                WHERE p.is_active = 1
                """
            )
            all_polls = c.fetchall()
            near_deadline_polls = []

            for poll in all_polls:
                poll_id = poll["id"] if hasattr(poll, "keys") else poll[0]
                expires_at_raw = poll["expires_at"] if hasattr(poll, "keys") else poll[1]

                if not expires_at_raw:
                    continue
                if isinstance(expires_at_raw, str) and (expires_at_raw.strip() == "" or len(expires_at_raw) < 10):
                    continue

                try:
                    expires_at = (
                        expires_at_raw
                        if isinstance(expires_at_raw, datetime)
                        else datetime.strptime(expires_at_raw, "%Y-%m-%d %H:%M:%S")
                    )
                    time_until_deadline = (expires_at - now).total_seconds() / 3600
                    if 0 < time_until_deadline < 24:
                        near_deadline_polls.append(poll)
                except Exception as parse_err:
                    logger.debug("Skipping poll %s - invalid date: %s", poll_id, parse_err)
                    continue

            logger.info("🔍 %d polls within 24h of deadline", len(near_deadline_polls))
            notifications_sent = 0

            for poll_row in near_deadline_polls:
                poll_id = poll_row["id"] if hasattr(poll_row, "keys") else poll_row[0]
                try:
                    notifications_sent += check_single_poll_notifications(poll_id, conn)
                except Exception as exc:
                    logger.error("Error checking poll %s: %s", poll_id, exc)
                    import traceback

                    logger.error(traceback.format_exc())

            conn.commit()
            logger.info("Poll notification check complete: %d notifications sent", notifications_sent)
            return jsonify({"success": True, "notifications_sent": notifications_sent})
    except Exception as exc:
        current_app.logger.error("Poll notification check error: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@notifications_bp.route("/api/event_notification_check", methods=["POST"], endpoint="api_event_notification_check")
def api_event_notification_check():
    """
    Cron job endpoint that checks upcoming events and sends reminders.
    Public endpoint invoked by cron.
    """
    try:
        logger = current_app.logger
        logger.info("🔍 Event notification check starting - USE_MYSQL=%s", USE_MYSQL)

        with get_db_connection() as conn:
            c = conn.cursor()
            if USE_MYSQL:
                c.execute(
                    """
                    SELECT id, title, date, start_time
                    FROM calendar_events
                    WHERE date >= DATE(NOW())
                    ORDER BY date ASC, start_time ASC
                    """
                )
            else:
                c.execute(
                    """
                    SELECT id, title, date, start_time
                    FROM calendar_events
                    WHERE date >= DATE('now')
                    ORDER BY date ASC, start_time ASC
                    """
                )

            all_events = c.fetchall()
            logger.info("🔍 Found %d upcoming events to check", len(all_events))
            notifications_sent = 0

            for event_row in all_events:
                event_id = event_row["id"] if hasattr(event_row, "keys") else event_row[0]
                try:
                    notifications_sent += check_single_event_notifications(event_id, conn)
                except Exception as exc:
                    logger.error("Error checking event %s: %s", event_id, exc)

            conn.commit()
            logger.info("✅ Event notification check complete: %d notifications sent", notifications_sent)
            return jsonify({"success": True, "notifications_sent": notifications_sent})
    except Exception as exc:
        current_app.logger.error("Event notification check error: %s", exc)
        import traceback

        logger = current_app.logger
        logger.error(traceback.format_exc())
        return jsonify({"success": False, "error": str(exc)}), 500
