#!/usr/bin/env python3
"""Check all push tokens to diagnose registration."""

import os
import sys

# Set MySQL env vars
os.environ['MYSQL_HOST'] = 'puntz08.mysql.pythonanywhere-services.com'
os.environ['MYSQL_USER'] = 'puntz08'
os.environ['MYSQL_DB'] = 'puntz08$C-Point'
os.environ['MYSQL_PASSWORD'] = '5r4VN4Qq'

try:
    from backend.services.database import get_db_connection
    
    print("=" * 60)
    print("📊 Push Token Status")
    print("=" * 60)
    print()
    
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        # Check all tokens
        print("1️⃣ All tokens in database:")
        cursor.execute("""
            SELECT 
                id, 
                username, 
                LEFT(token, 30) as token_preview,
                platform,
                created_at,
                updated_at,
                is_active
            FROM push_tokens 
            ORDER BY created_at DESC
        """)
        
        rows = cursor.fetchall()
        if rows:
            print(f"   Found {len(rows)} token(s):")
            for row in rows:
                if hasattr(row, 'keys'):
                    print(f"   - ID: {row['id']}, User: {row['username']}, Platform: {row['platform']}")
                    print(f"     Token preview: {row['token_preview']}...")
                    print(f"     Created: {row['created_at']}")
                else:
                    print(f"   - ID: {row[0]}, User: {row[1]}, Platform: {row[3]}")
                    print(f"     Token preview: {row[2]}...")
                    print(f"     Created: {row[4]}")
                print()
        else:
            print("   ❌ No tokens found")
            print()
        
        # Count anonymous tokens
        print("2️⃣ Anonymous tokens:")
        cursor.execute("SELECT COUNT(*) FROM push_tokens WHERE username LIKE 'anonymous_%'")
        anon_count = cursor.fetchone()[0]
        print(f"   Count: {anon_count}")
        print()
        
        # Count Paulo tokens
        print("3️⃣ Paulo's tokens:")
        cursor.execute("SELECT COUNT(*) FROM push_tokens WHERE username = 'Paulo'")
        paulo_count = cursor.fetchone()[0]
        print(f"   Count: {paulo_count}")
        print()
        
        # Analysis
        print("=" * 60)
        print("📋 Analysis")
        print("=" * 60)
        print()
        
        if anon_count > 1:
            print(f"✅ Found {anon_count} anonymous token(s)")
            print()
            print("📱 NEXT STEP: Log in as Paulo in the TestFlight app")
            print("   The anonymous token will be automatically associated")
            print()
            
            # Show anonymous tokens
            cursor.execute("""
                SELECT username, LEFT(token, 20) as token_preview, created_at 
                FROM push_tokens 
                WHERE username LIKE 'anonymous_%'
                ORDER BY created_at DESC
            """)
            anon_rows = cursor.fetchall()
            print("   Anonymous tokens:")
            for row in anon_rows:
                if hasattr(row, 'keys'):
                    print(f"   - {row['username']}: {row['token_preview']}... ({row['created_at']})")
                else:
                    print(f"   - {row[0]}: {row[1]}... ({row[2]})")
            print()
            
        elif anon_count == 1:
            # Check if it's the test token
            cursor.execute("SELECT token FROM push_tokens WHERE username LIKE 'anonymous_%'")
            token_row = cursor.fetchone()
            if hasattr(token_row, 'keys'):
                token = token_row['token']
            else:
                token = token_row[0]
            
            if token == 'test_token_works':
                print("⚠️  Only found the test token (no real iOS token yet)")
                print()
                print("📱 NEXT STEP: Open the TestFlight app on your iPhone")
                print("   1. Force quit the app completely")
                print("   2. Open it again")
                print("   3. Wait 30 seconds")
                print("   4. Run this script again")
                print()
            else:
                print("✅ Found 1 real anonymous token!")
                print(f"   Token: {token[:20]}...")
                print()
                print("📱 NEXT STEP: Log in as Paulo in the TestFlight app")
                print()
        else:
            print("❌ No tokens found")
            print()
            print("📱 TROUBLESHOOTING:")
            print("   1. Check iPhone Settings → C-Point → Notifications (must be ON)")
            print("   2. Force quit and reopen the TestFlight app")
            print("   3. Wait 30 seconds after opening")
            print("   4. Check iOS console logs (if you have Xcode)")
            print()
        
        if paulo_count > 0:
            print("✅ Paulo already has a token registered!")
            print()
            print("🧪 NEXT STEP: Test sending notification")
            print("   python3 test_send_apns.py Paulo")
            print()
        
        cursor.close()
    
    print("=" * 60)
    
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
