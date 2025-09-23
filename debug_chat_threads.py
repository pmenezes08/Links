#!/usr/bin/env python3
"""
Debug Chat Threads API
Test why active chats are not appearing in React Messages page
"""

import os
import sys

def debug_chat_threads():
    """Debug the /api/chat_threads endpoint"""
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
        
        print("Chat Threads API Debug")
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
        
        # Test the chat threads logic for Paulo
        username = 'Paulo'
        print(f"\n🔍 Testing chat threads for user: {username}")
        
        # 1. Check if Paulo has any messages
        print("\n1. Checking Paulo's messages...")
        try:
            cursor.execute("""
                SELECT sender, receiver, message, timestamp 
                FROM messages 
                WHERE sender = %s OR receiver = %s
                ORDER BY timestamp DESC
                LIMIT 10
            """, (username, username))
            paulo_messages = cursor.fetchall()
            
            if paulo_messages:
                print(f"   ✅ Found {len(paulo_messages)} messages involving Paulo:")
                for msg in paulo_messages:
                    direction = "sent" if msg['sender'] == username else "received"
                    other_user = msg['receiver'] if msg['sender'] == username else msg['sender']
                    print(f"     - {direction} to/from {other_user}: '{msg['message'][:30]}...' at {msg['timestamp']}")
            else:
                print(f"   ❌ No messages found for {username}")
                print("   💡 This explains why chat threads are empty!")
                return False
                
        except Exception as e:
            print(f"   ❌ Error checking messages: {e}")
            return False
        
        # 2. Test the counterpart query
        print("\n2. Testing counterpart query...")
        try:
            cursor.execute("""
                SELECT DISTINCT receiver AS other_username
                FROM messages
                WHERE sender = %s
                UNION
                SELECT DISTINCT sender AS other_username
                FROM messages
                WHERE receiver = %s
                ORDER BY other_username
            """, (username, username))
            counterparts = cursor.fetchall()
            
            if counterparts:
                print(f"   ✅ Found {len(counterparts)} chat counterparts:")
                for cp in counterparts:
                    other_username = cp['other_username']
                    print(f"     - {other_username}")
            else:
                print("   ❌ No counterparts found")
                return False
                
        except Exception as e:
            print(f"   ❌ Error in counterpart query: {e}")
            return False
        
        # 3. Test building threads for each counterpart
        print("\n3. Testing thread building...")
        threads = []
        
        for cp in counterparts:
            try:
                other_username = cp['other_username']
                print(f"   Processing thread with: {other_username}")
                
                # Last message query
                cursor.execute("""
                    SELECT message, timestamp, sender
                    FROM messages
                    WHERE (sender = %s AND receiver = %s) OR (sender = %s AND receiver = %s)
                    ORDER BY timestamp DESC
                    LIMIT 1
                """, (username, other_username, other_username, username))
                last_msg = cursor.fetchone()
                
                if last_msg:
                    print(f"     ✅ Last message: '{last_msg['message'][:30]}...' from {last_msg['sender']}")
                else:
                    print(f"     ❌ No last message found")
                    continue
                
                # Unread count
                cursor.execute("SELECT COUNT(*) as count FROM messages WHERE sender=%s AND receiver=%s AND is_read=0", (other_username, username))
                unread_result = cursor.fetchone()
                unread_count = unread_result['count'] if unread_result else 0
                print(f"     📧 Unread count: {unread_count}")
                
                # Profile info
                cursor.execute("SELECT display_name, profile_picture FROM user_profiles WHERE username = %s", (other_username,))
                profile = cursor.fetchone()
                
                if profile:
                    display_name = profile['display_name'] or other_username
                    profile_picture = profile['profile_picture']
                    print(f"     👤 Profile: {display_name}, Avatar: {profile_picture or 'None'}")
                else:
                    print(f"     ⚠️  No profile found for {other_username}")
                    display_name = other_username
                    profile_picture = None
                
                # Build thread object
                thread = {
                    'other_username': other_username,
                    'display_name': display_name,
                    'profile_picture_url': f"/static/{profile_picture}" if profile_picture else None,
                    'last_message_text': last_msg['message'],
                    'last_activity_time': last_msg['timestamp'],
                    'last_sender': last_msg['sender'],
                    'unread_count': unread_count,
                }
                threads.append(thread)
                print(f"     ✅ Thread built successfully")
                
            except Exception as e:
                print(f"     ❌ Error building thread for {other_username}: {e}")
                continue
        
        print(f"\n4. Final result: {len(threads)} threads built")
        for i, thread in enumerate(threads):
            print(f"   Thread {i+1}: {thread['other_username']} ({thread['unread_count']} unread)")
        
        cursor.close()
        conn.close()
        
        print("\n🎉 Chat threads debug completed!")
        
        if len(threads) == 0:
            print("\n💡 Why no chat threads appear:")
            print("- No messages exist in the database")
            print("- Messages exist but queries are failing")
            print("- Profile data is missing causing thread building to fail")
        else:
            print(f"\n✅ Chat threads should appear! Found {len(threads)} threads.")
            print("If they're still not showing in React:")
            print("1. Check browser console for JavaScript errors")
            print("2. Check Network tab for failed API calls")
            print("3. Verify /api/chat_threads returns this data")
        
        return True
        
    except Exception as e:
        print(f"❌ Debug failed: {e}")
        return False

if __name__ == "__main__":
    success = debug_chat_threads()
    sys.exit(0 if success else 1)