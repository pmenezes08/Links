"""Notification-related routes and cron endpoints."""

from __future__ import annotations

import errno
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


def _handle_broken_pipe(f):
    """Decorator to gracefully handle broken pipe errors (client disconnected)."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except (BrokenPipeError, ConnectionResetError):
            return '', 499
        except OSError as e:
            if e.errno in (errno.EPIPE, errno.ECONNRESET, errno.ENOTCONN):
                return '', 499
            raise
        except IOError as e:
            if 'write error' in str(e).lower() or 'broken pipe' in str(e).lower():
                return '', 499
            raise
    return decorated_function


def _login_required(view_func):
    """Lightweight login_required that avoids circular imports."""

    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            try:
                current_app.logger.info("No username in session for %s", request.path)
            except Exception:
                pass
            # Return JSON for API endpoints, redirect for pages
            if request.path.startswith("/api/"):
                return jsonify({"success": False, "error": "unauthenticated"}), 401
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
@_handle_broken_pipe
def check_new_notifications():
    """Check for new notifications since last check timestamp."""
    username = session["username"]
    last_check = request.args.get("since", "")

    try:
        if not last_check:
            last_check = (datetime.now() - timedelta(seconds=5)).strftime("%Y-%m-%d %H:%M:%S")

        with get_db_connection() as conn:
            c = conn.cursor()
            # Try query with link column, fallback if column doesn't exist
            try:
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
                has_link_column = True
            except Exception:
                c.execute(
                    """
                    SELECT id, from_user, type, post_id, community_id, message, is_read, created_at
                    FROM notifications
                    WHERE user_id = ? AND is_read = 0 AND created_at > ?
                    ORDER BY created_at DESC
                    LIMIT 10
                    """,
                    (username, last_check),
                )
                has_link_column = False

            notifications = []
            for row in c.fetchall():
                link_value = None
                if has_link_column:
                    try:
                        link_value = row.get("link") if hasattr(row, "get") else row["link"]
                    except (KeyError, IndexError):
                        link_value = None
                
                # Handle created_at - ensure it's a string for JSON serialization
                created_at_val = row["created_at"]
                if hasattr(created_at_val, "strftime"):
                    created_at_val = created_at_val.strftime("%Y-%m-%d %H:%M:%S")
                elif created_at_val is None:
                    created_at_val = ""
                
                notifications.append(
                    {
                        "id": row["id"],
                        "from_user": row["from_user"],
                        "type": row["type"],
                        "post_id": row["post_id"],
                        "community_id": row["community_id"],
                        "message": row["message"],
                        "is_read": row["is_read"],
                        "created_at": created_at_val,
                        "link": link_value,
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


@notifications_bp.route("/api/notifications/debug", endpoint="debug_notifications")
@_login_required
def debug_notifications():
    """Debug endpoint to check notifications table."""
    username = session["username"]
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check table structure
            table_info = {}
            try:
                if USE_MYSQL:
                    c.execute("DESCRIBE notifications")
                    columns = []
                    for r in c.fetchall():
                        col_name = r["Field"] if hasattr(r, "keys") else r[0]
                        col_type = r["Type"] if hasattr(r, "keys") else r[1]
                        columns.append({"name": col_name, "type": str(col_type)})
                    table_info["columns"] = columns
                else:
                    c.execute("PRAGMA table_info(notifications)")
                    columns = []
                    for r in c.fetchall():
                        columns.append({"name": r[1], "type": r[2]})
                    table_info["columns"] = columns
            except Exception as te:
                table_info["error"] = str(te)
            
            # Get count of all notifications for user
            c.execute("SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ?", (username,))
            row = c.fetchone()
            total = row["cnt"] if hasattr(row, "keys") else row[0]
            
            # Get total count in table (all users)
            c.execute("SELECT COUNT(*) as cnt FROM notifications")
            row2 = c.fetchone()
            total_all = row2["cnt"] if hasattr(row2, "keys") else row2[0]
            
            # Get count by type
            c.execute("SELECT type, COUNT(*) as cnt FROM notifications WHERE user_id = ? GROUP BY type", (username,))
            type_counts = {}
            for r in c.fetchall():
                t = r["type"] if hasattr(r, "keys") else r[0]
                cnt = r["cnt"] if hasattr(r, "keys") else r[1]
                type_counts[t] = cnt
            
            # Get latest 5 notifications with all fields
            c.execute("""
                SELECT id, from_user, type, post_id, community_id, message, is_read, created_at
                FROM notifications 
                WHERE user_id = ? 
                ORDER BY created_at DESC 
                LIMIT 5
            """, (username,))
            latest = []
            for r in c.fetchall():
                latest.append({
                    "id": r["id"] if hasattr(r, "keys") else r[0],
                    "from_user": r["from_user"] if hasattr(r, "keys") else r[1],
                    "type": r["type"] if hasattr(r, "keys") else r[2],
                    "post_id": r["post_id"] if hasattr(r, "keys") else r[3],
                    "community_id": r["community_id"] if hasattr(r, "keys") else r[4],
                    "message": r["message"] if hasattr(r, "keys") else r[5],
                    "is_read": r["is_read"] if hasattr(r, "keys") else r[6],
                    "created_at": str(r["created_at"] if hasattr(r, "keys") else r[7]),
                })
            
            return jsonify({
                "success": True,
                "username": username,
                "total_notifications": total,
                "total_all_users": total_all,
                "by_type": type_counts,
                "latest_5": latest,
                "table_info": table_info,
                "use_mysql": USE_MYSQL,
            })
    except Exception as exc:
        import traceback
        return jsonify({
            "success": False,
            "error": str(exc),
            "traceback": traceback.format_exc()
        }), 500


@notifications_bp.route("/api/notifications/test-create", methods=["POST"], endpoint="test_create_notification")
@_login_required
def test_create_notification():
    """Create a test notification to verify the system works."""
    username = session["username"]
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            test_message = f"Test notification created at {datetime.now().strftime('%H:%M:%S')}"
            
            if USE_MYSQL:
                # Try with both timestamp and created_at columns
                try:
                    c.execute("""
                        INSERT INTO notifications (user_id, from_user, type, message, timestamp, created_at, is_read)
                        VALUES (%s, %s, 'test', %s, NOW(), NOW(), 0)
                    """, (username, 'system', test_message))
                except Exception:
                    # Fallback if one column doesn't exist
                    try:
                        c.execute("""
                            INSERT INTO notifications (user_id, from_user, type, message, timestamp, is_read)
                            VALUES (%s, %s, 'test', %s, NOW(), 0)
                        """, (username, 'system', test_message))
                    except Exception:
                        c.execute("""
                            INSERT INTO notifications (user_id, from_user, type, message, created_at, is_read)
                            VALUES (%s, %s, 'test', %s, NOW(), 0)
                        """, (username, 'system', test_message))
            else:
                c.execute("""
                    INSERT INTO notifications (user_id, from_user, type, message, created_at, is_read)
                    VALUES (?, ?, 'test', ?, datetime('now'), 0)
                """, (username, 'system', test_message))
            
            conn.commit()
            inserted_id = c.lastrowid
            
            return jsonify({
                "success": True,
                "message": "Test notification created",
                "notification_id": inserted_id,
                "test_message": test_message,
            })
    except Exception as exc:
        import traceback
        return jsonify({
            "success": False,
            "error": str(exc),
            "traceback": traceback.format_exc()
        }), 500


@notifications_bp.route("/api/notifications/fix-schema", methods=["POST"], endpoint="fix_notifications_schema")
@_login_required
def fix_notifications_schema():
    """Fix the notifications table schema - comprehensive fix for timestamp/created_at issues."""
    username = session["username"]
    # Only allow admin to run this
    if username != "admin":
        return jsonify({"success": False, "error": "Admin only"}), 403
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            results = []
            
            if USE_MYSQL:
                # First, check which columns exist
                c.execute("DESCRIBE notifications")
                existing_columns = [r["Field"] if hasattr(r, "keys") else r[0] for r in c.fetchall()]
                results.append(f"Existing columns: {existing_columns}")
                
                # Fix 1: Add default value to timestamp column if it exists
                if "timestamp" in existing_columns:
                    try:
                        c.execute("ALTER TABLE notifications MODIFY COLUMN timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
                        results.append("✅ Modified timestamp column to have default value")
                    except Exception as e:
                        results.append(f"⚠️ timestamp column modify failed: {e}")
                
                # Fix 2: Add created_at column if it doesn't exist
                if "created_at" not in existing_columns:
                    try:
                        c.execute("ALTER TABLE notifications ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
                        results.append("✅ Added created_at column")
                        # Copy data from timestamp to created_at if timestamp exists
                        if "timestamp" in existing_columns:
                            try:
                                c.execute("UPDATE notifications SET created_at = timestamp WHERE created_at IS NULL")
                                results.append("✅ Copied timestamp values to created_at")
                            except Exception as e:
                                results.append(f"⚠️ Could not copy timestamp to created_at: {e}")
                    except Exception as e:
                        results.append(f"⚠️ created_at column add failed: {e}")
                else:
                    # Ensure created_at has default
                    try:
                        c.execute("ALTER TABLE notifications MODIFY COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
                        results.append("✅ Modified created_at column to have default value")
                    except Exception as e:
                        results.append(f"⚠️ created_at column modify failed: {e}")
                
                # Fix 3: Add link column if it doesn't exist
                if "link" not in existing_columns:
                    try:
                        c.execute("ALTER TABLE notifications ADD COLUMN link TEXT")
                        results.append("✅ Added link column")
                    except Exception as e:
                        results.append(f"⚠️ link column add failed: {e}")
                
                conn.commit()
                
                # Verify final schema
                c.execute("DESCRIBE notifications")
                final_columns = [r["Field"] if hasattr(r, "keys") else r[0] for r in c.fetchall()]
                results.append(f"Final columns: {final_columns}")
            
            return jsonify({
                "success": True,
                "results": results,
            })
    except Exception as exc:
        import traceback
        return jsonify({
            "success": False,
            "error": str(exc),
            "traceback": traceback.format_exc()
        }), 500


@notifications_bp.route("/api/notifications", endpoint="get_notifications")
@_login_required
@_handle_broken_pipe
def get_notifications():
    """Get notifications for the current user."""
    username = session["username"]
    show_all = request.args.get("all", "false").lower() == "true"
    current_app.logger.info("📋 get_notifications called for user=%s, show_all=%s", username, show_all)

    try:
        with get_db_connection() as conn:
            c = conn.cursor()

            # Clean up old read notifications (best effort, don't fail if this errors)
            try:
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
            except Exception as cleanup_err:
                current_app.logger.warning("Notification cleanup failed (non-fatal): %s", cleanup_err)

            # Try query with link column, fallback if column doesn't exist
            try:
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
                has_link_column = True
            except Exception as col_err:
                current_app.logger.warning("Link column may not exist, using fallback query: %s", col_err)
                if show_all:
                    c.execute(
                        """
                        SELECT id, from_user, type, post_id, community_id, message, is_read, created_at
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
                        SELECT id, from_user, type, post_id, community_id, message, is_read, created_at
                        FROM notifications
                        WHERE user_id = ? AND is_read = 0
                        ORDER BY created_at DESC
                        LIMIT 50
                        """,
                        (username,),
                    )
                has_link_column = False

            notifications = []
            for row in c.fetchall():
                # Handle link field access for both MySQL dict and SQLite Row
                link_value = None
                if has_link_column:
                    try:
                        link_value = row.get("link") if hasattr(row, "get") else row["link"]
                    except (KeyError, IndexError):
                        link_value = None
                
                # Handle created_at - ensure it's a string for JSON serialization
                created_at_val = row["created_at"]
                if hasattr(created_at_val, "strftime"):
                    created_at_val = created_at_val.strftime("%Y-%m-%d %H:%M:%S")
                elif created_at_val is None:
                    created_at_val = ""
                
                notifications.append(
                    {
                        "id": row["id"],
                        "from_user": row["from_user"],
                        "type": row["type"],
                        "post_id": row["post_id"],
                        "community_id": row["community_id"],
                        "message": row["message"],
                        "link": link_value,
                        "is_read": bool(row["is_read"]),
                        "created_at": created_at_val,
                    }
                )

            current_app.logger.info(
                "User %s has %d notifications, %d unread, types: %s",
                username,
                len(notifications),
                sum(1 for n in notifications if not n["is_read"]),
                list(set(n["type"] for n in notifications)),
            )
            return jsonify({"success": True, "notifications": notifications})
    except Exception as exc:
        import traceback
        current_app.logger.error("Error getting notifications: %s\n%s", exc, traceback.format_exc())
        return jsonify({"success": False, "error": str(exc)}), 500


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
        
        # Send badge update with remaining unread count (messages may still be unread)
        try:
            from backend.services.firebase_notifications import send_fcm_to_user_badge_only, get_total_badge_count
            badge_count = get_total_badge_count(username)
            send_fcm_to_user_badge_only(username, badge_count=badge_count)
            current_app.logger.info(f"Sent badge={badge_count} to {username} after mark all read")
        except Exception as badge_err:
            current_app.logger.warning(f"Could not send badge update: {badge_err}")
        
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
            
        # Send badge update with total unread count (notifications + messages)
        try:
            from backend.services.firebase_notifications import send_fcm_to_user_badge_only, get_total_badge_count
            badge_count = get_total_badge_count(username)
            send_fcm_to_user_badge_only(username, badge_count=badge_count)
            current_app.logger.info(f"Sent badge={badge_count} to {username} after delete read")
        except Exception as badge_err:
            current_app.logger.warning(f"Could not send badge update: {badge_err}")
        
        return jsonify({"success": True, "deleted": deleted_count})
    except Exception as exc:
        current_app.logger.error("Error deleting read notifications: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@notifications_bp.route("/api/notifications/badge-count", methods=["GET"], endpoint="get_badge_count")
@_login_required
def get_badge_count():
    """Get the current badge count (unread notifications + unread messages)."""
    username = session["username"]
    try:
        from backend.services.firebase_notifications import get_total_badge_count
        badge_count = get_total_badge_count(username)
        return jsonify({"success": True, "badge_count": badge_count})
    except Exception as exc:
        current_app.logger.error("Error getting badge count: %s", exc)
        return jsonify({"success": False, "error": str(exc), "badge_count": 0}), 500


@notifications_bp.route("/api/notifications/clear-badge", methods=["POST"], endpoint="clear_notification_badge")
@_login_required
def clear_notification_badge():
    """Sync the iOS badge count with actual unread notifications + messages."""
    username = session["username"]
    try:
        from backend.services.firebase_notifications import send_fcm_to_user_badge_only, get_total_badge_count
        
        # Get actual unread count and send to device
        badge_count = get_total_badge_count(username)
        sent = send_fcm_to_user_badge_only(username, badge_count=badge_count)
        current_app.logger.info(f"Synced badge={badge_count} for {username}, sent to {sent} device(s)")
        return jsonify({"success": True, "badge_count": badge_count, "devices_updated": sent})
    except ImportError:
        # Function not available, just acknowledge the request
        current_app.logger.debug("Badge sync not available (function not implemented)")
        return jsonify({"success": True, "devices_updated": 0})
    except Exception as exc:
        current_app.logger.error("Error syncing notification badge: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@notifications_bp.route("/api/admin/cleanup_duplicate_tokens", methods=["POST"], endpoint="cleanup_duplicate_tokens")
@_login_required
def cleanup_duplicate_tokens():
    """Admin endpoint to clean up duplicate push tokens in the database."""
    from bodybuilding_app import is_app_admin, get_db_connection, get_sql_placeholder, USE_MYSQL

    username = session.get("username")
    if not is_app_admin(username):
        return jsonify({"success": False, "error": "Unauthorized"}), 403

    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        
        # For each user, keep only the most recent token per platform
        # First, get count of duplicates
        if USE_MYSQL:
            # Count duplicates
            cursor.execute("""
                SELECT COUNT(*) FROM fcm_tokens t1
                WHERE EXISTS (
                    SELECT 1 FROM fcm_tokens t2
                    WHERE t2.username = t1.username 
                    AND t2.platform = t1.platform 
                    AND t2.is_active = 1
                    AND t2.last_seen > t1.last_seen
                )
                AND t1.is_active = 1
            """)
            row = cursor.fetchone()
            duplicate_count = row[0] if row else 0
            
            # Deactivate older tokens (keep only the most recent per user/platform)
            cursor.execute("""
                UPDATE fcm_tokens t1
                SET is_active = 0
                WHERE EXISTS (
                    SELECT 1 FROM (
                        SELECT username, platform, MAX(last_seen) as max_seen
                        FROM fcm_tokens
                        WHERE is_active = 1
                        GROUP BY username, platform
                    ) t2
                    WHERE t2.username = t1.username 
                    AND t2.platform = t1.platform 
                    AND t1.last_seen < t2.max_seen
                )
                AND t1.is_active = 1
            """)
            deactivated = cursor.rowcount
        else:
            # SQLite version
            cursor.execute("""
                SELECT COUNT(*) FROM fcm_tokens t1
                WHERE EXISTS (
                    SELECT 1 FROM fcm_tokens t2
                    WHERE t2.username = t1.username 
                    AND t2.platform = t1.platform 
                    AND t2.is_active = 1
                    AND t2.last_seen > t1.last_seen
                )
                AND t1.is_active = 1
            """)
            row = cursor.fetchone()
            duplicate_count = row[0] if row else 0
            
            cursor.execute("""
                UPDATE fcm_tokens
                SET is_active = 0
                WHERE rowid NOT IN (
                    SELECT MAX(rowid)
                    FROM fcm_tokens
                    WHERE is_active = 1
                    GROUP BY username, platform
                )
                AND is_active = 1
            """)
            deactivated = cursor.rowcount
        
        conn.commit()
        cursor.close()
        conn.close()
        
        current_app.logger.info(f"Cleaned up {deactivated} duplicate tokens")
        return jsonify({
            "success": True, 
            "duplicates_found": duplicate_count,
            "tokens_deactivated": deactivated
        })
        
    except Exception as exc:
        current_app.logger.error("Error cleaning up duplicate tokens: %s", exc)
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
