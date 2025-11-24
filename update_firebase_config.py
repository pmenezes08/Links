#!/usr/bin/env python3
"""
Script to update Firebase config files with real values.
Run this after you've obtained the real Firebase credentials.
"""

import json
import plistlib
import os

def update_firebase_configs():
    """Update Firebase configuration files with real values."""

    print("🔄 Firebase Configuration Update")
    print("=" * 40)

    # Path to your real Firebase service account JSON on PythonAnywhere
    real_creds_path = "/home/puntz08/secrets/firebase-service-account-key.json"

    # Check if real credentials exist
    if not os.path.exists(real_creds_path):
        print(f"❌ Real Firebase credentials not found at: {real_creds_path}")
        print("   Please upload your Firebase service account JSON file there first")
        return False

    # Load real credentials
    with open(real_creds_path, 'r') as f:
        real_creds = json.load(f)

    print(f"✅ Loaded credentials for project: {real_creds['project_id']}")

    # Update GoogleService-Info.plist
    plist_path = "client/ios/App/App/GoogleService-Info.plist"

    # Create plist structure from Firebase credentials
    plist_data = {
        'CLIENT_ID': f"{real_creds['client_id']}.apps.googleusercontent.com",
        'REVERSED_CLIENT_ID': f"com.googleusercontent.apps.{real_creds['client_id']}",
        'ANDROID_CLIENT_ID': f"{real_creds['client_id']}.apps.googleusercontent.com",
        'API_KEY': real_creds.get('api_key', 'NOT_FOUND'),  # May not be in service account
        'GCM_SENDER_ID': real_creds.get('project_number', 'NOT_FOUND'),  # May not be in service account
        'PLIST_VERSION': '1',
        'BUNDLE_ID': 'co.cpoint.app',  # Your iOS bundle ID
        'PROJECT_ID': real_creds['project_id'],
        'STORAGE_BUCKET': f"{real_creds['project_id']}.appspot.com",
        'IS_ADS_ENABLED': False,
        'IS_ANALYTICS_ENABLED': False,
        'IS_APPINVITE_ENABLED': True,
        'IS_GCM_ENABLED': True,
        'IS_SIGNIN_ENABLED': True,
        'GOOGLE_APP_ID': real_creds.get('mobilesdk_app_id', 'NOT_FOUND'),  # May not be in service account
    }

    # Write plist file
    with open(plist_path, 'wb') as f:
        plistlib.dump(plist_data, f)

    print(f"✅ Updated: {plist_path}")

    # Update client/.env.local
    env_local_path = "client/.env.local"

    env_content = f"""# Firebase Configuration for iOS Push Notifications
REACT_APP_FIREBASE_API_KEY={plist_data['API_KEY']}
REACT_APP_FIREBASE_AUTH_DOMAIN={real_creds['project_id']}.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID={real_creds['project_id']}
REACT_APP_FIREBASE_STORAGE_BUCKET={real_creds['project_id']}.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID={plist_data['GCM_SENDER_ID']}
REACT_APP_FIREBASE_APP_ID={plist_data['GOOGLE_APP_ID']}
REACT_APP_FIREBASE_VAPID_KEY=YOUR_VAPID_KEY_FROM_FIREBASE_CONSOLE
"""

    with open(env_local_path, 'w') as f:
        f.write(env_content)

    print(f"✅ Updated: {env_local_path}")

    print("\n⚠️  IMPORTANT: You still need to:")
    print("   1. Get the VAPID key from Firebase Console → Project Settings → Cloud Messaging")
    print("   2. Replace YOUR_VAPID_KEY_FROM_FIREBASE_CONSOLE in client/.env.local")
    print("   3. Get API_KEY, GCM_SENDER_ID, and GOOGLE_APP_ID from Firebase Console if not in service account")

    return True

if __name__ == "__main__":
    success = update_firebase_configs()
    if success:
        print("\n🎉 Firebase config files updated!")
        print("   Next: Fill in any remaining YOUR_* values and test FCM")
    else:
        print("\n❌ Failed to update Firebase config files")