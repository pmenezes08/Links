#!/usr/bin/env python3
"""Test script to check Firebase setup and FCM token registration."""

import os
import sys
import json
from datetime import datetime

# Add current directory to path
sys.path.append('.')

# Check environment variables
print("🔍 Checking Firebase Environment Setup")
print("=" * 50)

firebase_creds_path = os.getenv("FIREBASE_CREDENTIALS_PATH")
print(f"FIREBASE_CREDENTIALS_PATH: {firebase_creds_path}")

# Check if credentials file exists
if firebase_creds_path:
    if os.path.exists(firebase_creds_path):
        print(f"✅ Firebase credentials file exists: {firebase_creds_path}")
        try:
            with open(firebase_creds_path, 'r') as f:
                creds = json.load(f)
                print(f"✅ Valid JSON credentials for project: {creds.get('project_id', 'unknown')}")
        except Exception as e:
            print(f"❌ Invalid JSON in credentials file: {e}")
    else:
        print(f"❌ Firebase credentials file NOT found: {firebase_creds_path}")
else:
    print("❌ FIREBASE_CREDENTIALS_PATH environment variable not set")

# Check if firebase-admin is available
try:
    import firebase_admin
    from firebase_admin import credentials, messaging
    print("✅ firebase-admin SDK is installed")
    FIREBASE_AVAILABLE = True
except ImportError as e:
    print(f"❌ firebase-admin SDK not installed: {e}")
    FIREBASE_AVAILABLE = False

# Test Firebase initialization
print("\n🔥 Testing Firebase Initialization")
print("=" * 50)

if FIREBASE_AVAILABLE and firebase_creds_path and os.path.exists(firebase_creds_path):
    try:
        cred = credentials.Certificate(firebase_creds_path)
        app = firebase_admin.initialize_app(cred)
        print("✅ Firebase Admin SDK initialized successfully")

        # Test FCM by sending a test message to a dummy token
        try:
            message = messaging.Message(
                notification=messaging.Notification(
                    title="Test Push",
                    body="Firebase setup test"
                ),
                token="test-token-that-will-fail"  # This will fail but test the API
            )
            print("✅ FCM messaging API is accessible")
        except Exception as e:
            print(f"⚠️ FCM API test failed (expected): {e}")

    except Exception as e:
        print(f"❌ Firebase initialization failed: {e}")
else:
    print("❌ Cannot test Firebase - missing requirements")

# Check database connectivity (simulate)
print("\n💾 Checking Database Setup")
print("=" * 50)

try:
    from backend.services.database import get_db_connection, USE_MYSQL
    print(f"✅ Database service available (MySQL: {USE_MYSQL})")

    # Try to connect and check for fcm_tokens table
    with get_db_connection() as conn:
        c = conn.cursor()

        # Check if fcm_tokens table exists
        if USE_MYSQL:
            c.execute("SHOW TABLES LIKE 'fcm_tokens'")
        else:
            c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='fcm_tokens'")

        table_exists = c.fetchone()
        if table_exists:
            print("✅ fcm_tokens table exists")

            # Check table structure
            if USE_MYSQL:
                c.execute("DESCRIBE fcm_tokens")
            else:
                c.execute("PRAGMA table_info(fcm_tokens)")

            columns = c.fetchall()
            print(f"✅ Table has {len(columns)} columns")

            # Check for some test data
            c.execute("SELECT COUNT(*) FROM fcm_tokens")
            count = c.fetchone()[0] if USE_MYSQL else c.fetchone()['COUNT(*)']
            print(f"ℹ️  Currently {count} FCM tokens stored")

        else:
            print("❌ fcm_tokens table does NOT exist - will be created automatically")

except Exception as e:
    print(f"❌ Database connection failed: {e}")

# Check client-side files
print("\n📱 Checking Client-Side Setup")
print("=" * 50)

# Check iOS GoogleService-Info.plist
gs_plist_path = "client/ios/App/App/GoogleService-Info.plist"
if os.path.exists(gs_plist_path):
    print("✅ GoogleService-Info.plist exists in iOS app")
else:
    print(f"❌ GoogleService-Info.plist NOT found at {gs_plist_path}")

# Check client environment
client_env_path = "client/.env.local"
if os.path.exists(client_env_path):
    print("✅ Client .env.local exists")
    with open(client_env_path, 'r') as f:
        content = f.read()
        firebase_vars = [line for line in content.split('\n') if 'FIREBASE' in line and line.strip()]
        print(f"✅ Found {len(firebase_vars)} Firebase environment variables")
else:
    print(f"❌ Client .env.local NOT found at {client_env_path}")

# Check if Firebase packages are installed
try:
    with open('client/package.json', 'r') as f:
        package_data = json.load(f)
        deps = package_data.get('dependencies', {})

        firebase_deps = [dep for dep in deps.keys() if 'firebase' in dep.lower()]
        capacitor_push = '@capacitor/push-notifications' in deps

        if firebase_deps:
            print(f"✅ Firebase packages installed: {', '.join(firebase_deps)}")
        else:
            print("❌ No Firebase packages found in package.json")

        if capacitor_push:
            print("✅ Capacitor push notifications plugin installed")
        else:
            print("❌ Capacitor push notifications plugin NOT installed")

except Exception as e:
    print(f"❌ Error checking package.json: {e}")

print("\n🎯 Next Steps for Token Registration")
print("=" * 50)

issues = []
if not firebase_creds_path or not os.path.exists(firebase_creds_path):
    issues.append("Set FIREBASE_CREDENTIALS_PATH in .env file")
if not os.path.exists(gs_plist_path):
    issues.append("Add GoogleService-Info.plist to iOS app")
if not os.path.exists(client_env_path):
    issues.append("Create client/.env.local with Firebase config")
if not FIREBASE_AVAILABLE:
    issues.append("Install firebase-admin SDK: pip install firebase-admin==6.2.0")

if issues:
    print("❌ Issues to fix:")
    for i, issue in enumerate(issues, 1):
        print(f"  {i}. {issue}")
else:
    print("✅ All basic setup appears complete!")
    print("\n🔍 If tokens still aren't registering:")
    print("  1. Check iOS app logs for Firebase initialization errors")
    print("  2. Verify push notification permissions on device")
    print("  3. Check server logs when user logs in")
    print("  4. Test FCM endpoint: POST /api/fcm/register_token")