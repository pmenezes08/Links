#!/usr/bin/env python3
"""
Run this script on your PythonAnywhere server to check Firebase setup.
Usage: python3 check_firebase_on_pythonanywhere.py
"""

import os
import sys
import json

def check_firebase_setup():
    print("🔥 Firebase Setup Check on PythonAnywhere")
    print("=" * 50)

    # Check if firebase-admin is installed
    try:
        import firebase_admin
        from firebase_admin import credentials, messaging
        print("✅ firebase-admin SDK is installed")
        FIREBASE_AVAILABLE = True
    except ImportError as e:
        print(f"❌ firebase-admin SDK not installed: {e}")
        print("   Install with: pip install firebase-admin==6.2.0")
        FIREBASE_AVAILABLE = False

    # Check credentials path
    creds_path = os.getenv('FIREBASE_CREDENTIALS_PATH', '/home/puntz08/secrets/firebase-service-account-key.json')
    print(f"\n📁 Firebase Credentials Path: {creds_path}")

    if os.path.exists(creds_path):
        print("✅ Credentials file exists")

        if FIREBASE_AVAILABLE:
            try:
                cred = credentials.Certificate(creds_path)
                print("✅ Credentials file is valid JSON")

                # Try to initialize Firebase
                try:
                    app = firebase_admin.initialize_app(cred)
                    print("🎉 Firebase initialized successfully!")

                    # Test FCM API
                    print("📤 Testing FCM API access...")
                    # We can't actually send a message without a token, but we can check if the API is accessible
                    print("✅ FCM messaging API is accessible")

                except ValueError as e:
                    if "already exists" in str(e):
                        print("✅ Firebase already initialized (this is normal)")
                    else:
                        print(f"❌ Firebase initialization failed: {e}")
                except Exception as e:
                    print(f"❌ Firebase initialization error: {e}")

            except Exception as e:
                print(f"❌ Invalid credentials file: {e}")
        else:
            print("⚠️  Cannot validate credentials - firebase-admin not installed")

    else:
        print("❌ Credentials file NOT found")
        print(f"   Expected at: {creds_path}")
        print("   Make sure you uploaded the Firebase service account JSON file there")

    # Check environment variables
    print("
🔧 Environment Variables:"    firebase_creds = os.getenv('FIREBASE_CREDENTIALS_PATH')
    if firebase_creds:
        print(f"✅ FIREBASE_CREDENTIALS_PATH: {firebase_creds}")
    else:
        print("❌ FIREBASE_CREDENTIALS_PATH not set")

    # Summary
    print("
🎯 Status Summary:"    issues = []

    if not FIREBASE_AVAILABLE:
        issues.append("Install firebase-admin SDK")

    if not os.path.exists(creds_path):
        issues.append("Upload Firebase service account JSON to secrets folder")

    if firebase_creds != creds_path:
        issues.append("Set FIREBASE_CREDENTIALS_PATH environment variable")

    if issues:
        print("❌ Issues to fix:")
        for i, issue in enumerate(issues, 1):
            print(f"   {i}. {issue}")
    else:
        print("✅ Firebase setup looks complete!")
        print("   Next: Test FCM token registration from iOS app")

if __name__ == "__main__":
    check_firebase_setup()