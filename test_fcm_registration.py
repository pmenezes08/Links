#!/usr/bin/env python3
"""Test FCM token registration after setup is complete."""

import requests
import json
import sys

def test_fcm_registration():
    """Test the FCM token registration endpoint."""

    print("🧪 Testing FCM Token Registration")
    print("=" * 50)

    # Test data - replace with real values
    test_data = {
        "fcm_token": "test-fcm-token-12345",
        "platform": "ios",
        "username": "testuser"
    }

    try:
        # Assuming the app is running on localhost:5000
        # In production, change this to your actual domain
        url = "http://localhost:5000/api/fcm/register_token"

        print(f"📡 Sending POST request to: {url}")
        print(f"📦 Data: {json.dumps(test_data, indent=2)}")

        response = requests.post(url, json=test_data, timeout=10)

        print(f"📊 Response status: {response.status_code}")

        if response.status_code == 200:
            result = response.json()
            print(f"✅ Success: {result}")
            return True
        else:
            print(f"❌ Error: {response.text}")
            return False

    except requests.exceptions.ConnectionError:
        print("❌ Connection failed - is the Flask app running?")
        print("   Start with: python3 bodybuilding_app.py")
        return False
    except Exception as e:
        print(f"❌ Request failed: {e}")
        return False

def test_firebase_initialization():
    """Test if Firebase can be initialized."""

    print("\n🔥 Testing Firebase Initialization")
    print("=" * 50)

    try:
        import firebase_admin
        from firebase_admin import credentials
        import os

        creds_path = os.getenv("FIREBASE_CREDENTIALS_PATH")
        if not creds_path:
            print("❌ FIREBASE_CREDENTIALS_PATH not set")
            return False

        if not os.path.exists(creds_path):
            print(f"❌ Credentials file not found: {creds_path}")
            return False

        # Try to load credentials
        cred = credentials.Certificate(creds_path)
        print("✅ Firebase credentials loaded successfully")

        # Try to initialize (this will fail if already initialized, but that's ok)
        try:
            app = firebase_admin.initialize_app(cred)
            print("✅ Firebase app initialized")
        except ValueError as e:
            if "already exists" in str(e):
                print("✅ Firebase app already initialized")
            else:
                raise e

        return True

    except ImportError:
        print("❌ firebase-admin not installed")
        return False
    except Exception as e:
        print(f"❌ Firebase initialization failed: {e}")
        return False

if __name__ == "__main__":
    print("🚀 FCM Token Registration Test")
    print("=" * 50)

    # Test Firebase setup
    firebase_ok = test_firebase_initialization()

    if firebase_ok:
        # Test endpoint
        endpoint_ok = test_fcm_registration()

        if endpoint_ok:
            print("\n🎉 SUCCESS: FCM token registration is working!")
            print("\n📱 Next: Test with a real iOS device:")
            print("   1. Build and install iOS app")
            print("   2. Log in to trigger token registration")
            print("   3. Check server logs for 'Registering FCM token'")
            print("   4. Send a test push notification")
        else:
            print("\n❌ FCM endpoint test failed")
    else:
        print("\n❌ Firebase setup incomplete")