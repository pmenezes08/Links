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
    
    # Step 1: Check modern APNs libraries
    print("\n1️⃣  Checking modern APNs libraries...")
    try:
        import httpx
        import jwt
        from cryptography.hazmat.primitives import serialization
        print("   ✅ httpx library available")
        print("   ✅ PyJWT library available")
        print("   ✅ cryptography library available")
        print("   ℹ️  Using modern HTTP/2 APNs implementation (Apple 2025 standard)")
    except ImportError as e:
        print(f"   ❌ Required library not available: {e}")
        print("\n   Fix: pip install 'httpx[http2]>=0.24.0' 'PyJWT>=2.8.0' --user")
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
    
    # Step 5: Generate JWT token
    print("\n5️⃣  Generating APNs JWT token...")
    try:
        import jwt
        from cryptography.hazmat.primitives import serialization
        from datetime import datetime
        
        # Read the .p8 private key
        with open(apns_key_path, 'rb') as key_file:
            private_key = serialization.load_pem_private_key(
                key_file.read(),
                password=None
            )
        
        # JWT header
        headers = {
            "alg": "ES256",
            "kid": apns_key_id
        }
        
        # JWT payload
        now = datetime.now().timestamp()
        payload = {
            "iss": apns_team_id,
            "iat": int(now)
        }
        
        # Generate token
        auth_token = jwt.encode(
            payload,
            private_key,
            algorithm="ES256",
            headers=headers
        )
        
        print(f"   ✅ JWT token generated successfully")
        print(f"   Environment: {'SANDBOX (TestFlight)' if use_sandbox else 'PRODUCTION (App Store)'}")
    except Exception as e:
        print(f"   ❌ Failed to generate JWT token: {e}")
        return False
    
    # Step 6: Send test notification via HTTP/2
    print("\n6️⃣  Sending test notification via HTTP/2...")
    try:
        import httpx
        
        # Build APNs payload
        payload = {
            "aps": {
                "alert": {
                    "title": "🧪 Test Notification",
                    "body": "APNs is working! Your notifications are configured correctly."
                },
                "badge": 1,
                "sound": "default"
            },
            "test": True
        }
        
        # APNs endpoint
        apns_server = "api.sandbox.push.apple.com" if use_sandbox else "api.push.apple.com"
        url = f"https://{apns_server}/3/device/{device_token}"
        
        # Headers
        headers = {
            "authorization": f"bearer {auth_token}",
            "apns-push-type": "alert",
            "apns-topic": apns_bundle_id,
            "apns-priority": "10"
        }
        
        print(f"   Sending to: {device_token[:20]}...")
        print(f"   Server: {apns_server}")
        print(f"   Bundle ID: {apns_bundle_id}")
        
        # Send via HTTP/2
        with httpx.Client(http2=True, timeout=10.0) as client:
            response = client.post(url, json=payload, headers=headers)
        
        if response.status_code == 200:
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
        else:
            print(f"\n❌ APNs returned status {response.status_code}")
            print(f"Response: {response.text}")
            
            if response.status_code == 400:
                print("\n💡 Hint: Bad request - check payload format")
            elif response.status_code == 403:
                print("\n💡 Hint: Forbidden - check credentials (Key ID, Team ID)")
            elif response.status_code == 410:
                print("\n💡 Hint: Device token is no longer active")
                print("   Solution: Reopen app to get new token")
            
            return False
        
    except Exception as e:
        print(f"\n❌ Failed to send notification: {e}")
        print(f"\nError type: {type(e).__name__}")
        print(f"Error details: {str(e)}")
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
