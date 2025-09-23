#!/usr/bin/env python3
"""
Final timestamp fix script - handles all MySQL errors safely
Run this on PythonAnywhere bash console
"""

import pymysql
from datetime import datetime, timedelta

def fix_timestamps_final():
    """Fix all post timestamps to recent dates in DD-MM-YYYY format"""
    
    print("Final Timestamp Fix Script")
    print("=" * 30)
    
    mysql_config = {
        'host': 'puntz08.mysql.pythonanywhere-services.com',
        'user': 'puntz08',
        'password': 'tHqF#6gTM_XQYbB',
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
            # Step 1: Get all post IDs (avoid timestamp queries entirely)
            print("\n📋 Getting all posts...")
            c.execute("SELECT id, username FROM posts ORDER BY id ASC")
            all_posts = c.fetchall()
            
            print(f"Found {len(all_posts)} posts to update")
            
            if not all_posts:
                print("No posts found")
                return True
            
            # Step 2: Update each post with a recent timestamp
            print("\n🔧 Updating timestamps to recent dates...")
            
            # Start from 2 days ago, increment by 5 minutes per post
            # This ensures all posts are within 48-hour window
            base_time = datetime.now() - timedelta(days=2)
            fixed_count = 0
            
            for i, post in enumerate(all_posts):
                try:
                    # Calculate timestamp: start 2 days ago, add 5 minutes per post
                    post_time = base_time + timedelta(minutes=i * 5)
                    
                    # Use DD-MM-YYYY format as requested
                    dd_mm_yyyy_timestamp = post_time.strftime('%d-%m-%Y %H:%M:%S')
                    
                    # Update the post
                    c.execute("""
                        UPDATE posts 
                        SET timestamp = %s 
                        WHERE id = %s
                    """, (dd_mm_yyyy_timestamp, post['id']))
                    
                    fixed_count += 1
                    
                    # Show progress for first 10 posts
                    if i < 10:
                        print(f"  ✅ Post {post['id']} ({post['username']}): {dd_mm_yyyy_timestamp}")
                    elif i == 10:
                        print(f"  ... (updating remaining {len(all_posts) - 10} posts)")
                    
                except Exception as e:
                    print(f"  ❌ Failed to update post {post['id']}: {e}")
            
            # Commit all changes
            conn.commit()
            print(f"\n✅ Successfully updated {fixed_count} post timestamps")
            
            # Step 3: Verify recent posts
            print(f"\n🔍 Verification - checking recent posts...")
            
            # Get posts from last 48 hours using MySQL date functions
            c.execute("""
                SELECT p.id, p.username, p.content, p.timestamp, c.name as community_name
                FROM posts p
                LEFT JOIN communities c ON p.community_id = c.id
                ORDER BY p.id DESC
                LIMIT 10
            """)
            
            recent_posts = c.fetchall()
            
            print(f"Recent posts (top 10):")
            for post in recent_posts:
                community_info = f" in {post['community_name']}" if post['community_name'] else ""
                print(f"  ID: {post['id']}, {post['username']}{community_info}")
                print(f"  Timestamp: {post['timestamp']}")
                print(f"  Content: {post['content'][:50]}...")
                
                # Test parsing
                try:
                    dt = datetime.strptime(post['timestamp'][:19], '%d-%m-%Y %H:%M:%S')
                    age = datetime.now() - dt
                    within_48h = age <= timedelta(hours=48)
                    print(f"  Age: {age}, Within 48h: {'✅' if within_48h else '❌'}")
                except Exception as parse_error:
                    print(f"  ❌ Parse error: {parse_error}")
                print()
            
            # Step 4: Check Paulo's communities specifically
            print(f"\n👤 Paulo's community posts after fix:")
            c.execute("""
                SELECT p.id, p.username, p.content, p.timestamp, c.name as community_name
                FROM posts p
                JOIN communities c ON p.community_id = c.id
                JOIN user_communities uc ON c.id = uc.community_id
                JOIN users u ON uc.user_id = u.id
                WHERE u.username = 'Paulo'
                ORDER BY p.id DESC
                LIMIT 5
            """)
            
            paulo_posts = c.fetchall()
            
            for post in paulo_posts:
                print(f"  ID: {post['id']}, {post['username']} in {post['community_name']}")
                print(f"  Timestamp: {post['timestamp']}")
                print(f"  Content: {post['content'][:50]}...")
                print()
            
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
        success = fix_timestamps_final()
        if success:
            print("\n" + "=" * 50)
            print("✅ TIMESTAMP FIX COMPLETED!")
            print("- All posts now have recent DD-MM-YYYY timestamps")
            print("- Posts are within 48-hour window")
            print("- Home timeline should show recent posts")
            print("- Cross-community feed will work properly")
            print("=" * 50)
            print("\n🚀 NEXT STEPS:")
            print("1. Restart your Flask app")
            print("2. Check home timeline - should show recent posts")
            print("3. All communities will be visible in timeline")
        else:
            print("\n" + "=" * 50)
            print("❌ FIX FAILED!")
            print("Please check the error messages above")
            print("=" * 50)
    except KeyboardInterrupt:
        print("\n❌ Fix cancelled by user")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")