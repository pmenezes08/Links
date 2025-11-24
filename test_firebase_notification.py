#!/usr/bin/env python3
"""Test Firebase Cloud Messaging notification."""

import sys
import os

# Add project to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Set environment variables (or load from WSGI-like config)
os.environ.setdefault('FIREBASE_CREDENTIALS', '/home/puntz08/secrets/firebase-credentials.json')
os.environ.setdefault('DB_BACKEND', 'mysql')
os.environ.setdefault('MYSQL_HOST', 'puntz08.mysql.pythonanywhere-services.com')
os.environ.setdefault('MYSQL_DB', 'puntz08$C-Point')
os.environ.setdefault('MYSQL_USER', 'puntz08')
os.environ.setdefault('MYSQL_PASSWORD', 'Trying123456')

from backend.services.firebase_notifications import (
    initialize_firebase,
    send_fcm_to_user,
    FIREBASE_AVAILABLE
)

def main():
    """Test FCM notification."""
    if len(sys.argv) < 2:
        print("Usage: python3 test_firebase_notification.py <username>")
        sys.exit(1)
    
    username = sys.argv[1]
    
    print("="*60)
    print("🔥 Firebase Cloud Messaging Test")
    print("="*60)
    
    # Check if Firebase is available
    if not FIREBASE_AVAILABLE:
        print("❌ Firebase Admin SDK not installed")
        print("Install with: pip3.10 install --user firebase-admin")
        sys.exit(1)
    
    print(f"\n1️⃣ Initializing Firebase...")
    if not initialize_firebase():
        print("❌ Firebase initialization failed")
        sys.exit(1)
    
    print("✅ Firebase initialized")
    
    print(f"\n2️⃣ Sending test notification to {username}...")
    sent = send_fcm_to_user(
        username=username,
        title="Test Notification",
        body="This is a test from Firebase!",
        data={"test": "true"}
    )
    
    if sent > 0:
        print(f"✅ Sent {sent} notification(s)")
        print("\nCheck your iPhone - notification should appear!")
    else:
        print(f"❌ No notifications sent")
        print(f"User {username} may not have any FCM tokens registered")
    
    print("="*60)


if __name__ == '__main__':
    main()
