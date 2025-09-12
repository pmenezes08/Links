#!/usr/bin/env python3
"""
Fix Duplicate Messages and Notifications
Identifies and fixes causes of duplicate messages and notifications
"""

import os
import sys

def fix_duplicate_issues():
    """Fix duplicate message and notification issues"""
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        # Get MySQL credentials
        host = os.environ.get('MYSQL_HOST', 'puntz08.mysql.pythonanywhere-services.com')
        user = os.environ.get('MYSQL_USER', 'puntz08')
        password = os.environ.get('MYSQL_PASSWORD')
        database = os.environ.get('MYSQL_DATABASE', 'puntz08$C-Point')
        
        if not password:
            print("❌ Error: MYSQL_PASSWORD environment variable is required!")
            return False
        
        print("Fix Duplicate Messages and Notifications")
        print("=" * 45)
        
        # Connect to MySQL
        conn = pymysql.connect(
            host=host,
            user=user,
            password=password,
            database=database,
            charset='utf8mb4',
            cursorclass=DictCursor,
            autocommit=False
        )
        
        cursor = conn.cursor()
        print("✅ Connected to MySQL successfully!")
        
        # 1. Check for duplicate messages
        print("\n1. Checking for duplicate messages...")
        try:
            cursor.execute("""
                SELECT sender, receiver, message, timestamp, COUNT(*) as count
                FROM messages 
                GROUP BY sender, receiver, message, timestamp
                HAVING COUNT(*) > 1
                ORDER BY timestamp DESC
                LIMIT 10
            """)
            duplicates = cursor.fetchall()
            
            if duplicates:
                print(f"   ❌ Found {len(duplicates)} sets of duplicate messages:")
                for dup in duplicates:
                    print(f"     - {dup['sender']} → {dup['receiver']}: '{dup['message'][:30]}...' ({dup['count']} copies)")
                
                # Remove duplicates, keeping the first one
                print("   🔧 Removing duplicate messages...")
                for dup in duplicates:
                    cursor.execute("""
                        DELETE FROM messages 
                        WHERE sender = %s AND receiver = %s AND message = %s AND timestamp = %s
                        AND id NOT IN (
                            SELECT * FROM (
                                SELECT MIN(id) FROM messages 
                                WHERE sender = %s AND receiver = %s AND message = %s AND timestamp = %s
                            ) as temp
                        )
                    """, (dup['sender'], dup['receiver'], dup['message'], dup['timestamp'],
                         dup['sender'], dup['receiver'], dup['message'], dup['timestamp']))
                
                conn.commit()
                print("   ✅ Removed duplicate messages")
            else:
                print("   ✅ No duplicate messages found")
                
        except Exception as e:
            print(f"   ❌ Error checking duplicate messages: {e}")
        
        # 2. Check for duplicate notifications
        print("\n2. Checking for duplicate notifications...")
        try:
            cursor.execute("""
                SELECT user_id, from_user, type, message, created_at, COUNT(*) as count
                FROM notifications 
                GROUP BY user_id, from_user, type, message, DATE(created_at)
                HAVING COUNT(*) > 1
                ORDER BY created_at DESC
                LIMIT 10
            """)
            dup_notifications = cursor.fetchall()
            
            if dup_notifications:
                print(f"   ❌ Found {len(dup_notifications)} sets of duplicate notifications:")
                for dup in dup_notifications:
                    print(f"     - To {dup['user_id']} from {dup['from_user']}: '{dup['message'][:30]}...' ({dup['count']} copies)")
                
                # Remove duplicate notifications, keeping the most recent one
                print("   🔧 Removing duplicate notifications...")
                for dup in dup_notifications:
                    cursor.execute("""
                        DELETE FROM notifications 
                        WHERE user_id = %s AND from_user = %s AND type = %s AND message = %s 
                        AND DATE(created_at) = DATE(%s)
                        AND id NOT IN (
                            SELECT * FROM (
                                SELECT MAX(id) FROM notifications 
                                WHERE user_id = %s AND from_user = %s AND type = %s AND message = %s 
                                AND DATE(created_at) = DATE(%s)
                            ) as temp
                        )
                    """, (dup['user_id'], dup['from_user'], dup['type'], dup['message'], dup['created_at'],
                         dup['user_id'], dup['from_user'], dup['type'], dup['message'], dup['created_at']))
                
                conn.commit()
                print("   ✅ Removed duplicate notifications")
            else:
                print("   ✅ No duplicate notifications found")
                
        except Exception as e:
            print(f"   ❌ Error checking duplicate notifications: {e}")
        
        # 3. Add constraints to prevent future duplicates
        print("\n3. Adding constraints to prevent future duplicates...")
        
        # Add unique constraint to messages to prevent exact duplicates
        try:
            cursor.execute("SHOW INDEX FROM messages WHERE Key_name = 'unique_message'")
            if not cursor.fetchone():
                print("   Adding unique constraint to messages table...")
                cursor.execute("""
                    ALTER TABLE messages 
                    ADD CONSTRAINT unique_message 
                    UNIQUE (sender, receiver, message, timestamp)
                """)
                conn.commit()
                print("   ✅ Added unique constraint to messages")
            else:
                print("   ✅ Messages table already has unique constraint")
        except Exception as e:
            print(f"   ⚠️  Could not add unique constraint to messages: {e}")
        
        # 4. Check recent message activity for Paulo
        print("\n4. Checking recent message activity for Paulo...")
        try:
            cursor.execute("""
                SELECT sender, receiver, message, timestamp
                FROM messages 
                WHERE sender = 'Paulo' OR receiver = 'Paulo'
                ORDER BY timestamp DESC
                LIMIT 10
            """)
            recent_messages = cursor.fetchall()
            
            print(f"   ✅ Found {len(recent_messages)} recent messages involving Paulo:")
            for msg in recent_messages:
                direction = "sent" if msg['sender'] == 'Paulo' else "received"
                other_user = msg['receiver'] if msg['sender'] == 'Paulo' else msg['sender']
                print(f"     - {direction} {msg['timestamp']}: {other_user} - '{msg['message'][:40]}...'")
                
        except Exception as e:
            print(f"   ❌ Error checking recent messages: {e}")
        
        # 5. Check recent notifications for Paulo
        print("\n5. Checking recent notifications for Paulo...")
        try:
            cursor.execute("""
                SELECT from_user, type, message, created_at, is_read
                FROM notifications 
                WHERE user_id = 'Paulo'
                ORDER BY created_at DESC
                LIMIT 10
            """)
            recent_notifications = cursor.fetchall()
            
            print(f"   ✅ Found {len(recent_notifications)} recent notifications for Paulo:")
            for notif in recent_notifications:
                status = "read" if notif['is_read'] else "unread"
                print(f"     - {notif['created_at']} ({status}): {notif['from_user']} - '{notif['message'][:40]}...'")
                
        except Exception as e:
            print(f"   ❌ Error checking recent notifications: {e}")
        
        cursor.close()
        conn.close()
        
        print("\n🎉 Duplicate issues analysis completed!")
        
        print("\n🔧 React Frontend Debugging Steps:")
        print("1. Open React app in browser")
        print("2. Open Developer Tools (F12) → Console tab")
        print("3. Try sending a message")
        print("4. Check for these issues:")
        print("   - Multiple AJAX calls to /send_message")
        print("   - Double-click events on send button")
        print("   - React state updates causing re-renders")
        print("5. Check Network tab for duplicate requests")
        
        print("\n📋 Potential Fixes:")
        print("- Add button disable during send")
        print("- Add request deduplication")
        print("- Check for double event listeners")
        print("- Verify React useEffect dependencies")
        
        return True
        
    except Exception as e:
        print(f"❌ Debug failed: {e}")
        return False

if __name__ == "__main__":
    success = fix_duplicate_issues()
    sys.exit(0 if success else 1)