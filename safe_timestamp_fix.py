#!/usr/bin/env python3
"""
Safe timestamp fix that avoids MySQL datetime comparison errors
Run this on Cloud Run bash console
"""

import pymysql
import os
from datetime import datetime

def safe_fix_timestamps():
    """Safely fix post timestamps without triggering MySQL datetime errors"""
    
    print("Safe Timestamp Fix Script")
    print("=" * 30)
    
    # MySQL connection details for Cloud Run
    mysql_config = {
        'host': 'YOUR_CLOUD_SQL_HOST',
        'user': 'puntz08',
        'password': 'tHqF#6gTM_XQYbB',  # From user input
        'database': 'puntz08$C-Point'
    }
    
    try:
        print("\n🔌 Connecting to MySQL...")
        conn = pymysql.connect(
            host=mysql_config['host'],
            user=mysql_config['user'],
            password=mysql_config['password'],
            database=mysql_config['database'],
            cursorclass=pymysql.cursors.DictCursor
        )
        print("✅ Connected to MySQL successfully!")
        
        with conn.cursor() as c:
            # Get all posts and check timestamps in Python (avoid MySQL datetime comparison)
            print("\n🔍 Getting all posts to check timestamps...")
            
            c.execute("""
                SELECT id, username, content, timestamp, community_id
                FROM posts 
                ORDER BY id DESC
            """)
            
            all_posts = c.fetchall()
            print(f"Found {len(all_posts)} total posts")
            
            invalid_posts = []
            
            for post in all_posts:
                timestamp = post['timestamp']
                
                # Check for invalid timestamps in Python
                is_invalid = (
                    timestamp is None or
                    timestamp == '' or
                    timestamp == '0000-00-00 00:00:00' or
                    timestamp == '0000-00-00' or
                    (isinstance(timestamp, str) and len(timestamp.strip()) == 0)
                )
                
                if is_invalid:
                    invalid_posts.append(post)
                    print(f"  Invalid: ID {post['id']}, User: {post['username']}, Timestamp: '{timestamp}'")
            
            if invalid_posts:
                print(f"\n🔧 Fixing {len(invalid_posts)} posts with invalid timestamps...")
                
                fixed_count = 0
                
                for post in invalid_posts:
                    try:
                        # Use MySQL NOW() function - safest approach
                        c.execute("""
                            UPDATE posts 
                            SET timestamp = NOW() 
                            WHERE id = %s
                        """, (post['id'],))
                        
                        print(f"  ✅ Fixed post {post['id']} by {post['username']}")
                        fixed_count += 1
                        
                    except Exception as e:
                        print(f"  ❌ Failed to fix post {post['id']}: {e}")
                
                conn.commit()
                print(f"\n✅ Successfully fixed {fixed_count} timestamps")
                
                # Verify the fixes
                print(f"\n🔍 Verification - checking fixed posts...")
                
                for post in invalid_posts[:3]:  # Check first 3 fixed posts
                    c.execute("SELECT timestamp FROM posts WHERE id = %s", (post['id'],))
                    result = c.fetchone()
                    if result:
                        new_timestamp = result['timestamp']
                        print(f"  Post {post['id']}: {new_timestamp}")
                        
                        # Test if this can be parsed by home timeline logic
                        try:
                            if isinstance(new_timestamp, str):
                                dt = datetime.strptime(new_timestamp[:19], '%Y-%m-%d %H:%M:%S')
                            else:
                                dt = new_timestamp  # Already datetime object
                                
                            age = datetime.now() - dt
                            within_48h = age.total_seconds() <= (48 * 3600)
                            print(f"    Parsed: {dt}, Age: {age}, Within 48h: {'✅' if within_48h else '❌'}")
                        except Exception as parse_error:
                            print(f"    ❌ Still cannot parse: {parse_error}")
                
            else:
                print("✅ No posts with invalid timestamps found")
            
            # Show recent posts that should appear in home timeline
            print(f"\n📋 Recent posts from last 48 hours:")
            c.execute("""
                SELECT p.id, p.username, p.content, p.timestamp, c.name as community_name
                FROM posts p
                LEFT JOIN communities c ON p.community_id = c.id
                WHERE p.timestamp >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
                ORDER BY p.id DESC
                LIMIT 10
            """)
            
            recent_posts = c.fetchall()
            
            if recent_posts:
                print(f"Found {len(recent_posts)} posts from last 48 hours:")
                for post in recent_posts:
                    community_info = f" in {post['community_name']}" if post['community_name'] else ""
                    print(f"  ID: {post['id']}, {post['username']}{community_info}")
                    print(f"  Content: {post['content'][:50]}...")
                    print(f"  Timestamp: {post['timestamp']}")
                    print()
            else:
                print("❌ No posts found from last 48 hours")
            
            return True
            
    except pymysql.Error as e:
        print(f"❌ MySQL Error: {e}")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False
    finally:
        if 'conn' in locals():
            conn.close()
            print("🔌 Database connection closed")

if __name__ == "__main__":
    try:
        success = safe_fix_timestamps()
        if success:
            print("\n" + "=" * 50)
            print("✅ TIMESTAMP FIXES COMPLETED!")
            print("- Invalid timestamps fixed with NOW()")
            print("- Posts should now appear in home timeline")
            print("- Recent posts from last 48 hours identified")
            print("=" * 50)
        else:
            print("\n" + "=" * 50)
            print("❌ FIX FAILED!")
            print("Please check the error messages above")
            print("=" * 50)
    except KeyboardInterrupt:
        print("\n❌ Fix cancelled by user")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")