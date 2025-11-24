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
    
    if _firebase_app is not None:
        logger.debug("Firebase already initialized")
        return True
    
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


def send_fcm_to_user(username: str, title: str, body: str, data: Optional[dict] = None) -> int:
    """
    Send FCM notification to all devices registered for a user.
    
    Args:
        username: User to send notification to
        title: Notification title
        body: Notification body
        data: Optional custom data
    
    Returns:
        Number of notifications sent successfully
    """
    from backend.services.database import get_db_connection, get_sql_placeholder, USE_MYSQL
    
    try:
        # Get user's FCM tokens
        conn = get_db_connection()
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        
        cursor.execute(
            f"SELECT token FROM fcm_tokens WHERE username = {ph} AND is_active = 1",
            (username,)
        )
        tokens = cursor.fetchall()
        cursor.close()
        conn.close()
        
        if not tokens:
            logger.debug(f"No FCM tokens for user {username}")
            return 0
        
        # Send to each token
        sent_count = 0
        for token_row in tokens:
            token = token_row[0]
            if send_fcm_notification(token, title, body, data):
                sent_count += 1
        
        if sent_count > 0:
            logger.info(f"Sent {sent_count} FCM notifications to {username}")
        
        return sent_count
        
    except Exception as e:
        logger.error(f"Error sending FCM to {username}: {e}")
        return 0


__all__ = [
    'initialize_firebase',
    'send_fcm_notification',
    'send_fcm_to_user',
    'FIREBASE_AVAILABLE',
]
