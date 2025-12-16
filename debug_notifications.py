#!/usr/bin/env python3
"""Debug script to check notifications table and badge count logic."""

import os
import sys

# Load environment variables
env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
if os.path.exists(env_file):
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ.setdefault(key.strip(), value.strip())

def debug_notifications():
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from backend.services.database import get_db_connection, USE_MYSQL
    
    print(f"🔧 Debug Notifications")
    print(f"   Database type: {'MySQL' if USE_MYSQL else 'SQLite'}")
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check notifications table structure
        print("\n📋 Notifications table structure:")
        if USE_MYSQL:
            cursor.execute("DESCRIBE notifications")
        else:
            cursor.execute("PRAGMA table_info(notifications)")
        
        for row in cursor.fetchall():
            print(f"   {row}")
        
        # Count total notifications
        cursor.execute("SELECT COUNT(*) as cnt FROM notifications")
        row = cursor.fetchone()
        total = row['cnt'] if hasattr(row, 'keys') else row[0]
        print(f"\n📊 Total notifications in table: {total}")
        
        # Count by user
        cursor.execute("""
            SELECT user_id, COUNT(*) as cnt, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread
            FROM notifications 
            GROUP BY user_id
            ORDER BY cnt DESC
            LIMIT 10
        """)
        print("\n📊 Notifications by user (top 10):")
        for row in cursor.fetchall():
            if hasattr(row, 'keys'):
                print(f"   {row['user_id']}: {row['cnt']} total, {row['unread']} unread")
            else:
                print(f"   {row[0]}: {row[1]} total, {row[2]} unread")
        
        # Show recent notifications
        cursor.execute("""
            SELECT id, user_id, from_user, type, message, is_read, created_at
            FROM notifications 
            ORDER BY created_at DESC
            LIMIT 10
        """)
        print("\n📋 Recent notifications (last 10):")
        for row in cursor.fetchall():
            if hasattr(row, 'keys'):
                print(f"   ID={row['id']}, to={row['user_id']}, from={row['from_user']}, type={row['type']}, read={row['is_read']}")
                print(f"      msg: {(row['message'] or '')[:50]}...")
            else:
                print(f"   ID={row[0]}, to={row[1]}, from={row[2]}, type={row[3]}, read={row[5]}")
        
        # Test badge count query for a specific user
        print("\n🔍 Testing badge count query:")
        cursor.execute("SELECT DISTINCT user_id FROM notifications LIMIT 5")
        users = cursor.fetchall()
        for u in users:
            user_id = u['user_id'] if hasattr(u, 'keys') else u[0]
            cursor.execute("SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0", (user_id,))
            row = cursor.fetchone()
            count = row['cnt'] if hasattr(row, 'keys') else row[0]
            print(f"   {user_id}: {count} unread notifications")
        
        cursor.close()
        conn.close()
        
        print("\n✅ Debug complete!")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0

if __name__ == "__main__":
    sys.exit(debug_notifications())
