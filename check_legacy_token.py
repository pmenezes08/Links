#!/usr/bin/env python3.10
"""Check what's in the legacy push_tokens table"""

import sys
sys.path.insert(0, '/home/puntz08/WorkoutX/Links')

from backend.services.database import get_db_connection, get_sql_placeholder

conn = get_db_connection()
cursor = conn.cursor()
ph = get_sql_placeholder()

print("🔍 Checking legacy push_tokens table for Paulo...")
print("=" * 60)
print("")

cursor.execute(f"""
    SELECT token, platform, created_at, last_used, is_active 
    FROM push_tokens 
    WHERE username = {ph}
    ORDER BY created_at DESC
""", ("Paulo",))

rows = cursor.fetchall()

if not rows:
    print("❌ No tokens found")
else:
    for i, row in enumerate(rows, 1):
        if isinstance(row, dict):
            token = row['token']
            platform = row['platform']
            created = row.get('created_at', 'N/A')
            last_used = row.get('last_used', 'N/A')
            is_active = row.get('is_active', 1)
        else:
            token = row[0]
            platform = row[1]
            created = row[2] if len(row) > 2 else 'N/A'
            last_used = row[3] if len(row) > 3 else 'N/A'
            is_active = row[4] if len(row) > 4 else 1
        
        print(f"Token {i}:")
        print(f"  Token: {token[:60] if token else 'None'}...")
        print(f"  Platform: {platform}")
        print(f"  Created: {created}")
        print(f"  Last used: {last_used}")
        print(f"  Active: {'✅ Yes' if is_active else '❌ No'}")
        print(f"  Length: {len(token) if token else 0} characters")
        print("")

cursor.close()
conn.close()

print("=" * 60)
print("")
print("📋 Note: These are OLD APNs tokens (not FCM tokens)")
print("   They won't work with current Firebase setup")
print("   You need FCM tokens from the new iOS build")
