#!/usr/bin/env python3
"""
Debug Messaging Functionality
Test and diagnose messaging system issues
"""

import os
import sys

def debug_messaging():
    """Debug messaging functionality"""
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
        
        print("Messaging System Debug")
        print("=" * 30)
        
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
        
        # 1. Check messages table structure
        print("\n1. Checking messages table structure...")
        try:
            cursor.execute("SHOW COLUMNS FROM messages")
            columns = cursor.fetchall()
            column_names = [col['Field'] for col in columns]
            print(f"   Columns: {column_names}")
            
            required_columns = ['id', 'sender', 'receiver', 'message', 'timestamp', 'is_read']
            missing_columns = [col for col in required_columns if col not in column_names]
            
            if missing_columns:
                print(f"   ❌ Missing columns: {missing_columns}")
                return False
            else:
                print("   ✅ All required columns present")
                
        except Exception as e:
            print(f"   ❌ Error checking messages table: {e}")
            return False
        
        # 2. Check users table for messaging
        print("\n2. Checking users table for messaging...")
        try:
            cursor.execute("SELECT id, username FROM users WHERE username IN ('Paulo', 'mary', 'admin') ORDER BY username")
            users = cursor.fetchall()
            
            if users:
                print("   ✅ Found users:")
                for user in users:
                    print(f"     - ID: {user['id']}, Username: {user['username']}")
            else:
                print("   ❌ No users found for messaging")
                return False
                
        except Exception as e:
            print(f"   ❌ Error checking users: {e}")
            return False
        
        # 3. Test sending a message
        print("\n3. Testing message sending functionality...")
        try:
            # Get Paulo and mary IDs for testing
            cursor.execute("SELECT id FROM users WHERE username = 'Paulo'")
            paulo_result = cursor.fetchone()
            cursor.execute("SELECT id FROM users WHERE username = 'mary'")
            mary_result = cursor.fetchone()
            
            if not paulo_result or not mary_result:
                print("   ⚠️  Paulo or mary not found, skipping send test")
            else:
                paulo_id = paulo_result['id']
                mary_id = mary_result['id']
                
                # Test message insertion
                test_message = "Test message from debug script"
                cursor.execute("""
                    INSERT INTO messages (sender, receiver, message, timestamp)
                    VALUES ('Paulo', 'mary', %s, NOW())
                """, (test_message,))
                
                message_id = cursor.lastrowid
                conn.commit()
                print(f"   ✅ Successfully inserted test message (ID: {message_id})")
                
                # Verify the message
                cursor.execute("SELECT * FROM messages WHERE id = %s", (message_id,))
                inserted_msg = cursor.fetchone()
                
                if inserted_msg:
                    print(f"   ✅ Message verified: '{inserted_msg['message']}'")
                    print(f"   ✅ From: {inserted_msg['sender']} To: {inserted_msg['receiver']}")
                    print(f"   ✅ Timestamp: {inserted_msg['timestamp']}")
                else:
                    print("   ❌ Could not verify inserted message")
                
        except Exception as e:
            print(f"   ❌ Error testing message insertion: {e}")
        
        # 4. Check existing messages
        print("\n4. Checking existing messages...")
        try:
            cursor.execute("""
                SELECT sender, receiver, message, timestamp 
                FROM messages 
                ORDER BY timestamp DESC 
                LIMIT 10
            """)
            messages = cursor.fetchall()
            
            if messages:
                print(f"   ✅ Found {len(messages)} recent messages:")
                for msg in messages:
                    print(f"     - {msg['sender']} → {msg['receiver']}: {msg['message'][:50]}...")
            else:
                print("   ⚠️  No messages found in database")
                
        except Exception as e:
            print(f"   ❌ Error checking existing messages: {e}")
        
        # 5. Test unread message count
        print("\n5. Testing unread message count...")
        try:
            cursor.execute("SELECT COUNT(*) as count FROM messages WHERE receiver='Paulo' AND is_read=0")
            result = cursor.fetchone()
            unread_count = result['count'] if result else 0
            print(f"   ✅ Paulo has {unread_count} unread messages")
            
        except Exception as e:
            print(f"   ❌ Error checking unread count: {e}")
        
        # 6. Test user lookup by ID
        print("\n6. Testing user lookup by ID...")
        try:
            cursor.execute("SELECT id FROM users WHERE username = 'mary'")
            mary_user = cursor.fetchone()
            
            if mary_user:
                mary_id = mary_user['id']
                cursor.execute("SELECT username FROM users WHERE id = %s", (mary_id,))
                lookup_result = cursor.fetchone()
                
                if lookup_result:
                    print(f"   ✅ User ID lookup works: ID {mary_id} → {lookup_result['username']}")
                else:
                    print(f"   ❌ Could not lookup user by ID {mary_id}")
            else:
                print("   ❌ Could not find mary's ID")
                
        except Exception as e:
            print(f"   ❌ Error testing user lookup: {e}")
        
        cursor.close()
        conn.close()
        
        print("\n🎉 Messaging debug completed!")
        
        print("\n📋 JavaScript Debugging Tips:")
        print("1. Open browser Developer Tools (F12)")
        print("2. Go to Console tab")
        print("3. Try sending a message and check for JavaScript errors")
        print("4. Check Network tab to see if AJAX requests are being sent")
        print("5. Look for any 500 errors or failed requests")
        
        print("\n🔧 Common Issues & Solutions:")
        print("- If send button does nothing: Check JavaScript console for errors")
        print("- If AJAX fails: Check Flask app logs for backend errors")
        print("- If messages don't appear: Check if recipient_id is correct")
        print("- If form doesn't submit: Check if currentChatUser is set")
        
        return True
        
    except Exception as e:
        print(f"❌ Debug failed: {e}")
        return False

if __name__ == "__main__":
    success = debug_messaging()
    sys.exit(0 if success else 1)