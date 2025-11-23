#!/usr/bin/env python3
"""
Test APNs (Apple Push Notification Service) setup and send test notification
"""

import os
import sys

def test_apns_setup():
    """Test APNs configuration and optionally send test notification"""
    
    print("=" * 60)
    print("🔔 APNs Setup Diagnostic Tool")
    print("=" * 60)
    
    # Check 1: apns2 library
    print("\n1️⃣  Checking apns2 library...")
    try:
        import apns2
        from apns2.client import APNsClient
        from apns2.payload import Payload
        from apns2.credentials import TokenCredentials
        print("   ✅ apns2 library is installed")
        print(f"   Location: {apns2.__file__}")
        try:
            print(f"   Version: {apns2.__version__}")
        except:
            pass
    except ImportError as e:
        print("   ❌ apns2 library NOT installed in this Python environment")
        print(f"   Error: {e}")
        print("\n   This might be a Python environment issue.")
        print("   The library may be installed but in a different Python environment.")
        print("\n   Solutions:")
        print("   1. Make sure you're using the same Python as your web app")
        print("   2. If using a virtual environment, activate it first")
        print("   3. Try: python3 -m pip install apns2==0.7.2 --user")
        print("   4. Check your web app's Python with: python check_python_environment.py")
        return False
    
    # Check 2: Environment variables
    print("\n2️⃣  Checking environment variables...")
    apns_key_path = os.getenv('APNS_KEY_PATH')
    apns_key_id = os.getenv('APNS_KEY_ID')
    apns_team_id = os.getenv('APNS_TEAM_ID')
    apns_bundle_id = os.getenv('APNS_BUNDLE_ID', 'co.cpoint.app')
    use_sandbox = os.getenv('APNS_USE_SANDBOX', 'true').lower() == 'true'
    
    print(f"   APNS_KEY_PATH: {apns_key_path or '❌ NOT SET'}")
    print(f"   APNS_KEY_ID: {apns_key_id or '❌ NOT SET'}")
    print(f"   APNS_TEAM_ID: {apns_team_id or '❌ NOT SET'}")
    print(f"   APNS_BUNDLE_ID: {apns_bundle_id}")
    print(f"   APNS_USE_SANDBOX: {use_sandbox}")
    
    if not all([apns_key_path, apns_key_id, apns_team_id]):
        print("\n   ❌ Missing required environment variables!")
        print("\n   Add these to your WSGI file:")
        print("   os.environ['APNS_KEY_PATH'] = '/home/puntz08/secrets/AuthKey_XXXXX.p8'")
        print("   os.environ['APNS_KEY_ID'] = 'YOUR_KEY_ID'")
        print("   os.environ['APNS_TEAM_ID'] = 'YOUR_TEAM_ID'")
        print("   os.environ['APNS_BUNDLE_ID'] = 'co.cpoint.app'")
        print("   os.environ['APNS_USE_SANDBOX'] = 'true'  # For TestFlight")
        return False
    
    print("   ✅ All environment variables are set")
    
    # Check 3: .p8 key file
    print("\n3️⃣  Checking .p8 key file...")
    if not os.path.exists(apns_key_path):
        print(f"   ❌ Key file NOT FOUND: {apns_key_path}")
        print("\n   Steps to fix:")
        print("   1. Download .p8 file from Apple Developer Portal")
        print("   2. Upload to your server at the path above")
        print("   3. Run: chmod 600 <path_to_p8_file>")
        return False
    
    print(f"   ✅ Key file exists: {apns_key_path}")
    
    # Check file permissions
    stat_info = os.stat(apns_key_path)
    permissions = oct(stat_info.st_mode)[-3:]
    print(f"   File permissions: {permissions}")
    if permissions not in ['600', '400']:
        print(f"   ⚠️  Warning: Permissions should be 600 for security")
        print(f"   Run: chmod 600 {apns_key_path}")
    
    # Check 4: Database connection and push_tokens table
    print("\n4️⃣  Checking database...")
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from backend.services.database import get_db_connection, get_sql_placeholder
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if push_tokens table exists
        try:
            ph = get_sql_placeholder()
            cursor.execute(f"SELECT COUNT(*) as count FROM push_tokens WHERE platform = {ph}", ('ios',))
            result = cursor.fetchone()
            count = result[0] if result else 0
            print(f"   ✅ push_tokens table exists")
            print(f"   Found {count} iOS device token(s)")
            
            # Show recent tokens
            if count > 0:
                cursor.execute(
                    f"SELECT username, LEFT(token, 20) as token_preview, created_at FROM push_tokens WHERE platform = {ph} ORDER BY created_at DESC LIMIT 5",
                    ('ios',)
                )
                print("\n   Recent iOS tokens:")
                for row in cursor.fetchall():
                    username = row[0]
                    token_preview = row[1]
                    created_at = row[2]
                    print(f"   - {username}: {token_preview}... (registered: {created_at})")
        except Exception as e:
            print(f"   ❌ push_tokens table error: {e}")
            print("   Run: python add_push_tokens_table.py")
            return False
        
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"   ❌ Database error: {e}")
        return False
    
    # Check 5: Test APNs connection
    print("\n5️⃣  Testing APNs connection...")
    try:
        client = APNsClient(
            credentials=apns_key_path,
            use_sandbox=use_sandbox,
            team_id=apns_team_id,
            auth_key_id=apns_key_id
        )
        print(f"   ✅ APNs client created successfully")
        print(f"   Using {'SANDBOX' if use_sandbox else 'PRODUCTION'} APNs server")
        
    except Exception as e:
        print(f"   ❌ Failed to create APNs client: {e}")
        return False
    
    # Summary
    print("\n" + "=" * 60)
    print("✅ APNs Setup is COMPLETE!")
    print("=" * 60)
    
    # Offer to send test notification
    print("\n📲 Test Notification Options:")
    print("   To send a test notification, get a device token from your logs")
    print("   and run:")
    print("   python test_apns_send.py <device_token>")
    
    return True

def send_test_notification(device_token):
    """Send a test notification to a specific device"""
    print("\n📤 Sending test notification...")
    
    try:
        from apns2.client import APNsClient
        from apns2.payload import Payload
    except ImportError:
        print("❌ apns2 not installed")
        return
    
    apns_key_path = os.getenv('APNS_KEY_PATH')
    apns_key_id = os.getenv('APNS_KEY_ID')
    apns_team_id = os.getenv('APNS_TEAM_ID')
    apns_bundle_id = os.getenv('APNS_BUNDLE_ID', 'co.cpoint.app')
    use_sandbox = os.getenv('APNS_USE_SANDBOX', 'true').lower() == 'true'
    
    try:
        client = APNsClient(
            credentials=apns_key_path,
            use_sandbox=use_sandbox,
            team_id=apns_team_id,
            auth_key_id=apns_key_id
        )
        
        payload = Payload(
            alert={'title': '🎉 Test Notification', 'body': 'APNs is working!'},
            badge=1,
            sound='default'
        )
        
        print(f"Sending to: {device_token[:20]}...")
        print(f"Bundle ID: {apns_bundle_id}")
        print(f"Environment: {'Sandbox' if use_sandbox else 'Production'}")
        
        client.send_notification(device_token, payload, apns_bundle_id)
        print("\n✅ Test notification sent successfully!")
        print("Check your iOS device for the notification.")
        
    except Exception as e:
        print(f"\n❌ Failed to send notification: {e}")
        print(f"Error type: {type(e).__name__}")

if __name__ == '__main__':
    if len(sys.argv) > 1:
        # Send test notification to specific token
        device_token = sys.argv[1]
        send_test_notification(device_token)
    else:
        # Run diagnostic
        test_apns_setup()
