#!/usr/bin/env python3.10
"""
Insert a test FCM token for debugging
This helps test the server independently of iOS app
"""

import sys
sys.path.insert(0, '/home/puntz08/WorkoutX/Links')

from backend.services.database import get_db_connection, get_sql_placeholder

# A test token (this is fake, but has the right format)
# Replace with a real token from iOS app if you have one
TEST_TOKEN = input("Enter FCM token (or press Enter to use fake test token): ").strip()

if not TEST_TOKEN:
    TEST_TOKEN = "fake_test_token_cAbCdEfGhIjKlMnOpQrStUvWxYz0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    print(f"Using fake token: {TEST_TOKEN[:50]}...")

USERNAME = input("Enter username (default: Paulo): ").strip() or "Paulo"

print("")
print(f"Inserting token for user: {USERNAME}")

conn = get_db_connection()
cursor = conn.cursor()
ph = get_sql_placeholder()

try:
    cursor.execute(f"""
        INSERT INTO fcm_tokens (token, username, platform, device_name, last_seen, is_active)
        VALUES ({ph}, {ph}, {ph}, {ph}, NOW(), 1)
        ON DUPLICATE KEY UPDATE
            username = VALUES(username),
            last_seen = NOW(),
            is_active = 1
    """, (TEST_TOKEN, USERNAME, "ios", "test_device"))
    
    conn.commit()
    print("✅ Token inserted successfully!")
    print("")
    print("Now run:")
    print(f"  python3.10 test_push_server_detailed.py")
    
except Exception as e:
    print(f"❌ Error: {e}")
    conn.rollback()

cursor.close()
conn.close()
