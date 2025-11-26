"""Firebase Cloud Messaging push notifications."""

from __future__ import annotations

import logging
import os
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

# Firebase configuration
FIREBASE_CREDENTIALS_PATH = os.getenv('FIREBASE_CREDENTIALS')
_firebase_app = None


def initialize_firebase():
    """Initialize Firebase Admin SDK (call once at app startup)."""
    global _firebase_app
    
    if not FIREBASE_AVAILABLE:
        logger.error("Firebase Admin SDK not available")
        return False
    
    # Check if already initialized
    if _firebase_app is not None:
        logger.debug("Firebase already initialized")
        return True
    
    # Check if default app exists (initialized elsewhere)
    try:
        _firebase_app = firebase_admin.get_app()
        logger.info("✅ Firebase already initialized (using existing default app)")
        return True
    except ValueError:
        # Default app doesn't exist, we need to initialize it
        pass
    
    if not FIREBASE_CREDENTIALS_PATH:
        logger.error("FIREBASE_CREDENTIALS environment variable not set")
        return False
    
    if not os.path.exists(FIREBASE_CREDENTIALS_PATH):
        logger.error(f"Firebase credentials file not found: {FIREBASE_CREDENTIALS_PATH}")
        return False
    
    try:
        cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
        _firebase_app = firebase_admin.initialize_app(cred)
        logger.info("✅ Firebase Admin SDK initialized successfully")
        return True
    except ValueError as e:
        # App already exists
        if "already exists" in str(e):
            try:
                _firebase_app = firebase_admin.get_app()
                logger.info("✅ Firebase already initialized (recovered from ValueError)")
                return True
            except:
                logger.error(f"Firebase initialization conflict: {e}")
                return False
        else:
            logger.error(f"Failed to initialize Firebase: {e}")
            return False
    except Exception as e:
        logger.error(f"Failed to initialize Firebase: {e}")
        return False


def send_fcm_notification(
    token: str,
    title: str,
    body: str,
    data: Optional[dict] = None
) -> bool:
    """
    Send push notification via Firebase Cloud Messaging.
    
    Args:
        token: FCM device token
        title: Notification title
        body: Notification body
        data: Optional custom data dictionary
    
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
        
        # Build message
        message = messaging.Message(
            notification=notification,
            data=data or {},
            token=token,
            apns=messaging.APNSConfig(
                payload=messaging.APNSPayload(
                    aps=messaging.Aps(
                        sound='default',
                        badge=1
                    )
                )
            )
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
    
    Tries FCM first, then falls back to direct APNs for iOS tokens.
    
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
        
        # Get user's FCM tokens
        cursor.execute(
            f"SELECT token, platform FROM fcm_tokens WHERE username = {ph} AND is_active = 1",
            (username,)
        )
        fcm_tokens = cursor.fetchall()
        
        # Also check native_push_tokens table for direct APNs tokens
        try:
            cursor.execute(
                f"SELECT token, platform FROM native_push_tokens WHERE username = {ph} AND is_active = 1",
                (username,)
            )
            native_tokens = cursor.fetchall()
        except Exception:
            native_tokens = []
        
        cursor.close()
        conn.close()
        
        # Combine and deduplicate tokens
        all_tokens = {}
        for row in (fcm_tokens or []):
            token = row[0] if isinstance(row, (list, tuple)) else row.get('token', row[0])
            platform = row[1] if isinstance(row, (list, tuple)) else row.get('platform', 'ios')
            all_tokens[token] = platform
        
        for row in (native_tokens or []):
            token = row[0] if isinstance(row, (list, tuple)) else row.get('token', row[0])
            platform = row[1] if isinstance(row, (list, tuple)) else row.get('platform', 'ios')
            if token not in all_tokens:
                all_tokens[token] = platform
        
        if not all_tokens:
            logger.debug(f"No push tokens for user {username}")
            return 0
        
        logger.info(f"📱 Sending push to {username}: {len(all_tokens)} token(s)")
        
        # Send to each token
        for token, platform in all_tokens.items():
            token_preview = token[:16] + "..." if len(token) > 16 else token
            
            # Check if this is a native APNs token (64 hex chars)
            if is_apns_token(token):
                logger.info(f"📱 Token {token_preview} is APNs format, sending via APNs HTTP/2")
                try:
                    send_apns_notification(token, title, body, data)
                    sent_count += 1
                except Exception as e:
                    logger.error(f"APNs send failed for {token_preview}: {e}")
            else:
                # Try FCM first
                logger.info(f"📱 Token {token_preview} is FCM format, sending via Firebase")
                if send_fcm_notification(token, title, body, data):
                    sent_count += 1
                elif platform == 'ios':
                    # FCM failed, try APNs as fallback for iOS
                    logger.info(f"📱 FCM failed, trying APNs fallback for {token_preview}")
                    try:
                        send_apns_notification(token, title, body, data)
                        sent_count += 1
                    except Exception as e:
                        logger.error(f"APNs fallback also failed for {token_preview}: {e}")
        
        if sent_count > 0:
            logger.info(f"✅ Sent {sent_count} notification(s) to {username}")
        
        return sent_count
        
    except Exception as e:
        logger.error(f"Error sending push to {username}: {e}")
        return 0


__all__ = [
    'initialize_firebase',
    'send_fcm_notification',
    'send_fcm_to_user',
    'is_apns_token',
    'FIREBASE_AVAILABLE',
]
