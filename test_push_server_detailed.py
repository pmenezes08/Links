#!/usr/bin/env python3.10
"""
Comprehensive push notification testing script
Tests server-side Firebase setup and token sending
"""

import sys
import os
import traceback
from datetime import datetime

# Add project to path
sys.path.insert(0, '/home/puntz08/WorkoutX/Links')

print("=" * 60)
print("🔍 PUSH NOTIFICATION SERVER DEBUGGING")
print("=" * 60)
print(f"Time: {datetime.now()}")
print("")

# Step 1: Check environment variables
print("1️⃣  Checking environment variables...")
firebase_creds = os.environ.get('FIREBASE_CREDENTIALS')

# If not set in environment, try the default location from WSGI
if not firebase_creds:
    print("   ⚠️  FIREBASE_CREDENTIALS not set in environment")
    print("   🔍 Trying default location from WSGI file...")
    firebase_creds = '/home/puntz08/secrets/cpoint-127c2-firebase-adminsdk-fbsvc-1f900dabeb.json'
    if os.path.exists(firebase_creds):
        print(f"   ✅ Found at default location: {firebase_creds}")
        os.environ['FIREBASE_CREDENTIALS'] = firebase_creds  # Set it for this session
    else:
        print(f"   ❌ File NOT FOUND at: {firebase_creds}")
        print("")
        print("   Please check:")
        print("   1. Is the file path correct?")
        print("   2. Does /home/puntz08/secrets/ directory exist?")
        print("   3. Run: ls -la /home/puntz08/secrets/")
        sys.exit(1)
else:
    print(f"   ✅ FIREBASE_CREDENTIALS is set: {firebase_creds}")

if os.path.exists(firebase_creds):
    print(f"   ✅ File exists: {firebase_creds}")
    file_size = os.path.getsize(firebase_creds)
    print(f"   ✅ File size: {file_size} bytes")
else:
    print(f"   ❌ File NOT FOUND: {firebase_creds}")
    sys.exit(1)
print("")

# Step 2: Import Firebase
print("2️⃣  Importing Firebase Admin SDK...")
try:
    import firebase_admin
    from firebase_admin import credentials, messaging
    print("   ✅ Firebase Admin SDK imported successfully")
except ImportError as e:
    print(f"   ❌ Failed to import Firebase: {e}")
    print("   Run: pip install firebase-admin")
    sys.exit(1)
print("")

# Step 3: Check if Firebase is initialized
print("3️⃣  Checking Firebase initialization...")
try:
    app = firebase_admin.get_app()
    print(f"   ✅ Firebase already initialized: {app.name}")
except ValueError:
    print("   ⚠️  Firebase not initialized, initializing now...")
    try:
        cred = credentials.Certificate(firebase_creds)
        firebase_admin.initialize_app(cred)
        print("   ✅ Firebase initialized successfully")
    except Exception as e:
        print(f"   ❌ Failed to initialize Firebase: {e}")
        traceback.print_exc()
        sys.exit(1)
print("")

# Step 4: Check database connection
print("4️⃣  Checking database connection...")
try:
    from backend.services.database import get_db_connection, get_sql_placeholder
    conn = get_db_connection()
    cursor = conn.cursor()
    print("   ✅ Database connection established")
except Exception as e:
    print(f"   ❌ Failed to connect to database: {e}")
    traceback.print_exc()
    sys.exit(1)
print("")

# Step 5: Check for Paulo's tokens in BOTH tables
print("5️⃣  Checking tokens for Paulo...")
ph = get_sql_placeholder()

# Check fcm_tokens table
try:
    cursor.execute(f"SELECT COUNT(*) as count FROM fcm_tokens WHERE username = {ph}", ("Paulo",))
    result = cursor.fetchone()
    fcm_count = result['count'] if isinstance(result, dict) else result[0]
    print(f"   📊 fcm_tokens table: {fcm_count} token(s)")
    
    if fcm_count > 0:
        cursor.execute(f"""
            SELECT token, platform, device_name, created_at, last_seen, is_active 
            FROM fcm_tokens 
            WHERE username = {ph}
            ORDER BY last_seen DESC
        """, ("Paulo",))
        rows = cursor.fetchall()
        
        for i, row in enumerate(rows, 1):
            if isinstance(row, dict):
                token_preview = row['token'][:40] if row['token'] else 'None'
                active = '✅' if row['is_active'] else '❌'
                print(f"   Token {i}: {active} {token_preview}...")
                print(f"      Platform: {row['platform']}")
                print(f"      Device: {row['device_name'] or 'N/A'}")
                print(f"      Created: {row['created_at']}")
                print(f"      Last seen: {row['last_seen']}")
            else:
                token_preview = row[0][:40] if row[0] else 'None'
                active = '✅' if row[5] else '❌'
                print(f"   Token {i}: {active} {token_preview}...")
                print(f"      Platform: {row[1]}")
                print(f"      Device: {row[2] or 'N/A'}")
                print(f"      Created: {row[3]}")
                print(f"      Last seen: {row[4]}")
except Exception as e:
    print(f"   ❌ Error checking fcm_tokens: {e}")
    fcm_count = 0

# Check push_tokens table (legacy)
try:
    cursor.execute(f"SELECT COUNT(*) as count FROM push_tokens WHERE username = {ph}", ("Paulo",))
    result = cursor.fetchone()
    push_count = result['count'] if isinstance(result, dict) else result[0]
    print(f"   📊 push_tokens table (legacy): {push_count} token(s)")
except Exception as e:
    print(f"   ⚠️  push_tokens table check failed: {e}")
    push_count = 0

print("")

if fcm_count == 0:
    print("❌ No FCM tokens found for Paulo!")
    print("   User needs to:")
    print("   1. Install app from TestFlight")
    print("   2. Open app and grant push notification permissions")
    print("   3. Log in as Paulo")
    print("   4. Token should be registered automatically")
    print("")
    cursor.close()
    conn.close()
    sys.exit(1)

# Step 6: Test sending notification
print("6️⃣  Attempting to send test notification...")

# Get the most recent active token
cursor.execute(f"""
    SELECT token, platform 
    FROM fcm_tokens 
    WHERE username = {ph} AND is_active = 1
    ORDER BY last_seen DESC
    LIMIT 1
""", ("Paulo",))

token_row = cursor.fetchone()
if not token_row:
    print("   ❌ No active tokens found!")
    cursor.close()
    conn.close()
    sys.exit(1)

if isinstance(token_row, dict):
    test_token = token_row['token']
    platform = token_row['platform']
else:
    test_token = token_row[0]
    platform = token_row[1]

print(f"   📱 Using token: {test_token[:40]}...")
print(f"   📱 Platform: {platform}")
print("")

# Build the message
print("7️⃣  Building Firebase message...")
try:
    message = messaging.Message(
        notification=messaging.Notification(
            title="🔥 Test Notification",
            body="This is a test from the server! If you see this, push notifications are working!"
        ),
        token=test_token,
        apns=messaging.APNSConfig(
            headers={
                'apns-priority': '10',
            },
            payload=messaging.APNSPayload(
                aps=messaging.Aps(
                    alert=messaging.ApsAlert(
                        title="🔥 Test Notification",
                        body="This is a test from the server! If you see this, push notifications are working!"
                    ),
                    badge=1,
                    sound='default',
                )
            )
        )
    )
    print("   ✅ Message built successfully")
except Exception as e:
    print(f"   ❌ Failed to build message: {e}")
    traceback.print_exc()
    cursor.close()
    conn.close()
    sys.exit(1)

print("")

# Send the message
print("8️⃣  Sending notification via Firebase...")
try:
    response = messaging.send(message)
    print(f"   ✅ SUCCESS! Message sent!")
    print(f"   📨 Firebase response: {response}")
    print("")
    print("🎉" * 30)
    print("   Check Paulo's iPhone - you should see the notification!")
    print("🎉" * 30)
except messaging.UnregisteredError as e:
    print(f"   ❌ Token is invalid or unregistered!")
    print(f"   Error: {e}")
    print("")
    print("   This means:")
    print("   - Token was valid but is now expired")
    print("   - App was uninstalled")
    print("   - Token was from wrong Firebase project")
    print("")
    print("   💡 Marking token as inactive in database...")
    try:
        cursor.execute(f"""
            UPDATE fcm_tokens 
            SET is_active = 0 
            WHERE token = {ph}
        """, (test_token,))
        conn.commit()
        print("   ✅ Token marked as inactive")
    except:
        pass
except messaging.SenderIdMismatchError as e:
    print(f"   ❌ Sender ID mismatch!")
    print(f"   Error: {e}")
    print("")
    print("   This means:")
    print("   - Token is from a DIFFERENT Firebase project")
    print("   - iOS app has wrong GoogleService-Info.plist")
    print("   - Server has wrong Firebase credentials")
except messaging.InvalidArgumentError as e:
    print(f"   ❌ Invalid argument!")
    print(f"   Error: {e}")
    print("")
    print("   This usually means:")
    print("   - Token format is invalid")
    print("   - Token is corrupted")
except Exception as e:
    print(f"   ❌ Failed to send notification!")
    print(f"   Error type: {type(e).__name__}")
    print(f"   Error: {e}")
    print("")
    print("   Full traceback:")
    traceback.print_exc()

cursor.close()
conn.close()

print("")
print("=" * 60)
print("✅ Debugging complete!")
print("=" * 60)
