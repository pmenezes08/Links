"""Shared notification helper functions."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from threading import Lock

from pywebpush import WebPushException, webpush

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

# Modern APNs implementation using HTTP/2 (Apple's 2025 recommendation)
try:
    import httpx
    import jwt
    from cryptography.hazmat.primitives import serialization
    APNS_AVAILABLE = True
except ImportError:
    APNS_AVAILABLE = False
    httpx = None  # type: ignore
    jwt = None  # type: ignore


logger = logging.getLogger(__name__)
_PREVIEW_TEXT_COLUMN_ENSURED = False

VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "https://www.c-point.co")
APNS_KEY_PATH = os.getenv("APNS_KEY_PATH")
APNS_KEY_ID = os.getenv("APNS_KEY_ID")
APNS_TEAM_ID = os.getenv("APNS_TEAM_ID")
APNS_BUNDLE_ID = os.getenv("APNS_BUNDLE_ID", "co.cpoint.app")
# Default to production for App Store/TestFlight builds
# Set APNS_USE_SANDBOX=true for Xcode debug builds only
APNS_USE_SANDBOX = os.getenv("APNS_USE_SANDBOX", "false").strip().lower() == "true"
_APNS_JWT_TOKEN = None
_APNS_JWT_EXPIRY = None
_APNS_TOKEN_LOCK = Lock()


def ensure_notifications_preview_text_column() -> None:
    """Add notifications.preview_text if missing (MySQL skips init_db() where this was added). Idempotent."""
    global _PREVIEW_TEXT_COLUMN_ENSURED
    if _PREVIEW_TEXT_COLUMN_ENSURED:
        return
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            if USE_MYSQL:
                c.execute("SHOW COLUMNS FROM notifications LIKE 'preview_text'")
                if not c.fetchone():
                    c.execute(
                        "ALTER TABLE notifications ADD COLUMN preview_text VARCHAR(512) NULL"
                    )
                    conn.commit()
                    logger.info("Added preview_text column to notifications (lazy migrate)")
            else:
                c.execute("PRAGMA table_info(notifications)")
                has_preview = False
                for row in c.fetchall():
                    col_name = row["name"] if hasattr(row, "keys") else row[1]
                    if col_name == "preview_text":
                        has_preview = True
                        break
                if not has_preview:
                    c.execute(
                        "ALTER TABLE notifications ADD COLUMN preview_text VARCHAR(512) NULL"
                    )
                    conn.commit()
                    logger.info("Added preview_text column to notifications (lazy migrate, SQLite)")
        _PREVIEW_TEXT_COLUMN_ENSURED = True
    except Exception as exc:
        logger.warning("Could not ensure notifications.preview_text column: %s", exc)


def create_notification(
    user_id,
    from_user,
    notification_type,
    post_id=None,
    community_id=None,
    message=None,
    link=None,
    preview_text=None,
):
    """Create or refresh an in-app notification entry."""
    ensure_notifications_preview_text_column()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            if USE_MYSQL:
                c.execute(
                    """
                    INSERT INTO notifications (user_id, from_user, type, post_id, community_id, message, created_at, is_read, link, preview_text)
                    VALUES (%s, %s, %s, %s, %s, %s, NOW(), 0, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        created_at = NOW(),
                        message = VALUES(message),
                        link = VALUES(link),
                        preview_text = VALUES(preview_text),
                        is_read = 0
                    """,
                    (user_id, from_user, notification_type, post_id, community_id, message, link, preview_text),
                )
            else:
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                c.execute(
                    """
                    INSERT INTO notifications (user_id, from_user, type, post_id, community_id, message, created_at, is_read, link, preview_text)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
                    ON CONFLICT(user_id, from_user, type, post_id, community_id)
                    DO UPDATE SET
                        created_at = excluded.created_at,
                        message = excluded.message,
                        link = excluded.link,
                        preview_text = excluded.preview_text,
                        is_read = 0
                    """,
                    (user_id, from_user, notification_type, post_id, community_id, message, now_str, link, preview_text),
                )
            conn.commit()
    except Exception as exc:
        logger.error("Error creating notification: %s", exc)


def truncate_notification_preview(text: str, max_len: int = 160) -> str:
    preview = " ".join(str(text or "").split()).strip()
    if len(preview) <= max_len:
        return preview
    return preview[: max_len - 1].rstrip() + "…"


# ── Community member-blocked notification ──────────────────────────────
#
# Fired by ``ensure_free_parent_member_capacity`` callers when an invitee
# is rejected due to the per-tier member cap. Fans out a single in-app
# notification to the community owner + admins, deduped to once per
# (community, recipient) per 24h so a spammy invite link doesn't flood
# the bell. Intentionally link-less in this release — community-level
# paid tiering (the actual "Upgrade" destination) ships in a later PR.


_BLOCKED_DEDUPE_HOURS = 24


def _iter_community_owner_and_admins(cursor, community_id: int) -> list[str]:
    """Return the set of usernames who should be notified when a join attempt
    is blocked: the community creator + anyone with an admin/owner/moderator
    role on ``user_communities``. Deduplicated, lower-cased at comparison
    time but returned in original casing for the ``notifications`` join.
    """
    placeholder = get_sql_placeholder()
    recipients: list[str] = []
    seen: set[str] = set()

    try:
        cursor.execute(
            f"SELECT creator_username FROM communities WHERE id = {placeholder}",
            (community_id,),
        )
        row = cursor.fetchone()
        if row:
            creator = row["creator_username"] if hasattr(row, "keys") else row[0]
            if creator:
                key = str(creator).strip().lower()
                if key and key not in seen:
                    recipients.append(str(creator))
                    seen.add(key)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "notify_community_member_blocked: creator lookup failed for %s: %s",
            community_id,
            exc,
        )

    try:
        cursor.execute(
            f"""
            SELECT DISTINCT u.username
            FROM user_communities uc
            JOIN users u ON uc.user_id = u.id
            WHERE uc.community_id = {placeholder}
              AND LOWER(COALESCE(uc.role, '')) IN ('admin', 'owner', 'moderator', 'manager')
            """,
            (community_id,),
        )
        for row in cursor.fetchall() or []:
            uname = row["username"] if hasattr(row, "keys") else row[0]
            if not uname:
                continue
            key = str(uname).strip().lower()
            if key and key not in seen:
                recipients.append(str(uname))
                seen.add(key)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "notify_community_member_blocked: admin lookup failed for %s: %s",
            community_id,
            exc,
        )

    return recipients


def _recently_notified_member_blocked(
    cursor,
    *,
    recipient_username: str,
    community_id: int,
) -> bool:
    """Dedupe guard: return True if we've already notified this recipient
    for this community within ``_BLOCKED_DEDUPE_HOURS``.
    """
    placeholder = get_sql_placeholder()
    try:
        if USE_MYSQL:
            cursor.execute(
                f"""
                SELECT 1 FROM notifications
                WHERE user_id = {placeholder}
                  AND community_id = {placeholder}
                  AND type = 'member_blocked'
                  AND created_at > NOW() - INTERVAL {int(_BLOCKED_DEDUPE_HOURS)} HOUR
                LIMIT 1
                """,
                (recipient_username, community_id),
            )
        else:
            cursor.execute(
                f"""
                SELECT 1 FROM notifications
                WHERE user_id = {placeholder}
                  AND community_id = {placeholder}
                  AND type = 'member_blocked'
                  AND datetime(created_at) > datetime('now', '-{int(_BLOCKED_DEDUPE_HOURS)} hours')
                LIMIT 1
                """,
                (recipient_username, community_id),
            )
        return cursor.fetchone() is not None
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "notify_community_member_blocked: dedupe check failed for %s/%s: %s",
            recipient_username,
            community_id,
            exc,
        )
        return False


def notify_community_member_blocked(
    cursor,
    *,
    community_id: int,
    community_name: str,
    attempted_username: str,
    cap: int,
) -> int:
    """Notify the community's owner + admins that a join attempt was
    blocked by the member-cap. Dedupes to once per (community, recipient)
    per 24h.

    Runs in the caller's transaction (we accept a cursor, not a conn) so
    the notification rolls back cleanly if the surrounding request fails.

    Returns the number of notifications actually inserted (0 when every
    recipient was deduped).
    """
    if not community_id or not attempted_username:
        return 0

    message = (
        f"{attempted_username} tried to join \"{community_name}\" but it's at "
        f"the {cap}-member limit. Paid community tiers are coming soon — "
        f"we'll email you when upgrade is available."
    )

    placeholder = get_sql_placeholder()
    inserted = 0
    for recipient in _iter_community_owner_and_admins(cursor, community_id):
        if _recently_notified_member_blocked(
            cursor,
            recipient_username=recipient,
            community_id=community_id,
        ):
            continue
        try:
            if USE_MYSQL:
                cursor.execute(
                    f"""
                    INSERT INTO notifications
                        (user_id, from_user, type, community_id, message, link, created_at, is_read)
                    VALUES ({placeholder}, {placeholder}, 'member_blocked', {placeholder}, {placeholder}, NULL, NOW(), 0)
                    """,
                    (recipient, attempted_username, community_id, message),
                )
            else:
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                cursor.execute(
                    f"""
                    INSERT INTO notifications
                        (user_id, from_user, type, community_id, message, link, created_at, is_read)
                    VALUES ({placeholder}, {placeholder}, 'member_blocked', {placeholder}, {placeholder}, NULL, {placeholder}, 0)
                    """,
                    (recipient, attempted_username, community_id, message, now_str),
                )
            inserted += 1
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "notify_community_member_blocked: insert failed for %s/%s: %s",
                recipient,
                community_id,
                exc,
            )

    if inserted:
        logger.info(
            "notify_community_member_blocked: %d notification(s) for community=%s attempt=%s",
            inserted,
            community_id,
            attempted_username,
        )
    return inserted


def fanout_community_post_notifications(
    *,
    community_id: int,
    post_id: int,
    author_username: str,
    content: str,
    community_name: str | None = None,
) -> None:
    """Fan out a new community post using the same semantics everywhere."""
    if not community_id or not post_id or not author_username:
        return

    preview = truncate_notification_preview(content or "")
    notif_link = f"/community_feed_react/{community_id}"
    placeholder = get_sql_placeholder()

    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """
            SELECT DISTINCT u.username
            FROM users u
            JOIN user_communities uc ON u.id = uc.user_id
            WHERE uc.community_id = ? AND u.username != ?
            """,
            (community_id, author_username),
        )
        members = [
            row["username"] if hasattr(row, "keys") else row[0]
            for row in (c.fetchall() or [])
        ]

        resolved_community_name = (community_name or "").strip()
        if not resolved_community_name:
            try:
                c.execute("SELECT name FROM communities WHERE id = ?", (community_id,))
                row = c.fetchone()
                if row:
                    resolved_community_name = (
                        row["name"] if hasattr(row, "keys") else row[0]
                    ) or ""
            except Exception as community_err:
                logger.warning(
                    "community post notify name lookup failed for %s: %s",
                    community_id,
                    community_err,
                )

        notif_message = (
            f"{author_username} made a new post on {resolved_community_name}"
            if resolved_community_name
            else f"{author_username} made a new post"
        )

        for member in members:
            try:
                c.execute(
                    f"SELECT 1 FROM user_muted_communities WHERE username={placeholder} AND community_id={placeholder}",
                    (member, community_id),
                )
                if c.fetchone():
                    continue
            except Exception as muted_err:
                logger.warning(
                    "muted community lookup failed for %s in %s: %s",
                    member,
                    community_id,
                    muted_err,
                )

            try:
                create_notification(
                    member,
                    author_username,
                    "community_post",
                    post_id=post_id,
                    community_id=community_id,
                    message=notif_message,
                    link=notif_link,
                    preview_text=preview or None,
                )
            except Exception as notify_err:
                logger.warning(
                    "community post notify db error to %s: %s",
                    member,
                    notify_err,
                )

            try:
                send_push_to_user(
                    member,
                    {
                        "title": "New community post",
                        "body": f"{author_username}: {preview or truncate_notification_preview(content or '', 100)}",
                        "url": notif_link,
                        "tag": f"community-post-{community_id}-{post_id}",
                    },
                )
            except Exception as push_err:
                logger.warning("push notify community warn: %s", push_err)


def send_native_push(username: str, title: str, body: str, data: dict = None):
    """Send native push notification to iOS/Android devices via Firebase Cloud Messaging"""
    from backend.services.firebase_notifications import send_fcm_to_user
    
    try:
        # Use Firebase to send notifications
        sent_count = send_fcm_to_user(username, title, body, data)
        
        if sent_count > 0:
            logger.info(f"Sent {sent_count} FCM notification(s) to {username}")
        else:
            logger.debug(f"No FCM tokens for user {username}")
                
    except Exception as e:
        logger.error(f"Error sending native push to {username}: {e}")


def send_apns_notification(device_token: str, title: str, body: str, data: dict = None, badge: int = 1):
    """Send iOS push notification via APNs using HTTP/2 (Apple's 2025 recommendation).
    
    Args:
        device_token: APNs device token
        title: Notification title
        body: Notification body
        data: Optional custom data dictionary
        badge: Badge count to display on app icon
    """
    
    if not APNS_AVAILABLE:
        logger.debug("APNs dependencies not available (httpx, PyJWT, cryptography)")
        return
    
    token = (device_token or "").strip().replace(" ", "")
    if not token:
        logger.warning("APNs token missing, cannot send notification")
        return
    
    # Check credentials
    if not all([APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID]):
        logger.debug("APNs credentials not configured")
        return
    
    if not os.path.exists(APNS_KEY_PATH):
        logger.error("APNs key file not found: %s", APNS_KEY_PATH)
        return
    
    try:
        # Build APNs payload
        payload = {
            "aps": {
                "alert": {
                    "title": title,
                    "body": body
                },
                "badge": badge,
                "sound": "default"
            }
        }
        
        # Add custom data
        if data:
            payload.update(data)
        
        # Get JWT token for authentication
        auth_token = _get_apns_jwt_token()
        if not auth_token:
            logger.error("Failed to generate APNs JWT token")
            return
        
        # APNs endpoint
        apns_server = "api.sandbox.push.apple.com" if APNS_USE_SANDBOX else "api.push.apple.com"
        url = f"https://{apns_server}/3/device/{token}"
        
        # Headers
        headers = {
            "authorization": f"bearer {auth_token}",
            "apns-push-type": "alert",
            "apns-topic": APNS_BUNDLE_ID,
            "apns-priority": "10"
        }
        
        # Send notification via HTTP/2
        with httpx.Client(http2=True, timeout=10.0) as client:
            response = client.post(url, json=payload, headers=headers)
        
        if response.status_code == 200:
            logger.info("✅ APNs notification sent to token %s…", token[:8])
        elif response.status_code == 400:
            logger.error("APNs error 400 (Bad Request): %s", response.text)
        elif response.status_code == 403:
            logger.error("APNs error 403 (Forbidden): Check credentials")
        elif response.status_code == 410:
            logger.warning("APNs token %s is no longer active", token[:8])
            _disable_push_token(token)
        else:
            logger.error("APNs error %s: %s", response.status_code, response.text)
            
    except Exception as exc:
        logger.error("APNs send error: %s", exc)


def send_apns_badge_only(device_token: str, badge_count: int = 0):
    """Send a silent badge-only push via APNs HTTP/2 (no alert, no sound)."""
    if not APNS_AVAILABLE:
        return
    token = (device_token or "").strip().replace(" ", "")
    if not token:
        return
    if not all([APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID]):
        logger.debug("APNs credentials not configured for badge-only send")
        return
    if not os.path.exists(APNS_KEY_PATH):
        return
    try:
        payload = {"aps": {"badge": badge_count}}
        auth_token = _get_apns_jwt_token()
        if not auth_token:
            return
        apns_server = "api.sandbox.push.apple.com" if APNS_USE_SANDBOX else "api.push.apple.com"
        url = f"https://{apns_server}/3/device/{token}"
        headers = {
            "authorization": f"bearer {auth_token}",
            "apns-push-type": "alert",
            "apns-topic": APNS_BUNDLE_ID,
            "apns-priority": "10"
        }
        with httpx.Client(http2=True, timeout=10.0) as client:
            response = client.post(url, json=payload, headers=headers)
        if response.status_code == 200:
            logger.info("✅ APNs badge-only sent to %s… (badge=%d)", token[:8], badge_count)
        elif response.status_code == 410:
            logger.warning("APNs token %s no longer active (badge)", token[:8])
            _disable_push_token(token)
        else:
            logger.warning("APNs badge error %s: %s", response.status_code, response.text)
    except Exception as exc:
        logger.error("APNs badge-only error: %s", exc)


def send_fcm_notification(device_token: str, title: str, body: str, data: dict = None):
    """Send Android push notification via FCM"""
    # TODO: Implement FCM sending using firebase-admin
    logger.info(f"📱 [FCM] Would send to Android device: {device_token[:20]}...")
    logger.info(f"   Title: {title}")
    logger.info(f"   Body: {body}")


def send_push_to_user(target_username: str, payload: dict):
    """Send push notification to the given user (web + native)."""
    
    # Extract payload data
    title = payload.get('title', 'C.Point Notification')
    body = payload.get('body', '')
    tag = payload.get("tag") if isinstance(payload, dict) else None
    data = {'url': payload.get('url', '/')}
    
    # Simple dedupe window (2 seconds) to avoid technical duplicates only
    # Reduced from 30s to allow rapid-fire notifications (multiple messages, stories, etc.)
    try:
        with get_db_connection() as conn_chk:
            cchk = conn_chk.cursor()
            if USE_MYSQL:
                cchk.execute(
                    """
                    SELECT id FROM push_send_log
                    WHERE username=? AND IFNULL(tag,'') = IFNULL(?, '') AND IFNULL(title,'')=IFNULL(?, '') AND IFNULL(body,'')=IFNULL(?, '')
                      AND sent_at > DATE_SUB(NOW(), INTERVAL 2 SECOND)
                    LIMIT 1
                    """,
                    (target_username, tag, title, body),
                )
            else:
                cchk.execute(
                    """
                    SELECT id FROM push_send_log
                    WHERE username=? AND IFNULL(tag,'') = IFNULL(?, '') AND IFNULL(title,'')=IFNULL(?, '') AND IFNULL(body,'')=IFNULL(?, '')
                      AND datetime(sent_at) > datetime('now','-2 seconds')
                    LIMIT 1
                    """,
                    (target_username, tag, title, body),
                )
            if cchk.fetchone():
                logger.info("push dedup: skipping duplicate push to %s (tag=%s)", target_username, tag)
                return
    except Exception as dedupe_err:
        logger.warning("push dedupe check failed: %s", dedupe_err)
    
    # Send to native devices (iOS/Android) - after dedup check
    send_native_push(target_username, title, body, data)
    
    # Also send web push for desktop browsers
    if not VAPID_PUBLIC_KEY or not VAPID_PRIVATE_KEY:
        logger.warning("VAPID keys missing; web push disabled")
        # Record the push even without web push, so native doesn't get duped
        try:
            with get_db_connection() as conn_log:
                clog = conn_log.cursor()
                clog.execute(
                    "INSERT INTO push_send_log (username, tag, title, body, url) VALUES (?,?,?,?,?)",
                    (target_username, tag, title, body, payload.get("url")),
                )
                conn_log.commit()
        except Exception as log_err:
            logger.warning("push log write failed: %s", log_err)
        return

    try:

        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE username=?", (target_username,))
            subs = c.fetchall()

        if not subs:
            logger.info("push: no subscriptions for %s", target_username)

        for sub in subs or []:
            try:
                subscription_info = {
                    "endpoint": sub["endpoint"] if hasattr(sub, "keys") else sub[0],
                    "keys": {
                        "p256dh": sub["p256dh"] if hasattr(sub, "keys") else sub[1],
                        "auth": sub["auth"] if hasattr(sub, "keys") else sub[2],
                    },
                }
                webpush(
                    subscription_info=subscription_info,
                    data=json.dumps(payload),
                    vapid_private_key=VAPID_PRIVATE_KEY,
                    vapid_claims={"sub": VAPID_SUBJECT},
                )
            except WebPushException as wpe:
                logger.warning("webpush failed: %s", wpe)
                status_code = getattr(getattr(wpe, "response", None), "status_code", None)
                if status_code in (404, 410):
                    try:
                        endpoint_to_delete = sub["endpoint"] if hasattr(sub, "keys") else sub[0]
                        with get_db_connection() as conn_del:
                            cdel = conn_del.cursor()
                            cdel.execute("DELETE FROM push_subscriptions WHERE endpoint=?", (endpoint_to_delete,))
                            conn_del.commit()
                        logger.info("Deleted stale push subscription for endpoint %s", endpoint_to_delete)
                    except Exception as cleanup_err:
                        logger.warning("failed to delete stale subscription: %s", cleanup_err)
            except Exception as push_err:
                logger.warning("push error: %s", push_err)

        # Record dedupe log
        try:
            with get_db_connection() as conn_log:
                clog = conn_log.cursor()
                clog.execute(
                    "INSERT INTO push_send_log (username, tag, title, body, url) VALUES (?,?,?,?,?)",
                    (
                        target_username,
                        payload.get("tag") if isinstance(payload, dict) else None,
                        payload.get("title") if isinstance(payload, dict) else None,
                        payload.get("body") if isinstance(payload, dict) else None,
                        payload.get("url") if isinstance(payload, dict) else None,
                    ),
                )
                conn_log.commit()
        except Exception as log_err:
            logger.warning("push log write failed: %s", log_err)
    except Exception as exc:
        logger.error("send_push_to_user error: %s", exc)


def check_single_poll_notifications(poll_id, conn=None):
    """
    Check a single poll and send reminders at key progress intervals.

    Returns number of notifications issued.
    """
    should_close_conn = False
    if conn is None:
        conn = get_db_connection()
        should_close_conn = True

    try:
        c = conn.cursor()
        now = datetime.utcnow()

        logger.info("🔍 Helper called for poll %s, USE_MYSQL=%s", poll_id, USE_MYSQL)

        if USE_MYSQL:
            c.execute(
                """
                SELECT p.id, p.question, p.created_at, p.expires_at, p.post_id,
                       ps.community_id
                FROM polls p
                JOIN posts ps ON p.post_id = ps.id
                WHERE p.id = %s AND p.is_active = 1
                """,
                (poll_id,),
            )
        else:
            c.execute(
                """
                SELECT p.id, p.question, p.created_at, p.expires_at, p.post_id,
                       ps.community_id
                FROM polls p
                JOIN posts ps ON p.post_id = ps.id
                WHERE p.id = ? AND p.is_active = 1
                """,
                (poll_id,),
            )

        poll_row = c.fetchone()
        if not poll_row:
            return 0

        question = poll_row["question"] if hasattr(poll_row, "keys") else poll_row[1]
        created_at_raw = poll_row["created_at"] if hasattr(poll_row, "keys") else poll_row[2]
        expires_at_raw = poll_row["expires_at"] if hasattr(poll_row, "keys") else poll_row[3]
        post_id = poll_row["post_id"] if hasattr(poll_row, "keys") else poll_row[4]
        community_id = poll_row["community_id"] if hasattr(poll_row, "keys") else poll_row[5]

        if not expires_at_raw:
            logger.debug("Poll %s has no expires_at", poll_id)
            return 0

        if isinstance(expires_at_raw, str) and (expires_at_raw.strip() == "" or len(expires_at_raw) < 10):
            logger.debug("Poll %s has invalid expires_at string", poll_id)
            return 0

        try:
            created_at = created_at_raw if isinstance(created_at_raw, datetime) else datetime.strptime(
                created_at_raw, "%Y-%m-%d %H:%M:%S"
            )
            expires_at = expires_at_raw if isinstance(expires_at_raw, datetime) else datetime.strptime(
                expires_at_raw, "%Y-%m-%d %H:%M:%S"
            )
        except Exception as parse_err:
            logger.debug("Poll %s has invalid date format: %s", poll_id, parse_err)
            return 0

        total_duration = (expires_at - created_at).total_seconds()
        elapsed = (now - created_at).total_seconds()
        if total_duration <= 0:
            return 0

        progress = elapsed / total_duration
        ph = "%s" if USE_MYSQL else "?"

        c.execute(
            f"""
            SELECT DISTINCT u.username
            FROM user_communities uc
            JOIN users u ON uc.user_id = u.id
            WHERE uc.community_id = {ph}
            """,
            (community_id,),
        )
        members = [row["username"] if hasattr(row, "keys") else row[0] for row in c.fetchall()]

        c.execute(
            f"""
            SELECT DISTINCT username
            FROM poll_votes
            WHERE poll_id = {ph}
            """,
            (poll_id,),
        )
        voters = {row["username"] if hasattr(row, "keys") else row[0] for row in c.fetchall()}
        non_voters = [member for member in members if member not in voters]

        c.execute(f"SELECT COUNT(DISTINCT username) as vote_count FROM poll_votes WHERE poll_id = {ph}", (poll_id,))
        vote_count_row = c.fetchone()
        vote_count = vote_count_row["vote_count"] if hasattr(vote_count_row, "keys") else vote_count_row[0]

        time_remaining = expires_at - now
        days_remaining = max(0, time_remaining.days)
        hours_remaining = max(0, int(time_remaining.total_seconds() / 3600))

        notifications_sent = 0

        def _community_name():
            try:
                c.execute(f"SELECT name FROM communities WHERE id = {ph}", (community_id,))
                row = c.fetchone()
                if row:
                    return row["name"] if hasattr(row, "keys") else row[0]
            except Exception:
                pass
            return ""

        community_name = _community_name()

        def _log_and_insert(username_to_notify, notif_type, message, tag_suffix):
            nonlocal notifications_sent
            try:
                create_notification(username_to_notify, None, "poll_reminder", post_id, community_id, message)
                send_push_to_user(
                    username_to_notify,
                    {
                        "title": f"{community_name} Poll" if community_name else "Poll Update",
                        "body": message,
                        "url": f"/community/{community_id}/polls_react",
                        "tag": f"poll-{tag_suffix}-{poll_id}",
                    },
                )
            except Exception:
                pass
            if USE_MYSQL:
                c.execute(
                    "INSERT INTO poll_notification_log (poll_id, username, notification_type) VALUES (%s, %s, %s)",
                    (poll_id, username_to_notify, notif_type),
                )
            else:
                c.execute(
                    "INSERT INTO poll_notification_log (poll_id, username, notification_type) VALUES (?, ?, ?)",
                    (poll_id, username_to_notify, notif_type),
                )
            notifications_sent += 1

        if 0.20 <= progress < 0.35:
            for username_to_notify in non_voters:
                c.execute(
                    f"SELECT id FROM poll_notification_log WHERE poll_id={ph} AND username={ph} AND notification_type='25'",
                    (poll_id, username_to_notify),
                )
                if not c.fetchone():
                    message = (
                        f"📊 {vote_count} voted in {community_name}. Vote now!"
                        if community_name
                        else f"📊 {vote_count} voted. Vote now!"
                    )
                    _log_and_insert(username_to_notify, "25", message, "25")

        elif 0.45 <= progress < 0.60:
            for username_to_notify in non_voters:
                c.execute(
                    "SELECT id FROM poll_notification_log WHERE poll_id=? AND username=? AND notification_type='50'",
                    (poll_id, username_to_notify),
                )
                if not c.fetchone():
                    message = (
                        f"📊 {vote_count} {community_name} member{'s' if vote_count != 1 else ''} "
                        f"{'have' if vote_count != 1 else 'has'} voted, go vote on the poll!"
                    )
                    _log_and_insert(username_to_notify, "50", message, "50")

        elif 0.75 <= progress < 0.90:
            for username_to_notify in non_voters:
                c.execute(
                    f"SELECT id FROM poll_notification_log WHERE poll_id={ph} AND username={ph} AND notification_type='80_nonvoter'",
                    (poll_id, username_to_notify),
                )
                if not c.fetchone():
                    if days_remaining > 1:
                        message = f"⏰ The poll is closing in {days_remaining} days, go vote!"
                    elif hours_remaining > 1:
                        message = f"⏰ The poll is closing in {hours_remaining} hours, go vote!"
                    else:
                        message = "⏰ The poll is closing soon, go vote!"
                    _log_and_insert(username_to_notify, "80_nonvoter", message, "80")

            for username_to_notify in voters:
                c.execute(
                    f"SELECT id FROM poll_notification_log WHERE poll_id={ph} AND username={ph} AND notification_type='80_voter'",
                    (poll_id, username_to_notify),
                )
                if not c.fetchone():
                    message = (
                        f"📋 Poll in {community_name} closing. Review results!" if community_name else "📋 Poll closing. Review results!"
                    )
                    _log_and_insert(username_to_notify, "80_voter", message, "80-voter")

        if should_close_conn:
            conn.commit()

        return notifications_sent
    finally:
        if should_close_conn:
            conn.close()


def _get_apns_jwt_token():
    """Generate JWT token for APNs authentication (cached for 55 minutes)."""
    global _APNS_JWT_TOKEN, _APNS_JWT_EXPIRY
    
    with _APNS_TOKEN_LOCK:
        # Check if we have a valid cached token
        if _APNS_JWT_TOKEN and _APNS_JWT_EXPIRY:
            if datetime.now().timestamp() < _APNS_JWT_EXPIRY:
                return _APNS_JWT_TOKEN
        
        # Generate new JWT token
        try:
            # Read the .p8 private key
            with open(APNS_KEY_PATH, 'rb') as key_file:
                private_key = serialization.load_pem_private_key(
                    key_file.read(),
                    password=None
                )
            
            # JWT header
            headers = {
                "alg": "ES256",
                "kid": APNS_KEY_ID
            }
            
            # JWT payload (issued at time)
            now = datetime.now().timestamp()
            payload = {
                "iss": APNS_TEAM_ID,
                "iat": int(now)
            }
            
            # Generate token (valid for 1 hour, we'll cache for 55 minutes)
            token = jwt.encode(
                payload,
                private_key,
                algorithm="ES256",
                headers=headers
            )
            
            # Cache token and expiry (55 minutes from now)
            _APNS_JWT_TOKEN = token
            _APNS_JWT_EXPIRY = now + (55 * 60)
            
            logger.info(
                "APNs JWT token generated (sandbox=%s, bundle=%s)",
                APNS_USE_SANDBOX,
                APNS_BUNDLE_ID,
            )
            
            return token
            
        except Exception as exc:
            logger.error("Failed to generate APNs JWT token: %s", exc)
            return None


def _disable_push_token(token: str):
    """Deactivate an invalid APNs token so it can be refreshed on next login."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        from backend.services.database import get_sql_placeholder

        ph = get_sql_placeholder()
        cursor.execute(f"UPDATE push_tokens SET is_active = 0 WHERE token = {ph}", (token,))
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as exc:  # pragma: no cover - best-effort cleanup
        logger.debug("Failed to deactivate push token %s: %s", token[:8], exc)


def check_single_event_notifications(event_id, conn=None):
    """
    Check an event and send reminders based on notification preferences.

    Returns number of notifications issued.
    """
    should_close_conn = False
    if conn is None:
        conn = get_db_connection()
        should_close_conn = True

    try:
        c = conn.cursor()
        now = datetime.utcnow()
        ph = "%s" if USE_MYSQL else "?"

        logger.info("🔍 Checking event %s for notifications", event_id)

        c.execute(
            f"""
            SELECT ce.id, ce.title, ce.date, ce.start_time, ce.end_time, ce.created_at,
                   ce.community_id, ce.notification_preferences, ce.username as created_by
            FROM calendar_events ce
            WHERE ce.id = {ph}
            """,
            (event_id,),
        )

        event_row = c.fetchone()
        if not event_row:
            return 0

        title = event_row["title"] if hasattr(event_row, "keys") else event_row[1]
        date_str = event_row["date"] if hasattr(event_row, "keys") else event_row[2]
        start_time_str = event_row["start_time"] if hasattr(event_row, "keys") else event_row[3]
        created_at_raw = event_row["created_at"] if hasattr(event_row, "keys") else event_row[5]
        community_id = event_row["community_id"] if hasattr(event_row, "keys") else event_row[6]
        notification_prefs = event_row["notification_preferences"] if hasattr(event_row, "keys") else event_row[7]
        created_by = event_row["created_by"] if hasattr(event_row, "keys") else event_row[8]

        try:
            if isinstance(start_time_str, datetime):
                event_start = start_time_str
            elif start_time_str:
                event_start = datetime.strptime(start_time_str, "%Y-%m-%d %H:%M:%S")
            else:
                event_start = datetime.strptime(date_str, "%Y-%m-%d")
        except Exception as parse_err:
            logger.debug("Event %s has invalid date/time: %s", event_id, parse_err)
            return 0

        if event_start <= now:
            logger.debug("Event %s is in the past", event_id)
            return 0

        try:
            created_at = created_at_raw if isinstance(created_at_raw, datetime) else datetime.strptime(
                created_at_raw, "%Y-%m-%d %H:%M:%S"
            )
        except Exception:
            created_at = now

        c.execute(
            f"""
            SELECT DISTINCT invited_username
            FROM event_invitations
            WHERE event_id = {ph}
            """,
            (event_id,),
        )
        participants = [row["invited_username"] if hasattr(row, "keys") else row[0] for row in c.fetchall()]
        if created_by and created_by not in participants:
            participants.append(created_by)

        if not participants:
            return 0

        community_name = ""
        if community_id:
            try:
                c.execute(f"SELECT name FROM communities WHERE id = {ph}", (community_id,))
                row = c.fetchone()
                if row:
                    community_name = row["name"] if hasattr(row, "keys") else row[0]
            except Exception:
                pass

        time_until_event = (event_start - now).total_seconds()
        hours_until = time_until_event / 3600
        days_until = time_until_event / 86400
        notifications_sent = 0

        prefs = (notification_prefs or "all").strip().lower()
        if prefs == "none":
            logger.info("Event %s reminders disabled by preference", event_id)
            return 0
        send_1week = prefs in ("1_week", "all")
        send_1day = prefs in ("1_day", "all")
        send_1hour = prefs in ("1_hour", "all")
        send_80percent = prefs == "all"

        logger.info("⏰ Event %s: %.1fh until event (prefs=%s)", event_id, hours_until, prefs)

        def _already_logged(username_to_notify, notif_type):
            c.execute(
                f"SELECT id FROM event_notification_log WHERE event_id={ph} AND username={ph} AND notification_type={ph}",
                (event_id, username_to_notify, notif_type),
            )
            return c.fetchone() is not None

        def _insert_log(username_to_notify, notif_type):
            try:
                if USE_MYSQL:
                    c.execute(
                        "INSERT IGNORE INTO event_notification_log (event_id, username, notification_type) VALUES (%s, %s, %s)",
                        (event_id, username_to_notify, notif_type),
                    )
                else:
                    c.execute(
                        "INSERT OR IGNORE INTO event_notification_log (event_id, username, notification_type) VALUES (?, ?, ?)",
                        (event_id, username_to_notify, notif_type),
                    )
            except Exception:
                logger.debug("Event notification log insert skipped for %s/%s/%s", event_id, username_to_notify, notif_type)

        def _notify(username_to_notify, message, tag):
            event_link = f"/event/{event_id}"
            create_notification(username_to_notify, None, "event_reminder", None, community_id, message, link=event_link)
            send_push_to_user(
                username_to_notify,
                {
                    "title": f"{community_name} Event Reminder" if community_name else "Event Reminder",
                    "body": message,
                    "url": event_link,
                    "tag": tag,
                },
            )

        reminder_windows = [
            ("1_week", 168, 24, send_1week, f"Event in {community_name}: '{title}' in 1 week" if community_name else f"Event '{title}' in 1 week"),
            ("1_day", 24, 1, send_1day, f"Event in {community_name}: '{title}' tomorrow" if community_name else f"Event '{title}' tomorrow"),
            ("1_hour", 1, 0, send_1hour, f"Event in {community_name}: '{title}' in 1 hour" if community_name else f"Event '{title}' in 1 hour"),
        ]
        for notif_type, threshold_hours, lower_bound_hours, enabled, message in reminder_windows:
            if not enabled or not (lower_bound_hours < hours_until <= threshold_hours):
                continue
            for username_to_notify in participants:
                if _already_logged(username_to_notify, notif_type):
                    continue
                try:
                    _notify(username_to_notify, message, f"event-{notif_type}-{event_id}")
                except Exception:
                    logger.debug("Event reminder delivery failed for %s/%s/%s", event_id, username_to_notify, notif_type)
                _insert_log(username_to_notify, notif_type)
                notifications_sent += 1

        if send_80percent:
            total_duration = (event_start - created_at).total_seconds()
            elapsed = (now - created_at).total_seconds()
            if total_duration > 0:
                progress = elapsed / total_duration
                if 0.75 <= progress < 0.90:
                    for username_to_notify in participants:
                        if _already_logged(username_to_notify, "80_percent"):
                            continue
                        if days_until > 1:
                            message = (
                                f"Event in {community_name}: '{title}' in {int(days_until)} days"
                                if community_name
                                else f"Event '{title}' in {int(days_until)} days"
                            )
                        elif hours_until > 1:
                            message = (
                                f"Event in {community_name}: '{title}' in {int(hours_until)} hours"
                                if community_name
                                else f"Event '{title}' in {int(hours_until)} hours"
                            )
                        else:
                            message = (
                                f"Event in {community_name}: '{title}' starting soon"
                                if community_name
                                else f"Event '{title}' starting soon"
                            )
                        try:
                            _notify(username_to_notify, message, f"event-80-{event_id}")
                        except Exception:
                            logger.debug("Event 80-percent reminder delivery failed for %s/%s", event_id, username_to_notify)
                        _insert_log(username_to_notify, "80_percent")
                        notifications_sent += 1

        if should_close_conn:
            conn.commit()

        return notifications_sent
    finally:
        if should_close_conn:
            conn.close()
