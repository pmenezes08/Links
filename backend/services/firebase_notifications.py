"""Firebase Cloud Messaging push notifications."""

from __future__ import annotations

import json
import logging
import os
import sys
import tempfile
from typing import Optional

logger = logging.getLogger(__name__)

# Try to import Firebase Admin SDK
try:
    import firebase_admin
    from firebase_admin import credentials, messaging
    FIREBASE_AVAILABLE = True
except ImportError:
    FIREBASE_AVAILABLE = False
    logger.warning("Firebase Admin SDK not installed. Install with: pip install firebase-admin")

# Firebase configuration - can be a file path OR a JSON string
FIREBASE_CREDENTIALS_ENV = os.getenv('FIREBASE_CREDENTIALS')
_firebase_app = None
_temp_creds_file = None  # Keep reference to prevent cleanup


def _get_firebase_credentials():
    """
    Get Firebase credentials from environment variable.
    Supports:
    - File paths (local development or Secret Manager mounted files)
    - JSON strings (direct paste - may have issues with newlines)
    - Base64-encoded JSON (prefix with 'base64:' - recommended for env vars)
    
    Returns:
        credentials.Certificate or None if not available
    """
    global _temp_creds_file
    
    creds_value = FIREBASE_CREDENTIALS_ENV
    if not creds_value:
        print("[FIREBASE] No FIREBASE_CREDENTIALS env var set", file=sys.stderr, flush=True)
        return None
    
    creds_value = creds_value.strip()
    
    # Check if it's a file path (exists on filesystem)
    if os.path.exists(creds_value):
        print(f"[FIREBASE] Using credentials file: {creds_value}", file=sys.stderr, flush=True)
        return credentials.Certificate(creds_value)
    
    # Check if it's base64 encoded (prefix with 'base64:')
    if creds_value.startswith('base64:'):
        print("[FIREBASE] Credentials are base64 encoded, decoding...", file=sys.stderr, flush=True)
        try:
            import base64
            b64_data = creds_value[7:]  # Remove 'base64:' prefix
            decoded = base64.b64decode(b64_data).decode('utf-8')
            creds_dict = json.loads(decoded)
            print(f"[FIREBASE] Decoded base64 credentials for project: {creds_dict.get('project_id', 'unknown')}", file=sys.stderr, flush=True)
            return credentials.Certificate(creds_dict)
        except Exception as e:
            print(f"[FIREBASE] Failed to decode base64 credentials: {e}", file=sys.stderr, flush=True)
            return None
    
    # Check if it looks like a JSON string (starts with { or contains "type":)
    if creds_value.startswith('{') or '"type"' in creds_value or "'type'" in creds_value:
        print("[FIREBASE] Credentials appear to be JSON string, parsing...", file=sys.stderr, flush=True)
        try:
            # First try direct JSON parse
            creds_dict = json.loads(creds_value)
            
            # Check if private_key has proper newlines
            private_key = creds_dict.get('private_key', '')
            if private_key and '\\n' in private_key and '\n' not in private_key:
                # The \n characters are escaped, need to unescape them
                print("[FIREBASE] Fixing escaped newlines in private_key...", file=sys.stderr, flush=True)
                creds_dict['private_key'] = private_key.replace('\\n', '\n')
            
            print(f"[FIREBASE] Parsed JSON credentials for project: {creds_dict.get('project_id', 'unknown')}", file=sys.stderr, flush=True)
            return credentials.Certificate(creds_dict)
        except json.JSONDecodeError as e:
            print(f"[FIREBASE] Failed to parse credentials as JSON: {e}", file=sys.stderr, flush=True)
            # Try writing to temp file as fallback
            try:
                _temp_creds_file = tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False)
                _temp_creds_file.write(creds_value)
                _temp_creds_file.close()
                print(f"[FIREBASE] Wrote credentials to temp file: {_temp_creds_file.name}", file=sys.stderr, flush=True)
                return credentials.Certificate(_temp_creds_file.name)
            except Exception as te:
                print(f"[FIREBASE] Temp file fallback also failed: {te}", file=sys.stderr, flush=True)
                return None
        except ValueError as ve:
            # This catches the PEM loading error
            print(f"[FIREBASE] Certificate creation failed (likely private_key issue): {ve}", file=sys.stderr, flush=True)
            # Try fixing newlines more aggressively
            try:
                private_key = creds_dict.get('private_key', '')
                # Replace literal \n with actual newlines
                fixed_key = private_key.replace('\\n', '\n')
                # Also handle case where newlines were completely stripped
                if '-----BEGIN' in fixed_key and '\n' not in fixed_key:
                    # Try to reconstruct the key format
                    fixed_key = fixed_key.replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n')
                    fixed_key = fixed_key.replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----\n')
                creds_dict['private_key'] = fixed_key
                print("[FIREBASE] Attempting with fixed private_key newlines...", file=sys.stderr, flush=True)
                return credentials.Certificate(creds_dict)
            except Exception as fix_err:
                print(f"[FIREBASE] Even with newline fix, failed: {fix_err}", file=sys.stderr, flush=True)
                return None
    
    # It looks like a path but doesn't exist
    print(f"[FIREBASE] Credentials path does not exist: {creds_value}", file=sys.stderr, flush=True)
    return None


def initialize_firebase():
    """Initialize Firebase Admin SDK (call once at app startup)."""
    global _firebase_app
    
    print("[FIREBASE] initialize_firebase() called", file=sys.stderr, flush=True)
    
    if not FIREBASE_AVAILABLE:
        print("[FIREBASE] ERROR: firebase-admin SDK not installed", file=sys.stderr, flush=True)
        logger.error("Firebase Admin SDK not available")
        return False
    
    # Check if already initialized
    if _firebase_app is not None:
        print("[FIREBASE] Already initialized (cached)", file=sys.stderr, flush=True)
        logger.debug("Firebase already initialized")
        return True
    
    # Check if default app exists (initialized elsewhere)
    try:
        _firebase_app = firebase_admin.get_app()
        print("[FIREBASE] Using existing default app", file=sys.stderr, flush=True)
        logger.info("✅ Firebase already initialized (using existing default app)")
        return True
    except ValueError:
        # Default app doesn't exist, we need to initialize it
        pass
    
    # Get credentials (supports both file path and JSON string)
    cred = _get_firebase_credentials()
    if cred is None:
        print("[FIREBASE] ERROR: Could not load credentials", file=sys.stderr, flush=True)
        return False
    
    try:
        _firebase_app = firebase_admin.initialize_app(cred)
        print("[FIREBASE] ✅ Firebase Admin SDK initialized successfully", file=sys.stderr, flush=True)
        logger.info("✅ Firebase Admin SDK initialized successfully")
        return True
    except ValueError as e:
        # App already exists
        if "already exists" in str(e):
            try:
                _firebase_app = firebase_admin.get_app()
                print("[FIREBASE] Recovered existing app", file=sys.stderr, flush=True)
                logger.info("✅ Firebase already initialized (recovered from ValueError)")
                return True
            except:
                print(f"[FIREBASE] ERROR: Initialization conflict: {e}", file=sys.stderr, flush=True)
                logger.error(f"Firebase initialization conflict: {e}")
                return False
        else:
            print(f"[FIREBASE] ERROR: ValueError: {e}", file=sys.stderr, flush=True)
            logger.error(f"Failed to initialize Firebase: {e}")
            return False
    except Exception as e:
        print(f"[FIREBASE] ERROR: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        logger.error(f"Failed to initialize Firebase: {e}")
        return False


def send_fcm_notification(
    token: str,
    title: str,
    body: str,
    data: Optional[dict] = None,
    badge: int = 1
) -> bool:
    """
    Send push notification via Firebase Cloud Messaging.
    
    Args:
        token: FCM device token
        title: Notification title
        body: Notification body
        data: Optional custom data dictionary
        badge: Badge count to display on app icon
    
    Returns:
        True if sent successfully, False otherwise
    """
    if not FIREBASE_AVAILABLE:
        logger.debug("Firebase not available")
        return False
    
    # Initialize Firebase if not done yet
    if _firebase_app is None:
        if not initialize_firebase():
            return False
    
    try:
        # Build notification
        notification = messaging.Notification(
            title=title,
            body=body
        )
        
        # Ensure all data values are strings (FCM requirement)
        string_data = {k: str(v) for k, v in (data or {}).items()}
        
        # Build APNs payload with custom data unpacked as kwargs
        apns_payload = messaging.APNSPayload(
            aps=messaging.Aps(
                sound='default',
                badge=badge
            ),
            **string_data  # Unpack custom data into APNs payload
        )
        
        # Build message with data in both FCM data and APNs custom payload
        message = messaging.Message(
            notification=notification,
            data=string_data,
            token=token,
            apns=messaging.APNSConfig(payload=apns_payload)
        )
        
        # Send
        response = messaging.send(message)
        logger.info(f"✅ FCM notification sent successfully: {response}")
        return True
        
    except messaging.UnregisteredError:
        logger.warning(f"FCM token is no longer valid: {token[:8]}...")
        return False
        
    except Exception as e:
        logger.error(f"FCM send error: {e}")
        return False


def is_apns_token(token: str) -> bool:
    """
    Check if a token looks like a native APNs token (64 hex characters).
    FCM tokens are typically 150+ characters and contain colons.
    """
    if not token:
        return False
    token = token.strip()
    # APNs tokens are exactly 64 hex characters
    if len(token) == 64:
        try:
            int(token, 16)  # Validates it's all hex
            return True
        except ValueError:
            pass
    return False


def send_fcm_to_user(username: str, title: str, body: str, data: Optional[dict] = None) -> int:
    """
    Send push notification to all devices registered for a user.
    
    Uses FCM tokens only - FCM handles APNs delivery internally for iOS.
    Only falls back to direct APNs if NO FCM tokens exist.
    Limits to ONE token per platform to prevent duplicate notifications.
    
    Args:
        username: User to send notification to
        title: Notification title
        body: Notification body
        data: Optional custom data
    
    Returns:
        Number of notifications sent successfully
    """
    from backend.services.database import get_db_connection, get_sql_placeholder, USE_MYSQL
    from backend.services.notifications import send_apns_notification
    
    sent_count = 0
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        
        # Get total unread count for badge using the shared function
        try:
            badge_count = get_total_badge_count(username)
            logger.info(f"📛 Badge count for {username}: {badge_count}")
        except Exception as e:
            logger.warning(f"Could not get badge count: {e}")
            import traceback
            traceback.print_exc()
            badge_count = 1
        
        # Get user's most recent FCM token per platform (prevents duplicates)
        # ORDER BY last_seen DESC to get the most recently active token
        if USE_MYSQL:
            cursor.execute(f"""
                SELECT token, platform FROM (
                    SELECT token, platform, last_seen,
                           ROW_NUMBER() OVER (PARTITION BY platform ORDER BY last_seen DESC) as rn
                    FROM fcm_tokens 
                    WHERE username = {ph} AND is_active = 1
                ) ranked WHERE rn = 1
            """, (username,))
        else:
            # SQLite doesn't have window functions in older versions, use GROUP BY with MAX
            cursor.execute(f"""
                SELECT f.token, f.platform 
                FROM fcm_tokens f
                INNER JOIN (
                    SELECT platform, MAX(last_seen) as max_seen
                    FROM fcm_tokens 
                    WHERE username = {ph} AND is_active = 1
                    GROUP BY platform
                ) latest ON f.platform = latest.platform AND f.last_seen = latest.max_seen
                WHERE f.username = {ph} AND f.is_active = 1
            """, (username, username))
        
        fcm_tokens = cursor.fetchall()
        
        # Build token list - only one per platform
        all_tokens = {}
        has_ios_fcm_token = False
        
        for row in (fcm_tokens or []):
            if hasattr(row, 'keys'):
                token = row['token']
                platform = row['platform']
            else:
                token = row[0]
                platform = row[1]
            
            # Skip if we already have a token for this platform
            if any(p == platform for p in all_tokens.values()):
                logger.debug(f"Skipping duplicate {platform} token for {username}")
                continue
                
            all_tokens[token] = platform
            if platform == 'ios' and not is_apns_token(token):
                has_ios_fcm_token = True
        
        # ONLY check native_push_tokens if we don't have any FCM tokens for iOS
        # This prevents duplicate notifications (FCM routes to APNs internally)
        if not has_ios_fcm_token:
            try:
                if USE_MYSQL:
                    cursor.execute(f"""
                        SELECT token, platform FROM native_push_tokens 
                        WHERE username = {ph} AND is_active = 1
                        ORDER BY last_seen DESC LIMIT 1
                    """, (username,))
                else:
                    cursor.execute(f"""
                        SELECT token, platform FROM native_push_tokens 
                        WHERE username = {ph} AND is_active = 1
                        ORDER BY last_seen DESC LIMIT 1
                    """, (username,))
                
                native_tokens = cursor.fetchall()
                
                for row in (native_tokens or []):
                    if hasattr(row, 'keys'):
                        token = row['token']
                        platform = row['platform']
                    else:
                        token = row[0]
                        platform = row[1]
                    if token not in all_tokens and platform not in all_tokens.values():
                        all_tokens[token] = platform
            except Exception:
                pass
        
        cursor.close()
        conn.close()
        
        if not all_tokens:
            logger.debug(f"No push tokens for user {username}")
            return 0
        
        logger.info(f"📱 Sending push to {username}: {len(all_tokens)} token(s) (deduplicated by platform)")
        
        # Send to each token (should be max 1 per platform now)
        for token, platform in all_tokens.items():
            token_preview = token[:16] + "..." if len(token) > 16 else token
            
            # Check if this is a native APNs token (64 hex chars)
            if is_apns_token(token):
                logger.info(f"📱 Token {token_preview} is APNs format, sending via APNs HTTP/2")
                try:
                    send_apns_notification(token, title, body, data, badge=badge_count)
                    sent_count += 1
                except Exception as e:
                    logger.error(f"APNs send failed for {token_preview}: {e}")
            else:
                # Send via FCM (handles APNs internally for iOS)
                logger.info(f"📱 Token {token_preview} is FCM format, sending via Firebase")
                if send_fcm_notification(token, title, body, data, badge=badge_count):
                    sent_count += 1
                else:
                    logger.warning(f"FCM send failed for {token_preview}")
        
        if sent_count > 0:
            logger.info(f"✅ Sent {sent_count} notification(s) to {username}")
        
        return sent_count
        
    except Exception as e:
        logger.error(f"Error sending push to {username}: {e}")
        return 0


def get_total_badge_count(username: str) -> int:
    """
    Get total unread count for badge (notifications + messages).
    
    Note: Excludes 'message' and 'reaction' type notifications.
    - 'message' types are counted separately via unread messages
    - 'reaction' types are chat message reactions (excluded from badge)
    Badge = unread notifications + total unread messages
    """
    from backend.services.database import get_db_connection, get_sql_placeholder
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        
        # Count unread notifications (EXCLUDE 'message' and 'reaction' types)
        cursor.execute(
            f"SELECT COUNT(*) FROM notifications WHERE user_id = {ph} AND is_read = 0 AND type != 'message' AND type != 'reaction'",
            (username,)
        )
        row = cursor.fetchone()
        if hasattr(row, 'keys'):
            notif_count = list(row.values())[0] or 0
        else:
            notif_count = row[0] if row else 0
        
        # Count ALL unread messages (total count, not just conversations)
        cursor.execute(
            f"SELECT COUNT(*) FROM messages WHERE receiver = {ph} AND is_read = 0",
            (username,)
        )
        row = cursor.fetchone()
        if hasattr(row, 'keys'):
            msg_count = list(row.values())[0] or 0
        else:
            msg_count = row[0] if row else 0
        
        cursor.close()
        conn.close()
        
        total = notif_count + msg_count
        logger.info(f"📛 Total badge for {username}: {total} (notif={notif_count}, msgs={msg_count})")
        return total
        
    except Exception as e:
        logger.warning(f"Could not get total badge count for {username}: {e}")
        return 0


def send_fcm_to_user_badge_only(username: str, badge_count: int = 0) -> int:
    """
    Send a silent push notification to reset the iOS badge count.
    
    Args:
        username: User to send to
        badge_count: Badge count to set (0 to clear)
    
    Returns:
        Number of devices updated
    """
    from backend.services.database import get_db_connection, get_sql_placeholder
    
    if not FIREBASE_AVAILABLE:
        logger.debug("Firebase not available")
        return 0
    
    # Initialize Firebase if not done yet
    if _firebase_app is None:
        if not initialize_firebase():
            return 0
    
    sent_count = 0
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        
        # Get user's FCM tokens
        cursor.execute(
            f"SELECT token, platform FROM fcm_tokens WHERE username = {ph} AND is_active = 1",
            (username,)
        )
        fcm_tokens = cursor.fetchall()
        cursor.close()
        conn.close()
        
        if not fcm_tokens:
            logger.debug(f"No FCM tokens for user {username}")
            return 0
        
        for row in fcm_tokens:
            if hasattr(row, 'keys'):
                token = row['token']
                platform = row['platform']
            else:
                token = row[0]
                platform = row[1]
            
            # Only send badge-only messages to iOS devices
            if platform != 'ios':
                continue
            
            try:
                # Badge update push - use alert type for faster delivery
                # iOS throttles background pushes but processes alert pushes immediately
                message = messaging.Message(
                    token=token,
                    apns=messaging.APNSConfig(
                        headers={
                            'apns-push-type': 'alert',  # Use alert type for faster delivery
                            'apns-priority': '10',  # High priority
                        },
                        payload=messaging.APNSPayload(
                            aps=messaging.Aps(
                                badge=badge_count,
                                content_available=True,
                                # Empty alert to avoid showing notification but still get fast delivery
                                sound=None,
                            )
                        )
                    )
                )
                
                response = messaging.send(message)
                logger.info(f"✅ Badge reset sent to {token[:16]}...: {response}")
                sent_count += 1
                
            except messaging.UnregisteredError:
                logger.warning(f"FCM token no longer valid: {token[:16]}...")
            except Exception as e:
                logger.warning(f"Badge reset failed for {token[:16]}...: {e}")
        
        return sent_count
        
    except Exception as e:
        logger.error(f"Error sending badge reset to {username}: {e}")
        return 0


__all__ = [
    'initialize_firebase',
    'send_fcm_notification',
    'send_fcm_to_user',
    'send_fcm_to_user_badge_only',
    'get_total_badge_count',
    'is_apns_token',
    'FIREBASE_AVAILABLE',
]
