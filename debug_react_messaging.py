#!/usr/bin/env python3
"""
Debug React Messaging Functionality
Test the specific endpoints used by the React frontend
"""

import os
import sys

def debug_react_messaging():
    """Debug React messaging endpoints"""
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
        
        print("React Messaging Debug")
        print("=" * 25)
        
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
        
        # 1. Test /api/get_user_id_by_username endpoint logic
        print("\n1. Testing user ID lookup (React uses this)...")
        test_usernames = ['Paulo', 'mary', 'admin']
        
        for username in test_usernames:
            try:
                cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
                result = cursor.fetchone()
                
                if result:
                    user_id = result['id']
                    print(f"   ✅ {username} → ID: {user_id}")
                else:
                    print(f"   ❌ {username} → NOT FOUND")
                    
            except Exception as e:
                print(f"   ❌ Error looking up {username}: {e}")
        
        # 2. Test the send_message endpoint logic
        print("\n2. Testing send_message endpoint logic...")
        try:
            # Get Paulo and mary IDs
            cursor.execute("SELECT id FROM users WHERE username = 'Paulo'")
            paulo_result = cursor.fetchone()
            cursor.execute("SELECT id FROM users WHERE username = 'mary'")
            mary_result = cursor.fetchone()
            
            if paulo_result and mary_result:
                paulo_id = paulo_result['id']
                mary_id = mary_result['id']
                
                print(f"   Paulo ID: {paulo_id}, Mary ID: {mary_id}")
                
                # Test the recipient lookup (what send_message does)
                cursor.execute("SELECT username FROM users WHERE id = %s", (mary_id,))
                recipient = cursor.fetchone()
                
                if recipient:
                    recipient_username = recipient['username'] if hasattr(recipient, 'keys') else recipient[0]
                    print(f"   ✅ Recipient lookup works: ID {mary_id} → {recipient_username}")
                    
                    # Test message insertion
                    test_message = "React debug test message"
                    cursor.execute("""
                        INSERT INTO messages (sender, receiver, message, timestamp)
                        VALUES (%s, %s, %s, NOW())
                    """, ('Paulo', recipient_username, test_message))
                    
                    message_id = cursor.lastrowid
                    conn.commit()
                    print(f"   ✅ Message insertion works (ID: {message_id})")
                    
                    # Clean up test message
                    cursor.execute("DELETE FROM messages WHERE id = %s", (message_id,))
                    conn.commit()
                    print("   ✅ Test message cleaned up")
                    
                else:
                    print(f"   ❌ Could not look up recipient by ID {mary_id}")
            else:
                print("   ❌ Could not find Paulo or mary for testing")
                
        except Exception as e:
            print(f"   ❌ Error testing send_message logic: {e}")
        
        # 3. Test get_messages endpoint logic
        print("\n3. Testing get_messages endpoint logic...")
        try:
            cursor.execute("SELECT id FROM users WHERE username = 'Paulo'")
            paulo_result = cursor.fetchone()
            
            if paulo_result:
                paulo_id = paulo_result['id']
                
                # Test getting messages (what React does)
                cursor.execute("SELECT id FROM users WHERE username = %s", (paulo_id,))
                user_check = cursor.fetchone()
                
                if user_check:
                    print(f"   ✅ User lookup by ID works for get_messages")
                    
                    # Test message query
                    cursor.execute("""
                        SELECT id, sender, receiver, message, timestamp
                        FROM messages
                        WHERE (sender = 'Paulo' AND receiver = 'mary') 
                           OR (sender = 'mary' AND receiver = 'Paulo')
                        ORDER BY timestamp ASC
                        LIMIT 5
                    """)
                    messages = cursor.fetchall()
                    
                    print(f"   ✅ Found {len(messages)} messages between Paulo and mary")
                    for msg in messages[:3]:  # Show first 3
                        print(f"     - {msg['sender']} → {msg['receiver']}: {msg['message'][:30]}...")
                        
                else:
                    print("   ❌ User lookup by ID failed for get_messages")
            else:
                print("   ❌ Could not find Paulo for get_messages test")
                
        except Exception as e:
            print(f"   ❌ Error testing get_messages logic: {e}")
        
        # 4. Check for any remaining rowid issues in messaging endpoints
        print("\n4. Checking for remaining rowid issues...")
        
        # Test the specific query patterns used by React
        test_queries = [
            ("User ID lookup", "SELECT id FROM users WHERE username = %s", ('Paulo',)),
            ("Username lookup", "SELECT username FROM users WHERE id = %s", (1,)),
            ("Message count", "SELECT COUNT(*) as count FROM messages WHERE receiver = %s AND is_read = 0", ('Paulo',)),
        ]
        
        for test_name, query, params in test_queries:
            try:
                cursor.execute(query, params)
                result = cursor.fetchone()
                print(f"   ✅ {test_name}: {result}")
            except Exception as e:
                print(f"   ❌ {test_name} failed: {e}")
        
        cursor.close()
        conn.close()
        
        print("\n🎉 React messaging debug completed!")
        
        print("\n🔧 React-Specific Debugging Steps:")
        print("1. Open browser Developer Tools (F12)")
        print("2. Go to Console tab")
        print("3. Try sending a message in React app")
        print("4. Look for these specific errors:")
        print("   - 'otherUserId is not set' or similar")
        print("   - Failed fetch requests to /send_message")
        print("   - Failed fetch requests to /api/get_user_id_by_username")
        print("5. Check Network tab for failed API calls")
        
        print("\n📋 Common React Messaging Issues:")
        print("- User ID not resolved: Check /api/get_user_id_by_username endpoint")
        print("- Send button unresponsive: Check if otherUserId state is set")
        print("- Messages not sending: Check /send_message endpoint in Network tab")
        print("- Silent failures: Check browser console for JavaScript errors")
        
        return True
        
    except Exception as e:
        print(f"❌ Debug failed: {e}")
        return False

if __name__ == "__main__":
    success = debug_react_messaging()
    sys.exit(0 if success else 1)