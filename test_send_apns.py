#!/usr/bin/env python3
"""
Test APNs notification sending directly
Usage: python3 test_send_apns.py <username>
       python3 test_send_apns.py --token <device_token>
"""

import sys
import os

# Add project to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def test_apns_notification(username=None, device_token=None):
    """Send test APNs notification"""
    
    print("=" * 60)
    print("🧪 APNs Notification Test")
    print("=" * 60)
    
    # Step 1: Check apns2 library
    print("\n1️⃣  Checking apns2 library...")
    try:
        from apns2.client import APNsClient
        from apns2.credentials import TokenCredentials
        from apns2.payload import Payload
        print("   ✅ apns2 library available")
    except ImportError as e:
        print(f"   ❌ apns2 library not available: {e}")
        print("\n   Fix: pip install apns2==0.7.2 --user")
        return False
    
    # Step 2: Check environment variables
    print("\n2️⃣  Checking environment variables...")
    apns_key_path = os.getenv('APNS_KEY_PATH', '/home/puntz08/secrets/AuthKey_X2X7S84MLF.p8')
    apns_key_id = os.getenv('APNS_KEY_ID', 'X2X7S84MLF')
    apns_team_id = os.getenv('APNS_TEAM_ID', 'SP6N8UL583')
    apns_bundle_id = os.getenv('APNS_BUNDLE_ID', 'co.cpoint.app')
    use_sandbox = os.getenv('APNS_USE_SANDBOX', 'true').lower() == 'true'
    
    print(f"   APNS_KEY_PATH: {apns_key_path}")
    print(f"   APNS_KEY_ID: {apns_key_id}")
    print(f"   APNS_TEAM_ID: {apns_team_id}")
    print(f"   APNS_BUNDLE_ID: {apns_bundle_id}")
    print(f"   APNS_USE_SANDBOX: {use_sandbox}")
    
    if not all([apns_key_path, apns_key_id, apns_team_id]):
        print("   ⚠️  Using default values (env vars not set)")
        print("   Note: This is normal when running outside WSGI context")
    
    # Step 3: Check .p8 file
    print("\n3️⃣  Checking .p8 key file...")
    if not os.path.exists(apns_key_path):
        print(f"   ❌ Key file not found: {apns_key_path}")
        print("\n   Fix: Upload .p8 file from Apple Developer Portal")
        return False
    
    print(f"   ✅ Key file exists: {apns_key_path}")
    
    # Check permissions
    import stat
    st = os.stat(apns_key_path)
    perms = oct(st.st_mode)[-3:]
    print(f"   File permissions: {perms}")
    if perms not in ['600', '400']:
        print(f"   ⚠️  Warning: Recommended permissions are 600")
    
    # Step 4: Get device token
    print("\n4️⃣  Getting device token...")
    if device_token:
        print(f"   Using provided token: {device_token[:20]}...")
    elif username:
        try:
            from backend.services.database import get_db_connection, get_sql_placeholder
            conn = get_db_connection()
            cursor = conn.cursor()
            ph = get_sql_placeholder()
            
            cursor.execute(
                f"SELECT token FROM push_tokens WHERE username = {ph} AND platform = 'ios' AND is_active = 1 ORDER BY created_at DESC LIMIT 1",
                (username,)
            )
            result = cursor.fetchone()
            cursor.close()
            conn.close()
            
            if not result:
                print(f"   ❌ No active iOS token found for user: {username}")
                print("\n   Possible reasons:")
                print("   - User hasn't opened the app and allowed notifications")
                print("   - Token was marked inactive (device rejected)")
                print("   - User is on Android")
                return False
            
            device_token = result[0]
            print(f"   ✅ Found token for {username}: {device_token[:20]}...")
            
        except Exception as e:
            print(f"   ❌ Database error: {e}")
            return False
    else:
        print("   ❌ No username or token provided")
        print("\n   Usage: python3 test_send_apns.py <username>")
        print("          python3 test_send_apns.py --token <device_token>")
        return False
    
    # Step 5: Initialize APNs client
    print("\n5️⃣  Initializing APNs client...")
    try:
        from pathlib import Path
        credentials = TokenCredentials(
            auth_key_path=str(Path(apns_key_path)),
            auth_key_id=apns_key_id,
            team_id=apns_team_id,
        )
        client = APNsClient(
            credentials,
            use_sandbox=use_sandbox,
            use_alternative_port=False,
        )
        print(f"   ✅ APNs client initialized")
        print(f"   Environment: {'SANDBOX (TestFlight)' if use_sandbox else 'PRODUCTION (App Store)'}")
    except Exception as e:
        print(f"   ❌ Failed to initialize client: {e}")
        return False
    
    # Step 6: Send test notification
    print("\n6️⃣  Sending test notification...")
    try:
        payload = Payload(
            alert={
                'title': '🧪 Test Notification',
                'body': 'APNs is working! Your notifications are configured correctly.'
            },
            badge=1,
            sound='default',
            custom={'test': True, 'timestamp': str(os.time() if hasattr(os, 'time') else 'now')}
        )
        
        print(f"   Sending to: {device_token[:20]}...")
        print(f"   Bundle ID: {apns_bundle_id}")
        
        client.send_notification(device_token, payload, apns_bundle_id, push_type='alert')
        
        print("\n" + "=" * 60)
        print("✅ SUCCESS! Test notification sent!")
        print("=" * 60)
        print("\nCheck your iPhone for the notification.")
        print("If it doesn't appear within 10 seconds:")
        print("  1. Check device has internet connection")
        print("  2. Verify notifications are enabled for your app")
        print(f"  3. Confirm app is {'TestFlight' if use_sandbox else 'App Store'} build")
        print("  4. Try reopening the app")
        
        return True
        
    except Exception as e:
        print(f"\n❌ Failed to send notification: {e}")
        print(f"\nError type: {type(e).__name__}")
        print(f"Error details: {str(e)}")
        
        # Common error hints
        if 'BadDeviceToken' in str(e):
            print("\n💡 Hint: Token is invalid or app was reinstalled")
            print("   Solution: Reopen app to get new token")
        elif 'Unregistered' in str(e):
            print("\n💡 Hint: Token is no longer registered with APNs")
            print("   Solution: Reopen app to re-register")
        elif 'TooManyProviderTokenUpdates' in str(e):
            print("\n💡 Hint: APNs rate limit hit")
            print("   Solution: Wait a moment and try again")
        
        return False

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 test_send_apns.py <username>")
        print("       python3 test_send_apns.py --token <device_token>")
        sys.exit(1)
    
    if sys.argv[1] == '--token':
        if len(sys.argv) < 3:
            print("Error: --token requires a device token")
            sys.exit(1)
        success = test_apns_notification(device_token=sys.argv[2])
    else:
        success = test_apns_notification(username=sys.argv[1])
    
    sys.exit(0 if success else 1)
